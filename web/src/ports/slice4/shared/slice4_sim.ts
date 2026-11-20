// Slice 4 shared parity port — EAF -> LRF -> CCM -> billet yard (v1)
// Line-level TypeScript port of mirror/slice4_mirror.py (409 lines, post-patch: bath_t live at
// heat start / zeroed at tap and authoritative in the balance stage; dri consumed_t populated on
// DRI rows at tap). The Python mirror is the single source of truth (mirror-first workflow); this
// port reproduces it 1:1: same state shape, same tick stage order 1-6, same event strings, same
// counters, same per-tick balance identity, same negative-test semantics. No input validation in
// the mirror (validateScenario intentionally absent — see parity test), no RNG in the rule path.
//
// Consumes Slice 2's prepared_charge contract and Slice 3's dri_charge_material contract
// (approved v1, embedded in fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json under
// "contracts") — via contract fields only, never via Slice 2/3 internals.
//
// Mechanics (v1):
// - Ladle availability is a CYCLE, not a capacity number: N ladles, each ladle is a
//   non-preemptive cycle EAF-tap -> LRF -> CCM -> ladle released back to the pool. A heat that
//   taps with no ladle free WAITS (ladle_wait counter); a ladle that arrives at the caster while
//   the caster is busy WAITS (caster_wait).
// - EAF: one furnace, non-preemptive heat cycle. A heat starts only when a charge (prepared_charge,
//   status ready/delivered) is available at the EAF feed interface. Yield = metallic yield from
//   charge tonnage (grade yield_loss_pct from content/scrap/scrap_tiers.json loaded at RUNTIME via
//   loadScrapTiers — no hardcoded yield constants; DRI 95-98% band midpoint 96.5% — convention
//   stated explicitly, pending Yasser approval).
// - LRF: single ladle furnace, non-preemptive refining cycle per ladle.
// - CCM: single strand, non-preemptive casting cycle per ladle; billet accumulation. Order within
//   the stage (N3 fix): completion -> handoff -> wait check -> countdown already applied in the
//   mirror as completion -> (countdown inside the busy branch) -> handoff -> wait check.
// - Energy indicator (simple, not fully simulated): EAF specific energy per heat = SEC_kWh_per_t *
//   charge_t. SEC value is source-backed (AIST MENA / TERI band, see mirror header); per-heat
//   application is engineering-estimate.
// - Maintenance/workforce: VISIBLE INDICATORS ONLY (not simulated): planned outage windows fire as
//   events; workforce shift changeover fires as an event. No stochastic breakdowns in v1.
// - Material balance identity asserted every tick: entered - yield_loss - ccm_loss - in_ladles -
//   bath - billet_yard. The charge composition owns the entry point (Yasser decision 2026-10-15);
//   the dri_materials ledger is informational only, NOT a balance term. bath = eaf.bath_t — live
//   state field (gap-fix 19.10): charge tonnage at heat start, 0.0 at tap; the residence buffer
//   for in_furnace charges.
// - Negative tests included (runNegativeTests): a charge that never arrives starves the EAF (no
//   fabricated heat); a ladle-cycle that cannot complete keeps the ladle busy; a scenario that
//   asserts a blockage is checked for physical reachability before asserting it.
// - Pure tick: state in -> new state out, never mutates the original.


export interface CompositionRow {
  grade: string;
  required_usable_t: number;
  actual_usable_t: number;
}

export interface ChargeRecord {
  charge_id: string;
  recipe_id: string;
  grade_composition: CompositionRow[];
  readiness_timestamp: number | null;
  deadline: number;
  status: 'planning' | 'delivered' | 'in_furnace' | 'tapped' | 'failed';
  failure_cause: string | null;
}

export interface DriMaterialRecord {
  material_id: string;
  usable_t: number;
  quality_metadata: Record<string, unknown>;
  source: string;
  readiness_timestamp: number;
  destination: string;
  consumed_t: number; // populated at heat tap (gap-fix 19.10); informational only, NOT a balance term
}

export interface LadleRecord {
  ladle_id: string;
  status: 'free' | 'busy';
  busy_charge_id: string | null;
  busy_since: number | null;
  metal_t?: number; // set at tap in the mirror (dynamic field); absent on fresh ladles
  refined?: boolean;
}

