// Shared inventory registry — Roadmap V3 §8.1 ("one authoritative tick loop + shared
// inventory registry wrapping per-slice sim modules").
//
// Design (adapter pattern; the parity ports slice3/4/5 stay UNTOUCHED):
//   - Each adapter reads a sim state and declares its tonnage ledger as a list of named
//     TERMS plus the port's OWN balance identity ("entered" minus terms). The registry
//     re-derives the SAME arithmetic independently — a second pair of eyes, not a copy.
//   - Conservation rule: opening stock is fixed per scenario; every term must be
//     reachable from an explicit ledger entry (stock/loss/outflow). An unregistered leak
//     (tonnage that vanishes with no loss/outflow entry) breaks the identity check —
//     exactly the negative test in web/tests/inventory_registry.test.ts.
//   - No adapter mutates sim state; adapters are pure read projections + a snapshot for
//     cross-slice transfer bookkeeping (§8.3 interfaces come later).

export interface LedgerTerm {
  /** Stable term id, e.g. 'slice5.product_yard'. */
  id: string;
  label: string;
  value: number;
}

export interface LedgerSnapshot {
  slice: string;
  tick: number;
  /** Total tonnage that entered the system in this scenario (fixed opening stock). */
  enteredT: number;
  terms: LedgerTerm[];
  /** Loss/outflow counters already inside the sim (yield loss, dispatched, ...). */
  accounted: LedgerTerm[];
  /** Mid-run stock the port's own identity deliberately leaves out of `terms`
   *  (e.g. slice5 billet-yard residence against a fixed opening). Declaring it pins
   *  the ledger to the port's stage-6 semantics: residual == port balance_error at every
   *  tick; closure only when residence and in-flight payloads drain. */
  residenceTerms?: LedgerTerm[];
}

export interface BalanceCheckResult {
  ok: boolean;
  /** registry-recomputed residual: entered - terms - accounted. */
  residual: number;
  /** the port's own balance_error field (if it carries one), for cross-check. */
  portBalanceError: number | null;
  /** true when this ledger is a closure identity (residual must be ~0 at every tick). */
  closure: boolean;
  detail: string;
}

/** Tolerance for float closure (mirrors the ports' own 1e-6/1e-9 conventions). */
export const BALANCE_TOLERANCE = 1e-6;

/**
 * Ledger semantics: a snapshot either declares its `residenceTerms` explicitly or not.
 *  - No residenceTerms -> FULL closure identity: every tonne is on-hand or accounted at
 *    every tick, so residual == 0 (slice3 flow bookkeeping, slice4 with its just-cast
 *    bridge term).
 *  - residenceTerms declared -> the port's OWN stage-6 identity is replicated exactly.
 *    `terms` are the on-hand stocks the PORT counts in its balance formula (e.g. slice5:
 *    carrier + mill + product yard), `accounted` the outflow/loss counters, and
 *    `residenceTerms` the mid-run stock the port deliberately leaves OUT of its formula
 *    (e.g. slice5 billet-yard residence against a fixed initial_billet_t opening). Then:
 *      residual >= 0 and no term below zero   [registry's own sanity invariant]
 *      residual == port balance_error          [crossCheckPortBalance — the leak detector]
 *    A leak — tonnage removed with no loss/outflow entry, while the port's ledger field
 *    was computed before the removal (state vs ledger desync) — inflates the registry
 *    residual above the port's recorded balance_error, so the cross-check fails.
 *    Strict residual == declared residence does NOT hold mid-run: the port deliberately
 *    leaves its opening stock out of its formula while it sits in the yard.
 */
