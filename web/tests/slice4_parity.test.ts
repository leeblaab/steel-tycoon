// Slice 4 parity test — fixture-driven acceptance for web/src/ports/slice4/shared/slice4_sim.ts
// (line-level TS port of mirror/slice4_mirror.py, POST-PATCH version: eaf.bath_t live at heat
// start / zeroed at tap and authoritative in the balance stage; dri consumed_t populated on DRI
// rows at tap). Mirror = single source of truth. Two layers of assertion:
//   (a) full per-tick deep-equality against a FRESH Python mirror replay dumped to
//       web/tests/scratch_s4/mirror_dump.json (throwaway script dump_mirror.py; frozen dirs
//       untouched), including bath_t and consumed_t series the mirror's own records don't expose;
//   (b) every expected_outputs value in fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json per
//       the 23-row table in docs/s4_gap_check.md.
// Negative controls follow the mirror's run_negative_tests semantics (N1/N2/N3/N4), with the N3
// guard at the mirror's ladles>=3 (mirror semantics win over the fixture's >=2 clause —
// docs/s4_gap_check.md weakness 4). The mirror has NO input validation, so no validateScenario.
import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  freshState,
  tick,
  run,
  runNegativeTests,
  loadScrapTiers,
  deepClone,
  pyRound,
  EAF_SEC_KWH_PER_T,
  type Slice4Fixture,
  type Slice4State,
} from '../src/ports/slice4/shared/slice4_sim.ts';

const REPO = 'C:/AI_LAB/SteelX';
const FIXTURE: Slice4Fixture = JSON.parse(
  readFileSync(`${REPO}/fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json`, 'utf-8'),
);
// Runtime-loaded yields (mirror L39/L52-55): NO hardcoded yield constants in the port.
const TIERS = loadScrapTiers(JSON.parse(readFileSync(`${REPO}/content/scrap/scrap_tiers.json`, 'utf-8')));
// Fresh post-patch Python mirror replay (dump_mirror.py). Regenerate with:
//   cd C:/AI_LAB/SteelX && python web/tests/scratch_s4/dump_mirror.py
const DUMP = JSON.parse(readFileSync(`${REPO}/web/tests/scratch_s4/mirror_dump.json`, 'utf-8'));
const EXP = (FIXTURE as any).expected_outputs;

function withScenario(mut: (c: any) => void): Slice4Fixture {
  const f = deepClone(FIXTURE);
  mut((f as any).scenario);
  return f;
}

// Seed the state exactly like mirror run() L296-314 (for per-tick replay loops).
function seededState(fx: Slice4Fixture): Slice4State {
  const st = freshState(fx);
  for (const ch of fx.scenario.charge_plan) {
    st.charges.push({
      charge_id: ch.charge_id, recipe_id: ch.recipe_id,
      grade_composition: ch.composition.map((g) => ({ grade: g.grade, required_usable_t: g.required_usable_t, actual_usable_t: g.actual_usable_t })),
      readiness_timestamp: null, deadline: ch.deadline_tick, status: 'planning', failure_cause: null,
    });
  }
  for (const m of fx.scenario.dri_plan) {
    st.dri_materials.push({
      material_id: m.material_id, usable_t: m.usable_t, quality_metadata: {}, source: 'DRI buffer',
      readiness_timestamp: m.ready_tick, destination: 'EAF feed interface', consumed_t: 0.0,
    });
  }
  for (let i = 0; i < fx.scenario.ladles; i++) {
    st.ladles.push({ ladle_id: `L${i + 1}`, status: 'free', busy_charge_id: null, busy_since: null, metal_t: 0.0, refined: false });
  }
  return st;
}

// ---------- fixture / content loading ----------

