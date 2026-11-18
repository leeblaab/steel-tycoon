// Slice 1 hub port (Phase 1 deferred item #1, wired per Phase-1 report recommendation):
// the parity port `slice1_berth_yard.ts` stays untouched; this module wraps the ops
// engine (`ops_domain3.ts`) into the hub's HubTickLoop state shape — { tick, events }
// plus the full OpsState verbatim (JSON-plain, generator word inside as
// `generator_state`, so save/load v1 resume is deterministic like every other slice).
//
// Scenario seam: dispatch cap override after interventionTick + fixed 0.5 draws are
// TEST seams from the parity port; the hub plays the live scenario — content config
// cadence values, real per-tick xorshift32 draws via the engine's production provider
// (word carried in state), no interventions until quest actions land in Phase 2.

import { freshState, tickOps, loadOpsConfig, xorshiftProvider, type OpsState, type OpsConfig } from '../../ops_domain3.ts';
import opsDoc from '../../../../content/operations/operations_domain3.json';

export const SLICE1_HUB_SEED = 11; // same seed as the parity scenario (fixture seed)

/** Hub-facing slice1 state: tick/events for the loop contract + OpsState verbatim. */
export interface Slice1HubState extends OpsState {
  tick: number;
  events: Array<{ tick: number; event: string }>;
}

export function freshSlice1HubState(seed = SLICE1_HUB_SEED): Slice1HubState {
  return { ...freshState(seed, loadOpsConfig(opsDoc)), tick: 0, events: [] };
}

/** Advance exactly one logical tick through the untouched ops engine. */
export function advanceSlice1HubState(prev: Slice1HubState): Slice1HubState {
  const cfg = loadOpsConfig(opsDoc);
  // Production provider: canonical xorshift32 continuation from the word inside state.
  const rng = xorshiftProvider(prev.generator_state);
  const tickNo = prev.tick + 1;
  const ops = tickOps(prev, cfg, [], tickNo, rng);

  // Event detection mirrors slice1_berth_yard.ts runSlice1 (arrival / berth_refusal /
  // congestion rising-edge / depart), same event names for the hub log.
  const events: Array<{ tick: number; event: string }> = [];
  if (ops.berth_ships.length > prev.berth_ships.length) events.push({ tick: tickNo, event: 'arrival' });
  if (ops.berth_blocked_t > prev.berth_blocked_t) events.push({ tick: tickNo, event: 'berth_refusal' });
  if (ops.congestion_flag && !prev.congestion_flag) events.push({ tick: tickNo, event: 'congestion' });
  if (ops.berth_ships.length === 0 && prev.berth_ships.length === 1) events.push({ tick: tickNo, event: 'depart' });

  return { ...ops, tick: tickNo, events };
}

/** Deterministic continuation proof: n ticks from a fresh state land on the same state
 * as n sequential advances (the save/load v1 guarantee, slice3-style). */
export function runSlice1HubTicks(n: number, seed = SLICE1_HUB_SEED): Slice1HubState {
  let st = freshSlice1HubState(seed);
  for (let t = 0; t < n; t++) st = advanceSlice1HubState(st);
  return st;
}

export type { OpsConfig };