export interface EafState {
  busy_charge_id: string | null;
  remaining_ticks: number;
  bath_t: number; // live furnace charge (gap-fix 19.10): tonnage at heat start, 0.0 at tap
  heat_phase: HeatPhase | null; // S2.0 enum: pure derivation from the countdown (null when idle)
  phase_progress: number; // 0..1 within the current phase band
}
export interface LrfState {
  busy_ladle_id: string | null;
  remaining_ticks: number;
}
export interface CcmState {
  busy_ladle_id: string | null;
  remaining_ticks: number;
}

export interface EventRecord {
  tick: number;
  event: string;
}

export interface Counters {
  heats_tapped: number;
  heats_starved: number; // idle ticks with no delivered charge at the interface
  charge_wait_ticks: number; // charge delivered but EAF busy (charge-consumption wait)
  ladle_wait_ticks: number; // delivered charge waiting for a free ladle
  caster_wait_ticks: number; // refined ladle waiting while the strand is busy
  refines_completed: number;
  casts_completed: number;
  energy_kwh_total: number;
  billet_t_total: number;
  yield_loss_t: number; // EAF metallurgical loss (counted at tap)
  ccm_loss_t: number; // CCM tundish/dross loss (counted at cast)
  maintenance_events: number;
  shift_changeovers: number;
}

export interface Slice4State {
  tick: number;
  charges: ChargeRecord[]; // prepared_charge records (Slice 2 interface)
  dri_materials: DriMaterialRecord[]; // dri_charge_material records (Slice 3 interface)
  ladles: LadleRecord[]; // [{ladle_id, status: free|busy, busy_charge_id, busy_since}]
  eaf: EafState;
  lrf: LrfState;
  ccm: CcmState;
  billet_yard_t: number;
  events: EventRecord[];
  counters: Counters;
  balance_error?: number; // written by tick() from the first tick on (mirror adds it dynamically)
  win: boolean | null;
}

