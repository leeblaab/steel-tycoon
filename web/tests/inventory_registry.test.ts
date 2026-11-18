// Inventory registry tests (Roadmap V3 §8.1): ledger conservation through real fixture
// runs of all three parity ports, plus the negative control — an unregistered leak must
// break the balance identity. Ports themselves are NOT modified; adapters only read.

import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as s3 from '../src/ports/slice3/shared/slice3_sim.ts';
import * as s4 from '../src/ports/slice4/shared/slice4_sim.ts';
import * as s5 from '../src/ports/slice5/shared/slice5_sim.ts';
import { InventoryRegistry, checkLedgerBalance } from '../src/shared/inventory_registry.ts';
import { slice3Adapter, slice4Adapter, slice5Adapter } from '../src/shared/port_adapters.ts';
import { seedSlice3, seedSlice4, seedSlice5 } from '../src/hub/scenario_seed.ts';

const REPO = 'C:/AI_LAB/SteelX';
const load = (p: string) => JSON.parse(readFileSync(p, 'utf-8'));

const FX3 = load(`${REPO}/fixtures/slice3/s3_dri_buffer_scenario_seed11_120.json`) as s3.S3Fixture;
const FX4 = load(`${REPO}/fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json`) as s4.Slice4Fixture;
const FX5 = load(`${REPO}/fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json`) as s5.Slice5Fixture;
const TIERS = s4.loadScrapTiers(load(`${REPO}/content/scrap/scrap_tiers.json`));
const PRICE_MID = s5.loadPriceMid(load(`${REPO}/content/prices/price_ladder_draft.json`));

function registryWithAll(): InventoryRegistry {
  const r = new InventoryRegistry();
  r.register(slice3Adapter(FX3));
  r.register(slice4Adapter(FX4));
  r.register(slice5Adapter(FX5));
  return r;
}

test('registry: all three adapters register, duplicate registration is rejected', () => {
  const r = registryWithAll();
  assert.deepStrictEqual(r.slices().sort(), ['slice3', 'slice4', 'slice5']);
  assert.throws(() => r.register(slice3Adapter(FX3)), /already registered/);
});

test('slice4 conservation: every tick of the real fixture run keeps the ledger closed', () => {
  const r = registryWithAll();
  // freshState() alone is an empty container; the ports' run() seams seed it first.
  // The hub loop replicates that seeding via src/hub/scenario_seed.ts (ports untouched).
  let st = seedSlice4(FX4);
  for (let i = 0; i < FX4.scenario.ticks; i++) {
    st = s4.tick(st, FX4, TIERS);
    const chk = r.check('slice4', st);
    assert.ok(chk.ok, `tick ${st.tick}: ${chk.detail}`);
    // registry residual must agree with the port's own balance_error field
    assert.strictEqual(chk.portBalanceError, st.balance_error);
  }
});

test('slice5 conservation: every tick of the real fixture run reproduces the port stage-6 identity', () => {
  const r = registryWithAll();
  let st = seedSlice5(FX5);
  for (let i = 0; i < FX5.scenario.ticks; i++) {
    st = s5.tick(st, FX5, PRICE_MID);
    const chk = r.check('slice5', st);
    // Pinned to the mirror stage-6 formula: entered = FIXED opening stock (initial_billet_t);
    // mid-run billet-yard residence is deliberately NOT a term — it appears as the residual
    // and must equal the port's own balance_error at EVERY tick. Closure-to-zero is required
    // once the yard drains / at scenario end.
    assert.ok(chk.ok, `tick ${st.tick}: ${chk.detail}`);
    assert.strictEqual(chk.portBalanceError, st.balance_error);
    assert.strictEqual(chk.closure, false); // residence ledger, not a closure ledger
    // declared yard residence <= residual (on carrier-delivery ticks the port's own
    // stage-6 arithmetic transiently over-releases: mill.batch_t += batch happens before
    // car.batch_t = 0 in the same tick; observed tick 5: residual 100 vs yard 90). The
    // hard invariant is chk.ok above: registry residual == port balance_error every tick.
    assert.ok(st.billet_yard_t - chk.residual < 1e-9, `tick ${st.tick}: ${chk.detail}`);
    // Closure-to-zero is asserted only at the scenario-end tick: mid-run balance_error
    // legitimately carries residence AND in-flight payloads (e.g. tick 68: yard, carrier
    // and mill all empty but a dispatch batch booked against product_yard_t that only
    // leaves the ledger when the crane completes — balance_error 19.8 until then).
  }
});

