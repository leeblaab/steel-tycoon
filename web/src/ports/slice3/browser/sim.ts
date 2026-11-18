// Browser-safe deterministic replay seam for the Slice 3 app.
// Mirror-first workflow: this file is a line-by-line TypeScript port of
// mirror/slice3_mirror.py (single source of truth). No rule rewrite, no re-tuning:
// every mechanic below mirrors the Python tick() exactly, including epsilon
// conventions (1e-9), event-string wording (the mirror derives flags from its own
// event strings: 'refused' -> blocked, 'SKIPPED' -> starved, 'TRIP fires' -> trip),
// and the xorshift32 draw contract. Fixtures are embedded as content (build-time
// embed; same JSON content as fixtures/slice3/*.json — single source of truth stays
// in the fixture files).
//
// Deterministic replay pattern (same as slice1 sim.ts): run() precomputes the full
// 120-tick run per scenario; the 3D layer only animates recorded TickRecords.

import { xorshift32Next } from '../../../prng.js';

// ---------- Fixtures (browser-safe embed of fixtures/slice3/*.json) ----------

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

// Exact content of fixtures/slice3/s3_dri_buffer_scenario_seed11_120.json
// (scenario + expected_outputs blocks only).
export const S3_STARVE_FIXTURE: S3Fixture = {
  fixture_id: 's3_dri_buffer_scenario_seed11_120',
  scenario: {
    seed: 11,
    ticks: 120,
    drp: { discharge_t_per_tick: 2.0, trip_probability: 0.3, trip_ticks: [20, 45, 70], trip_duration_ticks: 6 },
    buffer: { capacity_t: 30.0, fill_state_threshold_t: 25.0, starve_threshold_t: 10.0 },
    eaf: { charge_t: 20.0, heat_plan: [20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120] },
  },
  expected_outputs: {
    win: false,
    fill_state_ticks: [13, 14, 15, 16, 17, 18, 19, 34, 35, 36, 37, 38, 39, 55, 56, 57, 58, 59, 68, 69, 85, 86, 87, 88, 89, 98, 99, 108, 109, 118, 119],
    blocked_ticks: [16, 17, 18, 19, 37, 38, 39, 40, 58, 59, 60, 88, 89, 90],
    starve_ticks: [30, 50, 80],
    trip_fired_ticks: [20, 45, 70],
    heats: {
      H20: ['charged', null], H30: ['skipped', 'buffer_starved'], H40: ['charged', null],
      H50: ['skipped', 'buffer_starved'], H60: ['charged', null], H70: ['charged', null],
      H80: ['skipped', 'buffer_starved'], H90: ['charged', null], H100: ['charged', null],
      H110: ['charged', null], H120: ['charged', null],
    },
  },
};

// Exact content of fixtures/slice3/s3_fill_negative_seed11_120.json
// (scenario + expected_outputs blocks only). Same DRP params; heat_plan cadence 20.
export const S3_FILL_FIXTURE: S3Fixture = {
  fixture_id: 's3_fill_negative_seed11_120',
  scenario: {
    seed: 11,
    ticks: 120,
    drp: { discharge_t_per_tick: 2.0, trip_probability: 0.3, trip_ticks: [20, 45, 70], trip_duration_ticks: 6 },
    buffer: { capacity_t: 30.0, fill_state_threshold_t: 25.0, starve_threshold_t: 10.0 },
    eaf: { charge_t: 20.0, heat_plan: [20, 40, 60, 80, 100] },
  },
  expected_outputs: {
    win: true,
    fill_state_ticks: [13, 14, 15, 16, 17, 18, 19, 34, 35, 36, 37, 38, 39, 55, 56, 57, 58, 59, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 88, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120],
    blocked_ticks: [16, 17, 18, 19, 37, 38, 39, 40, 58, 59, 60, 78, 79, 80, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120],
    starve_ticks: [],
    trip_fired_ticks: [20, 45, 70],
    heats: {
      H20: ['charged', null], H40: ['charged', null], H60: ['charged', null],
      H80: ['charged', null], H100: ['charged', null],
    },
  },
};

// ---------- Validation (mirrors validate_scenario; fail loudly) ----------

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

interface SimState {
  tick: number;
  prng_state: number;
  buffer: DriLot[]; // FIFO lots
  buffer_t: number;
  drp_tripped_until: number; // tick until which discharge is halted (0 = running)
  heats: HeatRecord[];
  events: Array<{ tick: number; event: string }>;
  win: boolean | null;
}

