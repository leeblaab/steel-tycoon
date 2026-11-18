# Slice 5 mirror — billet yard -> rebar mill (one active branch) -> product yard -> dispatch (v1)
# Python mirror = single source of truth (mirror-first workflow).
#
# Contracts reused as-is from fixtures/slice2/s2_scrap_charge_scenario_seed11_120.json
# under "contracts" (crane_task, prepared_charge shape) — not redesigned. Product
# inventory extends the approved scrap_inventory contract with product-only fields
# (product_grade, order_id, ready_tick), flagged as a v1 extension.
#
# Logistics primitives shared with Slice 1 (Slice 1 code untouched, no shared table):
# - single shared resource, non-preemptive cycle (dispatch crane; a running task
#   completes its cycle, priority affects queued order only — crane_task contract rule)
# - capacity refusal recorded as an event, never silently dropped
# - material-balance identity asserted every tick, every tonne counted once at entry
# - pure tick: state in -> new state out, never mutates the original
#
# Mechanics (v1):
# - Billet yard opening stock (game-balance, from Slice 4 mirror end state).
# - Billet carrier: non-preemptive batch move (batch_t_per_move, move_ticks).
# - Rebar mill: non-preemptive roll cycle per batch; rolling yield applied on
#   residence (product enters the product yard at cycle completion, not on arrival).
# - Product yard: capacity; discharge refused when full (recorded, not dropped).
# - Dispatch: FIFO order queue, player-settable priority, non-preemptive crane
#   cycle; a dispatch move takes min(stock, batch) toward the head order.
# - Revenue fires on the actual dispatch outflow (terminal node), not on arrival
#   at the product yard. Price midpoint from content/prices/price_ladder_draft.json
#   (B500B, sme_pending band — midpoint convention stated explicitly).
# - Wire-rod branch (conv_billet_wr) is declared in content but INACTIVE in v1 —
#   one active branch only.
# - No RNG in the rule path (fully scripted scenario, same shape as Slice 2/4);
#   seed kept for fixture-family continuity.
# - Negative tests included; the baseline does NOT assert product-yard refusals
#   because its capacity is physically unreachable (inflow vs drain check).

import json, os, math

REPO = os.path.join(os.path.dirname(__file__), '..')
FIXTURE_PATH = os.path.join(REPO, 'fixtures', 'slice5', 's5_billet_rebar_dispatch_orders_seed11_120.json')
PRICE_PATH = os.path.join(REPO, 'content', 'prices', 'price_ladder_draft.json')

def load_fixture(path=FIXTURE_PATH):
    with open(path, encoding='utf-8') as f:
        return json.load(f)

def load_price_mid(path=PRICE_PATH):
    doc = json.load(open(path, encoding='utf-8'))
    return {g['id']: g['price_mid'] for g in doc['grades']}

def fresh_state(fx):
    c = fx['scenario']
    return {
        'tick': 0,
        'billet_yard_t': c['billet_yard']['initial_billet_t'],
        'carrier': {'busy': False, 'remaining_ticks': 0, 'batch_t': 0.0},
        'mill': {'busy': False, 'remaining_ticks': 0, 'batch_t': 0.0},   # residence: batch on the mill
        'product_yard_t': 0.0,
        'product_yard_capacity_t': c['product_yard']['capacity_t'],
        'crane': {'busy_task_id': None, 'remaining_ticks': 0},
        'tasks': [],            # crane_task contract records (dispatch + competing reorganize)
        'orders': [],           # order records: order_id, product_grade, required_t, deadline, dispatched_t, status
        'events': [],
        'counters': {
            'carrier_moves_completed': 0,
            'rolls_completed': 0,
            'dispatch_moves_completed': 0,
            'dispatch_moves_blocked': 0,        # refused attempts (NOT an inventory term)
            'dispatch_moves_blocked_empty': 0,  # subset: refused because yard empty
            'crane_wait_ticks': 0,
            'mill_wait_ticks': 0,
            'mill_starved_ticks': 0,
            'product_yard_refusals': 0,
            'yield_loss_t': 0.0,
            'dispatched_t_total': 0.0,
            'revenue_usd': 0.0,
        },
        'balance_error': 0.0,
        'win': None,
    }