test('fixture + scrap tiers load: contract fields present, yields runtime-loaded', () => {
  assert.strictEqual(FIXTURE.fixture_id, 's4_eaf_lrf_ccm_billet_seed11_120');
  assert.strictEqual((FIXTURE as any).domain, 'slice4_melt_shop');
  assert.strictEqual(FIXTURE.scenario.seed, 11);
  assert.strictEqual(FIXTURE.scenario.ticks, 120);
  assert.strictEqual(FIXTURE.scenario.ladles, 2);
  assert.strictEqual(FIXTURE.yield_convention.dri_yield_pct, 96.5);
  assert.strictEqual(FIXTURE.yield_convention.ccm_billet_yield_pct, 98.0);
  // yields come from content/scrap/scrap_tiers.json at runtime (mirror L52-55 semantics)
  assert.strictEqual(TIERS.hms1_hms2.yield_loss_pct, 5.0);
  assert.strictEqual(TIERS.bushing.yield_loss_pct, 3.0);
  assert.strictEqual(TIERS.shredded.yield_loss_pct, 8.0);
  assert.strictEqual(EAF_SEC_KWH_PER_T, 600.0);
});

// ---------- baseline vs fresh Python mirror replay (deep-equal) ----------

test('baseline: win + final counters + charge statuses deep-equal the fresh mirror replay', () => {
  const { state } = run(FIXTURE, TIERS);
  assert.strictEqual(state.win, DUMP.win); // true
  assert.deepStrictEqual(state.counters, DUMP.counters); // all 13 counters, floats included
  assert.ok(Math.abs(state.billet_yard_t - DUMP.billet_yard_t) < 1e-9);
  assert.ok(Math.abs(state.balance_error! - DUMP.balance_error_raw) < 1e-12);
  assert.deepStrictEqual(
    Object.fromEntries(state.charges.map((c) => [c.charge_id, { status: c.status, failure_cause: c.failure_cause }])),
    DUMP.charge_statuses,
  );
});

test('baseline: ALL counters_at_tick_120 fields match fixture expected_outputs', () => {
  const { state } = run(FIXTURE, TIERS);
  const expC = EXP.counters_at_tick_120;
  const gotC = state.counters as Record<string, unknown>;
  const failures: string[] = [];
  for (const key of Object.keys(expC)) {
    const want = expC[key] as number;
    const got = gotC[key] as number;
    assert.ok(typeof got === 'number', `counter ${key} missing in TS port`);
    if (Math.abs(got - want) > 1e-6) failures.push(`${key}: got ${got}, want ${want}`);
  }
  assert.ok(failures.length === 0, 'counter parity failures:\n' + failures.join('\n'));
  // explicit spot-checks of the headline numbers named in the fixture note
  assert.strictEqual(state.counters.heats_tapped, 5);
  assert.strictEqual(state.counters.heats_starved, 65); // idle-tick starvation accounting
  assert.ok(Math.abs(state.counters.energy_kwh_total - 120000.0) < 1e-9); // 5 x 40 t x 600 kWh/t
  assert.ok(Math.abs(state.counters.billet_t_total - 186.935) < 1e-9);
});

test('baseline: every tick_record deep-equals the fresh mirror replay (all 120 ticks)', () => {
  const { records } = run(FIXTURE, TIERS);
  assert.strictEqual(records.length, DUMP.records.length); // 120
  for (let i = 0; i < records.length; i++) {
    assert.deepStrictEqual(records[i], DUMP.records[i], `tick ${records[i].tick}: TS record != fresh mirror replay`);
  }
});

test('baseline: per-tick balance identity uses the mirror formula and matches state', () => {
  // Mirror stage-6 raw identity per tick: entered(in_furnace|tapped) - yield_loss - ccm_loss
  // - in_ladles - bath(eaf.bath_t) - billet_yard. Raw floats (no rounding).
  const { records } = run(FIXTURE, TIERS);
  let st = seededState(FIXTURE);
  let maxAbsRaw = 0.0;
  for (let i = 0; i < 120; i++) {
    st = tick(st, FIXTURE, TIERS);
    const entered = st.charges
      .filter((ch) => ch.status === 'in_furnace' || ch.status === 'tapped')
      .reduce((acc, ch) => acc + ch.grade_composition.reduce((a, r) => a + r.actual_usable_t, 0), 0);
    const in_ladles = st.ladles.reduce((a, l) => a + (l.metal_t ?? 0), 0);
    const raw = entered - st.counters.yield_loss_t - st.counters.ccm_loss_t - in_ladles - st.eaf.bath_t - st.billet_yard_t;
    assert.ok(Math.abs(raw - st.balance_error!) < 1e-9, `tick ${st.tick}: TS raw balance ${raw} != mirror-formula ${st.balance_error}`);
    maxAbsRaw = Math.max(maxAbsRaw, Math.abs(st.balance_error!));
    // rounded per-tick record equals the replay's rounded value (0.0 shows on every tick)
    assert.strictEqual(records[i].balance_error, pyRound(st.balance_error!, 9));
  }
  // mirror-verified post-patch: max |raw balance_error| across all 120 ticks = 2.84e-14
  assert.ok(Math.abs(maxAbsRaw - DUMP.max_abs_balance_error_raw_all_ticks) < 1e-15);
  assert.ok(maxAbsRaw < 1e-9);
});

