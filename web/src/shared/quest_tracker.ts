// Quest tracking (Roadmap V3 Phase 2, "Quest tracking" bullet).
// Pure module: mirrors content/quests.json against a live hub state snapshot each tick.
// Quest transitions are driven ONLY by simulation state + events (§5.2 roadmap rule —
// never by UI clicks). No React, no side effects on the sim: the hub feeds snapshots.
//
// Content contract (content/quests.json, schema_version 1):
//   success_criteria.conditions[]: { field, op, value, sme_pending } evaluated against
//   the slice state verbatim; `event` conditions match events emitted by the slice port
//   for the quest's tick. Optional quests are tracked separately (never gate progression).

export const QUESTS_SCHEMA_VERSION = 1;

export type QuestStatus = 'locked' | 'available' | 'active' | 'completed';

export interface QuestCondition {
  field: string;
  op: '>=' | '>' | '<=' | '<' | '==';
  value: number;
  sme_pending?: boolean;
}

export interface QuestDef {
  id: string;
  level_id: string;
  slice: string;
  title: string;
  goal: string;
  quest_type: string;
  decision_kind: string;
  optional: boolean;
  cards: string[];
  success_criteria: { conditions: QuestCondition[] };
}

/** Raw content/quests.json shape: levels[] each with quests[] + optional_challenges[]. */
export interface QuestsDoc {
  schema_version: number;
  levels: Array<{
    id: string;
    title?: string;
    quests: Array<Record<string, any>>;
    optional_challenges?: Array<Record<string, any>>;
  }>;
}

/** Flatten one level of content/quests.json into the tracker's quest list. */
export function loadLevelQuests(doc: QuestsDoc, levelId: string): { schema_version: number; level_id: string; quests: QuestDef[] } {
  const lvl = doc.levels.find((l) => l.id === levelId);
  if (!lvl) throw new Error(`quests.json has no level '${levelId}'`);
  const conv = (q: Record<string, any>, optional: boolean): QuestDef => ({
    id: q.id,
    level_id: lvl.id,
    slice: q.success_criteria?.slice ?? 'slice1',
    title: q.title,
    goal: q.goal ?? '',
    quest_type: q.quest_type,
    decision_kind: q.decision?.kind ?? '',
    optional,
    cards: q.cards ?? [],
    success_criteria: { conditions: q.success_criteria.conditions },
  });
  return {
    schema_version: doc.schema_version,
    level_id: lvl.id,
    quests: [...lvl.quests.map((q) => conv(q, false)), ...(lvl.optional_challenges ?? []).map((q) => conv(q, true))],
  };
}

export interface QuestSnapshot {
  tick: number;
  state: Record<string, any>;
  events: Array<{ tick: number; event: string }>;
}

export interface QuestProgress {
  id: string;
  status: QuestStatus;
  /** true when every success-criteria condition currently holds against the snapshot. */
  conditions_met: boolean;
  completed_at_tick: number | null;
}

/** Per-quest progress keyed by quest id — exactly the shape §13 persistence coverage
 *  adds to the save snapshot (GameSave.quest_progress). */
export type QuestProgressMap = Record<string, QuestProgress>;

function evalCondition(c: QuestCondition, state: Record<string, any>): boolean {
  const v = state[c.field];
  if (typeof v !== 'number' && typeof v !== 'boolean') return false; // unknown field never passes
  switch (c.op) {
    case '>=': return Number(v) >= c.value;
    case '>': return Number(v) > c.value;
    case '<=': return Number(v) <= c.value;
    case '<': return Number(v) < c.value;
    case '==': return v === c.value || Number(v) === c.value;
  }
}

export class QuestTracker {
  readonly levelId: string;
  private defs: QuestDef[];
  private progress: QuestProgressMap = {};
  /** Tick each quest became active — quest-stalled detection window (§6.5 roadmap rule). */
  private activatedAt: Record<string, number> = {};

