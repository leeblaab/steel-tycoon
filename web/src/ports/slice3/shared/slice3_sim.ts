// Slice 3 shared parity port — line-level TypeScript port of mirror/slice3_mirror.py
// (single source of truth; mirror-first workflow). No rule rewrite, no re-tuning:
// every mechanic mirrors the Python tick()/run()/summarize() exactly, including
// epsilon conventions (1e-9), event-string wording (the mirror derives flags from its
// own event strings: 'refused' -> blocked, 'SKIPPED' -> starved, 'TRIP fires' -> trip),
// the xorshift32 draw contract (draw consumed at EVERY trip tick, fired with p), and
// Python round() semantics (banker's rounding) for event-string / record numbers.
//
// Test seams the browser sim lacks (see docs in slice3_parity.test.ts audit block):
//   - freshState/tick/run/summarize are exported so vitest can drive them directly;
//   - prngSeries(): per-tick prng_state walk (prng parity at trip ticks);
//   - pyRound: shared banker's-rounding helper (mirror uses Python round(), the
//     browser sim used Math.round() — half-up — a divergence resolved here).
// Canonical xorshift32 is imported from web/src/prng.ts (identical semantics to
// mirror/xorshift32_check.py); prng_state lives INSIDE the sim state, like the mirror.

import { xorshift32Next } from '../../../prng.js';

// ---------- Fixtures ----------

export interface S3Scenario {
  seed: number;
  ticks: number;
  drp: {
    discharge_t_per_tick: number;
    trip_probability: number;
    trip_ticks: number[];
    trip_duration_ticks: number;
  };
  buffer: {
    capacity_t: number;
    fill_state_threshold_t: number;
    starve_threshold_t: number;
  };
  eaf: {
    charge_t: number;
    heat_plan: number[];
  };
}

export interface S3Fixture {
  fixture_id: string;
  scenario: S3Scenario;
  expected_outputs: {
    win: boolean;
    fill_state_ticks: number[];
    blocked_ticks: number[];
    starve_ticks: number[];
    trip_fired_ticks: number[];
    heats: Record<string, [string, string | null]>;
  };
}

// ---------- Validation (mirrors validate_scenario L52-80; fail loudly) ----------

export function validateScenario(fx: S3Fixture): void {
  const sc = fx.scenario;
  if (sc.seed === 0) throw new Error('zero seed rejected (xorshift32 is degenerate at 0)');
  if (sc.ticks <= 0) throw new Error('ticks must be positive');
  if (sc.drp.discharge_t_per_tick <= 0) throw new Error('drp.discharge_t_per_tick must be positive');
  if (sc.buffer.capacity_t <= 0) throw new Error('buffer.capacity_t must be positive');
  if (!(0 < sc.buffer.starve_threshold_t && sc.buffer.starve_threshold_t < sc.buffer.fill_state_threshold_t && sc.buffer.fill_state_threshold_t <= sc.buffer.capacity_t))
    throw new Error('buffer thresholds must satisfy 0 < starve < fill <= capacity');
  if (sc.eaf.charge_t <= 0) throw new Error('eaf.charge_t must be positive');
  if (sc.eaf.heat_plan.length === 0) throw new Error('eaf.heat_plan must be non-empty');
  if (sc.eaf.heat_plan.some((t) => t <= 0 || t > sc.ticks)) throw new Error('heat_plan ticks must be within (0, ticks]');
  if (new Set(sc.eaf.heat_plan).size !== sc.eaf.heat_plan.length) throw new Error('heat_plan ticks must be unique');
  const p = sc.drp.trip_probability;
  if (!(0.0 < p && p < 1.0)) throw new Error('drp.trip_probability must be in (0,1)');
  if (sc.drp.trip_duration_ticks <= 0) throw new Error('drp.trip_duration_ticks must be positive');
  if (sc.drp.trip_ticks.some((t) => t <= 0 || t > sc.ticks)) throw new Error('trip_ticks must be within (0, ticks]');
}

// ---------- Contracts (dri_charge_material v1 — fields as-is, quality_metadata RESERVED) ----------

export interface DriLot {
  material_id: string;
  usable_t: number;
  quality_metadata: null; // RESERVED — metalization/re-oxidation later
  source: 'DRP discharge' | 'DRI buffer';
  readiness_timestamp: number | null;
  destination: 'EAF feed interface';
}

export interface HeatRecord extends DriLot {
  status: 'charged' | 'skipped';
  failure_cause?: string | null;
  lots_taken: string[];
}

// State shape identical to mirror fresh_state (L82-93): prng_state INSIDE sim state.
export interface SimState {
  tick: number;
  prng_state: number;
  buffer: DriLot[]; // FIFO lots
  buffer_t: number;
  drp_tripped_until: number; // tick until which discharge is halted (0 = running)
  heats: HeatRecord[];
  events: Array<{ tick: number; event: string }>;
  win: boolean | null;
}

