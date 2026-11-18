// Parity-port adapters for the shared inventory registry (Roadmap V3 §8.1).
// These wrap the three shared parity ports' tonnage ledgers WITHOUT touching the port
// files: each adapter is a pure read projection of the port's state into LedgerSnapshot,
// mirroring the port's OWN balance identity term-for-term so the registry can re-derive
// it independently.

import type { SimState as Slice3State, S3Fixture } from '../ports/slice3/shared/slice3_sim.ts';
import type { Slice4State, Slice4Fixture } from '../ports/slice4/shared/slice4_sim.ts';
import type { Slice5State, Slice5Fixture } from '../ports/slice5/shared/slice5_sim.ts';
import type { Slice1HubState } from '../ports/slice1/slice1_hub.ts';
import type { AdapterRegistration, LedgerSnapshot } from './inventory_registry.ts';

// ---- Slice 1 (berth -> yard -> dispatch) -----------------------------------
// The ops engine has no balance_error field, so this is a full closure identity built
// term-for-term from the engine's own tonnage lines (ops_domain3 tickOps): every tonne
// entering `arrived_t` (ship unload acceptedT + conveyor arrivedThisTick) is either in
// `yard_stock_t` or moved out via `dispatched_t`. The registry re-derives:
//   arrived_t == yard_stock_t + dispatched_t  ->  residual 0 at every tick.

export function slice1Adapter(): AdapterRegistration {
  return {
    slice: 'slice1',
    project(stateUnknown: unknown): LedgerSnapshot {
      const state = stateUnknown as Slice1HubState;
      return {
        slice: 'slice1',
        tick: state.tick,
        enteredT: state.arrived_t,
        terms: [
          { id: 'slice1.yard_stock', label: 'yard stock on hand', value: state.yard_stock_t },
        ],
        accounted: [
          { id: 'slice1.dispatched_total', label: 'dispatched outflow', value: state.dispatched_t },
        ],
      };
    },
  };
}

// ---- Slice 3 (DRP -> buffer -> EAF feed) -----------------------------------
// The slice3 port has NO balance_error field: its ledger is a flow system — every tick's
// discharge that passed the capacity gate enters the buffer; heats take from it. The
// registry-side identity is therefore bookkeeping closure:
//   discharged_total (lots created) == buffer lots on hand + heats charged - skipped(0t)
// We reconstruct discharged_total from the sim's own events ('DRP discharge <x>t' lines),
// which is exactly what the mirror/summarize derives — no new rule.

function slice3DischargedTotal(state: Slice3State): number {
  let total = 0;
  for (const e of state.events) {
    const m = /^DRP discharge (\d+(?:\.\d+)?)t -> buffer/.exec(e.event);
    if (m) total += parseFloat(m[1]);
  }
  return total;
}

export function slice3Adapter(fx: S3Fixture): AdapterRegistration {
  return {
    slice: 'slice3',
    project(stateUnknown: unknown): LedgerSnapshot {
      const state = stateUnknown as Slice3State;
      const onHandLots = state.buffer.reduce((a, l) => a + l.usable_t, 0);
      const charged = state.heats.filter((h) => h.status === 'charged').reduce((a, h) => a + h.usable_t, 0);
      // entered: what the scenario let INTO the buffer ledger (discharge that passed the gate)
      const enteredT = slice3DischargedTotal(state);
      return {
        slice: 'slice3',
        tick: state.tick,
        enteredT,
        terms: [
          { id: 'slice3.buffer_lots_on_hand', label: 'buffer lots on hand', value: onHandLots },
        ],
        accounted: [
          { id: 'slice3.heats_charged_t', label: 'EAF heats charged', value: charged },
        ],
      };
    },
  };
}

// ---- Slice 4 (EAF -> LRF -> CCM -> billet yard) ----------------------------
// Port identity (slice4_sim tick stage 6 / mirror stage 6): entered - yield_loss -
//   ccm_loss - in_ladles - bath - billet_yard == balance_error.
// Same §8.1 uncounted-payload class as slice5's carrier: on the CCM completion tick the
// cast metal leaves ladle.metal_t, and billet_yard_t is only populated at the NEXT
// start-tick branch (billet_yield_pct < 100 keeps it out of ccm_loss_t too). At that
// tick boundary we hold the just-cast tonnage explicitly as a term:
//   justCastT = ladle.metal_t * yield_convention.ccm_billet_yield_pct / 100
//               when ccm.remaining_ticks === ccm_ticks_per_ladle (cast landed this tick).
// In_ladles then counts metal only for ladles not already credited by that term.

