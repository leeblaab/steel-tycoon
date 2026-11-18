// Browser-safe deterministic replay for the Slice 5 scene.
// Mirror-first rule (steel-plant-game skill): mirror/slice5_mirror.py is the single source of
// truth; this file ports its tick() stage order 1:1 — same state fields, same event strings,
// same counters — so every fixture `expected_outputs` field reproduces exactly.
// The 3D layer never drives logic: main.tsx only reads the precomputed per-tick records.
//
// Fixture embedded as a build-time copy (same pattern as slice1 sim.ts embedding OPS_CONFIG_JSON;
// single source of truth remains fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json).
// Price midpoint likewise embedded from content/prices/price_ladder_draft.json (B500B, sme_pending
// band — midpoint convention stated explicitly in the fixture revenue_note).

export const FIXTURE_ID = 's5_billet_rebar_dispatch_orders_seed11_120';
export const PRICE_MID_B500B = 635.0; // content/prices/price_ladder_draft.json, B500B price_mid

export interface S5Order { order_id: string; product_grade: string; required_t: number; deadline_tick: number }
export interface S5Scenario {
  seed: number; ticks: number;
  billet_yard: { initial_billet_t: number };
  billet_carrier: { batch_t_per_move: number; move_ticks: number };
  rebar_mill: { batch_t_per_move: number; roll_ticks: number; yield_loss_pct: number };
  product_yard: { capacity_t: number };
  dispatch_crane: { batch_t_per_move: number; move_ticks: number };
  orders: S5Order[];
  competing_task: { tick: number; task_type: string };
}

// Build-time copy of fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json -> "scenario".
export const SCENARIO: S5Scenario = {
  seed: 11,
  ticks: 120,
  billet_yard: { initial_billet_t: 100.0 },
  billet_carrier: { batch_t_per_move: 10.0, move_ticks: 4 },
  rebar_mill: { batch_t_per_move: 10.0, roll_ticks: 6, yield_loss_pct: 2.0 },
  product_yard: { capacity_t: 60.0 },
  dispatch_crane: { batch_t_per_move: 10.0, move_ticks: 3 },
  orders: [
    { order_id: 'O1', product_grade: 'B500B', required_t: 30.0, deadline_tick: 60 },
    { order_id: 'O2', product_grade: 'B500B', required_t: 30.0, deadline_tick: 90 },
    { order_id: 'O3', product_grade: 'B500B', required_t: 30.0, deadline_tick: 120 },
  ],
  competing_task: { tick: 40, task_type: 'reclaiming' },
};

// Build-time copy of fixtures/.../expected_outputs (verification target; fixture file wins).
export const EXPECTED = {
  carrier_move_starts: [1, 6, 11, 16, 21, 26, 31, 36, 41, 46],
  mill_roll_completions: [11, 18, 25, 32, 39, 46, 53, 60, 67, 74],
  dispatch_move_starts: [11, 18, 25, 32, 39, 46, 53, 60, 68, 74],
  competing_task_start: 40,
  order_completions: { O1: 35, O2: 63 } as Record<string, number>,
  key_ticks: {
    '43': { crane_busy_task_type: null as string | null, product_yard_t: 0.0, dispatched_t: 49.0 },
    '72': { crane_busy_task_type: null as string | null, product_yard_t: 0.0, dispatched_t: 88.2 },
    '120': { billet_yard_t: 0.0, product_yard_t: 0.0, dispatched_t: 98.0, mill_in_process_t: 0.0 },
  },
  balance_error_at_end: 0.0,
  tolerance: 1e-6,
  counters_at_tick_120: {
    carrier_moves_completed: 10, rolls_completed: 10, dispatch_moves_completed: 10,
    dispatch_moves_blocked: 63, dispatch_moves_blocked_empty: 63,
    crane_wait_ticks: 0, mill_wait_ticks: 0, mill_starved_ticks: 0,
    product_yard_refusals: 0, yield_loss_t: 2.0, dispatched_t_total: 98.0, revenue_usd: 62230.0,
  },
  win: false,
};

