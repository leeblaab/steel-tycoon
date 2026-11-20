# Slice 3 mirror — DRP -> DRI buffer -> EAF feed interface (v1)
# Python mirror = single source of truth (mirror-first workflow).
#
# Core tension: DRP runs continuously (discharges per tick), EAF consumes in
# discrete batches (heat charge at tap-to-tap cadence). Buffer fills when EAF is
# slow, starves when DRP trips.
#
# Interface: the approved v1 dri_charge_material contract (embedded in
# fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json under "contracts") is
# reused as-is — fields are not redesigned. quality_metadata stays RESERVED:
# metalization % is fixed at v1; re-oxidation-over-age is simulated later.
#
# Mechanics (v1):
# - DRP discharges `drp_discharge_t_per_tick` each tick into the buffer
#   (FIFO lots; each lot carries its discharge tick for later age tracking).
# - DRP trip: at each `trip_ticks` entry a draw (canonical xorshift32, seed)
#   fires the trip with probability `trip_probability`; a trip halts discharge
#   for `trip_duration_ticks`.
# - Buffer capacity: discharge is refused when the buffer is full (never
#   silently dropped — recorded as a blocked event).
# - EAF batch: at each `heat_plan` tick the EAF takes `charge_t` from the
#   buffer (FIFO). If the buffer cannot supply the full charge, the heat is
#   SKIPPED (never partially consumed) and cause-attributed:
#   buffer_starved (short at that tick) vs plan_overdraw (plan exceeds total
#   DRP output by the deadline).
# - States: buffer_full (>= fill_state_threshold_t), buffer_starved (below
#   starve_threshold_t at a heat tick), buffer_blocked (refused discharge).
# - Determinism: state-in/state-out tick, never mutates the original; PRNG
#   state lives inside the sim state (shared xorshift32 spec).
# - Validation: invalid inputs must FAIL as intended (negative tests below).

import json, math, os

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'slice3',
                            's3_dri_buffer_scenario_seed11_120.json')

# Canonical xorshift32 — byte-identical to web/src/prng.ts / mirror/xorshift32_check.py.
def xorshift32_next(state):
    if state == 0:
        raise ValueError("zero generator state reached — contract violation")
    x = state & 0xFFFFFFFF
    x ^= (x << 13) & 0xFFFFFFFF
    x ^= x >> 17
    x ^= (x << 5) & 0xFFFFFFFF
    x &= 0xFFFFFFFF
    return x, x / 0xFFFFFFFF

def load_fixture(path=FIXTURE_PATH):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def validate_scenario(fx):
    """Fail loudly on invalid inputs — negative tests depend on these raising."""
    sc = fx['scenario']
    if sc['seed'] == 0:
        raise ValueError("zero seed rejected (xorshift32 is degenerate at 0)")
    if sc['ticks'] <= 0:
        raise ValueError("ticks must be positive")
    if sc['drp']['discharge_t_per_tick'] <= 0:
        raise ValueError("drp.discharge_t_per_tick must be positive")
    if sc['buffer']['capacity_t'] <= 0:
        raise ValueError("buffer.capacity_t must be positive")
    if not (0 < sc['buffer']['starve_threshold_t'] < sc['buffer']['fill_state_threshold_t'] <= sc['buffer']['capacity_t']):
        raise ValueError("buffer thresholds must satisfy 0 < starve < fill <= capacity")
    if sc['eaf']['charge_t'] <= 0:
        raise ValueError("eaf.charge_t must be positive")
    if not sc['eaf']['heat_plan']:
        raise ValueError("eaf.heat_plan must be non-empty")
    if any(t <= 0 or t > sc['ticks'] for t in sc['eaf']['heat_plan']):
        raise ValueError("heat_plan ticks must be within (0, ticks]")
    if len(set(sc['eaf']['heat_plan'])) != len(sc['eaf']['heat_plan']):
        raise ValueError("heat_plan ticks must be unique")
    p = sc['drp']['trip_probability']
    if not (0.0 < p < 1.0):
        raise ValueError("drp.trip_probability must be in (0,1)")
    if sc['drp']['trip_duration_ticks'] <= 0:
        raise ValueError("drp.trip_duration_ticks must be positive")
    if any(t <= 0 or t > sc['ticks'] for t in sc['drp']['trip_ticks']):
        raise ValueError("trip_ticks must be within (0, ticks]")
    return fx

def fresh_state(fx):
    sc = fx['scenario']
    return {
        'tick': 0,
        'prng_state': sc['seed'],
        'buffer': [],            # FIFO lots: {material_id, usable_t, discharge_tick}
        'buffer_t': 0.0,
        'discharged_t_total': 0.0,  # S3.1: monotonic DRP discharge counter (feed-edge source signal)
        'drp_tripped_until': 0, # tick until which discharge is halted (0 = running)
        'heats': [],             # heat records (dri_charge_material contract fields)
        'events': [],
        'win': None,
    }

