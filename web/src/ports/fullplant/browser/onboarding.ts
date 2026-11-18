// SteelX onboarding engine (docs/gameplay.md §1.5 — guided first build, Slice 1 first).
// Pure logic, no rendering: the step flow is DATA (content/sequence/level1_draft.json),
// this module just walks it and answers "what step are we on / what completes it".
// Time rule (§1.5, Yasser 2026-10-26): sim clock frozen from game start until the jetty
// build completes; from then on it runs and equipment joins a live ticking plant.
// Fully guided: each step's equipment appears at its pre-defined footprint (no placement).

export type StepStatus = 'locked' | 'current' | 'done';

export interface SeqStep {
  step: number;
  type: 'card' | 'build' | 'milestone' | 'park' | 'resume';
  id?: string;          // card step: card id (park/resume steps carry no card)
  node_id?: string;     // build step: node id (matches sequence + nodes table)
  card_id?: string;     // build step: info card shown before the build
  note?: string;
  flag?: string;        // milestone step
}

export interface OnboardingState {
  index: number;          // -1 == finished (free play / quests)
  built: string[];        // node_ids confirmed-built
  clockRunning: boolean;  // frozen until the jetty is built
  /** Live quest-progress snapshot (GameSession refreshes each tick; park gate reads it). */
  questProgressSnapshot?: Record<string, { id: string; status: string }>;
}

/** Slice-1 build nodes (Slice-1 scope for now — later slices' steps stay locked). */
export const SLICE1_BUILD_NODES = ['jetty', 'scrap_yard', 'conv_ore_drp'];

/** All slice-1 build steps confirmed-built (park-gate half 1). */
export function slice1Done(st: OnboardingState): boolean {
  return SLICE1_BUILD_NODES.every((n) => st.built.includes(n));
}

export function loadSequence(seqDoc: any): SeqStep[] {
  const steps = seqDoc?.level1_sequence;
  if (!Array.isArray(steps) || steps.length === 0) throw new Error('onboarding: empty level1_sequence');
  return steps as SeqStep[];
}

export function initState(): OnboardingState {
  return { index: 0, built: [], clockRunning: false };
}

/** The current step definition, or null when the guided flow is finished. */
export function currentStep(steps: SeqStep[], st: OnboardingState): SeqStep | null {
  return st.index >= 0 && st.index < steps.length ? steps[st.index] : null;
}

export function statusOf(steps: SeqStep[], st: OnboardingState, i: number): StepStatus {
  if (st.index < 0 || i > steps.length) return 'locked';
  if (i < st.index) return 'done';
  if (i === st.index) return 'current';
  return 'locked';
}

/** Is this node built (or scheduled behind the Slice-1 scope)? Used by rendering. */
export function isBuilt(st: OnboardingState, nodeId: string): boolean {
  return st.built.includes(nodeId);
}

/** Advance past the current step. Card steps advance on dismiss; build steps advance on
 *  confirm-build (the reveal animation is cosmetic — state completes immediately).
 *  Returns true when the jetty completed (clock must start). */
export function advance(steps: SeqStep[], st: OnboardingState): boolean {
  const step = currentStep(steps, st);
  if (!step) return false;
  let jettyDone = false;
  if (step.type === 'build') {
    if (!step.node_id) throw new Error(`onboarding: build step ${step.step} has no node_id`);
    st.built.push(step.node_id);
    if (step.node_id === 'jetty' && !st.clockRunning) jettyDone = true;
  }
  // milestone steps are not completed by tapping — they complete via live sim state;
  // the flow parks on them (index stays) until checkExit() flips index to -1.
  st.index += 1;
  if (st.index >= steps.length) st.index = -1;
  if (jettyDone) st.clockRunning = true;
  return jettyDone;
}

/** Exit / park gate (§1.5, Yasser 2026-10-26 rule): the guided build STOPS at the end of
 *  slice 1. A 'park' step is left only when ALL slice-1 builds are done AND every main
 *  level-1 quest in the live snapshot is completed — Slice-2 building is triggered by
 *  slice-1 QUEST completion, never by tapping through forever. A 'milestone' step ends the
 *  flow (index -> -1) when its sim condition is met (ships arrived, material flowing). */
export function checkExit(steps: SeqStep[], st: OnboardingState, slice1State: any): boolean {
  const step = currentStep(steps, st);
  if (!step) return false;
  if (step.type === 'park') {
    if (!slice1Done(st)) return false;
    const prog = Object.values(st.questProgressSnapshot ?? {}).filter((p: any) => p && String(p.id).startsWith('l1_q'));
    return prog.length > 0 && prog.every((p: any) => p.status === 'completed');
  }
  if (step.type !== 'milestone') return false;
  if (!SLICE1_BUILD_NODES.every((n) => st.built.includes(n))) return false;
  const arrived = Number(slice1State?.arrived_t ?? 0);
  const ships = Number(slice1State?.ships_arrived ?? 0);
  return ships >= 1 && arrived > 0;
}
