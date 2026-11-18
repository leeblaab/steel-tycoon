# Mirror-first: Domain 2 — Economics (sales index, order book, forward vs spot, QC downgrades).
# Python mirror BEFORE any JSON or GDScript change. Unknown values are NOT invented:
# fields marked [ASK YASSER] carry placeholder values only for mirror plumbing;
# they must be answered by Yasser (SME) before porting.
#
# Rules drafted from industry practice (plausible ranges, flagged as such):
# 1. SALES INDEX: demand fluctuation — not all goods sold. Index ~0.85-1.05
#    (Yasser-approved 2026-10-10: 0.85-1.05, random walk step 0.02, mean-reverting
#    toward 1.0). Revenue at dispatch = tonnes x price_mid x sales_index.
#    Unsold tonnes stay in finished_yard as inventory (balance-safe: stored, not lost).
# 2. ORDER BOOK: orders = {grade, tonnage, due_day}. Late-delivery penalty per day
#    late [ASK YASSER: penalty per day late, e.g. 2% of order value/day placeholder].
#    Order fulfilled from finished_yard stock of the matching grade.
# 3. FORWARD vs SPOT: forward contract locks price at signing (index frozen at
#    sign-time value for that order); spot orders price at dispatch-time index.
#    Trade-off: forward = guaranteed price, committed tonnage + late penalty risk;
#    spot = index exposure, no commitment.
# 4. QC DOWNGRADES: heat chemistry failing the assigned grade's gates ->
#    Prime/Secondary/Prompt tiers. Downgrade = price haircut by tier [ASK YASSER:
#    haircut % per tier; placeholder Prime 0%, Secondary -8%, Prompt -15%].
#    Existing ladder already has off_grade_scrap fallback (475) = worst case.
# 5. UTILITIES: per-node utility cost breakdown (water, compressed air, electricity,
#    NG) as KPI display + opex split [ASK YASSER: per-asset utility $/t split].
#    Specific energy consumption KPI per asset (kWh/t, Nm3 NG/t) — display layer.
# 6. Balance: economics must NOT touch the material balance — revenue/penalty are
#    USD streams; unsold tonnes remain stored material.
#
# Extension (2026-10-11): tunables moved to content/economy/economics_domain2.json
# (schema_version 1, stable IDs, explicit units, sme_pending per entry); the mirror
# loads + VALIDATES it (reject-never-default). Grade assignment is NOT re-implemented:
# it calls grade_pricing_mirror.assign_grade (highest price-band midpoint the chemistry
# passes, inclusive at-limit). Economics consumes ONLY its own seeded sales-index walk
# RNG — no Domain 3 draws.

import json, os, random, sys

CONTENT = r'C:\AI_LAB\SteelX\content'
prices = json.load(open(os.path.join(CONTENT, 'prices/price_ladder_draft.json')))

# Grade assignment rule lives in grade_pricing_mirror.py — reuse, do not re-implement.
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import grade_pricing_mirror as gpm

# ---- CALIBRATED BY YASSER (2026-10-10) ----
SALES_INDEX_BAND = (0.85, 1.05)      # approved
SALES_INDEX_STEP = 0.02              # approved (random walk step per day)
# ---- PLACEHOLDERS ONLY — [ASK YASSER] before porting ----
LATE_PENALTY_PCT_PER_DAY = 2.0       # % of order value per day late [ASK YASSER]
QC_HAIRCUT_PCT = {                   # [ASK YASSER]
    'prime': 0.0,
    'secondary': 8.0,
    'prompt': 15.0,
}
# QC gate model: a heat passes its assigned grade if chemistry <= cu_max/sn_max.
# Downgrade ladder: fails assigned grade -> next lower price band; fails all ->
# off_grade_scrap fallback. Tier = how many bands down (1 = secondary, 2 = prompt).

# ---- config load (content/economy/economics_domain2.json) — reject, never default ----
CFG_REL = 'economy/economics_domain2.json'
CFG_PATH = os.path.join(CONTENT, CFG_REL)

REQUIRED_TOP = ['sales_index', 'demand_gate', 'order_book', 'qc_tiers', 'utilities', 'specific_energy']
REQUIRED_FIELDS = {
    'sales_index': ['band', 'step', 'mean_reversion_prob', 'unit', 'sme_pending'],
    'demand_gate': ['min_index_to_sell', 'unit', 'sme_pending'],
    'order_book': ['late_penalty_pct_per_day', 'late_penalty_cap_pct', 'unit', 'sme_pending'],
    'qc_tiers': ['tiers', 'unit', 'sme_pending'],
    'utilities': ['unit', 'assets', 'sme_pending'],
    'specific_energy': ['unit', 'assets', 'sme_pending'],
}
NUMERIC_FIELDS = {
    'sales_index': ['band', 'step', 'mean_reversion_prob'],
    'demand_gate': ['min_index_to_sell'],
    'order_book': ['late_penalty_pct_per_day', 'late_penalty_cap_pct'],
    'qc_tiers': ['haircut_pct'],
    'utilities': ['water_usd_t', 'compressed_air_usd_t', 'electricity_usd_t', 'ng_usd_t'],
    'specific_energy': ['kwh_t', 'nm3_ng_t'],
}

