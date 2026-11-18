# Clean rebuild of the D2 fixture: replay from a FRESH state (no continuation of the
# mirror's own baseline run). One run, then the fixture is final.
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

import economics_domain2_mirror as ed2

seed = 42
g = Xorshift32(seed)
st = {
    'day': 0, 'sales_index': 1.0, 'orders': [], 'fulfilled_t': 0.0, 'revenue_usd': 0.0,
    'late_penalty_usd': 0.0, 'unsold_t': 0.0, 'downgrades': {'prime': 0, 'secondary': 0, 'prompt': 0},
    'dispatched_t': 0.0, 'utilities_usd': 0.0, 'production_t': {},
}
# Point the mirror's module-level state at our fresh dict so its functions operate on it.
ed2.state = st

actions = []
for spec in [('B500B', 5000, 10, 'forward'), ('SG-2_special', 2000, 15, 'spot'), ('CQ_high_strength', 3000, 12, 'spot')]:
    o = ed2.add_order(spec[0], spec[1], spec[2], mode=spec[3])
    actions.append({"tick": 0, "type": "add_order", "grade": spec[0], "tonnage": spec[1], "due_day": spec[2], "mode": spec[3]})

for day in range(1, 31):
    st['day'] = day
    ed2.step_index(g)
    actions.append({"tick": day, "type": "step_index", "draws": 2})
    ed2.dispatch('B500B', 400, cu=0.1225, sn=0.0245)
    actions.append({"tick": day, "type": "dispatch", "grade": "B500B", "tonnes": 400, "cu": 0.1225, "sn": 0.0245})
    if day % 7 == 0:
        ed2.dispatch('CQ_high_strength', 200, cu=0.13, sn=0.03)
        actions.append({"tick": day, "type": "dispatch", "grade": "CQ_high_strength", "tonnes": 200, "cu": 0.13, "sn": 0.03})
    if day % 11 == 0:
        ed2.dispatch('SG-2_special', 150, cu=0.30, sn=0.06)
        actions.append({"tick": day, "type": "dispatch", "grade": "SG-2_special", "tonnes": 150, "cu": 0.30, "sn": 0.06})

expected = {
    "day": st['day'], "sales_index": st['sales_index'], "generator_state": g.state,
    "revenue_usd": st['revenue_usd'], "late_penalty_usd": st['late_penalty_usd'],
    "fulfilled_t": st['fulfilled_t'], "unsold_t": st['unsold_t'],
    "dispatched_t": st['dispatched_t'], "utilities_usd": st['utilities_usd'],
    "downgrades": st['downgrades'],
    "orders": [{"id": o['id'], "mode": o['mode'], "status": o['status'],
                "grade": o['grade'], "tonnage": o['tonnage'], "due_day": o['due_day'],
                "sign_index": o['sign_index']} for o in st['orders']],
    "balance_identity": abs(st['dispatched_t'] - (st['fulfilled_t'] + st['unsold_t'])) < 1e-6,
}

fx = {
    "fixture_id": "d2_econ_30days_seed42", "schema_version": 1, "domain": "economics_domain2",
    "prng": "xorshift32", "seed": seed, "asset_order": ORDER,
    "initial_state": {**st, "generator_state": seed, "orders": []},
    "actions": actions,
    "tick_order": ["sales_index_step", "dispatch"],
    "cadence_boundary": "day increments once per tick (1 tick = 1 day in this domain fixture)",
    "tick_count": 30,
    "tolerance": {"usd": 0.01, "tonnes": 1e-6, "categorical": "exact"},
    "expected_outputs": expected,
    "status": "active",
    "notes": "Clean rebuild (2026-10-12): replay from fresh state, 3 orders, no continuation of "
             "the mirror's own baseline run. step_index consumes exactly 2 draws per call "
             "(uniform then random); uniform(a,b) = a + (b-a)*draw. Grade assignment reused from "
             "grade_pricing_mirror (config: content/prices/price_ladder_draft.json). "
             "Re-baselined under xorshift32 (legacy Mersenne walk superseded).",
}
path = r'C:\AI_Lab\SteelX\fixtures\economics_domain2\d2_econ_30days_seed42.json'
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as f:
    json.dump(fx, f, indent=2)
print("wrote", path)
print(json.dumps(expected, indent=1))