// ---------- state (mirror fresh_state shape) ----------
interface Task {
  task_id: string; task_type: string; source_location: string; destination_location: string;
  priority: number; status: 'queued' | 'running' | 'completed' | 'cancelled';
  created_tick: number; order_id?: string; tonnage?: number;
}
interface OrderRec { order_id: string; product_grade: string; required_t: number; deadline_tick: number; dispatched_t: number; status: 'open' | 'partial' | 'completed' | 'failed'; priority: number }
export interface Counters {
  carrier_moves_completed: number; rolls_completed: number; dispatch_moves_completed: number;
  dispatch_moves_blocked: number; dispatch_moves_blocked_empty: number;
  crane_wait_ticks: number; mill_wait_ticks: number; mill_starved_ticks: number;
  product_yard_refusals: number; yield_loss_t: number; dispatched_t_total: number; revenue_usd: number;
}
interface State {
  tick: number;
  billet_yard_t: number;
  carrier: { busy: boolean; remaining_ticks: number; batch_t: number };
  mill: { busy: boolean; remaining_ticks: number; batch_t: number }; // residence: batch on the mill
  product_yard_t: number;
  crane: { busy_task_id: string | null; remaining_ticks: number };
  tasks: Task[]; orders: OrderRec[]; events: Array<{ tick: number; event: string }>;
  counters: Counters; balance_error: number; win: boolean | null;
}

export interface TickRecord {
  tick: number;
  billet_yard_t: number; carrier_transit_t: number; mill_in_process_t: number;
  product_yard_t: number; dispatched_t: number;
  crane_busy_task_type: string | null; crane_busy_order: string | null;
  carrier_busy: boolean; mill_busy: boolean;
  queued_dispatch_orders: string[]; competing_queued: boolean;
  balance_error: number; events: string[];
  orders: Array<{ order_id: string; dispatched_t: number; status: string; required_t: number; deadline_tick: number }>;
}

export interface RunResult {
  records: TickRecord[];
  state: State;
  verify: { ok: boolean; lines: string[] };
}

function freshState(): State {
  const c = SCENARIO;
  return {
    tick: 0,
    billet_yard_t: c.billet_yard.initial_billet_t,
    carrier: { busy: false, remaining_ticks: 0, batch_t: 0.0 },
    mill: { busy: false, remaining_ticks: 0, batch_t: 0.0 },
    product_yard_t: 0.0,
    crane: { busy_task_id: null, remaining_ticks: 0 },
    tasks: [],
    orders: c.orders.map((o) => ({ ...o, dispatched_t: 0.0, status: 'open' as const, priority: 2 })),
    events: [],
    counters: {
      carrier_moves_completed: 0, rolls_completed: 0, dispatch_moves_completed: 0,
      dispatch_moves_blocked: 0, dispatch_moves_blocked_empty: 0,
      crane_wait_ticks: 0, mill_wait_ticks: 0, mill_starved_ticks: 0,
      product_yard_refusals: 0, yield_loss_t: 0.0, dispatched_t_total: 0.0, revenue_usd: 0.0,
    },
    balance_error: 0.0, win: null,
  };
}

function enqueueTask(s: State, tick: number, task_type: string, priority: number, note: string, order_id?: string) {
  s.tasks.push({
    task_id: `T${s.tasks.length + 1}`, task_type,
    source_location: 'PRODUCT_YARD', destination_location: task_type === 'dispatch' ? 'ORDER' : 'PRODUCT_YARD',
    priority, status: 'queued', created_tick: tick, order_id,
  });
  void note;
}