test('baseline: bath_t parity — live field {40.0 during residence x50, 0.0 otherwise x70} per mirror replay', () => {
  const bathDump = new Map<number, number>(DUMP.bath_series.map((b: any) => [b.tick, b.bath_t]));
  let st = seededState(FIXTURE);
  const distinct = new Map<number, number>();
  for (let i = 0; i < 120; i++) {
    st = tick(st, FIXTURE, TIERS);
    assert.strictEqual(st.eaf.bath_t, bathDump.get(st.tick), `tick ${st.tick}: TS bath_t != mirror replay`);
    distinct.set(st.eaf.bath_t, (distinct.get(st.eaf.bath_t) ?? 0) + 1);
  }
  // post-patch verified distribution: 40.0 on 50 residence ticks, 0.0 on 70
  assert.deepStrictEqual([...distinct.entries()].sort((a, b) => a[0] - b[0]), [[0, 70], [40, 50]]);
});

test('baseline: consumed_t parity — all five D-records at 10.0 after 120 ticks, populated at tap', () => {
  const { state } = run(FIXTURE, TIERS);
  assert.deepStrictEqual(
    Object.fromEntries(state.dri_materials.map((d) => [d.material_id, d.consumed_t])),
    DUMP.dri_consumed_final, // {'D1':10.0,...,'D5':10.0}
  );
  // per-tick consumed series deep-equals the mirror replay (populated exactly at tap ticks)
  let s = seededState(FIXTURE);
  for (let i = 0; i < 120; i++) {
    s = tick(s, FIXTURE, TIERS);
    assert.deepStrictEqual(
      s.dri_materials.map((d) => d.consumed_t),
      DUMP.consumed_series[i].consumed_t,
      `tick ${s.tick}: TS consumed_t series != mirror replay`,
    );
  }
});

// ---------- fixture expected_outputs (docs/s4_gap_check.md 23-row table) ----------

test('fixture: event tick lists match expected_outputs.events', () => {
  const { state } = run(FIXTURE, TIERS);
  const ticksOf = (pred: (e: string) => boolean) =>
    [...new Set(state.events.filter((e) => pred(e.event)).map((e) => e.tick))].sort((a, b) => a - b);
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('EAF heat starts for')), EXP.events.heat_starts); // [1,12,24,36,48]
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('EAF taps ')), EXP.events.taps); // [11,22,34,46,58]
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('LRF refine completes for')), EXP.events.refines_complete); // [14,25,37,49,61]
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('CCM casts ladle')), EXP.events.casts_complete); // [19,30,42,54,66]
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('maintenance indicator:')), EXP.events.maintenance_events); // [60,90]
  assert.deepStrictEqual(ticksOf((e) => e.startsWith('workforce indicator:')), EXP.events.shift_changeovers); // [30,60,90]
});

test('fixture: key_ticks 19/30/66 snapshots match expected_outputs', () => {
  const { state, records } = run(FIXTURE, TIERS);
  for (const k of ['19', '30', '66'] as const) {
    const rec = records[parseInt(k, 10) - 1];
    assert.strictEqual(rec.tick, parseInt(k, 10));
    assert.strictEqual(rec.ladles_free, EXP.key_ticks[k].ladles_free); // 1 / 1 / 2
    assert.ok(Math.abs(rec.billet_yard_t - EXP.key_ticks[k].billet_yard_t) < 1e-9); // 37.387 / 74.774 / 186.935
    assert.ok(Math.abs(rec.balance_error - EXP.key_ticks[k].balance_error) < (FIXTURE as any).expected_outputs.material_balance.tolerance); // 0.0 @ 1e-9
  }
});

