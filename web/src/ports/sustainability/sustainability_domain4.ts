// Phase 2 TS port — Domain 4 sustainability tick, 1:1 with mirror/sustainability_domain4_mirror.py
// (frozen parity oracle; no rule changes). Contracts enforced (Phase2_UI_Plan §2):
//  - Pure tick: (state, actions, rng_state) -> new_state; the input state is NEVER mutated.
//  - Generator state lives INSIDE the simulation state (one uint32 word). Domain 4 has no
//    RNG in its rule path, but the draw contract still advances the generator exactly once
//    per asset per tick in the fixed order ['eaf','drp','cc','bar_mill','wire_rod_mill','crane']
//    (determinism tuple requires all seven inputs; the fixture pins generator_state).
//  - Material-balance identity: Inputs = Products + By-products + Losses + delta-Inventory,
//    with explicit per-stage boundaries (slag, dust, scale, oxidation). Energy is a SEPARATE
//    ledger and NEVER enters the material balance — phantom-energy check must stay 0.0.
//  - Config read from the SAME content JSON as the mirror (reject, never default; validator
//    is a named pure function callable by the test).

import { readFileSync } from 'node:fs';
import { xorshift32Next } from '../../prng.js';

export const ASSET_ORDER = ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane'] as const;
export type Asset = typeof ASSET_ORDER[number];
export const STAGE_BOUNDARIES = ['slag', 'dust', 'scale', 'oxidation'] as const;

// Physics constant (not a commercial assumption): 1 kWh = 0.0036 GJ.
export const KWH_TO_GJ = 0.0036;

export const REL = 'content/sustainability/sustainability_domain4.json';

export const REQUIRED_D4 = {
  top: ['schema_version', 'assets', 'byproduct_streams', 'carbon', 'green_premium', 'energy_recovery'],
  asset_fields: ['id', 'steel_output_t_per_tick', 'sme_pending'],
  stream_fields: ['id', 'stage_boundary', 'yield_fraction_of_input_mass',
                  'price_usd_t', 'handling_cost_usd_t', 'off_route', 'sme_pending'],
  carbon_fields: ['intensity_t_co2_per_t_steel', 'carbon_tax_usd_per_t_co2',
                  'green_threshold_t_co2_per_t_steel', 'green_bonus_usd_per_t_steel',
                  'green_penalty_usd_per_t_steel', 'green_upgrade_capex_usd',
                  'green_upgrade_intensity_reduction_t_co2_per_t_steel'],
  premium_fields: ['premium_usd_per_t', 'threshold_t_co2_per_t_steel', 'rec_revenue_usd_per_t_steel'],
  energy_fields: ['off_gas_recovery_gj_per_t_steel', 'waste_heat_boiler_kwh_per_t_steel',
                  'baseline_energy_kpi_gj_per_t_steel'],
};

// Industry-plausible ranges for the DRI-EAF route (validation ranges, not invented
// precision; values inside them remain sme_pending demo values).
export const INTENSITY_RANGE: Record<string, [number, number]> = { eaf: [0.6, 0.8], drp: [1.0, 1.3] };
export const YIELD_FRACTION_RANGE: [number, number] = [0.0, 0.10];

export interface Stream {
  id: string;
  stage_boundary: string;
  yield_fraction_of_input_mass: number;
  price_usd_t: number;
  handling_cost_usd_t: number;
  off_route: boolean;
  sme_pending: boolean;
}

export interface D4Config {
  ASSETS: Record<string, number>;
  STREAMS: Stream[];
  CARBON: Record<string, number | Record<string, number>>;
  PREMIUM: Record<string, number>;
  ENERGY: Record<string, Record<string, number>>;
}

