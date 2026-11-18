// Phase 2 TS port — Domain 2 economics, 1:1 with mirror/economics_domain2_mirror.py
// (frozen parity oracle; no rule changes). Contracts enforced (Phase2_UI_Plan §2):
//  - Pure tick: (state, actions, rng_state) -> new_state; the input state is NEVER mutated.
//  - Generator state lives INSIDE the simulation state (one uint32 word), via the shared
//    PRNG module (canonical xorshift32 — not reimplemented here).
//  - DRAW CONTRACT for the sales-index step: step_index consumes exactly 2 draws per call —
//    first draw for uniform(a,b) = a + (b-a)*draw, second draw for random() compared against
//    mean_reversion_prob. Reproduced exactly (fixture notes, 2026-10-12).
//  - Config read from the SAME content JSON as the mirror (reject, never default).
//  - Grade assignment NOT re-implemented: mirrors grade_pricing_mirror.assign_grade
//    (highest price-band midpoint the chemistry passes, inclusive at-limit), reading
//    content/prices/price_ladder_draft.json.
//  - Tick order reproduced exactly: sales_index_step -> dispatch (1 tick = 1 day).

import { readFileSync } from 'node:fs';
import { prngInit, xorshift32Next } from '../../prng.js';

export interface EconOrder {
  id: number;
  grade: string;
  tonnage: number;
  due_day: number;
  signed_day: number;
  mode: 'spot' | 'forward';
  sign_index: number;
  status: 'open' | 'fulfilled';
  signed_value: number;
}

export interface EconState {
  day: number;
  sales_index: number;
  orders: EconOrder[];
  fulfilled_t: number;
  revenue_usd: number;
  late_penalty_usd: number;
  unsold_t: number;
  downgrades: Record<string, number>;
  dispatched_t: number;
  utilities_usd: number;
  production_t: Record<string, number>;
  generator_state: number; // PRNG state INSIDE the sim state (uint32, never 0)
}

export type EconAction =
  | { tick: number; type: 'add_order'; grade: string; tonnage: number; due_day: number; mode: 'spot' | 'forward' }
  | { tick: number; type: 'step_index'; draws: number }
  | { tick: number; type: 'dispatch'; grade: string; tonnes: number; cu: number; sn: number; asset?: string };

export interface EconConfig {
  sales_index: { band: [number, number]; step: number; mean_reversion_prob: number };
  demand_gate: { min_index_to_sell: number };
  order_book: { late_penalty_pct_per_day: number; late_penalty_cap_pct: number };
  qc_tiers: { haircut_pct: Record<string, number> };
  utilities: Record<string, Record<string, number>>;
  specific_energy: Record<string, Record<string, number>>;
}

export interface PriceLadder {
  grades: { id: string; price_mid: number; cu_max: number; sn_max: number }[];
  fallback: { id: string; price_mid: number };
}

const CFG_REL = 'economy/economics_domain2.json';
const UTIL_FIELDS = ['water_usd_t', 'compressed_air_usd_t', 'electricity_usd_t', 'ng_usd_t'];
const SE_FIELDS = ['kwh_t', 'nm3_ng_t'];

function reject(path: string, reason: string): never {
  throw new Error(`${CFG_REL}: ${path} ${reason}`);
}
function isNum(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v); }

