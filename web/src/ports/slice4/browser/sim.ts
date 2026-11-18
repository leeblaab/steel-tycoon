// Browser-safe deterministic simulation for the playable Slice 4 app.
// TS port of mirror/slice4_mirror.py (single source of truth). Fixture values are
// embedded as build-time content (same pattern as slice1 sim.ts embedding OPS_CONFIG_JSON);
// fixture/mirror files are NOT touched at runtime. Fixture wins over instinct everywhere;
// the Python mirror is re-run by verify_sim.ts and compared field-by-field.
//
// Mechanics copied verbatim from the mirror (stage order: deliveries -> indicators ->
// EAF -> LRF -> CCM(completion -> handoff -> wait check) -> balance identity):
// - Ladles are a non-preemptive CYCLE: EAF tap -> LRF -> CCM -> released to pool.
// - Ladle is RESERVED at heat start (tap goes to the same ladle).
// - Same-tick LRF->CCM handoff (strand claimed at LRF completion).
// - Furnace bath is an explicit residence buffer during 'in_furnace' status so the
//   material identity closes EVERY tick, not only at tap.

export interface GradeRow {
  grade: string;
  required_usable_t: number;
  actual_usable_t: number;
}

export interface ChargeRecord {
  charge_id: string;
  recipe_id: string;
  grade_composition: GradeRow[];
  deadline: number;
  status: 'planning' | 'delivered' | 'in_furnace' | 'tapped' | 'failed';
  failure_cause: string | null;
}

export interface LadleRecord {
  ladle_id: string;
  status: 'free' | 'busy';
  busy_charge_id: string | null;
  busy_since: number | null;
  metal_t: number;
  refined: boolean;
}

export interface Counters {
  heats_tapped: number;
  heats_starved: number;
  charge_wait_ticks: number;
  ladle_wait_ticks: number;
  caster_wait_ticks: number;
  refines_completed: number;
  casts_completed: number;
  energy_kwh_total: number;
  billet_t_total: number;
  yield_loss_t: number;
  ccm_loss_t: number;
  maintenance_events: number;
  shift_changeovers: number;
}

export interface TickRecord {
  tick: number;
  eaf_busy: string | null;
  lrf_busy: string | null;
  ccm_busy: string | null;
  ladles_free: number;
  billet_yard_t: number; // rounded to 6 decimals, exactly as the mirror record
  balance_error: number; // rounded to 9 decimals, exactly as the mirror record
  events: string[];
}

export interface RunResult {
  records: TickRecord[];
  allEvents: Array<{ tick: number; event: string }>;
  counters: Counters;
  billetYardT: number;
  balanceErrorEnd: number;
  win: boolean;
}

// ---- fixture-embedded scenario content (fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json) ----
export const FIXTURE_ID = 's4_eaf_lrf_ccm_billet_seed11_120';
export const EAF_SEC_KWH_PER_T = 600.0; // fixture energy.eaf_sec_kwh_per_t (engineering-estimate, cited band)