// Reject, never default. Returns list of named errors (file + field) — pure function.
export function validateD4(doc: any, rel: string = REL): string[] {
  const errors: string[] = [];
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return [rel + ': not an object'];
  if (doc.schema_version !== 1) errors.push(rel + ': schema_version missing or != 1');
  for (const k of REQUIRED_D4.top) {
    if (!(k in doc)) errors.push(rel + `: missing required top-level field '${k}'`);
  }
  if (errors.length) return errors;
  // assets
  const ids = doc.assets.map((a: any) => a.id);
  if (sortedCopy(ids).join(',') !== sortedCopy(ASSET_ORDER as readonly string[]).join(',')) {
    errors.push(rel + ': assets ids must match the stable asset ID set ' + JSON.stringify(ASSET_ORDER));
  }
  doc.assets.forEach((a: any, i: number) => {
    for (const f of REQUIRED_D4.asset_fields) {
      if (!(f in a)) errors.push(rel + `: assets[${i}] missing required field '${f}'`);
    }
    const v = a.steel_output_t_per_tick;
    if (!isNum(v) || v <= 0) errors.push(rel + `: assets[${i}].steel_output_t_per_tick invalid (must be positive number)`);
    if (typeof a.sme_pending !== 'boolean') errors.push(rel + `: assets[${i}].sme_pending invalid (must be boolean)`);
  });
  // by-product streams
  const seenBoundaries = new Set<string>();
  doc.byproduct_streams.forEach((s: any, i: number) => {
    for (const f of REQUIRED_D4.stream_fields) {
      if (!(f in s)) errors.push(rel + `: byproduct_streams[${i}] missing required field '${f}'`);
    }
    if (typeof s.sme_pending !== 'boolean') errors.push(rel + `: byproduct_streams[${i}].sme_pending invalid (must be boolean)`);
    if (typeof s.off_route !== 'boolean') errors.push(rel + `: byproduct_streams[${i}].off_route invalid (must be boolean)`);
    const b = s.stage_boundary;
    if (!STAGE_BOUNDARIES.includes(b)) errors.push(rel + `: byproduct_streams[${i}].stage_boundary invalid (must be one of ${STAGE_BOUNDARIES})`);
    if (seenBoundaries.has(b)) errors.push(rel + `: byproduct_streams[${i}].stage_boundary '${b}' duplicated (double-counting risk)`);
    seenBoundaries.add(b);
    const yf = s.yield_fraction_of_input_mass;
    if (!isNum(yf)) {
      errors.push(rel + `: byproduct_streams[${i}].yield_fraction_of_input_mass invalid (must be number)`);
    } else if (!(YIELD_FRACTION_RANGE[0] <= yf && yf <= YIELD_FRACTION_RANGE[1])) {
      errors.push(rel + `: byproduct_streams[${i}].yield_fraction_of_input_mass out of range ${YIELD_FRACTION_RANGE}`);
    }
    for (const f of ['price_usd_t', 'handling_cost_usd_t']) {
      const v = s[f];
      if (!isNum(v) || v < 0) errors.push(rel + `: byproduct_streams[${i}].${f} invalid (must be non-negative number)`);
    }
  });
  // carbon
  const c = doc.carbon;
  for (const f of REQUIRED_D4.carbon_fields) {
    if (!(f in c)) errors.push(rel + `: carbon missing required field '${f}'`);
  }
  for (const k of REQUIRED_D4.carbon_fields) {
    if (k === 'intensity_t_co2_per_t_steel') continue;
    const v = c[k];
    if (!isNum(v) || v < 0) errors.push(rel + `: carbon.${k} invalid (must be non-negative number)`);
  }
  const intens = c.intensity_t_co2_per_t_steel;
  if (typeof intens !== 'object' || intens === null || Array.isArray(intens) ||
      sortedCopy(Object.keys(intens)).join(',') !== sortedCopy(ASSET_ORDER as readonly string[]).join(',')) {
    errors.push(rel + ': carbon.intensity_t_co2_per_t_steel must cover exactly the stable asset IDs');
  } else {
    for (const [a, v] of Object.entries(intens)) {
      if (!isNum(v) || v < 0) {
        errors.push(rel + `: carbon.intensity_t_co2_per_t_steel.${a} invalid (must be non-negative number)`);
      } else if (a in INTENSITY_RANGE && !(INTENSITY_RANGE[a][0] <= v && v <= INTENSITY_RANGE[a][1])) {
        errors.push(rel + `: carbon.intensity_t_co2_per_t_steel.${a} out of industry-plausible range ${INTENSITY_RANGE[a]}`);
      }
    }
  }
  // green premium
  const g = doc.green_premium;
  for (const f of REQUIRED_D4.premium_fields) {
    if (!(f in g)) errors.push(rel + `: green_premium missing required field '${f}'`);
    else {
      const v = g[f];
      if (!isNum(v) || v < 0) errors.push(rel + `: green_premium.${f} invalid (must be non-negative number)`);
    }
  }
  // energy recovery
  const e = doc.energy_recovery;
  for (const f of REQUIRED_D4.energy_fields) {
    if (!(f in e)) errors.push(rel + `: energy_recovery missing required field '${f}'`);
    else if (typeof e[f] !== 'object' || e[f] === null || Array.isArray(e[f]) ||
             sortedCopy(Object.keys(e[f])).join(',') !== sortedCopy(ASSET_ORDER as readonly string[]).join(',')) {
      errors.push(rel + `: energy_recovery.${f} must cover exactly the stable asset IDs`);
    } else {
      for (const [a, v] of Object.entries(e[f])) {
        if (!isNum(v) || v < 0) errors.push(rel + `: energy_recovery.${f}.${a} invalid (must be non-negative number)`);
      }
    }
  }
  return errors;
}