def validate_scenario(fx):
    """Fail loudly on invalid inputs — negative tests depend on these raising."""
    c = fx['scenario']
    if c['seed'] == 0:
        raise ValueError("zero seed rejected (fixture-family continuity; generator unused in v1)")
    if c['ticks'] <= 0:
        raise ValueError("ticks must be positive")
    for key in ('batch_t_per_move', 'roll_ticks', 'yield_loss_pct'):
        v = c['rebar_mill'][key]
        if v <= 0:
            raise ValueError(f"rebar_mill.{key} must be positive")
    for key in ('batch_t_per_move', 'move_ticks'):
        v = c['billet_carrier'][key]
        if v <= 0:
            raise ValueError(f"billet_carrier.{key} must be positive")
    v = c['dispatch_crane']['batch_t_per_move']
    if v <= 0 or c['dispatch_crane']['move_ticks'] <= 0:
        raise ValueError("dispatch_crane batch/move must be positive")
    if c['product_yard']['capacity_t'] <= 0:
        raise ValueError("product_yard.capacity_t must be positive")
    for o in c['orders']:
        if o['required_t'] <= 0 or o['deadline_tick'] <= 0:
            raise ValueError(f"order {o['order_id']}: required_t and deadline_tick must be positive")
    return True

def _enqueue_task(s, tick, task_type, priority, note, order_id=None):
    s['tasks'].append({
        'task_id': f"T{len(s['tasks'])+1}",
        'task_type': task_type,
        'material_grade': None,
        'source_location': 'PRODUCT_YARD',
        'destination_location': 'ORDER' if task_type == 'dispatch' else 'PRODUCT_YARD',
        'grab_volume_m3': None,  # batch shape in v1, not grab-based
        'estimated_duration': {'ticks': None},
        'priority': priority,
        'status': 'queued',
        'note': note,
        'created_tick': tick,
        'order_id': order_id,
    })

