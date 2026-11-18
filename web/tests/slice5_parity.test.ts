// Slice 5 parity test — fixture-driven acceptance for web/src/ports/slice5/shared/slice5_sim.ts
// (line-level TS port of mirror/slice5_mirror.py). Mirror = single source of truth; the fixture's
// expected_outputs (RE-DERIVED 2026-10-17 from the fresh mirror run) are asserted in full.
// Negative controls follow the fixture's documented variants under "negative_controls" — NOT the
// mirror's stale control scripts (run_negative_tests prints FAIL N2/N3/N4 for those; documented
// in expected_outputs.negative_controls). See docs/phase0_audit_sims.md.
import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  freshState,
  validateScenario,
  tick,
  run,
  loadPriceMid,
  targetMoves,
  deepClone,
  pyRound,
  type Slice5Fixture,
} from '../src/ports/slice5/shared/slice5_sim.ts';

const REPO = 'C:/AI_LAB/SteelX';
const FIXTURE: Slice5Fixture = JSON.parse(
  readFileSync(`${REPO}/fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json`, 'utf-8'),
);
const PRICE_DOC = JSON.parse(readFileSync(`${REPO}/content/prices/price_ladder_draft.json`, 'utf-8'));
const PRICE_MID = loadPriceMid(PRICE_DOC);
const EXP = (FIXTURE as any).expected_outputs;

function withScenario(mut: (c: any) => void): Slice5Fixture {
  const f = deepClone(FIXTURE);
  mut((f as any).scenario);
  return f;
}

// ---------- baseline fixture run ----------

test('fixture + price ladder load: contract fields present', () => {
  assert.strictEqual(FIXTURE.fixture_id, 's5_billet_rebar_dispatch_orders_seed11_120');
  assert.strictEqual((FIXTURE as any).domain, 'slice5_product_flow');
  assert.strictEqual(FIXTURE.scenario.seed, 11);
  assert.strictEqual(FIXTURE.scenario.ticks, 120);
  assert.strictEqual(PRICE_MID.B500B, 635.0); // sme_pending band, midpoint convention
});

test('baseline: win=false and order statuses/dispatched_t match fixture', () => {
  const { state } = run(FIXTURE, PRICE_MID);
  assert.strictEqual(state.win, EXP.win); // false
  const orders = new Map(state.orders.map((o) => [o.order_id, o]));
  assert.strictEqual(orders.get('O1')!.status, 'completed');
  assert.ok(Math.abs(orders.get('O1')!.dispatched_t - 39.2) < 1e-9);
  assert.strictEqual(orders.get('O2')!.status, 'completed');
  assert.ok(Math.abs(orders.get('O2')!.dispatched_t - 39.2) < 1e-9);
  assert.strictEqual(orders.get('O3')!.status, 'partial'); // stock-limited, not deadline-limited
  assert.ok(Math.abs(orders.get('O3')!.dispatched_t - 19.6) < 1e-9);
});

test('baseline: event tick lists match fixture expected_outputs.events', () => {
  const { state } = run(FIXTURE, PRICE_MID);
  const ticksOf = (pred: (e: string) => boolean) =>
    [...new Set(state.events.filter((e) => pred(e.event)).map((e) => e.tick))].sort((a, b) => a - b);
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('carrier move starts')), EXP.events.carrier_move_starts); // [1,6,...,46]
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('mill roll completes')), EXP.events.mill_roll_completions); // [11,18,...,74]
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('dispatch move starts')), EXP.events.dispatch_move_starts); // [11,18,...,68,74]
  const comp = ticksOf((e) => e.startsWith('competing reclaiming task enters crane queue'));
  assert.deepStrictEqual(comp, [EXP.events.competing_task_start]); // [40]
  // order completions: O1@35, O2@63 (fixture lists exactly these two; O3 never completes)
  const done = state.events
    .filter((e) => e.event.startsWith('order ') && e.event.includes('completed at tick'))
    .map((e) => [e.event.split(' ')[1], e.tick] as const);
  assert.deepStrictEqual(done, [['O1', EXP.events.order_completions.O1], ['O2', EXP.events.order_completions.O2]]);
});