export const SCENARIO = {
  seed: 11,
  ticks: 120,
  ladles: 2,
  eaf_heat_ticks: 10,
  lrf_ticks_per_ladle: 4,
  ccm_ticks_per_ladle: 6,
  charge_plan: [
    { charge_id: 'C1', recipe_id: 'R1', deadline_tick: 30, composition: [{ grade: 'hms1_hms2', required_usable_t: 30.0, actual_usable_t: 30.0 }, { grade: 'DRI', required_usable_t: 10.0, actual_usable_t: 10.0 }] },
    { charge_id: 'C2', recipe_id: 'R1', deadline_tick: 42, composition: [{ grade: 'hms1_hms2', required_usable_t: 30.0, actual_usable_t: 30.0 }, { grade: 'DRI', required_usable_t: 10.0, actual_usable_t: 10.0 }] },
    { charge_id: 'C3', recipe_id: 'R1', deadline_tick: 54, composition: [{ grade: 'hms1_hms2', required_usable_t: 30.0, actual_usable_t: 30.0 }, { grade: 'DRI', required_usable_t: 10.0, actual_usable_t: 10.0 }] },
    { charge_id: 'C4', recipe_id: 'R1', deadline_tick: 66, composition: [{ grade: 'hms1_hms2', required_usable_t: 30.0, actual_usable_t: 30.0 }, { grade: 'DRI', required_usable_t: 10.0, actual_usable_t: 10.0 }] },
    { charge_id: 'C5', recipe_id: 'R1', deadline_tick: 78, composition: [{ grade: 'hms1_hms2', required_usable_t: 30.0, actual_usable_t: 30.0 }, { grade: 'DRI', required_usable_t: 10.0, actual_usable_t: 10.0 }] },
  ],
  dri_plan: [
    { material_id: 'D1', usable_t: 10.0, ready_tick: 1 },
    { material_id: 'D2', usable_t: 10.0, ready_tick: 13 },
    { material_id: 'D3', usable_t: 10.0, ready_tick: 25 },
    { material_id: 'D4', usable_t: 10.0, ready_tick: 37 },
    { material_id: 'D5', usable_t: 10.0, ready_tick: 49 },
  ],
  charge_deliveries: [{ tick: 1, charge_id: 'C1' }, { tick: 12, charge_id: 'C2' }, { tick: 24, charge_id: 'C3' }, { tick: 36, charge_id: 'C4' }, { tick: 48, charge_id: 'C5' }],
  dri_deliveries: [{ tick: 1, material_id: 'D1' }, { tick: 13, material_id: 'D2' }, { tick: 25, material_id: 'D3' }, { tick: 37, material_id: 'D4' }, { tick: 49, material_id: 'D5' }],
  maintenance_windows: [
    { asset: 'EAF', start_tick: 60, duration_ticks: 8 }, // visible indicator only (fixture note)
    { asset: 'CCM', start_tick: 90, duration_ticks: 6 },
  ],
  shift_changeovers: [{ tick: 30, from: 'A', to: 'B' }, { tick: 60, from: 'B', to: 'C' }, { tick: 90, from: 'C', to: 'A' }],
};

export const YIELD = {
  dri_yield_pct: 96.5,        // fixture yield_convention (midpoint convention, pending Yasser approval)
  ccm_billet_yield_pct: 98.0, // game-balance
  grade_yield_loss_pct: { hms1_hms2: 5.0, bushing: 3.0, shredded: 8.0 } as Record<string, number>, // content/scrap/scrap_tiers.json
};

export const EXPECTED_OUTPUTS = {
  events: {
    heat_starts: [1, 12, 24, 36, 48],
    taps: [11, 22, 34, 46, 58],
    refines_complete: [14, 25, 37, 49, 61],
    casts_complete: [19, 30, 42, 54, 66],
    maintenance_events: [60, 90],
    shift_changeovers: [30, 60, 90],
  },
  key_ticks: {
    '19': { ladles_free: 1, billet_yard_t: 37.387, balance_error: 0.0 },
    '30': { ladles_free: 1, billet_yard_t: 74.774, balance_error: 0.0 },
    '66': { ladles_free: 2, billet_yard_t: 186.935, balance_error: 0.0 },
  },
  material_balance: { balance_error_at_end: 0.0, tolerance: 1e-9 },
  counters_at_tick_120: {
    heats_tapped: 5, heats_starved: 65, refines_completed: 5, casts_completed: 5,
    charge_wait_ticks: 0, ladle_wait_ticks: 0, caster_wait_ticks: 0,
    energy_kwh_total: 120000.0, billet_t_total: 186.935,
  },
};

export const KEY_TICKS = [19, 30, 66];

// ---- negative-scenario variants (fixture negative_controls) for the UI toggle ----
export type ScenarioVariant = 'healthy' | 'no_charge_delivery' | 'ladle_never_released';
export interface VariantExpectation {
  id: string;
  note: string;
  assert: (r: RunResult) => boolean;
}
export const NEGATIVE_CONTROLS: VariantExpectation[] = [
  {
    id: 'no_charge_delivery',
    note: 'N1: no charge delivery -> EAF starves every tick, no fabricated heat, balance closed.',
    assert: (r) => r.counters.heats_tapped === 0 && r.counters.heats_starved === SCENARIO.ticks && Math.abs(r.balanceErrorEnd) < 1e-9,
  },
  {
    id: 'ladle_never_released',
    note: 'N2: CCM never completes -> ladle pool exhausted; casts=0 and ladle_wait>0 diverge from healthy.',
    assert: (r) => r.counters.casts_completed === 0 && r.counters.ladle_wait_ticks > 0,
  },
];

