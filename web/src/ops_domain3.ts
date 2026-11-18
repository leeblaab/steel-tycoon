// Phase 2 TS core — Domain 3 operations tick, 1:1 with mirror/operations_domain3_mirror.py.
// Contracts enforced (Phase2_UI_Plan §2):
//  - Pure tick: (state, actions, rng_state) -> new_state; the input state is NEVER mutated.
//  - Generator state lives INSIDE the simulation state (one uint32 word).
//  - Tick order + cadence boundary reproduced EXACTLY: day += 1 happens BEFORE the
//    berth stages; berth arrivals fire on day % 24 == 0. Not "fixed".
//  - Draw contract: exactly one draw per asset per tick, in fixed asset order
//    ['eaf','drp','cc','bar_mill','wire_rod_mill','crane'], for every asset (down or
//    running). Injection fires but still consumes the draw — test-only seam.
// Config read from the SAME content JSON as the mirror (reject, never default).
// Validation lives in ops_config.ts (browser-safe, no node:fs); re-exported here
// so tests and the fs loader keep the same single loader. node:fs is used ONLY
// by loadConfigFromFile below (test/node path), never by the browser bundle.

import { loadOpsConfig, type OpsConfig } from './ops_config.js';
export { loadOpsConfig, type OpsConfig };

export const ASSET_ORDER = ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane'] as const;
export type Asset = typeof ASSET_ORDER[number];

export interface Ship { id: string; on_board_t: number; wait_days: number }
export interface MaintQueueItem { asset: Asset; start_day: number }
export interface SparePipelineItem { asset: Asset; arrival_day: number }

export interface OpsState {
  day: number;
  morale: number;
  generator_state: number;            // PRNG state INSIDE the sim state (uint32, never 0)
  running: Record<string, boolean>;   // Step B idle: false = player-stopped asset
  maintenance_queue: MaintQueueItem[]; // queued preventive maintenance (Decide verb)
  spares_pipeline: SparePipelineItem[]; // in-transit ordered spares (Decide verb)
  overtime_until_day: number;         // overtime active while day < until (0 = none)
  recovery_until_day: number;         // fatigue tail after overtime ends
  decisions_made: number;             // KPI: player Decide actions applied
  pm_down: Record<string, boolean>;   // asset -> true while a PM outage counts down
  operating_hours: Record<string, number>;
  down: Record<string, number>;
  spares: Record<string, number>;
  breakdowns: number;
  planned_outages: number;
  repair_hours_total: number;
  wages_usd: number;
  demurrage_usd: number;
  crane_busy_ticks: number;
  crane_total_ticks: number;
  produced_t: number;
  buffered_t: number;
  yard_stock_t: number;
  dispatched_t: number;
  arrived_t: number;
  upstream_blocked_t: number;
  restricted_streak: number;
  congestion_flag: boolean;
  berth_ships: Ship[];
  ships_arrived: number;
  ships_departed: number;
  unload_blocked_t: number;
  berth_blocked_t: number;
  berth_wait_ship_days: number;
  berth_wait_ship_days_beyond_free: number;
}

export interface Action { tick: number; type: 'inject'; asset: Asset }

// ---- Config: same JSON file as the mirror, validated reject-never-default ----
// (validation implementation moved to ops_config.ts — browser-safe; re-exported
// above. The definitions below are removed to keep ONE loader implementation.)

