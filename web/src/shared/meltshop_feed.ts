// S3.1 meltshop feed — handoffs #2/#3 (PLAN_FORGED Stage 3). Two REAL transfer edges on
// the frozen S1.1 registry primitives, riding the slice engines' monotonic signals:
//   scrap: slice1 dispatched_t delta       -> scrap_bucket    -> eaf_scrap
//   DRI:   slice3 discharged_t_total delta -> dri_feed_buffer -> eaf_dri
// Boundary-buffer pattern (25.10 clause 2): buckets are real inventories accumulating
// before the EAF exists; the interfaces join the ledger on commissioning. Consumption is
// owner-tagged (charge_id) at slice4 heat start: take what physically exists, event the
// shortfall (never fabricate) — shortfall events are the S3.2 amber signal.
// Closure: usable + in_transit + consumed == deposits within 1e-6 (D-02).
// Slice engines stay deterministic replay ports (S1.2 precedent); hard production gating
// on feed stock is a later explicit rule change (DECISIONS S3.1 contract reading).
// Parity oracle: mirror/meltshop_feed_mirror.py (literal clone) + the three-engine dump.

import {
  type RegistryState, freshRegistryState, registerInventory, deposit, transfer,
  registryTick, ledgerClosure, reservationsValid,
} from './registry_handoff.ts';

export const SCRAP_BUCKET_INV = 'scrap_bucket';
export const DRI_BUFFER_INV = 'dri_feed_buffer';
export const EAF_SCRAP_INV = 'eaf_scrap';
export const EAF_DRI_INV = 'eaf_dri';

// scrap_feed 150-300 tph band midpoint (sme_pending); 5 t bucket granularity — a 25 t
// truck chunk would exceed the 9.375 t/tick rate cap and the edge would never flow.
export const SCRAP_EDGE = { rate_tph: 225.0, chunk_t: 5.0, travel_ticks: 2 } as const;
export const DRI_EDGE = { rate_tph: 600.0, chunk_t: 25.0, travel_ticks: 2 } as const;

export interface FeedEdge { rate_tph: number; chunk_t: number; travel_ticks: number }
export interface FeedConsumption { charge_id: string; scrap_t: number; dri_t: number }

export interface MeltshopFeedState {
  registry: RegistryState;
  eafCommissioned: boolean;
  commissionedAtTick?: number;
  scrapEdge: FeedEdge;
  driEdge: FeedEdge;
  consumedScrapT: number;
  consumedDriT: number;
}

export function freshMeltshopFeedState(scrap?: Partial<FeedEdge>, dri?: Partial<FeedEdge>): MeltshopFeedState {
  const se: FeedEdge = { ...SCRAP_EDGE, ...scrap };
  const de: FeedEdge = { ...DRI_EDGE, ...dri };
  for (const e of [se, de]) {
    if (!(e.rate_tph > 0) || !(e.chunk_t > 0) || !Number.isInteger(e.travel_ticks) || e.travel_ticks < 1) {
      throw new Error('feed edge params invalid (rate/chunk positive, integer travel >= 1)');
    }
  }
  let reg = freshRegistryState();
  reg = registerInventory(reg, SCRAP_BUCKET_INV);
  reg = registerInventory(reg, DRI_BUFFER_INV);
  return { registry: reg, eafCommissioned: false, scrapEdge: se, driEdge: de, consumedScrapT: 0.0, consumedDriT: 0.0 };
}

/** EAF joins the plant: the two feed interfaces become real ledger inventories. Idempotent. */
export function commissionEaf(st: MeltshopFeedState): MeltshopFeedState {
  if (st.eafCommissioned) return st;
  let reg = registerInventory(st.registry, EAF_SCRAP_INV);
  reg = registerInventory(reg, EAF_DRI_INV);
  return { ...st, registry: reg, eafCommissioned: true, commissionedAtTick: reg.tick };
}

export function feedDepositScrap(st: MeltshopFeedState, tonnes: number): MeltshopFeedState {
  if (!(tonnes > 0)) return st;
  return { ...st, registry: deposit(st.registry, SCRAP_BUCKET_INV, tonnes) };
}

export function feedDepositDri(st: MeltshopFeedState, tonnes: number): MeltshopFeedState {
  if (!(tonnes > 0)) return st;
  return { ...st, registry: deposit(st.registry, DRI_BUFFER_INV, tonnes) };
}

/** Whole chunks capped by the per-tick rate (same arithmetic as the ore belt). */
export function planFeedLoad(available: number, ratePerTick: number, chunkT: number): number {
  if (available <= 0) return 0;
  return Math.floor(Math.min(ratePerTick, available) / chunkT) * chunkT;
}