  constructor(doc: QuestsDoc) {
    if (doc.schema_version !== QUESTS_SCHEMA_VERSION) {
      throw new Error(`quests.json schema_version ${doc.schema_version} unsupported (this build reads ${QUESTS_SCHEMA_VERSION})`);
    }
    this.levelId = doc.level_id;
    this.defs = doc.quests;
    // Main quests form a strict chain (next unlocks when the previous completes — §5.2
    // lifecycle driven by game state). Optional challenges stay 'available' alongside.
    let mainIdx = 0;
    for (const q of this.defs) {
      const status: QuestStatus = q.optional ? 'available' : mainIdx === 0 ? 'active' : 'locked';
      if (!q.optional) mainIdx++;
      this.progress[q.id] = { id: q.id, status, conditions_met: false, completed_at_tick: null };
    }
  }

  definitions(): QuestDef[] { return [...this.defs]; }
  definition(id: string): QuestDef | undefined { return this.defs.find((d) => d.id === id); }
  snapshotProgress(): QuestProgressMap {
    const out: QuestProgressMap = {};
    for (const [k, v] of Object.entries(this.progress)) out[k] = { ...v };
    return out;
  }

  /** Evaluate one tick. Returns the quest ids that COMPLETED on this tick (hub emits
   *  milestone feedback for these). Idempotent: a completed quest never re-fires. */
  update(snap: QuestSnapshot): string[] {
    const completedNow: string[] = [];
    for (const q of this.defs) {
      const p = this.progress[q.id];
      if (p.status === 'completed' || p.status === 'locked') continue;
      const met = q.success_criteria.conditions.every((c) => evalCondition(c, snap.state));
      p.conditions_met = met;
      if (met) {
        p.status = 'completed';
        p.completed_at_tick = snap.tick;
        completedNow.push(q.id);
        // unlock the next locked main quest in chain order (§5.2: state-driven unlock)
        const nextMain = this.defs.find(
          (d) => !d.optional && this.progress[d.id].status === 'locked',
        );
        if (nextMain) {
          this.progress[nextMain.id].status = 'active';
          this.activatedAt[nextMain.id] = snap.tick;
        }
      }
    }
    return completedNow;
  }

  activeQuestId(): string | null {
    const q = this.defs.find((d) => !d.optional && this.progress[d.id].status === 'active');
    return q ? q.id : null;
  }

  levelComplete(): boolean {
    return this.defs.filter((d) => !d.optional).every((d) => this.progress[d.id].status === 'completed');
  }

  /** §6.5 quest-stalled detection: an ACTIVE main quest whose conditions have not been
   *  met for `stallTicks` or more ticks since it became active counts as "stuck" and
   *  earns a hint. Returns the unmet conditions (first-tier diagnostic names them). */
  stalledQuest(stallTicks: number, snap: QuestSnapshot): { quest: QuestDef; unmet: QuestCondition[]; stalled_for: number } | null {
    const id = this.activeQuestId();
    if (!id) return null;
    const q = this.definition(id)!;
    const since = this.activatedAt[id] ?? 0; // quest active since construction → window from tick 0
    if (snap.tick - since < stallTicks) return null;
    const unmet = q.success_criteria.conditions.filter((c) => !evalCondition(c, snap.state));
    if (unmet.length === 0) return null;
    return { quest: q, unmet, stalled_for: snap.tick - since };
  }

  /** Restore from a persisted snapshot (save/load coverage, §13 Phase 2 bullet). */
  restoreProgress(saved: QuestProgressMap): void {
    for (const q of this.defs) {
      const s = saved[q.id];
      if (!s) continue; // fresh quest def with no saved row stays at its initial state
      if (s.status !== 'locked' && s.status !== 'available' && s.status !== 'active' && s.status !== 'completed') {
        throw new Error(`quest '${q.id}' has invalid saved status '${s.status}'`);
      }
      this.progress[q.id] = { id: q.id, status: s.status, conditions_met: !!s.conditions_met, completed_at_tick: s.completed_at_tick ?? null };
    }
  }
}
