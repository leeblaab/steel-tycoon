// Phase 2 TS port — Domain 1 production core, 1:1 with mirror/production_core_mirror.py
// (frozen parity oracle; no rule changes). Contracts honored (Phase2_UI_Plan §2):
//  - Pure tick: (state, actions, rng_state) -> new_state; the input state is NEVER mutated.
//  - Generator state lives INSIDE the simulation state (one uint32 word); shared PRNG
//    imported from '../../prng.js' (canonical xorshift32, not reimplemented here).
//  - Config read from the SAME content JSON as the mirror, validated at load
//    (reject, never default) — same contract as the ops port / ContentLoader.
//  - Domain 1 has no RNG in its rule path; the generator state advances once per tick
//    (one draw per tick, fixed asset order) so the determinism tuple stays pinned.
//    The draw is consumed but unused — no rule reads it.

import { readFileSync } from 'node:fs';
import { prngInit, xorshift32Next } from '../../prng.js';

export const ASSET_ORDER = ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane'] as const;

export type Grade = 'bushing' | 'hms1_hms2' | 'shredded';
export type Size = 'plate' | 'hms' | 'light';
export type ChargeCell = [Grade, Size, number];

export interface ProductionCoreState {
  tick: number;
  purchased_t: Record<string, number>;
  yard_stock_t: number;
  handling_loss_t: number;
  yield_loss_t: number;
  melted_t: number;
  ttt_hours_accum: number;
  ttt_runs: number;
  spend_usd: number;
  condition: number;
  crew_factor: number;
  generator_state: number; // uint32, never 0 — generator state INSIDE the sim state
}

export interface Action {
  tick: number;
  charge_cells: ChargeCell[];
  condition?: number;   // mirror signature: explicit condition override
  crew_factor?: number; // mirror signature: crew factor for this tick
  overhaul?: boolean;   // mirror signature: forced overhaul resets condition to 100
}

// ---- Config: same JSON files as the mirror, validated reject-never-default ----
export interface ProductionCoreConfig {
  scrap_tiers: Record<string, number>;        // USD/t purchase price per grade
  yield_loss_by_grade: Record<string, number>; // % metallurgical yield loss at EAF by grade
  ttt_quality_factor: Record<string, number>;  // TTT multiplier by grade
  size_handling_pct: Record<string, number>;   // handling loss % by size class
  condition_overhaul_at: number;
  ttt_degrade_max: number;
  degrade_rate_per_heat: number;
  eaf_ttt_base_min: number; // midpoint of the EAF tap_to_tap_min band
}

function reject(file: string, path: string, reason: string): never {
  throw new Error(`content/${file}: ${path} ${reason}`);
}
function isNum(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v); }

// Mirror's mid(): numeric value as-is; "lo-hi" band string resolved to its midpoint.
// Bands the data does not define are rejected, never defaulted.
function mid(v: unknown): number {
  if (isNum(v)) return v as number;
  if (typeof v === 'string') {
    const parts = v.split('-');
    if (parts.length === 2 && parts.every((p) => isNum(parseFloat(p))))
      return (parseFloat(parts[0]) + parseFloat(parts[1])) / 2.0;
  }
  throw new Error('band value invalid — reject, never default');
}

