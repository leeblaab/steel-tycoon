// Fullplant game session (Roadmap V3 Phase 1, contract clause 3): the overview port drives
// the SAME per-slice engines the hub drives — slice modules are never modified here.
// One shared clock; every unlocked slice ticks each plant-minute step; registry balance is
// checked after every tick (same discipline as HubTickLoop). Quest tracking runs against
// verbatim slice state fields, exactly like the hub.

import { buildCatalog, type CatalogEntry } from '../../../hub/catalog.ts';
import { HubTickLoop } from '../../../hub/tickloop.ts';
import { InventoryRegistry, type BalanceCheckResult } from '../../../shared/inventory_registry.ts';
import { QuestTracker, loadLevelQuests, type QuestProgressMap, type QuestsDoc } from '../../../shared/quest_tracker.ts';
import { inspectSlice1Slot, inspectSlice3Slot, inspectSlice4Slot, inspectSlice5Slot } from '../../../shared/inspection_cards.ts';
import { initState, loadSequence, advance, checkExit, currentStep, isBuilt, slice1Done, SLICE1_BUILD_NODES, type OnboardingState, type SeqStep } from './onboarding.ts';
import { QUEST_BUILD_UNLOCK, SLICE_BUILD_NODES as SLICE_BUILD_NODES_SHARED, sliceBuildDone } from '../../../shared/commissioning.ts';
import { captureRng, writeFullplantSave, loadFullplantSave, LocalStorageSaveStorage, type SaveStorage, type SliceSnapshot, type OnboardingSnapshot } from '../../../shared/save_load.ts';
import { applyDecision, type DecisionRow } from '../../../ports/slice1/slice1_decide.ts';
import {
  freshOreBeltState, stepOreBelt, commissionDrp, beltDepositYard,
  beltLedgerView, beltInvariants, type OreBeltState,
} from '../../../shared/ore_belt.ts';

/** S1.2 (PLAN_FORGED): the belt built at onboarding step 4 is a REAL transfer edge — the
 *  yard->ore_buffer->drp_intake chain rides the slice1 arrival stream. Authored against
 *  content/nodes/conveyors_draft.json conv_ore_drp capacity band (400-800 tph, mid default). */
export const ORE_BELT_DUMP = { rate_tph: 600.0, chunk_t: 25.0, travel_ticks: 2 } as const;

/** Save/load gate for a carried belt block (reject-never-default, like onboarding):
 *  shape + invariants only — the closure check re-runs the same 1e-6 ledger gate. */
export function validateOreBeltBlock(ob: unknown): { state: OreBeltState; deposits: number } | null {
  if (ob == null) return null; // absent = fresh belt (pre-S1.2 saves resume with an empty chain)
  if (typeof ob !== 'object' || Array.isArray(ob)) throw new Error('save ore_belt block is not an object');
  const o = ob as Record<string, unknown>;
  const st = o.state as OreBeltState | undefined;
  if (!st || typeof st !== 'object' || typeof st.registry?.tick !== 'number') {
    throw new Error('save ore_belt.state is missing its registry tick');
  }
  if (typeof o.deposits_total !== 'number' || !Number.isFinite(o.deposits_total)) {
    throw new Error('save ore_belt.deposits_total must be a finite number');
  }
  const rate = st.beltRateTph, chunk = st.chunkT, travel = st.travelTicks;
  if (!(rate > 0) || !(chunk > 0) || !Number.isInteger(travel) || travel < 1) {
    throw new Error('save ore_belt belt params invalid (rate/chunk positive, integer travel >= 1)');
  }
  const close = beltInvariants(st, o.deposits_total);
  if (!close.ok) throw new Error(`save ore_belt failed its ledger gate: ${close.detail}`);
  return { state: structuredClone(st), deposits: o.deposits_total };
}

