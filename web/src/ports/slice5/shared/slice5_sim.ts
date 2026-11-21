// Slice 5 shared parity port — billet yard -> rebar mill (one active branch) -> product yard -> dispatch (v1)
// Line-level TypeScript port of mirror/slice5_mirror.py (373 lines). The Python mirror is the
// single source of truth (mirror-first workflow); this port reproduces it 1:1: same state shape,
// same tick stage order 1-6, same event strings, same counters, same validate_scenario raises,
// same lazy dispatch enqueue rule, same per-tick balance identity, and the same test-only seams
// (double_count, max_dispatch_moves). No RNG in the rule path (fully scripted scenario).
//
// Contracts reused as-is from fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json under
// "contracts" (crane_task, prepared_charge) — not redesigned. Product inventory extends the
// approved scrap_inventory contract with product-only fields (product_grade, order_id,
// ready_tick), flagged as a v1 extension.
//
// Logistics primitives shared with Slice 1 (Slice 1 code untouched, no shared table):
// - single shared resource, non-preemptive cycle (dispatch crane; a running task completes its
//   cycle, priority affects queued order only — crane_task contract rule)
// - capacity refusal recorded as an event, never silently dropped
// - material-balance identity asserted every tick, every tonne counted once at entry
// - pure tick: state in -> new state out, never mutates the original
//
// Mechanics (v1):
// - Billet yard opening stock (game-balance, from Slice 4 mirror end state).
// - Billet carrier: non-preemptive batch move (batch_t_per_move, move_ticks).
// - Rebar mill: non-preemptive roll cycle per batch; rolling yield applied on residence
//   (product enters the product yard at cycle completion, not on arrival).
// - Product yard: capacity; discharge refused when full (recorded, not dropped).
// - Dispatch: FIFO order queue, player-settable priority, non-preemptive crane cycle; a
//   dispatch move takes min(stock, batch) toward the head order.
// - Revenue fires on the actual dispatch outflow (terminal node), not on arrival at the
//   product yard. Price midpoint from content/prices/price_ladder_draft.json (B500B,
//   sme_pending band — midpoint convention stated explicitly).
// - Wire-rod branch (conv_billet_wr) is declared in content but INACTIVE in v1.

export interface CarrierState {
  busy: boolean;
  remaining_ticks: number;
  batch_t: number;
}

export interface MillState {
  busy: boolean;
  remaining_ticks: number;
  batch_t: number; // residence: batch on the mill
  // S5.1 additive (pure derivation from the countdown; heals pre-S5.1 states on first tick)
  phase: MillPhase | null;
  phase_progress: number;
  route: string;
}

export interface CraneState {
  busy_task_id: string | null;
  remaining_ticks: number;
}

export interface CraneTaskRecord {
  task_id: string;
  task_type: string;
  material_grade: string | null;
  source_location: string;
  destination_location: string;
  grab_volume_m3: number | null; // batch shape in v1, not grab-based
  estimated_duration: { ticks: number | null };
  priority: number;
  status: 'queued' | 'running' | 'completed' | 'cancelled';
  note: string;
  created_tick: number;
  order_id: string | null;
  tonnage?: number; // set when a task starts running (mirror adds it dynamically)
}

export interface OrderRecord {
  order_id: string;
  product_grade: string;
  required_t: number;
  deadline_tick: number;
  dispatched_t: number;
  status: 'open' | 'partial' | 'completed' | 'failed';
  priority: number; // dispatch orders default priority 2 (competing tasks enter at 1)
}

export interface EventRecord {
  tick: number;
  event: string;
}

export interface Counters {
  carrier_moves_completed: number;
  rolls_completed: number;
  dispatch_moves_completed: number;
  dispatch_moves_blocked: number; // refused attempts (NOT an inventory term)
  dispatch_moves_blocked_empty: number; // subset: refused because yard empty
  crane_wait_ticks: number;
  mill_wait_ticks: number;
  mill_starved_ticks: number;
  product_yard_refusals: number;
  yield_loss_t: number;
  dispatched_t_total: number;
  revenue_usd: number;
  // S5.1 additive counters (presentation rhythm; never inventory terms)
  reheat_discharges: number;
  shear_cuts: number;
  bundles_strapped: number;
}

