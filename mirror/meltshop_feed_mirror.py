# S3.1 meltshop-feed mirror — literal Python clone of web/src/shared/meltshop_feed.ts
# (same discipline as the ore-belt clone in build_ore_belt_dump.py). Two REAL transfer
# edges on the S1.1 registry primitives, riding the slice engines' monotonic signals:
#   scrap: slice1 dispatched_t delta  -> scrap_bucket    -> eaf_scrap  (EAF commissioned)
#   DRI:   slice3 discharged_t_total delta -> dri_feed_buffer -> eaf_dri
# Boundary-buffer pattern (25.10 clause 2): the buckets are real inventories that
# accumulate before the EAF exists; the interfaces join the ledger on commissioning.
# Consumption: owner-tagged (charge_id) at slice4 heat start; consume what physically
# exists, record the shortfall as an event (never fabricate material). Shortfall events
# are the S3.2 amber signal. Closure: usable + in_transit + consumed == deposits (1e-6).
# Slice engines stay deterministic replay ports (S1.2 precedent); hard production gating
# on feed stock is a later explicit rule change (DECISIONS S3.1 contract reading).
import json

TOL = 1e-6
SCRAP_EDGE = {'rate_tph': 225.0, 'chunk_t': 5.0, 'travel_ticks': 2}  # scrap_feed 150-300 tph band mid (sme_pending); 5t bucket granularity (rate/tick 9.375 < 25t truck chunk would never flow)
DRI_EDGE = {'rate_tph': 600.0, 'chunk_t': 25.0, 'travel_ticks': 2}

class Reg:
    def __init__(self):
        self.tick = 0
        self.inv = {}
        self.reserved = {}
        self.in_transit = []
        self.events = []

def register(r, i):
    assert i not in r.inv, f'inventory {i} already registered'
    r.inv[i] = {'usable_t': 0.0}

def depose(r, i, t):
    assert t > 0, 'deposit must be positive'
    r.inv[i]['usable_t'] += t

def avail(r, i):
    return (r.inv[i]['usable_t'] - r.reserved.get(i, 0.0)) if i in r.inv else 0.0

def transfer(r, f, t, tonnes, travel):
    assert isinstance(travel, int) and travel >= 1, 'travel_ticks must be an integer >= 1'
    assert f in r.inv and t in r.inv and f != t
    inv = r.inv[f]
    assert tonnes <= inv['usable_t'] + TOL, 'transfer usable short'
    held = r.reserved.get(f, 0.0)
    e = min(held, tonnes)
    r.reserved[f] = held - e
    inv['usable_t'] -= tonnes
    r.in_transit.append({'tonnes': tonnes, 'from_id': f, 'to_id': t,
                         'depart_tick': r.tick, 'arrival_tick': r.tick + travel})

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

def fresh_feed_state(scrap=None, dri=None):
    sc = dict(SCRAP_EDGE, **(scrap or {}))
    dr = dict(DRI_EDGE, **(dri or {}))
    r = Reg()
    register(r, 'scrap_bucket')
    register(r, 'dri_feed_buffer')
    return {'reg': r, 'eaf_commissioned': False, 'commissioned_at': None,
            'scrap': sc, 'dri': dr, 'consumed_scrap_t': 0.0, 'consumed_dri_t': 0.0}

def commission_eaf(st):
    if st['eaf_commissioned']:
        return st
    register(st['reg'], 'eaf_scrap')
    register(st['reg'], 'eaf_dri')
    st['eaf_commissioned'] = True
    st['commissioned_at'] = st['reg'].tick
    return st

def deposit_scrap(st, tonnes):
    if tonnes > 0:
        depose(st['reg'], 'scrap_bucket', tonnes)
    return st

def deposit_dri(st, tonnes):
    if tonnes > 0:
        depose(st['reg'], 'dri_feed_buffer', tonnes)
    return st

def _consume(st, inv_id, need_t, owner):
    """Owner-tagged consume: take what physically exists, event the shortfall."""
    r = st['reg']
    if inv_id not in r.inv:
        r.events.append({'tick': r.tick, 'event': f'consume refused {inv_id} {need_t}t ({owner}): interface not commissioned'})
        return 0.0
    have = r.inv[inv_id]['usable_t']
    take = min(have, need_t)
    if take > 0:
        r.inv[inv_id]['usable_t'] -= take
    if take < need_t - TOL:
        r.events.append({'tick': r.tick, 'event': f'feed SHORTFALL {inv_id} {round(need_t - take, 3)}t short for {owner} (had {round(have, 3)}t)'})
    return take