test('baseline: key_ticks 43/72/120 snapshots match fixture', () => {
  const { state, records } = run(FIXTURE, PRICE_MID);
  const k43 = records[42], k72 = records[71], k120 = records[119];
  assert.strictEqual(k43.tick, 43);
  assert.strictEqual(k43.crane_busy_task_type, EXP.key_ticks['43'].crane_busy_task_type); // null
  assert.ok(Math.abs(k43.product_yard_t - EXP.key_ticks['43'].product_yard_t) < 1e-9); // 0.0
  assert.ok(Math.abs(k43.dispatched_t - EXP.key_ticks['43'].dispatched_t) < 1e-9); // 49.0
  assert.strictEqual(k72.crane_busy_task_type, EXP.key_ticks['72'].crane_busy_task_type); // null
  assert.ok(Math.abs(k72.product_yard_t - EXP.key_ticks['72'].product_yard_t) < 1e-9); // 0.0
  assert.ok(Math.abs(k72.dispatched_t - EXP.key_ticks['72'].dispatched_t) < 1e-9); // 88.2
  assert.strictEqual(k120.tick, 120);
  assert.ok(Math.abs(state.billet_yard_t - EXP.key_ticks['120'].billet_yard_t) < 1e-9); // 0.0
  assert.ok(Math.abs(k120.product_yard_t - EXP.key_ticks['120'].product_yard_t) < 1e-9); // 0.0
  assert.ok(Math.abs(k120.dispatched_t - EXP.key_ticks['120'].dispatched_t) < 1e-9); // 98.0
  // mirror's mill_in_process_t == mill residence batch (mirror state has no separate field)
  assert.ok(Math.abs(state.mill.batch_t - EXP.key_ticks['120'].mill_in_process_t) < 1e-9); // 0.0
});

test('baseline: ALL counters_at_tick_120 fields match fixture', () => {
  const { state } = run(FIXTURE, PRICE_MID);
  const expC = EXP.counters_at_tick_120;
  const gotC = state.counters as Record<string, unknown>;
  const failures: string[] = [];
  for (const key of Object.keys(expC)) {
    if (key === 'revenue_note') continue; // narrative note, not a value
    const want = expC[key] as number;
    const got = gotC[key] as number;
    assert.ok(typeof got === 'number', `counter ${key} missing in TS port`);
    const tol = 1e-6; // fixture presents mirror floats rounded (98.0/2.0/62230.0);
    if (Math.abs(got - want) > tol) failures.push(`${key}: got ${got}, want ${want}`);
  }
  assert.ok(failures.length === 0, 'counter parity failures:\n' + failures.join('\n'));
  // explicit spot-checks of the headline numbers named in the fixture note
  assert.strictEqual(state.counters.dispatch_moves_blocked, 63);
  assert.strictEqual(state.counters.dispatch_moves_blocked_empty, 63);
  assert.ok(Math.abs(state.counters.revenue_usd - 62230.0) < 1e-6); // 98.0 t x 635.0 B500B mid
});

test('baseline: balance identity closes at end within fixture tolerance', () => {
  const { state } = run(FIXTURE, PRICE_MID);
  assert.ok(Math.abs(state.balance_error - EXP.material_balance.balance_error_at_end) < EXP.material_balance.tolerance); // 0.0 @ 1e-6
});