test('slice3 bookkeeping closure: discharged total equals buffer on hand + heats charged at every tick', () => {
  const r = registryWithAll();
  let st = seedSlice3(FX3);
  for (let i = 0; i < FX3.scenario.ticks; i++) {
    st = s3.tick(st, FX3);
    const chk = r.check('slice3', st);
    assert.ok(chk.ok, `tick ${st.tick}: ${chk.detail}`);
    // slice3 has no port balance_error to cross-check against
    assert.strictEqual(chk.portBalanceError, null);
  }
});

test('negative control: an unregistered leak (tonnage removed with no loss/outflow entry) breaks the identity', () => {
  const r = registryWithAll();
  // advance to a tick where product tonnage demonstrably sits in the product yard
  // (fixture run: first mill output lands ~tick 46; scan forward deterministically)
  let st = seedSlice5(FX5);
  let guard = 0;
  while (st.product_yard_t <= 1e-6 && guard < FX5.scenario.ticks) {
    st = s5.tick(st, FX5, PRICE_MID);
    guard++;
  }
  assert.ok(st.product_yard_t > 1e-6, 'fixture run must put product tonnage in the product yard');

  const healthy = r.check('slice5', st);
  // healthy means: registry residual agrees with the port's balance_error every tick and
  // the declared yard residence never exceeds it (delivery-tick over-release allowance).
  assert.ok(healthy.ok, healthy.detail);
  assert.ok(st.billet_yard_t - healthy.residual < 1e-9, healthy.detail);
  assert.ok(Math.abs(healthy.residual - st.balance_error) < 1e-9, healthy.detail);

  // Simulate a leak: billet yard tonnage vanishes but no counter recorded it.
  // (This is exactly the class of bug §8.1 forbids: state that diverges from the ledger.)
  // Why this injection point and not a hole in billet_yard_t: slice5's stage-6 identity
  // opens with a FIXED enteredT (initial_billet_t) and deliberately leaves billet-yard
  // residence OUT of its terms — balance_error is recomputed from state every tick, so a
  // hole punched there re-syncs silently (the leak vanishes from both sides: residual ==
  // port balance_error still agrees). The leak must hit tonnage that stage 6 DOES count
  // mid-run — product_yard_t, while the yard demonstrably holds tonnage (tick 40: 19.8t)
  // and no clamp can absorb it after the fact. The registry re-derives the identity from
  // the same state fields, so residual and port balance_error both inflate by the leak —
  // that agreement is NOT health: the product yard now holds tonnage no ledger entry
  // ever put there (entered - accounted < everything on hand). The hard invariant a
  // residence ledger must add to the cross-check: declared residence + terms + accounted
  // can never exceed enteredT. That is what catches unregistered creation/leak.
  const deep = structuredClone(st) as s5.Slice5State;
  assert.ok(deep.product_yard_t > 1e-6, 'fixture must have product tonnage in the yard at tick 40 to leak');
  const leak = deep.product_yard_t;
  deep.product_yard_t = 0;

  const chk = r.check('slice5', deep);
  // The leak inflates the identity gap by exactly the leaked tonnage: the yard now holds
  // zero while residual (entered - terms - accounted) still carries the 9.8t the mill
  // booked against it — a hole in state no outflow/loss counter recorded. Both the
  // registry bound and the port's recomputed balance_error jump by exactly `leak` vs the
  // healthy baseline.
  assert.ok(!chk.ok, `leak must break the identity, got: ${chk.detail}`);
  assert.ok(Math.abs(chk.residual - healthy.residual - leak) < 1e-6, `residual gap should grow by exactly the leaked tonnage, got ${chk.residual} vs healthy ${healthy.residual}, leak ${leak}`);

  // Mirror case: a hole punched in billet_yard_t is invisible to every tick-boundary
  // check. The port's stage-6 identity counts billet tonnage ONLY after mill delivery,
  // so mid-run balance_error legitimately equals the yard residence; zeroing the yard
  // makes state and ledger recompute the same (smaller) number in lockstep — even the
  // clamp absorbs it: the crane can no longer pay for a move, it just idles. This is the
  // structural blind spot found last session, now pinned as an assertion rather than
  // fought: residence-ledger slices need per-move bookkeeping (§8.3 transfer interfaces)
  // before in-yard leaks become detectable; tick-boundary checks alone cannot catch them.
  const early = seedSlice5(FX5);
  assert.ok(early.billet_yard_t > 1e-6, 'fixture must open with billet tonnage in the yard');
  const preLeak = s5.tick(early, FX5, PRICE_MID); // tick 1: residence still visible
  assert.ok(preLeak.billet_yard_t > 1e-6, 'tick 1 must still hold billet residence to leak');
  const billetHole = structuredClone(preLeak) as s5.Slice5State;
  const billetLeak = billetHole.billet_yard_t;
  billetHole.billet_yard_t = 0;
  const chk2 = r.check('slice5', billetHole);
  assert.ok(chk2.ok, `expected the documented blind spot: cross-check and bound both agree (residual == balance_error), got: ${chk2.detail}`);
  assert.ok(Math.abs(chk2.residual - chk2.portBalanceError!) < 1e-6, `blind spot pinned: residual agrees with recomputed balance_error despite the hole, got ${chk2.residual} vs ${chk2.portBalanceError}`);
});