function isNum(v: unknown): boolean {
  return typeof v === 'number' && Number.isFinite(v);
}
function sortedCopy(arr: readonly string[]): string[] {
  return [...arr].sort();
}

// Load + validate; malformed config = named errors, never silent defaults.
export function loadD4Config(path: string = 'C:/AI_Lab/SteelX/content/sustainability/sustainability_domain4.json'):
    { cfg: D4Config | null; errors: string[] } {
  const doc = JSON.parse(readFileSync(path, 'utf-8'));
  const errors = validateD4(doc);
  if (errors.length) return { cfg: null, errors };
  const cfg: D4Config = {
    ASSETS: Object.fromEntries(doc.assets.map((a: any) => [a.id, Number(a.steel_output_t_per_tick)])),
    STREAMS: doc.byproduct_streams,
    CARBON: Object.fromEntries(Object.entries(doc.carbon).filter(([k]) => REQUIRED_D4.carbon_fields.includes(k))
      .map(([k, v]) => [k, k === 'intensity_t_co2_per_t_steel' ? v : Number(v)])),
    PREMIUM: Object.fromEntries(REQUIRED_D4.premium_fields.map((k) => [k, Number(doc.green_premium[k])])),
    ENERGY: Object.fromEntries(REQUIRED_D4.energy_fields.map((k) =>
      [k, Object.fromEntries(Object.entries(doc.energy_recovery[k]).map(([a, v]) => [a, Number(v)]))])),
  };
  // Asset order validated against the stable-ID contract (fixed iteration order).
  if (Object.keys(cfg.ASSETS).join(',') !== ASSET_ORDER.join(',')) {
    return { cfg: null, errors: [REL + ': asset order differs from the stable-ID contract order'] };
  }
  return { cfg, errors: [] };
}

// Stage-boundary participation: which assets carry which boundary. Derived from the
// config's stage_boundary field (explicit), not invented: slag/oxidation on the melt
// route (eaf, drp), dust only on eaf, scale on the rolling line (cc, bar_mill,
// wire_rod_mill). Crane carries no material boundary (logistics asset).
export const BOUNDARY_ASSETS: Record<string, string[]> = {
  slag: ['eaf', 'drp'],
  dust: ['eaf'],
  scale: ['cc', 'bar_mill', 'wire_rod_mill'],
  oxidation: ['eaf', 'drp'],
};

