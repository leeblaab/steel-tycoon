# Isolated investigation — Yasser authorization 2026-10-13, NO source edits.
# Steps (per Yasser):
#  1. Scenario from a fresh state + explicit draw provider, no import-time state reliance.
#  2. Reproduce the three recorded berth failures independently under existing mirror logic.
#  3. Check whether the failures disappear when the scenario starts from the intended state.
#  4. Confirm the precise meaning of unload_blocked_t and where a cause-specific counter
#     would increment — by READING the code, not by patching it.
# The mirror's import-time baseline run is unavoidable here (it IS the module); the scenario
# runs AFTER import on its own fresh state + own provider, so it cannot inherit the
# baseline's RNG walk or state. One run, then the result is in hand.
import json, sys
sys.path.insert(0, 'C:/AI_Lab/SteelX/mirror')
import operations_domain3_mirror as m

cfg, errs = m.load_ops_config('C:/AI_Lab/SteelX/content/operations/operations_domain3.json')
assert not errs, 'config validation failed'

class FixedDraws:
    def __init__(self, vals): self.vals = list(vals); self.i = 0
    def random(self):
        v = self.vals[self.i]; self.i += 1; return v

# ---- Step 4: precise meaning of unload_blocked_t, read from the live code ----
src = open('operations_domain3_mirror.py', encoding='utf-8').read()
lines = src.splitlines()
print('=== unload_blocked_t semantics (live code) ===')
for i, ln in enumerate(lines):
    if 'unload_blocked_t' in ln:
        print(f'{i+1}: {ln}')
print()

# ---- Step 1: clean scenario replay (crane-outage construction) ----
SEED, TICKS = 11, 120
st = m.fresh_state()
rng = FixedDraws([0.5] * (6 * TICKS))
trace = []
for t in range(1, TICKS + 1):
    m.tick_ops(rng, st, {'crane'} if t == 1 else set())
    trace.append({'tick': t, 'yard': st['yard_stock_t'],
                  'unload_blocked_t': st['unload_blocked_t'],
                  'berth_blocked_t': st['berth_blocked_t'],
                  'demurrage_usd': st['demurrage_usd'],
                  'on_board_t': sum(s['on_board_t'] for s in st['berth_ships']),
                  'crane_down': 'crane' in st['down']})

def first(pred): return next((r['tick'] for r in trace if pred(r)), None)
print('=== clean replay (fresh state + explicit provider) ===')
print('crane outage window: ticks 1-8 (MTTR 8h, config)')
print('yard at capacity (5000) first reached at tick:', first(lambda r: abs(r['yard'] - 5000) < 1e-9))
print('first unload block (unload_blocked_t > 0):', first(lambda r: r['unload_blocked_t'] > 0))
print('first berth block (berth_blocked_t > 0):', first(lambda r: r['berth_blocked_t'] > 0))
print('first demurrage billing:', first(lambda r: r['demurrage_usd'] > 0))
print('final:', {k: st[k] for k in ('yard_stock_t','unload_blocked_t','berth_blocked_t',
                                    'demurrage_usd','ships_arrived','ships_departed')})
print('on board at tick 120:', round(sum(s['on_board_t'] for s in st['berth_ships']), 4))

# Identity over the same snapshot boundary (Stage 5 per-ship form)
credited = st['arrived_t']
departed_cargo = st['ships_departed'] * cfg['BERTH']['ship_cargo_t']
on_board = sum(s['on_board_t'] for s in st['berth_ships'])
accepted = st['ships_arrived'] * cfg['BERTH']['ship_cargo_t']
identity_err = accepted - (departed_cargo + credited + on_board)
print('identity closes:', abs(identity_err) < 1e-9, f'(err {identity_err:.10f})')

# ---- Step 2/3: reproduce the three recorded failures as written, then from intended state ----
print()
print('=== recorded failures, reproduced independently (existing mirror logic) ===')
# As recorded (fixture d3_berth_tests_as_recorded_seed11_72): helper construction,
# yard pre-filled 5000, berth_only flag, FixedDraws no-fire path, 72 ticks.
st2 = m.berth_only_state()
rng2 = FixedDraws([0.5] * 2400)
for t in range(1, 73):
    m.tick_ops(rng2, st2)
print('as-written at tick 48/72:', {k: st2[k] for k in ('berth_blocked_t','unload_blocked_t')},
      'yard', st2['yard_stock_t'], 'on_board', round(sum(s['on_board_t'] for s in st2['berth_ships']), 4))
# Intended state (yard zero, no helper flag): same cadence, same provider.
st3 = m.fresh_state()
rng3 = FixedDraws([0.5] * 2400)
for t in range(1, 73):
    m.tick_ops(rng3, st3)
print('intended state at tick 48/72:', {k: st3[k] for k in ('berth_blocked_t','unload_blocked_t')},
      'yard', st3['yard_stock_t'], 'on_board', round(sum(s['on_board_t'] for s in st3['berth_ships']), 4))
print()
print('Conclusion pending Yasser: whether the three failures are import-time contamination,')
print('helper construction, or genuine accounting — decided from the numbers above.')