export function freshState(seed: number, cfg: OpsConfig): OpsState {
  const g = seed >>> 0;
  if (g === 0) throw new Error('zero generator state rejected (xorshift32 is degenerate at 0)');
  const st: OpsState = {
    day: 0, morale: 70.0, generator_state: g,
    running: {}, maintenance_queue: [], spares_pipeline: [],
    overtime_until_day: 0.0, recovery_until_day: 0.0, decisions_made: 0, pm_down: {},
    operating_hours: {}, down: {}, spares: {},
    breakdowns: 0, planned_outages: 0, repair_hours_total: 0.0,
    wages_usd: 0.0, demurrage_usd: 0.0,
    crane_busy_ticks: 0, crane_total_ticks: 0,
    produced_t: 0.0, buffered_t: 0.0,
    yard_stock_t: 0.0, dispatched_t: 0.0, arrived_t: 0.0,
    upstream_blocked_t: 0.0, restricted_streak: 0, congestion_flag: false,
    berth_ships: [], ships_arrived: 0, ships_departed: 0,
    unload_blocked_t: 0.0, berth_blocked_t: 0.0,
    berth_wait_ship_days: 0.0, berth_wait_ship_days_beyond_free: 0.0,
  };
  for (const a of ASSET_ORDER) { st.operating_hours[a] = 0.0; st.spares[a] = 0; st.running[a] = true; }
  return st;
}

function draw(state: number): { newState: number; draw: number } {
  let x = state >>> 0;
  if (x === 0) throw new Error('zero generator state reached — contract violation');
  x ^= (x << 13) >>> 0;
  x ^= x >>> 17;
  x ^= (x << 5) >>> 0;
  x = x >>> 0;
  return { newState: x, draw: x / 0xFFFFFFFF };
}

function moraleMult(st: OpsState, cfg: OpsConfig): number {
  // Step B overtime/fatigue bands (spec Q5), 1:1 with the mirror's morale_mult():
  // thresholds ascending == multiplier descending (best .. worst). No window
  // active -> identical to the frozen pre-Decide behavior.
  const bands = cfg.morale_bands; // sorted desc by threshold (= ascending worst-ward)
  let bandIdx = bands.length - 1; // index in `bands` of the current band
  for (let i = 0; i < bands.length; i++) if (st.morale >= bands[i].threshold) { bandIdx = i; break; }
  // Mirror's ascending-threshold index == descending order here (exact reverse for
  // n=3: asc k -> desc n-1-k), so +1/-1 on the mirror idx maps to -1/+1 below.
  const dayActiveOt = st.overtime_until_day > st.day && st.day > 0 && st.morale >= 50;
  const dayActiveRec = st.recovery_until_day > st.day && st.day > 0;
  if (dayActiveOt) {
    // overtime penalty: shift one band WORSE (lower multiplier = higher failure rate)
    bandIdx = Math.max(bandIdx - 1, 0);
  } else if (dayActiveRec) {
    // fatigue tail: closer to normal than the overtime band (mirror max(min(k,1),0)
    // on the ascending list -> max(min(descIdx, n-2), 0) here)
    bandIdx = Math.max(Math.min(bandIdx, bands.length - 2), 0);
  }
  return bands[bandIdx].mult;
}

// Draw-provider seam (mirrors the mirror's FixedDraws contract exactly):
// tickOps draws through a provider object, not the internal generator directly.
// PRODUCTION default = the canonical xorshift32 provider (unchanged behavior);
// a test-only provider may report a constructed draw while still advancing the
// generator state per the canonical spec — same contract as the Python mirror
// ("rng may be a random.Random OR any object with a .random() method").
export interface DrawProvider {
  random(): number;
}

export function xorshiftProvider(state: number): DrawProvider {
  let x = state >>> 0;
  return {
    random(): number {
      if (x === 0) throw new Error('zero generator state reached — contract violation');
      x ^= (x << 13) >>> 0;
      x ^= x >>> 17;
      x ^= (x << 5) >>> 0;
      x = x >>> 0;
      return x / 0xFFFFFFFF;
    }
  };
}

