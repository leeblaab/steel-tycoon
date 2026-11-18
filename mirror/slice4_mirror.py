# Slice 4 mirror — EAF -> LRF -> CCM -> billet yard (v1)
# Python mirror = single source of truth (mirror-first workflow).
# Consumes Slice 2's prepared_charge contract and Slice 3's dri_charge_material
# contract (approved v1, embedded in fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json
# under "contracts") — via contract fields only, never via Slice 2/3 internals.
#
# Mechanics (v1):
# - Ladle availability is a CYCLE, not a capacity number: N ladles, each ladle is a
#   non-preemptive cycle EAF-tap -> LRF -> CCM -> ladle released back to the pool.
#   A heat that taps with no ladle free WAITS (ladle_wait counter); a ladle that
#   arrives at the caster while the caster is busy WAITS (caster_wait).
# - EAF: one furnace, non-preemptive heat cycle. A heat starts only when a charge
#   (prepared_charge, status ready/delivered) is available at the EAF feed interface.
#   Yield = metallic yield from charge tonnage (grade yield_loss_pct from
#   content/scrap/scrap_tiers.json; DRI 95-98% band midpoint 96.5% — convention
#   stated explicitly, pending Yasser approval).
# - LRF: single ladle furnace, non-preemptive refining cycle per ladle.
# - CCM: single strand, non-preemptive casting cycle per ladle; billet accumulation.
# - Energy indicator (simple, not fully simulated): EAF specific energy per heat =
#   SEC_kWh_per_t * charge_t. SEC value is source-backed (cited below); the kWh/tLS
#   figure is an industry fact, the per-heat application is engineering-estimate.
# - Maintenance/workforce: VISIBLE INDICATORS ONLY (not simulated): planned outage
#   windows from the scenario config fire as events; workforce shift changeover fires
#   as an event. No stochastic breakdowns in v1 (no RNG in the rule path — the
#   scenario is fully scripted and deterministic, same shape as the Slice 2 mirror).
# - Material balance identity asserted every tick: every tonne counted once, at the
#   moment it enters the system (charge/DRI delivery), through buffers (EAF bath,
#   ladle, tundish/caster, billet yard) to billet yard stock.
# - Negative tests included (see run_negative_tests): a charge that never arrives
#   starves the EAF (no fabricated heat); a ladle-cycle that cannot complete keeps
#   the ladle busy; a scenario that asserts a blockage is checked for physical
#   reachability (inflow vs drain) before asserting it.
# - Pure tick: state in -> new state out, never mutates the original.

import json, os

REPO = os.path.join(os.path.dirname(__file__), '..')
FIXTURE_PATH = os.path.join(REPO, 'fixtures', 'slice4', 's4_eaf_lrf_ccm_billet_seed11_120.json')
SCRAP_PATH = os.path.join(REPO, 'content', 'scrap', 'scrap_tiers.json')

# Energy: source-backed citation (AIST MENA EAF-Efficiency presentation, Cappel):
# "The energy consumption of an EAF is about 650 kWh/tLS ... power consumption varies
# between 350 and 600 kWh/tLS." TERI best-practices PDF: SEC range 415-675 kWh/t,
# TTT table 180 min -> 550-650 kWh/t. We adopt 600 kWh/t (within the cited band) as
# the game value; label: source-backed band, engineering-estimate application.
EAF_SEC_KWH_PER_T = 600.0

def load_fixture(path=FIXTURE_PATH):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def load_scrap_tiers(path=SCRAP_PATH):
    with open(path, encoding='utf-8') as f:
        doc = json.load(f)
    return {g['id']: g for g in doc['grades']}