// ---- config load — reject, never default (1:1 with mirror validate_cfg) ----
export function validateEconConfig(doc: any): string[] {
  const errors: string[] = [];
  if (typeof doc !== 'object' || doc === null) return [`${CFG_REL}: not an object`];
  if (doc.schema_version !== 1) errors.push(`${CFG_REL}: schema_version missing or != 1`);
  const REQUIRED_TOP = ['sales_index', 'demand_gate', 'order_book', 'qc_tiers', 'utilities', 'specific_energy'];
  for (const k of REQUIRED_TOP) if (!(k in doc)) errors.push(`${CFG_REL}: missing required top-level field '${k}'`);
  const REQUIRED_FIELDS: Record<string, string[]> = {
    sales_index: ['band', 'step', 'mean_reversion_prob', 'unit', 'sme_pending'],
    demand_gate: ['min_index_to_sell', 'unit', 'sme_pending'],
    order_book: ['late_penalty_pct_per_day', 'late_penalty_cap_pct', 'unit', 'sme_pending'],
    qc_tiers: ['tiers', 'unit', 'sme_pending'],
    utilities: ['unit', 'assets', 'sme_pending'],
    specific_energy: ['unit', 'assets', 'sme_pending'],
  };
  for (const [block, fields] of Object.entries(REQUIRED_FIELDS)) {
    const b = doc[block];
    if (typeof b !== 'object' || b === null) continue; // missing-field error already recorded
    for (const f of fields) if (!(f in b)) errors.push(`${CFG_REL}: ${block} missing required field '${f}'`);
  }
  const si = doc.sales_index ?? {};
  const band = si.band;
  if (Array.isArray(band) && band.length === 2) {
    const [lo, hi] = band;
    if (!isNum(lo) || !isNum(hi)) errors.push(`${CFG_REL}: sales_index.band values must be numeric`);
    else if (lo > hi) errors.push(`${CFG_REL}: sales_index.band inverted (lo>hi)`);
    else if (!(0.0 < lo && lo <= hi && hi < 2.0)) errors.push(`${CFG_REL}: sales_index.band out of plausible index range (0,2)`);
  } else {
    errors.push(`${CFG_REL}: sales_index.band must be a [lo, hi] pair`);
  }
  const ranges: [string, any, number, number][] = [
    ['sales_index.step', si.step, 0.0, 1.0],
    ['sales_index.mean_reversion_prob', si.mean_reversion_prob, 0.0, 1.0],
    ['demand_gate.min_index_to_sell', (doc.demand_gate ?? {}).min_index_to_sell, 0.0, 1.0],
    ['order_book.late_penalty_pct_per_day', (doc.order_book ?? {}).late_penalty_pct_per_day, 0.0, 100.0],
    ['order_book.late_penalty_cap_pct', (doc.order_book ?? {}).late_penalty_cap_pct, 0.0, 100.0],
  ];
  for (const [name, val, lo, hi] of ranges) {
    if (val === undefined || val === null) continue; // missing-field error already recorded
    if (!isNum(val)) errors.push(`${CFG_REL}: ${name} must be numeric, got '${val}'`);
    else if (val < lo || val > hi) errors.push(`${CFG_REL}: ${name} out of range [${lo}, ${hi}]: ${val}`);
  }
  const tiers = (doc.qc_tiers ?? {}).tiers ?? [];
  const tierIds = new Set<any>();
  tiers.forEach((t: any, i: number) => {
    for (const f of ['id', 'haircut_pct', 'sme_pending']) if (!(f in t)) errors.push(`${CFG_REL}: qc_tiers.tiers[${i}] missing required field '${f}'`);
    tierIds.add(t.id);
    const h = t.haircut_pct;
    if (isNum(h)) {
      if (h < 0.0 || h > 100.0) errors.push(`${CFG_REL}: qc_tiers.tiers[${i}].haircut_pct out of range [0,100]: ${h}`);
    } else if (h !== undefined && h !== null) {
      errors.push(`${CFG_REL}: qc_tiers.tiers[${i}].haircut_pct must be numeric`);
    }
  });
  const missingTiers = ['prime', 'secondary', 'prompt'].filter((t) => !tierIds.has(t));
  if (missingTiers.length) errors.push(`${CFG_REL}: qc_tiers.tiers missing tier ids [${missingTiers.sort().join(', ')}]`);
  for (const block of ['utilities', 'specific_energy'] as const) {
    const fields = block === 'utilities' ? UTIL_FIELDS : SE_FIELDS;
    const seen = new Set<any>();
    const assets = (doc[block] ?? {}).assets ?? [];
    assets.forEach((a: any, i: number) => {
      for (const f of ['id', ...fields, 'sme_pending']) if (!(f in a)) errors.push(`${CFG_REL}: ${block}.assets[${i}] missing required field '${f}'`);
      seen.add(a.id);
      for (const f of fields) {
        const v = a[f];
        if (v === undefined || v === null) continue;
        if (!isNum(v)) errors.push(`${CFG_REL}: ${block}.assets[${i}].${f} must be numeric, got '${v}'`);
        else if (v < 0.0) errors.push(`${CFG_REL}: ${block}.assets[${i}].${f} negative: ${v}`);
      }
    });
    const dupes = assets.length - seen.size;
    if (dupes > 0) errors.push(`${CFG_REL}: ${block}.assets duplicate stable IDs`);
  }
  return errors;
}

