// Slice 1 hub port tests (Phase-1 deferred item #1 wiring, 2026-10-19): the hub-facing
// wrapper over ops_domain3 must be deterministic across save/restore boundaries and its
// ledger identity (arrived_t == yard_stock_t + dispatched_t) must close at EVERY tick —
// same invariant the hub registry enforces live. The parity fixture run (FixedDraws seam,
// dispatch-cap scenario) stays in parity_slice1.test.ts untouched; this port plays the
// LIVE scenario: content config cadence values, real per-tick xorshift32 draws.

import { test } from 'vitest';
import assert from 'node:assert';
import { freshSlice1HubState, advanceSlice1HubState, runSlice1HubTicks } from '../src/ports/slice1/slice1_hub.ts';
import { slice1Adapter } from '../src/shared/port_adapters.ts';
import { InventoryRegistry } from '../src/shared/inventory_registry.ts';
import { writeSave, loadSave, MemorySaveStorage, SNAPSHOT_SCHEMA_VERSION } from '../src/shared/save_load.ts';

test('slice1 hub fresh state: seed 11 inside generator_state, tick/events contract shape', () => {
  const st = freshSlice1HubState();
  assert.strictEqual(st.tick, 0);
  assert.deepStrictEqual(st.events, []);
  assert.strictEqual(st.generator_state, 11); // canonical word INSIDE the state (slice3 prng_state analogue)
  assert.strictEqual(st.yard_stock_t, 0.0);
});

test('slice1 hub: ledger closure at every tick over 120 ticks (registry re-derivation)', () => {
  const registry = new InventoryRegistry();
  registry.register(slice1Adapter());
  let st = freshSlice1HubState();
  for (let t = 1; t <= 120; t++) {
    st = advanceSlice1HubState(st);
    const chk = registry.check('slice1', st);
    assert.ok(chk.ok, `tick ${t}: ${chk.detail}`);
    assert.ok(chk.closure, 'slice1 ledger is a full closure identity');
  }
});

test('slice1 hub: JSON round-trip mid-run restores an identical continuation (save/load guarantee)', () => {
  const storage = new MemorySaveStorage();
  const mid = runSlice1HubTicks(50);
  writeSave(storage, 'main', 'slice1', mid);
  const save = loadSave(storage, 'main', { knownSliceIds: ['slice1'], validate: () => {} });
  assert.strictEqual(save.schema_version, SNAPSHOT_SCHEMA_VERSION);
  assert.strictEqual(save.rng_state.word, mid.generator_state); // capture sees generator_state (ops word)
  const resumed = save.state as ReturnType<typeof freshSlice1HubState>;
  let a = resumed; // continuation from the restored state
  let b = runSlice1HubTicks(50); // continuation from an uninterrupted run to the same tick
  for (let t = 51; t <= 120; t++) {
    a = advanceSlice1HubState(a);
    b = advanceSlice1HubState(b);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), `tick ${t} continuation diverged`);
  }
});

test('slice1 hub: live scenario events include arrival and depart (no interventions)', () => {
  const st = runSlice1HubTicks(48); // depart lands at tick 47, next arrival at 48 — 48 covers both edges
  // Event log is the ticks of the LAST advance only (loop contract); cumulative
  // counters prove both edges fired: arrivals at day boundaries, depart when a hold empties.
  assert.ok(st.ships_arrived > 0, 'berth arrivals fire on day boundaries');
  assert.ok(st.ships_departed > 0, 'ships depart when their hold empties');
});