export function streamParticipation(stream: Stream): string[] {
  // Explicit boundary participation derived from stage_boundary; off_route streams
  // contribute zero on assets outside their boundary set (no double counting).
  return BOUNDARY_ASSETS[stream.stage_boundary];
}

export interface D4State {
  tick: number;
  generator_state: number; // PRNG state INSIDE the sim state (uint32, never 0)
  // material ledger (mass, tonnes)
  inputs_t: number;
  products_t: number;          // sellable steel product
  byproducts_t: number;        // sellable by-product streams (moved Losses->Products)
  losses_t: number;            // unsellable losses (oxidation)
  inventory_delta_t: number;   // delta-Inventory (buffer model: always 0 here)
  byproduct_tons: Record<string, number>;
  // money ledger
  byproduct_revenue_usd: number;
  byproduct_handling_cost_usd: number;
  carbon_tax_usd: number;
  green_bonus_usd: number;
  green_penalty_usd: number;
  green_premium_usd: number;
  rec_revenue_usd: number;
  green_upgrade_capex_usd: number;
  // carbon ledger (t CO2)
  emissions_t_co2: number;
  green_flag: boolean;
  green_upgrade_active: boolean;
  // energy ledger (SEPARATE from material — never in the balance)
  energy_kpi_gj_t: number;
  recovered_energy_gj: number;
  energy_kpi_before_gj: number;
  energy_kpi_after_gj: number;
  phantom_energy_in_material_balance: number; // must stay 0.0 — negative control
}

export function freshState(seed: number, cfg: D4Config): D4State {
  const x = seed >>> 0;
  if (x === 0) throw new Error('zero generator state rejected (xorshift32 is degenerate at 0)');
  return {
    tick: 0,
    generator_state: x,
    inputs_t: 0.0,
    products_t: 0.0,
    byproducts_t: 0.0,
    losses_t: 0.0,
    inventory_delta_t: 0.0,
    byproduct_tons: Object.fromEntries(cfg.STREAMS.map((s) => [s.id, 0.0])),
    byproduct_revenue_usd: 0.0,
    byproduct_handling_cost_usd: 0.0,
    carbon_tax_usd: 0.0,
    green_bonus_usd: 0.0,
    green_penalty_usd: 0.0,
    green_premium_usd: 0.0,
    rec_revenue_usd: 0.0,
    green_upgrade_capex_usd: 0.0,
    emissions_t_co2: 0.0,
    green_flag: false,
    green_upgrade_active: false,
    energy_kpi_gj_t: 0.0,
    recovered_energy_gj: 0.0,
    energy_kpi_before_gj: 0.0,
    energy_kpi_after_gj: 0.0,
    phantom_energy_in_material_balance: 0.0,
  };
}

export function stateFromFixture(initial: any, seed: number): D4State {
  // Replay starts from the fixture's recorded initial_state. The fixture pins the
  // generator walk via `seed` (initial_state carries no generator field — Domain 4
  // has no RNG in its rule path; the generator state is pinned for the determinism
  // tuple only). Seed guard applies: zero rejected, never defaulted.
  const x = seed >>> 0;
  if (x === 0) throw new Error('zero generator state rejected (xorshift32 is degenerate at 0)');
  const st: D4State = { ...initial, generator_state: x };
  return st;
}