export function loadScrapConfig(doc: any): ProductionCoreConfig {
  if (doc.schema_version !== 1) reject('scrap/scrap_tiers.json', 'schema_version', 'missing or != 1');
  for (const f of ['grades', 'sizes', 'furnace_condition'])
    if (!(f in doc)) reject('scrap/scrap_tiers.json', '', `missing required top-level field '${f}'`);
  const cfg: ProductionCoreConfig = {
    scrap_tiers: {}, yield_loss_by_grade: {}, ttt_quality_factor: {}, size_handling_pct: {},
    condition_overhaul_at: 0, ttt_degrade_max: 0, degrade_rate_per_heat: 0, eaf_ttt_base_min: 0,
  };
  for (const g of doc.grades) {
    for (const f of ['id', 'price_usd_t', 'yield_loss_pct', 'ttt_quality_factor'])
      if (!(f in g)) reject('scrap/scrap_tiers.json', `grades[${g.id ?? '?'}]`, `missing required field '${f}'`);
    if (!isNum(g.price_usd_t) || g.price_usd_t <= 0) reject('scrap/scrap_tiers.json', `grades[${g.id}].price_usd_t`, 'invalid (must be positive number)');
    if (!isNum(g.yield_loss_pct) || g.yield_loss_pct < 0 || g.yield_loss_pct > 100) reject('scrap/scrap_tiers.json', `grades[${g.id}].yield_loss_pct`, 'invalid (must be in [0,100])');
    if (!isNum(g.ttt_quality_factor) || g.ttt_quality_factor <= 0) reject('scrap/scrap_tiers.json', `grades[${g.id}].ttt_quality_factor`, 'invalid (must be positive number)');
    cfg.scrap_tiers[g.id] = g.price_usd_t;
    cfg.yield_loss_by_grade[g.id] = g.yield_loss_pct;
    cfg.ttt_quality_factor[g.id] = g.ttt_quality_factor;
  }
  for (const s of doc.sizes) {
    for (const f of ['id', 'handling_loss_pct'])
      if (!(f in s)) reject('scrap/scrap_tiers.json', `sizes[${s.id ?? '?'}]`, `missing required field '${f}'`);
    if (!isNum(s.handling_loss_pct) || s.handling_loss_pct < 0 || s.handling_loss_pct > 100) reject('scrap/scrap_tiers.json', `sizes[${s.id}].handling_loss_pct`, 'invalid (must be in [0,100])');
    cfg.size_handling_pct[s.id] = s.handling_loss_pct;
  }
  const fc = doc.furnace_condition;
  for (const f of ['condition_overhaul_at', 'ttt_degrade_max', 'degrade_rate_per_heat']) {
    if (!(f in fc)) reject('scrap/scrap_tiers.json', `furnace_condition.${f}`, 'missing required field');
    if (!isNum(fc[f]) || fc[f] <= 0) reject('scrap/scrap_tiers.json', `furnace_condition.${f}`, 'invalid (must be positive number)');
  }
  if (fc.condition_overhaul_at >= 100) reject('scrap/scrap_tiers.json', 'furnace_condition.condition_overhaul_at', 'invalid (must be < 100 — degradation span would be non-positive)');
  cfg.condition_overhaul_at = fc.condition_overhaul_at;
  cfg.ttt_degrade_max = fc.ttt_degrade_max;
  cfg.degrade_rate_per_heat = fc.degrade_rate_per_heat;
  return cfg;
}

export function loadNodesConfig(doc: any): { eaf_ttt_base_min: number } {
  if (doc.schema_version !== 1) reject('nodes/nodes_phase1.json', 'schema_version', 'missing or != 1');
  if (!Array.isArray(doc.phase1_nodes) || doc.phase1_nodes.length === 0) reject('nodes/nodes_phase1.json', 'phase1_nodes', 'missing or empty');
  const eaf = doc.phase1_nodes.find((n: any) => n.id === 'eaf');
  if (!eaf) reject('nodes/nodes_phase1.json', 'phase1_nodes', 'no node with id "eaf"');
  if (!('tap_to_tap_min' in eaf)) reject('nodes/nodes_phase1.json', 'eaf', 'missing required field tap_to_tap_min');
  return { eaf_ttt_base_min: mid(eaf.tap_to_tap_min) };
}

export function freshState(seed: number, cfg: ProductionCoreConfig): ProductionCoreState {
  const prng = prngInit(seed);
  const st: ProductionCoreState = {
    tick: 0,
    purchased_t: {},
    yard_stock_t: 0.0,
    handling_loss_t: 0.0,
    yield_loss_t: 0.0,
    melted_t: 0.0,
    ttt_hours_accum: 0.0,
    ttt_runs: 0,
    spend_usd: 0.0,
    condition: 100.0,
    crew_factor: 1.0,
    generator_state: prng.state,
  };
  for (const g of Object.keys(cfg.scrap_tiers)) st.purchased_t[g] = 0.0;
  return st;
}

// Mirror's condition_factor(): linear degradation, factor 1.0 at condition 100,
// ttt_degrade_max at condition_overhaul_at.
export function conditionFactor(st: ProductionCoreState, cfg: ProductionCoreConfig): number {
  const span = 100.0 - cfg.condition_overhaul_at;
  return 1.0 + ((100.0 - st.condition) / span) * (cfg.ttt_degrade_max - 1.0);
}