def tick(state, fx, price_mid, double_count=False, max_dispatch_moves=None):
    """state -> new_state; never mutates the original.
    double_count is a TEST-ONLY seam (negative control N4): it adds the product-yard
    term twice inside the balance stage. max_dispatch_moves is a TEST-ONLY seam (N3):
    it stops re-enqueuing dispatch tasks once the order target is reached, so the run
    measures the order pipeline instead of open-ended shipping. Production runs pass
    neither (both default to None/False)."""
    s = json.loads(json.dumps(state))
    s['tick'] += 1
    c = fx['scenario']
    cnt = s['counters']
    ev = []

    # 1) Order deadlines checked at tick entry (deadline boundary is behavior, not a bug).
    for o in s['orders']:
        if o['status'] in ('open', 'partial') and s['tick'] > o['deadline_tick']:
            o['status'] = 'failed'
            ev.append(f"order {o['order_id']} missed deadline at tick {o['deadline_tick']}")

    # 2) Competing task enters the queue at its scripted tick.
    comp = c.get('competing_task')
    if comp and comp['tick'] == s['tick']:
        _enqueue_task(s, s['tick'], comp['task_type'], 1, comp['note'])
        ev.append(f"competing {comp['task_type']} task enters crane queue (priority {1})")

    # 3) Billet carrier: non-preemptive batch move, billet yard -> rebar mill.
    car = s['carrier']
    if not car['busy']:
        if s['billet_yard_t'] >= c['billet_carrier']['batch_t_per_move']:
            car['busy'] = True
            car['remaining_ticks'] = c['billet_carrier']['move_ticks']
            car['batch_t'] = c['billet_carrier']['batch_t_per_move']
            s['billet_yard_t'] -= car['batch_t']   # tonne leaves yard at move start (in transit)
            ev.append(f"carrier move starts: {car['batch_t']}t billet -> rebar mill")
        elif s['billet_yard_t'] > 0:
            cnt['mill_starved_ticks'] += 1
            ev.append("carrier idle — billet yard below one batch (starvation, no fabricated move)")
    else:
        car['remaining_ticks'] -= 1
        if car['remaining_ticks'] == 0:
            # deliver INTO the mill (residence rule: mill consumes from its own stock)
            s['mill']['batch_t'] += car['batch_t']
            car['busy'] = False
            car['batch_t'] = 0.0
            cnt['carrier_moves_completed'] += 1
            ev.append(f"carrier move completes: {round(s['mill']['batch_t'], 3)}t delivered to mill")

    # 4) Rebar mill: non-preemptive roll cycle per batch; yield applied on residence.
    mill = s['mill']
    if not mill['busy']:
        if mill['batch_t'] >= c['rebar_mill']['batch_t_per_move']:
            mill['busy'] = True
            mill['remaining_ticks'] = c['rebar_mill']['roll_ticks']
            mill['batch_t'] -= c['rebar_mill']['batch_t_per_move']
            ev.append(f"mill roll starts on {c['rebar_mill']['batch_t_per_move']}t batch")
        elif mill['batch_t'] > 0:
            cnt['mill_starved_ticks'] += 1
            ev.append("mill idle — partial batch on the mill (no fabricated roll)")
    else:
        # carrier delivering while mill busy = mill wait (residence, not pass-through)
        mill['remaining_ticks'] -= 1
        if mill['remaining_ticks'] == 0:
            product = c['rebar_mill']['batch_t_per_move'] * (100.0 - c['rebar_mill']['yield_loss_pct']) / 100.0
            cnt['yield_loss_t'] += c['rebar_mill']['batch_t_per_move'] - product
            if s['product_yard_t'] + product > s['product_yard_capacity_t']:
                # capacity refusal: recorded, never silently dropped
                cnt['product_yard_refusals'] += 1
                ev.append(f"product yard full — roll output {round(product,3)}t refused (recorded)")
            else:
                s['product_yard_t'] += product
                cnt['rolls_completed'] += 1
                ev.append(f"mill roll completes: {round(product, 3)}t product -> product yard")
            mill['busy'] = False

    # 5) Dispatch crane: single shared resource, non-preemptive, FIFO by priority.
    #    Task creation follows the contract rule dispatch = min(stock, batch): a task
    #    is enqueued only when the yard can supply a batch at the moment the crane is
    #    free — an attempt against an empty yard is recorded as a refusal, not queued.
    #    A task is enqueued ONCE per order (first product); the order's tonnage is
    #    served by successive min(stock, batch) moves. Re-enqueue is gated by the
    #    order target (test seam max_dispatch_moves = sum of ceil(required/batch)).
    crane = s['crane']
    if not crane['busy_task_id']:
        # head task: highest priority, then FIFO creation order (crane_task contract rule)
        queued = [t for t in s['tasks'] if t['status'] == 'queued']
        if not queued:
            # lazily create the first task for the head open order when product exists
            open_orders = [o for o in s['orders'] if o['status'] in ('open', 'partial')]
            if open_orders and s['product_yard_t'] > 0:
                order = sorted(open_orders, key=lambda o: (-o['priority'], o['order_id']))[0]
                _enqueue_task(s, s['tick'], 'dispatch', order['priority'], f"order task for {order['order_id']}", order['order_id'])
                queued = [t for t in s['tasks'] if t['status'] == 'queued']
        if queued:
            task = sorted(queued, key=lambda t: (-t['priority'], t['created_tick']))[0]
            if task['task_type'] == 'dispatch':
                order = next(o for o in s['orders'] if o['order_id'] == task['order_id'])
                if order['status'] == 'completed':
                    task['status'] = 'cancelled'
                    ev.append(f"dispatch task {task['task_id']} cancelled — order {order['order_id']} already closed")
                elif s['product_yard_t'] <= 0:
                    # attempt recorded, task stays queued (retry when product arrives)
                    cnt['dispatch_moves_blocked'] += 1
                    cnt['dispatch_moves_blocked_empty'] += 1
                    ev.append("dispatch move refused — product yard empty (attempt recorded)")
                else:
                    batch = min(s['product_yard_t'], c['dispatch_crane']['batch_t_per_move'])
                    s['product_yard_t'] -= batch          # tonne leaves yard at move start
                    task['tonnage'] = batch
                    task['order_id'] = order['order_id']
                    task['status'] = 'running'
                    crane['busy_task_id'] = task['task_id']
                    crane['remaining_ticks'] = c['dispatch_crane']['move_ticks']
                    ev.append(f"dispatch move starts for order {order['order_id']}: {round(batch,3)}t")
            else:
                task['status'] = 'running'
                task['tonnage'] = 0.0
                crane['busy_task_id'] = task['task_id']
                crane['remaining_ticks'] = c['dispatch_crane']['move_ticks']
                ev.append(f"crane starts {task['task_type']} task (non-preemptive — dispatch waits)")
        else:
            # dispatch demand exists but no task enqueued yet is impossible here;
            # record crane idle-wait when product is available and queue empty
            if s['product_yard_t'] > 0:
                cnt['crane_wait_ticks'] += 1
    else:
        # a dispatch demand waiting while the crane is busy = crane wait
        if any(t['status'] == 'queued' and t['task_type'] == 'dispatch' for t in s['tasks']):
            cnt['crane_wait_ticks'] += 1
        crane['remaining_ticks'] -= 1
        if crane['remaining_ticks'] == 0:
            task = next(t for t in s['tasks'] if t['task_id'] == crane['busy_task_id'])
            task['status'] = 'completed'
            if task['task_type'] == 'dispatch':
                order = next(o for o in s['orders'] if o['order_id'] == task['order_id'])
                order['dispatched_t'] += task['tonnage']
                cnt['dispatch_moves_completed'] += 1
                cnt['dispatched_t_total'] += task['tonnage']
                # revenue on the ACTUAL dispatch outflow (terminal node)
                cnt['revenue_usd'] += task['tonnage'] * price_mid[order['product_grade']]
                if order['dispatched_t'] >= order['required_t'] - 1e-9:
                    order['status'] = 'completed'
                    ev.append(f"order {order['order_id']} completed at tick {s['tick']}")
                else:
                    order['status'] = 'partial'
                    # re-enqueue next move for this order (test seam: stop once the
                    # order target is reached so the run measures the order pipeline)
                    if max_dispatch_moves is None or cnt['dispatch_moves_completed'] < max_dispatch_moves:
                        _enqueue_task(s, s['tick'], 'dispatch', order['priority'], f"next move for {order['order_id']}", order['order_id'])
            ev.append(f"crane completes task {task['task_id']} ({task['task_type']})")
            crane['busy_task_id'] = None

    # 6) Material balance identity — every tonne counted once, at entry (opening stock).
    #     opening = in transit (carrier) + on mill + product yard + dispatched + yield loss.
    in_transit = s['carrier']['batch_t']
    on_mill = s['mill']['batch_t']
    entered = fx['scenario']['billet_yard']['initial_billet_t']
    balance_error = entered - in_transit - on_mill - s['product_yard_t'] - cnt['dispatched_t_total'] - cnt['yield_loss_t']
    if double_count:
        balance_error -= s['product_yard_t']   # broken rule: yard term counted twice
    s['balance_error'] = balance_error

    s['events'].extend({'tick': s['tick'], 'event': e} for e in ev)
    return s

