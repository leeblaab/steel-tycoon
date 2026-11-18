# Rebuild fixture D1 cleanly from a FRESH state (Yasser GO 2026-10-12).
# Root cause of the old D1: build_fixtures.py used pcm.state AFTER the mirror's
# import-time baseline run (20 heats), so expected_outputs recorded a continuation
# (40 heats) while actions/tick_count recorded only the fixture loop (20) —
# internally inconsistent. This generator builds everything from its own fresh state.
#
# Canonical draw contract applied: 6 draws/tick in fixed asset order, generator
# advanced per tick even though Domain 1 has no RNG in its rule path (determinism
# tuple pins generator state; the fixture documents the contract).
# Scenario length: 20 ticks / 20 heats, action sequence = the mirror's documented
# decision-demo cycle (hms, plate, shredded, mixed) — unchanged from the original.
#
# ONE fresh process, write once, read back ONCE. No re-run, no re-read.

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

import production_core_mirror as pcm

SEED = 11
TICKS = 20
runs = [
    [('hms1_hms2', 'hms', 40.0)],
    [('hms1_hms2', 'plate', 40.0)],
    [('shredded', 'light', 40.0)],
    [('bushing', 'plate', 20.0), ('hms1_hms2', 'hms', 20.0)],
]

# Fresh state constructed HERE — not the module-level state the import already ran.
st = {
    'tick': 0,
    'purchased_t': {g: 0.0 for g in pcm.SCRAP_TIER_PRICE},
    'yard_stock_t': 0.0,
    'handling_loss_t': 0.0,
    'yield_loss_t': 0.0,
    'melted_t': 0.0,
    'ttt_hours_accum': 0.0,
    'ttt_runs': 0,
    'spend_usd': 0.0,
    'condition': 100.0,
    'crew_factor': 1.0,
}
# Point the mirror at OUR fresh state (same dict object the mirror functions use).
pcm.state = st

g = Xorshift32(SEED)
actions = []
for i in range(TICKS):
    cells = runs[i % len(runs)]
    pcm.tick(cells)
    actions.append({"tick": i + 1, "charge_cells": cells})
    for _ in ORDER:
        g.random()

exp = {
    "tick": st['tick'],
    "generator_state": g.state,
    "purchased_t": st['purchased_t'],
    "yard_stock_t": st['yard_stock_t'],
    "handling_loss_t": st['handling_loss_t'],
    "yield_loss_t": st['yield_loss_t'],
    "melted_t": st['melted_t'],
    "ttt_hours_accum": st['ttt_hours_accum'],
    "ttt_runs": st['ttt_runs'],
    "spend_usd": st['spend_usd'],
    "condition": st['condition'],
    "crew_factor": st['crew_factor'],
    "balance_error": pcm.balance_error(),
}

fx = {
    "fixture_id": "d1_scrap_20heats_seed11", "schema_version": 1, "domain": "production_core",
    "prng": "xorshift32", "seed": SEED, "asset_order": ORDER,
    "initial_state": {
        "tick": 0,
        "purchased_t": {g2: 0.0 for g2 in ['bushing', 'hms1_hms2', 'shredded']},
        "yard_stock_t": 0.0, "handling_loss_t": 0.0, "yield_loss_t": 0.0,
        "melted_t": 0.0, "ttt_hours_accum": 0.0, "ttt_runs": 0, "spend_usd": 0.0,
        "condition": 100.0, "crew_factor": 1.0, "generator_state": SEED,
    },
    "actions": actions,
    "tick_order": ["tick_increment", "condition_evolution", "crew_factor",
                   "purchase_to_yard", "charge_from_yard", "handling_loss_by_size",
                   "yield_loss_by_grade", "melt", "tap_to_tap", "generator_advance"],
    "cadence_boundary": "1 tick = 1 heat; no day cadence in Domain 1",
    "tick_count": TICKS,
    "tolerance": {"usd": 0.01, "tonnes": 1e-6, "categorical": "exact"},
    "expected_outputs": exp,
    "status": "active",
    "notes": "REBUILT CLEAN 2026-10-12 (Yasser GO): prior D1 expected_outputs came from the "
             "mirror's import-time baseline run (20 heats) continued by the fixture loop — "
             "40 heats recorded against 20 actions/tick_count, generator_state 120 draws. "
             "This fixture runs 20 ticks from a fresh state; generator advanced 6 draws/tick "
             "in fixed asset order (canonical contract, no rule consumes the draws in D1). "
             "Prior failing run preserved in git history (commit af568c4, DIVERGENCE_REPORT.md). "
             "Draw mapping: uniform(a,b) = a + (b-a)*draw after one xorshift32 step.",
}
path = r'C:\AI_Lab\SteelX\fixtures\production_core\d1_scrap_20heats_seed11.json'
os.makedirs(os.path.dirname(path), exist_ok=True)
with open(path, "w", encoding="utf-8") as f:
    json.dump(fx, f, indent=2)
print("wrote", path)

# Read back ONCE to confirm the recorded values.
back = json.load(open(path, encoding="utf-8"))
print("read-back expected_outputs:", json.dumps(back["expected_outputs"], sort_keys=True))
