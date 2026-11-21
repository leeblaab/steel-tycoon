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

# S5.1 mill-process view (PLAN_FORGED Stage 5): the shared contract driving the mill
# animation (S5.4) AND the cutaway cards. PURE DERIVATION from the existing roll-cycle
# countdown (S2.0 heat-phase pattern) — no new timing rules: roll start/completion ticks,
# existing events/counters, dispatch, revenue and the balance identity are UNCHANGED.
# New outputs are ADDITIVE: mill.phase/phase_progress/route state fields, reheat-discharge
# / shear / bundle events + counters, and pure view functions (mill_process_view,
# product_yard_view). The v1 roll cycle compresses reheat -> stands -> cooling bed ->
# shear/bundle into one 6-tick cycle; the phase bands expose that internal rhythm for
# presentation. Real bar-mill residence order: reheat soak longest (60-120 min), rolling
# minutes, cooling bed 10-30 min, shear/strap seconds-minutes. Design bands, sme_pending
# (SME calibrates). All four bands are observable at roll_ticks=6 (frac samples 0..5/6).
MILL_PHASE_BANDS = (('reheat', 0.0, 0.30), ('rolling', 0.30, 0.55), ('cooling', 0.55, 0.80), ('shear', 0.80, 1.0))
# Visual mass-flow continuity cue ("the bar gets longer as it thins", S5.4). Game-balance
# design value, NOT industry fact: real billet->rebar total elongation is ~100-150x from
# the pass schedule (Phase 2 upgrade path); 12x reads at diorama scale. sme_pending.
ELONGATION_TOTAL = 12.0
# Two product routes (F-08): rebar LIVE, wire rod DEFINED-BUT-IDLE so routing drops in
# later as a switch. Tonnage-only interface; bundle/coil counts are presentation views
# (floor division), never an inventory split. Default block used when a scenario omits
# product_routes (pre-S5.1 fixtures/states heal on their first tick). sme_pending values:
# stands_count (rebar 6 per the 6-stand bar mill; wire-rod 10 incl. laying head),
# bundle_t 2.0 t (industry rebar bundles ~2-3 t), coil_t 2.0 t (rod coils ~1.5-3 t).
DEFAULT_PRODUCT_ROUTES = {
    'active': 'rebar',
    'rebar': {'enabled': True, 'stands_count': 6, 'bundle_t': 2.0, 'product_form': 'bundle'},
    'wire_rod': {'enabled': False, 'stands_count': 10, 'coil_t': 2.0, 'product_form': 'coil'},
}

def routes_of(fx):
    """Scenario route block, or the default (absent = pre-S5.1, heals on first tick)."""
    return fx['scenario'].get('product_routes') or DEFAULT_PRODUCT_ROUTES

