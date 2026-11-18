// Parity harness — Domain 2 economics: TS port vs frozen Python mirror fixture D2.
// Both sides read the SAME fixture file. Assertions are NOT weakened: every
// expected_outputs field is checked within the fixture tolerance
// (usd 0.01 / tonnes 1e-6 / categorical exact).
import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { freshState, loadEconConfigFromFile, loadPriceLadderFromFile, tickEconomics, sandboxRun, validateEconConfig } from './economics_domain2.js';

const FIXTURE = JSON.parse(readFileSync('C:/AI_Lab/SteelX/fixtures/economics_domain2/d2_econ_30days_seed42.json', 'utf-8'));
const CONFIG_PATH = 'C:/AI_Lab/SteelX/content/economy/economics_domain2.json';
const LADDER_PATH = 'C:/AI_Lab/SteelX/content/prices/price_ladder_draft.json';

test('fixture schema contract fields present', () => {
  for (const f of ['fixture_id', 'schema_version', 'domain', 'prng', 'asset_order',
                   'initial_state', 'actions', 'tick_count', 'expected_outputs', 'tolerance', 'status'])
    assert.ok(f in FIXTURE, `missing fixture field ${f}`);
  assert.strictEqual(FIXTURE.prng, 'xorshift32');
  assert.strictEqual(FIXTURE.domain, 'economics_domain2');
  assert.deepStrictEqual(FIXTURE.asset_order, ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane']);
  assert.deepStrictEqual(FIXTURE.tick_order, ['sales_index_step', 'dispatch']);
});

test('draw contract documented in fixture: step_index consumes exactly 2 draws per call', () => {
  // Fixture notes (canonical, 2026-10-12): step_index consumes exactly 2 draws per
  // call — first for uniform(a,b) = a + (b-a)*draw, second for random(). Every
  // step_index action records draws: 2. The TS port must reproduce this count exactly.
  const stepActions = FIXTURE.actions.filter((a: any) => a.type === 'step_index');
  assert.ok(stepActions.length > 0, 'no step_index actions in fixture');
  for (const a of stepActions) assert.strictEqual(a.draws, 2, `step_index action at tick ${a.tick} declares draws != 2`);
  assert.ok(/consumes exactly 2 draws per call/.test(FIXTURE.notes), 'fixture notes must document the 2-draw contract');
});

test('parity fixture d2_econ_30days_seed42: TS matches Python mirror exactly', () => {
  const cfg = loadEconConfigFromFile(CONFIG_PATH);
  const ladder = loadPriceLadderFromFile(LADDER_PATH);
  // Replay from a fresh state seeded with the fixture seed (fixture initial_state is the
  // recorded END state; the actions replay from day 0 with generator_state = seed = 42).
  let st = freshState(FIXTURE.seed, cfg);
  for (let t = 0; t <= FIXTURE.tick_count; t++) st = tickEconomics(st, cfg, ladder, FIXTURE.actions, t);

  const tol = FIXTURE.tolerance;
  const exp = FIXTURE.expected_outputs;
  const failures: string[] = [];
  for (const [key, want] of Object.entries(exp)) {
    if (key === 'balance_identity') {
      const ok = Math.abs(st.fulfilled_t + st.unsold_t - st.dispatched_t) < tol.tonnes;
      if (ok !== want) failures.push(`balance_identity: got ${ok}, want ${want}`);
      continue;
    }
    const got = (st as any)[key];
    if (typeof want === 'number') {
      const t = key.includes('usd') ? tol.usd : tol.tonnes;
      if (Math.abs(got - (want as number)) > t) failures.push(`${key}: got ${got}, want ${want}`);
    } else if (typeof want === 'object') {
      // categorical exact: orders (statuses/tonnage/sign_index) and downgrades
      const norm = (o: any) => ({ id: o.id, mode: o.mode, status: o.status, grade: o.grade,
        tonnage: o.tonnage, due_day: o.due_day, sign_index: o.sign_index });
      if (JSON.stringify(Array.isArray(got) ? got.map(norm) : got) !== JSON.stringify(want))
        failures.push(`${key}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    } else {
      if (got !== want) failures.push(`${key}: got ${got}, want ${want}`);
    }
  }
  assert.ok(failures.length === 0, 'parity failures:\n' + failures.join('\n'));
});

test('pure tick: input state never mutated', () => {
  const cfg = loadEconConfigFromFile(CONFIG_PATH);
  const ladder = loadPriceLadderFromFile(LADDER_PATH);
  const st0 = freshState(42, cfg);
  const before = JSON.stringify(st0);
  const st1 = tickEconomics(st0, cfg, ladder, [{ tick: 1, type: 'step_index', draws: 2 }], 1);
  assert.strictEqual(JSON.stringify(st0), before, 'input state was mutated');
  assert.notStrictEqual(JSON.stringify(st1), before, 'tick produced no change');
});

test('sandbox boundary: hypothetical run cannot touch the real state', () => {
  const cfg = loadEconConfigFromFile(CONFIG_PATH);
  const ladder = loadPriceLadderFromFile(LADDER_PATH);
  const real = freshState(101, cfg);
  const before = JSON.stringify(real);
  const { sandbox } = sandboxRun(real, cfg, ladder, 50);
  assert.strictEqual(JSON.stringify(real), before, 'real state mutated by sandbox run');
  assert.notStrictEqual(JSON.stringify(sandbox), before, 'sandbox produced no change');
});

test('config validation: reject, never default (healthy file clean; malformed rejected)', () => {
  const real = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  assert.deepStrictEqual(validateEconConfig(real), [], 'real config file must validate clean');
  const bad = JSON.parse(JSON.stringify(real));
  bad.schema_version = 2;
  assert.ok(validateEconConfig(bad).length > 0, 'schema bump must be rejected');
  const badBand = JSON.parse(JSON.stringify(real));
  badBand.sales_index.band = [1.05, 0.85];
  assert.ok(validateEconConfig(badBand).length > 0, 'inverted band must be rejected');
});
