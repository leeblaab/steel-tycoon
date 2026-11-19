// S1.2 ore-belt handoff — the belt you build at onboarding step 4 IS a real transfer edge
// (PLAN_FORGED Stage 1 / S1.2). Boundary buffer pattern (25.10 clause 2): the belt is built
// before the DRP area exists, so the chain is yard -> ore_buffer (a REAL registry inventory)
// -> drp_intake (credited on commissioning only). Built on the frozen S1.1 primitives in
// registry_handoff.ts — no new sim rules here, just wiring: a per-tick belt dispatcher that
// moves what's available, never teleports (travel_ticks >= 1 enforced upstream).

import {
  type RegistryState, freshRegistryState, registerInventory, deposit, transfer,
  registryTick, ledgerClosure, reservationsValid,
} from './registry_handoff.ts';

export const BELT_EDGE_ID = 'conv_ore_drp'; // content/nodes/conveyors_draft.json id
export const YARD_INV = 'yard_ore';
export const BUFFER_INV = 'ore_buffer';
export const DRP_INTAKE_INV = 'drp_intake';

/** Belt capacity: conv_ore_drp capacity_tph 400-800 (Yasser-calibrated band); one tick is
 *  15 plant-minutes, so rate = tph/24 per tick. Mid-band default until SME tunes. */
export function beltRatePerTick(tph: number): number {
  if (!(tph > 0)) throw new Error('belt tph must be positive');
  return tph / 24.0;
}

/** Yard tonnage the belt may start this tick: whole loads of `chunkT`, capped by capacity. */
export function planBeltLoad(available: number, ratePerTick: number, chunkT: number): number {
  if (available <= 0) return 0;
  const n = Math.floor(Math.min(ratePerTick, available) / chunkT);
  return n * chunkT;
}

export interface OreBeltState {
  registry: RegistryState;
  drpCommissioned: boolean;
  beltRateTph: number;
  chunkT: number;
  travelTicks: number; // yard -> buffer (belt run time, integer ticks)
  commissionedAtTick?: number; // when DRP joined; drives the drain edge's arrival tick
}

export function freshOreBeltState(beltRateTph = 600.0, chunkT = 25.0, travelTicks = 2): OreBeltState {
  if (!Number.isInteger(travelTicks) || travelTicks < 1) {
    throw new Error('belt travel_ticks must be an integer >= 1');
  }
  let reg = freshRegistryState();
  reg = registerInventory(reg, YARD_INV);
  reg = registerInventory(reg, BUFFER_INV); // real inventory, not a fudge factor
  return {
    registry: reg, drpCommissioned: false, beltRateTph, chunkT, travelTicks,
  };
}

/** Ship-arrival credit into the yard (driven by slice1's per-tick `arrived_t` delta). */
export function beltDepositYard(st: OreBeltState, tonnes: number): OreBeltState {
  if (!(tonnes > 0)) return st;
  return { ...st, registry: deposit(st.registry, YARD_INV, tonnes) };
}

/** DRP commissioned (step 6 build / slice3 unlock): drp_intake joins the ledger and the
 *  buffer starts draining into it. Buffer stock built before this point keeps flowing —
 *  step 4 stays playable without forcing DRP early. */
export function commissionDrp(st: OreBeltState): OreBeltState {
  if (st.drpCommissioned) return st;
  let reg = registerInventory(st.registry, DRP_INTAKE_INV);
  return { ...st, registry: reg, drpCommissioned: true, commissionedAtTick: reg.tick };
}

/** One plant-minute step of the belt chain. Order: advance the clock (credits arrivals),
 *  then start a new load from yard -> buffer; if DRP is live, drain buffer -> intake with
 *  an arrival pinned to `commissionedAtTick + travelTicks` so the first credited tonne lands
 *  exactly one belt-run after commissioning. */
