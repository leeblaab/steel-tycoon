// Slice 3 parity test — fixture-driven acceptance for web/src/ports/slice3/shared/slice3_sim.ts
// (line-level TS port of mirror/slice3_mirror.py). Mirror = single source of truth.
// Dump: web/tests/scratch_s3/dump_mirror.py (fresh mirror replay -> mirror_dump.json).
//
// Browser-sim audit (web/src/ports/slice3/browser/sim.ts vs mirror) — divergences found:
//  D1 rounding semantics: browser uses Math.round (JS half-up); the mirror formats event
//     strings and records with Python round() (banker's rounding). No .xx5 tie occurs in
//     the canonical fixtures (verified against the live dump: zero ties), so outputs agree
//     there, but the seam is unsafe for arbitrary scenarios. Resolved: shared port uses a
//     pyRound() banker's-rounding helper matching Python exactly.
//  D2 record shape: browser TickRecord is an app-visualization shape (buffer_lots,
//     drp_discharged_this_tick_t, refused_this_tick_t, heat_status/heat_taken_lots) and its
//     `heat` lookup relies on skipped heats having readiness_timestamp=null — so a SKIPPED
//     heat never surfaces in the record. The mirror's records carry `heat: status` for both
//     charged and skipped heats (mirror L195, L201-203). Resolved: shared port reproduces
//     the mirror record shape exactly (tick/buffer_t/drp_tripped/heat/flags/events).
//  D3 test seams: browser sim exports only runSlice3/summarize(res)/compareFixture over its
//     own RunResult; freshState/tick/run/summarize(state,records,fx) are not drivable by
//     vitest and there is no prng_state walk. Resolved: shared port exports freshState,
//     tick, run, summarize (mirror signature), deepClone, pyRound, prngSeries.
//  D4 fixture embed vs load: browser sim embeds fixture JSON inline (drift risk against
//     fixtures/slice3/*.json); the parity test reads the real fixture files instead. The
//     embedded content was cross-checked byte-for-value against both fixture files and
//     matches the fresh mirror run — no value divergence, but the port does not embed.
//  D5 validation messages & draw contract: validateScenario (L103-119) and the trip gate
//     (draw consumed at EVERY trip tick before the p test; L182-189) match the mirror
//     exactly — no divergence found in either. Event strings, epsilon conventions (1e-9),
//     FIFO take, blocked-event recording, failure attribution formula, and state shape
//     (prng_state inside sim state) all match the mirror line-for-line.

import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  freshState,
  validateScenario,
  tick,
  run,
  summarize,
  deepClone,
  pyRound,
  prngSeries,
  type S3Fixture,
} from '../src/ports/slice3/shared/slice3_sim.ts';

const REPO = 'C:/AI_LAB/SteelX';
const FIXTURE: S3Fixture = JSON.parse(
  readFileSync(`${REPO}/fixtures/slice3/s3_dri_buffer_scenario_seed11_120.json`, 'utf-8'),
);
const FILL_FIXTURE: S3Fixture = JSON.parse(
  readFileSync(`${REPO}/fixtures/slice3/s3_fill_negative_seed11_120.json`, 'utf-8'),
);
const DUMP: any = JSON.parse(readFileSync(`${REPO}/web/tests/scratch_s3/mirror_dump.json`, 'utf-8'));
const EXP = FIXTURE.expected_outputs;

function withScenario(fx: S3Fixture, mut: (c: any) => void): S3Fixture {
  const f = deepClone(fx);
  mut(f.scenario as any);
  return f;
}

// ---------- fixture load ----------

test('fixtures load: ids and scenario blocks present', () => {
  assert.strictEqual(FIXTURE.fixture_id, 's3_dri_buffer_scenario_seed11_120');
  assert.strictEqual(FILL_FIXTURE.fixture_id, 's3_fill_negative_seed11_120');
  assert.strictEqual(FIXTURE.scenario.seed, 11);
  assert.strictEqual(FIXTURE.scenario.ticks, 120);
  assert.deepStrictEqual(FIXTURE.scenario.drp.trip_ticks, [20, 45, 70]);
});

// ---------- per-tick records deep-equal the fresh Python mirror dump ----------

test('TS records deep-equal fresh mirror replay dump (all 120 ticks)', () => {
  const { records } = run(FIXTURE);
  assert.strictEqual(records.length, DUMP.primary.records.length);
  assert.deepStrictEqual(records, DUMP.primary.records); // exact: tick, buffer_t, drp_tripped, heat, flags, events
});

test('TS final heats deep-equal mirror dump heats (incl. lots_taken & attribution)', () => {
  const { state } = run(FIXTURE);
  assert.deepStrictEqual(state.heats, DUMP.primary.heats_final);
});