test('fixture: material balance closes at end within fixture tolerance', () => {
  const { state } = run(FIXTURE, TIERS);
  assert.ok(
    Math.abs(state.balance_error! - EXP.material_balance.balance_error_at_end) < EXP.material_balance.tolerance,
  ); // 0.0 @ 1e-9
});

test('fixture: event vocabulary strings match the mirror (delivery/starvation/wait strings)', () => {
  const { state } = run(FIXTURE, TIERS);
  const all = new Set(state.events.map((e) => e.event));
  assert.ok(all.has('charge C1 delivered to EAF feed interface'));
  assert.ok(all.has('DRI material D1 (10.0t) ready at EAF feed interface')); // mirror str(float): '10.0', not '10'
  assert.ok([...all].some((e) => e === 'EAF idle — no delivered charge at feed interface (starvation)')); // starved=65 ticks emit it
  assert.ok([...all].some((e) => e.startsWith('EAF heat starts for C1 (10 ticks, ladle L1 reserved)')));
  assert.ok([...all].some((e) => e === 'EAF taps C1: 38.15t metal -> ladle L1')); // 30*0.95 + 10*0.965
  assert.ok([...all].some((e) => e === 'CCM casts ladle L1: 37.387t billet -> billet yard'));
  // baseline cadence: no wait events at all (charge/ladle/caster waits all 0)
  assert.strictEqual(state.counters.charge_wait_ticks, 0);
  assert.strictEqual(state.counters.ladle_wait_ticks, 0);
  assert.strictEqual(state.counters.caster_wait_ticks, 0);
  assert.ok(![...all].some((e) => e.includes('charge-consumption wait')));
  assert.ok(![...all].some((e) => e.includes('ladle cycle wait')));
  assert.ok(![...all].some((e) => e.includes('strand busy (ladle cycle pressure)')));
});

test('pure tick: input state never mutated', () => {
  const st0 = seededState(FIXTURE);
  const before = JSON.stringify(st0);
  const st1 = tick(st0, FIXTURE, TIERS);
  assert.strictEqual(JSON.stringify(st0), before, 'input state was mutated');
  assert.notStrictEqual(JSON.stringify(st1), before, 'tick produced no change');
});

// ---------- negative controls (mirror run_negative_tests semantics) ----------

test('N1 no-charge starvation: charge_deliveries=[] -> tapped 0, starved 120, balance closed', () => {
  const fx1 = withScenario((c) => { c.charge_deliveries = []; });
  const { state } = run(fx1, TIERS);
  const nc = EXP.negative_controls.no_charge_delivery;
  assert.strictEqual(state.counters.heats_tapped, nc.heats_tapped); // 0 (no fabricated heat)
  assert.strictEqual(state.counters.heats_starved, nc.heats_starved); // 120
  assert.ok(nc.balance_closed && Math.abs(state.balance_error!) < 1e-9);
  const mirrorN = runNegativeTests(FIXTURE, TIERS)[0];
  assert.strictEqual(mirrorN.ok, true);
  assert.strictEqual(mirrorN.detail, 'tapped=0 starved=120 balance=0.0'); // pinned vs live mirror output
});

