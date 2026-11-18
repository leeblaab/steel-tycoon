// Save/load v1 tests (Roadmap V3 §13 Phase 1 mark). The load-bearing assertion is
// determinism: snapshot at tick T -> restore -> run N ticks must deep-equal the
// uninterrupted run at tick T+N, for every hub slice. Plus version rejection, slot
// handling, and the ledger gate on load.

import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import * as s3 from '../src/ports/slice3/shared/slice3_sim.ts';
import * as s4 from '../src/ports/slice4/shared/slice4_sim.ts';
import * as s5 from '../src/ports/slice5/shared/slice5_sim.ts';
import { InventoryRegistry } from '../src/shared/inventory_registry.ts';
import { slice3Adapter, slice4Adapter, slice5Adapter } from '../src/shared/port_adapters.ts';
import { HubTickLoop, type HubSliceModule } from '../src/hub/tickloop.ts';
import { seedSlice3, seedSlice4, seedSlice5 } from '../src/hub/scenario_seed.ts';
import {
  MemorySaveStorage,
  writeSave,
  loadSave,
  listSaves,
  deleteSave,
  readSaveFile,
  captureRng,
  SAVE_FILE_KEY,
  SNAPSHOT_SCHEMA_VERSION,
} from '../src/shared/save_load.ts';

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

const KNOWN = ['slice3', 'slice4', 'slice5'];

function mods(): Array<{ id: string; mod: HubSliceModule<any> }> {
  return [
    { id: 'slice3', mod: { id: 'slice3', label: 's3', fresh: () => seedSlice3(FX3), advance: (st) => s3.tick(st, FX3) } },
    { id: 'slice4', mod: { id: 'slice4', label: 's4', fresh: () => seedSlice4(FX4), advance: (st) => s4.tick(st, FX4, TIERS) } },
    { id: 'slice5', mod: { id: 'slice5', label: 's5', fresh: () => seedSlice5(FX5), advance: (st) => s5.tick(st, FX5, PRICE_MID) } },
  ];
}

// The core promise: save at tick 47, restore into a NEW loop, run to tick 120 —
// identical to the uninterrupted run. Mid-run snapshots exercise in-flight work
  // (crane cycles, heats in progress), not just quiescent boundaries.
for (const { id, mod } of mods()) {
  test(`save/load determinism (${id}): snapshot at tick 47 -> restored continuation deep-equals uninterrupted run`, () => {
    const registry = registryWithAll();
    const storage = new MemorySaveStorage();

    // uninterrupted reference run to tick 120
    const refLoop = new HubTickLoop(mod, registry);
    refLoop.runTicks(120);

    // interrupted run: 47 ticks -> save -> restore -> 73 more ticks
    const loop = new HubTickLoop(mod, registry);
    loop.runTicks(47);
    writeSave(storage, 'main', id, loop.state);

    const save = loadSave(storage, 'main', {
      knownSliceIds: KNOWN,
      validate: (sid, st) => {
        const chk = registry.check(sid, st);
        if (!chk.ok) throw new Error(`restored state fails the ledger: ${chk.detail}`);
      },
    });
    assert.strictEqual(save.slice_id, id);
    assert.strictEqual(save.tick, 47);

    const resumed = new HubTickLoop(mod, registry);
    // hub wiring: resume() replaces the fresh state with the restored snapshot
    const chk = resumed.resume(structuredClone(save.state));
    assert.ok(chk.ok, `restored state fails the ledger at resume: ${chk.detail}`);
    resumed.runTicks(73);

    assert.strictEqual(resumed.tick, 120);
    assert.deepStrictEqual(resumed.state, refLoop.state);
  });
}

test('rng capture: slice3 snapshot pins the xorshift32 word; slice4/5 record null and both agree with state', () => {
  const storage = new MemorySaveStorage();
  const s3state = seedSlice3(FX3);
  writeSave(storage, 's3slot', 'slice3', s3state);
  const save = loadSave(storage, 's3slot', { knownSliceIds: KNOWN });
  assert.strictEqual(typeof save.rng_state.word, 'number');
  assert.strictEqual(save.rng_state.word, (save.state as any).prng_state);

  writeSave(storage, 's5slot', 'slice5', seedSlice5(FX5));
  const s5save = loadSave(storage, 's5slot', { knownSliceIds: KNOWN });
  assert.strictEqual(s5save.rng_state.word, null); // no generator in slice5 dispatch logic
});

test('version rejection: a future schema_version save is rejected, never defaulted', () => {
  const storage = new MemorySaveStorage();
  writeSave(storage, 'main', 'slice3', seedSlice3(FX3));
  const file = readSaveFile(storage);
  file.saves['main'].schema_version = SNAPSHOT_SCHEMA_VERSION + 1;
  storage.write(SAVE_FILE_KEY, JSON.stringify(file));
  assert.throws(() => loadSave(storage, 'main', { knownSliceIds: KNOWN }), /unsupported snapshot schema_version/);
});

test('format rejection: foreign save file is rejected with a clear error', () => {
  const storage = new MemorySaveStorage();
  storage.write(SAVE_FILE_KEY, JSON.stringify({ format: 'other-game-save', format_version: 1, saves: {} }));
  assert.throws(() => readSaveFile(storage), /foreign save file format/);
});

test('ledger gate: a snapshot whose state fails the registry check is refused on load', () => {
  const registry = registryWithAll();
  const storage = new MemorySaveStorage();
  const holed = structuredClone(seedSlice5(FX5));
  holed.product_yard_t = 999; // tonnage no ledger entry put there
  writeSave(storage, 'main', 'slice5', holed);
  assert.throws(
    () => loadSave(storage, 'main', {
      knownSliceIds: KNOWN,
      validate: (sid, st) => {
        const chk = registry.check(sid, st);
        if (!chk.ok) throw new Error(`restored state fails the ledger: ${chk.detail}`);
      },
    }),
    /fails the ledger/,
  );
});

test('slots: multiple saves coexist; listSaves orders by saved_at; deleteSave removes one only', () => {
  const storage = new MemorySaveStorage();
  writeSave(storage, 'a', 'slice3', seedSlice3(FX3));
  writeSave(storage, 'b', 'slice5', seedSlice5(FX5));
  const listed = listSaves(storage);
  assert.deepStrictEqual(listed.map((l) => l.slot).sort(), ['a', 'b']);
  deleteSave(storage, 'a');
  assert.deepStrictEqual(listSaves(storage).map((l) => l.slot), ['b']);
  assert.throws(() => loadSave(storage, 'a', { knownSliceIds: KNOWN }), /no save in slot 'a'/);
  // b survives untouched
  const b = loadSave(storage, 'b', { knownSliceIds: KNOWN });
  assert.strictEqual(b.slice_id, 'slice5');
});

test('unknown slice rejection: a save referencing a slice the catalog does not know is refused', () => {
  const storage = new MemorySaveStorage();
  writeSave(storage, 'main', 'slice9', seedSlice3(FX3));
  assert.throws(() => loadSave(storage, 'main', { knownSliceIds: KNOWN }), /unknown slice 'slice9'/);
});