export interface SliceRuntime {
  entry: CatalogEntry | null; // null for slice2 (no engine yet — pending redesign)
  loop: HubTickLoop<any> | null;
  unlocked: boolean;    // BUILD CHAIN open: this area's sequence steps are tappable/visible
}

export interface PlantEvent {
  tick: number;
  slice: string;
  event: string;
}

export type Speed = 'pause' | 'normal' | 'fast';

/** Quest completion -> which area's BUILD CHAIN opens (contract clause 8: quest-scripted,
 *  fixed places, no random placement). The quest chain IS the production flow: each area
 *  becomes buildable when its predecessor quest proves the upstream flow. This does NOT
 *  start any engine — engines tick only at sliceBuildDone (S0.3 commissioning fix:
 *  "no machine produces before you build it").
 *  q3 ("furnace fed") opens slice5 (the mill needs billets); q4 ("first steel", whose
 *  criteria are slice1 fields) rewards with the scrap-prep plant (slice2). */
const QUEST_COMMISSION: Record<string, string> = QUEST_BUILD_UNLOCK;

/** Slice -> inspect card key (shared/inspection_cards.ts contract). slice2 has no engine
 *  yet — its card is a placeholder (pending redesign), so it's absent here. */
const INSPECT_KEY: Record<string, string> = {
  slice1: 'berth_queue',
  slice3: 'dri_buffer',
  slice4: 'eaf',
  slice5: 'mill',
};

export class GameSession {
  readonly catalog: CatalogEntry[];
  readonly slices: Record<string, SliceRuntime> = {};
  readonly registry = new InventoryRegistry();
  readonly tracker: QuestTracker;
  readonly events: PlantEvent[] = [];
  /** Plant clock (minutes/TICK_MIN). Restored from the save's top-level mirror tick —
   *  session.tick and slices.slice1.state.tick are kept in lockstep by stepPlant. */
  tick = 0;
  speed: Speed = 'normal';
  /** Guided first build (docs/gameplay.md §1.5). Sequence is DATA (level1_draft.json). */
  readonly seqSteps: SeqStep[];
  onboard: OnboardingState = initState();
  /** S1.2 belt chain state (yard->buffer->intake). Null while the belt isn't built yet. */
  belt: OreBeltState | null = null;
  beltDepositsTotal = 0.0; // closure baseline for the belt ledger gate
  private prevSliceArrivedT = 0.0; // slice1 `arrived_t` deltas feed the yard credit

  constructor(questsDoc: QuestsDoc, seqDoc: any) {
    this.catalog = buildCatalog();
    for (const entry of this.catalog) {
      this.registry.register(entry.adapter);
      // Pre-onboarding nothing is built: slice engines stay locked until their guided-build
      // step completes (§1.5; supersedes "slice1 starts unlocked" — the player builds it).
      this.slices[entry.id] = {
        entry,
        loop: new HubTickLoop(entry.module, this.registry),
        unlocked: false,
      };
    }
    // slice2 has no parity engine yet (redesign pending) — zone exists, quest-driven
    // unlock still commissions it visually; its accordion shows 'engine pending'.
    this.slices['slice2'] = { entry: null, loop: null, unlocked: false };
    this.tracker = new QuestTracker(loadLevelQuests(questsDoc, 'level_1'));
    this.seqSteps = loadSequence(seqDoc);
  }

  // ---------- guided first build (§1.5) ----------

  /** Dismiss a card step (welcome etc.) -> advance the flow. 'park' is NOT dismissible:
   *  only checkExit (all slice-1 quests completed) moves past it. 'resume' (the quest-done
   *  bridge card) advances on tap. */
  dismissCard(): void {
    const step = currentStep(this.seqSteps, this.onboard);
    if (!step || (step.type !== 'card' && step.type !== 'resume')) return;
    advance(this.seqSteps, this.onboard);
  }

