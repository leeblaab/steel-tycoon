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
  tick = 0;
  speed: Speed = 'normal';
  /** Guided first build (docs/gameplay.md §1.5). Sequence is DATA (level1_draft.json). */
  readonly seqSteps: SeqStep[];
  onboard: OnboardingState = initState();

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
    return nodeId;
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
}
