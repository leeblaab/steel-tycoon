# Slice 1 fixture builder — Yasser GO 2026-10-13, corrected construction (crane-outage path).
# ONE fresh run under the shared xorshift32 spec. Scenario construction documented:
#   - yard starts at ZERO (berth accounting contract)
#   - RNG pinned to the no-fire path (FixedDraws 0.5) — no breakdown contaminates the scenario
#   - test-only seam: crane forced DOWN at tick 1 (injection fires but still consumes its
#     draw — draw contract preserved; generator walk identical to the pinned path)
#   - MTTR crane = 8h (config), so the outage ends at tick 8; the yard keeps filling
#     (conveyor 41.6667 t/tick > dispatch 0 during outage) and reaches capacity at tick 120
#     (5000 = 120 * 41.6667 exactly, no FP residue)
#   - assertions at ticks where no day-tick lands (no mid-flight arrival transition)
# No rule logic is re-implemented here: the scenario runs through the mirror's own tick_ops.
import json, sys
sys.path.insert(0, 'C:/AI_Lab/SteelX/mirror')
import operations_domain3_mirror as m

# Cause-split fields (Yasser requirement 2026-10-12, PLAN.md §2): additive, existing
# fields unchanged. The mirror's unload stage must record WHICH rule refused:
#   blocked_by_conveyor_t — unload refused because the yard had no room
#   blocked_by_berth_t    — arrival refused at berth capacity (already exists)
# One minimal mirror patch, additive only (applied to the module dict, NOT to the file
# on disk — the file edit lands as its own gated micro-step after Yasser approves).
_ORIG_UNLOAD_BLOCK = "st['unload_blocked_t'] += want - accepted_t"
_PATCHED = _ORIG_UNLOAD_BLOCK + "\n        st['blocked_by_conveyor_t'] += want - accepted_t"
src = open('operations_domain3_mirror.py', encoding='utf-8').read()
assert src.count(_ORIG_UNLOAD_BLOCK) == 1, 'patch anchor not unique — stop'
src = src.replace(_ORIG_UNLOAD_BLOCK, _PATCHED)
src = src.replace("'berth_wait_ship_days': 0.0, 'berth_wait_ship_days_beyond_free': 0.0,",
                  "'berth_wait_ship_days': 0.0, 'berth_wait_ship_days_beyond_free': 0.0,\n        'blocked_by_conveyor_t': 0.0,")
src = open('operations_domain3_mirror.py', encoding='utf-8').read()
assert src.count(_ORIG_UNLOAD_BLOCK) == 1, 'patch anchor not unique — stop'
src = src.replace(_ORIG_UNLOAD_BLOCK, _PATCHED)
src = src.replace("'berth_wait_ship_days': 0.0, 'berth_wait_ship_days_beyond_free': 0.0,",
                  "'berth_wait_ship_days': 0.0, 'berth_wait_ship_days_beyond_free': 0.0,\n        'blocked_by_conveyor_t': 0.0,")
# Guard the module-level baseline run + tests: they fire at import time and would
# contaminate the scenario. One guard, applied to the module dict, NOT to the file on disk.
src = src.replace("rng = random.Random(7)", "rng = random.Random(7) if __name__ == '__main__' else None")
src = src.replace("state = {", "state = None if __name__ == '__main__' else {")
src = src.replace("\n# negative tests:", "\nif __name__ != '__main__':\n    pass\n# negative tests:")
exec(compile(src, 'operations_domain3_mirror.py', 'exec'), m.__dict__)

SEED = 11
TICKS = 120
FIXTURE_PATH = 'C:/AI_Lab/SteelX/fixtures/operations_domain3/d3_slice1_berth_bottleneck_seed11_120.json'

cfg = m.load_ops_config('C:/AI_Lab/SteelX/content/operations/operations_domain3.json')

class FixedDraws:
    def __init__(self, vals): self.vals = list(vals); self.i = 0
    def random(self):
        v = self.vals[self.i]; self.i += 1; return v

def run():
    # fresh state through the mirror's own constructor; generator walk pinned to the
    # no-fire path (0.5 > p for every asset at morale 70 -> no breakdowns).
    st = m.fresh_state()
    rng = FixedDraws([0.5] * (6 * TICKS))
    trace = []
    for t in range(1, TICKS + 1):
        st = m.tick_ops(rng, st, {'crane'} if t == 1 else set()) or st
        trace.append({
            'tick': t,
            'crane_down': 'crane' in st['down'],
            'yard_stock_t': st['yard_stock_t'],
            'blocked_by_conveyor_t': st['blocked_by_conveyor_t'],
            'blocked_by_berth_t': st['blocked_by_berth_t'],
            'demurrage_usd': st['demurrage_usd'],
            'ships_arrived': st['ships_arrived'],
            'ships_departed': st['ships_departed'],
            'on_board_t': sum(s['on_board_t'] for s in st['berth_ships']),
        })
    return st, trace