export function loadEconConfig(doc: any): EconConfig {
  const errs = validateEconConfig(doc);
  if (errs.length) throw new Error('CONFIG VALIDATION ERRORS (reject, never default):\n' + errs.map((e) => '  ' + e).join('\n'));
  return {
    sales_index: { band: [doc.sales_index.band[0], doc.sales_index.band[1]], step: doc.sales_index.step, mean_reversion_prob: doc.sales_index.mean_reversion_prob },
    demand_gate: { min_index_to_sell: doc.demand_gate.min_index_to_sell },
    order_book: { late_penalty_pct_per_day: doc.order_book.late_penalty_pct_per_day, late_penalty_cap_pct: doc.order_book.late_penalty_cap_pct },
    qc_tiers: { haircut_pct: Object.fromEntries(doc.qc_tiers.tiers.map((t: any) => [t.id, t.haircut_pct])) },
    utilities: Object.fromEntries(doc.utilities.assets.map((a: any) => [a.id, Object.fromEntries(UTIL_FIELDS.map((f) => [f, a[f]]))])),
    specific_energy: Object.fromEntries(doc.specific_energy.assets.map((a: any) => [a.id, Object.fromEntries(SE_FIELDS.map((f) => [f, a[f]]))])),
  };
}

export function loadPriceLadder(doc: any): PriceLadder {
  if (doc.schema_version !== 1) throw new Error('content/prices/price_ladder_draft.json: schema_version missing or != 1');
  if (!Array.isArray(doc.grades) || doc.grades.length === 0) throw new Error('content/prices/price_ladder_draft.json: grades missing');
  for (const g of doc.grades) {
    for (const f of ['id', 'price_mid', 'cu_max', 'sn_max'])
      if (!(f in g)) throw new Error(`content/prices/price_ladder_draft.json: grades[${g.id ?? '?'}] missing required field '${f}'`);
    for (const f of ['price_mid', 'cu_max', 'sn_max'])
      if (!isNum(g[f])) throw new Error(`content/prices/price_ladder_draft.json: grades[${g.id}].${f} must be numeric`);
  }
  // Ladder fallback carries `price_usd_t` (the mirror reads fallback.price_mid via
  // price_mid(grade) — in the JSON the fallback value is the numeric price_usd_t).
  if (!doc.fallback || typeof doc.fallback.id !== 'string' || !isNum(doc.fallback.price_usd_t))
    throw new Error('content/prices/price_ladder_draft.json: fallback must have id and numeric price_usd_t');
  return {
    grades: doc.grades.map((g: any) => ({ id: g.id, price_mid: g.price_mid, cu_max: g.cu_max, sn_max: g.sn_max })),
    fallback: { id: doc.fallback.id, price_mid: doc.fallback.price_usd_t },
  };
}