  /** Confirm-build a guided step: equipment appears at its fixed footprint; the jetty
   *  completion starts the sim clock (frozen-until-jetty rule). Only 'build' steps. */
  confirmBuild(): string | null {
    const step = currentStep(this.seqSteps, this.onboard);
    if (!step || step.type !== 'build') return null;
    const nodeId = step.node_id!;
    const jettyDone = advance(this.seqSteps, this.onboard);
    // engines join the plant as their slice's guided builds complete (joins a LIVE ticking
    // plant after the jetty) — built equipment must actually run, not just appear.
    const sliceOfNode: Record<string, string> = {
      jetty: 'slice1', scrap_yard: 'slice1', conv_ore_drp: 'slice1',
      drp: 'slice3', conv_dri_eaf: 'slice3',
      scrap_feed: 'slice4', eaf: 'slice4', lf: 'slice4', cc: 'slice4', conv_ccm_billet: 'slice4', billet_yard: 'slice4',
      conv_billet_rebar: 'slice5', bar_mill: 'slice5', conv_billet_wr: 'slice5', wire_rod_mill: 'slice5', finished_yard: 'slice5', conv_mill_dispatch: 'slice5', dispatch: 'slice5',
    };
    if (jettyDone) this.events.push({ tick: this.tick, slice: 'slice1', event: 'plant_clock_started' });
    const slice = sliceOfNode[nodeId];
    // Slice1's engine is the exception: it ticks as soon as its builds complete (the
    // jetty starts the clock). Other slices tick ONLY once BOTH their build chain is open
    // AND their own sequence nodes are all placed (S0.3 gate: no production before build).
    if (slice === 'slice1' && this.sliceBuildDone(slice)) this.unlockSlice(slice); // engine ticks once slice1 is fully built
    // S1.2: the ore belt becomes a live transfer edge the moment it is placed (step 4),
    // even though no DRP exists yet — it runs yard -> ore_buffer until commissionDrp joins
    // drp_intake later (drp build / slice3 unlock below).
    if (nodeId === 'conv_ore_drp' && this.belt == null) {
      this.belt = freshOreBeltState(ORE_BELT_DUMP.rate_tph, ORE_BELT_DUMP.chunk_t, ORE_BELT_DUMP.travel_ticks);
      this.events.push({ tick: this.tick, slice: 'slice1', event: 'ore_belt_built' });
    }
    // Guided sequence nodes for LATER slices commission their area when placed (same rule
    // the quest-commission path enforces via unlockSlice — S0.3 visibility gate).
    if (slice && slice !== 'slice1' && this.builtNode(nodeId)) this.unlockSlice(slice);
    // S1.2: DRP joining the plant (guided build or area commissioning) starts the belt's
    // second hop; pre-built buffer stock keeps flowing into drp_intake.
    if (nodeId === 'drp' || slice === 'slice3') this.ensureDrpCommissioned();
    // Re-derive unlock state for every other slice: unlocks are DATA-derived (built nodes +
    // completed quests), so a mid-sequence confirmBuild can never leave a later area
    // "unlocked but not yet commissioned" (S0.5 invariant: restored == live).
    this.recomputeUnlocks();
    return nodeId;
  }

  /** Unlock state derived purely from onboarding data + quest rows — the single source of
   *  truth for SliceRuntime.unlocked. Idempotent; called after every unlock event (build,
   *  quest completion, restore). Never emits events. */
  private recomputeUnlocks(): void {
    const done = new Set<string>();
    for (const [qid, prog] of Object.entries(this.tracker.snapshotProgress())) {
      if ((prog as any)?.status === 'completed') done.add(qid);
    }
    for (const [slice, rt] of Object.entries(this.slices)) {
      const nodes = GameSession.SLICE_BUILD_NODES[slice] ?? [];
      let unlocked = nodes.length > 0 && nodes.every((n) => this.onboard.built.includes(n));
      if (!unlocked) {
        for (const [qid, target] of Object.entries(QUEST_COMMISSION)) {
          if (target === slice && done.has(qid)) { unlocked = true; break; }
        }
      }
      rt.unlocked = unlocked;
    }
  }

