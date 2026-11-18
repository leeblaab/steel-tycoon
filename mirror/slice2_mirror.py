# Slice 2 mirror — scrap yard, crane queue, charge readiness (v1)
# Python mirror = single source of truth (mirror-first workflow).
# Rules implement the approved Slice 2 contracts (references/slice2_contracts_v1.md,
# Yasser-approved 2026-10-15) against the canonical scenario fixture
# fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json.
#
# Mechanics:
# - Truck delivers a grade load to RECEIVING_AREA (delivered_t = usable_t in v1).
# - Crane is the single shared resource: FIFO task queue, player-settable priority,
#   NON-PREEMPTIVE cycle (a running task completes; priority affects queued order only).
# - Grabs needed = ceil(tonnes / (bulk_density_kg_m3/1000 * grab_volume_m3)).
# - Cycle-time rule DECLARED (Yasser GO 2026-10-16): task duration = grabs ticks
#   (one grab per tick). crane_cycle_time_ticks_per_move is the per-move cycle the
#   player sees, NOT a multiplier on grab count. The fixture feasibility note's
#   arithmetic (10 grabs -> 30 ticks) contradicts this rule; fixture numbers are
#   pending SME decision, rule stands.
# - Charge ready when every required grade's actual_usable_t in the bucket meets
#   its required tonnage before the deadline. Failure is cause-attributed.
# - Per-charge buckets (Yasser GO 2026-10-16): each prepared_charge has its own
#   bucket CHARGING_BUCKET_<charge_id>; a charge's grade_composition is checked
#   against ITS OWN bucket only, and material is consumed on readiness (delivered
#   to EAF interface). A shared bucket would let one load satisfy three charges
#   (double-count trap).
# - Determinism: no RNG in v1 (fixed scripted scenario); state-in/state-out tick,
#   never mutates the original.

import json, math, os

FIXTURE_PATH = os.path.join(os.path.dirname(__file__), '..', 'fixtures', 'slice2',
                            's2_scrap_charge_scenario_seed11_120.json')

def load_fixture(path=FIXTURE_PATH):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def fresh_state(fx):
    return {
        'tick': 0,
        'inventories': {},          # inventory_id -> {grade, location, delivered_t, usable_t, usable_yield_factor, bulk_density_kg_m3}
        'tasks': [],                # crane task records (contract fields)
        'charges': [],              # prepared charge records (contract fields)
        'crane_busy_task_id': None,
        'crane_remaining_ticks': 0,
        'events': [],
        'win': None,                # set at scenario end
        '_fx': fx,                  # read-only fixture reference for the reservation gate
    }

def _inv_id(grade, location):
    return f"{grade}@{location}"

def _grabs(tonnes, density_kg_m3, grab_volume_m3):
    per_grab_t = (density_kg_m3 / 1000.0) * grab_volume_m3
    return max(1, math.ceil(tonnes / per_grab_t))

def enqueue_task(state, task):
    # Reservation rule (Yasser GO 2026-10-16): a charge task may only move tonnage
    # that is reserved to its own charge bucket. A task whose destination is
    # CHARGING_BUCKET_<charge_id> is enqueued only if the source stack holds the
    # tonnage AND that tonnage is not already committed to another charge's bucket
    # (i.e. the charge's own committed amount + this task <= its recipe requirement).
    # Without this, a later charge's task drains the shared stack before an earlier
    # charge's bucket can fill (double-count trap; stacks go negative).
    dest = task.get('destination_location', '')
    if dest.startswith('CHARGING_BUCKET_'):
        cid = dest.split('CHARGING_BUCKET_')[1]
        ch = next((c for c in state['charges'] if c['charge_id'] == cid), None)
        if ch is not None:
            recipe = next(r for r in state['_fx']['scenario']['recipes'] if r['recipe_id'] == ch['recipe_id'])
            req = next(c for c in recipe['composition'] if c['grade'] == task['material_grade'])['required_usable_t']
            bucket = state['inventories'].get(_inv_id(task['material_grade'], dest))
            committed = (bucket['usable_t'] if bucket else 0.0) + task['tonnes']
            if committed > req:
                state['events'].append({'tick': state['tick'],
                    'event': f"charge task {task['task_id']} refused: {task['tonnes']}t exceeds {cid}'s reserved share ({req}t)"})
                return None
        stack = state['inventories'].get(_inv_id(task['material_grade'], task['source_location']))
        # Reservation ledger (Yasser GO 2026-10-17, fix (a)): accepted charge tasks
        # earmark tonnage against the source stack so later tasks cannot claim the
        # same tonnes. Earmarks are accounting-only (distinct from physical usable_t);
        # the completion transfer is the single physical consumption, which also
        # releases the earmark. Refused/cancelled tasks never hold an earmark.
        reserved = state.setdefault('_reserved', {})  # source inventory_id -> earmarked t
        key = _inv_id(task['material_grade'], task['source_location'])
        available = (stack['usable_t'] if stack else 0.0) - reserved.get(key, 0.0)
        if stack is None or available < task['tonnes']:
            state['events'].append({'tick': state['tick'],
                'event': f"charge task {task['task_id']} refused: source stack short"})
            return None
        reserved[key] = reserved.get(key, 0.0) + task['tonnes']
    state['tasks'].append(dict(task, status='queued'))
    return task['task_id']