// Mirror's tap_to_tap_min(): tonnage-weighted grade quality factor x condition factor
// x crew factor, on the EAF base band midpoint.
export function tapToTapMin(st: ProductionCoreState, cfg: ProductionCoreConfig, chargeCells: ChargeCell[]): number {
  const total = chargeCells.reduce((s, c) => s + c[2], 0);
  if (total <= 0) throw new Error('tap_to_tap_min called with empty charge — reject, never default');
  const q = chargeCells.reduce((s, c) => s + c[2] * cfg.ttt_quality_factor[c[0]], 0) / total;
  return cfg.eaf_ttt_base_min * q * conditionFactor(st, cfg) * st.crew_factor;
}

// PURE TICK — returns a NEW state; the input state is never mutated.
// Stage order reproduced 1:1 from the mirror: tick++ -> condition evolution (overhaul
// reset / explicit override / per-heat degradation with forced overhaul at threshold)
// -> crew factor -> purchase (spend + material enters yard, balance input) -> charge
// from yard (residence-time rule: material arrived previous tick) -> handling loss by
// SIZE class -> yield loss by GRADE -> melt -> tap-to-tap. Generator state advances
// once per tick (draw consumed, unused — no rule reads it).
export function tickProductionCore(
  input: ProductionCoreState,
  cfg: ProductionCoreConfig,
  action: Action,
): ProductionCoreState {
  const st: ProductionCoreState = structuredClone(input);

  st.tick += 1;

  // Condition evolves per heat (degradation), reset on overhaul — mirror order.
  if (action.overhaul) {
    st.condition = 100.0;
  } else if (action.condition !== undefined) {
    st.condition = action.condition;
  } else {
    st.condition -= cfg.degrade_rate_per_heat;
    if (st.condition <= cfg.condition_overhaul_at) st.condition = 100.0; // forced overhaul at threshold
  }
  st.crew_factor = action.crew_factor ?? 1.0;

  // Purchase -> spend, material enters yard (balance input).
  for (const [g, , t] of action.charge_cells) {
    if (!(g in cfg.scrap_tiers)) reject('scrap/scrap_tiers.json', `grades[${g}]`, 'unknown grade in action — reject, never default');
    st.purchased_t[g] += t;
    st.yard_stock_t += t;
    st.spend_usd += t * cfg.scrap_tiers[g];
  }

  // Charge from yard (residence-time rule: material arrived previous tick).
  const charge = st.yard_stock_t;
  st.yard_stock_t = 0.0;

  // Handling loss by SIZE class (physical), applied per cell.
  let hl = 0.0;
  for (const [, s, t] of action.charge_cells) {
    if (!(s in cfg.size_handling_pct)) reject('scrap/scrap_tiers.json', `sizes[${s}]`, 'unknown size in action — reject, never default');
    hl += (t * cfg.size_handling_pct[s]) / 100.0;
  }
  st.handling_loss_t += hl;

  // Metallurgical yield by GRADE, applied to the grade portion of the charge.
  let yl = 0.0;
  for (const [g, , t] of action.charge_cells) {
    yl += (t * cfg.yield_loss_by_grade[g]) / 100.0;
  }
  st.yield_loss_t += yl;

  const melt = charge - hl - yl;
  st.melted_t += melt;

  // Tap-to-tap.
  const ttt = tapToTapMin(st, cfg, action.charge_cells);
  st.ttt_hours_accum += ttt / 60.0;
  st.ttt_runs += 1;

  // Draw contract: 6 draws per tick in fixed asset order (canonical contract — the
  // generator advances per the contract even though Domain 1 has no rule that
  // consumes the draws; the fixture pins generator_state for the determinism tuple).
  // Draws are consumed in order; none is read by a rule.
  for (const _ of ASSET_ORDER) {
    const r = xorshift32Next(st.generator_state);
    st.generator_state = r.newState;
  }

  return st;
}

// Mirror's balance_error(): input (purchased) = melted + losses + yard stock.
export function balanceError(st: ProductionCoreState): number {
  const accounted = st.melted_t + st.handling_loss_t + st.yield_loss_t + st.yard_stock_t;
  const totalIn = Object.values(st.purchased_t).reduce((s, v) => s + v, 0);
  return Math.abs(totalIn - accounted);
}

export function loadConfigFromFile(scrapPath: string, nodesPath: string): ProductionCoreConfig {
  const cfg = loadScrapConfig(JSON.parse(readFileSync(scrapPath, 'utf-8')));
  cfg.eaf_ttt_base_min = loadNodesConfig(JSON.parse(readFileSync(nodesPath, 'utf-8'))).eaf_ttt_base_min;
  return cfg;
}