def step_feed(st, consumptions):
    """consumptions: [{charge_id, scrap_t, dri_t}] from slice4 heat-start transitions.
    Order: clock (arrivals) -> drain buckets to interfaces (if live) -> consume -> done.
    Deposits happen BEFORE the step (session wires the slice deltas), like the ore belt."""
    r = st['reg']
    tick(r)
    if st['eaf_commissioned']:
        sc_load = plan(avail(r, 'scrap_bucket'), st['scrap']['rate_tph'] / 24.0, st['scrap']['chunk_t'])
        if sc_load > 0:
            transfer(r, 'scrap_bucket', 'eaf_scrap', sc_load, st['scrap']['travel_ticks'])
        dr_load = plan(avail(r, 'dri_feed_buffer'), st['dri']['rate_tph'] / 24.0, st['dri']['chunk_t'])
        if dr_load > 0:
            transfer(r, 'dri_feed_buffer', 'eaf_dri', dr_load, st['dri']['travel_ticks'])
        for c in consumptions:
            st['consumed_scrap_t'] += _consume(st, 'eaf_scrap', c['scrap_t'], c['charge_id'])
            st['consumed_dri_t'] += _consume(st, 'eaf_dri', c['dri_t'], c['charge_id'])
    else:
        for c in consumptions:
            r.events.append({'tick': r.tick, 'event': f"consume refused {c['charge_id']}: EAF not commissioned"})
    return st

def ledger_view(st):
    r = st['reg']
    g = lambda i: r.inv[i]['usable_t'] if i in r.inv else 0.0
    return {'tick': r.tick, 'scrap_bucket_t': g('scrap_bucket'), 'dri_feed_buffer_t': g('dri_feed_buffer'),
            'eaf_scrap_t': g('eaf_scrap'), 'eaf_dri_t': g('eaf_dri'),
            'in_transit_t': sum(x['tonnes'] for x in r.in_transit),
            'consumed_scrap_t': st['consumed_scrap_t'], 'consumed_dri_t': st['consumed_dri_t']}

def invariants(st, deposits_total):
    r = st['reg']
    total = sum(v['usable_t'] for v in r.inv.values()) + sum(x['tonnes'] for x in r.in_transit) \
            + st['consumed_scrap_t'] + st['consumed_dri_t']
    if abs(total - deposits_total) >= TOL:
        return {'ok': False, 'detail': f'closure {total} != {deposits_total}'}
    for i, held in r.reserved.items():
        if held < -TOL or held > r.inv[i]['usable_t'] + TOL:
            return {'ok': False, 'detail': f'reservation invalid on {i}'}
    return {'ok': True, 'detail': f'closed at {total} t'}

def run_negative_tests():
    results = []
    # N1: no deposits -> everything zero, closure 0, nothing fabricated.
    st = fresh_feed_state()
    for _ in range(5):
        st = step_feed(st, [])
    v = ledger_view(st)
    ok = all(v[k] == 0 for k in ('scrap_bucket_t', 'dri_feed_buffer_t', 'eaf_scrap_t', 'eaf_dri_t', 'in_transit_t')) \
         and invariants(st, 0.0)['ok']
    results.append(('N1 empty feed stays zero + closed', ok))
    # N2: consumption before commissioning is refused (no interface), closure intact.
    st = fresh_feed_state()
    st = deposit_scrap(st, 100.0)
    st = step_feed(st, [{'charge_id': 'C1', 'scrap_t': 30.0, 'dri_t': 10.0}])
    ok = st['consumed_scrap_t'] == 0.0 and any('not commissioned' in e['event'] for e in st['reg'].events) \
         and invariants(st, 100.0)['ok']
    results.append(('N2 pre-commission consumption refused, closure intact', ok))
    # N3: shortfall consumes only what exists, events the gap, closure exact.
    st = fresh_feed_state()
    st = commission_eaf(st)
    st = deposit_scrap(st, 20.0)   # less than one 30t charge
    st = deposit_dri(st, 50.0)
    for _ in range(6):
        st = step_feed(st, [])     # let the buckets drain AND the 2-tick transit fully arrive
    st = step_feed(st, [{'charge_id': 'C1', 'scrap_t': 30.0, 'dri_t': 10.0}])
    ok = abs(st['consumed_scrap_t'] - 20.0) < TOL and abs(st['consumed_dri_t'] - 10.0) < TOL \
         and any('SHORTFALL' in e['event'] for e in st['reg'].events) and invariants(st, 70.0)['ok']
    results.append(('N3 shortfall consumes available only + event + closure', ok))
    # N4: same-tick teleport is a hard error.
    st = fresh_feed_state()
    try:
        transfer(st['reg'], 'scrap_bucket', 'eaf_scrap', 10.0, 0)
        ok = False
    except AssertionError:
        ok = True
    results.append(('N4 travel_ticks >= 1 enforced', ok))
    # N5: double commissioning is idempotent.
    st = fresh_feed_state()
    st = commission_eaf(st)
    snap = json.dumps(st['reg'].inv)
    st = commission_eaf(st)
    results.append(('N5 double commission idempotent', json.dumps(st['reg'].inv) == snap))
    return results

if __name__ == '__main__':
    print('meltshop_feed mirror negative tests:')
    for name, ok in run_negative_tests():
        print(f"  {'PASS' if ok else 'FAIL'} {name}")
    assert all(ok for _, ok in run_negative_tests()), 'negative tests failed'
    print('ALL PASS')