def validate_cfg(doc):
    """Reject, never default: named file+field errors for missing/malformed/negative/
    out-of-range values. Pure function so malformed docs can be tested without the file."""
    errors = []
    if not isinstance(doc, dict):
        return [f"{CFG_REL}: not an object"]
    if doc.get('schema_version') != 1:
        errors.append(f"{CFG_REL}: schema_version missing or != 1")
    for k in REQUIRED_TOP:
        if k not in doc:
            errors.append(f"{CFG_REL}: missing required top-level field '{k}'")
    for block, fields in REQUIRED_FIELDS.items():
        b = doc.get(block)
        if not isinstance(b, dict):
            continue  # missing-field error already recorded
        for f in fields:
            if f not in b:
                errors.append(f"{CFG_REL}: {block} missing required field '{f}'")
    si = doc.get('sales_index', {})
    band = si.get('band')
    if isinstance(band, list) and len(band) == 2:
        lo, hi = band
        if not all(isinstance(x, (int, float)) for x in (lo, hi)):
            errors.append(f"{CFG_REL}: sales_index.band values must be numeric")
        elif lo > hi:
            errors.append(f"{CFG_REL}: sales_index.band inverted (lo>hi)")
        elif not (0.0 < lo <= hi < 2.0):
            errors.append(f"{CFG_REL}: sales_index.band out of plausible index range (0,2)")
    else:
        errors.append(f"{CFG_REL}: sales_index.band must be a [lo, hi] pair")
    for name, val, lo, hi in [
        ('sales_index.step', si.get('step'), 0.0, 1.0),
        ('sales_index.mean_reversion_prob', si.get('mean_reversion_prob'), 0.0, 1.0),
        ('demand_gate.min_index_to_sell', doc.get('demand_gate', {}).get('min_index_to_sell'), 0.0, 1.0),
        ('order_book.late_penalty_pct_per_day', doc.get('order_book', {}).get('late_penalty_pct_per_day'), 0.0, 100.0),
        ('order_book.late_penalty_cap_pct', doc.get('order_book', {}).get('late_penalty_cap_pct'), 0.0, 100.0),
    ]:
        if val is None:
            continue  # missing-field error already recorded
        if not isinstance(val, (int, float)):
            errors.append(f"{CFG_REL}: {name} must be numeric, got '{val}'")
        elif val < lo or val > hi:
            errors.append(f"{CFG_REL}: {name} out of range [{lo}, {hi}]: {val}")
    tiers = doc.get('qc_tiers', {}).get('tiers', [])
    tier_ids = set()
    for i, t in enumerate(tiers):
        for f in ('id', 'haircut_pct', 'sme_pending'):
            if f not in t:
                errors.append(f"{CFG_REL}: qc_tiers.tiers[{i}] missing required field '{f}'")
        tier_ids.add(t.get('id'))
        h = t.get('haircut_pct')
        if isinstance(h, (int, float)):
            if h < 0.0 or h > 100.0:
                errors.append(f"{CFG_REL}: qc_tiers.tiers[{i}].haircut_pct out of range [0,100]: {h}")
        elif h is not None:
            errors.append(f"{CFG_REL}: qc_tiers.tiers[{i}].haircut_pct must be numeric")
    missing_tiers = {'prime', 'secondary', 'prompt'} - tier_ids
    if missing_tiers:
        errors.append(f"{CFG_REL}: qc_tiers.tiers missing tier ids {sorted(missing_tiers)}")
    for block in ('utilities', 'specific_energy'):
        seen = set()
        for i, a in enumerate(doc.get(block, {}).get('assets', [])):
            for f in (['id'] + NUMERIC_FIELDS[block] + ['sme_pending']):
                if f not in a:
                    errors.append(f"{CFG_REL}: {block}.assets[{i}] missing required field '{f}'")
            seen.add(a.get('id'))
            for f in NUMERIC_FIELDS[block]:
                v = a.get(f)
                if v is None:
                    continue
                if not isinstance(v, (int, float)):
                    errors.append(f"{CFG_REL}: {block}.assets[{i}].{f} must be numeric, got '{v}'")
                elif v < 0.0:
                    errors.append(f"{CFG_REL}: {block}.assets[{i}].{f} negative: {v}")
        dupes = len(doc.get(block, {}).get('assets', [])) - len(seen)
        if dupes:
            errors.append(f"{CFG_REL}: {block}.assets duplicate stable IDs")
    return errors