def _next_queued(state):
    # FIFO within equal priority; player priority reorders queued tasks only.
    queued = [t for t in state['tasks'] if t['status'] == 'queued']
    if not queued:
        return None
    queued.sort(key=lambda t: (t['priority'], state['tasks'].index(t)))
    return queued[0]

def tick(state, fx, player_priority=None):
    """state -> new_state; never mutates the original."""
    s = json.loads(json.dumps(state))  # deep copy, pure tick
    s['tick'] += 1
    ev = []

    # 1) Truck arrival -> RECEIVING_AREA inventory + receiving task
    for load in fx['scenario']['truck_loads']:
        if load['tick'] == s['tick']:
            grade = load['grade']
            loc = 'RECEIVING_AREA'
            iid = _inv_id(grade, loc)
            inv = s['inventories'].setdefault(iid, {
                'inventory_id': iid, 'grade': grade, 'location': loc,
                'delivered_t': 0.0, 'usable_t': 0.0,
                'usable_yield_factor': 1.0,
                'bulk_density_kg_m3': fx['bulk_density_kg_m3'][grade]['value'],
            })
            inv['delivered_t'] += load['tonnes']
            inv['usable_t'] += load['tonnes']
            stack = f"{grade.upper()}_STACK"
            # stack inventory created at arrival (material physically on the yard)
            s['inventories'].setdefault(_inv_id(grade, stack), {
                'inventory_id': _inv_id(grade, stack), 'grade': grade, 'location': stack,
                'delivered_t': 0.0, 'usable_t': 0.0,
                'usable_yield_factor': 1.0,
                'bulk_density_kg_m3': fx['bulk_density_kg_m3'][grade]['value'],
            })
            enqueue_task(s, {
                'task_id': f"T{s['tick']}-{grade}", 'task_type': 'receiving',
                'material_grade': grade, 'source_location': loc, 'destination_location': stack,
                'grab_volume_m3': fx['scenario']['crane_grab_volume_m3'],
                'estimated_duration': _grabs(load['tonnes'], fx['bulk_density_kg_m3'][grade]['value'],
                                             fx['scenario']['crane_grab_volume_m3']),
                # Option A (Yasser-approved 2026-10-15): charge tasks outrank
                # receiving work via task priority. Receiving tasks are lower
                # priority than charging tasks (player-built, priority 0).
                'priority': 2, 'status': 'queued',
                'tonnes': load['tonnes'],
            })
            ev.append(f"truck arrives {grade} {load['tonnes']}t -> RECEIVING_AREA")

    # 2) Competing yard task (scenario event)
    comp = fx['scenario'].get('competing_task')
    if comp and comp['tick'] == s['tick']:
        enqueue_task(s, {
            'task_id': f"T{comp['tick']}-reclaim", 'task_type': 'reclaiming',
            'material_grade': None, 'source_location': 'HMS1_HMS2_STACK',
            'destination_location': 'HMS1_HMS2_STACK',
            'grab_volume_m3': fx['scenario']['crane_grab_volume_m3'],
            'estimated_duration': 9, 'priority': 1, 'status': 'queued', 'tonnes': 0.0,
        })
        ev.append("competing reclaim task enters crane queue")

    # 3) Player priority action (queued tasks only — non-preemptive)
    if player_priority:
        for t in s['tasks']:
            if t['status'] == 'queued' and t['task_id'] in player_priority:
                t['priority'] = player_priority[t['task_id']]

    # 4) Crane: non-preemptive cycle
    if s['crane_busy_task_id'] is None:
        nxt = _next_queued(s)
        if nxt:
            nxt['status'] = 'running'
            s['crane_busy_task_id'] = nxt['task_id']
            s['crane_remaining_ticks'] = nxt['estimated_duration']
            ev.append(f"crane starts {nxt['task_type']} {nxt['task_id']} ({nxt['estimated_duration']} ticks)")
    else:
        s['crane_remaining_ticks'] -= 1
        if s['crane_remaining_ticks'] == 0:
            task = next(t for t in s['tasks'] if t['task_id'] == s['crane_busy_task_id'])
            task['status'] = 'completed'
            # move material: source inventory -> destination inventory
            if task['tonnes'] > 0:
                src = s['inventories'][_inv_id(task['material_grade'], task['source_location'])]
                dst_iid = _inv_id(task['material_grade'], task['destination_location'])
                dst = s['inventories'].setdefault(dst_iid, {
                    'inventory_id': dst_iid, 'grade': task['material_grade'],
                    'location': task['destination_location'], 'delivered_t': 0.0, 'usable_t': 0.0,
                    'usable_yield_factor': src['usable_yield_factor'],
                    'bulk_density_kg_m3': src['bulk_density_kg_m3'],
                })
                src['usable_t'] -= task['tonnes']
                src['delivered_t'] -= task['tonnes']
                dst['usable_t'] += task['tonnes']
                dst['delivered_t'] += task['tonnes']
                # release this task's earmark (the transfer above is the single
                # physical consumption; reservation -> consumed exactly once)
                if task.get('destination_location', '').startswith('CHARGING_BUCKET_'):
                    rkey = _inv_id(task['material_grade'], task['source_location'])
                    s['_reserved'][rkey] -= task['tonnes']
            s['crane_busy_task_id'] = None
            ev.append(f"crane completes {task['task_type']} {task['task_id']}")

    # 5) Charge readiness: per-charge bucket contents vs recipe; consume on ready
    for ch in s['charges']:
        if ch['status'] in ('ready', 'delivered', 'failed'):
            continue
        recipe = next(r for r in fx['scenario']['recipes'] if r['recipe_id'] == ch['recipe_id'])
        bucket_key = f"CHARGING_BUCKET_{ch['charge_id']}"
        ok = True
        for comp_row in recipe['composition']:
            bucket = s['inventories'].get(_inv_id(comp_row['grade'], bucket_key))
            actual = bucket['usable_t'] if bucket else 0.0
            ch['grade_composition'][comp_row['grade']] = actual
            if actual < comp_row['required_usable_t']:
                ok = False
        if ok:
            ch['status'] = 'ready'
            ch['readiness_timestamp'] = s['tick']
            # consume: charge delivered to EAF interface
            for comp_row in recipe['composition']:
                bucket = s['inventories'][_inv_id(comp_row['grade'], bucket_key)]
                bucket['usable_t'] -= comp_row['required_usable_t']
            ev.append(f"charge {ch['charge_id']} READY at tick {s['tick']}")
        elif s['tick'] > ch['deadline']:
            # cause attribution
            recipe = next(r for r in fx['scenario']['recipes'] if r['recipe_id'] == ch['recipe_id'])
            cause = 'crane_delay'
            for comp_row in recipe['composition']:
                # total delivered of that grade anywhere by deadline
                total = sum(i['delivered_t'] for i in s['inventories'].values()
                            if i['grade'] == comp_row['grade'])
                # grade never arrived at all
                arrived_any = any(l['grade'] == comp_row['grade'] and l['tick'] <= ch['deadline']
                                  for l in fx['scenario']['truck_loads'])
                if not arrived_any:
                    cause = 'grade_shortage'
                    break
                if total < comp_row['required_usable_t']:
                    cause = 'grade_shortage'
                    break
                bucket = s['inventories'].get(_inv_id(comp_row['grade'], f"CHARGING_BUCKET_{ch['charge_id']}"))
                if (bucket or {'usable_t': 0})['usable_t'] < comp_row['required_usable_t']:
                    cause = 'insufficient_usable_tonnage'
            ch['status'] = 'failed'
            ch['failure_cause'] = cause
            ev.append(f"charge {ch['charge_id']} FAILED at deadline {ch['deadline']}: {cause}")

    s['events'].extend({'tick': s['tick'], 'event': e} for e in ev)
    return s