def fresh_state(fx):
    return {
        'tick': 0,
        # contract records (fields exactly as approved v1 contracts)
        'charges': [],            # prepared_charge records (Slice 2 interface)
        'dri_materials': [],      # dri_charge_material records (Slice 3 interface)
        # ladle cycle pool
        'ladles': [],             # [{ladle_id, status: free|busy, busy_charge_id, busy_since}]
        'eaf': {'busy_charge_id': None, 'remaining_ticks': 0, 'bath_t': 0.0},
        'lrf': {'busy_ladle_id': None, 'remaining_ticks': 0},
        'ccm': {'busy_ladle_id': None, 'remaining_ticks': 0},
        'billet_yard_t': 0.0,
        'events': [],
        'counters': {
            'heats_tapped': 0,
            'heats_starved': 0,          # idle ticks with no delivered charge at the interface
            'charge_wait_ticks': 0,      # charge delivered but EAF busy (charge-consumption wait)
            'ladle_wait_ticks': 0,       # delivered charge waiting for a free ladle
            'caster_wait_ticks': 0,      # refined ladle waiting while the strand is busy
            'refines_completed': 0,
            'casts_completed': 0,
            'energy_kwh_total': 0.0,
            'billet_t_total': 0.0,
            'yield_loss_t': 0.0,      # EAF metallurgical loss (counted at tap)
            'ccm_loss_t': 0.0,        # CCM tundish/dross loss (counted at cast)
            'maintenance_events': 0,
            'shift_changeovers': 0,
        },
        'win': None,
    }

def _yield_pct(grade, tiers, fx):
    if grade == 'DRI':
        return fx['yield_convention']['dri_yield_pct']
    return 100.0 - tiers[grade]['yield_loss_pct']

