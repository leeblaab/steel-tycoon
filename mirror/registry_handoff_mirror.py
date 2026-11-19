# S1.1 registry primitives mirror (PLAN_FORGED Stage 1 / F cross-slice transfers):
# transfer / reserve / release + in_transit ledger with arrival_tick. Pure state-in/state-out,
# never same-tick teleport, ledger closure 1e-6 t (D-02). No RNG: deterministic rules only.
"""Registry handoff mirror: inventories + reservations + in-transit ledger."""
import json

TOL = 1e-6  # D-02 ledger closure tolerance (tonnes)


# ---------- state construction ----------

def fresh_state():
    return {
        'tick': 0,
        'inventories': {},   # inventory_id -> {'usable_t': float}
        'reserved': {},      # inventory_id -> earmarked t (accounting-only, D: never physical)
        'in_transit': [],    # [{'transfer_id','material','from_id','to_id','tonnes','depart_tick','arrival_tick'}]
        'events': [],
    }


def _copy(state):
    return json.loads(json.dumps(state))


def _ev(s, msg):
    s['events'].append({'tick': s['tick'], 'event': msg})


def _avail(s, inv_id):
    """usable minus earmarked — the quantity a new transfer/reserve may claim."""
    inv = s['inventories'].get(inv_id)
    if inv is None:
        return 0.0
    return inv['usable_t'] - s['reserved'].get(inv_id, 0.0)


# ---------- primitives (called at decision time; mutate nothing of the caller's) ----------

def register_inventory(state, inv_id):
    s = _copy(state)
    if inv_id in s['inventories']:
        raise ValueError(f"inventory {inv_id!r} already registered")
    s['inventories'][inv_id] = {'usable_t': 0.0}
    return s


def deposit(state, inv_id, tonnes):
    """Test/scenario helper for stock arrival (berth credit, production). Positive only."""
    if tonnes <= 0:
        raise ValueError('deposit must be positive')
    s = _copy(state)
    if inv_id not in s['inventories']:
        raise ValueError(f'unknown inventory {inv_id!r}')
    s['inventories'][inv_id]['usable_t'] += tonnes
    return s


def reserve(state, inv_id, tonnes, reason):
    """Earmark accounting-only against usable_t. Fails (returns state unchanged + event)
    if the un-earmarked quantity is short — never partial, never negative."""
    if tonnes <= 0:
        raise ValueError('reserve must be positive')
    s = _copy(state)
    if inv_id not in s['inventories']:
        _ev(s, f'reserve refused {inv_id!r} {tonnes}t ({reason}): unknown inventory')
        return s
    if tonnes > _avail(s, inv_id) + TOL:
        _ev(s, f'reserve refused {inv_id!r} {tonnes}t ({reason}): short (available {_avail(s, inv_id)}t)')
        return s
    s['reserved'][inv_id] = s['reserved'].get(inv_id, 0.0) + tonnes
    return s


def release(state, inv_id, tonnes):
    """Give back an earmark. Fails if it would take reservations negative."""
    if tonnes <= 0:
        raise ValueError('release must be positive')
    s = _copy(state)
    held = s['reserved'].get(inv_id, 0.0)
    if tonnes > held + TOL:
        _ev(s, f'release refused {inv_id!r} {tonnes}t: only {held}t earmarked')
        return s
    s['reserved'][inv_id] = held - tonnes
    return s