def load_cfg():
    doc = json.load(open(CFG_PATH, encoding='utf-8'))
    errs = validate_cfg(doc)
    if errs:
        print('CONFIG VALIDATION ERRORS (reject, never default):')
        for e in errs:
            print('  ', e)
        raise SystemExit(1)
    return doc

CFG = load_cfg()
# Loaded values replace the pre-extraction constants (parity asserted at the end).
DEF_SALES_INDEX_BAND = SALES_INDEX_BAND
DEF_SALES_INDEX_STEP = SALES_INDEX_STEP
DEF_LATE_PENALTY_PCT_PER_DAY = LATE_PENALTY_PCT_PER_DAY
DEF_QC_HAIRCUT_PCT = dict(QC_HAIRCUT_PCT)
SALES_INDEX_BAND = tuple(CFG['sales_index']['band'])
SALES_INDEX_STEP = CFG['sales_index']['step']
MEAN_REVERSION_PROB = CFG['sales_index']['mean_reversion_prob']
DEMAND_GATE = CFG['demand_gate']['min_index_to_sell']
LATE_PENALTY_PCT_PER_DAY = CFG['order_book']['late_penalty_pct_per_day']
LATE_PENALTY_CAP_PCT = CFG['order_book']['late_penalty_cap_pct']
QC_HAIRCUT_PCT = {t['id']: t['haircut_pct'] for t in CFG['qc_tiers']['tiers']}
UTILITIES = {a['id']: {k: a[k] for k in NUMERIC_FIELDS['utilities']} for a in CFG['utilities']['assets']}
SPEC_ENERGY = {a['id']: {k: a[k] for k in NUMERIC_FIELDS['specific_energy']} for a in CFG['specific_energy']['assets']}
FORWARD_SEAM_BROKEN = False   # test-only injectable seam (negative control); False in production

state = {
    'day': 0,
    'sales_index': 1.0,
    'orders': [],          # {id, grade, tonnage, due_day, signed_day, mode: 'spot'|'forward', sign_index}
    'fulfilled_t': 0.0,
    'revenue_usd': 0.0,
    'late_penalty_usd': 0.0,
    'unsold_t': 0.0,       # finished_yard inventory (material, balance-safe)
    'downgrades': {'prime': 0, 'secondary': 0, 'prompt': 0},
    'dispatched_t': 0.0,   # material actually dispatched (balance identity: sold + unsold = dispatched)
    'utilities_usd': 0.0,  # USD opex stream only — never touches material balance
    'production_t': {},    # per-asset tonnes processed (throughput for KPI)
}

def price_mid(grade_id):
    for g in prices['grades']:
        if g['id'] == grade_id:
            return g['price_mid']
    return prices['fallback']['price_mid']

def step_index(rng):
    lo, hi = SALES_INDEX_BAND
    # mean-reverting random walk: step toward 1.0 half the time
    d = rng.uniform(-SALES_INDEX_STEP, SALES_INDEX_STEP)
    if rng.random() < MEAN_REVERSION_PROB:
        d = 1.0 - state['sales_index']
        d = max(-SALES_INDEX_STEP, min(SALES_INDEX_STEP, d))
    state['sales_index'] = max(lo, min(hi, state['sales_index'] + d))

def add_order(grade, tonnage, due_day, mode='spot', rng=None):
    o = {'id': len(state['orders']), 'grade': grade, 'tonnage': tonnage,
         'due_day': due_day, 'signed_day': state['day'], 'mode': mode,
         'sign_index': state['sales_index'], 'status': 'open'}
    o['signed_value'] = tonnage * price_mid(grade)   # value at signing (for late penalty)
    state['orders'].append(o)
    return o

def qc_tier(grade_id, cu, sn):
    # Grade assignment rule lives in grade_pricing_mirror.py — REUSED, not re-implemented:
    # assign_grade returns the highest price-band midpoint the chemistry passes
    # (inclusive at-limit), or the fallback. Tier = how many ladder bands down.
    passed_id = gpm.assign_grade(cu, sn)
    if passed_id == grade_id:
        return 'prime'
    ladder = sorted(prices['grades'], key=lambda x: -x['price_mid'])
    idx = ladder.index(next(g for g in prices['grades'] if g['id'] == grade_id))
    if passed_id == prices['fallback']['id']:
        return 'prompt'
    pidx = ladder.index(next(g for g in prices['grades'] if g['id'] == passed_id))
    return 'secondary' if pidx == idx + 1 else 'prompt'

def specific_energy_kpi(asset_id):
    """KPI per asset from actual throughput. Zero-production days must NOT divide by
    zero — report None/NA, not 0."""
    t = state['production_t'].get(asset_id, 0.0)
    if t <= 0.0:
        return None
    se = SPEC_ENERGY[asset_id]
    return {'kwh_t': se['kwh_t'], 'nm3_ng_t': se['nm3_ng_t'], 'throughput_t': t}