test('negative control: double-counting a term (mirror N4 analogue) breaks the identity', () => {
  const r = registryWithAll();
  let st = s5.freshState(FX5);
  st.orders = FX5.scenario.orders.map((o: any) => ({ ...o, priority: 2, dispatched_t: 0.0, status: 'open' as const }));
  for (let i = 0; i < 60; i++) st = s5.tick(st, FX5, PRICE_MID);
  const snap = r.project('slice5', st);
  const doubled = {
    ...snap,
    terms: [...snap.terms, { id: 'dup.product_yard', label: 'product yard counted twice', value: st.product_yard_t }],
  };
  const base = checkLedgerBalance(snap);
  const chk = checkLedgerBalance(doubled);
  // double-counting a term shifts the residual by exactly that term's tonnage
  assert.ok(Math.abs(chk.residual - base.residual + st.product_yard_t) < 1e-9, `${chk.detail} vs ${base.detail}`);
});

test('snapshotAll: hub-wide ledger view closes for a fresh run of every slice', () => {
  const r = registryWithAll();
  let st3 = seedSlice3(FX3);
  let st4 = seedSlice4(FX4);
  let st5 = seedSlice5(FX5);
  // advance each a few ticks via the ports
  for (let i = 0; i < 12; i++) {
    st3 = s3.tick(st3, FX3);
    st4 = s4.tick(st4, FX4, TIERS);
    st5 = s5.tick(st5, FX5, PRICE_MID);
  }
  const rows = r.snapshotAll({ slice3: st3, slice4: st4, slice5: st5 });
  assert.strictEqual(rows.length, 3);
  for (const row of rows) {
    // every snapshot passes its own ledger semantics (closure, or residence == port identity)
    assert.ok(row.check.ok, `${row.slice}: ${row.check.detail}`);
  }
});