// JSON round-trip deep clone — mirrors the mirror's `json.loads(json.dumps(state))`
// (undefined-valued optional keys vanish, exactly like Python absent keys).
export function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

// Python repr() for finite floats (shortest round-trip representation): 2.0 -> '2.0',
// 30.0 -> '30.0'. JS String(2.0) drops the '.0' — a divergence the browser sim shares;
// the mirror's f-strings interpolate raw floats with repr(), so the port must re-attach
// the '.0' for integral values to keep event strings byte-identical.
export function pyNum(x: number): string {
  return Number.isInteger(x) ? `${x}.0` : String(x);
}

// Python round(x, n) semantics (banker's rounding to nearest even on exact ties);
// the mirror emits event strings via round(..., 2) and records via round(..., 4).
export function pyRound(x: number, ndigits = 0): number {
  const m = 10 ** ndigits;
  const y = x * m;
  const f = Math.floor(y);
  const d = y - f;
  let r: number;
  if (d > 0.5) r = f + 1;
  else if (d < 0.5) r = f;
  else r = f % 2 === 0 ? f : f + 1; // tie -> nearest even
  return r / m;
}

function lot(material_id: string, usable_t: number, discharge_tick: number): DriLot {
  // dri_charge_material contract v1 — fields used as-is (quality_metadata reserved).
  return {
    material_id,
    usable_t,
    quality_metadata: null,
    source: 'DRP discharge',
    readiness_timestamp: discharge_tick,
    destination: 'EAF feed interface',
  };
}

export function freshState(fx: S3Fixture): SimState {
  const sc = fx.scenario;
  return {
    tick: 0,
    prng_state: sc.seed >>> 0,
    buffer: [],
    buffer_t: 0.0,
    drp_tripped_until: 0,
    heats: [],
    events: [],
    win: null,
  };
}

// state -> new_state; never mutates the original (mirror L106-183).
export function tick(state: SimState, fx: S3Fixture): SimState {
  const s = deepClone(state);
  const sc = fx.scenario;
  s.tick += 1;
  const ev: string[] = [];

  // 1) DRP trip gate: draw consumed at every trip tick (draw contract),
  //    fires trip with probability p; trip halts discharge.
  if (sc.drp.trip_ticks.includes(s.tick)) {
    const { newState, draw } = xorshift32Next(s.prng_state);
    s.prng_state = newState;
    if (draw < sc.drp.trip_probability) {
      s.drp_tripped_until = s.tick + sc.drp['trip_duration_ticks'];
      ev.push(`DRP TRIP fires at tick ${s.tick} (draw ${draw.toFixed(4)} < p ${pyNum(sc.drp.trip_probability)}), halted ${sc.drp['trip_duration_ticks']} ticks`);
    }
  }

  // 2) DRP discharge (continuous supply) -> buffer, capacity-gated
  if (s.tick <= s.drp_tripped_until) {
    ev.push('DRP halted (trip)');
  } else {
    const rate = sc.drp.discharge_t_per_tick;
    const room = sc.buffer.capacity_t - s.buffer_t;
    if (rate > room + 1e-9) {
      ev.push(`buffer FULL: discharge refused ${pyNum(rate)}t (room ${pyNum(pyRound(room, 2))}t)`);
    } else {
      s.buffer.push(lot(`M${s.tick}`, rate, s.tick));
      s.buffer_t += rate;
      ev.push(`DRP discharge ${pyNum(rate)}t -> buffer (${pyNum(pyRound(s.buffer_t, 2))}t)`);
    }
  }

  // 3) EAF batch demand (FIFO take, full charge or skip)
  if (sc.eaf.heat_plan.includes(s.tick)) {
    const need = sc.eaf.charge_t;
    if (s.buffer_t + 1e-9 >= need) {
      const taken: string[] = [];
      let rem = need;
      while (rem > 1e-9 && s.buffer.length > 0) {
        const l = s.buffer[0];
        const take = Math.min(l.usable_t, rem);
        l.usable_t -= take;
        rem -= take;
        if (l.usable_t <= 1e-9) s.buffer.shift();
        taken.push(l.material_id);
      }
      s.buffer_t -= need;
      const heat: HeatRecord = {
        material_id: `H${s.tick}`,
        usable_t: need,
        quality_metadata: null,
        source: 'DRI buffer',
        readiness_timestamp: s.tick,
        destination: 'EAF feed interface',
        status: 'charged',
        lots_taken: taken,
      };
      s.heats.push(heat);
      ev.push(`EAF heat at tick ${s.tick}: ${pyNum(need)}t taken (lots ${taken.join(',')})`);
    } else {
      const heat: HeatRecord = {
        material_id: `H${s.tick}`,
        usable_t: 0.0,
        quality_metadata: null,
        source: 'DRI buffer',
        readiness_timestamp: null,
        destination: 'EAF feed interface',
        status: 'skipped',
        failure_cause: null, // attributed at scenario end
        lots_taken: [],
      };
      s.heats.push(heat);
      ev.push(`EAF heat at tick ${s.tick} SKIPPED: buffer short (${pyNum(pyRound(s.buffer_t, 2))}t < ${pyNum(need)}t)`);
    }
  }

  // 4) State flags for this tick
  if (s.buffer_t >= sc.buffer.fill_state_threshold_t - 1e-9) {
    ev.push(`buffer state: FULL (>= ${pyNum(sc.buffer.fill_state_threshold_t)}t)`);
  }
  if (ev.some((e) => e.includes('SKIPPED'))) {
    ev.push(`buffer state: STARVED (< ${pyNum(sc.buffer.starve_threshold_t)}t)`);
  }

  for (const e of ev) s.events.push({ tick: s.tick, event: e });
  return s;
}