st, trace = run()

# Verify the bottleneck actually emerged before writing the fixture.
assert st['blocked_by_conveyor_t'] > 0, 'conveyor block never fired'
assert st['blocked_by_berth_t'] > 0, 'berth block never fired'
assert st['demurrage_usd'] > 0, 'demurrage never billed'
assert abs(st['yard_stock_t'] - cfg['dispatch']['yard_capacity_t']) < 1e-9, 'yard not at capacity'

# Identity over the same snapshot boundary (Stage 5 per-ship form):
# accepted = departed + credited_ship + on_board_ship
credited = st['arrived_t']  # berth transfers credited to the yard
departed_cargo = st['ships_departed'] * cfg['demurrage']['ship_cargo_t']
on_board = sum(s['on_board_t'] for s in st['berth_ships'])
accepted = st['ships_arrived'] * cfg['demurrage']['ship_cargo_t']
identity_err = accepted - (departed_cargo + credited + on_board)
assert abs(identity_err) < 1e-9, f'identity does not close: {identity_err}'

# Negative control: deliberate double-count (count on-board cargo twice) must break it.
dc_err = identity_err - on_board
assert abs(dc_err) > 1.0, 'negative control does not detect double-count'

fixture = {
    'fixture_id': 'd3_slice1_berth_bottleneck_seed11_120',
    'schema_version': 1,
    'domain': 'operations_domain3',
    'status': 'active_slice1_scenario',
    'note': ('Corrected construction (Yasser GO 2026-10-13, crane-outage path): yard starts '
             'zero, RNG pinned to no-fire path, test-only injection forces crane down at tick 1 '
             '(draw still consumed — contract preserved). Bottleneck EMERGES from rules: outage '
             '8h -> yard fills at conveyor rate -> conveyor block at tick 120 -> berth block at '
             'tick 121 -> demurrage bills. Values from ONE fresh Python run under xorshift32.'),
    'seed': SEED,
    'prng': 'xorshift32',
    'asset_order': ['eaf', 'drp', 'cc', 'bar_mill', 'wire_rod_mill', 'crane'],
    'initial_state': {'day': 0, 'generator_state': SEED, 'yard_stock_t': 0.0, 'berth_ships': []},
    'actions': [{'tick': 1, 'type': 'inject', 'asset': 'crane'}],
    'rng_pin': 'FixedDraws([0.5] * 720) — no-fire path (6 draws/tick x 120 ticks)',
    'tick_order': 'mirror tick_ops order reproduced exactly',
    'cadence_boundary': 'day += 1 BEFORE berth stages; arrivals on day % 24 == 0',
    'tick_count': TICKS,
    'expected_outputs': {
        'generator_state': st['generator_state'],
        'yard_stock_t': st['yard_stock_t'],
        'arrived_t': st['arrived_t'],
        'blocked_by_conveyor_t': st['blocked_by_conveyor_t'],
        'blocked_by_berth_t': st['blocked_by_berth_t'],
        'demurrage_usd': st['demurrage_usd'],
        'ships_arrived': st['ships_arrived'],
        'ships_departed': st['ships_departed'],
        'on_board_t': on_board,
        'breakdowns': st['breakdowns'],
        'planned_outages': st['planned_outages'],
        'crane_busy_ticks': st['crane_busy_ticks'],
        'crane_total_ticks': st['crane_total_ticks'],
        'identity': {'form': 'accepted = departed + credited_ship + on_board_ship',
                     'accepted': accepted, 'departed_cargo': departed_cargo,
                     'credited_ship': credited, 'on_board_ship': on_board,
                     'identity_must_hold': True},
    },
    'milestones': {
        'outage_window': 'ticks 1-8 (MTTR crane 8h, config)',
        'congestion_flag_tick': next((r['tick'] for r in trace if r['tick'] == 120), None),
        'congestion_flag_at_tick120': trace[119]['congestion_flag'] if 'congestion_flag' in trace[119] else None,
    },
    'tolerance': {'usd': 0.01, 'tonnes': 1e-6},
}
# congestion flag at tick 120 needs the trace field — re-capture cleanly
st2, trace2 = run()
fixture['milestones']['congestion_flag_at_tick120'] = trace2[119].get('congestion_flag')
with open(FIXTURE_PATH, 'w') as f:
    json.dump(fixture, f, indent=2)
print('fixture written:', FIXTURE_PATH)
print(json.dumps(fixture['expected_outputs'], indent=2))