export interface Slice5State {
  tick: number;
  billet_yard_t: number;
  carrier: CarrierState;
  mill: MillState; // residence: batch on the mill
  product_yard_t: number;
  product_yard_capacity_t: number;
  crane: CraneState;
  tasks: CraneTaskRecord[]; // crane_task contract records (dispatch + competing reorganize)
  orders: OrderRecord[]; // order_id, product_grade, required_t, deadline, dispatched_t, status
  events: EventRecord[];
  counters: Counters;
  balance_error: number;
  win: boolean | null;
}

// Scenario shape as it appears in fixtures/slice5/*.json (structural typing; extra keys allowed).
export interface Slice5Scenario {
  seed: number;
  ticks: number;
  billet_yard: { initial_billet_t: number };
  billet_carrier: { batch_t_per_move: number; move_ticks: number };
  rebar_mill: { batch_t_per_move: number; roll_ticks: number; yield_loss_pct: number };
  product_yard: { capacity_t: number };
  dispatch_crane: { batch_t_per_move: number; move_ticks: number };
  orders: Array<{ order_id: string; product_grade: string; required_t: number; deadline_tick: number }>;
  competing_task?: { tick: number; task_type: string; note: string };
  product_routes?: ProductRoutesBlock; // S5.1 two-route switch (absent = default heal)
  [k: string]: unknown;
}

export interface Slice5Fixture {
  fixture_id?: string;
  scenario: Slice5Scenario;
  [k: string]: unknown;
}

export interface TickSeams {
  // double_count is a TEST-ONLY seam (negative control N4): it adds the product-yard term
  // twice inside the balance stage. max_dispatch_moves is a TEST-ONLY seam: it stops
  // re-enqueuing dispatch tasks once the order target is reached, so the run measures the
  // order pipeline instead of open-ended shipping. Production runs pass neither
  // (both default to None/False).
  double_count?: boolean;
  max_dispatch_moves?: number | null;
}

export interface TickRecord {
  tick: number;
  mill_phase: MillPhase | null; // S5.1 additive
  mill_phase_progress: number;
  mill_route: string;
  crane_busy_task_type: string | null;
  product_yard_t: number;
  dispatched_t: number;
  balance_error: number;
  events: string[];
}

// Python round(x, n) — half-to-even at the nth decimal (JS toFixed rounds half away from zero).
export function pyRound(x: number, ndigits: number): number {
  const f = 10 ** ndigits;
  const y = x * f;
  const r = Math.round(y);
  // correct the half cases: JS Math.round(-x.5) behaves differently from banker's rounding
  if (Math.abs(y - r) === 0.5 && r % 2 !== 0) {
    return (r - Math.sign(y)) / f;
  }
  return r / f;
}

// json.loads(json.dumps(state)) — pure deep clone, mirror's purity mechanism.
export function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

export function loadPriceMid(doc: { grades: Array<{ id: string; price_mid: number }> }): Record<string, number> {
  const out: Record<string, number> = {};
  for (const g of doc.grades) out[g.id] = g.price_mid;
  return out;
}

