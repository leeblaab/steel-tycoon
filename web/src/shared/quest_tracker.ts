// Quest tracking (Roadmap V3 Phase 2, "Quest tracking" bullet).
// Pure module: mirrors content/quests.json against a live hub state snapshot each tick.
// Quest transitions are driven ONLY by simulation state + events (§5.2 roadmap rule —
// never by UI clicks). No React, no side effects on the sim: the hub feeds snapshots.
//
// Content contract (content/quests.json, schema_version 1):
//   success_criteria.conditions[]: { field, op, value, sme_pending } evaluated against
//   the slice state verbatim; `event` conditions match events emitted by the slice port
//   for the quest's tick. Optional quests are tracked separately (never gate progression).
//
// F-12 quest-evaluation contract (SME-settled by Yasser, DECISIONS.md F-12):
//   STRICT CHAIN: quest qN's conditions are evaluated only after q(N−1) completed; the
//   optional challenge chains strictly after the LAST main quest. A quest that just
//   completed on tick T makes its successor evaluable from tick T+1 onward.
//   WINDOWED CUMULATIVE CONDITIONS: unload_blocked_t / upstream_blocked_t (and produced_t,
//   arrived_t) are cumulative since-tick-0 engine accumulators — a snapshot comparison
//   passes/fails trivially. Their conditions measure the DELTA over the window since the
//   previous quest completed: (value at eval tick − baseline), where the baseline is that
//   field's value at the predecessor's completion tick (tick 0 for the first quest). The
//   baseline snapshot rides the save (QuestProgress.window_baseline).

export const QUESTS_SCHEMA_VERSION = 1;

/** Engine state fields that accumulate monotonically since tick 0 — conditions on these
 *  are evaluated as window deltas, never snapshots (F-12). ships_arrived and boolean
 *  flags keep raw snapshot semantics. */
export const CUMULATIVE_FIELDS: ReadonlySet<string> = new Set([
  'arrived_t', 'produced_t', 'unload_blocked_t', 'upstream_blocked_t', 'berth_wait_ship_days_beyond_free',
]);

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

/** Flattened one level of content/quests.json — the tracker's input shape. */
export interface LevelQuestDoc {
  schema_version: number;
  level_id: string;
  quests: QuestDef[];
}

/** Flatten one level of content/quests.json into the tracker's quest list. */
export function loadLevelQuests(doc: QuestsDoc, levelId: string): LevelQuestDoc {
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
  /** Cumulative-field values at the moment this quest's window opened (predecessor's
   *  completion tick; empty for the first quest = tick-0 zeros). Windowed delta eval
   *  subtracts these from the live accumulator. Rides the save (F-12). */
  window_baseline: Record<string, number>;
  /** Tick this quest's window opened (predecessor's completion tick; null for the first
   *  main quest). A quest never evaluates on its own opening tick — "strictly after" (F-12). */
  window_open_tick: number | null;
}

/** Per-quest progress keyed by quest id — exactly the shape §13 persistence coverage
 *  adds to the save snapshot (GameSave.quest_progress). */
export type QuestProgressMap = Record<string, QuestProgress>;

function evalCondition(c: QuestCondition, state: Record<string, any>, baseline: Record<string, number>): boolean {
  const v = state[c.field];
  if (typeof v !== 'number' && typeof v !== 'boolean') return false; // unknown field never passes
  // F-12: cumulative accumulators compare as window delta since the quest's window opened.
  const x = CUMULATIVE_FIELDS.has(c.field) ? Number(v) - (baseline[c.field] ?? 0) : Number(v);
  switch (c.op) {
    case '>=': return x >= c.value;
    case '>': return x > c.value;
    case '<=': return x <= c.value;
    case '<': return x < c.value;
    case '==': return typeof v === 'boolean' ? v === (c.value as unknown as boolean) : x === c.value;
  }
}

/** Snapshot the cumulative-field values a quest's window starts from. */
function baselineFor(state: Record<string, any>): Record<string, number> {
  const b: Record<string, number> = {};
  for (const f of CUMULATIVE_FIELDS) if (typeof state[f] === 'number') b[f] = state[f];
  return b;
}

export class QuestTracker {
  readonly levelId: string;
  private defs: QuestDef[];
  private progress: QuestProgressMap = {};
  /** Tick each quest became active — quest-stalled detection window (§6.5 roadmap rule). */
  private activatedAt: Record<string, number> = {};