// Pure tick: state in -> new state out (mirror tick() port; stage order identical).
function tick(state: State): State {
  const s: State = structuredClone(state);
  s.tick += 1;
  const c = SCENARIO;
  const cnt = s.counters;
  const ev: string[] = [];

  // 1) Order deadlines checked at tick entry.
  for (const o of s.orders) {
    if ((o.status === 'open' || o.status === 'partial') && s.tick > o.deadline_tick) {
      o.status = 'failed';
      ev.push(`order ${o.order_id} missed deadline at tick ${o.deadline_tick}`);
    }
  }

  // 2) Competing task enters the queue at its scripted tick (priority 1).
  if (c.competing_task.tick === s.tick) {
    enqueueTask(s, s.tick, c.competing_task.task_type, 1, c.competing_task.tick + ' reorganize');
    ev.push('competing reclaiming task enters crane queue (priority 1)');
  }

  // 3) Billet carrier: non-preemptive batch move, billet yard -> rebar mill.
  const car = s.carrier;
  if (!car.busy) {
    if (s.billet_yard_t >= c.billet_carrier.batch_t_per_move) {
      car.busy = true; car.remaining_ticks = c.billet_carrier.move_ticks; car.batch_t = c.billet_carrier.batch_t_per_move;
      s.billet_yard_t -= car.batch_t; // tonne leaves yard at move start (in transit)
      ev.push(`carrier move starts: ${car.batch_t}t billet -> rebar mill`);
    } else if (s.billet_yard_t > 0) {
      cnt.mill_starved_ticks += 1;
      ev.push('carrier idle — billet yard below one batch (starvation, no fabricated move)');
    }
  } else {
    car.remaining_ticks -= 1;
    if (car.remaining_ticks === 0) {
      s.mill.batch_t += car.batch_t;
      car.busy = false; car.batch_t = 0.0;
      cnt.carrier_moves_completed += 1;
      ev.push(`carrier move completes: ${s.mill.batch_t.toFixed(3)}t delivered to mill`);
    }
  }

  // 4) Rebar mill: non-preemptive roll cycle per batch; yield applied on residence.
  const mill = s.mill;
  if (!mill.busy) {
    if (mill.batch_t >= c.rebar_mill.batch_t_per_move) {
      mill.busy = true; mill.remaining_ticks = c.rebar_mill.roll_ticks; mill.batch_t -= c.rebar_mill.batch_t_per_move;
      ev.push(`mill roll starts on ${c.rebar_mill.batch_t_per_move}t batch`);
    } else if (mill.batch_t > 0) {
      cnt.mill_starved_ticks += 1;
      ev.push('mill idle — partial batch on the mill (no fabricated roll)');
    }
  } else {
    mill.remaining_ticks -= 1;
    if (mill.remaining_ticks === 0) {
      const product = c.rebar_mill.batch_t_per_move * (100.0 - c.rebar_mill.yield_loss_pct) / 100.0;
      cnt.yield_loss_t += c.rebar_mill.batch_t_per_move - product;
      if (s.product_yard_t + product > SCENARIO.product_yard.capacity_t) {
        cnt.product_yard_refusals += 1;
        ev.push(`product yard full — roll output ${product.toFixed(3)}t refused (recorded)`);
      } else {
        s.product_yard_t += product;
        cnt.rolls_completed += 1;
        ev.push(`mill roll completes: ${product.toFixed(3)}t product -> product yard`);
      }
      mill.busy = false;
    }
  }

  // 5) Dispatch crane: single shared resource, non-preemptive, priority then FIFO creation.
  //    Lazy dispatch rule (canonical, Option A): a task is enqueued only when the yard can
  //    supply at the moment the crane is free; an attempt against an empty yard is recorded
  //    as a refusal, not queued forever. dispatch = min(stock, order_remaining).
  const crane = s.crane;
  if (!crane.busy_task_id) {
    let queued = s.tasks.filter((t) => t.status === 'queued');
    if (queued.length === 0) {
      const openOrders = s.orders.filter((o) => o.status === 'open' || o.status === 'partial');
      if (openOrders.length > 0 && s.product_yard_t > 0) {
        const order = [...openOrders].sort((a, b) => (b.priority - a.priority) || a.order_id.localeCompare(b.order_id))[0];
        enqueueTask(s, s.tick, 'dispatch', order.priority, `order task for ${order.order_id}`, order.order_id);
        queued = s.tasks.filter((t) => t.status === 'queued');
      }
    }
    if (queued.length > 0) {
      const task = [...queued].sort((a, b) => (b.priority - a.priority) || (a.created_tick - b.created_tick))[0];
      if (task.task_type === 'dispatch') {
        const order = s.orders.find((o) => o.order_id === task.order_id)!;
        if (order.status === 'completed') {
          task.status = 'cancelled';
          ev.push(`dispatch task ${task.task_id} cancelled — order ${order.order_id} already closed`);
        } else if (s.product_yard_t <= 0) {
          cnt.dispatch_moves_blocked += 1;
          cnt.dispatch_moves_blocked_empty += 1;
          ev.push('dispatch move refused — product yard empty (attempt recorded)');
        } else {
          // Canonical rule (mirror-faithful): batch = min(stock, batch_t_per_move).
          // [OPEN QUESTION 1] The task brief phrases it as "min(stock, order_remaining)", but the
          // mirror — and the fixture's own o3_note arithmetic (O1+O2 consume whole batches of
          // 39.2 t each) — dispatches whole batches that overshoot order targets. Fixture wins:
          // no order_remaining cap here.
          const batch = Math.min(s.product_yard_t, c.dispatch_crane.batch_t_per_move);
          s.product_yard_t -= batch;
          task.tonnage = batch; task.status = 'running';
          crane.busy_task_id = task.task_id; crane.remaining_ticks = c.dispatch_crane.move_ticks;
          ev.push(`dispatch move starts for order ${order.order_id}: ${batch.toFixed(3)}t`);
        }
      } else {
        task.status = 'running'; task.tonnage = 0.0;
        crane.busy_task_id = task.task_id; crane.remaining_ticks = c.dispatch_crane.move_ticks;
        ev.push(`crane starts ${task.task_type} task (non-preemptive — dispatch waits)`);
      }
    } else if (s.product_yard_t > 0) {
      cnt.crane_wait_ticks += 1;
    }
  } else {
    if (s.tasks.some((t) => t.status === 'queued' && t.task_type === 'dispatch')) cnt.crane_wait_ticks += 1;
    crane.remaining_ticks -= 1;
    if (crane.remaining_ticks === 0) {
      const task = s.tasks.find((t) => t.task_id === crane.busy_task_id)!;
      task.status = 'completed';
      if (task.task_type === 'dispatch') {
        const order = s.orders.find((o) => o.order_id === task.order_id)!;
        order.dispatched_t += task.tonnage!;
        cnt.dispatch_moves_completed += 1;
        cnt.dispatched_t_total += task.tonnage!;
        cnt.revenue_usd += task.tonnage! * PRICE_MID_B500B; // revenue on the ACTUAL dispatch outflow
        if (order.dispatched_t >= order.required_t - 1e-9) {
          order.status = 'completed';
          ev.push(`order ${order.order_id} completed at tick ${s.tick}`);
        } else {
          order.status = 'partial';
          enqueueTask(s, s.tick, 'dispatch', order.priority, `next move for ${order.order_id}`, order.order_id);
        }
      }
      ev.push(`crane completes task ${task.task_id} (${task.task_type})`);
      crane.busy_task_id = null;
    }
  }

  // 6) Material balance identity — every tonne counted once, at entry (opening stock).
  //    Mirror-faithful: the mirror's balance stage uses carrier.batch_t as "delivered" payload
  //    semantics (fresh_state initializes batch_t=0; the tick body sets it on start but the
  //    identity reads it as an in-transit term only after delivery accounting has moved it to
  //    the mill). [OPEN QUESTION 3] The close note claims "material balance closes every tick
  //    (residual ~2e-14)" — that is true at tick 120 and at the fixture's key ticks, but a raw
  //    per-tick dump of the mirror shows residuals up to 100.0 mid-run (billet tonnage leaves
  //    the yard at move start yet enters the identity only on mill delivery). The fixture only
  //    asserts balance_error_at_end + key ticks, so we reproduce the mirror's exact per-tick
  //    values rather than a "clean" per-tick residual. Fixture wins; question logged.
  const entered = SCENARIO.billet_yard.initial_billet_t;
  s.balance_error = entered - s.carrier.batch_t - s.mill.batch_t - s.product_yard_t - cnt.dispatched_t_total - cnt.yield_loss_t;

  for (const e of ev) s.events.push({ tick: s.tick, event: e });
  return s;
}

