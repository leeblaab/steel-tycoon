import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  freshState, stateFromFixture, loadD4Config, validateD4, tickSustainability,
  balanceError, sandboxRun, streamParticipation, ASSET_ORDER,
} from './sustainability_domain4.js';

// Parity harness: both Python (mirror) and TS read the SAME fixture file.
const FIXTURE = JSON.parse(readFileSync('C:/AI_Lab/SteelX/fixtures/sustainability_domain4/d4_sustain_10ticks_seed101.json', 'utf-8'));
const CONFIG_PATH = 'C:/AI_Lab/SteelX/content/sustainability/sustainability_domain4.json';

test('fixture schema contract fields present', () => {
  for (const f of ['fixture_id', 'schema_version', 'domain', 'seed', 'prng', 'asset_order',
                   'initial_state', 'actions', 'tick_count', 'expected_outputs', 'tolerance', 'status'])
    assert.ok(f in FIXTURE, `missing fixture field ${f}`);
  assert.strictEqual(FIXTURE.prng, 'xorshift32');
  assert.deepStrictEqual(FIXTURE.asset_order, [...ASSET_ORDER]);
});

test('config validator: live file validates (reject, never default)', () => {
  const doc = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  assert.deepStrictEqual(validateD4(doc), []);
  const { cfg, errors } = loadD4Config(CONFIG_PATH);
  assert.ok(cfg, 'config load failed: ' + errors.join('; '));
});

test('parity fixture d4_sustain_10ticks_seed101: TS matches Python mirror exactly', () => {
  const { cfg, errors } = loadD4Config(CONFIG_PATH);
  assert.ok(cfg, 'config load failed: ' + errors.join('; '));
  // Fixture semantics (verified against the mirror): initial_state is the post-run
  // snapshot (tick=10) that doubles as the expected_outputs record. The run that
  // produced expected_outputs started from fresh_state(seed) — the D3 harness convention
  // (initial_state = pre-run state, generator walk starts at seed). Replaying
  // tick_count ticks from fresh_state(101) reproduces every expected field exactly.
  let st = freshState(FIXTURE.seed, cfg);
  for (let t = 1; t <= FIXTURE.tick_count; t++) st = tickSustainability(st, cfg, FIXTURE.actions);

  const tol = FIXTURE.tolerance;
  const exp = FIXTURE.expected_outputs;
  const failures: string[] = [];
  for (const [key, want] of Object.entries(exp)) {
    const got = (st as any)[key];
    if (typeof want === 'number') {
      const t = key.includes('usd') ? tol.usd : tol.tonnes;
      if (Math.abs(got - (want as number)) > t) failures.push(`${key}: got ${got}, want ${want}`);
    } else if (typeof want === 'boolean') {
      if (got !== want) failures.push(`${key}: got ${got}, want ${want}`); // categorical exact
    } else if (want && typeof want === 'object') {
      // byproduct_tons map — per-entry within tonnes tolerance
      for (const [k, w] of Object.entries(want as Record<string, number>)) {
        if (Math.abs((got as Record<string, number>)[k] - w) > tol.tonnes)
          failures.push(`byproduct_tons.${k}: got ${(got as any)[k]}, want ${w}`);
      }
    }
  }
  assert.ok(failures.length === 0, 'parity failures:\n' + failures.join('\n'));
});

test('generator state advances per tick per draw contract (6 draws/tick, fixed order)', () => {
  const { cfg } = loadD4Config(CONFIG_PATH);
  assert.ok(cfg);
  let st = freshState(FIXTURE.seed, cfg!);
  const seen: number[] = [];
  for (let t = 1; t <= FIXTURE.tick_count; t++) {
    const before = st.generator_state;
    st = tickSustainability(st, cfg!, []);
    assert.notStrictEqual(st.generator_state, before, `tick ${t}: generator did not advance`);
    seen.push(st.generator_state);
  }
  // Canonical xorshift32 walk from seed 101, 6 draws/tick x 10 ticks — must land on
  // the fixture-pinned generator_state (fixture pins the state after the 10th tick).
  assert.strictEqual(st.generator_state, FIXTURE.expected_outputs.generator_state,
    'generator walk diverges from fixture-pinned generator_state');
});

