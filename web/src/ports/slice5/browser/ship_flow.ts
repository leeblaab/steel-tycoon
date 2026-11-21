// S5.5 — shipment-stage visuals: PURE projections of TickRecord data (rule 5: no RNG,
// no clocks, no new state). Two channels:
//  1) finishedYardView — strapped-bundle count in the product yard, per-tick. Same floor
//     division as productYardView (slice5_sim.ts / slice5_mirror.py): units = floor(t/unit_t),
//     loose remainder stays tonnage. Presentation view, never an inventory split (F-08).
//  2) weighbridge ticket — the truck's load is already known per move from
//     buildDispatchMoves() (tonnage delta recorded at move start); the weighbridge is a
//     presentation beat at the dock end of that same move, not a new rule.

// Bundle unit mass: fixture product_routes.rebar.bundle_t = 2.0 t (~2-3 t industry band,
// design midpoint; sme_pending). Browser SCENARIO omits the optional block — routesOf()
// heals it to DEFAULT_PRODUCT_ROUTES (slice5_sim.ts), whose rebar bundle_t is this value.
export const BUNDLE_T = 2.0;

// Max bundle props shown in the yard (presentation cap; InstancedMesh count). The fixture
// never exceeds ~4 bays x a handful, but mobile budgets stay bounded regardless of scenario.
export const MAX_BUNDLE_PROPS = 28;

export interface YardBundles {
  units: number;      // floor(product_yard_t / BUNDLE_T)
  loose_t: number;    // yard_t - units * BUNDLE_T (shown as one partial stack iff > 0.5)
}

/** Pure per-tick finished-yard projection (mirrors productYardView unit math). */
export function yardBundles(productYardT: number): YardBundles {
  const units = Math.floor(productYardT / BUNDLE_T);
  return { units, loose_t: productYardT - units * BUNDLE_T };
}

/** Weighbridge ticket for the dispatch move starting at `startIdx`: the same tonnage the
 *  sim already assigned to that move (buildDispatchMoves), surfaced as a load cell read. */
export function weighbridgeTicket(moveTonnage: number): string {
  return `${moveTonnage.toFixed(1)} t`;
}