  constructor(doc: LevelQuestDoc) {
    if (doc.schema_version !== QUESTS_SCHEMA_VERSION) {
      throw new Error(`quests.json schema_version ${doc.schema_version} unsupported (this build reads ${QUESTS_SCHEMA_VERSION})`);
    }
    this.levelId = doc.level_id;
    this.defs = doc.quests;
    // F-12 STRICT CHAIN: main quests evaluate one at a time (next opens when the previous
    // completes). The optional challenge is LOCKED until the last main quest completes
    // (Yasser 2026-11-18: l1_opt_no_idle_furnace chains strictly after q4 — an "over the
    // whole run" challenge measured from tick 1 would be a freebie).
    let mainIdx = 0;
    for (const q of this.defs) {
      const status: QuestStatus = q.optional ? 'locked' : mainIdx === 0 ? 'active' : 'locked';
      if (!q.optional) mainIdx++;
      this.progress[q.id] = { id: q.id, status, conditions_met: false, completed_at_tick: null, window_baseline: {}, window_open_tick: null };
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
   *  milestone feedback for these). Idempotent: a completed quest never re-fires.
   *  F-12 strict chain: only quests whose predecessor completed on an EARLIER update call
   *  are evaluated; each completion opens its successor (and the optional challenge after
   *  the last main) with window_baseline snapshotted from the current state. */
  update(snap: QuestSnapshot): string[] {
    const completedNow: string[] = [];
    for (const q of this.defs) {
      const p = this.progress[q.id];
      if (p.status !== 'active' && p.status !== 'available') continue; // locked / completed never evaluate
      const pred = this.predecessorId(q);
      if (pred !== null) {
        if (this.progress[pred].status !== 'completed') continue; // strict chain: predecessor not done -> no eval at all
        if (p.window_open_tick !== null && p.window_open_tick === snap.tick) continue; // window opened THIS tick -> eval from next tick (strictly after)
      }
      const met = q.success_criteria.conditions.every((c) => evalCondition(c, snap.state, p.window_baseline));
      p.conditions_met = met;
      if (met) {
        p.status = 'completed';
        p.completed_at_tick = snap.tick;
        completedNow.push(q.id);
        // Open the next in chain order (§5.2: state-driven unlock), windowing from here.
        const base = baselineFor(snap.state as Record<string, any>);
        const nextMain = this.defs.find(
          (d) => !d.optional && this.progress[d.id].status === 'locked',
        );
        if (nextMain) {
          this.progress[nextMain.id].status = 'active';
          this.progress[nextMain.id].window_baseline = base;
          this.progress[nextMain.id].window_open_tick = snap.tick;
          this.activatedAt[nextMain.id] = snap.tick;
        } else if (this.defs.some((d) => d.optional && this.progress[d.id].status === 'locked')) {
          // last main done -> optional challenge window opens (strictly after, F-12)
          for (const d of this.defs) {
            if (d.optional && this.progress[d.id].status === 'locked') {
              this.progress[d.id].status = 'available';
              this.progress[d.id].window_baseline = base;
              this.progress[d.id].window_open_tick = snap.tick;
              this.activatedAt[d.id] = snap.tick;
            }
          }
        }
      }
    }
    return completedNow;
  }

  /** Chain predecessor for a quest: previous main quest, or the LAST main quest for an
   *  optional challenge (Yasser: opt chains strictly after q4). First main has none. */
  private predecessorId(q: QuestDef): string | null {
    if (q.optional) {
      const mains = this.defs.filter((d) => !d.optional);
      return mains.length ? mains[mains.length - 1].id : null;
    }
    const mains = this.defs.filter((d) => !d.optional);
    const i = mains.findIndex((d) => d.id === q.id);
    return i > 0 ? mains[i - 1].id : null;
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

  /** Restore from a persisted snapshot (save/load coverage, §13 Phase 2 bullet).
   *  S0.5 hardening: an open-window row (active/available) must carry its window
   *  fields — restoring one with defaulted {} / null baselines would evaluate
   *  cumulative deltas from tick-0 zeros and silently complete on stale plant tonnage,
   *  so a missing field is rejected here too (defence in depth behind loadSave). */
  restoreProgress(saved: QuestProgressMap): void {
    for (const q of this.defs) {
      const s = saved[q.id];
      if (!s) continue; // fresh quest def with no saved row stays at its initial state
      if (s.status !== 'locked' && s.status !== 'available' && s.status !== 'active' && s.status !== 'completed') {
        throw new Error(`quest '${q.id}' has invalid saved status '${s.status}'`);
      }
      if ((s.status === 'active' || s.status === 'available') &&
          (s.window_baseline === undefined || s.window_open_tick === undefined)) {
        throw new Error(`quest '${q.id}' (${s.status}) restored without window fields — refusing to load`);
      }
      this.progress[q.id] = {
        id: q.id, status: s.status, conditions_met: !!s.conditions_met, completed_at_tick: s.completed_at_tick ?? null,
        window_baseline: s.window_baseline ?? {}, window_open_tick: s.window_open_tick ?? null,
      };
    }
  }
}