test('baseline: balance identity holds every tick (mirror semantics — in-flight tonnage is not a leak)', () => {
  const { records } = run(FIXTURE, PRICE_MID);
  assert.strictEqual(records.length, 120);
  // Mirror stage-6 raw identity per tick: opening - carrier_in_transit - mill_residence - product_yard
  // - dispatched - yield_loss. Mid-run it carries in-flight tonnage (e.g. a roll whose batch was
  // drained at roll start while the roll is still busy); the mirror's own balance_error field is the
  // record of that, and it closes (<1e-6) at end — asserted separately in the end-of-run test.
  const entered = FIXTURE.scenario.billet_yard.initial_billet_t;
  let st = freshState(FIXTURE);
  for (const o of FIXTURE.scenario.orders) {
    st.orders.push({ order_id: o.order_id, product_grade: o.product_grade, required_t: o.required_t, deadline_tick: o.deadline_tick, dispatched_t: 0.0, status: 'open', priority: 2 });
  }
  for (let i = 0; i < 120; i++) {
    st = tick(st, FIXTURE, PRICE_MID);
    const raw = entered - st.carrier.batch_t - st.mill.batch_t - st.product_yard_t
      - st.counters.dispatched_t_total - st.counters.yield_loss_t;
    assert.ok(Math.abs(raw - st.balance_error) < 1e-9, `tick ${st.tick}: TS raw balance ${raw} != mirror-formula ${st.balance_error}`);
    assert.deepStrictEqual(records[i], {
      tick: st.tick,
      crane_busy_task_type: st.crane.busy_task_id ? (st.tasks.find((t) => t.task_id === st.crane.busy_task_id)!.task_type as string) : null,
      product_yard_t: pyRound(st.product_yard_t, 6),
      dispatched_t: pyRound(st.counters.dispatched_t_total, 6),
      balance_error: pyRound(st.balance_error, 9),
      events: st.events.filter((e) => e.tick === st.tick).map((e) => e.event),
    }, `tick ${st.tick}: per-tick record mismatch vs mirror`);
  }
});

test('baseline: event vocabulary strings match fixture notes', () => {
  const { state } = run(FIXTURE, PRICE_MID);
  const all = new Set(state.events.map((e) => e.event));
  // lazy enqueue rule: empty-yard attempts are recorded refusals, never queued forever
  assert.ok([...all].some((e) => e === 'dispatch move refused — product yard empty (attempt recorded)'));
  // competing task outranks dispatch while queued (priority 1 vs default 2)
  assert.ok([...all].some((e) => e.startsWith('competing reclaiming task enters crane queue (priority 1)')));
  // cancellation path exists in the mirror but is UNREACHABLE in the baseline: dispatch tasks are
  // only lazily enqueued for open/partial orders and re-enqueue happens only while partial, so no
  // queued task ever faces a completed order. Mirror-verified: zero 'cancelled' events in baseline.
  assert.ok(![...all].some((e) => e.includes('already closed')));
  // non-preemptive contention event
  assert.ok([...all].some((e) => e === 'crane starts reclaiming task (non-preemptive — dispatch waits)'));
  // baseline asserts NO capacity refusals (capacity 60 t unreachable under lazy dispatch)
  assert.strictEqual(state.counters.product_yard_refusals, 0);
  assert.ok(![...all].some((e) => e.includes('refused (recorded)')));
});

test('pure tick: input state never mutated', () => {
  const st0 = freshState(FIXTURE);
  const before = JSON.stringify(st0);
  const st1 = tick(st0, FIXTURE, PRICE_MID);
  assert.strictEqual(JSON.stringify(st0), before, 'input state was mutated');
  assert.notStrictEqual(JSON.stringify(st1), before, 'tick produced no change');
});

// ---------- negative controls (fixture-documented variants) ----------

test('N1 no-billet starvation: initial_billet_t=0 -> rolls 0, dispatch 0, balance closed', () => {
  const fx1 = withScenario((c) => { c.billet_yard.initial_billet_t = 0.0; });
  const { state } = run(fx1, PRICE_MID, { max_dispatch_moves: targetMoves(FIXTURE) });
  const nc = EXP.negative_controls.no_billet_stock;
  assert.strictEqual(state.counters.rolls_completed, nc.rolls_completed); // 0
  assert.strictEqual(state.counters.dispatch_moves_completed, nc.dispatch_moves_completed); // 0
  assert.ok(nc.balance_closed && Math.abs(state.balance_error) < 1e-6); // blocked-attempt counters are NOT inventory terms
});