def mill_phase_view(remaining_ticks, total_ticks):
    """(phase, progress-in-phase) from the roll countdown — same shape as S2.0
    heat_phase_view. remaining==total -> reheat 0.0; remaining==0 is the completion
    tick itself (roll over -> idle, handled by the caller). Raises on non-positive
    total (never silently defaults)."""
    if not total_ticks > 0:
        raise ValueError('rebar_mill.roll_ticks must be positive')
    frac = max(0.0, min(1.0, (total_ticks - remaining_ticks) / total_ticks))
    for name, a, b in MILL_PHASE_BANDS:
        if frac < b or name == 'shear':
            return name, max(0.0, min(1.0, (frac - a) / (b - a)))

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
        'mill': {'busy': False, 'remaining_ticks': 0, 'batch_t': 0.0,   # residence: batch on the mill
                 'phase': None, 'phase_progress': 0.0, 'route': routes_of(fx)['active']},  # S5.1 additive
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
            # S5.1 additive counters (presentation rhythm; never inventory terms)
            'reheat_discharges': 0,
            'shear_cuts': 0,
            'bundles_strapped': 0,
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
    # S5.1 route switch validation (absent block = pre-S5.1 default, never rejected).
    pr = c.get('product_routes')
    if pr is not None:
        if pr.get('active') not in ('rebar', 'wire_rod'):
            raise ValueError(f"unknown product route {pr.get('active')!r} (rebar|wire_rod)")
        if not pr.get('rebar', {}).get('enabled'):
            raise ValueError("rebar route must be enabled (the live v1 branch)")
        if pr.get('wire_rod', {}).get('enabled'):
            raise ValueError("wire-rod route is defined-but-idle in v1 (F-08) — routing drops in later as a switch")
        if pr['active'] != 'rebar':
            raise ValueError("v1 active route must be rebar (wire rod defined-but-idle, F-08)")
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
    s['mill']['route'] = routes_of(fx)['active']  # S5.1: heal restored pre-S5.1 states

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
            # S5.1 additive: reheat discharge glow cue (S5.4) at roll start.
            cnt['reheat_discharges'] += 1
            ev.append(f"reheat discharge: {c['rebar_mill']['batch_t_per_move']}t billet -> stands (route {mill['route']})")
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
                # S5.1 additive: shear+bundle result at completion (presentation view;
                # floor division, loose remainder stays in tonnage — no inventory split).
                rt = routes_of(fx)['rebar']
                n_bundles = int(product // rt['bundle_t'])
                loose_t = product - n_bundles * rt['bundle_t']
                cnt['bundles_strapped'] += n_bundles
                ev.append(f"bundles strapped: {n_bundles} x {rt['bundle_t']}t + {round(loose_t, 3)}t loose (route {mill['route']})")
            mill['busy'] = False

    # S5.1: derive the mill phase enum from the roll countdown (pure presentation
    # contract, S2.0 shape; set unconditionally so restored pre-S5.1 states heal).
    # The shear-cut event fires on the cooling->shear band transition; prev phase is
    # read from the INPUT state (pure state-in, no extra state field).
    prev_phase = state['mill'].get('phase')
    if not mill['busy']:
        mill['phase'] = None
        mill['phase_progress'] = 0.0
    else:
        mill['phase'], mill['phase_progress'] = mill_phase_view(mill['remaining_ticks'], c['rebar_mill']['roll_ticks'])
        if mill['phase'] == 'shear' and prev_phase != 'shear':
            product_t = c['rebar_mill']['batch_t_per_move'] * (100.0 - c['rebar_mill']['yield_loss_pct']) / 100.0
            cnt['shear_cuts'] += 1
            ev.append(f"shear cuts bar to length (route {mill['route']}, {round(product_t, 3)}t batch)")

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
            'mill_phase': state['mill']['phase'],
            'mill_phase_progress': round(state['mill']['phase_progress'], 6),
            'mill_route': state['mill']['route'],
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
def mill_process_view(state, fx):
    """S5.1 pure projection for the mill animation (S5.4) + cutaway cards. Reads state,
    returns a NEW dict; never mutates state or the ledger. Tonnage-only (F-08): bed
    occupancy shows the batch on the mill (residence tonnage); bundle/coil counts are
    floor-division presentation views, never an inventory split. v1 dispatch is NOT
    gated on cooling/bundling — the bed/shear/bundle rhythm lives INSIDE the roll cycle
    (presentation compression); hard process gating = later explicit rule change."""
    c = fx['scenario']
    rt = routes_of(fx)
    route = rt['active']
    cfg = rt[route]
    mill = state['mill']
    phase = mill.get('phase')
    pp = mill.get('phase_progress', 0.0)
    view = {
        'route': route,
        'product_form': cfg['product_form'],
        'phase': phase,
        'phase_progress': pp,
        'stands_count': cfg['stands_count'],
        'stand_progress': None,
        'current_stand': None,
        'elongation_factor': 1.0,
        'bed': None,
        'shearing': phase == 'shear',
    }
    if phase == 'rolling':
        view['stand_progress'] = pp
        view['current_stand'] = min(cfg['stands_count'] - 1, int(pp * cfg['stands_count']))
        view['elongation_factor'] = 1.0 + (ELONGATION_TOTAL - 1.0) * pp
    elif phase == 'cooling':
        view['bed'] = {
            'on_bed_t': c['rebar_mill']['batch_t_per_move'],
            'walk_progress': pp,   # bars step across the walking beam (S5.4)
            'glow': 1.0 - pp,      # hot -> black across the bed; cold shear at exit
        }
    return view

def product_yard_view(state, fx):
    """S5.1 finished-yard presentation view (S5.5): strapped bundles (rebar) or coils
    (wire rod, later) = floor(tonnage / unit_t); loose remainder stays in tonnage.
    Pure; never mutates state. v1 tonnage-only dispatch can split a bundle across
    moves — the view is presentation, not an inventory ledger (F-08)."""
    rt = routes_of(fx)
    cfg = rt[rt['active']]
    unit_t = cfg.get('bundle_t') if cfg['product_form'] == 'bundle' else cfg.get('coil_t')
    yard_t = state['product_yard_t']
    units = int(yard_t // unit_t)
    return {
        'route': rt['active'],
        'product_form': cfg['product_form'],
        'yard_t': yard_t,
        'units': units,
        'unit_t': unit_t,
        'loose_t': yard_t - units * unit_t,
    }

def _seed_orders(fx):
    """Fresh state + orders through the canonical constructor path (run() shape)."""
    st = fresh_state(fx)
    for o in fx['scenario']['orders']:
        st['orders'].append({'order_id': o['order_id'], 'product_grade': o['product_grade'],
                             'required_t': o['required_t'], 'deadline_tick': o['deadline_tick'],
                             'dispatched_t': 0.0, 'status': 'open', 'priority': 2})
    return st

def run_phase_tests(fx, price_mid):
    """S5.1 mill-process contract tests (P1-P4 positive, N5-N9 negative). The enum and
    views are pure derivations: existing timing/events/counters/balance must be UNCHANGED
    (P2 regression pins against the fixture's pre-S5.1 expected_outputs)."""
    results = []
    state, records = run(fx, price_mid)
    exp = fx.get('expected_outputs', {})
    roll_ticks = fx['scenario']['rebar_mill']['roll_ticks']
    by_tick = {r['tick']: r for r in records}

    # P1: phase order per roll cycle (reheat->rolling->cooling->shear) + idle outside.
    starts = [e['tick'] for e in state['events'] if e['event'].startswith('mill roll starts')]
    order_ok = True
    first_cycle = None
    for t0 in starts:
        seq = [by_tick[t]['mill_phase'] for t in range(t0, t0 + roll_ticks) if t in by_tick]
        dedup = []
        for p in seq:
            if not dedup or dedup[-1] != p:
                dedup.append(p)
        if first_cycle is None:
            first_cycle = (t0, dedup)
        if dedup != ['reheat', 'rolling', 'cooling', 'shear']:
            order_ok = False
        if t0 + roll_ticks in by_tick and by_tick[t0 + roll_ticks]['mill_phase'] is not None:
            order_ok = False  # completion tick -> idle
    idle_ok = bool(starts) and all(r['mill_phase'] is None for r in records if r['tick'] < starts[0])
    results.append(('P1 phase order reheat->rolling->cooling->shear per roll, idle outside',
                    order_ok and idle_ok, f"cycles={len(starts)} first={first_cycle} idle_before_first={idle_ok}"))

    # P2: additive event ticks + counters; pre-S5.1 outputs UNCHANGED (fixture pins).
    dis_ticks = [e['tick'] for e in state['events'] if e['event'].startswith('reheat discharge:')]
    shear_ticks = [e['tick'] for e in state['events'] if e['event'].startswith('shear cuts bar')]
    bundle_ticks = [e['tick'] for e in state['events'] if e['event'].startswith('bundles strapped:')]
    comp_ticks = [e['tick'] for e in state['events'] if e['event'].startswith('mill roll completes')]
    product_per_roll = fx['scenario']['rebar_mill']['batch_t_per_move'] * (100.0 - fx['scenario']['rebar_mill']['yield_loss_pct']) / 100.0
    bundles_per_roll = int(product_per_roll // routes_of(fx)['rebar']['bundle_t'])
    trans = [r['tick'] for i, r in enumerate(records)
             if r['mill_phase'] == 'shear' and (i == 0 or records[i - 1]['mill_phase'] != 'shear')]
    ok2 = (dis_ticks == starts and bundle_ticks == comp_ticks and shear_ticks == trans
           and state['counters']['reheat_discharges'] == len(starts)
           and state['counters']['shear_cuts'] == len(starts)
           and state['counters']['bundles_strapped'] == bundles_per_roll * len(starts))
    reg = []
    if exp:
        ev_exp = exp.get('events', {})
        for key, pred in (('carrier_move_starts', 'carrier move starts'),
                          ('mill_roll_completions', 'mill roll completes'),
                          ('dispatch_move_starts', 'dispatch move starts')):
            got = sorted({e['tick'] for e in state['events'] if e['event'].startswith(pred)})
            if key in ev_exp and got != ev_exp[key]:
                reg.append(f"{key}: {got} != {ev_exp[key]}")
        for k, v in exp.get('counters_at_tick_120', {}).items():
            if k == 'revenue_note':
                continue
            if abs(state['counters'][k] - v) > 1e-6:
                reg.append(f"counter {k}: {state['counters'][k]} != {v}")
        if 'win' in exp and state['win'] != exp['win']:
            reg.append('win diverged')
        if abs(state['balance_error']) > 1e-6:
            reg.append('balance not closed')
        mp = exp.get('mill_process')
        if mp:
            if dis_ticks != mp['events']['reheat_discharges']:
                reg.append('mill_process.reheat_discharges pin')
            if shear_ticks != mp['events']['shear_cuts']:
                reg.append('mill_process.shear_cuts pin')
            if bundle_ticks != mp['events']['bundles_strapped']:
                reg.append('mill_process.bundles_strapped pin')
            for k, v in mp['counters_at_tick_120'].items():
                if state['counters'][k] != v:
                    reg.append(f'mill_process counter {k}')
            for kt, snap in mp.get('key_ticks', {}).items():
                r = by_tick.get(int(kt))
                if r is None or r['mill_phase'] != snap['mill_phase']:
                    reg.append(f'mill_process key_tick {kt} phase')
    ok2 = ok2 and not reg
    results.append(('P2 additive events/counters + pre-S5.1 regression unchanged', ok2,
                    f"dis={dis_ticks[:3]}... shear={shear_ticks[:3]}... bundles={bundle_ticks[:3]}... "
                    f"counters={state['counters']['reheat_discharges']}/{state['counters']['shear_cuts']}/{state['counters']['bundles_strapped']} reg={reg or 'clean'}"))

    # P3: views are pure + bed/stand/bundle arithmetic correct.
    cool_ticks = [r['tick'] for r in records if r['mill_phase'] == 'cooling']
    roll_list = [r['tick'] for r in records if r['mill_phase'] == 'rolling']
    st = _seed_orders(fx)
    target = cool_ticks[0] if cool_ticks else 1
    for _ in range(target):
        st = tick(st, fx, price_mid)
    before = json.dumps(st, sort_keys=True)
    view = mill_process_view(st, fx)
    _ = product_yard_view(st, fx)
    pure_ok = json.dumps(st, sort_keys=True) == before
    bed_ok = (view['bed'] is not None
              and abs(view['bed']['walk_progress'] - st['mill']['phase_progress']) < 1e-12
              and abs(view['bed']['glow'] - (1.0 - st['mill']['phase_progress'])) < 1e-12
              and view['bed']['on_bed_t'] == fx['scenario']['rebar_mill']['batch_t_per_move'])
    clone = json.loads(before)
    clone['product_yard_t'] = 999.0
    _ = product_yard_view(clone, fx)
    tamper_ok = json.dumps(st, sort_keys=True) == before
    mono_ok = True
    elong = []
    stands = []
    if len(roll_list) >= 2:
        st2 = _seed_orders(fx)
        for _ in range(roll_list[1] + 1):
            st2 = tick(st2, fx, price_mid)
            if st2['mill']['phase'] == 'rolling':
                vv = mill_process_view(st2, fx)
                elong.append(vv['elongation_factor'])
                stands.append(vv['current_stand'])
        mono_ok = (all(b >= a for a, b in zip(elong, elong[1:]))
                   and all(0 <= s < routes_of(fx)['rebar']['stands_count'] for s in stands))
    fxr = json.loads(json.dumps(fx))
    fxr['scenario']['dispatch_crane']['move_ticks'] = 10  # resident-yard variant (N4 shape)
    st_res, _ = run(fxr, price_mid)
    yvr = product_yard_view(st_res, fxr)
    yard_ok = (abs(st_res['product_yard_t'] - 8.4) < 1e-9 and yvr['units'] == 4
               and abs(yvr['loose_t'] - 0.4) < 1e-9)
    results.append(('P3 views pure + bed/stand/bundle arithmetic',
                    pure_ok and bed_ok and tamper_ok and mono_ok and yard_ok,
                    f"pure={pure_ok} bed={bed_ok} tamper={tamper_ok} mono={mono_ok} "
                    f"resident_yard={yard_ok} (units={yvr['units']} loose={round(yvr['loose_t'], 3)})"))

    # P4: routes — default heals absent block; wire rod defined-but-idle; rebar tags.
    fxnr = json.loads(json.dumps(fx))
    fxnr['scenario'].pop('product_routes', None)
    stnr, recnr = run(fxnr, price_mid)
    default_ok = routes_of(fxnr) == DEFAULT_PRODUCT_ROUTES
    same_ok = (json.dumps(stnr['counters'], sort_keys=True) == json.dumps(state['counters'], sort_keys=True)
               and [r['mill_phase'] for r in recnr] == [r['mill_phase'] for r in records])
    wr_idle = not any('wire_rod' in e['event'] for e in state['events'])
    # Route tag present on every new event; the shear event carries a batch suffix
    # "(route rebar, 9.8t batch)" so match the tag prefix, not a closed paren (P4 fix).
    tag_ok = all('route rebar' in e['event'] for e in state['events']
                 if e['event'].startswith(('reheat discharge:', 'shear cuts bar', 'bundles strapped:')))
    results.append(('P4 routes: default heal, wire-rod idle, rebar tags',
                    default_ok and same_ok and wr_idle and tag_ok,
                    f"default={default_ok} same_outputs={same_ok} wr_idle={wr_idle} tags={tag_ok}"))

    # N5: no billet -> no fabricated process events/counters, balance closed.
    fx5 = json.loads(json.dumps(fx))
    fx5['scenario']['billet_yard']['initial_billet_t'] = 0.0
    st5, _ = run(fx5, price_mid)
    ok5 = (st5['counters']['reheat_discharges'] == 0 and st5['counters']['shear_cuts'] == 0
           and st5['counters']['bundles_strapped'] == 0 and abs(st5['balance_error']) < 1e-6)
    results.append(('N5 no-billet: zero process outputs, balance closed', ok5,
                    f"dis={st5['counters']['reheat_discharges']} shear={st5['counters']['shear_cuts']} "
                    f"bundles={st5['counters']['bundles_strapped']} balance={st5['balance_error']}"))

    # N6-N9: route validation negatives (must raise with pinned messages).
    def raises(fxm, msg):
        try:
            validate_scenario(fxm)
            return False
        except ValueError as e:
            return msg in str(e)
    def with_routes():
        f = json.loads(json.dumps(fx))
        f['scenario']['product_routes'] = json.loads(json.dumps(DEFAULT_PRODUCT_ROUTES))
        return f
    fx6 = with_routes(); fx6['scenario']['product_routes']['wire_rod']['enabled'] = True
    fx7 = with_routes(); fx7['scenario']['product_routes']['active'] = 'bogus'
    fx8 = with_routes(); fx8['scenario']['product_routes']['rebar']['enabled'] = False
    fx9 = with_routes(); fx9['scenario']['product_routes']['active'] = 'wire_rod'
    results.append(('N6 wire-rod enabled raises (defined-but-idle, F-08)', raises(fx6, 'defined-but-idle'), ''))
    results.append(('N7 unknown active route raises', raises(fx7, 'unknown product route'), ''))
    results.append(('N8 rebar disabled raises', raises(fx8, 'rebar route must be enabled'), ''))
    results.append(('N9 active wire_rod (idle) raises', raises(fx9, 'v1 active route must be rebar'), ''))
    return results

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
    print(f"S5.1 process: reheat discharges {state['counters']['reheat_discharges']}  shear cuts {state['counters']['shear_cuts']}  bundles strapped {state['counters']['bundles_strapped']}  route {state['mill']['route']}")
    print("negative tests:")
    for name, ok, detail in run_negative_tests(fx, price_mid):
        print(f"  {'PASS' if ok else 'FAIL'} {name} — {detail}")
    print("S5.1 phase/process tests:")
    phase_results = run_phase_tests(fx, price_mid)
    for name, ok, detail in phase_results:
        print(f"  {'PASS' if ok else 'FAIL'} {name} — {detail}")
    # Measurement dump for fixture pinning (additive outputs only; measured, never hand-derived).
    dump = {
        'reheat_discharge_ticks': [e['tick'] for e in state['events'] if e['event'].startswith('reheat discharge:')],
        'shear_cut_ticks': [e['tick'] for e in state['events'] if e['event'].startswith('shear cuts bar')],
        'bundle_ticks': [e['tick'] for e in state['events'] if e['event'].startswith('bundles strapped:')],
        'phase_ticks': {p: [r['tick'] for r in records if r['mill_phase'] == p] for p in ('reheat', 'rolling', 'cooling', 'shear')},
        'counters_at_tick_120': {k: state['counters'][k] for k in ('reheat_discharges', 'shear_cuts', 'bundles_strapped')},
        'sample_events': [e['event'] for e in state['events'] if e['tick'] in (5, 9, 10, 11)],
    }
    stv = _seed_orders(fx)
    views = {}
    for _ in range(10):
        stv = tick(stv, fx, price_mid)
        if stv['tick'] in (7, 8, 9, 10):
            views[str(stv['tick'])] = {'mill': mill_process_view(stv, fx), 'yard': product_yard_view(stv, fx)}
    dump['view_snapshots'] = views
    dump_path = os.path.join(REPO, 'docs', 'evidence', 's51', 'mirror_measure.json')
    os.makedirs(os.path.dirname(dump_path), exist_ok=True)
    with open(dump_path, 'w', encoding='utf-8') as f:
        json.dump(dump, f, indent=2)
    print(f"measurement dump: {dump_path}")
    n_fail = sum(1 for _, ok, _ in phase_results if not ok)
    print(f"S5.1 phase tests: {len(phase_results) - n_fail}/{len(phase_results)} PASS")