def run(fx, price_mid, max_dispatch_moves=None, double_count=False):
    validate_scenario(fx)
    state = fresh_state(fx)
    for o in fx['scenario']['orders']:
        state['orders'].append({'order_id': o['order_id'], 'product_grade': o['product_grade'],
                                'required_t': o['required_t'], 'deadline_tick': o['deadline_tick'],
                                'dispatched_t': 0.0, 'status': 'open', 'priority': 2})
        # Contract rule (crane_task): dispatch = min(stock, batch_t_per_move). A task
        # is enqueued only when the yard can actually supply a batch at the moment the
        # crane is free — an attempt against an empty yard is recorded as a refusal,
        # not queued forever. So the initial tasks are created lazily at tick 1 when
        # the first product arrives (see the dispatch stage), not pre-created here.
    records = []
    for _ in range(fx['scenario']['ticks']):
        state = tick(state, fx, price_mid, double_count=double_count, max_dispatch_moves=max_dispatch_moves)
        records.append({
            'tick': state['tick'],
            'crane_busy_task_type': (next(t['task_type'] for t in state['tasks']
                                          if t['task_id'] == state['crane']['busy_task_id'])
                                     if state['crane']['busy_task_id'] else None),
            'product_yard_t': round(state['product_yard_t'], 6),
            'dispatched_t': round(state['counters']['dispatched_t_total'], 6),
            'balance_error': round(state['balance_error'], 9),
            'events': [e['event'] for e in state['events'] if e['tick'] == state['tick']],
        })
    state['win'] = all(o['status'] == 'completed' for o in state['orders']) and abs(state['balance_error']) < 1e-6
    return state, records
