# Build the three remaining domain fixtures under the LOCKED format, running the LIVE
# mirrors under the shared xorshift32 spec in ONE fresh process. Single-owner: fixtures
# and the harness base are built here (TS core + parity harness must not be parallelized);
# subagents only own their port files.
#
# Canonical mapping documented for all sides:
#   uniform(a, b) = a + (b - a) * draw, where draw = state / 0xFFFFFFFF after one
#   xorshift32 step. This is the ONLY mapping the mirrors use (rng.uniform / rng.random).

import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ORDER = ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane']

class Xorshift32:
    def __init__(self, seed):
        x = seed & 0xFFFFFFFF
        if x == 0:
            raise ValueError("zero generator state rejected")
        self.state = x
    def random(self):
        x = self.state
        x ^= (x << 13) & 0xFFFFFFFF
        x ^= (x >> 17)
        x ^= (x << 5) & 0xFFFFFFFF
        self.state = x & 0xFFFFFFFF
        return self.state / 0xFFFFFFFF
    def uniform(self, a, b):
        return a + (b - a) * self.random()

FIX_DIR = r'C:\AI_Lab\SteelX\fixtures'
TOL = {"usd": 0.01, "tonnes": 1e-6, "categorical": "exact"}
TICK_ORDER = ["day_increment", "wages", "operating_hours_and_breakdowns",
              "planned_shutdown", "production", "crane_utilization",
              "berth_arrive", "berth_wait", "berth_unload_depart", "dispatch_chain"]
CADENCE = "day += 1 BEFORE berth stages; berth arrivals on day % 24 == 0"

def write_fixture(domain, fid, seed, initial_state, actions, tick_count, expected, status, notes):
    fx = {
        "fixture_id": fid, "schema_version": 1, "domain": domain,
        "prng": "xorshift32", "seed": seed, "asset_order": ORDER,
        "initial_state": initial_state, "actions": actions,
        "tick_order": TICK_ORDER, "cadence_boundary": CADENCE,
        "tick_count": tick_count, "tolerance": TOL,
        "expected_outputs": expected, "status": status, "notes": notes,
    }
    d = os.path.join(FIX_DIR, domain)
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, fid + ".json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fx, f, indent=2)
    print("wrote", path)

# ---- Domain 1: production core (no RNG in the mirror's rule path; generator state
# pinned for the determinism tuple; rng_uniform_mapping documented) ----
import production_core_mirror as pcm
st1 = pcm.state  # mirror module state; fresh at import
seed1 = 11
g1 = Xorshift32(seed1)
runs = [
    [('hms1_hms2', 'hms', 40.0)],
    [('hms1_hms2', 'plate', 40.0)],
    [('shredded', 'light', 40.0)],
    [('bushing', 'plate', 20.0), ('hms1_hms2', 'hms', 20.0)],
]
for i in range(20):
    pcm.tick(runs[i % len(runs)])
    # generator advances per documented contract (6 draws/tick); no rule consumes it
    for _ in ORDER:
        g1.random()
exp1 = {
    "tick": st1['tick'],
    "generator_state": g1.state,
    "purchased_t": st1['purchased_t'],
    "yard_stock_t": st1['yard_stock_t'],
    "handling_loss_t": st1['handling_loss_t'],
    "yield_loss_t": st1['yield_loss_t'],
    "melted_t": st1['melted_t'],
    "ttt_hours_accum": st1['ttt_hours_accum'],
    "ttt_runs": st1['ttt_runs'],
    "spend_usd": st1['spend_usd'],
    "condition": st1['condition'],
    "crew_factor": st1['crew_factor'],
    "balance_error": pcm.balance_error(),
}
write_fixture("production_core", "d1_scrap_20heats_seed11", seed1,
    {"tick": 0, "purchased_t": {g: 0.0 for g in ['bushing', 'hms1_hms2', 'shredded']},
     "yard_stock_t": 0.0, "handling_loss_t": 0.0, "yield_loss_t": 0.0,
     "melted_t": 0.0, "ttt_hours_accum": 0.0, "ttt_runs": 0, "spend_usd": 0.0,
     "condition": 100.0, "crew_factor": 1.0, "generator_state": seed1},
    [{"tick": i + 1, "charge_cells": runs[i % len(runs)]} for i in range(20)],
    20, exp1, "active",
    "Domain 1 has no RNG in its rule path; generator state pinned for the determinism "
    "tuple. Charge-cell action sequence reproduced exactly (runs cycle, 20 heats). "
    "Config source: content/scrap/scrap_tiers.json + content/nodes/nodes_phase1.json.")

# ---- Domain 2: economics (sales-index walk under xorshift32) ----
import economics_domain2_mirror as ed2
seed2 = 42
g2 = Xorshift32(seed2)
st2 = ed2.state
ed2.add_order('B500B', 5000, due_day=10, mode='forward')
ed2.add_order('SG-2_special', 2000, due_day=15, mode='spot')
ed2.add_order('CQ_high_strength', 3000, due_day=12, mode='spot')
actions2 = [{"tick": 0, "type": "add_order", "grade": "B500B", "tonnage": 5000, "due_day": 10, "mode": "forward"},
            {"tick": 0, "type": "add_order", "grade": "SG-2_special", "tonnage": 2000, "due_day": 15, "mode": "spot"},
            {"tick": 0, "type": "add_order", "grade": "CQ_high_strength", "tonnage": 3000, "due_day": 12, "mode": "spot"}]
