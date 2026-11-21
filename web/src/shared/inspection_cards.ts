// SteelX inspection cards — "what is this machine doing now" as a PURE PROJECTION of sim
// state (factory_scene_design_v1.md decision 2: zero new mechanics, zero invented fields).
// Each projector reads only fields the shared parity ports already maintain.
// Ghost slots are NOT here — ghost preview cards come from the layout manifest + InfoCard.

import type { SlotDef } from './factory_layout.ts';

export interface InspectionCardData {
  slot_id: string;
  title: string;
  lines: string[]; // plain-text status lines, rendered by the card UI
  tone: 'busy' | 'idle' | 'waiting';
}

// ---- slice4 (EAF / LRF / CCM) — fields confirmed in slice4_sim.ts -------------------

export interface S4StateView {
  tick: number;
  eaf: { busy_charge_id: string | null; remaining_ticks: number; bath_t: number };
  lrf: { busy_ladle_id: string | null; remaining_ticks: number };
  ccm: { busy_ladle_id: string | null; remaining_ticks: number };
  counters: {
    charge_wait_ticks: number;
    ladle_wait_ticks: number;
    caster_wait_ticks: number;
    heats_starved: number;
  };
}

export function inspectSlice4Slot(slot: SlotDef, st: S4StateView): InspectionCardData {
  switch (slot.inspect_key) {
    case 'eaf': {
      const busy = st.eaf.busy_charge_id !== null;
      return {
        slot_id: slot.id,
        title: 'EAF — what it is doing now',
        tone: busy ? 'busy' : st.counters.charge_wait_ticks > 0 ? 'waiting' : 'idle',
        lines: [
          busy
            ? `Melting charge ${st.eaf.busy_charge_id} — ${st.eaf.bath_t.toFixed(1)} t in the bath, ${st.eaf.remaining_ticks} ticks to tap.`
            : 'Idle — no charge in the furnace.',
          `Charges waiting for this furnace: ${st.counters.charge_wait_ticks} wait-ticks.`,
          `Starved ticks (no delivered charge at the interface): ${st.counters.heats_starved}.`,
        ],
      };
    }
    case 'lrf': {
      const busy = st.lrf.busy_ladle_id !== null;
      return {
        slot_id: slot.id,
        title: 'Ladle Refining Furnace — what it is doing now',
        tone: busy ? 'busy' : st.counters.ladle_wait_ticks > 0 ? 'waiting' : 'idle',
        lines: [
          busy
            ? `Refining ladle ${st.lrf.busy_ladle_id} — ${st.lrf.remaining_ticks} ticks left.`
            : 'Idle — no ladle on the station.',
          `Ladles waiting for a free LRF path: ${st.counters.ladle_wait_ticks} wait-ticks.`,
        ],
      };
    }
    case 'ccm': {
      const busy = st.ccm.busy_ladle_id !== null;
      return {
        slot_id: slot.id,
        title: 'Caster (single strand) — what it is doing now',
        tone: busy ? 'busy' : st.counters.caster_wait_ticks > 0 ? 'waiting' : 'idle',
        lines: [
          busy
            ? `Casting ladle ${st.ccm.busy_ladle_id} — ${st.ccm.remaining_ticks} ticks to finish the cast.`
            : 'Strand free — no ladle being cast.',
          `Refined ladles waiting while the strand was busy: ${st.counters.caster_wait_ticks} wait-ticks.`,
        ],
      };
    }
    default:
      throw new Error(`inspectSlice4Slot: unknown inspect_key '${slot.inspect_key}' (slot ${slot.id})`);
  }
}

// ---- slice5 (rebar mill) — fields confirmed in slice5_sim.ts ------------------------

export interface S5StateView {
  tick: number;
  mill: { busy: boolean; remaining_ticks: number; batch_t: number; phase?: string | null };
  counters: {
    mill_wait_ticks: number;
    mill_starved_ticks: number;
    // S5.2 dispatch revenue counter ONLY (F-07: display only — no wallet/upgrades/spend).
    // Fields exist in the slice5 engine since v1; optional here so pre-S5.2 views still project.
    dispatched_t_total?: number;
    revenue_usd?: number;
  };
}

export function inspectSlice5Slot(slot: SlotDef, st: S5StateView): InspectionCardData {
  switch (slot.inspect_key) {
    case 'mill': {
      const lines = [
        st.mill.busy
          ? `Rolling a batch — ${st.mill.batch_t.toFixed(1)} t on the mill, ${st.mill.remaining_ticks} ticks left.`
          : 'Idle — no batch on the rolls.',
        `Batches waiting for the mill: ${st.counters.mill_wait_ticks} wait-ticks.`,
        `Starved ticks (mill ready but nothing delivered): ${st.counters.mill_starved_ticks}.`,
      ];
      // S5.1 phase grammar (pure derivation from the roll countdown; absent = pre-S5.1 view).
      if (st.mill.busy && st.mill.phase) {
        lines.push(`Mill process stage: ${st.mill.phase} (reheat → rolling → cooling → shear).`);
      }
      // S5.2: dispatch revenue counter ONLY — tonnage × price at the actual dispatch
      // outflow (price ladder midpoint, sme_pending). Display only; no wallet systems.
      const shipped = st.counters.dispatched_t_total ?? 0;
      lines.push(`Shipped from the mill: ${shipped.toFixed(1)} t dispatched.`);
      lines.push(`Dispatch revenue so far: $${Math.round(st.counters.revenue_usd ?? 0).toLocaleString('en-US')}.`);
      return {
        slot_id: slot.id,
        title: 'Rebar Mill — what it is doing now',
        tone: st.mill.busy ? 'busy' : st.counters.mill_starved_ticks > 0 ? 'waiting' : 'idle',
        lines,
      };
    }
    default:
      throw new Error(`inspectSlice5Slot: unknown inspect_key '${slot.inspect_key}' (slot ${slot.id})`);
  }
}

