// Hub tick-loop tests (Roadmap V3 §8.1): the hub's authoritative loop must be a pure
// replay of the parity ports — N hub ticks deep-equal N direct port replays, per slice,
// on the real fixtures. Plus reset/step semantics and registry wiring inside the loop.

import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as s3 from '../src/ports/slice3/shared/slice3_sim.ts';
import * as s4 from '../src/ports/slice4/shared/slice4_sim.ts';
import * as s5 from '../src/ports/slice5/shared/slice5_sim.ts';
import { InventoryRegistry } from '../src/shared/inventory_registry.ts';
import { slice1Adapter, slice3Adapter, slice4Adapter, slice5Adapter } from '../src/shared/port_adapters.ts';
import { HubTickLoop, type HubSliceModule } from '../src/hub/tickloop.ts';
import { buildCatalog } from '../src/hub/catalog.ts';
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
  r.register(slice1Adapter());
  r.register(slice3Adapter(FX3));
  r.register(slice4Adapter(FX4));
  r.register(slice5Adapter(FX5));
  return r;
}

// Determinism: hub N-tick advance == direct port replay of the same N ticks.
test('hub loop determinism (slice3): 120 hub ticks deep-equal 120 direct s3.tick replays', () => {
  const mod: HubSliceModule<s3.SimState> = {
    id: 'slice3',
    label: 's3',
    fresh: () => seedSlice3(FX3),
    advance: (st) => s3.tick(st, FX3),
  };
  const loop = new HubTickLoop(mod, registryWithAll());
  loop.runTicks(FX3.scenario.ticks);

  let direct = seedSlice3(FX3);
  for (let i = 0; i < FX3.scenario.ticks; i++) direct = s3.tick(direct, FX3);

  assert.deepStrictEqual(loop.state, direct);
});

test('hub loop determinism (slice4): 120 hub ticks deep-equal 120 direct s4.tick replays', () => {
  const mod: HubSliceModule<s4.Slice4State> = {
    id: 'slice4',
    label: 's4',
    fresh: () => seedSlice4(FX4),
    advance: (st) => s4.tick(st, FX4, TIERS),
  };
  const loop = new HubTickLoop(mod, registryWithAll());
  loop.runTicks(FX4.scenario.ticks);

  let direct = seedSlice4(FX4);
  for (let i = 0; i < FX4.scenario.ticks; i++) direct = s4.tick(direct, FX4, TIERS);

  assert.deepStrictEqual(loop.state, direct);
});

test('hub loop determinism (slice5): 120 hub ticks deep-equal 120 direct s5.tick replays', () => {
  const mod: HubSliceModule<s5.Slice5State> = {
    id: 'slice5',
    label: 's5',
    fresh: () => seedSlice5(FX5),
    advance: (st) => s5.tick(st, FX5, PRICE_MID),
  };
  const loop = new HubTickLoop(mod, registryWithAll());
  loop.runTicks(FX5.scenario.ticks);

  let direct = seedSlice5(FX5);
  for (let i = 0; i < FX5.scenario.ticks; i++) direct = s5.tick(direct, FX5, PRICE_MID);

  assert.deepStrictEqual(loop.state, direct);
});