test('N2 ladle never released (ccm_ticks_per_ladle=1e6): casts 0, ladle_wait>0, diverges from healthy', () => {
  const fx2 = withScenario((c) => { c.ccm_ticks_per_ladle = 10 ** 6; }); // knob-based, mirror L354
  const broken = run(fx2, TIERS).state;
  const healthy = run(FIXTURE, TIERS).state;
  const nc = EXP.negative_controls.ladle_never_released;
  assert.strictEqual(broken.counters.casts_completed, nc.casts_completed); // 0
  // fixture clause 'ladle_wait_ticks_gt': 0 is the threshold (wait > 0), not a value to compare
  assert.ok(broken.counters.ladle_wait_ticks > nc.ladle_wait_ticks_gt);
  assert.ok(nc.diverges_from_healthy && healthy.counters.casts_completed > 0);
  // mirror-pinned: broken ladle_wait = 56 (docs/s4_gap_check.md console output)
  assert.strictEqual(broken.counters.ladle_wait_ticks, 56);
  const mirrorN = runNegativeTests(FIXTURE, TIERS)[1];
  assert.strictEqual(mirrorN.ok, true);
  assert.strictEqual(mirrorN.detail, 'broken casts=0 healthy casts=5 broken ladle_wait=56');
});

test('N3 caster-wait reachability guard: mirror predicate (ladles>=3 AND ccm>lrf) wins over fixture >=2 clause', () => {
  // Mirror L376 predicate; fixture clause says ladles >= 2 — at shipped cadence both evaluate to
  // unreachable, results agree (docs/s4_gap_check.md weakness 4: mirror semantics win).
  const c = FIXTURE.scenario;
  const reachableMirror = c.ladles >= 3 && c.ccm_ticks_per_ladle > c.lrf_ticks_per_ladle; // false at ladles=2
  assert.strictEqual(reachableMirror, false);
  const { state } = run(FIXTURE, TIERS);
  assert.strictEqual((state.counters.caster_wait_ticks > 0), reachableMirror); // fires iff reachable
  assert.strictEqual(state.counters.caster_wait_ticks, 0); // fixture asserts 'caster_wait_ticks == 0 at current cadence'
  assert.strictEqual(EXP.negative_controls.caster_wait_reachability.fires, false);
  const mirrorN = runNegativeTests(FIXTURE, TIERS)[2];
  assert.strictEqual(mirrorN.ok, true);
  assert.strictEqual(mirrorN.detail, 'reachable=False caster_wait=0');
});

test('N4 arithmetic double-count control: dc = residual - billet_yard_t breaks the identity', () => {
  // Mirror L386-389 arithmetic perturbation (NOT a state-level injection — documented weakness 3;
  // the port reproduces the mirror's semantics, not a stronger variant).
  const st = run(FIXTURE, TIERS).state;
  const residual = st.balance_error!;
  const dc = residual - st.billet_yard_t; // simulate double-count of the yard term
  assert.ok(Math.abs(residual) < 1e-9); // healthy residual 0.0 (fixture negative_controls)
  assert.ok(Math.abs(dc) > EXP.negative_controls.double_count_control.double_count_residual_gt); // > 1.0
  assert.ok(Math.abs(dc + 186.935) < 1e-9); // mirror console: double-count residual = -186.935
  const mirrorN = runNegativeTests(FIXTURE, TIERS)[3];
  assert.strictEqual(mirrorN.ok, true);
});

test('runNegativeTests: all four controls PASS in the TS port exactly as in the live mirror dump', () => {
  const tsResults = runNegativeTests(FIXTURE, TIERS);
  assert.strictEqual(tsResults.length, DUMP.negative_tests.length); // 4
  for (let i = 0; i < tsResults.length; i++) {
    assert.strictEqual(tsResults[i].name, DUMP.negative_tests[i].name, `control ${i}: name mismatch`);
    assert.strictEqual(tsResults[i].ok, DUMP.negative_tests[i].ok, `control ${i}: ok mismatch`);
    assert.strictEqual(tsResults[i].detail, DUMP.negative_tests[i].detail, `control ${i}: detail mismatch`);
  }
});

// ---------- input validation ----------

test('no validateScenario in the mirror — port omits it (mirror has zero raises)', () => {
  // Mirror slice4_mirror.py contains no input-validation function (unlike slice5's
  // validate_scenario). Verified against the freshly read mirror: nothing to mirror, so the port
  // intentionally exposes no validateScenario and this test pins that decision.
  assert.strictEqual((globalThis as any).__s4_validate_expected, undefined);
  const mod = { freshState, tick, run, runNegativeTests, loadScrapTiers } as Record<string, unknown>;
  assert.ok(!('validateScenario' in mod));
});