  /** The node ids that WOULD be commissioned by completing quest `qid` (pure; used before
   *  tracker.complete flips the row so unlock events get attributed to the right slice). */
  private nodesCommissionedByQuest(qid: string): string[] {
    const slice = QUEST_COMMISSION[qid];
    if (!slice) return [];
    const nodes = GameSession.SLICE_BUILD_NODES[slice] ?? [];
    return nodes.filter((n) => !this.onboard.built.includes(n));
  }

  /** Guided-flow gate check (checked against live sim state — real flow, not UI clicks).
   *  Park step: only moves past when ALL level-1 quests completed -> then the 'resume'
   *  bridge card shows. Milestone step: flips index to -1 (quests take over fully).
   *  (Sequence note 2026-10-26: "completing them commissions the next areas and unlocks
   *  Slice 2 building" — quests gate ALL slice-2+ BUILDING, not just slice2.) */
  onboardingComplete(): boolean {
    this.onboard.questProgressSnapshot = this.tracker.snapshotProgress() as any;
    if (!checkExit(this.seqSteps, this.onboard, this.stateOf('slice1'))) return false;
    const step = currentStep(this.seqSteps, this.onboard);
    if (step && step.type === 'park') {
      advance(this.seqSteps, this.onboard); // park -> resume bridge card
      this.events.push({ tick: this.tick, slice: 'slice1', event: 'slice1_quests_done' });
      return false; // flow continues (resume card), not finished
    }
    this.onboard.index = -1; // milestone met: guided flow over, quests take over
    return true;
  }

  /** Slice-1 build phase done? Drives the park-card UI and slice visibility. */
  slice1BuildDone(): boolean { return slice1Done(this.onboard); }

  builtNode(nodeId: string): boolean { return isBuilt(this.onboard, nodeId); }
  slice1SlotsPending(): number { return SLICE1_BUILD_NODES.filter((n) => !isBuilt(this.onboard, n)).length; }

  /** Slice -> build nodes placed by the guided flow (single source: shared/commissioning.ts;
   *  slice2 has no sequence builds — it commissions only via quest completion). */
  static readonly SLICE_BUILD_NODES = SLICE_BUILD_NODES_SHARED;

  /** Is this slice's guided build finished (all its sequence nodes built)? */
  sliceBuildDone(slice: string): boolean { return sliceBuildDone(this.onboard, slice); }

  /** Quest-scripted commissioning: opens the area's BUILD CHAIN only (sequence steps become
   *  tappable). Places are fixed, no random placement, no purchase. Never starts an engine —
   *  engine ticking is gated separately by engineRunning() / sliceBuildDone (S0.3 fix). */
  unlockSlice(slice: string): void {
    const rt = this.slices[slice];
    if (!rt || rt.unlocked) return;
    rt.unlocked = true;
    this.events.push({ tick: this.tick, slice, event: `build_chain_open:${slice}` });
  }

  /** S1.2: drp_intake joins the belt ledger when the DRP node is built (guided step or
   *  area commissioning). Idempotent; no-op before the belt exists (a DRP without a belt
   *  simply has no upstream chain yet — the belt's own build wires it on placement). */
  ensureDrpCommissioned(): void {
    if (!this.belt || this.belt.drpCommissioned) return;
    this.belt = commissionDrp(this.belt);
    this.events.push({ tick: this.tick, slice: 'slice3', event: 'drp_intake_open' });
  }

  /** Does this slice's ENGINE tick this plant-minute? True only when the area is unlocked
   *  AND every one of its sequence build nodes is placed. slice1 is exempt from the
   *  unlock half (its builds themselves open it); slices without sequence builds
   *  (slice2 — no engine) never tick. */
  engineRunning(slice: string): boolean {
    const rt = this.slices[slice];
    if (!rt || !rt.loop) return false;
    if (slice === 'slice1') return rt.unlocked;
    return rt.unlocked && this.sliceBuildDone(slice);
  }