test('N2 crane never releases: dispatch completions diverge from healthy (completion divergence only)', () => {
  // Documented weakness (fixture negative_controls.crane_never_releases.weakness_note): under lazy
  // enqueue a stuck crane never re-attempts against an empty yard, so crane_wait_ticks stays 0 —
  // control validity rests ONLY on the completion divergence. No crane_wait assertion here.
  const fx2 = withScenario((c) => { c.dispatch_crane.move_ticks = 1e6; });
  const target = targetMoves(FIXTURE);
  const broken = run(fx2, PRICE_MID, { max_dispatch_moves: target }).state;
  const healthy = run(FIXTURE, PRICE_MID, { max_dispatch_moves: target }).state;
  assert.strictEqual(broken.counters.dispatch_moves_completed, EXP.negative_controls.crane_never_releases.dispatch_moves_completed); // 0
  assert.ok(EXP.negative_controls.crane_never_releases.diverges_from_healthy && healthy.counters.dispatch_moves_completed > 0); // 10
  assert.strictEqual(broken.counters.crane_wait_ticks, 0); // pinned documented weakness (not an assertion of strength)
});

test('N3 capacity refusal reachability: capacity 5.0 t -> 10 refusals at roll-completion ticks, no tonne unaccounted', () => {
  // Fixture-documented re-tuned variant: "capacity 5 t -> 10 refusals at roll-completion ticks
  // [11,18,...,74] with balance closed". The capacity-40 control as previously scripted does NOT
  // fire under lazy dispatch (drain matches production cadence); baseline asserts refusals == 0.
  const fx3 = withScenario((c) => { c.product_yard.capacity_t = 5.0; });
  const { state } = run(fx3, PRICE_MID);
  assert.strictEqual(state.counters.product_yard_refusals, 10);
  const refusalTicks = [...new Set(state.events.filter((e) => e.event.includes('refused (recorded)')).map((e) => e.tick))].sort((a, b) => a - b);
  assert.deepStrictEqual(refusalTicks, [11, 18, 25, 32, 39, 46, 53, 60, 67, 74]);
  // "balance closed" = no tonne unaccounted: refused tonnes are recorded events (not silently
  // dropped), so the full identity closes once refusals are counted as a terminal sink. The bare
  // mirror balance_error then equals exactly the refused tonnage (98.0 t) — asserted explicitly.
  const entered = FIXTURE.scenario.billet_yard.initial_billet_t;
  const productPerRoll = (FIXTURE.scenario.rebar_mill.batch_t_per_move * (100.0 - FIXTURE.scenario.rebar_mill.yield_loss_pct)) / 100.0;
  const refusedT = state.counters.product_yard_refusals * productPerRoll;
  const full = entered - state.billet_yard_t - state.carrier.batch_t - state.mill.batch_t - state.product_yard_t
    - state.counters.dispatched_t_total - state.counters.yield_loss_t - refusedT;
  assert.ok(Math.abs(full) < 1e-6, `N3 full-account residual ${full}`);
  assert.ok(Math.abs(state.balance_error - refusedT) < 1e-6, `N3 bare residual ${state.balance_error} != refused tonnage ${refusedT}`);
});

test('N4 double-count seam: resident-yard variant (dispatch_crane.move_ticks=10) diverges', () => {
  // Fixture-documented variant: under lazy dispatch the baseline yard drains to 0 by tick 120, so
  // the control run gives the crane a slower move (move_ticks=10 -> 8.4 t resident) for the broken
  // rule to diverge (-8.4 residual). Baseline-form control is weak — documented.
  const fx4 = withScenario((c) => { c.dispatch_crane.move_ticks = 10; });
  const healthy = run(fx4, PRICE_MID).state;
  const broken = run(fx4, PRICE_MID, { double_count: true }).state;
  assert.ok(Math.abs(healthy.balance_error - EXP.negative_controls.double_count_control.healthy_residual) < 1e-6); // ~0
  assert.ok(broken.balance_error < -8, `broken residual ${broken.balance_error} not < -8`); // mirror-derived: -8.4
  assert.ok(Math.abs(broken.product_yard_t - 8.4) < 1e-9); // resident yard that the seam double-counts
});