// NOTE: the slice5 parity port's own stage-6 balance_error uses initial_billet_t as
// `entered`, so mid-run it carries the billet-yard residence (tonnage that has NOT left
// the yard yet). The hub's registry ledger pins the mirror stage-6 formula exactly —
// same fixed opening stock, same terms — so its residual equals the port's balance_error
// at every tick and closes to zero once the yard drains / at scenario end.
test('hub loop matches the ports own run() seam too (slice5 full-run win flag)', () => {
  const mod: HubSliceModule<s5.Slice5State> = {
    id: 'slice5',
    label: 's5',
    fresh: () => seedSlice5(FX5),
    advance: (st) => s5.tick(st, FX5, PRICE_MID),
  };
  const loop = new HubTickLoop(mod, registryWithAll());
  const lastCheck = loop.runTicks(FX5.scenario.ticks);
  // final tick: ledger closed (yard drained / scenario end) and agrees with the port field
  assert.ok(lastCheck.ok, lastCheck.detail);
  assert.ok(Math.abs(lastCheck.residual - loop.state.balance_error) < 1e-9, lastCheck.detail);
  const portRun = s5.run(FX5, PRICE_MID);
  // tick() never writes `win` (only run()'s tail does), so the hub state must deep-equal
  // the port's final state with win normalized to null on both sides.
  const hubState = structuredClone(loop.state);
  const portState = structuredClone(portRun.state);
  assert.strictEqual(hubState.win, null);
  hubState.win = null;
  portState.win = null;
  assert.deepStrictEqual(hubState, portState);
  // and the hub's own win evaluation (mirroring run()'s tail rule) must agree with the
  // port's: this fixture is NOT fully winnable — order O3 lands 'partial' under priority-2
  // seeding, so both compute win === false (web/tests/slice5_parity.test.ts pins it).
  const hubWin = loop.state.orders.every((o) => o.status === 'completed') && Math.abs(loop.state.balance_error) < 1e-6;
  assert.strictEqual(hubWin, portRun.state.win);
  assert.strictEqual(portRun.state.win, false); // O3 partial — pinned by the S5 parity suite
});

test('hub loop step semantics: each step advances exactly one logical tick and logs only new events', () => {
  const mod: HubSliceModule<s5.Slice5State> = {
    id: 'slice5',
    label: 's5',
    fresh: () => seedSlice5(FX5),
    advance: (st) => s5.tick(st, FX5, PRICE_MID),
  };
  const loop = new HubTickLoop(mod, registryWithAll());
  assert.strictEqual(loop.tick, 0);
  loop.step();
  assert.strictEqual(loop.tick, 1);
  const logAfterOne = loop.log.length;
  loop.step();
  assert.strictEqual(loop.tick, 2);
  // no duplicate events across steps: every logged event tick <= current tick, strictly growing
  const ticksSeen = loop.log.map((e) => e.tick);
  for (let i = 1; i < ticksSeen.length; i++) assert.ok(ticksSeen[i] >= ticksSeen[i - 1]);
  assert.ok(loop.log.slice(0, logAfterOne).every((e) => e.tick <= 1));
});

test('hub loop reset returns to a fresh scenario state and clears the log', () => {
  const mod: HubSliceModule<s4.Slice4State> = {
    id: 'slice4',
    label: 's4',
    fresh: () => seedSlice4(FX4),
    advance: (st) => s4.tick(st, FX4, TIERS),
  };
  const loop = new HubTickLoop(mod, registryWithAll());
  loop.runTicks(30);
  assert.strictEqual(loop.tick, 30);
  loop.reset();
  assert.strictEqual(loop.tick, 0);
  assert.strictEqual(loop.log.length, 0);
  assert.deepStrictEqual(loop.state, seedSlice4(FX4));
});

test('hub catalog (as wired in main.tsx) builds and its loops stay ledger-consistent for 60 ticks each', () => {
  const catalog = buildCatalog();
  assert.strictEqual(catalog.length, 4); // slice1 wired 2026-10-19 (Phase-1 deferred item #1)
  const registry = new InventoryRegistry();
  for (const e of catalog) registry.register(e.adapter);
  for (const entry of catalog) {
    const loop = new HubTickLoop(entry.module, registry);
    const chk = loop.runTicks(60);
    // Invariant the hub enforces: each slice's ledger semantics hold at every tick —
    // closure ledgers close to zero; residence ledgers (slice5) keep residual == port
    // balance_error. runTicks checks every tick, so a mid-run divergence fails here.
    assert.ok(chk.ok, `${entry.id}: ${chk.detail}`);
    const be = (loop.state as any).balance_error;
    if (be !== undefined) {
      assert.ok(Math.abs(chk.residual - be) < 1e-9, `${entry.id}: ${chk.detail} vs port balance_error ${be}`);
    }
  }
});