// ---- pure tick: state in -> new state out, never mutates the original ----
interface SimState {
  tick: number;
  charges: ChargeRecord[];
  ladles: LadleRecord[];
  eaf: { busy_charge_id: string | null; remaining_ticks: number };
  lrf: { busy_ladle_id: string | null; remaining_ticks: number };
  ccm: { busy_ladle_id: string | null; remaining_ticks: number };
  billet_yard_t: number;
  events: Array<{ tick: number; event: string }>;
  counters: Counters;
  balance_error: number;
}

function yieldPct(grade: string): number {
  if (grade === 'DRI') return YIELD.dri_yield_pct;
  return 100.0 - YIELD.grade_yield_loss_pct[grade];
}

function freshState(): SimState {
  return {
    tick: 0,
    charges: SCENARIO.charge_plan.map((ch) => ({
      charge_id: ch.charge_id, recipe_id: ch.recipe_id,
      grade_composition: ch.composition.map((g) => ({ grade: g.grade, required_usable_t: g.required_usable_t, actual_usable_t: g.actual_usable_t })),
      deadline: ch.deadline_tick, status: 'planning' as const, failure_cause: null,
    })),
    ladles: Array.from({ length: SCENARIO.ladles }, (_, i) => ({
      ladle_id: `L${i + 1}`, status: 'free' as const, busy_charge_id: null, busy_since: null, metal_t: 0.0, refined: false,
    })),
    eaf: { busy_charge_id: null, remaining_ticks: 0 },
    lrf: { busy_ladle_id: null, remaining_ticks: 0 },
    ccm: { busy_ladle_id: null, remaining_ticks: 0 },
    billet_yard_t: 0.0,
    events: [],
    counters: {
      heats_tapped: 0, heats_starved: 0, charge_wait_ticks: 0, ladle_wait_ticks: 0, caster_wait_ticks: 0,
      refines_completed: 0, casts_completed: 0, energy_kwh_total: 0.0, billet_t_total: 0.0,
      yield_loss_t: 0.0, ccm_loss_t: 0.0, maintenance_events: 0, shift_changeovers: 0,
    },
    balance_error: 0.0,
  };
}

export interface TickOptions {
  variant?: ScenarioVariant; // fixture negative_controls as visible modes
}