def transfer(state, from_id, to_id, tonnes, travel_ticks):
    """Two-phase handoff. Commits the tonnage (consumes usable_t AND its earmark if
    reserved; unreserved tonnes move directly) and opens an in_transit record with
    arrival_tick = now + travel_ticks. Nothing appears at to_id until that tick."""
    if tonnes <= 0:
        raise ValueError('transfer must be positive')
    if not isinstance(travel_ticks, int) or travel_ticks < 1:
        raise ValueError('travel_ticks must be an integer >= 1 (never same-tick teleport)')
    s = _copy(state)
    for inv_id in (from_id, to_id):
        if inv_id not in s['inventories']:
            _ev(s, f'transfer refused {from_id!r}->{to_id!r} {tonnes}t: unknown inventory {inv_id!r}')
            return s
    if from_id == to_id:
        _ev(s, f'transfer refused {tonnes}t: from == to ({from_id!r})')
        return s
    inv = s['inventories'][from_id]
    held = s['reserved'].get(from_id, 0.0)
    if tonnes > inv['usable_t'] + TOL:
        _ev(s, f'transfer refused {from_id!r}->{to_id!r} {tonnes}t: usable short ({inv["usable_t"]}t)')
        return s
    # consume earmark first (reserved tonnes are the ones a task is allowed to move)
    from_earmark = min(held, tonnes)
    s['reserved'][from_id] = held - from_earmark
    inv['usable_t'] -= tonnes
    tid = f"T{s['tick']}:{from_id}->{to_id}"
    s['in_transit'].append({
        'transfer_id': tid,
        'from_id': from_id, 'to_id': to_id,
        'tonnes': tonnes,
        'depart_tick': s['tick'],
        'arrival_tick': s['tick'] + travel_ticks,
    })
    _ev(s, f'transfer {tid} {tonnes:g}t departs ({travel_ticks}t travel)')
    return s


# ---------- tick: advance clock, land arrivals whose arrival_tick has come ----------

def tick(state):
    """Pure tick: +1 clock, then credit every in-transit record with arrival_tick <= now.
    Arrival at the destination is the single physical credit — no double-count."""
    s = _copy(state)
    s['tick'] += 1
    still = []
    for rec in s['in_transit']:
        if rec['arrival_tick'] <= s['tick']:
            s['inventories'][rec['to_id']]['usable_t'] += rec['tonnes']
            _ev(s, f"transfer {rec['transfer_id']} arrives at {rec['to_id']} ({rec['tonnes']:g}t)")
        else:
            still.append(rec)
    s['in_transit'] = still
    return s


# ---------- invariants (assert after every scenario) ----------

def ledger_closure(state, initial_deposits):
    """sum(inventories usable_t) + sum(in_transit tonnes) == sum(deposits), within TOL.
    Reservations are accounting-only and must never appear in the closure."""
    total = sum(i['usable_t'] for i in state['inventories'].values())
    total += sum(r['tonnes'] for r in state['in_transit'])
    return abs(total - initial_deposits) < TOL, total


def reservations_valid(state):
    """0 <= reserved[inv] <= usable_t[inv] (earmark never exceeds what physically exists)."""
    for inv_id, held in state['reserved'].items():
        if held < -TOL or held > state['inventories'][inv_id]['usable_t'] + TOL:
            return False, inv_id
    return True, None


# ---------- scenario runs (real content shape: yard -> belt buffer -> DRP) ----------

def run_positive():
    print('== positive: reserve -> transfer -> arrival, boundary buffer ==')
    st = fresh_state()
    for inv in ('yard_ore', 'belt_buffer', 'drp_intake'):
        st = register_inventory(st, inv)
    st = deposit(st, 'yard_ore', 1000.0)
    dep_total = 1000.0

    st = reserve(st, 'yard_ore', 400.0, 'belt task #1')
    assert st['reserved']['yard_ore'] == 400.0, 'reserve earmark failed'
    assert st['inventories']['yard_ore']['usable_t'] == 1000.0, 'reserve must NOT move physical tonnes'

    st = transfer(st, 'yard_ore', 'belt_buffer', 400.0, travel_ticks=3)
    assert st['inventories']['yard_ore']['usable_t'] == 600.0, 'transfer must consume source'
    assert st['reserved'].get('yard_ore', 0.0) == 0.0, 'transfer must release the earmark it moved'
    assert st['inventories']['belt_buffer']['usable_t'] == 0.0, 'NO same-tick teleport'
    assert len(st['in_transit']) == 1 and st['in_transit'][0]['arrival_tick'] == st['tick'] + 3

    for _ in range(2):
        st = tick(st)
    assert st['inventories']['belt_buffer']['usable_t'] == 0.0, 'arrived early?'
    st = tick(st)  # arrival tick lands inside this tick
    assert st['inventories']['belt_buffer']['usable_t'] == 400.0, 'arrival credit failed'
    assert st['in_transit'] == [], 'ledger should be empty after arrival'

    # second leg: buffer -> DRP consumes on commission (no reserve needed)
    st = transfer(st, 'belt_buffer', 'drp_intake', 400.0, travel_ticks=2)
    for _ in range(2):
        st = tick(st)
    assert st['inventories']['drp_intake']['usable_t'] == 400.0

    ok, total = ledger_closure(st, dep_total)
    assert ok, f'ledger closure failed (total {total})'
    rv, bad = reservations_valid(st)
    assert rv, f'reservation invariant broken at {bad}'
    print('  PASS: two-phase handoff, earmark lifecycle, closure', round(total, 6), 't')


