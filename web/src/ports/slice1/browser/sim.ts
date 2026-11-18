// Browser-safe simulation seam for the playable Slice 1 app.
// Reuses the existing TS engine (tickOps + canonical config loader) — no rule rewrite,
// no hardcoded gameplay. The player's dispatch-capacity intervention is applied as a
// config override on the scenario copy, exactly as in slice1_berth_yard.ts.
//
// The node-only fs import in ops_domain3.ts is isolated here: sim.ts imports the
// validation from ops_config.ts (no node:fs), so the browser bundle never touches
// the fs loader. The config JSON is embedded as content (same file content as
// content/operations/operations_domain3.json), parsed through the SAME
// reject-never-default loader.

import { tickOps, freshState, type OpsState, type DrawProvider } from '../../../ops_domain3.js';
import { loadOpsConfig, type OpsConfig } from '../../../ops_config.js';

export const FIXED_DRAWS = 0.5; // no-fire path (same as slice1_berth_yard.ts)

export interface Slice1Scenario {
  seed: number;
  ticks: number;
  dispatchBefore: number;
  dispatchAfter: number;
  interventionTick: number;
}

export const SLICE1: Slice1Scenario = {
  seed: 11,
  ticks: 120,
  dispatchBefore: 40.0,
  dispatchAfter: 80.0,
  interventionTick: 48,
};

export function fixedDrawsProvider(pinnedDraw: number): DrawProvider {
  return { random: () => pinnedDraw };
}

export interface TickRecord {
  tick: number;
  day: number;
  yard_stock_t: number;
  yard_capacity_t: number;
  dispatched_t: number;
  arrived_t: number;
  arrived_this_tick_t: number;
  upstream_blocked_t: number;
  unload_blocked_t: number;
  berth_blocked_t: number;
  ships_at_berth: number;
  ship_on_board_t: number;
  congestion_flag: boolean;
  restricted_streak: number;
  demurrage_usd: number;
  dispatch_cap: number;
  events: string[];
}

// Same content as content/operations/operations_domain3.json (browser-safe copy;
// single source of truth remains the content JSON — this is a build-time embed).
export const OPS_CONFIG_JSON = {
  schema_version: 1,
  assets: [
    { id: 'eaf', mtbf_hours: 1800, mttr_hours: 6, headcount: 12 },
    { id: 'drp', mtbf_hours: 1800, mttr_hours: 6, headcount: 12 },
    { id: 'cc', mtbf_hours: 1800, mttr_hours: 6, headcount: 12 },
    { id: 'bar_mill', mtbf_hours: 1800, mttr_hours: 6, headcount: 12 },
    { id: 'wire_rod_mill', mtbf_hours: 1800, mttr_hours: 6, headcount: 12 },
    { id: 'crane', mtbf_hours: 1800, mttr_hours: 6, headcount: 12 },
  ],
  spares: { delivery_lead_days: 5 },
  planned_shutdown: { every_days: 30, duration_days: 1 },
  manpower: { wage_per_person_day: 200 },
  morale: { bands: [{ threshold: 70, breakdown_multiplier: 1.0 }] },
  demurrage: {
    free_days: 3.0,
    penalty_usd_per_day: 15000.0,
    berth_capacity: 1,
    arrival_ships_per_day: 1,
    unload_t_per_day: 1000.0,
    ship_cargo_t: 1000.0,
  },
  dispatch: {
    effective_tph: 80.0,
    arrival_t_per_tick: 100.0,
    yard_capacity_t: 5000.0,
    congestion_ticks: 3,
  },
};

export interface RunOptions {
  scenario?: Slice1Scenario;
  fixedDraws?: boolean; // canonical fixture path (pinned 0.5); false = real xorshift32
}

export interface RunResult {
  cfg: OpsConfig;
  records: TickRecord[];
  events: Array<{ tick: number; type: string }>;
}

// Runs the REAL tickOps tick by tick; records per-tick observables.
// Intervention = config override on the scenario copy only (documented seam).
export function runSlice1(opts: RunOptions = {}): RunResult {
  const scenario = opts.scenario ?? SLICE1;
  const cfg = loadOpsConfig(OPS_CONFIG_JSON);
  let st = freshState(scenario.seed, cfg);
  const rng = opts.fixedDraws === false ? undefined : fixedDrawsProvider(FIXED_DRAWS);
  const records: TickRecord[] = [];
  const events: Array<{ tick: number; type: string }> = [];
  let prevShips = 0, prevCong = false, prevBlocked = 0.0;

  for (let t = 1; t <= scenario.ticks; t++) {
    const dispatchCap = t >= scenario.interventionTick ? scenario.dispatchAfter : scenario.dispatchBefore;
    const cfgT = { ...cfg, dispatch: { ...cfg.dispatch, effective_tph: dispatchCap } };
    st = tickOps(st, cfgT, [], t, rng);

    const ev: string[] = [];
    if (st.berth_ships.length > prevShips) { ev.push('arrival'); events.push({ tick: t, type: 'arrival' }); }
    if (st.berth_blocked_t > prevBlocked) { ev.push('berth_refusal'); events.push({ tick: t, type: 'berth_refusal' }); }
    if (st.congestion_flag && !prevCong) { ev.push('congestion'); events.push({ tick: t, type: 'congestion' }); }
    if (st.berth_ships.length === 0 && prevShips === 1) { ev.push('depart'); events.push({ tick: t, type: 'depart' }); }

    records.push({
      tick: t,
      day: st.day,
      yard_stock_t: st.yard_stock_t,
      yard_capacity_t: cfg.dispatch.yard_capacity_t,
      dispatched_t: st.dispatched_t,
      arrived_t: st.arrived_t,
      arrived_this_tick_t: Math.min(cfg.dispatch.arrival_t_per_tick, Math.max(0, cfg.dispatch.yard_capacity_t - (st.yard_stock_t - Math.min(st.yard_stock_t, dispatchCap)))),
      upstream_blocked_t: st.upstream_blocked_t,
      unload_blocked_t: st.unload_blocked_t,
      berth_blocked_t: st.berth_blocked_t,
      ships_at_berth: st.berth_ships.length,
      ship_on_board_t: st.berth_ships.length > 0 ? st.berth_ships[0].on_board_t : 0,
      congestion_flag: st.congestion_flag,
      restricted_streak: st.restricted_streak,
      demurrage_usd: st.demurrage_usd,
      dispatch_cap: dispatchCap,
      events: ev,
    });
    prevShips = st.berth_ships.length;
    prevCong = st.congestion_flag;
    prevBlocked = st.berth_blocked_t;
  }
  return { cfg, records, events };
}