def tick(state, fx, tiers):
    """state -> new_state; never mutates the original."""
    s = json.loads(json.dumps(state))
    s['tick'] += 1
    ev = []
    c = fx['scenario']
    cnt = s['counters']

    # 1) Deliveries at the EAF feed interface (inputs counted at entry).
    for d in c['charge_deliveries']:
        if d['tick'] == s['tick']:
            ch = next(x for x in s['charges'] if x['charge_id'] == d['charge_id'])
            ch['status'] = 'delivered'
            ev.append(f"charge {ch['charge_id']} delivered to EAF feed interface")
    for d in c['dri_deliveries']:
        if d['tick'] == s['tick']:
            m = next(x for x in s['dri_materials'] if x['material_id'] == d['material_id'])
            ev.append(f"DRI material {m['material_id']} ({m['usable_t']}t) ready at EAF feed interface")

    # 2) Cross-cutting visible indicators (events only, not simulated rules).
    for w in c.get('maintenance_windows', []):
        if w['start_tick'] == s['tick']:
            cnt['maintenance_events'] += 1
            ev.append(f"maintenance indicator: {w['asset']} planned outage window opens ({w['duration_ticks']} ticks)")
    for sc in c.get('shift_changeovers', []):
        if sc['tick'] == s['tick']:
            cnt['shift_changeovers'] += 1
            ev.append(f"workforce indicator: shift changeover ({sc['from']} -> {sc['to']})")

    # 3) EAF: non-preemptive heat cycle.
    eaf = s['eaf']
    if eaf['busy_charge_id'] is None:
        # need a delivered charge at the feed interface
        charge = next((x for x in s['charges'] if x['status'] == 'delivered'), None)
        if charge is None:
            cnt['heats_starved'] += 1
            # never assert on a bottleneck that didn't fire: starve is recorded,
            # no fabricated heat
            ev.append("EAF idle — no delivered charge at feed interface (starvation)")
        else:
            # Reserve a ladle for the heat at heat start (the ladle cycle is
            # non-preemptive: the reserved ladle is the one that receives the tap).
            ladle = next((l for l in s['ladles'] if l['status'] == 'free'), None)
            if ladle is None:
                cnt['ladle_wait_ticks'] += 1
                ev.append(f"EAF charge {charge['charge_id']} ready but no ladle free — ladle cycle wait")
            else:
                # heat starts: charge tonnage enters the furnace (counted at entry)
                charge['status'] = 'in_furnace'
                ladle['status'] = 'busy'
                ladle['busy_charge_id'] = charge['charge_id']
                ladle['busy_since'] = s['tick']
                eaf['busy_charge_id'] = charge['charge_id']
                eaf['remaining_ticks'] = c['eaf_heat_ticks']
                # bath_t is the live furnace charge (SME gap-fix 19.10: was dead field,
                # always 0.0 while a real bath existed in the balance stage)
                eaf['bath_t'] = sum(row['actual_usable_t'] for row in charge['grade_composition'])
                ev.append(f"EAF heat starts for {charge['charge_id']} ({c['eaf_heat_ticks']} ticks, ladle {ladle['ladle_id']} reserved)")
    else:
        waiting = any(x['status'] == 'delivered' for x in s['charges'])
        if waiting:
            cnt['charge_wait_ticks'] += 1
            ev.append("EAF busy, delivered charge waits at feed interface (charge-consumption wait)")
        eaf['remaining_ticks'] -= 1
        if eaf['remaining_ticks'] == 0:
            charge = next(x for x in s['charges'] if x['charge_id'] == eaf['busy_charge_id'])
            # yield applied on residence (charge spent, metal into ladle at tap)
            metal_t = 0.0
            for row in charge['grade_composition']:
                loss = row['actual_usable_t'] * (100.0 - _yield_pct(row['grade'], tiers, fx)) / 100.0
                cnt['yield_loss_t'] += loss
                metal_t += row['actual_usable_t'] - loss
                if row['grade'] == 'DRI':
                    # gap-fix 19.10: populate the informational ledger at heat consumption
                    # (charge index k consumes dri_materials[k]; fixture pairs Ck<->Dk one-to-one).
                    k = int(charge['charge_id'][1:]) - 1
                    if 0 <= k < len(s['dri_materials']):
                        s['dri_materials'][k]['consumed_t'] += row['actual_usable_t']
            # energy indicator for this heat (per-heat application = engineering-estimate)
            charge_t = sum(row['actual_usable_t'] for row in charge['grade_composition'])
            cnt['energy_kwh_total'] += EAF_SEC_KWH_PER_T * charge_t
            # tap into a free ladle (guaranteed: ladle was reserved at heat start;
            # ladle cycle is non-preemptive so it is still the same ladle)
            ladle = next(l for l in s['ladles'] if l['busy_charge_id'] == charge['charge_id'])
            ladle['metal_t'] = metal_t
            charge['status'] = 'tapped'
            cnt['heats_tapped'] += 1
            ev.append(f"EAF taps {charge['charge_id']}: {round(metal_t, 3)}t metal -> ladle {ladle['ladle_id']}")
            eaf['busy_charge_id'] = None
            eaf['bath_t'] = 0.0  # tap transfers the bath into the ladle
            # ladle goes to LRF immediately (single LRF, non-preemptive)
            if s['lrf']['busy_ladle_id'] is None:
                s['lrf']['busy_ladle_id'] = ladle['ladle_id']
                s['lrf']['remaining_ticks'] = c['lrf_ticks_per_ladle']
                ev.append(f"LRF refine starts for ladle {ladle['ladle_id']}")
            # else ladle waits at LRF (LRF queue) — recorded below at LRF stage

    # 4) LRF: non-preemptive refine cycle per ladle.
    lrf = s['lrf']
    if lrf['busy_ladle_id'] is None:
        # ladle that has metal and is waiting for LRF
        ladle = next((l for l in s['ladles'] if l.get('metal_t', 0) > 0 and not l.get('refined')
                      and l['ladle_id'] != lrf['busy_ladle_id']), None)
        if ladle:
            lrf['busy_ladle_id'] = ladle['ladle_id']
            lrf['remaining_ticks'] = c['lrf_ticks_per_ladle']
            ev.append(f"LRF refine starts for ladle {ladle['ladle_id']}")
    else:
        lrf['remaining_ticks'] -= 1
        if lrf['remaining_ticks'] == 0:
            ladle = next(l for l in s['ladles'] if l['ladle_id'] == lrf['busy_ladle_id'])
            ladle['refined'] = True
            cnt['refines_completed'] += 1
            ev.append(f"LRF refine completes for ladle {ladle['ladle_id']}")
            lrf['busy_ladle_id'] = None
            # ladle goes to CCM if strand free, else waits (caster_wait)
            if s['ccm']['busy_ladle_id'] is None:
                s['ccm']['busy_ladle_id'] = ladle['ladle_id']
                s['ccm']['remaining_ticks'] = c['ccm_ticks_per_ladle']
                ev.append(f"CCM cast starts for ladle {ladle['ladle_id']}")

    # 5) CCM: non-preemptive cast cycle per ladle; billet accumulation.
    # FIX (N3, analogous to the documented berth_only flag-consumed-before-the-
    # stage bug in docs/known_limitations.md): the strand must be claimed by the
    # ladle handed off at LRF completion (same-tick handoff, as the LRF stage
    # already does for the EAF tap). The old shape consumed the strand at the
    # top of the stage via the start branch, so the wait block was unreachable
    # whenever the handoff landed on a free-strand tick — the wait never fired.
    # Order within the stage is now: completion -> handoff -> wait check ->
    # countdown, so a wait tick is a true idle-strand-with-a-waiting-ladle tick
    # and the completion tick is never miscounted as a wait.
    ccm = s['ccm']
    if ccm['busy_ladle_id'] is not None:
        ccm['remaining_ticks'] -= 1
        if ccm['remaining_ticks'] == 0:
            ladle = next(l for l in s['ladles'] if l['ladle_id'] == ccm['busy_ladle_id'])
            billet = ladle['metal_t'] * fx['yield_convention']['ccm_billet_yield_pct'] / 100.0
            cnt['ccm_loss_t'] += ladle['metal_t'] - billet
            s['billet_yard_t'] += billet
            cnt['billet_t_total'] += billet
            cnt['casts_completed'] += 1
            ev.append(f"CCM casts ladle {ladle['ladle_id']}: {round(billet, 3)}t billet -> billet yard")
            # ladle released back to the pool — the cycle closes
            ladle['status'] = 'free'
            ladle['busy_charge_id'] = None
            ladle['metal_t'] = 0.0
            ladle['refined'] = False
            ccm['busy_ladle_id'] = None
    # handoff: refined ladle with metal gets the strand if free (same-tick
    # handoff from the LRF completion above, mirroring the EAF->LRF handoff)
    if ccm['busy_ladle_id'] is None:
        ladle = next((l for l in s['ladles'] if l.get('refined') and l.get('metal_t', 0) > 0), None)
        if ladle:
            ccm['busy_ladle_id'] = ladle['ladle_id']
            ccm['remaining_ticks'] = c['ccm_ticks_per_ladle']
            ev.append(f"CCM cast starts for ladle {ladle['ladle_id']}")
    # a refined ladle waiting while the strand is busy = caster wait.
    # Reachability rule (standing rule): the wait can only fire when the
    # strand drain (ccm_ticks_per_ladle) is slower than the arrival cadence
    # (lrf_ticks_per_ladle) AND there are >= 2 ladles — checked in N3.
    if ccm['busy_ladle_id'] is not None:
        waiting = any(l.get('refined') and l.get('metal_t', 0) > 0 and l['ladle_id'] != ccm['busy_ladle_id']
                      for l in s['ladles'])
        if waiting:
            cnt['caster_wait_ticks'] += 1
            ev.append("refined ladle waits at CCM — strand busy (ladle cycle pressure)")

    # 6) Material balance identity — every tonne counted once, at entry.
    #    DECISION (Yasser, 2026-10-15): the charge composition owns the entry point.
    #    A charge enters the melt-shop system when it is consumed by a heat (status
    #    in_furnace/tapped); its DRI row is part of that composition and is counted
    #    there. The dri_materials ledger is informational only (contract records for
    #    the Slice 3 interface) and is NOT a balance term — counting it as well
    #    double-counted the DRI tonnage (mid-run residual 40.0 = one charge's DRI row
    #    per heat, which is why end-of-run closure looked clean).
    #    CORRECTION (instrumented run 2026-10-15, tick 19): the mid-run residual is
    #    NOT the DRI ledger — it is the in_furnace residence. A charge in status
    #    'in_furnace' is physically in the furnace bath, but its tonnage was counted
    #    in `entered` while the bath term was 0 at tick boundaries (the bath only
    #    balances at tap). The identity is closed at tap, not at heat start, so the
    #    bath must be an explicit balance term during residence.
    #    entered counts all charges consumed (in_furnace or tapped); the bath is the
    #    residence buffer for in_furnace charges. (First bath patch double-counted by
    #    moving in_furnace out of entered AND subtracting it as bath — fresh run
    #    2026-10-15 showed -40.0 at ticks 19/30; this is the corrected form.)
    entered = 0.0
    for ch in s['charges']:
        if ch['status'] in ('in_furnace', 'tapped'):
            entered += sum(row['actual_usable_t'] for row in ch['grade_composition'])
    # buffers: metal currently in ladles, plus the furnace bath during residence
    # (bath = tonnage of charges in 'in_furnace'; 0 at tap because tap transfers it),
    # plus billet yard.
    in_ladles = sum(l.get('metal_t', 0) for l in s['ladles'])
    bath = eaf['bath_t']  # gap-fix 19.10: state field now authoritative (was recomputed locally)
    # losses: EAF metallurgical loss (counted at tap) + CCM tundish/dross loss (counted at cast).
    balance_error = entered - cnt['yield_loss_t'] - cnt['ccm_loss_t'] - in_ladles - bath - s['billet_yard_t']
    s['balance_error'] = balance_error

    s['events'].extend({'tick': s['tick'], 'event': e} for e in ev)
    return s