function lot(material_id: string, usable_t: number, discharge_tick: number): DriLot {
  return {
    material_id,
    usable_t,
    quality_metadata: null,
    source: 'DRP discharge',
    readiness_timestamp: discharge_tick,
    destination: 'EAF feed interface',
  };
}

function freshState(fx: S3Fixture): SimState {
  return {
    tick: 0,
    prng_state: fx.scenario.seed >>> 0,
    buffer: [],
    buffer_t: 0.0,
    drp_tripped_until: 0,
    heats: [],
    events: [],
    win: null,
  };
}

// state -> new_state; deep-copies like the mirror's json round-trip (never mutates input).
function tick(state: SimState, fx: S3Fixture): SimState {
  const s: SimState = structuredClone(state);
  const sc = fx.scenario;
  s.tick += 1;
  const ev: string[] = [];

  // 1) DRP trip gate: draw consumed at every trip tick (draw contract),
  //    fires trip with probability p; trip halts discharge.
  if (sc.drp.trip_ticks.includes(s.tick)) {
    const { newState, draw } = xorshift32Next(s.prng_state);
    s.prng_state = newState;
    if (draw < sc.drp.trip_probability) {
      s.drp_tripped_until = s.tick + sc.drp.trip_duration_ticks;
      ev.push(`DRP TRIP fires at tick ${s.tick} (draw ${draw.toFixed(4)} < p ${sc.drp.trip_probability}), halted ${sc.drp.trip_duration_ticks} ticks`);
    }
  }

  // 2) DRP discharge (continuous supply) -> buffer, capacity-gated
  if (s.tick <= s.drp_tripped_until) {
    ev.push('DRP halted (trip)');
  } else {
    const rate = sc.drp.discharge_t_per_tick;
    const room = sc.buffer.capacity_t - s.buffer_t;
    if (rate > room + 1e-9) {
      ev.push(`buffer FULL: discharge refused ${rate}t (room ${Math.round(room * 100) / 100}t)`);
    } else {
      s.buffer.push(lot(`M${s.tick}`, rate, s.tick));
      s.buffer_t += rate;
      ev.push(`DRP discharge ${rate}t -> buffer (${Math.round(s.buffer_t * 100) / 100}t)`);
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
      s.heats.push({
        material_id: `H${s.tick}`,
        usable_t: need,
        quality_metadata: null,
        source: 'DRI buffer',
        readiness_timestamp: s.tick,
        destination: 'EAF feed interface',
        status: 'charged',
        lots_taken: taken,
      });
      ev.push(`EAF heat at tick ${s.tick}: ${need}t taken (lots ${taken.join(',')})`);
    } else {
      s.heats.push({
        material_id: `H${s.tick}`,
        usable_t: 0.0,
        quality_metadata: null,
        source: 'DRI buffer',
        readiness_timestamp: null,
        destination: 'EAF feed interface',
        status: 'skipped',
        failure_cause: null, // attributed at scenario end
        lots_taken: [],
      });
      ev.push(`EAF heat at tick ${s.tick} SKIPPED: buffer short (${Math.round(s.buffer_t * 100) / 100}t < ${need}t)`);
    }
  }

  // 4) State flags for this tick
  if (s.buffer_t >= sc.buffer.fill_state_threshold_t - 1e-9) {
    ev.push(`buffer state: FULL (>= ${sc.buffer.fill_state_threshold_t}t)`);
  }
  if (ev.some((e) => e.includes('SKIPPED'))) {
    ev.push(`buffer state: STARVED (< ${sc.buffer.starve_threshold_t}t)`);
  }

  for (const e of ev) s.events.push({ tick: s.tick, event: e });
  return s;
}

// ---------- Per-tick record consumed by the 3D layer ----------

export interface TickRecord {
  tick: number;
  buffer_t: number;
  buffer_lots: number; // FIFO lot count (visual cube count)
  drp_tripped: boolean;
  drp_discharged_this_tick_t: number;
  refused_this_tick_t: number;
  heat_status: 'charged' | 'skipped' | null;
  heat_taken_lots: string[];
  flags: { full: boolean; blocked: boolean; starved: boolean };
  events: string[];
}

export interface RunResult {
  fixture: S3Fixture;
  records: TickRecord[];
  heats: HeatRecord[];
  win: boolean;
  // balance identity pieces (for the closure print):
  discharged_t: number;
  refused_t: number;
  taken_t: number;
  buffer_end_t: number;
}