def _lot(material_id, usable_t, discharge_tick):
    # dri_charge_material contract v1 — fields used as-is (quality_metadata reserved).
    return {
        'material_id': material_id,
        'usable_t': usable_t,
        'quality_metadata': None,  # RESERVED — metalization/re-oxidation later
        'source': 'DRP discharge',
        'readiness_timestamp': discharge_tick,
        'destination': 'EAF feed interface',
    }

def tick(state, fx):
    """state -> new_state; never mutates the original."""
    s = json.loads(json.dumps(state))
    sc = fx['scenario']
    s['tick'] += 1
    ev = []

    # 1) DRP trip gate: draw consumed at every trip tick (draw contract),
    #    fires trip with probability p; trip halts discharge.
    if s['tick'] in sc['drp']['trip_ticks']:
        s['prng_state'], draw = xorshift32_next(s['prng_state'])
        if draw < sc['drp']['trip_probability']:
            s['drp_tripped_until'] = s['tick'] + sc['drp']['trip_duration_ticks']
            ev.append(f"DRP TRIP fires at tick {s['tick']} (draw {draw:.4f} < p {sc['drp']['trip_probability']}), halted {sc['drp']['trip_duration_ticks']} ticks")

    # 2) DRP discharge (continuous supply) -> buffer, capacity-gated
    if s['tick'] <= s['drp_tripped_until']:
        ev.append("DRP halted (trip)")
    else:
        rate = sc['drp']['discharge_t_per_tick']
        room = sc['buffer']['capacity_t'] - s['buffer_t']
        if rate > room + 1e-9:
            ev.append(f"buffer FULL: discharge refused {rate}t (room {round(room,2)}t)")
        else:
            s['buffer'].append(_lot(f"M{s['tick']}", rate, s['tick']))
            s['buffer_t'] += rate
            s['discharged_t_total'] += rate
            ev.append(f"DRP discharge {rate}t -> buffer ({round(s['buffer_t'],2)}t)")

    # 3) EAF batch demand (FIFO take, full charge or skip)
    if s['tick'] in sc['eaf']['heat_plan']:
        need = sc['eaf']['charge_t']
        if s['buffer_t'] + 1e-9 >= need:
            taken = []
            rem = need
            while rem > 1e-9 and s['buffer']:
                lot = s['buffer'][0]
                take = min(lot['usable_t'], rem)
                lot['usable_t'] -= take
                rem -= take
                if lot['usable_t'] <= 1e-9:
                    s['buffer'].pop(0)
                taken.append(lot['material_id'])
            s['buffer_t'] -= need
            heat = {
                'material_id': f"H{s['tick']}",
                'usable_t': need,
                'quality_metadata': None,
                'source': 'DRI buffer',
                'readiness_timestamp': s['tick'],
                'destination': 'EAF feed interface',
                'status': 'charged',
                'lots_taken': taken,
            }
            s['heats'].append(heat)
            ev.append(f"EAF heat at tick {s['tick']}: {need}t taken (lots {','.join(taken)})")
        else:
            heat = {
                'material_id': f"H{s['tick']}",
                'usable_t': 0.0,
                'quality_metadata': None,
                'source': 'DRI buffer',
                'readiness_timestamp': None,
                'destination': 'EAF feed interface',
                'status': 'skipped',
                'failure_cause': None,  # attributed at scenario end
                'lots_taken': [],
            }
            s['heats'].append(heat)
            ev.append(f"EAF heat at tick {s['tick']} SKIPPED: buffer short ({round(s['buffer_t'],2)}t < {need}t)")

    # 4) State flags for this tick
    if s['buffer_t'] >= sc['buffer']['fill_state_threshold_t'] - 1e-9:
        ev.append(f"buffer state: FULL (>= {sc['buffer']['fill_state_threshold_t']}t)")
    if any('SKIPPED' in e for e in ev):
        ev.append(f"buffer state: STARVED (< {sc['buffer']['starve_threshold_t']}t)")

    s['events'].extend({'tick': s['tick'], 'event': e} for e in ev)
    return s