export function runSlice5(): RunResult {
  let st = freshState();
  const records: TickRecord[] = [];
  for (let i = 0; i < SCENARIO.ticks; i++) {
    st = tick(st);
    const busyTask = st.crane.busy_task_id ? st.tasks.find((t) => t.task_id === st.crane.busy_task_id)! : null;
    records.push({
      tick: st.tick,
      billet_yard_t: st.billet_yard_t,
      // [OPEN QUESTION 2] carrier_transit_t / mill_in_process_t are SCENE-ONLY observables for the
      // 3D animation. The mirror's balance identity accounts billet tonnage only on delivery to
      // the mill (no in-transit term), so transit is shown as an uncounted visual payload; the
      // fixture's key_tick[120].mill_in_process_t maps to mill.batch_t exactly.
      carrier_transit_t: st.carrier.busy ? SCENARIO.billet_carrier.batch_t_per_move : 0.0,
      mill_in_process_t: st.mill.batch_t,
      product_yard_t: st.product_yard_t,
      dispatched_t: st.counters.dispatched_t_total,
      crane_busy_task_type: busyTask ? busyTask.task_type : null,
      crane_busy_order: busyTask?.order_id ?? null,
      carrier_busy: st.carrier.busy, mill_busy: st.mill.busy,
      queued_dispatch_orders: st.tasks.filter((t) => t.status === 'queued' && t.task_type === 'dispatch').map((t) => t.order_id!),
      competing_queued: st.tasks.some((t) => t.status === 'queued' && t.task_type !== 'dispatch'),
      balance_error: st.balance_error,
      events: st.events.filter((e) => e.tick === st.tick).map((e) => e.event),
      orders: st.orders.map((o) => ({ order_id: o.order_id, dispatched_t: o.dispatched_t, status: o.status, required_t: o.required_t, deadline_tick: o.deadline_tick })),
    });
  }
  st.win = st.orders.every((o) => o.status === 'completed') && Math.abs(st.balance_error) < 1e-6;
  fillSnapshots(records); // key-tick snapshots from the exact per-tick records before verifying
  const verify = verifyAgainstExpected(st);
  return { records, state: st, verify };
}