for day in range(1, 31):
    st2['day'] = day
    # step_index consumes exactly 2 draws per call (uniform + random) — documented contract
    before = g2.state
    ed2.step_index(g2)
    actions2.append({"tick": day, "type": "step_index", "draws": 2})
    ed2.dispatch('B500B', 400, cu=0.1225, sn=0.0245)
    actions2.append({"tick": day, "type": "dispatch", "grade": "B500B", "tonnes": 400, "cu": 0.1225, "sn": 0.0245})
    if day % 7 == 0:
        ed2.dispatch('CQ_high_strength', 200, cu=0.13, sn=0.03)
        actions2.append({"tick": day, "type": "dispatch", "grade": "CQ_high_strength", "tonnes": 200, "cu": 0.13, "sn": 0.03})
    if day % 11 == 0:
        ed2.dispatch('SG-2_special', 150, cu=0.30, sn=0.06)
        actions2.append({"tick": day, "type": "dispatch", "grade": "SG-2_special", "tonnes": 150, "cu": 0.30, "sn": 0.06})
exp2 = {
    "day": st2['day'], "sales_index": st2['sales_index'], "generator_state": g2.state,
    "revenue_usd": st2['revenue_usd'], "late_penalty_usd": st2['late_penalty_usd'],
    "fulfilled_t": st2['fulfilled_t'], "unsold_t": st2['unsold_t'],
    "dispatched_t": st2['dispatched_t'], "utilities_usd": st2['utilities_usd'],
    "downgrades": st2['downgrades'],
    "orders": [{"id": o['id'], "mode": o['mode'], "status": o['status'],
                "grade": o['grade'], "tonnage": o['tonnage'], "due_day": o['due_day'],
                "sign_index": o['sign_index']} for o in st2['orders']],
    "balance_identity": abs(st2['dispatched_t'] - (st2['fulfilled_t'] + st2['unsold_t'])) < 1e-6,
}
write_fixture("economics_domain2", "d2_econ_30days_seed42", seed2,
    {"day": 0, "sales_index": 1.0, "orders": [], "fulfilled_t": 0.0, "revenue_usd": 0.0,
     "late_penalty_usd": 0.0, "unsold_t": 0.0, "downgrades": {"prime": 0, "secondary": 0, "prompt": 0},
     "dispatched_t": 0.0, "utilities_usd": 0.0, "production_t": {}, "generator_state": seed2},
    actions2, 30, exp2, "active",
    "Draw contract for the sales-index walk: step_index consumes exactly 2 draws per call "
    "(uniform then random), in fixed order. uniform(a,b) = a + (b-a)*draw. QC ladder and "
    "grade assignment reused from grade_pricing_mirror (config: content/prices). "
    "Re-baselined under xorshift32 (legacy Mersenne walk superseded).")

# ---- Domain 4: sustainability (no RNG; deterministic config-driven flows) ----
import sustainability_domain4_mirror as d4
seed4 = 101
g4 = Xorshift32(seed4)
st4 = d4.fresh_state()
for t in range(1, 11):
    d4.tick_sustainability(g4, st4)
    for _ in ORDER:
        g4.random()  # contract: 6 draws/tick even for no-RNG domains (pinned for replay)
exp4 = {
    "tick": st4['tick'], "generator_state": g4.state,
    "inputs_t": st4['inputs_t'], "products_t": st4['products_t'],
    "byproducts_t": st4['byproducts_t'], "losses_t": st4['losses_t'],
    "inventory_delta_t": st4['inventory_delta_t'],
    "byproduct_tons": st4['byproduct_tons'],
    "byproduct_revenue_usd": st4['byproduct_revenue_usd'],
    "byproduct_handling_cost_usd": st4['byproduct_handling_cost_usd'],
    "carbon_tax_usd": st4['carbon_tax_usd'],
    "green_bonus_usd": st4['green_bonus_usd'], "green_penalty_usd": st4['green_penalty_usd'],
    "green_premium_usd": st4['green_premium_usd'], "rec_revenue_usd": st4['rec_revenue_usd'],
    "emissions_t_co2": st4['emissions_t_co2'], "green_flag": st4['green_flag'],
    "energy_kpi_before_gj": st4['energy_kpi_before_gj'],
    "energy_kpi_after_gj": st4['energy_kpi_after_gj'],
    "recovered_energy_gj": st4['recovered_energy_gj'],
    "phantom_energy_in_material_balance": st4['phantom_energy_in_material_balance'],
    "balance_error": d4.balance_error(st4),
}
write_fixture("sustainability_domain4", "d4_sustain_10ticks_seed101", seed4,
    {k: (dict(v) if isinstance(v, dict) else v) for k, v in st4.items()},
    [], 10, exp4, "active",
    "Domain 4 has no RNG in its rule path (deterministic config-driven flows); generator "
    "state pinned for the determinism tuple. Energy ledger separate from material balance; "
    "phantom-energy guard must stay 0.0. Config: content/sustainability/sustainability_domain4.json.")

print("\nfixture expected values:")
print("D1:", json.dumps(exp1, indent=1))
print("D2:", json.dumps(exp2, indent=1))
print("D4:", json.dumps(exp4, indent=1))