def run_negative():
    print('== negative tests (each must fail as intended) ==')
    st = fresh_state()
    for inv in ('a', 'b'):
        st = register_inventory(st, inv)
    st = deposit(st, 'a', 100.0)

    # n1: transfer beyond usable -> refused, state unchanged
    before = json.dumps({k: st[k] for k in ('inventories', 'reserved', 'in_transit')})
    st2 = transfer(st, 'a', 'b', 150.0, 2)
    assert json.dumps({k: st2[k] for k in ('inventories', 'reserved', 'in_transit')}) == before, 'n1 mutated state'
    assert any('refused' in e['event'] for e in st2['events']), 'n1 no refusal event'
    print('  n1 PASS: over-transfer refused, state byte-identical')

    # n2: travel_ticks=0 (same-tick teleport) -> hard error
    try:
        transfer(st, 'a', 'b', 10.0, 0)
        assert False, 'n2 accepted travel_ticks=0'
    except ValueError:
        print('  n2 PASS: same-tick teleport rejected')

    # n3: reserve more than available -> refused
    st = reserve(st, 'a', 100.0, 'task A')
    st3 = reserve(st, 'a', 50.0, 'task B')  # only 0t un-earmarked left
    assert st3['reserved']['a'] == 100.0, 'n3 double-earmark allowed'
    print('  n3 PASS: double-earmark refused (no double-count)')

    # n4: transfer more than reserved+uncommitted mix is fine up to usable,
    #     but release beyond held -> refused
    st4 = release(st, 'a', 150.0)
    assert st4['reserved']['a'] == 100.0, 'n4 over-release allowed'
    print('  n4 PASS: over-release refused')

    # n5: unknown inventory -> refused (never silently created)
    st5 = transfer(st, 'a', 'ghost', 10.0, 2)
    assert 'ghost' not in st5['inventories'] and not st5['in_transit'], 'n5 created ghost'
    print('  n5 PASS: unknown inventory refused')

    # n6: fractional/negative amounts rejected
    for bad in (0.0, -5.0):
        try:
            deposit(st, 'a', bad)
            assert False, f'n6 accepted {bad}'
        except ValueError:
            pass
    print('  n6 PASS: non-positive amounts rejected')


def run_interleaved():
    print('== interleaved: two transfers in flight, arrivals land on their own ticks ==')
    st = fresh_state()
    for inv in ('yard', 'buf1', 'buf2'):
        st = register_inventory(st, inv)
    st = deposit(st, 'yard', 500.0)
    st = transfer(st, 'yard', 'buf1', 200.0, travel_ticks=2)
    st = transfer(st, 'yard', 'buf2', 300.0, travel_ticks=5)
    for _ in range(2):
        st = tick(st)
    assert st['inventories']['buf1']['usable_t'] == 200.0
    assert st['inventories']['buf2']['usable_t'] == 0.0
    assert len(st['in_transit']) == 1
    for _ in range(3):
        st = tick(st)
    assert st['inventories']['buf2']['usable_t'] == 300.0
    ok, total = ledger_closure(st, 500.0)
    assert ok, f'closure failed ({total})'
    print('  PASS: independent arrival ticks, closure', round(total, 6), 't')


if __name__ == '__main__':
    run_positive()
    run_negative()
    run_interleaved()
    print('\nS1.1 registry mirror: ALL PASS')