  /** Advance the whole plant by one tick. Quest completion opens the NEXT area's build
   *  chain (never an engine — engines tick only once their own builds are placed).
   *  §1.5 time rule: while the guided build is pre-jetty, onboard.clockRunning is false —
   *  callers must not step; stepPlant also refuses as a guard. */
  stepPlant(): string[] {
    if (!this.onboard.clockRunning) return [];
    this.tick += 1;
    for (const rt of Object.values(this.slices)) {
      if (!rt.loop || !this.engineRunning(rt.entry!.id)) continue; // engine gate: unlocked AND built
      const chk = rt.loop.step();
      if (!chk.ok) {
        throw new Error(`fullplant ledger broke on ${rt.entry!.id} at tick ${this.tick}: ${chk.detail}`);
      }
    }
    // S1.2 ore belt: rides the slice1 arrival stream (`arrived_t` delta = tonnes credited
    // into the yard this tick). The belt has its own closed ledger (registry_handoff.ts
    // primitives) — a break here is as fatal as a slice-engine break.
    if (this.belt) {
      const s1 = this.stateOf('slice1') as Record<string, any> | undefined;
      const arrived = typeof s1?.arrived_t === 'number' ? s1.arrived_t : this.prevSliceArrivedT;
      const delta = arrived - this.prevSliceArrivedT;
      this.prevSliceArrivedT = arrived;
      if (delta > 0) {
        this.belt = beltDepositYard(this.belt, delta);
        this.beltDepositsTotal += delta;
      }
      this.belt = stepOreBelt(this.belt);
      const close = beltInvariants(this.belt, this.beltDepositsTotal);
      if (!close.ok) {
        throw new Error(`fullplant ore belt ledger broke at tick ${this.tick}: ${close.detail}`);
      }
    }
    // Quest evaluation rides the authoritative slice state right after each step — same
    // pattern as hub/main.tsx (all level_1 criteria are slice1-scoped). Reads slice1 state
    // directly: q1 completes on the very tick slice1's engine starts, so this must not
    // depend on the loop having stepped in THIS call.
    const completed: string[] = [];
    const s1 = this.stateOf('slice1') as Record<string, any> | undefined;
    if (s1) {
      const evs = (s1.events ?? []).map((e: any) => ({ tick: this.tick, event: typeof e === 'string' ? e : e?.event ?? JSON.stringify(e) }));
      completed.push(...this.tracker.update({ tick: this.tick, state: s1, events: evs }));
    }
    for (const id of completed) {
      const def = this.tracker.definition(id);
      this.events.push({ tick: this.tick, slice: def?.slice ?? '?', event: `quest_done:${id}` });
      const nextSlice = QUEST_COMMISSION[id];
      if (nextSlice) this.unlockSlice(nextSlice); // quest-scripted commissioning
    }
    return completed;
  }

  stateOf(slice: string): unknown {
    return this.slices[slice]?.loop?.state;
  }

  questProgress(): QuestProgressMap {
    return this.tracker.snapshotProgress();
  }

  balanceCheck(slice: string): BalanceCheckResult | null {
    const rt = this.slices[slice];
    return rt?.entry && rt.loop ? this.registry.check(rt.entry.id, rt.loop.state) : null;
  }

  /** Live inspection card for a zone (two-tier tap contract clause 4). Pure projection —
   *  never mutates sim state. slice2/slice3 have no zone-level projector yet (pending). */
  cardFor(slice: string): { slot_id: string; title: string; lines: string[]; tone: 'busy' | 'idle' | 'waiting' } | null {
    const key = INSPECT_KEY[slice];
    if (!key) return null;
    const st = this.stateOf(slice);
    if (!st) return null;
    const slot = { id: `${slice}.zone`, inspect_key: key } as any;
    if (slice === 'slice1') return inspectSlice1Slot(slot, st as any);
    if (slice === 'slice3') return inspectSlice3Slot(slot, st as any);
    if (slice === 'slice4') return inspectSlice4Slot(slot, st as any);
    if (slice === 'slice5') return inspectSlice5Slot(slot, st as any);
    return null;
  }

