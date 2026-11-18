// Scenario seeding for the hub's authoritative tick loop.
//
// The parity ports' `freshState()` returns an EMPTY container (no charges/ladles/orders);
// their `run()` seams seed it before stepping. The hub drives `tick()` directly, so it
// must replicate that seeding exactly — without modifying the ports. These helpers mirror
// the seeding blocks inside slice4/slice5 `run()` verbatim; slice3 seeds nothing (its
// freshState is already runnable).

import * as s3 from '../ports/slice3/shared/slice3_sim.ts';
import * as s4 from '../ports/slice4/shared/slice4_sim.ts';
import * as s5 from '../ports/slice5/shared/slice5_sim.ts';

export function seedSlice3(fx: s3.S3Fixture): s3.SimState {
  return s3.freshState(fx); // freshState is directly runnable for slice3
}

export function seedSlice4(fx: s4.Slice4Fixture): s4.Slice4State {
  const state = s4.freshState(fx);
  for (const ch of fx.scenario.charge_plan) {
    state.charges.push({
      charge_id: ch.charge_id,
      recipe_id: ch.recipe_id,
      grade_composition: ch.composition.map((g) => ({
        grade: g.grade,
        required_usable_t: g.required_usable_t,
        actual_usable_t: g.actual_usable_t,
      })),
      readiness_timestamp: null,
      deadline: ch.deadline_tick,
      status: 'planning',
      failure_cause: null,
    });
  }
  for (const m of fx.scenario.dri_plan) {
    state.dri_materials.push({
      material_id: m.material_id,
      usable_t: m.usable_t,
      quality_metadata: {},
      source: 'DRI buffer',
      readiness_timestamp: m.ready_tick,
      destination: 'EAF feed interface',
      consumed_t: 0.0, // informational only, NOT a balance term (mirrors the port)
    });
  }
  for (let i = 0; i < fx.scenario.ladles; i++) {
    state.ladles.push({
      ladle_id: `L${i + 1}`,
      status: 'free',
      busy_charge_id: null,
      busy_since: null,
      metal_t: 0.0,
      refined: false,
    });
  }
  return state;
}

export function seedSlice5(fx: s5.Slice5Fixture): s5.Slice5State {
  const state = s5.freshState(fx);
  for (const o of fx.scenario.orders) {
    state.orders.push({
      order_id: o.order_id,
      product_grade: o.product_grade,
      required_t: o.required_t,
      deadline_tick: o.deadline_tick,
      dispatched_t: 0.0,
      status: 'open',
      priority: 2, // dispatch orders default priority 2 (competing tasks enter at 1)
    });
  }
  return state;
}