// PURE TICK — returns a NEW state; the input state is never mutated.
// Tick order reproduced exactly from the mirror/engine:
//   day += 1 (cadence boundary BEFORE berth stages) -> wages -> operating hours &
//   breakdowns (one draw per asset in fixed order) -> planned shutdown -> production
//   -> crane utilization -> berth arrive (day % 24 == 0) -> berth wait -> berth
//   unload/depart -> dispatch chain.
export function tickOps(input: OpsState, cfg: OpsConfig, actions: Action[] = [], tickNo?: number, rng?: DrawProvider): OpsState {
  const st: OpsState = structuredClone(input);
  const inject = new Set<Asset>(actions.filter(a => a.type === 'inject' && a.tick === tickNo).map(a => a.asset));

  st.day += 1; // cadence boundary: day increment happens BEFORE the berth stages

  // Step B pre-tick decision stages (mirror order: day advances -> queued PM
  // outage starts -> in-transit spares arrive).
  for (const q of st.maintenance_queue.filter(q => q.start_day === st.day)) {
    st.maintenance_queue.splice(st.maintenance_queue.indexOf(q), 1);
    if (!(q.asset in st.down)) {
      st.planned_outages += 1;
      st.down[q.asset] = cfg.decide.pm_duration_days * 24.0;
      st.pm_down[q.asset] = true;
    }
  }
  for (const p of st.spares_pipeline.filter(p => p.arrival_day <= st.day)) {
    st.spares_pipeline.splice(st.spares_pipeline.indexOf(p), 1);
    st.spares[p.asset] = Math.min(st.spares[p.asset] + 1, cfg.decide.max_spares_per_asset);
  }

  // wages accrue for staffed assets that are not down (idle keeps payroll — Q1)
  for (const a of ASSET_ORDER) {
    if (!(a in st.down)) st.wages_usd += cfg.headcount[a] * cfg.wage_per_person_day;
  }

  for (const a of ASSET_ORDER) {
    const r = draw(st.generator_state);           // generator step always consumed — contract preserved
    st.generator_state = r.newState;
    // Production default: the generator's own draw. Test seam: a provider reports a
    // constructed draw, but the generator step is still consumed (same contract as
    // the mirror's FixedDraws — the state advances per the canonical spec).
    const d = rng ? rng.random() : r.draw;
    let fires = d < (1.0 / cfg.mtbf[a] * moraleMult(st, cfg));
    if (inject.has(a)) fires = true;              // injection fires but still consumed the draw
    if (a in st.down) {
      st.down[a] -= 24.0;
      if (st.down[a] <= 0.0) {
        delete st.down[a];
        if (st.pm_down[a]) {
          delete st.pm_down[a];
          // spec Q3 wear-clock rule: a completed preventive maintenance resets the
          // asset's wear clock; reactive repairs never do.
          st.operating_hours[a] = 0.0;
        }
      }
      continue;
    }
    if (!st.running[a]) {
      // Step B idle (spec Q1): stopped asset consumes no operating hours and cannot
      // fail this tick — RNG draw above is still consumed so the one-draw-per-asset
      // contract stays byte-stable.
      continue;
    }
    st.operating_hours[a] += 24.0;
    if (fires) {
      st.breakdowns += 1;
      let repair = cfg.mttr[a];
      if (st.spares[a] > 0) st.spares[a] -= 1;
      else repair += cfg.spare_delivery_days * 24.0;
      st.down[a] = repair;
      st.repair_hours_total += repair;
    }
  }

  if (st.day % Math.trunc(cfg.planned_every_days) === 0) {
    st.planned_outages += 1;
    if (!('drp' in st.down)) st.down['drp'] = cfg.planned_days * 24.0;
  }

  for (const a of ASSET_ORDER) {
    if (!(a in st.down)) {
      // idle (stopped) assets neither produce nor buffer (spec Q1)
      if (st.running[a]) st.produced_t += 100.0;
    } else st.buffered_t += 100.0;
  }

  st.crane_total_ticks += 1;
  if (!('crane' in st.down)) st.crane_busy_ticks += 1;

  // Berth stages (reproduced exactly; no RNG draws — contract untouched).
  if (st.day % 24 === 0) {
    const arrivals = Math.trunc(cfg.berth.arrival_ships_per_day);
    const accepted = Math.min(arrivals, cfg.berth.capacity - st.berth_ships.length);
    for (let i = 0; i < accepted; i++) {
      st.berth_ships.push({ id: `S${st.ships_arrived + i + 1}`, on_board_t: cfg.ship_cargo_t, wait_days: 0.0 });
    }
    st.ships_arrived += accepted;
    st.berth_blocked_t += arrivals - accepted;
  }
  for (const s of st.berth_ships) {
    const before = Math.max(0.0, s.wait_days - cfg.demurrage_free_days);
    s.wait_days += 1.0 / 24.0;
    st.berth_wait_ship_days += 1.0 / 24.0;
    const beyond = Math.max(0.0, s.wait_days - cfg.demurrage_free_days);
    if (beyond > 0) st.demurrage_usd += cfg.demurrage_per_day / 24.0;
    st.berth_wait_ship_days_beyond_free += beyond - before;
  }
  if (st.berth_ships.length > 0) {
    const head = st.berth_ships[0];
    const room = cfg.dispatch.yard_capacity_t - st.yard_stock_t;
    const want = Math.min(head.on_board_t, cfg.berth.unload_t_per_day / 24.0);
    const acceptedT = Math.min(want, room);
    st.unload_blocked_t += want - acceptedT;
    head.on_board_t -= acceptedT;
    st.yard_stock_t += acceptedT;
    st.arrived_t += acceptedT;
    if (head.on_board_t <= 1e-9) {
      st.berth_ships.shift();
      st.ships_departed += 1;
    }
  }

  // Dispatch chain (crane -> dispatch -> yard -> upstream).
  const dispatchCap = ('crane' in st.down) ? 0.0 : cfg.dispatch.effective_tph;
  const room = cfg.dispatch.yard_capacity_t - st.yard_stock_t;
  const arrivedThisTick = Math.min(cfg.dispatch.arrival_t_per_tick, room);
  const restricted = arrivedThisTick < cfg.dispatch.arrival_t_per_tick;
  st.arrived_t += arrivedThisTick;
  st.upstream_blocked_t += cfg.dispatch.arrival_t_per_tick - arrivedThisTick;
  st.restricted_streak = restricted ? st.restricted_streak + 1 : 0;
  if (st.restricted_streak >= cfg.dispatch.congestion_ticks) st.congestion_flag = true;
  st.yard_stock_t += arrivedThisTick;
  const dispatched = Math.min(st.yard_stock_t, dispatchCap);
  st.yard_stock_t -= dispatched;
  st.dispatched_t += dispatched;

  return st;
}