export function freshState(seed: number, cfg: EconConfig): EconState {
  const g = prngInit(seed).state; // zero-seed guard: reject, never default
  return {
    day: 0, sales_index: 1.0, orders: [],
    fulfilled_t: 0.0, revenue_usd: 0.0, late_penalty_usd: 0.0, unsold_t: 0.0,
    downgrades: { prime: 0, secondary: 0, prompt: 0 },
    dispatched_t: 0.0, utilities_usd: 0.0, production_t: {},
    generator_state: g,
  };
}

export function priceMid(ladder: PriceLadder, gradeId: string): number {
  const g = ladder.grades.find((x) => x.id === gradeId);
  return g ? g.price_mid : ladder.fallback.price_mid;
}

// Grade assignment reused from grade_pricing_mirror (1:1): highest price-band midpoint the
// chemistry passes, inclusive at-limit; fallback if it fails all grades.
export function assignGrade(ladder: PriceLadder, cu: number, sn: number): string {
  let bestId: string | null = null;
  let bestMid = -1.0;
  for (const g of ladder.grades) {
    if (cu <= g.cu_max && sn <= g.sn_max) {
      if (g.price_mid > bestMid) { bestMid = g.price_mid; bestId = g.id; }
    }
  }
  return bestId ?? ladder.fallback.id;
}

// QC tier = how many ladder bands the chemistry fell below the assigned grade.
export function qcTier(ladder: PriceLadder, gradeId: string, cu: number, sn: number): string {
  const passedId = assignGrade(ladder, cu, sn);
  if (passedId === gradeId) return 'prime';
  const ladderSorted = [...ladder.grades].sort((a, b) => -a.price_mid + b.price_mid); // desc by price_mid
  const idx = ladderSorted.findIndex((g) => g.id === gradeId);
  if (passedId === ladder.fallback.id) return 'prompt';
  const pidx = ladderSorted.findIndex((g) => g.id === passedId);
  return pidx === idx + 1 ? 'secondary' : 'prompt';
}

// Specific-energy KPI from actual throughput. Zero-production must NOT divide by zero —
// report null/NA, not 0 (mirror parity).
export function specificEnergyKpi(cfg: EconConfig, state: EconState, assetId: string): { kwh_t: number; nm3_ng_t: number; throughput_t: number } | null {
  const t = state.production_t[assetId] ?? 0.0;
  if (t <= 0.0) return null;
  const se = cfg.specific_energy[assetId];
  return { kwh_t: se.kwh_t, nm3_ng_t: se.nm3_ng_t, throughput_t: t };
}