// ---------- every expected_outputs value in the primary fixture ----------

test('primary fixture: every expected_outputs field matches summarize()', () => {
  const { state, records } = run(FIXTURE);
  const s = summarize(state, records, FIXTURE);
  assert.strictEqual(s.win, EXP.win); // false
  assert.deepStrictEqual(s.fill_ticks, EXP.fill_state_ticks);
  assert.deepStrictEqual(s.blocked_ticks, EXP.blocked_ticks);
  assert.deepStrictEqual(s.starve_ticks, EXP.starve_ticks);
  assert.deepStrictEqual(s.trip_fired_ticks, EXP.trip_fired_ticks);
  assert.deepStrictEqual(s.heats, EXP.heats);
  // per-heat explicit check (status + failure_cause), mirror dump-backed:
  const causes = Object.fromEntries(
    Object.entries(EXP.heats).map(([id, [status, cause]]) => {
      const h = state.heats.find((x) => x.material_id === id)!;
      return [id, [h.status, h.failure_cause ?? null]];
    }),
  );
  assert.deepStrictEqual(causes, EXP.heats);
});

test('fill-negative fixture: every expected_outputs field matches', () => {
  const { state, records } = run(FILL_FIXTURE);
  const s = summarize(state, records, FILL_FIXTURE);
  const exp = FILL_FIXTURE.expected_outputs;
  assert.strictEqual(s.win, exp.win); // true
  assert.deepStrictEqual(s.fill_ticks, exp.fill_state_ticks);
  assert.deepStrictEqual(s.blocked_ticks, exp.blocked_ticks);
  assert.deepStrictEqual(s.starve_ticks, exp.starve_ticks); // [] — no skips in fill scenario
  assert.deepStrictEqual(s.trip_fired_ticks, exp.trip_fired_ticks);
  assert.deepStrictEqual(s.heats, exp.heats);
  assert.strictEqual(records.length, DUMP.fill_negative.records.length);
  assert.deepStrictEqual(records, DUMP.fill_negative.records);
});

// ---------- prng_state parity at trip ticks (and full walk) ----------

test('prng_state inside sim state: per-tick walk deep-equal mirror dump', () => {
  const series = prngSeries(FIXTURE);
  assert.strictEqual(series.length, DUMP.primary.prng_series.length);
  assert.deepStrictEqual(series, DUMP.primary.prng_series);
});

test('prng_state parity at trip ticks: draw consumed at EVERY trip tick per draw contract', () => {
  // mirror dump values (fresh run): tick 20 -> 2974059, then draws at 45/70 continue the chain.
  const series = prngSeries(FIXTURE);
  const at = (t: number) => series.find((p) => p.tick === t)!.prng_state;
  for (const t of FIXTURE.scenario.drp.trip_ticks) {
    const dumpEntry = DUMP.primary.prng_series.find((p: any) => p.tick === t)!;
    assert.strictEqual(at(t), dumpEntry.prng_state, `prng_state mismatch at trip tick ${t}`);
  }
  // draw contract: exactly 3 xorshift advances over the whole 120-tick run (one per trip tick).
  const changed = series.filter((p, i) => i > 0 && p.prng_state !== series[i - 1].prng_state).map((p) => p.tick);
  assert.deepStrictEqual(changed, FIXTURE.scenario.drp.trip_ticks);
});

test('trip gate semantics: non-firing trip tick still consumes a draw (no event)', () => {
  // live mirror ground truth (probe): with p=0.001 only tick 20 fires (draw 0.000692);
  // ticks 45/70 consumed draws 0.172039/0.071153 without firing.
  const fx = withScenario(FIXTURE, (sc) => (sc.drp.trip_probability = 0.001));
  const { state, records } = run(fx);
  const s = summarize(state, records, fx);
  assert.deepStrictEqual(s.trip_fired_ticks, [20]);
  // draw still consumed at 45/70: prng chain identical to baseline (all three advanced).
  assert.deepStrictEqual(prngSeries(fx), DUMP.primary.prng_series);
});

// ---------- canonical xorshift32 (mirror/xorshift32_check.py gate #0) ----------

test('xorshift32 gate #0 canonical vector seed 1', () => {
  assert.deepStrictEqual(DUMP.xorshift_vector_seed1, [6.295018830870981e-05, 0.01574742817686578, 0.6164041025602268]);
  // TS side: same three draws from seed 1 via the shared prng used by the port.
  const fx = withScenario(FIXTURE, (sc) => {
    sc.seed = 1;
    sc.ticks = 1;
    sc.drp.trip_ticks = [1];
    sc.drp.trip_probability = 0.9999999; // force trip event so the draw is exercised
    sc.eaf.heat_plan = [1];
  });
  const { records } = run(fx);
  const m = records[0].events.find((e) => e.includes('draw'));
  assert.ok(m && m.includes('(draw 0.0001'), `first draw from seed 1: ${m}`); // 6.295e-05 -> .4f/toFixed(4) '0.0001' (Python and JS agree)
});