// ---------- Per-tick record — shape identical to mirror run() records (L185-203) ----------

export interface TickRecord {
  tick: number;
  buffer_t: number; // pyRound(buffer_t, 4) — Python round semantics
  drp_tripped: boolean;
  heat: 'charged' | 'skipped' | null;
  flags: { full: boolean; blocked: boolean; starved: boolean };
  events: string[];
}

// mirror run() (L185-226), verbatim structure including the dead-code recompute
// steps at L205-214 (kept for line-level fidelity; total_discharge is derived from
// 'DRP discharge' events exactly as the mirror does).
export function run(fx: S3Fixture): { state: SimState; records: TickRecord[] } {
  let state = freshState(fx);
  const records: TickRecord[] = [];
  for (let i = 0; i < fx.scenario.ticks; i++) {
    state = tick(state, fx);
    const ev = state.events.filter((e) => e.tick === state.tick).map((e) => e.event);
    records.push({
      tick: state.tick,
      buffer_t: pyRound(state.buffer_t, 4),
      drp_tripped: state.tick <= state.drp_tripped_until,
      heat: null,
      flags: {
        full: state.buffer_t >= fx.scenario.buffer.fill_state_threshold_t - 1e-9,
        blocked: ev.some((e) => e.includes('refused')),
        starved: ev.some((e) => e.includes('SKIPPED')),
      },
      events: ev,
    });
    for (const h of state.heats) {
      if (h.readiness_timestamp === state.tick) records[records.length - 1].heat = h.status;
    }
  }

  // failure cause attribution for skipped heats (mirror L204-224):
  // plan_overdraw if even a full DRP output (no trips) can't cover all heats by
  // the last heat tick; otherwise buffer_starved at that tick.
  for (const h of state.heats) {
    if (h.status === 'skipped') {
      const lastHeat = Math.max(...fx.scenario.eaf.heat_plan);
      const maxPossible = fx.scenario.drp.discharge_t_per_tick * lastHeat;
      h.failure_cause =
        maxPossible < fx.scenario.eaf.charge_t * fx.scenario.eaf.heat_plan.length - 1e-9
          ? 'plan_overdraw'
          : 'buffer_starved';
    }
  }
  state.win = state.heats.every((h) => h.status === 'charged');
  return { state, records };
}

export function runSlice3(fixture: S3Fixture): { state: SimState; records: TickRecord[] } {
  validateScenario(fixture);
  return run(fixture);
}

// ---------- Summary (mirror summarize L228-236) ----------

export interface S3Summary {
  win: boolean | null;
  fill_ticks: number[];
  blocked_ticks: number[];
  starve_ticks: number[];
  trip_fired_ticks: number[];
  heats: Record<string, [string, string | null]>;
}

export function summarize(state: SimState, records: TickRecord[], fx: S3Fixture): S3Summary {
  const fills = records.filter((r) => r.flags.full).map((r) => r.tick);
  const blocks = records.filter((r) => r.flags.blocked).map((r) => r.tick);
  const starves = records.filter((r) => r.flags.starved).map((r) => r.tick);
  const trips = records.filter((r) => r.events.some((e) => e.includes('TRIP fires'))).map((r) => r.tick);
  const heats: Record<string, [string, string | null]> = {};
  for (const h of state.heats) heats[h.material_id] = [h.status, h.failure_cause ?? null];
  return { win: state.win, fill_ticks: fills, blocked_ticks: blocks, starve_ticks: starves, trip_fired_ticks: trips, heats };
}

// ---------- Test seams the browser sim lacks ----------

// Per-tick prng_state walk (prng parity at trip ticks asserted in vitest).
export function prngSeries(fx: S3Fixture): Array<{ tick: number; prng_state: number }> {
  let state = freshState(fx);
  const series: Array<{ tick: number; prng_state: number }> = [];
  for (let i = 0; i < fx.scenario.ticks; i++) {
    state = tick(state, fx);
    series.push({ tick: state.tick, prng_state: state.prng_state });
  }
  return series;
}