// S5.1 mill-process view (PLAN_FORGED Stage 5): shared contract for the mill animation
// (S5.4) + cutaway cards. PURE DERIVATION from the roll countdown (S2.0 heat-phase pattern)
// — roll start/completion ticks, existing events/counters, dispatch, revenue and the balance
// identity are UNCHANGED. New outputs are additive. Mirror = single source of truth.
export type MillPhase = 'reheat' | 'rolling' | 'cooling' | 'shear';
// Design bands, sme_pending (SME calibrates). All four observable at roll_ticks=6.
export const MILL_PHASE_BANDS: ReadonlyArray<readonly [MillPhase, number, number]> = [
  ['reheat', 0.0, 0.30],
  ['rolling', 0.30, 0.55],
  ['cooling', 0.55, 0.80],
  ['shear', 0.80, 1.0],
];
// Visual mass-flow continuity cue ("longer as it thins", S5.4). Game-balance, NOT industry
// fact (real billet->rebar elongation ~100-150x from the pass schedule, Phase 2). sme_pending.
export const ELONGATION_TOTAL = 12.0;
export interface RouteConfig {
  enabled: boolean;
  stands_count: number;
  product_form: 'bundle' | 'coil';
  bundle_t?: number;
  coil_t?: number;
  [k: string]: unknown;
}
export interface ProductRoutesBlock {
  active: string;
  rebar: RouteConfig;
  wire_rod: RouteConfig;
  [k: string]: unknown;
}
// Rebar LIVE, wire rod DEFINED-BUT-IDLE (F-08) so routing drops in later as a switch.
// sme_pending: stands_count (rebar 6 / wire-rod 10), bundle_t 2.0 (~2-3 t), coil_t 2.0 (~1.5-3 t).
export const DEFAULT_PRODUCT_ROUTES: ProductRoutesBlock = {
  active: 'rebar',
  rebar: { enabled: true, stands_count: 6, bundle_t: 2.0, product_form: 'bundle' },
  wire_rod: { enabled: false, stands_count: 10, coil_t: 2.0, product_form: 'coil' },
};
export function routesOf(fx: Slice5Fixture): ProductRoutesBlock {
  // Mirror `get('product_routes') or DEFAULT` — absent/empty heals to the default.
  const pr = fx.scenario.product_routes;
  return pr && Object.keys(pr).length ? pr : DEFAULT_PRODUCT_ROUTES;
}
// (phase, progress-in-phase) from the countdown — same shape as S2.0 heat_phase_view.
export function millPhaseView(remainingTicks: number, totalTicks: number): [MillPhase, number] {
  if (!(totalTicks > 0)) {
    throw new Error('rebar_mill.roll_ticks must be positive');
  }
  const frac = Math.max(0.0, Math.min(1.0, (totalTicks - remainingTicks) / totalTicks));
  for (const [name, a, b] of MILL_PHASE_BANDS) {
    if (frac < b || name === 'shear') {
      return [name, Math.max(0.0, Math.min(1.0, (frac - a) / (b - a)))];
    }
  }
  throw new Error('unreachable: MILL_PHASE_BANDS cover [0,1]');
}
// Python str(float) prints integral floats with a trailing .0 (2.0 -> "2.0"); JS String(2)
// drops it. New S5.1 event strings use this to stay mirror-faithful. Existing event lines
// keep their pre-S5.1 formatting — parity is tick-level (fixture expected_outputs.events).
export function pyFloatStr(x: number): string {
  return Number.isInteger(x) ? x.toFixed(1) : String(x);
}

export function freshState(fx: Slice5Fixture): Slice5State {
  const c = fx.scenario;
  return {
    tick: 0,
    billet_yard_t: c.billet_yard.initial_billet_t,
    carrier: { busy: false, remaining_ticks: 0, batch_t: 0.0 },
    mill: { busy: false, remaining_ticks: 0, batch_t: 0.0, phase: null, phase_progress: 0.0, route: routesOf(fx).active }, // residence + S5.1 additive
    product_yard_t: 0.0,
    product_yard_capacity_t: c.product_yard.capacity_t,
    crane: { busy_task_id: null, remaining_ticks: 0 },
    tasks: [], // crane_task contract records (dispatch + competing reorganize)
    orders: [], // order records: order_id, product_grade, required_t, deadline, dispatched_t, status
    events: [],
    counters: {
      carrier_moves_completed: 0,
      rolls_completed: 0,
      dispatch_moves_completed: 0,
      dispatch_moves_blocked: 0, // refused attempts (NOT an inventory term)
      dispatch_moves_blocked_empty: 0, // subset: refused because yard empty
      crane_wait_ticks: 0,
      mill_wait_ticks: 0,
      mill_starved_ticks: 0,
      product_yard_refusals: 0,
      yield_loss_t: 0.0,
      dispatched_t_total: 0.0,
      revenue_usd: 0.0,
      reheat_discharges: 0,
      shear_cuts: 0,
      bundles_strapped: 0,
    },
    balance_error: 0.0,
    win: null,
  };
}