def run(fx, priority_plan=None, charge_plan=None):
    """Run the scenario; priority_plan maps tick -> {task_id: priority}.
    charge_plan maps tick -> list of (task_id, tonnes, grade); the task_id prefix
    P1/P2/P3 routes the tonnage to that charge's own bucket (CHARGING_BUCKET_Cn)
    so the reservation guard sees a real per-charge destination."""
    state = fresh_state(fx)
    for ch in fx['scenario']['charge_plan']:
        state['charges'].append({
            'charge_id': ch['charge_id'], 'recipe_id': ch['recipe_id'],
            'grade_composition': {}, 'readiness_timestamp': None,
            'deadline': ch['deadline_tick'], 'status': 'planning', 'failure_cause': None,
        })
    records = []
    for _ in range(fx['scenario']['ticks']):
        # player builds charge tasks from stacks to bucket (the player's verb)
        for tid, tonnes, grade in (charge_plan or {}).get(state['tick'] + 1, []):
            cid = {'P1': 'C1', 'P2': 'C2', 'P3': 'C3'}[tid.split('-')[0]]
            enqueue_task(state, {
                'task_id': tid, 'task_type': 'charging',
                'material_grade': grade, 'source_location': f"{grade.upper()}_STACK",
                'destination_location': f'CHARGING_BUCKET_{cid}',
                'grab_volume_m3': fx['scenario']['crane_grab_volume_m3'],
                'estimated_duration': _grabs(tonnes, fx['bulk_density_kg_m3'][grade]['value'],
                                             fx['scenario']['crane_grab_volume_m3']),
                'priority': 0, 'status': 'queued', 'tonnes': tonnes,
            })
        plan = (priority_plan or {}).get(state['tick'] + 1)
        state = tick(state, fx, plan)
        records.append({
            'tick': state['tick'],
            'crane_busy': state['crane_busy_task_id'],
            'queued': [t['task_id'] for t in state['tasks'] if t['status'] == 'queued'],
            'charges': {c['charge_id']: c['status'] for c in state['charges']},
            'bucket': {i['grade']: round(i['usable_t'], 2) for i in state['inventories'].values()
                       if i['location'].startswith('CHARGING_BUCKET')},
            'events': [e['event'] for e in state['events'] if e['tick'] == state['tick']],
        })
    statuses = [c['status'] for c in state['charges']]
    state['win'] = all(st in ('ready', 'delivered') for st in statuses)
    return state, records

