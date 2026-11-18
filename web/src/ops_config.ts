// Browser-safe config module: reject-never-default validation for the Domain 3
// operations content JSON. No node:fs here — the browser bundle imports this.
// ops_domain3.ts re-exports these names, so tests and the fs loader keep the
// SAME single loader implementation (single source of truth for validation).
// ASSET_ORDER lives in ops_domain3.ts; import type-only to keep this module
// free of any runtime cycle with the fs-loading core.
import type { Asset } from './ops_domain3.js';
const ASSET_ORDER: readonly Asset[] = ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane'];

export interface OpsConfig {
  mtbf: Record<string, number>;
  mttr: Record<string, number>;
  headcount: Record<string, number>;
  spare_delivery_days: number;
  planned_every_days: number;
  planned_days: number;
  wage_per_person_day: number;
  morale_bands: { threshold: number; mult: number }[]; // sorted desc by threshold
  demurrage_free_days: number;
  demurrage_per_day: number;
  berth: { capacity: number; arrival_ships_per_day: number; unload_t_per_day: number };
  ship_cargo_t: number;
  dispatch: { effective_tph: number; arrival_t_per_tick: number; yard_capacity_t: number; congestion_ticks: number };
  // Step B decide-verb tunables: optional content block, absent = demo defaults (sme_pending)
  decide: { pm_duration_days: number; max_spares_per_asset: number; overtime_max_days: number };
}

// Demo defaults for the optional decide block (mirror DEF_* values, sme_pending).
export const DECIDE_DEFAULTS = { pm_duration_days: 2.0, max_spares_per_asset: 3, overtime_max_days: 7 };

function reject(path: string, reason: string): never {
  throw new Error(`content/operations/operations_domain3.json: ${path} ${reason}`);
}
function isNum(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v); }