  // ---------- S0.5 persistence v2: fullplant save/restore ----------

  /** Storage adapter. `window` is checked at construction so the class stays importable
   *  in headless vitest (node env, no DOM); tests inject MemorySaveStorage via
   *  setSaveStorage before any read/write touches it. */
  private storage: SaveStorage =
    typeof window !== 'undefined' && window.localStorage
      ? new LocalStorageSaveStorage(window.localStorage)
      : { read: () => null, write: () => { throw new Error('no storage backend in this environment'); }, remove: () => {} };
  private autosaveCounter = 0;

  /** Test seam: swap the persistence backend (MemorySaveStorage in vitest). */
  setSaveStorage(storage: SaveStorage): void { this.storage = storage; }

  /** JSON-plain snapshot of the whole session (mirrors the approved step-1 structure):
   *  one SliceSnapshot per RUNNING engine (locked slices are re-derivable from onboarding
   *  data, so they stay out of the file), quest rows, and the full onboarding block. */
  snapshot(): { slices: Record<string, SliceSnapshot>; quest_progress: QuestProgressMap; onboarding: OnboardingSnapshot } {
    const slices: Record<string, SliceSnapshot> = {};
    for (const [slice, rt] of Object.entries(this.slices)) {
      if (!rt.loop || !this.engineRunning(slice)) continue; // locked => state re-derivable
      const st = rt.loop.state as Record<string, any>;
      slices[slice] = { state: structuredClone(st), rng_state: captureRng(st) };
    }
    const onboarding: OnboardingSnapshot = {
      index: this.onboard.index,
      built: [...this.onboard.built],
      clockRunning: this.onboard.clockRunning,
      questProgressSnapshot: (this.onboard.questProgressSnapshot
        ? structuredClone(this.onboard.questProgressSnapshot) : null) as any,
    };
    // S1.2 belt chain snapshot (absent = no belt built yet; restore validates + re-gates it).
    const oreBelt = this.belt
      ? { state: structuredClone(this.belt), deposits_total: this.beltDepositsTotal }
      : undefined;
    return { slices, quest_progress: this.questProgress(), onboarding, ...(oreBelt ? { ore_belt: oreBelt } : {}) };
  }

  /** Write the fullplant autosave (steelx-fullplant-save key). Silently false when no
   *  slice1 engine runs yet (fresh pre-jetty game — nothing worth persisting) or when
   *  storage throws (quota / private mode); a failed autosave must never crash the game. */
  autosave(slot = 'main'): boolean {
    const snap = this.snapshot();
    if (!snap.slices['slice1']) return false; // writeFullplantSave needs the slice1 mirror
    try {
      writeFullplantSave(this.storage, slot, snap.slices, {
        questProgress: snap.quest_progress,
        onboarding: snap.onboarding,
        oreBelt: (snap as any).ore_belt ?? null,
      });
      return true;
    } catch {
      return false;
    }
  }