export function validateScenario(fx: Slice5Fixture): true {
  // Fail loudly on invalid inputs — negative tests depend on these raising.
  const c = fx.scenario;
  if (c.seed === 0) {
    throw new Error('zero seed rejected (fixture-family continuity; generator unused in v1)');
  }
  if (c.ticks <= 0) {
    throw new Error('ticks must be positive');
  }
  for (const key of ['batch_t_per_move', 'roll_ticks', 'yield_loss_pct'] as const) {
    const v = c.rebar_mill[key];
    if (v <= 0) {
      throw new Error(`rebar_mill.${key} must be positive`);
    }
  }
  for (const key of ['batch_t_per_move', 'move_ticks'] as const) {
    const v = c.billet_carrier[key];
    if (v <= 0) {
      throw new Error(`billet_carrier.${key} must be positive`);
    }
  }
  const v = c.dispatch_crane.batch_t_per_move;
  if (v <= 0 || c.dispatch_crane.move_ticks <= 0) {
    throw new Error('dispatch_crane batch/move must be positive');
  }
  if (c.product_yard.capacity_t <= 0) {
    throw new Error('product_yard.capacity_t must be positive');
  }
  for (const o of c.orders) {
    if (o.required_t <= 0 || o.deadline_tick <= 0) {
      throw new Error(`order ${o.order_id}: required_t and deadline_tick must be positive`);
    }
  }
  // S5.1 route switch validation (absent block = pre-S5.1 default, never rejected).
  const pr = c.product_routes;
  if (pr != null) {
    if (pr.active !== 'rebar' && pr.active !== 'wire_rod') {
      throw new Error(`unknown product route ${JSON.stringify(pr.active)} (rebar|wire_rod)`);
    }
    if (!pr.rebar?.enabled) {
      throw new Error('rebar route must be enabled (the live v1 branch)');
    }
    if (pr.wire_rod?.enabled) {
      throw new Error('wire-rod route is defined-but-idle in v1 (F-08) — routing drops in later as a switch');
    }
    if (pr.active !== 'rebar') {
      throw new Error('v1 active route must be rebar (wire rod defined-but-idle, F-08)');
    }
  }
  return true;
}

function enqueueTask(
  s: Slice5State,
  tick: number,
  taskType: string,
  priority: number,
  note: string,
  orderId: string | null = null,
): void {
  s.tasks.push({
    task_id: `T${s.tasks.length + 1}`,
    task_type: taskType,
    material_grade: null,
    source_location: 'PRODUCT_YARD',
    destination_location: taskType === 'dispatch' ? 'ORDER' : 'PRODUCT_YARD',
    grab_volume_m3: null, // batch shape in v1, not grab-based
    estimated_duration: { ticks: null },
    priority,
    status: 'queued',
    note,
    created_tick: tick,
    order_id: orderId,
  });
}