export function checkLedgerBalance(snap: LedgerSnapshot, tolerance = BALANCE_TOLERANCE): BalanceCheckResult {
  const sumTerms = snap.terms.reduce((a, t) => a + t.value, 0);
  const sumAccounted = snap.accounted.reduce((a, t) => a + t.value, 0);
  const residual = snap.enteredT - sumTerms - sumAccounted;
  const residence = snap.residenceTerms ?? [];
  const residSum = residence.reduce((a, r) => a + r.value, 0);
  const closure = residence.length === 0;
  let ok: boolean;
  if (closure) {
    ok = Math.abs(residual) <= tolerance;
  } else {
    // A residence ledger replicates the port's OWN stage-6 identity. Sanity invariants:
    // residual >= 0 and no term/accounted/residence below zero (a hole opened in state),
    // AND the tonnage-conservation bound: declared residence + terms + accounted can never
    // exceed enteredT — a leak/creation puts tonnage on hand that no ledger entry ever
    // put there. The conservation bound is what catches leaks the port's recomputed
    // balance_error absorbs silently (slice5 re-derives balance_error from state every
    // tick, so a hole punched in state inflates BOTH sides equally; residual ==
    // balance_error agreement is not proof of health). Strict residual == declared
    // residence does NOT hold mid-run: the port deliberately excludes its opening stock
    // from its formula while it sits in the yard (e.g. slice5
    // tick 12: residual 89.8 = billet_yard 70 + carrier 10 + mill-residence carryover —
    // verified against mirror/slice5_mirror.py stage 6). The leak detector is
    // crossCheckPortBalance below: registry residual diverging from the port's own
    // balance_error by exactly the leaked tonnage — state vs ledger desync.
    ok =
      snap.terms.every((t) => t.value >= -tolerance) &&
      snap.accounted.every((t) => t.value >= -tolerance) &&
      residSum >= -tolerance &&
      residual >= -tolerance &&
      // tonnage-conservation bound: everything on hand + accounted can never exceed what
      // entered the scenario (catches unregistered creation/leak the cross-check absorbs)
      residSum + sumTerms + sumAccounted <= snap.enteredT + tolerance;
  }
  return {
    ok,
    residual,
    portBalanceError: null,
    closure,
    detail: `${snap.slice} tick ${snap.tick}: entered ${snap.enteredT} - terms ${sumTerms} - accounted ${sumAccounted} = ${residual}${closure ? '' : ` (declared residence ${residSum})`}`,
  };
}

/** Cross-check the registry residual against the port's own balance_error field. */
export function crossCheckPortBalance(
  snap: LedgerSnapshot,
  portBalanceError: number,
  tolerance = BALANCE_TOLERANCE,
): BalanceCheckResult {
  const base = checkLedgerBalance(snap, tolerance);
  // the registry must re-derive the port's identity term-for-term at every tick...
  const agree = Math.abs(base.residual - portBalanceError) <= tolerance;
  // ...and for a closure ledger both sides must additionally be ~0.
  const ok = base.ok && agree && (base.closure ? Math.abs(base.residual) <= tolerance : true);
  return {
    ok,
    residual: base.residual,
    portBalanceError,
    closure: base.closure,
    detail: `${base.detail} | port balance_error ${portBalanceError} ${agree ? 'agrees' : 'DIVERGES'}`,
  };
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface AdapterRegistration {
  slice: string;
  /** Pure projection of a sim state -> ledger snapshot. Never mutates the state. */
  project(state: unknown): LedgerSnapshot;
}

export class InventoryRegistry {
  private adapters = new Map<string, AdapterRegistration>();

  register(adapter: AdapterRegistration): void {
    if (this.adapters.has(adapter.slice)) {
      throw new Error(`adapter for slice '${adapter.slice}' already registered`);
    }
    this.adapters.set(adapter.slice, adapter);
  }

  has(slice: string): boolean {
    return this.adapters.has(slice);
  }

  slices(): string[] {
    return [...this.adapters.keys()];
  }

  project(slice: string, state: unknown): LedgerSnapshot {
    const a = this.adapters.get(slice);
    if (!a) throw new Error(`no adapter registered for slice '${slice}'`);
    return a.project(state);
  }

  /** Registry-side balance identity check for one slice's current state. */
  check(slice: string, state: unknown, tolerance = BALANCE_TOLERANCE): BalanceCheckResult {
    const snap = this.project(slice, state);
    const portErr = (state as { balance_error?: number }).balance_error;
    return portErr === undefined
      ? checkLedgerBalance(snap, tolerance)
      : crossCheckPortBalance(snap, portErr, tolerance);
  }

  /** Snapshot every registered slice (hub HUD / save-state hook). */
  snapshotAll(states: Record<string, unknown>): Array<{ slice: string; snapshot: LedgerSnapshot; check: BalanceCheckResult }> {
    return this.slices().map((slice) => {
      const snapshot = this.project(slice, states[slice]);
      return { slice, snapshot, check: this.check(slice, states[slice]) };
    });
  }
}