if __name__ == '__main__':
    fx = load_fixture()
    # Feasibility check (standing rule): prove a winning sequence exists BEFORE
    # shipping the fixture. Honest stacked-material plan at the landed parameters
    # (grab 2.0 m3, deadlines 240/270/300, ticks 300): every charge task moves
    # tonnage that is physically stacked (receiving precedes charging) into its
    # own CHARGING_BUCKET_Cn; the reservation guard accepts it and the single
    # non-preemptive crane runs the six tasks back-to-back.
    #   C1: hms 30t (7 grabs, stack ready from truck@12) enqueued 41 -> completes
    #       84; bushing 15t (4 grabs, stack ready from truck@24) enqueued 86 ->
    #       completes 101 -> C1 ready@101 < 240.
    #   C2: hms 30t enqueued 141 -> completes 184; bushing 15t enqueued 186 ->
    #       completes 201 -> C2 ready@201 < 270.
    #   C3: hms 30t enqueued 231 -> completes 274; bushing 15t enqueued 276 ->
    #       completes 291 -> C3 ready@291 <= 300 (slack 9).
    # Competing reclaim (queued at 40, priority 1) is deprioritized to 2 for the
    # duration; it runs in a crane-idle window and does not delay any charge.
    # Player must NOT double-charge: each charge's moves are enqueued once.
    charge_plan = {
        41:  [('P1-hms', 30.0, 'hms1_hms2')],
        86:  [('P1-bush', 15.0, 'bushing')],
        141: [('P2-hms', 30.0, 'hms1_hms2')],
        186: [('P2-bush', 15.0, 'bushing')],
        231: [('P3-hms', 30.0, 'hms1_hms2')],
        276: [('P3-bush', 15.0, 'bushing')],
    }
    priority_plan = {t: {'T40-reclaim': 2} for t in range(41, 301)}
    state, records = run(fx, priority_plan, charge_plan)
    print(f"scenario: {fx['fixture_id']}")
    print(f"win: {state['win']}")
    for c in state['charges']:
        print(f"  {c['charge_id']}: {c['status']}" + (f" cause={c['failure_cause']}" if c['failure_cause'] else f" ready@{c['readiness_timestamp']} deadline={c['deadline']}"))
    print(f"events: {len(state['events'])}")
    # negative control: without the player's charge tasks nothing reaches any
    # charge bucket -> C1/C2 fail insufficient_usable_tonnage at their deadlines.
    state2, _ = run(fx, {}, {})
    for c in state2['charges']:
        print(f"negative control (no charge tasks): {c['charge_id']} {c['status']} cause={c['failure_cause']}")