test('seam semantics: max_dispatch_moves gates ONLY post-completion re-enqueue (mirror line 266)', () => {
  const target = targetMoves(FIXTURE); // sum ceil(required/batch) = 9
  const without = run(FIXTURE, PRICE_MID).state;
  assert.strictEqual(without.counters.dispatch_moves_completed, 10); // no seam: 10th move re-enqueued past target
  // Mirror gate: `cnt['dispatch_moves_completed'] < max_dispatch_moves` is evaluated AFTER a
  // completion (mirror line 266), so completions up to and including the limit always run; the
  // seam blocks only the NEXT re-enqueue. Mirror-verified sweep of seams 1..11: every one still
  // completes all 10 moves — in this baseline O3's stock (48 t) admits exactly 5 dispatch tasks,
  // so no queued task survives past the gate to be suppressed. The seam is a re-enqueue gate,
  // not a completion cap; production runs pass neither seam.
  for (const seam of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    const s = run(FIXTURE, PRICE_MID, { max_dispatch_moves: seam }).state;
    assert.strictEqual(s.counters.dispatch_moves_completed, 10, `seam ${seam}: completions diverged from mirror`);
  }
});

// ---------- validate_scenario raises ----------

test('validateScenario raises on every invalid input class (mirror messages pinned)', () => {
  const cases: Array<[string, (c: any) => void, string]> = [
    ['zero seed', (c) => { c.seed = 0; }, 'zero seed rejected'],
    ['ticks zero', (c) => { c.ticks = 0; }, 'ticks must be positive'],
    ['ticks negative', (c) => { c.ticks = -5; }, 'ticks must be positive'],
    ['rebar_mill.batch_t_per_move zero', (c) => { c.rebar_mill.batch_t_per_move = 0; }, 'rebar_mill.batch_t_per_move must be positive'],
    ['rebar_mill.roll_ticks negative', (c) => { c.rebar_mill.roll_ticks = -1; }, 'rebar_mill.roll_ticks must be positive'],
    ['rebar_mill.yield_loss_pct zero', (c) => { c.rebar_mill.yield_loss_pct = 0; }, 'rebar_mill.yield_loss_pct must be positive'],
    ['billet_carrier.batch_t_per_move zero', (c) => { c.billet_carrier.batch_t_per_move = 0; }, 'billet_carrier.batch_t_per_move must be positive'],
    ['billet_carrier.move_ticks zero', (c) => { c.billet_carrier.move_ticks = 0; }, 'billet_carrier.move_ticks must be positive'],
    ['dispatch_crane batch zero', (c) => { c.dispatch_crane.batch_t_per_move = 0; }, 'dispatch_crane batch/move must be positive'],
    ['dispatch_crane move zero', (c) => { c.dispatch_crane.move_ticks = 0; }, 'dispatch_crane batch/move must be positive'],
    ['product_yard.capacity_t zero', (c) => { c.product_yard.capacity_t = 0; }, 'product_yard.capacity_t must be positive'],
    ['order required_t zero', (c) => { c.orders[0].required_t = 0; }, 'order O1: required_t and deadline_tick must be positive'],
    ['order deadline_tick zero', (c) => { c.orders[1].deadline_tick = 0; }, 'order O2: required_t and deadline_tick must be positive'],
  ];
  for (const [name, mut, msg] of cases) {
    const fx = withScenario(mut);
    assert.throws(() => validateScenario(fx), (err: unknown) => {
      const m = err instanceof Error ? err.message : String(err);
      if (!m.includes(msg)) {
        assert.fail(`${name}: error message "${m}" does not contain "${msg}"`);
      }
      return true;
    }, `${name}: expected validateScenario to raise`);
  }
  // valid scenario passes
  assert.strictEqual(validateScenario(FIXTURE), true);
});