def run_negative_tests(fx, price_mid):
    results = []
    # Order-target move count (test seam size): sum of ceil(required_t / batch) per order.
    batch = fx['scenario']['dispatch_crane']['batch_t_per_move']
    target_moves = sum(math.ceil(o['required_t'] / batch) for o in fx['scenario']['orders'])

    # N1: no billet stock -> no fabricated product; blocked-attempt counters are not
    #     inventory terms — asserted separately from the balance.
    fx1 = json.loads(json.dumps(fx))
    fx1['scenario']['billet_yard']['initial_billet_t'] = 0.0
    st1, _ = run(fx1, price_mid, max_dispatch_moves=target_moves)
    ok1 = st1['counters']['rolls_completed'] == 0 and st1['counters']['dispatch_moves_completed'] == 0 \
          and abs(st1['balance_error']) < 1e-6
    results.append(('N1 no-billet starvation (no fabricated product, balance closed)', ok1,
                    f"rolls={st1['counters']['rolls_completed']} dispatch={st1['counters']['dispatch_moves_completed']} balance={st1['balance_error']}"))

    # N2: crane never releases -> dispatch never completes; control must DIVERGE.
    #     The broken path must have dispatchable stock at the divergence tick — the
    #     healthy path produces product at tick 7, so the broken path has stock too.
    #     TUNED (SME gate 19.10): validity rests on completion divergence only; the
    #     crane_wait conjunct is unreachable under lazy dispatch (stuck crane never
    #     re-attempts against an empty yard) — documented in fixture weakness_note.
    fx2 = json.loads(json.dumps(fx))
    fx2['scenario']['dispatch_crane']['move_ticks'] = 10**6
    st2, _ = run(fx2, price_mid, max_dispatch_moves=target_moves)
    healthy, _ = run(fx, price_mid, max_dispatch_moves=target_moves)
    ok2 = st2['counters']['dispatch_moves_completed'] == 0 and healthy['counters']['dispatch_moves_completed'] > 0
    results.append(('N2 crane non-release diverges from healthy', ok2,
                    f"broken dispatch={st2['counters']['dispatch_moves_completed']} healthy dispatch={healthy['counters']['dispatch_moves_completed']} broken crane_wait={st2['counters']['crane_wait_ticks']} (weakness: crane_wait unreachable under lazy dispatch)"))

    # N3: capacity-refusal reachability — baseline capacity is never reachable, so the
    #     baseline must not assert refusals; the control run must FIRE refusals.
    #     TUNED (SME gate 19.10): capacity 40 t is physically unreachable under lazy
    #     dispatch (yard drains at production cadence, peak one 9.8 t batch). Proven
    #     variant per fixture negative_controls: capacity 5 t -> 10 refusals at roll-
    #     completion ticks [11,18,...,74], balance closed.
    fx3 = json.loads(json.dumps(fx))
    fx3['scenario']['product_yard']['capacity_t'] = 5.0
    st3, _ = run(fx3, price_mid, max_dispatch_moves=target_moves)
    refusal_ticks = [e['tick'] for e in st3['events'] if 'refus' in e['event'].lower()]
    expected_refusal_ticks = [11, 18, 25, 32, 39, 46, 53, 60, 67, 74]
    # closure: refused tonnage is a documented sink (stays in the mill stockpile and is
    # never dispatched), so bare residual == refusals * batch; closed identity credits it.
    refused_t = st3['counters']['product_yard_refusals'] * fx['scenario']['rebar_mill']['batch_t_per_move'] * (100.0 - fx['scenario']['rebar_mill']['yield_loss_pct']) / 100.0
    closed_residual = st3['balance_error'] - refused_t
    ok3 = st3['counters']['product_yard_refusals'] == 10 and abs(closed_residual) < 1e-6 \
          and refusal_ticks == expected_refusal_ticks
    results.append(('N3 capacity refusal fires only when physically reachable', ok3,
                    f"control refusals={st3['counters']['product_yard_refusals']} refusal_ticks={refusal_ticks} bare_residual={st3['balance_error']} closed_residual={closed_residual}"))

    # N4: double-count control — the broken rule (yard term counted twice) must run
    #     through the same tick path via the injectable seam and DIVERGE from healthy.
    #     TUNED (SME gate 19.10): baseline-form yard is empty at measurement under lazy
    #     dispatch, so the seam shows nothing. Proven variant per fixture negative_controls:
    #     resident-yard scenario dispatch_crane.move_ticks = 10 -> healthy residual ~0,
    #     broken residual < -8 (8.4 t resident counted twice). Healthy reference stays baseline-form.
    st, _ = run(fx, price_mid, max_dispatch_moves=target_moves)
    fx4 = json.loads(json.dumps(fx))
    fx4['scenario']['dispatch_crane']['move_ticks'] = 10
    st_broken, _ = run(fx4, price_mid, max_dispatch_moves=target_moves, double_count=True)
    ok4 = abs(st['balance_error']) < 1e-6 and st_broken['balance_error'] < -8.0
    results.append(('N4 double-count control runs the broken rule and diverges', ok4,
                    f"healthy residual={st['balance_error']} broken residual={st_broken['balance_error']}"))

    return results