// Sandbox boundary: hypothetical run = tick on a COPY, report the delta, never touch
// the real state. The real state is provably unchanged (pure tick + explicit clone).
export function sandboxRun(realState: OpsState, cfg: OpsConfig, ticks: number, actions: Action[] = []): { sandbox: OpsState; realAfter: OpsState } {
  const snapshot = structuredClone(realState);
  let sandbox = structuredClone(realState);
  for (let t = 1; t <= ticks; t++) sandbox = tickOps(sandbox, cfg, actions, t);
  if (JSON.stringify(realState) !== JSON.stringify(snapshot))
    throw new Error('sandbox isolation violated: real state mutated');
  return { sandbox, realAfter: realState };
}

// Node-only loader for tests/fixtures (kept as the fs path; the browser bundle
// imports ops_config.ts directly and never reaches this function).
export function loadConfigFromFile(path: string): OpsConfig {
  return loadOpsConfig(JSON.parse(require('node:fs').readFileSync(path, 'utf-8')));
}

// ---- Step B decide verbs (Yasser GO 2026-10-20; docs/stepB_semantics_v1.md) ----
// Player actions mutate state through these functions ONLY — same discipline as
// the route ledger: semantics live in the engine, validation here, human-readable
// rejection feedback for every refusal.

export interface DecideResult { ok: boolean; message: string }

function isFiniteNumber(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v); }