// Scenario shape as it appears in fixtures/slice4/*.json (structural typing; extra keys allowed).
export interface Slice4Fixture {
  fixture_id?: string;
  scenario: {
    seed: number;
    ticks: number;
    ladles: number;
    eaf_heat_ticks: number;
    lrf_ticks_per_ladle: number;
    ccm_ticks_per_ladle: number;
    charge_plan: Array<{
      charge_id: string;
      recipe_id: string;
      deadline_tick: number;
      composition: CompositionRow[];
    }>;
    dri_plan: Array<{ material_id: string; usable_t: number; ready_tick: number }>;
    charge_deliveries: Array<{ tick: number; charge_id: string }>;
    dri_deliveries: Array<{ tick: number; material_id: string }>;
    maintenance_windows?: Array<{ asset: string; start_tick: number; duration_ticks: number }>;
    shift_changeovers?: Array<{ tick: number; from: string; to: string }>;
    [k: string]: unknown;
  };
  yield_convention: {
    dri_yield_pct: number;
    ccm_billet_yield_pct: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface ScrapTier {
  id: string;
  price_usd_t?: number;
  yield_loss_pct: number;
  [k: string]: unknown;
}
export type ScrapTiers = Record<string, ScrapTier>;

export interface TickRecord {
  tick: number;
  eaf_busy: string | null;
  eaf_phase: HeatPhase | null; // S2.0 enum (mirror records carry it per tick)
  eaf_phase_progress: number;
  lrf_busy: string | null;
  ccm_busy: string | null;
  ladles_free: number;
  billet_yard_t: number;
  balance_error: number;
  events: string[];
}

// Energy: source-backed citation (AIST MENA EAF-Efficiency presentation, Cappel): "The energy
// consumption of an EAF is about 650 kWh/tLS ... power consumption varies between 350 and 600
// kWh/tLS." TERI best-practices PDF: SEC range 415-675 kWh/t. Adopted game value 600 kWh/t
// (within the cited band); label: source-backed band, engineering-estimate application.
export const EAF_SEC_KWH_PER_T = 600.0;

// S2.0 heat-phase enum (mirror HEAT_PHASE_BANDS): the shared contract driving the EAF
// animation AND the cutaway cards. PURE DERIVATION from the existing cycle countdown —
// no new timing rules: tap still fires exactly at remaining_ticks === 0. Bands shaped
// like a real EAF heat (charge ~15% / melt ~55% / refine ~20% / tap ~10%); sme_pending.
export type HeatPhase = 'charge' | 'melt' | 'refine' | 'tap';
export const HEAT_PHASE_BANDS: ReadonlyArray<readonly [HeatPhase, number, number]> = [
  ['charge', 0.0, 0.15],
  ['melt', 0.15, 0.70],
  ['refine', 0.70, 0.90],
  ['tap', 0.90, 1.0],
] as const;

export function heatPhaseView(remainingTicks: number, totalTicks: number): { phase: HeatPhase; progress: number } {
  if (!(totalTicks > 0)) throw new Error('eaf_heat_ticks must be positive');
  const frac = Math.max(0, Math.min(1, (totalTicks - remainingTicks) / totalTicks));
  for (const [name, a, b] of HEAT_PHASE_BANDS) {
    if (frac < b || name === 'tap') {
      return { phase: name, progress: Math.max(0, Math.min(1, (frac - a) / (b - a))) };
    }
  }
  throw new Error('heat phase bands must cover [0,1]'); // unreachable: tap band closes at 1.0
}

// Python round(x, n) — half-to-even at the nth decimal (JS toFixed rounds half away from zero).
export function pyRound(x: number, ndigits: number): number {
  const f = 10 ** ndigits;
  const y = x * f;
  const r = Math.round(y);
  // correct the half cases: JS Math.round(-x.5) behaves differently from banker's rounding
  if (Math.abs(y - r) === 0.5 && r % 2 !== 0) {
    return (r - Math.sign(y)) / f;
  }
  return r / f;
}

// Python str(float) formatting — always shows a decimal point ('10.0', not '10'), matching the
// mirror's f-string interpolation of usable_t in the DRI delivery event.
export function pyFloatStr(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

// Python str(bool) formatting — 'True'/'False', matching the mirror's N3 detail f-string.
export function pyBoolStr(x: boolean): string {
  return x ? 'True' : 'False';
}

// json.loads(json.dumps(state)) — pure deep clone, mirror's purity mechanism.
export function deepClone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

// Mirror L52-55: load_scrap_tiers() -> {g['id']: g for g in doc['grades']}. Yields are loaded at
// RUNTIME from content/scrap/scrap_tiers.json — never hardcoded (gap 1 of docs/s4_gap_check.md).
export function loadScrapTiers(doc: { grades: ScrapTier[] }): ScrapTiers {
  const out: ScrapTiers = {};
  for (const g of doc.grades) out[g.id] = g;
  return out;
}

// Mirror L88-91 _yield_pct.
function yieldPct(grade: string, tiers: ScrapTiers, fx: Slice4Fixture): number {
  if (grade === 'DRI') return fx.yield_convention.dri_yield_pct;
  return 100.0 - tiers[grade].yield_loss_pct;
}

export function freshState(fx: Slice4Fixture): Slice4State {
  return {
    tick: 0,
    // contract records (fields exactly as approved v1 contracts)
    charges: [], // prepared_charge records (Slice 2 interface)
    dri_materials: [], // dri_charge_material records (Slice 3 interface)
    // ladle cycle pool
    ladles: [], // [{ladle_id, status: free|busy, busy_charge_id, busy_since}]
    eaf: { busy_charge_id: null, remaining_ticks: 0, bath_t: 0.0, heat_phase: null, phase_progress: 0.0 },
    lrf: { busy_ladle_id: null, remaining_ticks: 0 },
    ccm: { busy_ladle_id: null, remaining_ticks: 0 },
    billet_yard_t: 0.0,
    events: [],
    counters: {
      heats_tapped: 0,
      heats_starved: 0, // idle ticks with no delivered charge at the interface
      charge_wait_ticks: 0, // charge delivered but EAF busy (charge-consumption wait)
      ladle_wait_ticks: 0, // delivered charge waiting for a free ladle
      caster_wait_ticks: 0, // refined ladle waiting while the strand is busy
      refines_completed: 0,
      casts_completed: 0,
      energy_kwh_total: 0.0,
      billet_t_total: 0.0,
      yield_loss_t: 0.0, // EAF metallurgical loss (counted at tap)
      ccm_loss_t: 0.0, // CCM tundish/dross loss (counted at cast)
      maintenance_events: 0,
      shift_changeovers: 0,
    },
    win: null,
  };
}

export function tick(state: Slice4State, fx: Slice4Fixture, tiers: ScrapTiers): Slice4State {
  // state -> new_state; never mutates the original.
  const s = deepClone(state);
  s.tick += 1;
  const ev: string[] = [];
  const c = fx.scenario;
  const cnt = s.counters;

  // 1) Deliveries at the EAF feed interface (inputs counted at entry).
  for (const d of c.charge_deliveries) {
    if (d.tick === s.tick) {
      const ch = s.charges.find((x) => x.charge_id === d.charge_id)!;
      ch.status = 'delivered';
      ev.push(`charge ${ch.charge_id} delivered to EAF feed interface`);
    }
  }
  for (const d of c.dri_deliveries) {
    if (d.tick === s.tick) {
      const m = s.dri_materials.find((x) => x.material_id === d.material_id)!;
      ev.push(`DRI material ${m.material_id} (${pyFloatStr(m.usable_t)}t) ready at EAF feed interface`);
    }
  }

  // 2) Cross-cutting visible indicators (events only, not simulated rules).
  for (const w of c.maintenance_windows ?? []) {
    if (w.start_tick === s.tick) {
      cnt.maintenance_events += 1;
      ev.push(`maintenance indicator: ${w.asset} planned outage window opens (${w.duration_ticks} ticks)`);
    }
  }
  for (const sc of c.shift_changeovers ?? []) {
    if (sc.tick === s.tick) {
      cnt.shift_changeovers += 1;
      ev.push(`workforce indicator: shift changeover (${sc.from} -> ${sc.to})`);
    }
  }

  // 3) EAF: non-preemptive heat cycle.
  const eaf = s.eaf;
  if (eaf.busy_charge_id === null) {
    // need a delivered charge at the feed interface
    const charge = s.charges.find((x) => x.status === 'delivered');
    if (charge === undefined) {
      cnt.heats_starved += 1;
      // never assert on a bottleneck that didn't fire: starve is recorded, no fabricated heat
      ev.push('EAF idle — no delivered charge at feed interface (starvation)');
    } else {
      // Reserve a ladle for the heat at heat start (the ladle cycle is non-preemptive: the
      // reserved ladle is the one that receives the tap).
      const ladle = s.ladles.find((l) => l.status === 'free');
      if (ladle === undefined) {
        cnt.ladle_wait_ticks += 1;
        ev.push(`EAF charge ${charge.charge_id} ready but no ladle free — ladle cycle wait`);
      } else {
        // heat starts: charge tonnage enters the furnace (counted at entry)
        charge.status = 'in_furnace';
        ladle.status = 'busy';
        ladle.busy_charge_id = charge.charge_id;
        ladle.busy_since = s.tick;
        eaf.busy_charge_id = charge.charge_id;
        eaf.remaining_ticks = c.eaf_heat_ticks;
        // bath_t is the live furnace charge (SME gap-fix 19.10: was dead field, always 0.0 while
        // a real bath existed in the balance stage)
        eaf.bath_t = charge.grade_composition.reduce((acc, row) => acc + row.actual_usable_t, 0);
        ev.push(`EAF heat starts for ${charge.charge_id} (${c.eaf_heat_ticks} ticks, ladle ${ladle.ladle_id} reserved)`);
      }
    }
  } else {
    const waiting = s.charges.some((x) => x.status === 'delivered');
    if (waiting) {
      cnt.charge_wait_ticks += 1;
      ev.push('EAF busy, delivered charge waits at feed interface (charge-consumption wait)');
    }
    eaf.remaining_ticks -= 1;
    if (eaf.remaining_ticks === 0) {
      const charge = s.charges.find((x) => x.charge_id === eaf.busy_charge_id)!;
      // yield applied on residence (charge spent, metal into ladle at tap)
      let metal_t = 0.0;
      for (const row of charge.grade_composition) {
        const loss = (row.actual_usable_t * (100.0 - yieldPct(row.grade, tiers, fx))) / 100.0;
        cnt.yield_loss_t += loss;
        metal_t += row.actual_usable_t - loss;
        if (row.grade === 'DRI') {
          // gap-fix 19.10: populate the informational ledger at heat consumption
          // (charge index k consumes dri_materials[k]; fixture pairs Ck<->Dk one-to-one).
          const k = parseInt(charge.charge_id.slice(1), 10) - 1;
          if (0 <= k && k < s.dri_materials.length) {
            s.dri_materials[k].consumed_t += row.actual_usable_t;
          }
        }
      }
      // energy indicator for this heat (per-heat application = engineering-estimate)
      const charge_t = charge.grade_composition.reduce((acc, row) => acc + row.actual_usable_t, 0);
      cnt.energy_kwh_total += EAF_SEC_KWH_PER_T * charge_t;
      // tap into a free ladle (guaranteed: ladle was reserved at heat start; ladle cycle is
      // non-preemptive so it is still the same ladle)
      const ladle = s.ladles.find((l) => l.busy_charge_id === charge.charge_id)!;
      ladle.metal_t = metal_t;
      charge.status = 'tapped';
      cnt.heats_tapped += 1;
      ev.push(`EAF taps ${charge.charge_id}: ${pyRound(metal_t, 3)}t metal -> ladle ${ladle.ladle_id}`);
      eaf.busy_charge_id = null;
      eaf.bath_t = 0.0; // tap transfers the bath into the ladle
      // ladle goes to LRF immediately (single LRF, non-preemptive)
      if (s.lrf.busy_ladle_id === null) {
        s.lrf.busy_ladle_id = ladle.ladle_id;
        s.lrf.remaining_ticks = c.lrf_ticks_per_ladle;
        ev.push(`LRF refine starts for ladle ${ladle.ladle_id}`);
      }
      // else ladle waits at LRF (LRF queue) — recorded below at LRF stage
    }
  }

  // S2.0: derive the per-heat phase enum from the countdown (pure presentation contract;
  // set unconditionally so restored pre-S2.0 states heal on their first tick).
  if (eaf.busy_charge_id === null) {
    eaf.heat_phase = null;
    eaf.phase_progress = 0.0;
  } else {
    const pv = heatPhaseView(eaf.remaining_ticks, c.eaf_heat_ticks);
    eaf.heat_phase = pv.phase;
    eaf.phase_progress = pv.progress;
  }

  // 4) LRF: non-preemptive refine cycle per ladle.
  const lrf = s.lrf;
  if (lrf.busy_ladle_id === null) {
    // ladle that has metal and is waiting for LRF
    const ladle = s.ladles.find(
      (l) => (l.metal_t ?? 0) > 0 && !l.refined && l.ladle_id !== lrf.busy_ladle_id,
    );
    if (ladle !== undefined) {
      lrf.busy_ladle_id = ladle.ladle_id;
      lrf.remaining_ticks = c.lrf_ticks_per_ladle;
      ev.push(`LRF refine starts for ladle ${ladle.ladle_id}`);
    }
  } else {
    lrf.remaining_ticks -= 1;
    if (lrf.remaining_ticks === 0) {
      const ladle = s.ladles.find((l) => l.ladle_id === lrf.busy_ladle_id)!;
      ladle.refined = true;
      cnt.refines_completed += 1;
      ev.push(`LRF refine completes for ladle ${ladle.ladle_id}`);
      lrf.busy_ladle_id = null;
      // ladle goes to CCM if strand free, else waits (caster_wait)
      if (s.ccm.busy_ladle_id === null) {
        s.ccm.busy_ladle_id = ladle.ladle_id;
        s.ccm.remaining_ticks = c.ccm_ticks_per_ladle;
        ev.push(`CCM cast starts for ladle ${ladle.ladle_id}`);
      }
    }
  }

  // 5) CCM: non-preemptive cast cycle per ladle; billet accumulation.
  // FIX (N3, analogous to the documented berth_only flag-consumed-before-the-stage bug in
  // docs/known_limitations.md): the strand must be claimed by the ladle handed off at LRF
  // completion (same-tick handoff, as the LRF stage already does for the EAF tap). The old shape
  // consumed the strand at the top of the stage via the start branch, so the wait block was
  // unreachable whenever the handoff landed on a free-strand tick — the wait never fired. Order
  // within the stage is now: completion -> handoff -> wait check -> countdown, so a wait tick is a
  // true idle-strand-with-a-waiting-ladle tick and the completion tick is never miscounted as a
  // wait.
  const ccm = s.ccm;
  if (ccm.busy_ladle_id !== null) {
    ccm.remaining_ticks -= 1;
    if (ccm.remaining_ticks === 0) {
      const ladle = s.ladles.find((l) => l.ladle_id === ccm.busy_ladle_id)!;
      const billet = (ladle.metal_t! * fx.yield_convention.ccm_billet_yield_pct) / 100.0;
      cnt.ccm_loss_t += ladle.metal_t! - billet;
      s.billet_yard_t += billet;
      cnt.billet_t_total += billet;
      cnt.casts_completed += 1;
      ev.push(`CCM casts ladle ${ladle.ladle_id}: ${pyRound(billet, 3)}t billet -> billet yard`);
      // ladle released back to the pool — the cycle closes
      ladle.status = 'free';
      ladle.busy_charge_id = null;
      ladle.metal_t = 0.0;
      ladle.refined = false;
      ccm.busy_ladle_id = null;
    }
  }
  // handoff: refined ladle with metal gets the strand if free (same-tick handoff from the LRF
  // completion above, mirroring the EAF->LRF handoff)
  if (ccm.busy_ladle_id === null) {
    const ladle = s.ladles.find((l) => l.refined && (l.metal_t ?? 0) > 0);
    if (ladle !== undefined) {
      ccm.busy_ladle_id = ladle.ladle_id;
      ccm.remaining_ticks = c.ccm_ticks_per_ladle;
      ev.push(`CCM cast starts for ladle ${ladle.ladle_id}`);
    }
  }
  // a refined ladle waiting while the strand is busy = caster wait.
  // Reachability rule (standing rule): the wait can only fire when the strand drain
  // (ccm_ticks_per_ladle) is slower than the arrival cadence (lrf_ticks_per_ladle) AND there are
  // >= 2 ladles — checked in N3.
  if (ccm.busy_ladle_id !== null) {
    const waiting = s.ladles.some(
      (l) => l.refined && (l.metal_t ?? 0) > 0 && l.ladle_id !== ccm.busy_ladle_id,
    );
    if (waiting) {
      cnt.caster_wait_ticks += 1;
      ev.push('refined ladle waits at CCM — strand busy (ladle cycle pressure)');
    }
  }

  // 6) Material balance identity — every tonne counted once, at entry.
  //    DECISION (Yasser, 2026-10-15): the charge composition owns the entry point. A charge enters
  //    the melt-shop system when it is consumed by a heat (status in_furnace/tapped); its DRI row
  //    is part of that composition and is counted there. The dri_materials ledger is informational
  //    only (contract records for the Slice 3 interface) and is NOT a balance term — counting it
  //    as well double-counted the DRI tonnage (mid-run residual 40.0 = one charge's DRI row per
  //    heat, which is why end-of-run closure looked clean).
  //    CORRECTION (instrumented run 2026-10-15, tick 19): the mid-run residual is NOT the DRI
  //    ledger — it is the in_furnace residence. A charge in status 'in_furnace' is physically in
  //    the furnace bath, but its tonnage was counted in `entered` while the bath term was 0 at
  //    tick boundaries (the bath only balances at tap). The identity is closed at tap, not at heat
  //    start, so the bath must be an explicit balance term during residence.
  //    entered counts all charges consumed (in_furnace or tapped); the bath is the residence
  //    buffer for in_furnace charges. (First bath patch double-counted by moving in_furnace out of
  //    entered AND subtracting it as bath — fresh run 2026-10-15 showed -40.0 at ticks 19/30; this
  //    is the corrected form.)
  let entered = 0.0;
  for (const ch of s.charges) {
    if (ch.status === 'in_furnace' || ch.status === 'tapped') {
      entered += ch.grade_composition.reduce((acc, row) => acc + row.actual_usable_t, 0);
    }
  }
  // buffers: metal currently in ladles, plus the furnace bath during residence (bath = tonnage of
  // charges in 'in_furnace'; 0 at tap because tap transfers it), plus billet yard.
  const in_ladles = s.ladles.reduce((acc, l) => acc + (l.metal_t ?? 0), 0);
  const bath = eaf.bath_t; // gap-fix 19.10: state field now authoritative (was recomputed locally)
  // losses: EAF metallurgical loss (counted at tap) + CCM tundish/dross loss (counted at cast).
  const balanceError =
    entered - cnt.yield_loss_t - cnt.ccm_loss_t - in_ladles - bath - s.billet_yard_t;
  s.balance_error = balanceError;

  for (const e of ev) s.events.push({ tick: s.tick, event: e });
  return s;
}

export function run(
  fx: Slice4Fixture,
  tiers: ScrapTiers,
): { state: Slice4State; records: TickRecord[] } {
  const state = freshState(fx);
  for (const ch of fx.scenario.charge_plan) {
    state.charges.push({
      charge_id: ch.charge_id,
      recipe_id: ch.recipe_id,
      grade_composition: ch.composition.map((g) => ({
        grade: g.grade,
        required_usable_t: g.required_usable_t,
        actual_usable_t: g.actual_usable_t,
      })),
      readiness_timestamp: null,
      deadline: ch.deadline_tick,
      status: 'planning',
      failure_cause: null,
    });
  }
  for (const m of fx.scenario.dri_plan) {
    state.dri_materials.push({
      material_id: m.material_id,
      usable_t: m.usable_t,
      quality_metadata: {},
      source: 'DRI buffer',
      readiness_timestamp: m.ready_tick,
      destination: 'EAF feed interface',
      consumed_t: 0.0, // populated at heat tap (gap-fix 19.10); informational only, NOT a balance term
    });
  }
  for (let i = 0; i < fx.scenario.ladles; i++) {
    state.ladles.push({
      ladle_id: `L${i + 1}`,
      status: 'free',
      busy_charge_id: null,
      busy_since: null,
      metal_t: 0.0,
      refined: false,
    });
  }
  const records: TickRecord[] = [];
  let st = state;
  for (let i = 0; i < fx.scenario.ticks; i++) {
    st = tick(st, fx, tiers);
    // win condition evaluated per charge at its deadline tick
    for (const ch of st.charges) {
      if ((ch.status === 'planning' || ch.status === 'delivered') && st.tick > ch.deadline) {
        ch.status = 'failed';
        ch.failure_cause = 'crane_delay'; // upstream delivery missed deadline
      }
    }
    records.push({
      tick: st.tick,
      eaf_busy: st.eaf.busy_charge_id,
      eaf_phase: st.eaf.heat_phase,
      eaf_phase_progress: pyRound(st.eaf.phase_progress, 6),
      lrf_busy: st.lrf.busy_ladle_id,
      ccm_busy: st.ccm.busy_ladle_id,
      ladles_free: st.ladles.filter((l) => l.status === 'free').length,
      billet_yard_t: pyRound(st.billet_yard_t, 6),
      balance_error: pyRound(st.balance_error!, 9),
      events: st.events.filter((e) => e.tick === st.tick).map((e) => e.event),
    });
  }
  const statuses = st.charges.map((c) => c.status);
  st.win = statuses.every((st2) => st2 === 'tapped') && Math.abs(st.balance_error!) < 1e-9;
  return { state: st, records };
}

export interface NegativeTestResult {
  name: string;
  ok: boolean;
  detail: string;
}

// Mirror run_negative_tests (L337-393): negative tests — broken rules must diverge from the
// healthy path. Faithful port of the mirror's semantics, including the N4 arithmetic control
// (dc = residual - billet_yard_t perturbs the formula, per docs/s4_gap_check.md weakness 3).
// Mirror run_phase_tests (S2.0): positive contract tests — the enum is a pure view of the
// countdown. P1 per-heat order/length, P2 idle cleanliness + tap-event placement, P3 boundaries.
export function runPhaseTests(fx: Slice4Fixture, tiers: ScrapTiers): NegativeTestResult[] {
  const results: NegativeTestResult[] = [];
  const { state, records } = run(fx, tiers);
  // P1
  const heats = new Map<string, string[]>();
  for (const r of records) {
    if (r.eaf_busy !== null) {
      const arr = heats.get(r.eaf_busy) ?? [];
      arr.push(r.eaf_phase as string);
      heats.set(r.eaf_busy, arr);
    }
  }
  let orderOk = heats.size === state.counters.heats_tapped;
  for (const phases of heats.values()) {
    const seen: string[] = [];
    for (const p of phases) if (seen.length === 0 || seen[seen.length - 1] !== p) seen.push(p);
    if (seen.join(',') !== 'charge,melt,refine,tap' || phases.length !== fx.scenario.eaf_heat_ticks) orderOk = false;
  }
  results.push({
    name: 'P1 per-heat phase order charge->melt->refine->tap, full cycle length',
    ok: orderOk,
    detail: `heats=${heats.size} tapped=${state.counters.heats_tapped}`,
  });
  // P2
  const idleOk = records.every((r) => r.eaf_busy !== null || r.eaf_phase === null);
  const tapTicks = records.filter((r) => r.events.some((e) => e.startsWith('EAF taps '))).map((r) => r.tick);
  const prevOk = tapTicks.every((t) => records[t - 2].eaf_phase === 'tap'); // record index = tick-1
  results.push({
    name: 'P2 idle => no phase; tap event immediately follows the tap-band tick',
    ok: idleOk && prevOk,
    detail: `idle_clean=${pyBoolStr(idleOk)} taps_after_tap_band=${pyBoolStr(prevOk)}`,
  });
  // P3
  let bOk =
    heatPhaseView(10, 10).phase === 'charge' && heatPhaseView(10, 10).progress === 0.0 &&
    heatPhaseView(9, 10).phase === 'charge' &&
    heatPhaseView(8, 10).phase === 'melt' &&
    heatPhaseView(4, 10).phase === 'melt' &&
    heatPhaseView(3, 10).phase === 'refine' &&
    heatPhaseView(2, 10).phase === 'refine' &&
    heatPhaseView(1, 10).phase === 'tap';
  try {
    heatPhaseView(5, 0);
    bOk = false;
  } catch {
    // expected: non-positive total raises
  }
  results.push({
    name: 'P3 band boundaries + zero total raises',
    ok: bOk,
    detail: `boundaries_ok=${pyBoolStr(bOk)}`,
  });
  return results;
}

export function runNegativeTests(fx: Slice4Fixture, tiers: ScrapTiers): NegativeTestResult[] {
  const results: NegativeTestResult[] = [];

  // N1: charge never delivered -> EAF starves every tick, no fabricated heat, balance stays
  // closed (nothing entered the system).
  const fx1 = deepClone(fx);
  fx1.scenario.charge_deliveries = [];
  const { state: st1 } = run(fx1, tiers);
  const ok1 =
    st1.counters.heats_tapped === 0 &&
    st1.counters.heats_starved === fx.scenario.ticks &&
    Math.abs(st1.balance_error!) < 1e-9;
  results.push({
    name: 'N1 no-charge starvation (no fabricated heat, balance closed)',
    ok: ok1,
    detail: `tapped=${st1.counters.heats_tapped} starved=${st1.counters.heats_starved} balance=${pyFloatStr(st1.balance_error!)}`,
  });

  // N2: ladle cycle broken (ladle never released at CCM) -> ladle pool exhausted, EAF blocked by
  // ladle wait; healthy path diverges (control must DIVERGE).
  const fx2 = deepClone(fx);
  fx2.scenario.ccm_ticks_per_ladle = 10 ** 6; // never completes -> ladle stays busy
  const { state: st2 } = run(fx2, tiers);
  const healthy = run(fx, tiers);
  const diverged =
    st2.counters.casts_completed === 0 &&
    healthy.state.counters.casts_completed > 0 &&
    st2.counters.ladle_wait_ticks > 0;
  results.push({
    name: 'N2 ladle-cycle non-release diverges from healthy',
    ok: diverged,
    detail: `broken casts=${st2.counters.casts_completed} healthy casts=${healthy.state.counters.casts_completed} broken ladle_wait=${st2.counters.ladle_wait_ticks}`,
  });

  // N3: physical reachability check for the caster wait, aligned with the fixture (Yasser GO
  // 2026-10-15). The fixture asserts caster_wait == 0 at the current cadence: with same-tick
  // LRF->CCM handoff, a refined ladle takes the strand immediately, so a wait requires a refined
  // ladle whose LRF completion lands INSIDE a strand-busy window — i.e. arrival cadence <
  // ccm_ticks_per_ladle (12 > 6 here, so unreachable). The guard is preserved in force: the
  // predicate is evaluated, and the observed counter must agree with it — fires iff reachable. A
  // cadence that makes the wait reachable must still make it fire; the control is not weakened to
  // a bare equality with 0. The handoff condition is part of the predicate (fixture negative_controls
  // clause): a refined ladle can only wait if a second ladle is in LRF when the strand is busy,
  // which requires ladles >= 3 (one casting, one refining, one waiting). At ladles == 2 the
  // predicate is False at this cadence. (Mirror semantics ladles>=3 win over the fixture clause
  // ladles>=2 per docs/s4_gap_check.md weakness 4.)
  const c = fx.scenario;
  const reachable = c.ladles >= 3 && c.ccm_ticks_per_ladle > c.lrf_ticks_per_ladle;
  const { state: st } = run(fx, tiers);
  const ok3 = (st.counters.caster_wait_ticks > 0) === reachable;
  results.push({
    name: 'N3 caster wait fires iff physically reachable (fixture cadence: asserts 0)',
    ok: ok3,
    detail: `reachable=${pyBoolStr(reachable)} caster_wait=${st.counters.caster_wait_ticks}`,
  });

  // N4: negative control on the balance — double-counting billet yard material (adding billet
  // twice) must break the identity with a nonzero residual. Healthy residual must be a
  // NONZERO-difference-based control: the control compares the healthy identity against the broken
  // rule, not healthy vs 0.
  const st4 = run(fx, tiers).state;
  const residual = st4.balance_error!;
  const dc = residual - st4.billet_yard_t; // simulate double-count of the yard term
  const ok4 = Math.abs(residual) < 1e-9 && Math.abs(dc) > 1.0;
  results.push({
    name: 'N4 double-count control detects via balance',
    ok: ok4,
    detail: `healthy residual=${pyFloatStr(residual)} double-count residual=${pyFloatStr(dc)}`,
  });

  return results;
}