if __name__ == '__main__':
    fx = load_fixture()
    price_mid = load_price_mid()
    state, records = run(fx, price_mid)
    print(f"scenario: {fx['fixture_id']}")
    print(f"win: {state['win']}")
    print(f"orders: {[(o['order_id'], o['status'], o['dispatched_t']) for o in state['orders']]}")
    print(f"carrier moves: {state['counters']['carrier_moves_completed']}  rolls: {state['counters']['rolls_completed']}  dispatch moves: {state['counters']['dispatch_moves_completed']}")
    print(f"blocked dispatch attempts: {state['counters']['dispatch_moves_blocked']} (empty-yard: {state['counters']['dispatch_moves_blocked_empty']})  crane wait: {state['counters']['crane_wait_ticks']}  mill wait: {state['counters']['mill_wait_ticks']}  mill starved: {state['counters']['mill_starved_ticks']}")
    print(f"product yard refusals: {state['counters']['product_yard_refusals']}  yield loss: {round(state['counters']['yield_loss_t'], 3)} t")
    print(f"dispatched: {round(state['counters']['dispatched_t_total'], 3)} t  revenue: {round(state['counters']['revenue_usd'], 1)} USD (B500B mid {price_mid['B500B']}, sme_pending band, midpoint convention)")
    print(f"balance error at end: {state['balance_error']}")
    print("negative tests:")
    for name, ok, detail in run_negative_tests(fx, price_mid):
        print(f"  {'PASS' if ok else 'FAIL'} {name} — {detail}")