function tick(s: SimState, opts: TickOptions): SimState {
  const n: SimState = structuredClone(s);
  n.tick += 1;
  const ev: string[] = [];
  const c = SCENARIO;
  const cnt = n.counters;
  const variant = opts.variant ?? 'healthy';

  // 1) Deliveries at the EAF feed interface (inputs counted at entry).
  if (variant !== 'no_charge_delivery') {
    for (const d of c.charge_deliveries) {
      if (d.tick === n.tick) {
        const ch = n.charges.find((x) => x.charge_id === d.charge_id)!;
        ch.status = 'delivered';
        ev.push(`charge ${ch.charge_id} delivered to EAF feed interface`);
      }
    }
  }
  for (const d of c.dri_deliveries) {
    if (d.tick === n.tick) {
      const m = c.dri_plan.find((x) => x.material_id === d.material_id)!;
      ev.push(`DRI material ${m.material_id} (${m.usable_t}t) ready at EAF feed interface`);
    }
  }

  // 2) Cross-cutting visible indicators (events only, not simulated rules).
  for (const w of c.maintenance_windows) {
    if (w.start_tick === n.tick) {
      cnt.maintenance_events += 1;
      ev.push(`maintenance indicator: ${w.asset} planned outage window opens (${w.duration_ticks} ticks)`);
    }
  }
  for (const sc of c.shift_changeovers) {
    if (sc.tick === n.tick) {
      cnt.shift_changeovers += 1;
      ev.push(`workforce indicator: shift changeover (${sc.from} -> ${sc.to})`);
    }
  }

  // 3) EAF: non-preemptive heat cycle.
  const eaf = n.eaf;
  if (eaf.busy_charge_id === null) {
    const charge = n.charges.find((x) => x.status === 'delivered') ?? null;
    if (charge === undefined || charge === null) {
      cnt.heats_starved += 1;
      ev.push('EAF idle — no delivered charge at feed interface (starvation)');
    } else {
      const ladle = n.ladles.find((l) => l.status === 'free') ?? null;
      if (ladle === null) {
        cnt.ladle_wait_ticks += 1;
        ev.push(`EAF charge ${charge.charge_id} ready but no ladle free — ladle cycle wait`);
      } else {
        charge.status = 'in_furnace';
        ladle.status = 'busy';
        ladle.busy_charge_id = charge.charge_id;
        ladle.busy_since = n.tick;
        eaf.busy_charge_id = charge.charge_id;
        eaf.remaining_ticks = c.eaf_heat_ticks;
        ev.push(`EAF heat starts for ${charge.charge_id} (${c.eaf_heat_ticks} ticks, ladle ${ladle.ladle_id} reserved)`);
      }
    }
  } else {
    if (n.charges.some((x) => x.status === 'delivered')) {
      cnt.charge_wait_ticks += 1;
      ev.push('EAF busy, delivered charge waits at feed interface (charge-consumption wait)');
    }
    eaf.remaining_ticks -= 1;
    if (eaf.remaining_ticks === 0) {
      const charge = n.charges.find((x) => x.charge_id === eaf.busy_charge_id)!;
      let metal_t = 0.0;
      for (const row of charge.grade_composition) {
        const loss = row.actual_usable_t * (100.0 - yieldPct(row.grade)) / 100.0;
        cnt.yield_loss_t += loss;
        metal_t += row.actual_usable_t - loss;
      }
      const charge_t = charge.grade_composition.reduce((a, r) => a + r.actual_usable_t, 0);
      cnt.energy_kwh_total += EAF_SEC_KWH_PER_T * charge_t;
      const ladle = n.ladles.find((l) => l.busy_charge_id === charge.charge_id)!;
      ladle.metal_t = metal_t;
      charge.status = 'tapped';
      cnt.heats_tapped += 1;
      ev.push(`EAF taps ${charge.charge_id}: ${round3(metal_t)}t metal -> ladle ${ladle.ladle_id}`);
      eaf.busy_charge_id = null;
      if (n.lrf.busy_ladle_id === null) {
        n.lrf.busy_ladle_id = ladle.ladle_id;
        n.lrf.remaining_ticks = c.lrf_ticks_per_ladle;
        ev.push(`LRF refine starts for ladle ${ladle.ladle_id}`);
      }
    }
  }

  // 4) LRF: non-preemptive refine cycle per ladle.
  const lrf = n.lrf;
  if (lrf.busy_ladle_id === null) {
    const ladle = n.ladles.find((l) => l.metal_t > 0 && !l.refined && l.ladle_id !== lrf.busy_ladle_id) ?? null;
    if (ladle) {
      lrf.busy_ladle_id = ladle.ladle_id;
      lrf.remaining_ticks = c.lrf_ticks_per_ladle;
      ev.push(`LRF refine starts for ladle ${ladle.ladle_id}`);
    }
  } else {
    lrf.remaining_ticks -= 1;
    if (lrf.remaining_ticks === 0) {
      const ladle = n.ladles.find((l) => l.ladle_id === lrf.busy_ladle_id)!;
      ladle.refined = true;
      cnt.refines_completed += 1;
      ev.push(`LRF refine completes for ladle ${ladle.ladle_id}`);
      lrf.busy_ladle_id = null;
      if (n.ccm.busy_ladle_id === null) {
        n.ccm.busy_ladle_id = ladle.ladle_id;
        n.ccm.remaining_ticks = c.ccm_ticks_per_ladle;
        ev.push(`CCM cast starts for ladle ${ladle.ladle_id}`);
      }
    }
  }

  // 5) CCM: completion -> handoff -> wait check (mirror N3 fix order).
  const ccm = n.ccm;
  if (ccm.busy_ladle_id !== null) {
    ccm.remaining_ticks -= 1;
    if (ccm.remaining_ticks === 0) {
      const ladle = n.ladles.find((l) => l.ladle_id === ccm.busy_ladle_id)!;
      // [OPEN QUESTION] N2 variant models the fixture's `ccm_ticks_per_ladle = 10**6`
      // (cast never completes) as "never release the ladle" — identical observable
      // outcome, no tick-count overflow. Fixture-faithful choice; logged.
      if (variant !== 'ladle_never_released') {
        const billet = ladle.metal_t * YIELD.ccm_billet_yield_pct / 100.0;
        cnt.ccm_loss_t += ladle.metal_t - billet;
        n.billet_yard_t += billet;
        cnt.billet_t_total += billet;
        cnt.casts_completed += 1;
        ev.push(`CCM casts ladle ${ladle.ladle_id}: ${round3(billet)}t billet -> billet yard`);
        ladle.status = 'free';
        ladle.busy_charge_id = null;
        ladle.metal_t = 0.0;
        ladle.refined = false;
      } else {
        ev.push(`CCM stuck on ladle ${ladle.ladle_id} (N2 control: cast never completes)`);
      }
      ccm.busy_ladle_id = null;
    }
  }
  if (ccm.busy_ladle_id === null && variant !== 'ladle_never_released') {
    const ladle = n.ladles.find((l) => l.refined && l.metal_t > 0) ?? null;
    if (ladle) {
      ccm.busy_ladle_id = ladle.ladle_id;
      ccm.remaining_ticks = c.ccm_ticks_per_ladle;
      ev.push(`CCM cast starts for ladle ${ladle.ladle_id}`);
    }
  }
  if (ccm.busy_ladle_id !== null) {
    const waiting = n.ladles.some((l) => l.refined && l.metal_t > 0 && l.ladle_id !== ccm.busy_ladle_id);
    if (waiting) {
      cnt.caster_wait_ticks += 1;
      ev.push('refined ladle waits at CCM — strand busy (ladle cycle pressure)');
    }
  }

  // 6) Material balance identity — every tonne counted once, at entry.
  //    entered counts charges consumed (in_furnace or tapped); the bath is the
  //    residence buffer for in_furnace charges (mirror correction 2026-10-15).
  let entered = 0.0;
  for (const ch of n.charges) {
    if (ch.status === 'in_furnace' || ch.status === 'tapped') {
      entered += ch.grade_composition.reduce((a, r) => a + r.actual_usable_t, 0);
    }
  }
  const in_ladles = n.ladles.reduce((a, l) => a + l.metal_t, 0);
  let bath = 0.0;
  for (const ch of n.charges) {
    if (ch.status === 'in_furnace') bath += ch.grade_composition.reduce((a, r) => a + r.actual_usable_t, 0);
  }
  n.balance_error = entered - cnt.yield_loss_t - cnt.ccm_loss_t - in_ladles - bath - n.billet_yard_t;

  n.events = n.events.concat(ev.map((e) => ({ tick: n.tick, event: e })));
  return n;
}