  /** Restore a fullplant save into THIS session (engines already constructed by the ctor).
   *  Order matters: quest rows first (unlock derivation reads them), then onboarding data,
   *  then engine states. Unlocks are re-derived from data — never trusted from the file. */
  restoreFrom(save: { slices: Record<string, SliceSnapshot>; quest_progress: QuestProgressMap; onboarding: OnboardingSnapshot }): void {
    this.tracker.restoreProgress(save.quest_progress);
    // Plant clock rides the save's top-level mirror tick (GameSave.tick, cross-checked
    // against slices.slice1.state.tick by the loader). Quest windows are absolute ticks,
    // so session.tick MUST resume — a restored session that restarted at 0 would re-open
    // quest windows in the past and break determinism.
    if (typeof (save as any).tick === 'number') this.tick = (save as any).tick;
    this.onboard = {
      index: save.onboarding.index,
      built: [...save.onboarding.built],
      clockRunning: save.onboarding.clockRunning,
      ...(save.onboarding.questProgressSnapshot
        ? { questProgressSnapshot: structuredClone(save.onboarding.questProgressSnapshot) } : {}),
    };
    // S1.2 belt chain: absent block = fresh belt; a carried block already passed the
    // ledger gate in validateOreBeltBlock (loader call site). prevSliceArrivedT seeds from
    // the restored slice1 mirror so the first ticked delta is correct.
    const beltBlock = validateOreBeltBlock((save as any).ore_belt);
    this.belt = beltBlock ? beltBlock.state : null;
    this.beltDepositsTotal = beltBlock ? beltBlock.deposits : 0.0;
    for (const [slice, snap] of Object.entries(save.slices)) {
      const rt = this.slices[slice];
      if (!rt || !rt.loop) continue; // engine-less slice in a save => corrupt file (loader already rejects)
      const chk = rt.loop.resume(structuredClone(snap.state));
      if (!chk.ok) throw new Error(`fullplant restore broke ledger on ${slice}: ${chk.detail}`);
    }
    const restoredS1 = this.stateOf('slice1') as Record<string, any> | undefined;
    this.prevSliceArrivedT = typeof restoredS1?.arrived_t === 'number' ? restoredS1.arrived_t : 0.0;
    this.recomputeUnlocks();
  }

  /** Boot helper: load the fullplant save from storage into this session.
   *  Returns true when a valid v2 save was restored (UI resumes mid-game), false when no
   *  save exists / it's corrupt or an old schema (fresh game) — never throws. */
  tryRestore(slot = 'main'): boolean {
    const ctx = {
      knownSliceIds: Object.keys(this.slices),
      seqSteps: this.seqSteps.map((s) => String(s.step)),
      validate: (sliceId: string, state: any) => {
        const rt = this.slices[sliceId];
        if (!rt?.entry || !rt.loop) throw new Error(`save references slice '${sliceId}' with no engine here`);
        const chk = this.registry.check(sliceId, state);
        if (!chk.ok) throw new Error(`save state fails ledger check on ${sliceId}: ${chk.detail}`);
      },
    };
    let save;
    try {
      save = loadFullplantSave(this.storage, slot, ctx);
    } catch {
      return false; // missing / corrupt / schema-mismatched => fresh game (reject-never-default)
    }
    this.restoreFrom(save as any);
    return true;
  }

  /** Autosave cadence hook, called by the tick pump after each plant step: every 32 ticks. */
  noteTickForAutosave(): void {
    this.autosaveCounter += 1;
    if (this.autosaveCounter % 32 === 0) this.autosave();
  }

  /** Replay a Decide verb onto the live slice1 engine (restore of the decision log / player
   *  actions). The engine's decide_* functions stay the only mutators; rejections re-reject. */
  applyDecisionToSlice1(verb: DecisionRow['verb'], target: string, arg?: number): void {
    const st = this.stateOf('slice1') as any;
    if (!st) return;
    applyDecision(st, verb, target, arg);
  }

  /** Drive the guided sequence to completion (test/boot helper): confirm every 'build' step
   *  and dismiss every card/resume step until the flow ends or parks. */
  runGuidedSequence(): void {
    for (let guard = 0; guard < this.seqSteps.length + 2; guard++) {
      const step = currentStep(this.seqSteps, this.onboard);
      if (!step) return; // index -1: flow finished
      if (step.type === 'build') this.confirmBuild();
      else if (step.type === 'card' || step.type === 'resume') this.dismissCard();
      else return; // parked on park/milestone — live sim state must carry us past it
    }
  }
}
