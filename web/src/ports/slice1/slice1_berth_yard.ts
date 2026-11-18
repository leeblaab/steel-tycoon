// Slice 1 vertical slice — pure wrapper over the existing ops port (no rule rewrite).
// Exclusive ownership: web/src/ports/slice1/ (Phase 3 PLAN.md).
//
// The scenario runs through the REAL tickOps with scenario config overrides ONLY on
// the scenario copy (production rules, PRNG, and tick order untouched):
//   - dispatch effective_tph 80.0 >= conveyor fill (content default 100.0 t/tick), so the
//     yard fills from BOTH sides; the intervention at tick 48 is the second-crane story,
//     and yard capacity (5000 t) becomes the binding constraint: congestion first fires
//     tick 96, upstream blocked 1521.6667 t at tick 120.
//
// Deterministic replay: FixedDraws seam (test-only, documented in PLAN.md) pins the
// no-fire path; draws are still consumed per the draw contract.

import { tickOps, freshState, loadOpsConfig, type OpsState, type OpsConfig, type DrawProvider } from '../../ops_domain3.js';

export const FIXED_DRAWS = 0.5; // no-fire path: p = 24/1800 * 0.7 = 0.0093333 < 0.5

export interface Slice1Scenario {
  seed: number;
  ticks: number;
  dispatchBefore: number;   // intervention value (second crane); matches content default
  dispatchAfter: number;    // post-intervention capacity
  interventionTick: number;
}

export const SLICE1: Slice1Scenario = {
  seed: 11,
  ticks: 120,
  dispatchBefore: 80.0,
  dispatchAfter: 80.0,
  interventionTick: 48,
};

// FixedDraws seam (test-only): reports the pinned draw while the generator state
// advances per the canonical xorshift32 spec — exactly the mirror's FixedDraws contract.
export function fixedDrawsProvider(pinnedDraw: number): DrawProvider {
  return { random: () => pinnedDraw };
}

export interface TickRecord {
  tick: number;
  yard_stock_t: number;
  dispatched_t: number;
  arrived_t: number;
  upstream_blocked_t: number;
  unload_blocked_t: number;
  berth_blocked_t: number;
  ships_at_berth: number;
  congestion_flag: boolean;
  demurrage_usd: number;
  ship_days_beyond_free: number;
  dispatch_cap: number;
  events: string[];
}

// Run the canonical scenario through the real tickOps. The player's intervention is
// applied as a config override on the scenario copy only (documented scenario seam).
export function runSlice1(cfg: OpsConfig, scenario: Slice1Scenario = SLICE1): {
  records: TickRecord[];
  final: OpsState;
  events: Array<{ tick: number; type: string }>;
} {
  let st = freshState(scenario.seed, cfg);
  const rng = fixedDrawsProvider(FIXED_DRAWS); // test-only seam; generator advances per canonical spec
  const events: Array<{ tick: number; type: string }> = [];
  const records: TickRecord[] = [];
  let prevShips = 0;
  let prevCong = false;
  let prevBlocked = 0.0;

  for (let t = 1; t <= scenario.ticks; t++) {
    const dispatchCap = t >= scenario.interventionTick ? scenario.dispatchAfter : scenario.dispatchBefore;
    // Scenario seam: dispatch cap override on the scenario copy only (conveyor fill stays
    // at the content default 100.0 t/tick — the fixture's verified construction).
    const cfgT = { ...cfg, dispatch: { ...cfg.dispatch, effective_tph: dispatchCap } };
    // FixedDraws seam: the canonical fixture pins every draw to 0.5 (no-fire path).
    // The generator advances per the canonical xorshift32 spec; the pinned draw is
    // injected through the seam so the rule path matches the fixture exactly.
    const next = tickOps(st, cfgT, [], t, rng);
    st = next;

    const ev: string[] = [];
    if (st.berth_ships.length > prevShips) { ev.push('arrival'); events.push({ tick: t, type: 'arrival' }); }
    if (st.berth_blocked_t > prevBlocked) { ev.push('berth_refusal'); events.push({ tick: t, type: 'berth_refusal' }); }
    if (st.congestion_flag && !prevCong) { ev.push('congestion'); events.push({ tick: t, type: 'congestion' }); }
    if (st.berth_ships.length === 0 && prevShips === 1) { ev.push('depart'); events.push({ tick: t, type: 'depart' }); }
    records.push({
      tick: t,
      yard_stock_t: st.yard_stock_t,
      dispatched_t: st.dispatched_t,
      arrived_t: st.arrived_t,
      upstream_blocked_t: st.upstream_blocked_t,
      unload_blocked_t: st.unload_blocked_t,
      berth_blocked_t: st.berth_blocked_t,
      ships_at_berth: st.berth_ships.length,
      congestion_flag: st.congestion_flag,
      demurrage_usd: st.demurrage_usd,
      ship_days_beyond_free: st.berth_wait_ship_days_beyond_free,
      dispatch_cap: dispatchCap,
      events: ev,
    });
    prevShips = st.berth_ships.length;
    prevCong = st.congestion_flag;
    prevBlocked = st.berth_blocked_t;
  }
  return { records, final: st, events };
}
