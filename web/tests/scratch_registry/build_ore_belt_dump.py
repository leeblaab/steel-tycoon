# S1.2 ore-belt parity dump — drive the REAL slice1 mirror (operations_domain3_mirror)
# for 60 ticks; each tick's `arrived_t` delta is the belt's yard credit. A deliberate,
# literal Python clone of web/src/shared/ore_belt.ts replays the same chain so the TS
# parity test can compare row-by-row. Same scenario seam as build_slice1_fixture.py
# (seed 11 state, FixedDraws no-fire path); DRP commissions at tick 30 mid-run.
import sys, json
sys.path.insert(0, 'mirror')
import operations_domain3_mirror as m

TICKS = 60
COMMISSION_TICK = 30
RATE_TPH, CHUNK, TRAVEL = 600.0, 25.0, 2

cfg = m.load_ops_config('C:/AI_LAB/SteelX/content/operations/operations_domain3.json')
rng = m.FixedDraws([0.5] * (6 * TICKS))
st = m.fresh_state()
prev_arrived = st['arrived_t']

class Reg:
    def __init__(self):
        self.tick = 0
        self.inv = {}
        self.reserved = {}
        self.in_transit = []

def register(r, i): r.inv[i] = {'usable_t': 0.0}
def depose(r, i, t): r.inv[i]['usable_t'] += t
def avail(r, i): return (r.inv[i]['usable_t'] - r.reserved.get(i, 0.0)) if i in r.inv else 0.0

def transfer(r, f, t, tonnes, travel):
    assert isinstance(travel, int) and travel >= 1
    inv = r.inv[f]
    held = r.reserved.get(f, 0.0)
    e = min(held, tonnes); r.reserved[f] = held - e
    inv['usable_t'] -= tonnes
    r.in_transit.append({'tonnes': tonnes, 'to_id': t, 'arrival_tick': r.tick + travel})

def tick(r):
    r.tick += 1
    still = []
    for rec in r.in_transit:
        if rec['arrival_tick'] <= r.tick:
            r.inv[rec['to_id']]['usable_t'] += rec['tonnes']
        else:
            still.append(rec)
    r.in_transit = still

def plan(av, rate, chunk):
    return int(min(rate, av) // chunk) * chunk if av > 0 else 0

reg = Reg(); register(reg, 'yard_ore'); register(reg, 'ore_buffer')
drp_live = False; commissioned_at = None
rows = []; deposits_total = 0.0

for t in range(1, TICKS + 1):
    st = m.tick_ops(rng, st) or st
    delta = st['arrived_t'] - prev_arrived
    prev_arrived = st['arrived_t']
    if delta > 0:
        depose(reg, 'yard_ore', delta); deposits_total += delta
    tick(reg)  # same order as stepOreBelt: clock first...
    if drp_live:  # ...then drain-if-live (arrival pinned to commission + travel)...
        drain = plan(avail(reg, 'ore_buffer'), RATE_TPH / 24.0, CHUNK)
        if drain > 0:
            due = (commissioned_at or reg.tick) + TRAVEL
            transfer(reg, 'ore_buffer', 'drp_intake', drain, max(1, due - reg.tick))
    load = plan(avail(reg, 'yard_ore'), RATE_TPH / 24.0, CHUNK)  # ...then yard -> buffer
    if load > 0: transfer(reg, 'yard_ore', 'ore_buffer', load, TRAVEL)
    if t == COMMISSION_TICK and not drp_live:
        register(reg, 'drp_intake'); drp_live = True; commissioned_at = reg.tick
    rows.append({'tick': t, 'slice_arrived_t': round(st['arrived_t'], 6),
                 'yard_t': round(reg.inv['yard_ore']['usable_t'], 6),
                 'buffer_t': round(reg.inv['ore_buffer']['usable_t'], 6),
                 'drp_intake_t': round(reg.inv.get('drp_intake', {'usable_t': 0.0})['usable_t'], 6),
                 'in_transit_t': round(sum(x['tonnes'] for x in reg.in_transit), 6)})

closure = sum(v['usable_t'] for v in reg.inv.values()) + sum(x['tonnes'] for x in reg.in_transit)
fixture = {'fixture_id': 'ore_belt_v1', 'schema_version': 1,
           'note': ('slice1 mirror (seed 11 state, FixedDraws no-fire) arrived_t deltas drive '
                    'the belt chain; literal Python clone of ore_belt.ts; DRP commissions at '
                    f'tick {COMMISSION_TICK}'),
           'belt': {'rate_tph': RATE_TPH, 'chunk_t': CHUNK, 'travel_ticks': TRAVEL,
                    'commission_tick': COMMISSION_TICK},
           'tick_count': TICKS, 'rows': rows,
           'deposits_total': round(deposits_total, 6), 'closure_total': round(closure, 6)}
with open('web/tests/scratch_registry/ore_belt_dump.json', 'w') as f:
    json.dump(fixture, f, indent=2)
print('dump written; deposits', round(deposits_total, 3), 'closure', round(closure, 3),
      'final yard/buffer/drp:', rows[-1]['yard_t'], rows[-1]['buffer_t'], rows[-1]['drp_intake_t'])