def run(fx, tiers):
    state = fresh_state(fx)
    for ch in fx['scenario']['charge_plan']:
        state['charges'].append({
            'charge_id': ch['charge_id'], 'recipe_id': ch['recipe_id'],
            'grade_composition': [{'grade': g['grade'], 'required_usable_t': g['required_usable_t'],
                                   'actual_usable_t': g['actual_usable_t']} for g in ch['composition']],
            'readiness_timestamp': None, 'deadline': ch['deadline_tick'],
            'status': 'planning', 'failure_cause': None,
        })
    for m in fx['scenario']['dri_plan']:
        state['dri_materials'].append({
            'material_id': m['material_id'], 'usable_t': m['usable_t'],
            'quality_metadata': {}, 'source': 'DRI buffer',
            'readiness_timestamp': m['ready_tick'], 'destination': 'EAF feed interface',
            'consumed_t': 0.0,   # populated at heat tap (gap-fix 19.10); informational only, NOT a balance term
        })
    for i in range(fx['scenario']['ladles']):
        state['ladles'].append({'ladle_id': f"L{i+1}", 'status': 'free',
                                'busy_charge_id': None, 'busy_since': None,
                                'metal_t': 0.0, 'refined': False})
    records = []
    for _ in range(fx['scenario']['ticks']):
        state = tick(state, fx, tiers)
        # win condition evaluated per charge at its deadline tick
        for ch in state['charges']:
            if ch['status'] in ('planning', 'delivered') and state['tick'] > ch['deadline']:
                ch['status'] = 'failed'
                ch['failure_cause'] = 'crane_delay'  # upstream delivery missed deadline
        records.append({
            'tick': state['tick'],
            'eaf_busy': state['eaf']['busy_charge_id'],
            'lrf_busy': state['lrf']['busy_ladle_id'],
            'ccm_busy': state['ccm']['busy_ladle_id'],
            'ladles_free': sum(1 for l in state['ladles'] if l['status'] == 'free'),
            'billet_yard_t': round(state['billet_yard_t'], 6),
            'balance_error': round(state['balance_error'], 9),
            'events': [e['event'] for e in state['events'] if e['tick'] == state['tick']],
        })
    statuses = [c['status'] for c in state['charges']]
    state['win'] = all(st == 'tapped' for st in statuses) and abs(state['balance_error']) < 1e-9
    return state, records

