import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  freshState, loadConfigFromFile, loadScrapConfig, tickProductionCore, balanceError,
} from './production_core.js';

// Parity harness: both Python (mirror) and TS read the SAME fixture file.
const FIXTURE = JSON.parse(readFileSync('C:/AI_Lab/SteelX/fixtures/production_core/d1_scrap_20heats_seed11.json', 'utf-8'));
const SCRAP_PATH = 'C:/AI_Lab/SteelX/content/scrap/scrap_tiers.json';
const NODES_PATH = 'C:/AI_Lab/SteelX/content/nodes/nodes_phase1.json';

test('fixture schema contract fields present', () => {
  for (const f of ['fixture_id', 'schema_version', 'domain', 'seed', 'prng', 'asset_order',
                   'initial_state', 'actions', 'tick_count', 'expected_outputs', 'tolerance', 'status'])
    assert.ok(f in FIXTURE, `missing fixture field ${f}`);
  assert.strictEqual(FIXTURE.prng, 'xorshift32');
  assert.deepStrictEqual(FIXTURE.asset_order, ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane']);
});

test('parity fixture d1_scrap_20heats_seed11: TS matches Python mirror exactly', () => {
  const cfg = loadConfigFromFile(SCRAP_PATH, NODES_PATH);
  // Replay from the fixture's recorded initial_state — not a hand-built state.
  const st0 = structuredClone(FIXTURE.initial_state);
  assert.strictEqual(st0.generator_state, FIXTURE.seed); // fixture pins generator state = seed
  let st = st0;
  // REBUILT CLEAN 2026-10-12 (Yasser GO): the prior fixture recorded a continuation of
  // the mirror's import-time baseline run (40 heats against 20 actions). The clean
  // fixture runs 20 ticks from a fresh state; generator_state 2632950184 = 120 draws
  // (6/tick x 20 ticks, canonical contract). The failing run is preserved in git
  // history (commit af568c4 + DIVERGENCE_REPORT.md). Assertion unchanged, not weakened.
  for (const action of FIXTURE.actions) st = tickProductionCore(st, cfg, action);
  assert.strictEqual(st.tick, FIXTURE.tick_count, 'replayed tick count mismatch');

  const tol = FIXTURE.tolerance;
  const exp = FIXTURE.expected_outputs;
  const failures: string[] = [];
  const check = (key: string, got: number, want: number) => {
    const t = key.includes('usd') ? tol.usd : tol.tonnes;
    if (Math.abs(got - want) > t) failures.push(`${key}: got ${got}, want ${want}`);
  };
  for (const [key, want] of Object.entries(exp)) {
    const got = (st as any)[key];
    if (key === 'purchased_t') {
      for (const [g, w] of Object.entries(want as Record<string, number>))
        check(`purchased_t.${g}`, (st.purchased_t as any)[g], w);
    } else if (typeof want === 'number') {
      check(key, got as number, want);
    } else {
      assert.strictEqual(got, want, `categorical mismatch ${key}`); // categorical exact
    }
  }
  // balance_error is computed by the port, not carried in state — mirror formula.
  check('balance_error', balanceError(st), exp.balance_error);
  assert.ok(failures.length === 0, 'parity failures:\n' + failures.join('\n'));
});

test('pure tick: input state never mutated', () => {
  const cfg = loadConfigFromFile(SCRAP_PATH, NODES_PATH);
  const st0 = freshState(11, cfg);
  const before = JSON.stringify(st0);
  const st1 = tickProductionCore(st0, cfg, { tick: 1, charge_cells: [['hms1_hms2', 'hms', 40.0]] });
  assert.strictEqual(JSON.stringify(st0), before, 'input state was mutated');
  assert.notStrictEqual(JSON.stringify(st1), before, 'tick produced no change');
});

test('reject-never-default loader: malformed config rejected, no silent defaults', () => {
  const good = JSON.parse(readFileSync(SCRAP_PATH, 'utf-8'));
  const bad = structuredClone(good);
  bad.schema_version = 2;
  assert.throws(() => loadScrapConfig(bad), /schema_version/);
  const bad2 = structuredClone(good);
  bad2.grades[0].price_usd_t = '340'; // string swapped for number
  assert.throws(() => loadScrapConfig(bad2), /price_usd_t/);
  // healthy file still validates clean
  loadScrapConfig(good);
});