// ---------- programmatic verification vs fixture expected_outputs ----------
function near(a: number, b: number) { return Math.abs(a - b) <= EXPECTED.tolerance; }
function verifyAgainstExpected(st: State): { ok: boolean; lines: string[] } {
  const lines: string[] = [];
  let ok = true;
  const cmp = (name: string, got: unknown, exp: unknown) => {
    const good = typeof got === 'number' && typeof exp === 'number' ? near(got, exp) : JSON.stringify(got) === JSON.stringify(exp);
    if (!good) ok = false;
    lines.push(`${good ? 'MATCH   ' : 'MISMATCH'} ${name}: got=${JSON.stringify(got)} expected=${JSON.stringify(exp)}`);
  };
  const evTicks = (sub: string) => st.events.filter((e) => e.event.includes(sub)).map((e) => e.tick);
  cmp('events.carrier_move_starts', evTicks('carrier move starts'), EXPECTED.carrier_move_starts);
  cmp('events.mill_roll_completions', evTicks('mill roll completes'), EXPECTED.mill_roll_completions);
  cmp('events.dispatch_move_starts', evTicks('dispatch move starts'), EXPECTED.dispatch_move_starts);
  cmp('events.competing_task_start', evTicks('enters crane queue'), [EXPECTED.competing_task_start]);
  const ocomp: Record<string, number> = {};
  for (const e of st.events) {
    const m = /^order (\w+) completed at tick (\d+)$/.exec(e.event);
    if (m) ocomp[m[1]] = +m[2];
  }
  cmp('events.order_completions', ocomp, EXPECTED.order_completions);
  cmp('events.O3_status', st.orders.find((o) => o.order_id === 'O3')!.status, 'partial');
  cmp('events.O3_dispatched_t', Math.round(st.orders.find((o) => o.order_id === 'O3')!.dispatched_t * 100) / 100, 19.6);

  for (const [k, exp] of Object.entries(EXPECTED.key_ticks)) {
    const snap = KEY_TICK_SNAPSHOTS[+k];
    if (!snap) { ok = false; lines.push(`MISMATCH key_tick ${k}: snapshot missing`); continue; }
    for (const [f, e] of Object.entries(exp as Record<string, unknown>)) cmp(`key_tick[${k}].${f}`, snap[f], e);
  }

  cmp('balance.balance_error_at_end', st.balance_error, EXPECTED.balance_error_at_end);
  const c = st.counters;
  for (const [k, e] of Object.entries(EXPECTED.counters_at_tick_120)) {
    cmp(`counters_at_tick_120.${k}`, (c as any)[k], e);
  }
  cmp('win', st.win, EXPECTED.win);
  return { ok, lines };
}

// Key-tick snapshots are filled by runSlice5 through this module-level cache
// (mirror records[] equivalent) so verification reads the exact per-tick state.
const KEY_TICK_SNAPSHOTS: Record<number, Record<string, unknown>> = {};
let recordsCache: TickRecord[] = [];

export function fillSnapshots(records: TickRecord[]) {
  recordsCache = records;
  for (const k of [43, 72, 120]) {
    const r = records[k - 1];
    KEY_TICK_SNAPSHOTS[k] = {
      crane_busy_task_type: r.crane_busy_task_type,
      product_yard_t: Math.round(r.product_yard_t * 1e6) / 1e6,
      dispatched_t: Math.round(r.dispatched_t * 1e6) / 1e6,
      billet_yard_t: Math.round(r.billet_yard_t * 1e6) / 1e6,
      mill_in_process_t: Math.round(r.mill_in_process_t * 1e6) / 1e6,
    };
  }
}