def run(fx):
    state = fresh_state(fx)
    records = []
    for _ in range(fx['scenario']['ticks']):
        state = tick(state, fx)
        ev = [e['event'] for e in state['events'] if e['tick'] == state['tick']]
        records.append({
            'tick': state['tick'],
            'buffer_t': round(state['buffer_t'], 4),
            'drp_tripped': state['tick'] <= state['drp_tripped_until'],
            'heat': None,
            'flags': {'full': state['buffer_t'] >= fx['scenario']['buffer']['fill_state_threshold_t'] - 1e-9,
                      'blocked': any('refused' in e for e in ev),
                      'starved': any('SKIPPED' in e for e in ev)},
            'events': ev,
        })
        for h in state['heats']:
            if h['readiness_timestamp'] == state['tick']:
                records[-1]['heat'] = h['status']
    # failure cause attribution for skipped heats
    total_output = sum(r['buffer_t'] for r in [records[-1]])  # not used; recompute below
    total_discharge = 0.0
    for r in records:
        pass
    # recompute cumulative discharge from events is fragile; recompute directly:
    total_discharge = 0.0
    st = fresh_state(fx)
    # Simpler: replay counts — use records' discharge events.
    total_discharge = sum(fx['scenario']['drp']['discharge_t_per_tick']
                          for r in records if any('DRP discharge' in e for e in r['events']))
    for h in state['heats']:
        if h['status'] == 'skipped':
            # plan_overdraw if even full DRP output (no trips) can't cover all heats
            # by the last heat tick; otherwise buffer_starved at that tick.
            last_heat = max(fx['scenario']['eaf']['heat_plan'])
            max_possible = fx['scenario']['drp']['discharge_t_per_tick'] * last_heat
            if max_possible < fx['scenario']['eaf']['charge_t'] * len(fx['scenario']['eaf']['heat_plan']) - 1e-9:
                h['failure_cause'] = 'plan_overdraw'
            else:
                h['failure_cause'] = 'buffer_starved'
    state['win'] = all(h['status'] == 'charged' for h in state['heats'])
    return state, records

def summarize(state, records, fx):
    sc = fx['scenario']
    fills = [r['tick'] for r in records if r['flags']['full']]
    blocks = [r['tick'] for r in records if r['flags']['blocked']]
    starves = [r['tick'] for r in records if r['flags']['starved']]
    trips = [r['tick'] for r in records if any('TRIP fires' in e for e in r['events'])]
    return {'win': state['win'], 'fill_ticks': fills, 'blocked_ticks': blocks,
            'starve_ticks': starves, 'trip_fired_ticks': trips,
            'heats': {h['material_id']: (h['status'], h.get('failure_cause')) for h in state['heats']}}

if __name__ == '__main__':
    fx = load_fixture()
    validate_scenario(fx)
    state, records = run(fx)
    exp = fx['expected_outputs']
    s = summarize(state, records, fx)
    print(f"scenario: {fx['fixture_id']}")
    print(f"win: {s['win']} (expected {exp['win']})")
    print(f"fill_state_ticks: {s['fill_ticks']}")
    print(f"blocked_ticks: {s['blocked_ticks']}")
    print(f"starve_ticks: {s['starve_ticks']}")
    print(f"trip_fired_ticks: {s['trip_fired_ticks']}")
    for hid, (st, cause) in s['heats'].items():
        print(f"  heat {hid}: {st}" + (f" cause={cause}" if cause else ""))
    ok = (s['win'] == exp['win'] and s['fill_ticks'] == exp['fill_state_ticks']
          and s['blocked_ticks'] == exp['blocked_ticks'] and s['starve_ticks'] == exp['starve_ticks']
          and s['trip_fired_ticks'] == exp['trip_fired_ticks'])
    print(f"parity vs fixture expected_outputs: {'PASS' if ok else 'FAIL'}")

    # Negative tests — invalid inputs must fail as intended.
    print("negative tests:")
    def neg(name, mut):
        bad = json.loads(json.dumps(fx))
        mut(bad)
        try:
            validate_scenario(bad)
            print(f"  {name}: FAIL (no error raised)")
        except ValueError as e:
            print(f"  {name}: OK ({e})")
    neg("zero seed", lambda b: b['scenario'].__setitem__('seed', 0))
    neg("non-positive ticks", lambda b: b['scenario'].__setitem__('ticks', 0))
    neg("zero discharge rate", lambda b: b['scenario']['drp'].__setitem__('discharge_t_per_tick', 0))
    neg("zero buffer capacity", lambda b: b['scenario']['buffer'].__setitem__('capacity_t', 0))
    neg("threshold order inverted", lambda b: b['scenario']['buffer'].__setitem__('starve_threshold_t', 999.0))
    neg("trip probability out of range", lambda b: b['scenario']['drp'].__setitem__('trip_probability', 1.5))
    neg("heat plan outside scenario", lambda b: b['scenario']['eaf'].__setitem__('heat_plan', [200]))
    neg("duplicate heat plan tick", lambda b: b['scenario']['eaf'].__setitem__('heat_plan', [20, 20, 40]))
    # negative control: plan_overdraw path — charge_t raised so no run can cover it
    bad = json.loads(json.dumps(fx))
    bad['scenario']['eaf']['charge_t'] = 120.0
    st2, _ = run(bad)
    causes = sorted({h['failure_cause'] for h in st2['heats'] if h['status'] == 'skipped'})
    print(f"  plan_overdraw attribution: {'OK' if causes == ['plan_overdraw'] and not st2['win'] else 'FAIL'} (win={st2['win']}, causes={causes})")