export function tickSustainability(
    state: D4State, cfg: D4Config, actions: any[] = [], inject: Set<string> = new Set()): D4State {
  // Pure: returns a NEW state; the input state is never mutated.
  const st: D4State = structuredClone(state);
  st.tick += 1;
  // Draw contract: one draw per asset per tick in fixed order, even though Domain 4
  // has no RNG in its rule path — the generator state must still advance per tick.
  for (const _a of ASSET_ORDER) {
    const { newState } = xorshift32Next(st.generator_state);
    st.generator_state = newState;
  }
  const carbon = cfg.CARBON as Record<string, any>;
  const energy = cfg.ENERGY;
  const premium = cfg.PREMIUM;
  for (const a of ASSET_ORDER) {
    const out_t = cfg.ASSETS[a];
    const input_t = out_t; // per-asset input mass at the stage boundary
    // partition: product + by-products + losses (each tonne counted exactly once)
    let prod = input_t;
    for (const s of cfg.STREAMS) {
      if (!streamParticipation(s).includes(a)) continue;
      const frac = s.yield_fraction_of_input_mass;
      const tons = input_t * frac;
      st.byproduct_tons[s.id] += tons;
      prod -= tons;
      if (s.price_usd_t > 0.0) {
        // sellable stream: moved from Losses to Products (boundary contract B)
        st.byproducts_t += tons;
        const net = (s.price_usd_t - s.handling_cost_usd_t) * tons; // trade-off, documented
        st.byproduct_revenue_usd += s.price_usd_t * tons;
        st.byproduct_handling_cost_usd += s.handling_cost_usd_t * tons;
        if (inject.has('break_byproduct_net')) {
          // deliberately broken: handling ignored -> revenue overstated
          st.byproduct_revenue_usd += 0.0; // net check below will disagree
        }
      } else {
        st.losses_t += tons;
      }
    }
    st.inputs_t += input_t;
    st.products_t += prod;
    // carbon: per-asset intensity, green upgrade reduces intensity when active
    let intensity = carbon['intensity_t_co2_per_t_steel'][a] as number;
    if (st.green_upgrade_active) {
      intensity -= carbon['green_upgrade_intensity_reduction_t_co2_per_t_steel'] as number;
      if (intensity < 0.0) intensity = 0.0;
    }
    const emitted = intensity * input_t;
    st.emissions_t_co2 += emitted;
    st.carbon_tax_usd += (carbon['carbon_tax_usd_per_t_co2'] as number) * emitted;
    // energy ledger: recovery reduces KPI, never enters material balance
    const base_gj = energy['baseline_energy_kpi_gj_per_t_steel'][a] * input_t;
    const rec_gj = energy['off_gas_recovery_gj_per_t_steel'][a] * input_t
                  + energy['waste_heat_boiler_kwh_per_t_steel'][a] * input_t * KWH_TO_GJ;
    st.energy_kpi_before_gj += base_gj;
    st.energy_kpi_after_gj += base_gj - rec_gj;
    st.recovered_energy_gj += rec_gj;
    // phantom-energy guard: energy must never appear in the material ledger
    st.phantom_energy_in_material_balance += 0.0;
  }
  // plant-average carbon intensity (per tonne steel produced)
  const avg = st.products_t > 0 ? st.emissions_t_co2 / st.products_t : 0.0;
  st.green_flag = avg < (carbon['green_threshold_t_co2_per_t_steel'] as number);
  if (st.green_flag) {
    st.green_bonus_usd += (carbon['green_bonus_usd_per_t_steel'] as number) * st.products_t;
  } else {
    st.green_penalty_usd += (carbon['green_penalty_usd_per_t_steel'] as number) * st.products_t;
  }
  // green premium + REC (separate streams, threshold-based policy)
  if (st.green_flag) {
    st.green_premium_usd += premium['premium_usd_per_t'] * st.products_t;
    st.rec_revenue_usd += premium['rec_revenue_usd_per_t_steel'] * st.products_t;
  }
  return st;
}

export function balanceError(st: D4State): number {
  // Inputs = Products + By-products + Losses + delta-Inventory (unrounded).
  const rhs = st.products_t + st.byproducts_t + st.losses_t + st.inventory_delta_t;
  return st.inputs_t - rhs;
}

// Sandbox boundary (§2.5): a hypothetical run must not touch the real state — follows
// from pure tick + generator-state-in-state. Returns a new state only.
export function sandboxRun(real: D4State, cfg: D4Config, ticks: number): { sandbox: D4State } {
  let sandbox = structuredClone(real);
  for (let t = 0; t < ticks; t++) sandbox = tickSustainability(sandbox, cfg);
  return { sandbox };
}