function available(reg: RegistryState, invId: string): number {
  const inv = reg.inventories[invId];
  if (!inv) return 0.0;
  return inv.usable_t - (reg.reserved[invId] ?? 0.0);
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Owner-tagged consume: take what physically exists, event the shortfall (mirror wording). */
function consume(st: MeltshopFeedState, invId: string, needT: number, owner: string): number {
  const reg = st.registry;
  const inv = reg.inventories[invId];
  if (!inv) {
    reg.events.push({ tick: reg.tick, event: `consume refused ${invId} ${needT}t (${owner}): interface not commissioned` });
    return 0.0;
  }
  const have = inv.usable_t;
  const take = Math.min(have, needT);
  if (take > 0) inv.usable_t -= take;
  if (take < needT - 1e-6) {
    reg.events.push({ tick: reg.tick, event: `feed SHORTFALL ${invId} ${round3(needT - take)}t short for ${owner} (had ${round3(have)}t)` });
  }
  return take;
}

/** One plant tick. Deposits happen BEFORE the step (session wires the slice deltas).
 *  Order: clock (arrivals) -> drain buckets to interfaces (if live) -> owner-tagged consume. */
export function stepMeltshopFeed(st: MeltshopFeedState, consumptions: FeedConsumption[]): MeltshopFeedState {
  let reg = registryTick(st.registry);
  const next: MeltshopFeedState = { ...st, registry: reg };
  if (next.eafCommissioned) {
    const scLoad = planFeedLoad(available(reg, SCRAP_BUCKET_INV), next.scrapEdge.rate_tph / 24.0, next.scrapEdge.chunk_t);
    if (scLoad > 0) reg = transfer(reg, SCRAP_BUCKET_INV, EAF_SCRAP_INV, scLoad, next.scrapEdge.travel_ticks);
    const drLoad = planFeedLoad(available(reg, DRI_BUFFER_INV), next.driEdge.rate_tph / 24.0, next.driEdge.chunk_t);
    if (drLoad > 0) reg = transfer(reg, DRI_BUFFER_INV, EAF_DRI_INV, drLoad, next.driEdge.travel_ticks);
    next.registry = reg;
    for (const c of consumptions) {
      next.consumedScrapT += consume(next, EAF_SCRAP_INV, c.scrap_t, c.charge_id);
      next.consumedDriT += consume(next, EAF_DRI_INV, c.dri_t, c.charge_id);
    }
  } else {
    for (const c of consumptions) {
      reg.events.push({ tick: reg.tick, event: `consume refused ${c.charge_id}: EAF not commissioned` });
    }
  }
  return next;
}

export interface FeedLedgerView {
  tick: number;
  scrap_bucket_t: number; dri_feed_buffer_t: number;
  eaf_scrap_t: number; eaf_dri_t: number;
  in_transit_t: number;
  consumed_scrap_t: number; consumed_dri_t: number;
}

export function feedLedgerView(st: MeltshopFeedState): FeedLedgerView {
  const g = (id: string) => st.registry.inventories[id]?.usable_t ?? 0.0;
  let inflight = 0.0;
  for (const rec of st.registry.in_transit) inflight += rec.tonnes;
  return {
    tick: st.registry.tick,
    scrap_bucket_t: g(SCRAP_BUCKET_INV), dri_feed_buffer_t: g(DRI_BUFFER_INV),
    eaf_scrap_t: g(EAF_SCRAP_INV), eaf_dri_t: g(EAF_DRI_INV),
    in_transit_t: inflight,
    consumed_scrap_t: st.consumedScrapT, consumed_dri_t: st.consumedDriT,
  };
}

/** Closure + reservation invariants. Consumed tonnage LEFT the ledger into the furnace,
 *  so the remaining ledger must equal deposits minus consumed (same 1e-6 gate as S1.1). */
export function feedInvariants(st: MeltshopFeedState, depositsTotal: number): { ok: boolean; detail: string } {
  const remaining = depositsTotal - st.consumedScrapT - st.consumedDriT;
  const close = ledgerClosure(st.registry, remaining);
  if (!close.ok) return { ok: false, detail: `closure ${close.total} != ${remaining} (deposits ${depositsTotal} - consumed)` };
  const res = reservationsValid(st.registry);
  if (!res.ok) return { ok: false, detail: `reservation invalid on ${res.badId}` };
  return { ok: true, detail: `closed at ${close.total} t` };
}

/** Shortfall events this tick — the S3.2 amber signal for the EAF feed. */
export function feedShortfallsThisTick(st: MeltshopFeedState): number {
  return st.registry.events.filter((e) => e.tick === st.registry.tick && e.event.includes('SHORTFALL')).length;
}