export function tick(
  state: Slice5State,
  fx: Slice5Fixture,
  priceMid: Record<string, number>,
  opts: TickSeams = {},
): Slice5State {
  // state -> new_state; never mutates the original.
  const { double_count = false, max_dispatch_moves = null } = opts;
  const s = deepClone(state);
  s.tick += 1;
  const c = fx.scenario;
  const cnt = s.counters;
  const ev: string[] = [];
  s.mill.route = routesOf(fx).active; // S5.1: heal restored pre-S5.1 states

  // 1) Order deadlines checked at tick entry (deadline boundary is behavior, not a bug).
  for (const o of s.orders) {
    if ((o.status === 'open' || o.status === 'partial') && s.tick > o.deadline_tick) {
      o.status = 'failed';
      ev.push(`order ${o.order_id} missed deadline at tick ${o.deadline_tick}`);
    }
  }

  // 2) Competing task enters the queue at its scripted tick.
  const comp = c.competing_task;
  if (comp && comp.tick === s.tick) {
    enqueueTask(s, s.tick, comp.task_type, 1, comp.note);
    ev.push(`competing ${comp.task_type} task enters crane queue (priority 1)`);
  }

  // 3) Billet carrier: non-preemptive batch move, billet yard -> rebar mill.
  const car = s.carrier;
  if (!car.busy) {
    if (s.billet_yard_t >= c.billet_carrier.batch_t_per_move) {
      car.busy = true;
      car.remaining_ticks = c.billet_carrier.move_ticks;
      car.batch_t = c.billet_carrier.batch_t_per_move;
      s.billet_yard_t -= car.batch_t; // tonne leaves yard at move start (in transit)
      ev.push(`carrier move starts: ${car.batch_t}t billet -> rebar mill`);
    } else if (s.billet_yard_t > 0) {
      cnt.mill_starved_ticks += 1;
      ev.push('carrier idle — billet yard below one batch (starvation, no fabricated move)');
    }
  } else {
    car.remaining_ticks -= 1;
    if (car.remaining_ticks === 0) {
      // deliver INTO the mill (residence rule: mill consumes from its own stock)
      s.mill.batch_t += car.batch_t;
      car.busy = false;
      car.batch_t = 0.0;
      cnt.carrier_moves_completed += 1;
      ev.push(`carrier move completes: ${pyRound(s.mill.batch_t, 3)}t delivered to mill`);
    }
  }

  // 4) Rebar mill: non-preemptive roll cycle per batch; yield applied on residence.
  const mill = s.mill;
  if (!mill.busy) {
    if (mill.batch_t >= c.rebar_mill.batch_t_per_move) {
      mill.busy = true;
      mill.remaining_ticks = c.rebar_mill.roll_ticks;
      mill.batch_t -= c.rebar_mill.batch_t_per_move;
      ev.push(`mill roll starts on ${c.rebar_mill.batch_t_per_move}t batch`);
      // S5.1 additive: reheat discharge glow cue (S5.4) at roll start.
      cnt.reheat_discharges += 1;
      ev.push(`reheat discharge: ${pyFloatStr(c.rebar_mill.batch_t_per_move)}t billet -> stands (route ${mill.route})`);
    } else if (mill.batch_t > 0) {
      cnt.mill_starved_ticks += 1;
      ev.push('mill idle — partial batch on the mill (no fabricated roll)');
    }
  } else {
    // carrier delivering while mill busy = mill wait (residence, not pass-through)
    mill.remaining_ticks -= 1;
    if (mill.remaining_ticks === 0) {
      const product = (c.rebar_mill.batch_t_per_move * (100.0 - c.rebar_mill.yield_loss_pct)) / 100.0;
      cnt.yield_loss_t += c.rebar_mill.batch_t_per_move - product;
      if (s.product_yard_t + product > s.product_yard_capacity_t) {
        // capacity refusal: recorded, never silently dropped
        cnt.product_yard_refusals += 1;
        ev.push(`product yard full — roll output ${pyRound(product, 3)}t refused (recorded)`);
      } else {
        s.product_yard_t += product;
        cnt.rolls_completed += 1;
        ev.push(`mill roll completes: ${pyRound(product, 3)}t product -> product yard`);
        // S5.1 additive: shear+bundle result at completion (presentation view; floor
        // division, loose remainder stays in tonnage — no inventory split).
        const rt = routesOf(fx).rebar;
        const nBundles = Math.floor(product / rt.bundle_t!);
        const looseT = product - nBundles * rt.bundle_t!;
        cnt.bundles_strapped += nBundles;
        ev.push(`bundles strapped: ${nBundles} x ${pyFloatStr(rt.bundle_t!)}t + ${pyRound(looseT, 3)}t loose (route ${mill.route})`);
      }
      mill.busy = false;
    }
  }

  // S5.1: derive the mill phase enum from the roll countdown (pure presentation contract,
  // S2.0 shape; set unconditionally so restored pre-S5.1 states heal). The shear-cut event
  // fires on the cooling->shear band transition; prev phase is read from the INPUT state
  // (pure state-in, no extra state field).
  const prevPhase = state.mill.phase ?? null;
  if (!mill.busy) {
    mill.phase = null;
    mill.phase_progress = 0.0;
  } else {
    const [ph, pp] = millPhaseView(mill.remaining_ticks, c.rebar_mill.roll_ticks);
    mill.phase = ph;
    mill.phase_progress = pp;
    if (ph === 'shear' && prevPhase !== 'shear') {
      const productT = (c.rebar_mill.batch_t_per_move * (100.0 - c.rebar_mill.yield_loss_pct)) / 100.0;
      cnt.shear_cuts += 1;
      ev.push(`shear cuts bar to length (route ${mill.route}, ${pyRound(productT, 3)}t batch)`);
    }
  }

  // 5) Dispatch crane: single shared resource, non-preemptive, FIFO by priority.
  //    Task creation follows the contract rule dispatch = min(stock, batch): a task is
  //    enqueued only when the yard can supply a batch at the moment the crane is free — an
  //    attempt against an empty yard is recorded as a refusal, not queued. A task is
  //    enqueued ONCE per order (first product); the order's tonnage is served by successive
  //    min(stock, batch) moves. Re-enqueue is gated by the order target (test seam
  //    max_dispatch_moves = sum of ceil(required/batch)).
  const crane = s.crane;
  if (!crane.busy_task_id) {
    // head task: highest priority, then FIFO creation order (crane_task contract rule)
    let queued = s.tasks.filter((t) => t.status === 'queued');
    if (queued.length === 0) {
      // lazily create the first task for the head open order when product exists
      const openOrders = s.orders.filter((o) => o.status === 'open' || o.status === 'partial');
      if (openOrders.length > 0 && s.product_yard_t > 0) {
        const order = [...openOrders].sort((a, b) => b.priority - a.priority || (a.order_id < b.order_id ? -1 : a.order_id > b.order_id ? 1 : 0))[0];
        enqueueTask(s, s.tick, 'dispatch', order.priority, `order task for ${order.order_id}`, order.order_id);
        queued = s.tasks.filter((t) => t.status === 'queued');
      }
    }
    if (queued.length > 0) {
      const task = [...queued].sort((a, b) => b.priority - a.priority || a.created_tick - b.created_tick)[0];
      if (task.task_type === 'dispatch') {
        const order = s.orders.find((o) => o.order_id === task.order_id)!;
        if (order.status === 'completed') {
          task.status = 'cancelled';
          ev.push(`dispatch task ${task.task_id} cancelled — order ${order.order_id} already closed`);
        } else if (s.product_yard_t <= 0) {
          // attempt recorded, task stays queued (retry when product arrives)
          cnt.dispatch_moves_blocked += 1;
          cnt.dispatch_moves_blocked_empty += 1;
          ev.push('dispatch move refused — product yard empty (attempt recorded)');
        } else {
          const batch = Math.min(s.product_yard_t, c.dispatch_crane.batch_t_per_move);
          s.product_yard_t -= batch; // tonne leaves yard at move start
          task.tonnage = batch;
          task.order_id = order.order_id;
          task.status = 'running';
          crane.busy_task_id = task.task_id;
          crane.remaining_ticks = c.dispatch_crane.move_ticks;
          ev.push(`dispatch move starts for order ${order.order_id}: ${pyRound(batch, 3)}t`);
        }
      } else {
        task.status = 'running';
        task.tonnage = 0.0;
        crane.busy_task_id = task.task_id;
        crane.remaining_ticks = c.dispatch_crane.move_ticks;
        ev.push(`crane starts ${task.task_type} task (non-preemptive — dispatch waits)`);
      }
    } else {
      // dispatch demand exists but no task enqueued yet is impossible here;
      // record crane idle-wait when product is available and queue empty
      if (s.product_yard_t > 0) {
        cnt.crane_wait_ticks += 1;
      }
    }
  } else {
    // a dispatch demand waiting while the crane is busy = crane wait
    if (s.tasks.some((t) => t.status === 'queued' && t.task_type === 'dispatch')) {
      cnt.crane_wait_ticks += 1;
    }
    crane.remaining_ticks -= 1;
    if (crane.remaining_ticks === 0) {
      const task = s.tasks.find((t) => t.task_id === crane.busy_task_id)!;
      task.status = 'completed';
      if (task.task_type === 'dispatch') {
        const order = s.orders.find((o) => o.order_id === task.order_id)!;
        order.dispatched_t += task.tonnage!;
        cnt.dispatch_moves_completed += 1;
        cnt.dispatched_t_total += task.tonnage!;
        // revenue on the ACTUAL dispatch outflow (terminal node)
        cnt.revenue_usd += task.tonnage! * priceMid[order.product_grade];
        if (order.dispatched_t >= order.required_t - 1e-9) {
          order.status = 'completed';
          ev.push(`order ${order.order_id} completed at tick ${s.tick}`);
        } else {
          order.status = 'partial';
          // re-enqueue next move for this order (test seam: stop once the order target is
          // reached so the run measures the order pipeline)
          if (max_dispatch_moves === null || max_dispatch_moves === undefined || cnt.dispatch_moves_completed < max_dispatch_moves) {
            enqueueTask(s, s.tick, 'dispatch', order.priority, `next move for ${order.order_id}`, order.order_id);
          }
        }
      }
      ev.push(`crane completes task ${task.task_id} (${task.task_type})`);
      crane.busy_task_id = null;
    }
  }

  // 6) Material balance identity — every tonne counted once, at entry (opening stock).
  //     opening = in transit (carrier) + on mill + product yard + dispatched + yield loss.
  const inTransit = s.carrier.batch_t;
  const onMill = s.mill.batch_t;
  const entered = fx.scenario.billet_yard.initial_billet_t;
  let balanceError = entered - inTransit - onMill - s.product_yard_t - cnt.dispatched_t_total - cnt.yield_loss_t;
  if (double_count) {
    balanceError -= s.product_yard_t; // broken rule: yard term counted twice
  }
  s.balance_error = balanceError;

  for (const e of ev) s.events.push({ tick: s.tick, event: e });
  return s;
}