function run(fx: S3Fixture): RunResult {
  let state = freshState(fx);
  const records: TickRecord[] = [];
  for (let i = 0; i < fx.scenario.ticks; i++) {
    state = tick(state, fx);
    const ev = state.events.filter((e) => e.tick === state.tick).map((e) => e.event);
    records.push({
      tick: state.tick,
      buffer_t: Math.round(state.buffer_t * 10000) / 10000,
      buffer_lots: state.buffer.length,
      drp_tripped: state.tick <= state.drp_tripped_until,
      drp_discharged_this_tick_t: ev.some((e) => e.includes('DRP discharge')) ? fx.scenario.drp.discharge_t_per_tick : 0,
      refused_this_tick_t: ev.some((e) => e.includes('refused')) ? fx.scenario.drp.discharge_t_per_tick : 0,
      heat_status: null,
      heat_taken_lots: [],
      flags: {
        full: state.buffer_t >= fx.scenario.buffer.fill_state_threshold_t - 1e-9,
        blocked: ev.some((e) => e.includes('refused')),
        starved: ev.some((e) => e.includes('SKIPPED')),
      },
      events: ev,
    });
    for (const h of state.heats) {
      if (h.readiness_timestamp === state.tick) {
        records[records.length - 1].heat_status = h.status;
        records[records.length - 1].heat_taken_lots = h.lots_taken;
      }
    }
  }

  // failure cause attribution for skipped heats (mirror logic, verbatim):
  const lastHeat = Math.max(...fx.scenario.eaf.heat_plan);
  const maxPossible = fx.scenario.drp.discharge_t_per_tick * lastHeat;
  for (const h of state.heats) {
    if (h.status === 'skipped') {
      h.failure_cause = maxPossible < fx.scenario.eaf.charge_t * fx.scenario.eaf.heat_plan.length - 1e-9
        ? 'plan_overdraw'
        : 'buffer_starved';
    }
  }
  const win = state.heats.every((h) => h.status === 'charged');

  const discharged_t = records.reduce((acc, r) => acc + r.drp_discharged_this_tick_t, 0);
  const refused_t = records.reduce((acc, r) => acc + r.refused_this_tick_t, 0);
  const taken_t = state.heats.reduce((acc, h) => acc + (h.status === 'charged' ? h.usable_t : 0), 0);

  return { fixture: fx, records, heats: state.heats, win, discharged_t, refused_t, taken_t, buffer_end_t: state.buffer_t };
}

export function runSlice3(fixture: S3Fixture): RunResult {
  validateScenario(fixture);
  return run(fixture);
}

// ---------- Summary + programmatic fixture comparison (printed in the log) ----------

export interface S3Summary {
  win: boolean;
  fill_ticks: number[];
  blocked_ticks: number[];
  starve_ticks: number[];
  trip_fired_ticks: number[];
  heats: Record<string, [string, string | null]>;
}

export function summarize(res: RunResult): S3Summary {
  const fills = res.records.filter((r) => r.flags.full).map((r) => r.tick);
  const blocks = res.records.filter((r) => r.flags.blocked).map((r) => r.tick);
  const starves = res.records.filter((r) => r.flags.starved).map((r) => r.tick);
  const trips = res.records.filter((r) => r.events.some((e) => e.includes('TRIP fires'))).map((r) => r.tick);
  const heats: Record<string, [string, string | null]> = {};
  for (const h of res.heats) heats[h.material_id] = [h.status, h.failure_cause ?? null];
  return { win: res.win, fill_ticks: fills, blocked_ticks: blocks, starve_ticks: starves, trip_fired_ticks: trips, heats };
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface FieldCheck {
  field: string;
  match: boolean;
  sim_len?: number;
}

export function compareFixture(res: RunResult): FieldCheck[] {
  const s = summarize(res);
  const exp = res.fixture.expected_outputs;
  return [
    { field: 'win', match: s.win === exp.win },
    { field: 'fill_state_ticks', match: eq(s.fill_ticks, exp.fill_state_ticks), sim_len: s.fill_ticks.length },
    { field: 'blocked_ticks', match: eq(s.blocked_ticks, exp.blocked_ticks), sim_len: s.blocked_ticks.length },
    { field: 'starve_ticks', match: eq(s.starve_ticks, exp.starve_ticks), sim_len: s.starve_ticks.length },
    { field: 'trip_fired_ticks', match: eq(s.trip_fired_ticks, exp.trip_fired_ticks), sim_len: s.trip_fired_ticks.length },
    { field: 'heats', match: eq(s.heats, exp.heats) },
  ];
}

// Balance/material identity: buffer_end = discharged - taken (residual must be ~0).
export function balanceResidual(res: RunResult): number {
  return res.buffer_end_t - (res.discharged_t - res.taken_t);
}