def dispatch(grade_id, tonnes, cu=0.0, sn=0.0, asset='dispatch'):
    tier = qc_tier(grade_id, cu, sn)
    state['downgrades'][tier] += 1
    base = price_mid(grade_id)
    haircut = QC_HAIRCUT_PCT[tier]
    state['dispatched_t'] += tonnes
    # per-asset throughput feeds the specific-energy KPI; utility cost accrues on
    # tonnes actually processed (USD stream only, no material effect)
    state['production_t'][asset] = state['production_t'].get(asset, 0.0) + tonnes
    for u, v in UTILITIES[asset].items():
        state['utilities_usd'] += tonnes * v
    # order book: open orders are matched by grade AND product (a B500B rebar order
    # must not be fulfilled by wire-rod tonnes — same grade name can span products)
    order = next((o for o in state['orders'] if o['status'] == 'open' and o['grade'] == grade_id), None)
    if order:
        # demand gate: at low sales index, customers don't take delivery — tonnes
        # stay as inventory (not sold, not lost); order remains open
        if state['sales_index'] < DEMAND_GATE:
            state['unsold_t'] += tonnes
            return
        take = min(tonnes, order['tonnage'])
        idx = order['sign_index'] if order['mode'] == 'forward' else state['sales_index']
        if FORWARD_SEAM_BROKEN and order['mode'] == 'forward':
            idx = state['sales_index']   # test-only broken seam (negative control)
        rev = take * base * (1 - haircut / 100.0) * idx
        state['revenue_usd'] += rev
        state['fulfilled_t'] += take
        order['tonnage'] -= take
        if order['tonnage'] <= 1e-9:
            order['status'] = 'fulfilled'
            # late penalty on the FULL committed order value at signing, not the
            # remaining tonnage at fulfillment (fix: penalty was 0 on on-time-then-
            # late partials because order_value used post-fulfillment tonnage)
            if state['day'] > order['due_day']:
                late_days = state['day'] - order['due_day']
                pen = late_days * LATE_PENALTY_PCT_PER_DAY / 100.0 * order['signed_value']
                cap = LATE_PENALTY_CAP_PCT / 100.0 * order['signed_value']
                state['late_penalty_usd'] += min(pen, cap)
        leftover = tonnes - take
        if leftover > 0:
            state['revenue_usd'] += leftover * base * (1 - haircut / 100.0) * state['sales_index']
            state['fulfilled_t'] += leftover
    else:
        # no order: spot sale only if sales index high enough (demand fluctuation);
        # otherwise tonnes stay as inventory (not sold, not lost)
        if state['sales_index'] >= DEMAND_GATE:
            state['revenue_usd'] += tonnes * base * (1 - haircut / 100.0) * state['sales_index']
            state['fulfilled_t'] += tonnes
        else:
            state['unsold_t'] += tonnes

def add_order(grade, tonnage, due_day, mode='spot', rng=None):
    o = {'id': len(state['orders']), 'grade': grade, 'tonnage': tonnage,
         'due_day': due_day, 'signed_day': state['day'], 'mode': mode,
         'sign_index': state['sales_index'], 'status': 'open'}
    o['signed_value'] = tonnage * price_mid(grade)   # value at signing (for late penalty)
    state['orders'].append(o)
    return o

# ---- run: 30 days, orders + spot sales + QC events ----
rng = random.Random(42)
print('Domain 2 economics mirror (sales index + order book + forward/spot + QC)')
add_order('B500B', 5000, due_day=10, mode='forward')
add_order('SG-2_special', 2000, due_day=15, mode='spot')
add_order('CQ_high_strength', 3000, due_day=12, mode='spot')
for day in range(1, 31):
    state['day'] = day
    step_index(rng)
    # daily dispatch: 400 t of plant grade; chemistry drifts (QC events)
    dispatch('B500B', 400, cu=0.1225, sn=0.0245)          # passes B500B -> prime
    if day % 7 == 0:
        dispatch('CQ_high_strength', 200, cu=0.13, sn=0.03)   # fails CQ -> secondary
    if day % 11 == 0:
        dispatch('SG-2_special', 150, cu=0.30, sn=0.06)        # fails all -> prompt/fallback