export function run(
  fx: Slice5Fixture,
  priceMid: Record<string, number>,
  opts: TickSeams = {},
): { state: Slice5State; records: TickRecord[] } {
  const { max_dispatch_moves = null, double_count = false } = opts;
  validateScenario(fx);
  const state = freshState(fx);
  for (const o of fx.scenario.orders) {
    state.orders.push({
      order_id: o.order_id,
      product_grade: o.product_grade,
      required_t: o.required_t,
      deadline_tick: o.deadline_tick,
      dispatched_t: 0.0,
      status: 'open',
      priority: 2,
    });
    // Contract rule (crane_task): dispatch = min(stock, batch_t_per_move). A task is enqueued
    // only when the yard can actually supply a batch at the moment the crane is free — an
    // attempt against an empty yard is recorded as a refusal, not queued forever. So the
    // initial tasks are created lazily at tick 1 when the first product arrives (see the
    // dispatch stage), not pre-created here.
  }
  const records: TickRecord[] = [];
  let st = state;
  for (let i = 0; i < fx.scenario.ticks; i++) {
    st = tick(st, fx, priceMid, { double_count, max_dispatch_moves });
    records.push({
      tick: st.tick,
      mill_phase: st.mill.phase,
      mill_phase_progress: pyRound(st.mill.phase_progress, 6),
      mill_route: st.mill.route,
      crane_busy_task_type: st.crane.busy_task_id
        ? st.tasks.find((t) => t.task_id === st.crane.busy_task_id)!.task_type
        : null,
      product_yard_t: pyRound(st.product_yard_t, 6),
      dispatched_t: pyRound(st.counters.dispatched_t_total, 6),
      balance_error: pyRound(st.balance_error, 9),
      events: st.events.filter((e) => e.tick === st.tick).map((e) => e.event),
    });
  }
  st.win = st.orders.every((o) => o.status === 'completed') && Math.abs(st.balance_error) < 1e-6;
  return { state: st, records };
}