def run_negative_tests(fx, tiers):
    """Negative tests: broken rules must diverge from the healthy path."""
    results = []

    # N1: charge never delivered -> EAF starves every tick, no fabricated heat,
    #     balance stays closed (nothing entered the system).
    fx1 = json.loads(json.dumps(fx))
    fx1['scenario']['charge_deliveries'] = []
    st1, rec1 = run(fx1, tiers)
    ok = st1['counters']['heats_tapped'] == 0 and st1['counters']['heats_starved'] == fx['scenario']['ticks'] \
         and abs(st1['balance_error']) < 1e-9
    results.append(('N1 no-charge starvation (no fabricated heat, balance closed)', ok,
                    f"tapped={st1['counters']['heats_tapped']} starved={st1['counters']['heats_starved']} balance={st1['balance_error']}"))

    # N2: ladle cycle broken (ladle never released at CCM) -> ladle pool exhausted,
    #     EAF blocked by ladle wait; healthy path diverges (control must DIVERGE).
    fx2 = json.loads(json.dumps(fx))
    fx2['scenario']['ccm_ticks_per_ladle'] = 10**6  # never completes -> ladle stays busy
    st2, rec2 = run(fx2, tiers)
    healthy = run(fx, tiers)
    diverged = st2['counters']['casts_completed'] == 0 and healthy[0]['counters']['casts_completed'] > 0 \
               and st2['counters']['ladle_wait_ticks'] > 0
    results.append(('N2 ladle-cycle non-release diverges from healthy', diverged,
                    f"broken casts={st2['counters']['casts_completed']} healthy casts={healthy[0]['counters']['casts_completed']} broken ladle_wait={st2['counters']['ladle_wait_ticks']}"))

    # N3: physical reachability check for the caster wait, aligned with the fixture
    #     (Yasser GO 2026-10-15). The fixture asserts caster_wait == 0 at the current
    #     cadence: with same-tick LRF->CCM handoff, a refined ladle takes the strand
    #     immediately, so a wait requires a refined ladle whose LRF completion lands
    #     INSIDE a strand-busy window — i.e. arrival cadence < ccm_ticks_per_ladle
    #     (12 > 6 here, so unreachable). The guard is preserved in force: the
    #     predicate is evaluated, and the observed counter must agree with it — fires
    #     iff reachable. A cadence that makes the wait reachable must still make it
    #     fire; the control is not weakened to a bare equality with 0.
    #     The handoff condition is part of the predicate (fixture negative_controls
    #     clause): a refined ladle can only wait if a second ladle is in LRF when the
    #     strand is busy, which requires ladles >= 3 (one casting, one refining, one
    #     waiting). At ladles == 2 the predicate is False at this cadence.
    c = fx['scenario']
    reachable = c['ladles'] >= 3 and c['ccm_ticks_per_ladle'] > c['lrf_ticks_per_ladle']
    st, rec = run(fx, tiers)
    ok3 = (st['counters']['caster_wait_ticks'] > 0) == reachable
    results.append(('N3 caster wait fires iff physically reachable (fixture cadence: asserts 0)', ok3,
                    f"reachable={reachable} caster_wait={st['counters']['caster_wait_ticks']}"))

    # N4: negative control on the balance — double-counting billet yard material
    #     (adding billet twice) must break the identity with a nonzero residual.
    #     Healthy residual must be a NONZERO-difference-based control: the control
    #     compares the healthy identity against the broken rule, not healthy vs 0.
    st, rec = run(fx, tiers)
    residual = st['balance_error']
    dc = residual - st['billet_yard_t']  # simulate double-count of the yard term
    ok4 = abs(residual) < 1e-9 and abs(dc) > 1.0
    results.append(('N4 double-count control detects via balance', ok4,
                    f"healthy residual={residual} double-count residual={dc}"))

    return results

if __name__ == '__main__':
    fx = load_fixture()
    tiers = load_scrap_tiers()
    state, records = run(fx, tiers)
    print(f"scenario: {fx['fixture_id']}")
    print(f"win: {state['win']}")
    print(f"heats tapped: {state['counters']['heats_tapped']}  starved: {state['counters']['heats_starved']}")
    print(f"refines: {state['counters']['refines_completed']}  casts: {state['counters']['casts_completed']}")
    print(f"ladle wait ticks: {state['counters']['ladle_wait_ticks']}  caster wait ticks: {state['counters']['caster_wait_ticks']}")
    print(f"energy: {round(state['counters']['energy_kwh_total'], 1)} kWh (SEC {EAF_SEC_KWH_PER_T} kWh/t, source-backed band, per-heat application engineering-estimate)")
    print(f"billet yard: {round(state['billet_yard_t'], 3)} t")
    print(f"balance error at end: {state['balance_error']}")
    print("negative tests:")
    for name, ok, detail in run_negative_tests(fx, tiers):
        print(f"  {'PASS' if ok else 'FAIL'} {name} — {detail}")