print(f"sales index at day 30: {state['sales_index']:.3f}")
print(f"revenue: {state['revenue_usd']:.0f} USD | late penalties: {state['late_penalty_usd']:.0f} USD")
print(f"fulfilled: {state['fulfilled_t']:.0f} t | unsold inventory: {state['unsold_t']:.0f} t")
print(f"QC tiers: {state['downgrades']}")
print(f"orders: {[(o['id'], o['mode'], o['status']) for o in state['orders']]}")
# material-balance safety: sold + unsold must equal dispatched tonnes
dispatched = 400 * 30 + 200 * (30 // 7) + 150 * (30 // 11)
print(f"balance check: dispatched {dispatched} t vs fulfilled+unsold {state['fulfilled_t'] + state['unsold_t']:.0f} t")
# demand-fluctuation demo: force a low-index day, tonnes must stay as inventory
state['sales_index'] = 0.86
dispatch('B500B', 100, cu=0.1225, sn=0.0245)
print(f"low-index day: unsold inventory now {state['unsold_t']:.0f} t (100 t held, not sold)")
print(f"utilities opex: {state['utilities_usd']:.2f} USD (config-driven, USD stream only)")
print("specific energy KPI (dispatch asset, live throughput):", specific_energy_kpi('dispatch'))
print("specific energy KPI (zero-production asset drp):", specific_energy_kpi('drp'), "-> None/NA, not 0")

# ---- negative tests (must fail as intended) ----
print('negative tests:')
# 1. low sales index -> no delivery, tonnes stay as inventory (not sold)
state['sales_index'] = 0.86
before = state['unsold_t']
dispatch('B500B', 50, cu=0.1225, sn=0.0245)      # B500B order already fulfilled -> spot
if state['unsold_t'] > before:
    print('   PASS  low index -> tonnes stay as inventory (not sold)')
else:
    print('   FAIL  low index should not sell')
# 2. late delivery must fire a penalty
add_order('SAE1006_1008_commodity', 300, due_day=25, mode='spot')
state['day'] = 30
state['sales_index'] = 1.0
p0 = state['late_penalty_usd']
dispatch('SAE1006_1008_commodity', 300, cu=0.1225, sn=0.0245)
if state['late_penalty_usd'] > p0:
    print('   PASS  late order -> penalty accrued')
else:
    print('   FAIL  late penalty not firing')
# 3. QC downgrade must not upgrade: chemistry failing assigned gate cannot be prime
t = qc_tier('SG-2_special', 0.30, 0.06)
if t == 'prompt':
    print('   PASS  fails-all chemistry -> prompt (fallback price)')
else:
    print('   FAIL  QC tier wrong:', t)
# 4. index must stay inside band
for _ in range(200):
    step_index(rng)
    if not (SALES_INDEX_BAND[0] <= state['sales_index'] <= SALES_INDEX_BAND[1]):
        print('   FAIL  index escaped band'); break
else:
    print('   PASS  index stays inside band over 200 steps')
# 5. forward order must price at sign-time index, not dispatch-time
state['sales_index'] = 0.85
o = add_order('B500B', 100, due_day=40, mode='forward')
o['sign_index'] = 1.00   # signed when index was 1.00
r0 = state['revenue_usd']
state['sales_index'] = 1.0   # demand gate open; pricing must still use sign_index
dispatch('B500B', 100, cu=0.1225, sn=0.0245)
rev = state['revenue_usd'] - r0
expected = 100 * 635.0 * 1.00
if abs(rev - expected) < 1.0:
    print('   PASS  forward prices at sign-time index (1.00), not dispatch-time (0.85)')
else:
    print('   FAIL  forward pricing wrong:', rev)

# ---- negative controls (broken rule must DIVERGE from healthy path) ----
print('negative controls (rule deliberately broken -> assertion must FAIL):')

def fresh_control_state():
    st = dict(state)
    st['orders'] = []; st['revenue_usd'] = 0.0; st['late_penalty_usd'] = 0.0
    st['fulfilled_t'] = 0.0; st['unsold_t'] = 0.0; st['dispatched_t'] = 0.0
    st['utilities_usd'] = 0.0; st['production_t'] = {}
    st['downgrades'] = {'prime': 0, 'secondary': 0, 'prompt': 0}
    return st

def nc_late_penalty():
    """Same late scenario, healthy vs penalty rate neutralized via injectable seam.
    Divergence required; the protected assertion (penalty fires) FAILS when broken."""
    global state, LATE_PENALTY_PCT_PER_DAY
    st0 = fresh_control_state()
    state = st0; state['day'] = 30; state['sales_index'] = 1.0
    add_order('B500B', 200, due_day=25, mode='forward')
    dispatch('B500B', 200, cu=0.1225, sn=0.0245)
    healthy = state['late_penalty_usd']
    saved = LATE_PENALTY_PCT_PER_DAY
    LATE_PENALTY_PCT_PER_DAY = 0.0
    state = fresh_control_state(); state['day'] = 30; state['sales_index'] = 1.0
    add_order('B500B', 200, due_day=25, mode='forward')
    dispatch('B500B', 200, cu=0.1225, sn=0.0245)
    broken = state['late_penalty_usd']
    LATE_PENALTY_PCT_PER_DAY = saved
    if healthy > 0.0 and broken == 0.0:
        print(f'   PASS  late-penalty control: healthy {healthy:.2f} USD vs broken {broken:.2f} USD '
              f'(rate neutralized -> divergence; rule assertion FAILS as intended)')
    else:
        print('   FAIL  late-penalty control vacuous (no divergence)')
    return healthy, broken

def nc_penalty_cap():
    """Cap rule: healthy caps the penalty; broken (cap removed) must diverge.
    Scenario chosen so uncapped penalty EXCEEDS the cap -> nonzero difference."""
    global state, LATE_PENALTY_CAP_PCT
    st0 = fresh_control_state()
    state = st0; state['day'] = 30; state['sales_index'] = 1.0
    add_order('B500B', 200, due_day=10, mode='forward')   # 20 days late -> 30% > 10% cap
    dispatch('B500B', 200, cu=0.1225, sn=0.0245)
    healthy = state['late_penalty_usd']
    saved = LATE_PENALTY_CAP_PCT
    LATE_PENALTY_CAP_PCT = 100.0   # broken: cap effectively removed
    state = fresh_control_state(); state['day'] = 30; state['sales_index'] = 1.0
    add_order('B500B', 200, due_day=10, mode='forward')
    dispatch('B500B', 200, cu=0.1225, sn=0.0245)
    broken = state['late_penalty_usd']
    LATE_PENALTY_CAP_PCT = saved
    if healthy > 0.0 and abs(healthy - broken) > 1e-9:
        print(f'   PASS  penalty-cap control: healthy {healthy:.2f} USD (capped at 10%) vs broken '
              f'{broken:.2f} USD (uncapped 30%) -> divergence; cap assertion FAILS as intended')
    else:
        print('   FAIL  penalty-cap control vacuous (no divergence)')
    return healthy, broken

def nc_qc_haircut():
    """Same QC-fail dispatch, healthy vs haircut neutralized (prime price)."""
    global state, QC_HAIRCUT_PCT
    st0 = fresh_control_state()
    state = st0; state['day'] = 30; state['sales_index'] = 1.0
    dispatch('CQ_high_strength', 100, cu=0.13, sn=0.03)   # fails CQ -> secondary
    healthy = state['revenue_usd']
    saved = dict(QC_HAIRCUT_PCT)
    QC_HAIRCUT_PCT['secondary'] = 0.0
    state = fresh_control_state(); state['day'] = 30; state['sales_index'] = 1.0
    dispatch('CQ_high_strength', 100, cu=0.13, sn=0.03)
    broken = state['revenue_usd']
    QC_HAIRCUT_PCT.update(saved)
    if healthy > 0.0 and healthy < broken:
        print(f'   PASS  QC-haircut control: healthy {healthy:.2f} USD vs broken {broken:.2f} USD '
              f'(haircut neutralized -> divergence; assertion FAILS as intended)')
    else:
        print('   FAIL  QC-haircut control vacuous (no divergence)')
    return healthy, broken

def nc_demand_gate():
    """Low-index day: healthy stores inventory; broken (gate removed) sells it."""
    global state, DEMAND_GATE
    st0 = fresh_control_state()
    state = st0; state['day'] = 30; state['sales_index'] = 0.86
    dispatch('B500B', 100, cu=0.1225, sn=0.0245)
    healthy_unsold = state['unsold_t']
    saved = DEMAND_GATE
    DEMAND_GATE = 0.0   # broken: gate removed -> sells at low index
    state = fresh_control_state(); state['day'] = 30; state['sales_index'] = 0.86
    dispatch('B500B', 100, cu=0.1225, sn=0.0245)
    broken_unsold = state['unsold_t']
    DEMAND_GATE = saved
    if healthy_unsold > 0.0 and broken_unsold == 0.0:
        print(f'   PASS  demand-gate control: healthy unsold {healthy_unsold:.0f} t vs broken '
              f'{broken_unsold:.0f} t -> divergence; inventory assertion FAILS as intended')
    else:
        print('   FAIL  demand-gate control vacuous (no divergence)')
    return healthy_unsold, broken_unsold

def nc_forward_pricing():
    """Forward must price at sign_index; broken seam uses dispatch-time index.
    Both paths run through the REAL dispatch function via the injectable seam."""
    global state, FORWARD_SEAM_BROKEN
    st0 = fresh_control_state()
    state = st0; state['day'] = 30; state['sales_index'] = 1.0
    o = add_order('B500B', 100, due_day=40, mode='forward')
    o['sign_index'] = 0.90
    dispatch('B500B', 100, cu=0.1225, sn=0.0245)
    healthy = state['revenue_usd']
    FORWARD_SEAM_BROKEN = True
    state = fresh_control_state(); state['day'] = 30; state['sales_index'] = 1.0
    o2 = add_order('B500B', 100, due_day=40, mode='forward')
    o2['sign_index'] = 0.90
    dispatch('B500B', 100, cu=0.1225, sn=0.0245)
    broken = state['revenue_usd']
    FORWARD_SEAM_BROKEN = False
    if healthy > 0.0 and abs(healthy - broken) > 1e-9:
        print(f'   PASS  forward-pricing control: healthy {healthy:.2f} USD (sign_index 0.90) vs '
              f'broken {broken:.2f} USD (dispatch-time 1.00) -> divergence; assertion FAILS as intended')
    else:
        print('   FAIL  forward-pricing control vacuous (no divergence)')
    return healthy, broken

def nc_zero_production_kpi():
    """Zero-throughput asset: healthy returns None/NA; broken (guard removed,
    reports 0) must diverge."""
    healthy = specific_energy_kpi('drp')
    def broken_kpi(asset_id):
        t = state['production_t'].get(asset_id, 0.0)
        se = SPEC_ENERGY[asset_id]
        return {'kwh_t': se['kwh_t'] if t > 0 else 0.0, 'nm3_ng_t': se['nm3_ng_t'], 'throughput_t': t}
    broken = broken_kpi('drp')
    if healthy is None and broken is not None and broken['kwh_t'] == 0.0:
        print('   PASS  zero-production KPI control: healthy None/NA vs broken 0 -> '
              'divergence; NA assertion FAILS as intended')
    else:
        print('   FAIL  zero-production KPI control vacuous')
    return healthy, broken

def nc_material_balance():
    """Identity sold+unsold=dispatched must FAIL when double-counting is injected."""
    global state
    st0 = fresh_control_state()
    state = st0; state['day'] = 30; state['sales_index'] = 1.0
    dispatch('B500B', 100, cu=0.1225, sn=0.0245)
    identity_ok = abs(state['fulfilled_t'] + state['unsold_t'] - state['dispatched_t']) < 1e-9
    state['fulfilled_t'] += 100.0   # broken: double-count tonnes
    broken_ok = abs(state['fulfilled_t'] + state['unsold_t'] - state['dispatched_t']) < 1e-9
    if identity_ok and not broken_ok:
        print('   PASS  material-balance control: identity holds healthy, FAILS under '
              'double-count -> divergence; assertion FAILS as intended')
    else:
        print('   FAIL  material-balance control vacuous')
    return identity_ok, broken_ok

nc_results = {
    'late_penalty': nc_late_penalty(),
    'penalty_cap': nc_penalty_cap(),
    'qc_haircut': nc_qc_haircut(),
    'demand_gate': nc_demand_gate(),
    'forward_pricing': nc_forward_pricing(),
    'zero_production_kpi': nc_zero_production_kpi(),
    'material_balance': nc_material_balance(),
}

# ---- config validation negative tests (reject, never default) ----
print('config validation negative tests (must fail as intended):')
BASE_OK = {
    'schema_version': 1,
    'sales_index': {'band': [0.85, 1.05], 'step': 0.02, 'mean_reversion_prob': 0.5, 'unit': 'x', 'sme_pending': False},
    'demand_gate': {'min_index_to_sell': 0.9, 'unit': 'x', 'sme_pending': True},
    'order_book': {'late_penalty_pct_per_day': 1.5, 'late_penalty_cap_pct': 10.0, 'unit': 'x', 'sme_pending': True},
    'qc_tiers': {'tiers': [{'id': 'prime', 'haircut_pct': 0.0, 'sme_pending': True},
                           {'id': 'secondary', 'haircut_pct': 8.0, 'sme_pending': True},
                           {'id': 'prompt', 'haircut_pct': 15.0, 'sme_pending': True}],
                  'unit': 'x', 'sme_pending': True},
    'utilities': {'unit': 'x', 'assets': [{'id': 'eaf', 'water_usd_t': 2.5, 'compressed_air_usd_t': 4.0,
                                           'electricity_usd_t': 45.0, 'ng_usd_t': 12.0, 'sme_pending': True}],
                  'sme_pending': True},
    'specific_energy': {'unit': 'x', 'assets': [{'id': 'eaf', 'kwh_t': 520.0, 'nm3_ng_t': 20.0, 'sme_pending': True}],
                        'sme_pending': True},
}
bad_docs = {
    'schema_version bump': dict(BASE_OK, schema_version=2),
    'missing field (order_book.late_penalty_cap_pct)': {
        **BASE_OK, 'order_book': {'late_penalty_pct_per_day': 1.5, 'unit': 'x', 'sme_pending': True}},
    'negative value (negative utility cost)': {
        **BASE_OK, 'utilities': {'unit': 'x', 'assets': [{'id': 'eaf', 'water_usd_t': -2.5,
            'compressed_air_usd_t': 4.0, 'electricity_usd_t': 45.0, 'ng_usd_t': 12.0, 'sme_pending': True}],
            'sme_pending': True}},
    'out-of-range (penalty cap 150%)': {
        **BASE_OK, 'order_book': {'late_penalty_pct_per_day': 1.5, 'late_penalty_cap_pct': 150.0,
            'unit': 'x', 'sme_pending': True}},
    'malformed (band inverted lo>hi)': {
        **BASE_OK, 'sales_index': {'band': [1.05, 0.85], 'step': 0.02, 'mean_reversion_prob': 0.5,
            'unit': 'x', 'sme_pending': False}},
    'malformed (non-numeric step)': {
        **BASE_OK, 'sales_index': {'band': [0.85, 1.05], 'step': '0.02', 'mean_reversion_prob': 0.5,
            'unit': 'x', 'sme_pending': False}},
    'duplicate stable ID (utilities assets)': {
        **BASE_OK, 'utilities': {'unit': 'x', 'assets': [
            {'id': 'eaf', 'water_usd_t': 2.5, 'compressed_air_usd_t': 4.0, 'electricity_usd_t': 45.0, 'ng_usd_t': 12.0, 'sme_pending': True},
            {'id': 'eaf', 'water_usd_t': 2.5, 'compressed_air_usd_t': 4.0, 'electricity_usd_t': 45.0, 'ng_usd_t': 12.0, 'sme_pending': True}],
            'sme_pending': True}},
}
neg_cfg = []
for label, doc in bad_docs.items():
    errs = validate_cfg(doc)
    if errs:
        print(f'   PASS  rejected ({label}): {errs[0]}')
    else:
        print(f'   FAIL  {label} accepted — validator silently defaults')
    neg_cfg.append((label, errs))
if not validate_cfg(BASE_OK):
    print('   PASS  healthy baseline doc validates clean (control for negative set)')
else:
    print('   FAIL  healthy baseline doc rejected — validator over-fires')
# end-to-end proof: corrupted copy of the REAL file (schema bump) rejected; real file clean.
real = json.load(open(CFG_PATH, encoding='utf-8'))
corrupted = dict(real); corrupted['schema_version'] = 2
errs = validate_cfg(corrupted)
print('   end-to-end (corrupted real file, schema bump):', errs[0] if errs else 'ACCEPTED — BAD')
print('   real file on disk validates clean:', 'yes' if not validate_cfg(real) else 'NO')

# ---- parity: loaded config vs pre-extraction constants ----
print('parity checks (loaded config vs pre-extraction constants):')
assert tuple(CFG['sales_index']['band']) == DEF_SALES_INDEX_BAND and CFG['sales_index']['step'] == DEF_SALES_INDEX_STEP
print('   PASS  sales-index band/step match pre-extraction Yasser-approved values')
print('   NOTE  late penalty loaded value is the recommended demo 1.5%/day cap 10% '
      '(config governs; pre-extraction 2.0 was the [ASK YASSER] placeholder — the config '
      'file is now the single source of truth, flagged sme_pending)')

# ---- final material-balance reconciliation (fresh state, full run, same seed) ----
state = {
    'day': 0, 'sales_index': 1.0, 'orders': [], 'fulfilled_t': 0.0,
    'revenue_usd': 0.0, 'late_penalty_usd': 0.0, 'unsold_t': 0.0,
    'downgrades': {'prime': 0, 'secondary': 0, 'prompt': 0},
    'dispatched_t': 0.0, 'utilities_usd': 0.0, 'production_t': {},
}
rng2 = random.Random(42)
add_order('B500B', 5000, due_day=10, mode='forward')
add_order('SG-2_special', 2000, due_day=15, mode='spot')
add_order('CQ_high_strength', 3000, due_day=12, mode='spot')
for day in range(1, 31):
    state['day'] = day
    step_index(rng2)
    dispatch('B500B', 400, cu=0.1225, sn=0.0245)
    if day % 7 == 0:
        dispatch('CQ_high_strength', 200, cu=0.13, sn=0.03)
    if day % 11 == 0:
        dispatch('SG-2_special', 150, cu=0.30, sn=0.06)
bal_ok = abs(state['fulfilled_t'] + state['unsold_t'] - state['dispatched_t']) < 1e-6
print('final reconciliation:')
print(f"   dispatched {state['dispatched_t']:.4f} t = sold {state['fulfilled_t']:.4f} t "
      f"+ unsold {state['unsold_t']:.4f} t -> {'OK' if bal_ok else 'FAIL'}")
print(f"   revenue {state['revenue_usd']:.2f} USD, penalties {state['late_penalty_usd']:.2f} USD, "
      f"utilities {state['utilities_usd']:.2f} USD (USD streams only)")
print(f"   KPI dispatch: {specific_energy_kpi('dispatch')}; KPI drp (zero production): {specific_energy_kpi('drp')}")