export function stepOreBelt(st: OreBeltState): OreBeltState {
  let reg = registryTick(st.registry);
  const rate = beltRatePerTick(st.beltRateTph);

  if (st.drpCommissioned) {
    const drain = planBeltLoad(available(reg, BUFFER_INV), rate, st.chunkT);
    if (drain > 0) {
      const due = (st.commissionedAtTick ?? reg.tick) + st.travelTicks;
      const travel = Math.max(1, due - reg.tick);
      reg = transfer(reg, BUFFER_INV, DRP_INTAKE_INV, drain, travel);
    }
  }

  const load = planBeltLoad(available(reg, YARD_INV), rate, st.chunkT);
  if (load > 0) reg = transfer(reg, YARD_INV, BUFFER_INV, load, st.travelTicks);

  return { ...st, registry: reg };
}

function available(reg: RegistryState, invId: string): number {
  const inv = reg.inventories[invId];
  if (!inv) return 0.0;
  return inv.usable_t - (reg.reserved[invId] ?? 0.0);
}

/** Ledger view for the HUD / inspection card (pure projection). */
export function beltLedgerView(st: OreBeltState): { tick: number; yard_t: number; buffer_t: number; drp_intake_t: number; in_transit_t: number } {
  const sum = (id: string) => st.registry.inventories[id]?.usable_t ?? 0.0;
  let inflight = 0.0;
  for (const rec of st.registry.in_transit) inflight += rec.tonnes;
  return {
    tick: st.registry.tick,
    yard_t: sum(YARD_INV),
    buffer_t: sum(BUFFER_INV),
    drp_intake_t: sum(DRP_INTAKE_INV),
    in_transit_t: inflight,
  };
}

/** Closure + reservation invariants (same 1e-6 gate as S1.1). */
export function beltInvariants(st: OreBeltState, initialDeposits: number): { ok: boolean; detail: string } {
  const close = ledgerClosure(st.registry, initialDeposits);
  if (!close.ok) return { ok: false, detail: `closure ${close.total} != ${initialDeposits}` };
  const res = reservationsValid(st.registry);
  if (!res.ok) return { ok: false, detail: `reservation invalid on ${res.badId}` };
  return { ok: true, detail: `closed at ${close.total} t` };
}

// ---- Presentation projection (S1.2 visual layer) ------------------------------------
// Pure read of the ledger -> what the 3D belt strip draws. The registry only credits a
// destination at arrival_tick, so "on the belt" = in_transit records; each rides its leg
// from depart_tick to arrival_tick. Progress is wall-clock smooth (presentation only —
// sim tonnes never move between ticks).

export interface BeltTokenView {
  key: string;        // transfer_id (stable across frames while the record lives)
  leg: 'yard-buffer' | 'buffer-drp';
  progress: number;   // 0..1 along the leg (wall-clock eased, clamped)
  size: number;       // 0.7..1.4 token scale, sqrt of load mass
}

export interface BeltStripView {
  built: boolean;     // belt node exists -> show the physical strip even with no tonnes
  live: boolean;      // DRP commissioned -> second hop painted too
  tokens: BeltTokenView[];
}

/** Smooth per-token position between tick boundaries. `frac` = fraction of the current
 *  tick already elapsed (0 at tick start, ->1 before the next step). A record one tick
 *  from arrival sits at (travel-1+frac)/travel so it lands exactly at arrival_tick. */
export function beltTokenView(st: OreBeltState, frac: number): BeltStripView {
  const f = Math.max(0, Math.min(0.999, frac));
  const tick = st.registry.tick;
  const tokens: BeltTokenView[] = [];
  for (const rec of st.registry.in_transit) {
    const travel = rec.arrival_tick - rec.depart_tick;
    const elapsed = (tick - rec.depart_tick) + f;
    tokens.push({
      key: rec.transfer_id,
      leg: rec.to_id === BUFFER_INV ? 'yard-buffer' : 'buffer-drp',
      progress: Math.max(0, Math.min(1, elapsed / travel)),
      size: 0.7 + Math.sqrt(rec.tonnes) * 0.14, // 25t -> ~1.4; chunkT drives token mass
    });
  }
  return {
    built: st.commissionedAtTick !== undefined || tick > 0 || st.drpCommissioned,
    live: st.drpCommissioned,
    tokens,
  };
}