export function slice4Adapter(fx: Slice4Fixture): AdapterRegistration {
  return {
    slice: 'slice4',
    project(stateUnknown: unknown): LedgerSnapshot {
      const state = stateUnknown as Slice4State;
      let enteredT = 0;
      for (const ch of state.charges) {
        if (ch.status === 'in_furnace' || ch.status === 'tapped') {
          enteredT += ch.grade_composition.reduce((a, row) => a + row.actual_usable_t, 0);
        }
      }
      const justCast =
        state.ccm.remaining_ticks === fx.scenario.ccm_ticks_per_ladle && state.ccm.busy_ladle_id !== null;
      let justCastT = 0.0;
      let inLadles = 0;
      for (const l of state.ladles) {
        const metal = l.metal_t ?? 0;
        if (justCast && l.ladle_id === state.ccm.busy_ladle_id) {
          justCastT = (metal * fx.yield_convention.ccm_billet_yield_pct) / 100.0;
        } else {
          inLadles += metal;
        }
      }
      return {
        slice: 'slice4',
        tick: state.tick,
        enteredT,
        terms: [
          { id: 'slice4.in_ladles', label: 'metal in ladles', value: inLadles },
          { id: 'slice4.eaf_bath', label: 'EAF bath (residence)', value: state.eaf.bath_t },
          { id: 'slice4.billet_yard', label: 'billet yard', value: state.billet_yard_t },
          { id: 'slice4.just_cast', label: 'just-cast billet (uncounted-payload bridge)', value: justCastT },
        ],
        accounted: [
          { id: 'slice4.yield_loss_t', label: 'EAF yield loss', value: state.counters.yield_loss_t },
          { id: 'slice4.ccm_loss_t', label: 'CCM tundish/dross loss', value: state.counters.ccm_loss_t },
        ],
      };
    },
  };
}

// ---- Slice 5 (billet yard -> rebar mill -> product yard -> dispatch) -------
// Authoritative identity = mirror/slice5_mirror.py stage 6 (read fresh):
//   entered - carrier_in_transit - on_mill - product_yard_t
//     - dispatched_t_total - yield_loss_t == balance_error
// `entered` is the FIXED opening stock (initial_billet_t) — exactly the mirror's
// convention. Mid-run tonnage still sitting in s.billet_yard_t is NOT a stage-6 term,
// which is why the port's own balance_error carries the yard residence mid-run and only
// closes to 0 when the yard has emptied. The registry re-derives the SAME arithmetic
// independently and cross-checks against state.balance_error: identical terms on both
// sides agree at every tick (residual == port balance_error). No bridge terms needed for
// slice5 — unlike slice4's CCM handoff, the port keeps payloads visible at every tick
// boundary (carrier.batch_t while busy; mill.batch_t incremented BEFORE car.batch_t is
// zeroed on the completion tick), so a pure read of state fields reproduces stage 6.
// residenceTerms = billet_yard_t: declared mid-run stock that stage 6 deliberately omits
// from its terms — the residual legitimately CARRIES it mid-run (tick 12: residual 89.8 =
// yard 70 + carrier 10 + mill carryover; tick 46: yard drained but a batch on the mill ->
// balance_error == mill.batch_t). The invariant the registry checks is residual == port
// balance_error at every tick (the cross-check), closure only when residence AND both
// in-flight payloads drain / scenario end.

export function slice5Adapter(fx: Slice5Fixture): AdapterRegistration {
  return {
    slice: 'slice5',
    project(stateUnknown: unknown): LedgerSnapshot {
      const state = stateUnknown as Slice5State;
      return {
        slice: 'slice5',
        tick: state.tick,
        enteredT: fx.scenario.billet_yard.initial_billet_t,
        terms: [
          { id: 'slice5.carrier_in_transit', label: 'carrier in transit', value: state.carrier.batch_t },
          { id: 'slice5.mill_on_mill', label: 'batch on mill', value: state.mill.batch_t },
          { id: 'slice5.product_yard', label: 'product yard', value: state.product_yard_t },
        ],
        accounted: [
          { id: 'slice5.dispatched_t_total', label: 'dispatched outflow', value: state.counters.dispatched_t_total },
          { id: 'slice5.yield_loss_t', label: 'rolling yield loss', value: state.counters.yield_loss_t },
        ],
        residenceTerms: [
          { id: 'slice5.billet_yard_residence', label: 'billet yard residence (not a stage-6 term)', value: state.billet_yard_t },
        ],
      };
    },
  };
}