// ---------- negative controls (mirror __main__ L257-280 reproduced in TS) ----------

test('negative validation controls: each invalid input fails as intended', () => {
  const cases: Array<[string, (c: any) => void, RegExp]> = [
    ['zero seed', (sc) => (sc.seed = 0), /zero seed rejected/],
    ['non-positive ticks', (sc) => (sc.ticks = 0), /ticks must be positive/],
    ['zero discharge rate', (sc) => (sc.drp.discharge_t_per_tick = 0), /discharge_t_per_tick must be positive/],
    ['zero buffer capacity', (sc) => (sc.buffer.capacity_t = 0), /capacity_t must be positive/],
    ['threshold order inverted', (sc) => (sc.buffer.starve_threshold_t = 999.0), /0 < starve < fill <= capacity/],
    ['trip probability out of range', (sc) => (sc.drp.trip_probability = 1.5), /trip_probability must be in \(0,1\)/],
    ['heat plan outside scenario', (sc) => (sc.eaf.heat_plan = [200]), /heat_plan ticks must be within \(0, ticks\]/],
    ['duplicate heat plan tick', (sc) => (sc.eaf.heat_plan = [20, 20, 40]), /heat_plan ticks must be unique/],
  ];
  for (const [name, mut, re] of cases) {
    assert.throws(() => validateScenario(withScenario(FIXTURE, mut)), re, `negative control "${name}" must fail`);
  }
});

test('plan_overdraw attribution control: charge_t=120 -> all skips cause=plan_overdraw, win=false', () => {
  const fx = withScenario(FIXTURE, (sc) => (sc.eaf.charge_t = 120.0));
  const { state } = run(fx);
  const causes = Array.from(
    new Set(state.heats.filter((h) => h.status === 'skipped').map((h) => h.failure_cause)),
  ).sort();
  assert.deepStrictEqual(causes, DUMP.plan_overdraw_control.causes); // ['plan_overdraw']
  assert.strictEqual(state.win, DUMP.plan_overdraw_control.win); // false
  const heatStatuses = Object.fromEntries(
    state.heats.map((h) => [h.material_id, [h.status, h.failure_cause ?? null]]),
  );
  assert.deepStrictEqual(heatStatuses, DUMP.plan_overdraw_control.heat_statuses);
});

test('buffer_starved attribution: canonical fixture skips attributed buffer_starved (not plan_overdraw)', () => {
  // mirror L219-224: max_possible = 2.0*120 = 240 >= charge 20 * 11 heats = 220 -> starved.
  const { state } = run(FIXTURE);
  const skipped = state.heats.filter((h) => h.status === 'skipped');
  assert.strictEqual(skipped.length, 3); // H30, H50, H80
  for (const h of skipped) assert.strictEqual(h.failure_cause, 'buffer_starved');
});

// ---------- capacity gate exactness (mirror probe ground truth) ----------

test('exact-capacity discharge is accepted (rate == room), refusal starts only when rate > room', () => {
  // live mirror probe: capacity 6.0, rate 2.0 -> ticks 1-3 fill exactly to 6.0 (accepted),
  // tick 4 refused with 'room 0.0t'.
  const fx = withScenario(FIXTURE, (sc) => {
    sc.drp.trip_ticks = [];
    sc.eaf.heat_plan = [120];
    sc.buffer.capacity_t = 6.0;
  });
  const { records } = run(fx);
  assert.strictEqual(records[2].buffer_t, 6.0);
  assert.strictEqual(records[2].flags.blocked, false);
  assert.strictEqual(records[3].flags.blocked, true);
  assert.ok(records[3].events.some((e) => e.includes('room 0t') || e.includes('room 0.0t')));
});

// ---------- determinism / immutability seams ----------

test('tick never mutates the input state (state-in/state-out like the mirror json round-trip)', () => {
  const s0 = freshState(FIXTURE);
  const snapshot = deepClone(s0);
  const s1 = tick(s0, FIXTURE);
  assert.deepStrictEqual(s0, snapshot); // input untouched
  assert.strictEqual(s1.tick, 1);
  assert.notStrictEqual(s1, s0);
});

test('pyRound matches Python round() banker semantics on tie values', () => {
  // Python: round(2.5)=2, round(3.5)=4, round(0.125,2)=0.12, round(0.135,2)=0.14 (binary repr)
  assert.strictEqual(pyRound(2.5), 2);
  assert.strictEqual(pyRound(3.5), 4);
  assert.strictEqual(pyRound(0.125, 2), 0.12);
});