// ---- slice3 (DRP / DRI buffer) — fields confirmed in slice3_sim.ts SimState ----------
// Zone-level card for the fullplant tap contract; pure projection of verbatim fields.

export interface S3StateView {
  tick: number;
  buffer_t: number;
  drp_tripped_until: number; // tick until which DRP discharge is halted (0 = running)
  heats: Array<{ status: 'charged' | 'skipped'; failure_cause?: string | null }>;
}

export function inspectSlice3Slot(slot: SlotDef, st: S3StateView): InspectionCardData {
  if (slot.inspect_key !== 'dri_buffer')
    throw new Error(`inspectSlice3Slot: unknown inspect_key '${slot.inspect_key}' (slot ${slot.id})`);
  const tripped = st.drp_tripped_until > st.tick;
  const charged = st.heats.filter((h) => h.status === 'charged').length;
  const skipped = st.heats.filter((h) => h.status === 'skipped').length;
  // S3.2: the most recent heat SKIPPED (buffer short) is a real wait state — surface it
  // as 'waiting' so the zone card AND the amber state ring agree. Recovers automatically
  // when the next heat charges (last-heat projection, not cumulative history).
  const lastHeat = st.heats.length ? st.heats[st.heats.length - 1] : null;
  const starved = lastHeat?.status === 'skipped';
  return {
    slot_id: slot.id,
    title: 'DRP + DRI buffer — what it is doing now',
    tone: tripped || starved ? 'waiting' : st.buffer_t > 0 ? 'busy' : 'idle',
    lines: [
      tripped
        ? `DRP tripped — discharge halted until tick ${st.drp_tripped_until}.`
        : starved
          ? 'DRP running — but the last EAF heat was SKIPPED: DRI buffer short.'
          : 'DRP running — discharging into the DRI buffer.',
      `DRI buffer: ${st.buffer_t.toFixed(1)} t ready for EAF feed.`,
      `Heats charged: ${charged}${skipped ? ` · skipped: ${skipped}` : ''}.`,
    ],
  };
}

// ---- slice1 (berth) — live card over the hub port state ------------------------------
// Wired per Phase-1 finalization report deferred item #1: the hub runs slice1 through
// `slice1_hub.ts` (ops engine wrapped into { tick, events } + OpsState verbatim), so a
// live "berth_queue" card is a pure projection of observable sim state — same approved
// exception as the layout manifest note (ship waiting / unloader busy IS sim state).

export interface S1StateView {
  tick: number;
  day: number;
  yard_stock_t: number;
  berth_ships: Array<{ id: string; on_board_t: number; wait_days: number }>;
  demurrage_usd: number;
  berth_wait_ship_days_beyond_free: number;
  unload_blocked_t: number;
  berth_blocked_t: number;
  congestion_flag: boolean;
}

export function inspectSlice1Slot(slot: SlotDef, state: S1StateView): InspectionCardData {
  if (slot.inspect_key !== 'berth_queue')
    throw new Error(`inspectSlice1Slot: unknown inspect_key '${slot.inspect_key}' (slot ${slot.id})`);
  const ship = state.berth_ships[0] ?? null;
  const lines = [
    `Day ${state.day} · tick ${state.tick}`,
    ship
      ? `Ship ${ship.id} at berth: ${ship.on_board_t.toFixed(1)}t on board, waiting ${ship.wait_days.toFixed(2)} days`
      : 'No ship at berth',
    `Yard stock: ${state.yard_stock_t.toFixed(1)}t`,
    state.berth_blocked_t > 0 ? `Berth refusals logged: ${state.berth_blocked_t.toFixed(1)}t equivalent` : 'Berth open for next arrival',
    state.unload_blocked_t > 0 ? `Unloading blocked: ${state.unload_blocked_t.toFixed(1)}t held on ship` : 'Unloader clear',
    state.demurrage_usd > 0 ? `Demurrage accrued: $${state.demurrage_usd.toFixed(2)} (${state.berth_wait_ship_days_beyond_free.toFixed(2)} ship-days beyond free time)` : 'No demurrage (within free time)',
  ];
  const tone: InspectionCardData['tone'] = ship ? (state.unload_blocked_t > 0 ? 'waiting' : 'busy') : 'idle';
  return { slot_id: slot.id, title: `Berth ${slot.id}`, lines, tone };
}