export function loadOpsConfig(doc: any): OpsConfig {
  if (doc.schema_version !== 1) reject('schema_version', 'missing or != 1');
  const req = ['assets', 'spares', 'planned_shutdown', 'manpower', 'morale', 'demurrage', 'dispatch'];
  for (const f of req) if (!(f in doc)) reject('', `missing required top-level field '${f}'`);
  const mtbf: Record<string, number> = {}, mttr: Record<string, number> = {}, headcount: Record<string, number> = {};
  for (const a of doc.assets) {
    for (const f of ['id', 'mtbf_hours', 'mttr_hours', 'headcount']) if (!(f in a)) reject(`assets[${a.id ?? '?'}]`, `missing required field '${f}'`);
    if (!isNum(a.mtbf_hours) || a.mtbf_hours <= 0) reject(`assets[${a.id}]`, 'mtbf_hours invalid (must be positive number)');
    if (!isNum(a.mttr_hours) || a.mttr_hours <= 0) reject(`assets[${a.id}]`, 'mttr_hours invalid (must be positive number)');
    if (!isNum(a.headcount) || a.headcount <= 0) reject(`assets[${a.id}]`, 'headcount invalid (must be positive number)');
    mtbf[a.id] = a.mtbf_hours; mttr[a.id] = a.mttr_hours; headcount[a.id] = a.headcount;
  }
  // Draw contract: config asset order must equal the canonical order (reject on mismatch).
  const cfgOrder = doc.assets.map((a: any) => a.id);
  if (JSON.stringify(cfgOrder) !== JSON.stringify(ASSET_ORDER)) reject('assets', 'order mismatch with draw contract');
  if (!isNum(doc.spares.delivery_lead_days) || doc.spares.delivery_lead_days <= 0) reject('spares', 'delivery_lead_days invalid');
  if (!isNum(doc.planned_shutdown.every_days) || doc.planned_shutdown.every_days <= 0) reject('planned_shutdown', 'every_days invalid');
  if (!isNum(doc.planned_shutdown.duration_days) || doc.planned_shutdown.duration_days <= 0) reject('planned_shutdown', 'duration_days invalid');
  if (!isNum(doc.manpower.wage_per_person_day) || doc.manpower.wage_per_person_day <= 0) reject('manpower', 'wage_per_person_day invalid');
  if (!Array.isArray(doc.morale.bands) || doc.morale.bands.length === 0) reject('morale', 'bands missing');
  for (const b of doc.morale.bands) {
    if (!isNum(b.threshold) || !isNum(b.breakdown_multiplier) || b.breakdown_multiplier <= 0 || b.breakdown_multiplier > 1)
      reject('morale.bands', 'invalid band (multiplier must be in (0,1])');
  }
  const d = doc.demurrage;
  for (const f of ['free_days', 'penalty_usd_per_day', 'berth_capacity', 'arrival_ships_per_day', 'unload_t_per_day', 'ship_cargo_t'])
    if (!(f in d)) reject('demurrage', `missing required field '${f}'`);
  for (const f of ['free_days', 'penalty_usd_per_day', 'berth_capacity', 'arrival_ships_per_day', 'unload_t_per_day', 'ship_cargo_t'])
    if (!isNum(d[f]) || d[f] <= 0) reject(`demurrage.${f}`, 'invalid (must be positive number)');
  if (!Number.isInteger(d.berth_capacity)) reject('demurrage.berth_capacity', 'must be integer');
  if (!Number.isInteger(d.arrival_ships_per_day)) reject('demurrage.arrival_ships_per_day', 'must be integer (fractional cadence is non-deterministic)');
  const p = doc.dispatch;
  for (const f of ['effective_tph', 'arrival_t_per_tick', 'yard_capacity_t', 'congestion_ticks'])
    if (!(f in p)) reject('dispatch', `missing required field '${f}'`);
  for (const f of ['effective_tph', 'arrival_t_per_tick', 'yard_capacity_t', 'congestion_ticks'])
    if (!isNum(p[f]) || p[f] <= 0) reject(`dispatch.${f}`, 'invalid (must be positive number)');
  if (!Number.isInteger(p.congestion_ticks)) reject('dispatch.congestion_ticks', 'must be integer');
  // Optional decide block (Step B verbs): absent = demo defaults; present = validate.
  let decide = { ...DECIDE_DEFAULTS };
  if (doc.decide !== undefined && doc.decide !== null) {
    for (const f of ['pm_duration_days', 'max_spares_per_asset', 'overtime_max_days'] as const) {
      if (!(f in doc.decide)) reject('decide', `missing required field '${f}'`);
      const v = doc.decide[f];
      if (!isNum(v) || v <= 0) reject(`decide.${f}`, 'invalid (must be positive number)');
    }
    decide = { pm_duration_days: doc.decide.pm_duration_days, max_spares_per_asset: Math.trunc(doc.decide.max_spares_per_asset), overtime_max_days: Math.trunc(doc.decide.overtime_max_days) };
  }
  return {
    mtbf, mttr, headcount,
    spare_delivery_days: doc.spares.delivery_lead_days,
    planned_every_days: doc.planned_shutdown.every_days,
    planned_days: doc.planned_shutdown.duration_days,
    wage_per_person_day: doc.manpower.wage_per_person_day,
    morale_bands: [...doc.morale.bands].map((b: any) => ({ threshold: b.threshold, mult: b.breakdown_multiplier }))
      .sort((x, y) => y.threshold - x.threshold),
    demurrage_free_days: d.free_days,
    demurrage_per_day: d.penalty_usd_per_day,
    berth: { capacity: d.berth_capacity, arrival_ships_per_day: d.arrival_ships_per_day, unload_t_per_day: d.unload_t_per_day },
    ship_cargo_t: d.ship_cargo_t,
    dispatch: { effective_tph: p.effective_tph, arrival_t_per_tick: p.arrival_t_per_tick, yard_capacity_t: p.yard_capacity_t, congestion_ticks: p.congestion_ticks },
    decide,
  };
}