export function decideStop(st: OpsState, asset: string): DecideResult {
  if (!ASSET_ORDER.includes(asset as Asset)) return { ok: false, message: `unknown asset '${asset}'` };
  if (asset in st.down) return { ok: false, message: `${asset} is already down for repair — nothing to stop` };
  if (!st.running[asset]) return { ok: false, message: `${asset} is already stopped` };
  st.running[asset] = false;
  st.decisions_made += 1;
  return { ok: true, message: `${asset} stopped — idle until you start it again (payroll continues)` };
}

export function decideStart(st: OpsState, asset: string): DecideResult {
  if (!ASSET_ORDER.includes(asset as Asset)) return { ok: false, message: `unknown asset '${asset}'` };
  if (asset in st.down) return { ok: false, message: `${asset} is down for repair — it restarts automatically when the repair finishes` };
  if (st.running[asset]) return { ok: false, message: `${asset} is already running` };
  st.running[asset] = true;
  st.decisions_made += 1;
  return { ok: true, message: `${asset} restarted — production resumes next tick` };
}

export function decideScheduleMaintenance(st: OpsState, asset: string, startDay: number): DecideResult {
  if (!ASSET_ORDER.includes(asset as Asset)) return { ok: false, message: `unknown asset '${asset}'` };
  if (asset in st.down) return { ok: false, message: `${asset} is already down for repair — maintenance cannot be scheduled on a broken asset` };
  if (st.maintenance_queue.some(q => q.asset === asset)) return { ok: false, message: `${asset} already has maintenance queued` };
  if (!isFiniteNumber(startDay) || startDay <= st.day) return { ok: false, message: `maintenance start day must be in the future (today is day ${st.day.toFixed(0)})` };
  st.maintenance_queue.push({ asset: asset as Asset, start_day: startDay });
  st.decisions_made += 1;
  return { ok: true, message: `preventive maintenance queued for ${asset} on day ${startDay.toFixed(0)} (outage queued)` };
}

export function decideCancelMaintenance(st: OpsState, asset: string): DecideResult {
  const i = st.maintenance_queue.findIndex(q => q.asset === asset);
  if (i < 0) return { ok: false, message: `no queued maintenance for ${asset} to cancel` };
  st.maintenance_queue.splice(i, 1);
  return { ok: true, message: `queued maintenance for ${asset} cancelled` };
}

export function decideOrderSpare(st: OpsState, asset: string, cfg: OpsConfig): DecideResult {
  if (!ASSET_ORDER.includes(asset as Asset)) return { ok: false, message: `unknown asset '${asset}'` };
  const pipeline = st.spares_pipeline.filter(p => p.asset === asset).length;
  if (st.spares[asset] + pipeline >= cfg.decide.max_spares_per_asset)
    return { ok: false, message: `${asset} already has ${st.spares[asset]} spare(s) in stock and ${pipeline} in transit — limit is ${cfg.decide.max_spares_per_asset} per asset` };
  st.spares_pipeline.push({ asset: asset as Asset, arrival_day: st.day + cfg.spare_delivery_days });
  st.decisions_made += 1;
  return { ok: true, message: `spare ordered for ${asset} — arrives day ${(st.day + cfg.spare_delivery_days).toFixed(0)} (${cfg.spare_delivery_days.toFixed(0)}-day lead)` };
}

export function decideOvertime(st: OpsState, days: number, cfg: OpsConfig): DecideResult {
  if (!isFiniteNumber(days) || days <= 0) return { ok: false, message: 'overtime duration must be a positive number of days' };
  if (days > cfg.decide.overtime_max_days) return { ok: false, message: `overtime is capped at ${cfg.decide.overtime_max_days} days per call` };
  if (st.day < st.recovery_until_day) return { ok: false, message: `crew is recovering from overtime until day ${st.recovery_until_day.toFixed(0)} — stacking refused` };
  st.overtime_until_day = st.day + days;
  st.recovery_until_day = st.overtime_until_day + days; // equal-length fatigue tail
  st.decisions_made += 1;
  return { ok: true, message: `overtime for ${days.toFixed(0)} days — breakdown risk up now, fatigue tail after day ${st.overtime_until_day.toFixed(0)}` };
}