// Order-target move count (test seam size): sum of ceil(required_t / batch) per order.
export function targetMoves(fx: Slice5Fixture): number {
  const batch = fx.scenario.dispatch_crane.batch_t_per_move;
  return fx.scenario.orders.reduce((acc, o) => acc + Math.ceil(o.required_t / batch), 0);
}

// S5.1 pure projection for the mill animation (S5.4) + cutaway cards. Reads state, returns
// a NEW object; never mutates state or the ledger. Tonnage-only (F-08): bed occupancy shows
// the batch on the mill (residence tonnage); bundle/coil counts are floor-division presentation
// views, never an inventory split. v1 dispatch is NOT gated on cooling/bundling — the
// bed/shear/bundle rhythm lives INSIDE the roll cycle (presentation compression); hard process
// gating = later explicit rule change. Mirror: mill_process_view.
export interface MillProcessView {
  route: string;
  product_form: 'bundle' | 'coil';
  phase: MillPhase | null;
  phase_progress: number;
  stands_count: number;
  stand_progress: number | null;
  current_stand: number | null;
  elongation_factor: number;
  bed: { on_bed_t: number; walk_progress: number; glow: number } | null;
  shearing: boolean;
}
export function millProcessView(state: Slice5State, fx: Slice5Fixture): MillProcessView {
  const c = fx.scenario;
  const rt = routesOf(fx);
  const route = rt.active;
  const cfg = rt[route as 'rebar' | 'wire_rod'];
  const mill = state.mill;
  const phase = mill.phase ?? null;
  const pp = mill.phase_progress ?? 0.0;
  const view: MillProcessView = {
    route,
    product_form: cfg.product_form,
    phase,
    phase_progress: pp,
    stands_count: cfg.stands_count,
    stand_progress: null,
    current_stand: null,
    elongation_factor: 1.0,
    bed: null,
    shearing: phase === 'shear',
  };
  if (phase === 'rolling') {
    view.stand_progress = pp;
    view.current_stand = Math.min(cfg.stands_count - 1, Math.floor(pp * cfg.stands_count));
    view.elongation_factor = 1.0 + (ELONGATION_TOTAL - 1.0) * pp;
  } else if (phase === 'cooling') {
    view.bed = {
      on_bed_t: c.rebar_mill.batch_t_per_move,
      walk_progress: pp, // bars step across the walking beam (S5.4)
      glow: 1.0 - pp, // hot -> black across the bed; cold shear at exit
    };
  }
  return view;
}

// S5.1 finished-yard presentation view (S5.5): strapped bundles (rebar) or coils (wire rod,
// later) = floor(tonnage / unit_t); loose remainder stays in tonnage. Pure; never mutates
// state. v1 tonnage-only dispatch can split a bundle across moves — presentation, not an
// inventory ledger (F-08). Mirror: product_yard_view.
export interface ProductYardView {
  route: string;
  product_form: 'bundle' | 'coil';
  yard_t: number;
  units: number;
  unit_t: number;
  loose_t: number;
}
export function productYardView(state: Slice5State, fx: Slice5Fixture): ProductYardView {
  const rt = routesOf(fx);
  const cfg = rt[rt.active as 'rebar' | 'wire_rod'];
  const unitT = (cfg.product_form === 'bundle' ? cfg.bundle_t : cfg.coil_t)!;
  const yardT = state.product_yard_t;
  const units = Math.floor(yardT / unitT);
  return {
    route: rt.active,
    product_form: cfg.product_form,
    yard_t: yardT,
    units,
    unit_t: unitT,
    loose_t: yardT - units * unitT,
  };
}