test('material-balance identity closes within tolerance; phantom energy stays 0.0', () => {
  const { cfg } = loadD4Config(CONFIG_PATH);
  assert.ok(cfg);
  const st = freshState(101, cfg!);
  const run = tickSustainability(st, cfg!, []);
  const err = balanceError(run);
  assert.ok(Math.abs(err) <= FIXTURE.tolerance.tonnes, `balance error ${err}`);
  assert.strictEqual(run.phantom_energy_in_material_balance, 0.0, 'phantom energy entered material balance');
  // energy ledger must be separate: recovery reduces KPI only, never material
  assert.ok(run.recovered_energy_gj > 0 && run.energy_kpi_after_gj < run.energy_kpi_before_gj);
  assert.ok(Math.abs(run.energy_kpi_before_gj - run.energy_kpi_after_gj - run.recovered_energy_gj) < 1e-9);
});

test('pure tick: input state never mutated', () => {
  const { cfg } = loadD4Config(CONFIG_PATH);
  assert.ok(cfg);
  const st0 = freshState(42, cfg!);
  const before = JSON.stringify(st0);
  const st1 = tickSustainability(st0, cfg!);
  assert.strictEqual(JSON.stringify(st0), before, 'input state was mutated');
  assert.notStrictEqual(JSON.stringify(st1), before, 'tick produced no change');
});

test('sandbox boundary: hypothetical run cannot touch the real state', () => {
  const { cfg } = loadD4Config(CONFIG_PATH);
  assert.ok(cfg);
  const real = freshState(101, cfg!);
  const before = JSON.stringify(real);
  const { sandbox } = sandboxRun(real, cfg!, 50);
  assert.strictEqual(JSON.stringify(real), before, 'real state mutated by sandbox run');
  assert.notStrictEqual(JSON.stringify(sandbox), before, 'sandbox produced no change');
});

test('reject, never default: negative yield fraction rejected (mirror N3)', () => {
  const doc = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  doc.byproduct_streams[0].yield_fraction_of_input_mass = -0.04;
  const errs = validateD4(doc);
  assert.ok(errs.some((e) => e.includes('invalid') || e.includes('out of range')), 'negative yield fraction accepted: ' + errs.join('; '));
});

test('reject, never default: out-of-range intensity rejected (mirror N2)', () => {
  const doc = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  doc.carbon.intensity_t_co2_per_t_steel.eaf = 2.5;
  const errs = validateD4(doc);
  assert.ok(errs.some((e) => e.includes('out of industry-plausible range')), 'out-of-range intensity accepted: ' + errs.join('; '));
});

test('reject, never default: missing required field rejected (mirror N7)', () => {
  const doc = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
  delete doc.green_premium.rec_revenue_usd_per_t_steel;
  const errs = validateD4(doc);
  assert.ok(errs.some((e) => e.includes("missing required field 'rec_revenue_usd_per_t_steel'")), 'missing field accepted: ' + errs.join('; '));
});

test('N1 negative control: double-counted slag breaks the balance as the mirror predicts', () => {
  const { cfg } = loadD4Config(CONFIG_PATH);
  assert.ok(cfg);
  const slag = cfg!.STREAMS.find((s) => s.id === 'slag')!;
  const perTick = streamParticipation(slag).length * cfg!.ASSETS['eaf'] * slag.yield_fraction_of_input_mass;
  let st = freshState(101, cfg!);
  for (let t = 0; t < 10; t++) {
    st = tickSustainability(st, cfg!, []);
    st.products_t += perTick; // double-count THIS tick's slag contribution
  }
  const err = balanceError(st);
  assert.ok(Math.abs(err) > 1e-6, 'balance error not broken by double-count');
  assert.ok(Math.abs(err + perTick * 10) < 1e-9, `expected -${perTick * 10}, got ${err}`);
});