// PURE TICK — returns a NEW state; the input state is never mutated.
// Tick order (fixture): sales_index_step -> dispatch; day increments once per tick
// (1 tick = 1 day in this domain fixture). Actions for the tick are applied in the
// order they appear in the fixture action list.
export function tickEconomics(input: EconState, cfg: EconConfig, ladder: PriceLadder, actions: EconAction[], tickNo: number): EconState {
  const st: EconState = structuredClone(input);
  const tickActions = actions.filter((a) => a.tick === tickNo);

  // Cadence boundary reproduced exactly from the mirror run loop: `state['day'] = day`
  // is assigned at the top of each tick (1 tick = 1 day), NOT incremented after the
  // stages. Day is set from the tick number before the stages run.
  st.day = tickNo;

  // sales_index_step: DRAW CONTRACT — exactly 2 draws per call.
  //   draw 1 -> uniform(-step, step) = a + (b - a) * draw
  //   draw 2 -> random() compared against mean_reversion_prob
  if (tickActions.some((a) => a.type === 'step_index')) {
    const [lo, hi] = cfg.sales_index.band;
    const step = cfg.sales_index.step;
    const r1 = xorshift32Next(st.generator_state);
    st.generator_state = r1.newState;
    let d = -step + (2 * step) * r1.draw;
    const r2 = xorshift32Next(st.generator_state);
    st.generator_state = r2.newState;
    if (r2.draw < cfg.sales_index.mean_reversion_prob) {
      d = 1.0 - st.sales_index;
      d = Math.max(-step, Math.min(step, d));
    }
    st.sales_index = Math.max(lo, Math.min(hi, st.sales_index + d));
  }

  for (const a of tickActions) {
    if (a.type === 'step_index') continue; // already executed (tick order: step first)
    if (a.type === 'add_order') {
      const o: EconOrder = {
        id: st.orders.length, grade: a.grade, tonnage: a.tonnage, due_day: a.due_day,
        signed_day: st.day, mode: a.mode, sign_index: st.sales_index, status: 'open',
        signed_value: a.tonnage * priceMid(ladder, a.grade),
      };
      st.orders.push(o);
      continue;
    }
    // dispatch
    const asset = a.asset ?? 'dispatch';
    const tier = qcTier(ladder, a.grade, a.cu, a.sn);
    st.downgrades[tier] += 1;
    const base = priceMid(ladder, a.grade);
    const haircut = cfg.qc_tiers.haircut_pct[tier];
    st.dispatched_t += a.tonnes;
    st.production_t[asset] = (st.production_t[asset] ?? 0.0) + a.tonnes;
    for (const [u, v] of Object.entries(cfg.utilities[asset] ?? {})) st.utilities_usd += a.tonnes * v;
    const order = st.orders.find((o) => o.status === 'open' && o.grade === a.grade);
    if (order) {
      // demand gate: below gate, tonnes stay as finished_yard inventory (stored, not lost)
      if (st.sales_index < cfg.demand_gate.min_index_to_sell) {
        st.unsold_t += a.tonnes;
        continue;
      }
      const take = Math.min(a.tonnes, order.tonnage);
      let idx = order.mode === 'forward' ? order.sign_index : st.sales_index;
      const rev = take * base * (1 - haircut / 100.0) * idx;
      st.revenue_usd += rev;
      st.fulfilled_t += take;
      order.tonnage -= take;
      if (order.tonnage <= 1e-9) {
        order.status = 'fulfilled';
        // late penalty on the FULL signed order value, not remaining tonnage (mirror fix)
        if (st.day > order.due_day) {
          const lateDays = st.day - order.due_day;
          const pen = lateDays * cfg.order_book.late_penalty_pct_per_day / 100.0 * order.signed_value;
          const cap = cfg.order_book.late_penalty_cap_pct / 100.0 * order.signed_value;
          st.late_penalty_usd += Math.min(pen, cap);
        }
      }
      const leftover = a.tonnes - take;
      if (leftover > 0) {
        st.revenue_usd += leftover * base * (1 - haircut / 100.0) * st.sales_index;
        st.fulfilled_t += leftover;
      }
    } else {
      if (st.sales_index >= cfg.demand_gate.min_index_to_sell) {
        st.revenue_usd += a.tonnes * base * (1 - haircut / 100.0) * st.sales_index;
        st.fulfilled_t += a.tonnes;
      } else {
        st.unsold_t += a.tonnes;
      }
    }
  }

  return st;
}

// Sandbox boundary: hypothetical run on a COPY — never touches the real state.
export function sandboxRun(realState: EconState, cfg: EconConfig, ladder: PriceLadder, ticks: number, actions: EconAction[] = []): { sandbox: EconState; realAfter: EconState } {
  const snapshot = structuredClone(realState);
  let sandbox = structuredClone(realState);
  for (let t = 1; t <= ticks; t++) sandbox = tickEconomics(sandbox, cfg, ladder, actions, t);
  if (JSON.stringify(realState) !== JSON.stringify(snapshot))
    throw new Error('sandbox isolation violated: real state mutated');
  return { sandbox, realAfter: realState };
}

export function loadEconConfigFromFile(path: string): EconConfig {
  return loadEconConfig(JSON.parse(readFileSync(path, 'utf-8')));
}
export function loadPriceLadderFromFile(path: string): PriceLadder {
  return loadPriceLadder(JSON.parse(readFileSync(path, 'utf-8')));
}