function round3(x: number): number { return Math.round(x * 1000) / 1000; }
function round6(x: number): number { return Math.round(x * 1e6) / 1e6; }
function round9(x: number): number { return Math.round(x * 1e9) / 1e9; }

export function runSlice4(opts: TickOptions = {}): RunResult {
  let st = freshState();
  const records: TickRecord[] = [];
  for (let i = 0; i < SCENARIO.ticks; i++) {
    st = tick(st, opts);
    // win-condition deadline evaluation (mirror run(): planning/delivered past deadline -> failed)
    for (const ch of st.charges) {
      if ((ch.status === 'planning' || ch.status === 'delivered') && st.tick > ch.deadline) {
        ch.status = 'failed';
        ch.failure_cause = 'crane_delay';
      }
    }
    records.push({
      tick: st.tick,
      eaf_busy: st.eaf.busy_charge_id,
      lrf_busy: st.lrf.busy_ladle_id,
      ccm_busy: st.ccm.busy_ladle_id,
      ladles_free: st.ladles.filter((l) => l.status === 'free').length,
      billet_yard_t: round6(st.billet_yard_t),
      balance_error: round9(st.balance_error),
      events: st.events.filter((e) => e.tick === st.tick).map((e) => e.event),
    });
  }
  const win = st.charges.every((c) => c.status === 'tapped') && Math.abs(st.balance_error) < 1e-9;
  return { records, allEvents: st.events, counters: st.counters, billetYardT: st.billet_yard_t, balanceErrorEnd: st.balance_error, win };
}

// ---- event-tick extraction for the verification report (same predicates as fixture keys) ----
export function extractEventTicks(r: RunResult) {
  const has = (t: number, s: string) => r.records[t - 1].events.some((e) => e.includes(s));
  return {
    heat_starts: r.records.filter((rec) => has(rec.tick, 'EAF heat starts')).map((rec) => rec.tick),
    taps: r.records.filter((rec) => has(rec.tick, 'EAF taps')).map((rec) => rec.tick),
    refines_complete: r.records.filter((rec) => has(rec.tick, 'LRF refine completes')).map((rec) => rec.tick),
    casts_complete: r.records.filter((rec) => has(rec.tick, 'CCM casts ladle')).map((rec) => rec.tick),
    maintenance_events: r.records.filter((rec) => has(rec.tick, 'maintenance indicator')).map((rec) => rec.tick),
    shift_changeovers: r.records.filter((rec) => has(rec.tick, 'shift changeover')).map((rec) => rec.tick),
  };
}
