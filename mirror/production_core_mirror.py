# Mirror-first: production core — scrap tiers + yield + tap-to-tap (Domain 1, Yasser GO 2026-10-10).
# Python mirror BEFORE any JSON or GDScript change. Unknown values are NOT invented:
# fields marked [ASK YASSER] carry placeholder values only for mirror plumbing;
# they must be answered by Yasser (SME) before porting.
#
# Rules mirrored (SME-confirmed base, 2026-10-04/05):
# 1. Scrap price tiers by grade (grade/size): bushing premium, HMS baseline,
#    shredded mid — per-tonne purchase price. [ASK YASSER: price per tier]
# 2. Yield loss by grade (separate from handling loss — SME rule): tramp grades
#    already carry Cu/Sn bands; add per-grade yield_loss_pct. [ASK YASSER]
# 3. Tap-to-tap as first-class variable:
#    TTT = base_min x scrap_quality_factor x furnace_condition_factor x crew_factor
#    - scrap_quality_factor: from blend (shredded/heavier scrap worsens; DRI share
#      handled by existing power_delta rule)
#    - furnace_condition_factor: condition 100 -> 1.0; degrades between overhauls
#      (condition-based degradation, domain 3 hook, modeled here as input)
#    - crew_factor: 1.0 baseline (morale domain 3 hook)
#    Existing calibration anchor: DRI >80% without CI/HDC -> TTT balloons to 90+ min.
# 4. Grade assignment + pricing UNCHANGED (grade_pricing_mirror.py is the contract;
#    this mirror imports its rules, does not redefine them).
# 5. Balance: purchase -> yard stock -> handling loss (separate accumulator) ->
#    yield loss by grade -> melt -> existing balance equation. New streams enter
#    the balance so error stays 0.0000.

import json, os

CONTENT = r'C:\AI_LAB\SteelX\content'
nodes = {n['id']: n for n in json.load(open(os.path.join(CONTENT, 'nodes/nodes_phase1.json')))['phase1_nodes']}
prices = json.load(open(os.path.join(CONTENT, 'prices/price_ladder_draft.json')))

def mid(v):
    if isinstance(v, (int, float)):
        return float(v)
    lo, hi = v.split('-')
    return (float(lo) + float(hi)) / 2.0

# ---- CALIBRATED BY YASSER (2026-10-10) — no longer placeholders ----
SCRAP_TIER_PRICE = {          # USD/t purchase price per grade (Yasser approved)
    'bushing': 340.0,
    'hms1_hms2': 300.0,
    'shredded': 310.0,        # priced ABOVE HMS: processing fee structure —
                              # makes the shredder plant a real decision
}
YIELD_LOSS_BY_GRADE = {       # % metallurgical yield loss at EAF by grade (approved)
    'bushing': 3.0,
    'hms1_hms2': 5.0,
    'shredded': 8.0,
}
TTT_QUALITY_FACTOR = {        # tap-to-tap multiplier by grade (approved)
    'bushing': 0.95,
    'hms1_hms2': 1.00,
    'shredded': 1.10,
}
# SIZE DIMENSION (Yasser 2026-10-10: "size does matter"): size affects HANDLING
# loss (physical), not metallurgical yield. Charge = sum over (grade, size) cells.
SIZE_HANDLING_PCT = {         # handling loss % by size class [ASK YASSER]
    'plate': 1.0,             # large, clean — lowest handling loss
    'hms': 1.5,               # heavy melting scrap — baseline (matches existing 1-2 band)
    'light': 2.5,             # shreds/bundles — highest handling loss
}
# CONDITION DEGRADATION (Yasser rejected the flat +0.5%/point placeholder):
# linear degradation from 100 at overhaul to overhaul threshold; TTT factor =
# 1.0 at 100, degrading to TTT_DEGRADE_MAX at CONDITION_OVERHAUL_AT. [ASK YASSER]
CONDITION_OVERHAUL_AT = 85.0      # condition at which overhaul is forced
TTT_DEGRADE_MAX = 1.15            # TTT multiplier when condition hits threshold
DEGRADE_RATE_PER_HEAT = 0.5       # condition points lost per heat [ASK YASSER]

state = {
    'tick': 0,
    'purchased_t': {g: 0.0 for g in SCRAP_TIER_PRICE},
    'yard_stock_t': 0.0,
    'handling_loss_t': 0.0,       # physical, separate accumulator (SME rule)
    'yield_loss_t': 0.0,           # metallurgical, by grade
    'melted_t': 0.0,
    'ttt_hours_accum': 0.0,
    'ttt_runs': 0,
    'spend_usd': 0.0,
    'condition': 100.0,            # furnace condition input (domain 3 will drive it)
    'crew_factor': 1.0,            # domain 3 hook (morale)
}

def condition_factor():
    # Linear degradation: factor 1.0 at condition 100, TTT_DEGRADE_MAX at
    # CONDITION_OVERHAUL_AT. Overhaul resets condition to 100.
    span = 100.0 - CONDITION_OVERHAUL_AT
    return 1.0 + (100.0 - state['condition']) / span * (TTT_DEGRADE_MAX - 1.0)

def tap_to_tap_min(charge_cells):
    # charge_cells: list of (grade, size, tonnes). Quality factor = tonnage-weighted
    # grade factor x condition factor x crew factor.
    total = sum(c[2] for c in charge_cells)
    q = sum(c[2] * TTT_QUALITY_FACTOR[c[0]] for c in charge_cells) / total
    base = mid(nodes['eaf']['tap_to_tap_min'])
    return base * q * condition_factor() * state['crew_factor']

def tick(charge_cells, condition=None, crew_factor=1.0, overhaul=False):
    state['tick'] += 1
    # condition evolves per heat (degradation), reset on overhaul
    if overhaul:
        state['condition'] = 100.0
    elif condition is not None:
        state['condition'] = condition
    else:
        state['condition'] -= DEGRADE_RATE_PER_HEAT
        if state['condition'] <= CONDITION_OVERHAUL_AT:
            state['condition'] = 100.0   # forced overhaul at threshold
    state['crew_factor'] = crew_factor
    # purchase -> spend, material enters yard (balance input)
    for g, s, t in charge_cells:
        state['purchased_t'][g] += t
        state['yard_stock_t'] += t
        state['spend_usd'] += t * SCRAP_TIER_PRICE[g]
    # charge from yard (residence-time rule: material arrived previous tick)
    charge = state['yard_stock_t']
    state['yard_stock_t'] = 0.0
    # handling loss by SIZE class (physical), applied per cell
    hl = 0.0
    for g, s, t in charge_cells:
        hl += t * SIZE_HANDLING_PCT[s] / 100.0
    state['handling_loss_t'] += hl
    # metallurgical yield by GRADE, applied to the grade portion of the charge
    # (fix from first run: grade % applies to grade portion, not whole charge)
    yl = 0.0
    for g, s, t in charge_cells:
        yl += t * YIELD_LOSS_BY_GRADE[g] / 100.0
    state['yield_loss_t'] += yl
    melt = charge - hl - yl
    state['melted_t'] += melt
    # tap-to-tap
    ttt = tap_to_tap_min(charge_cells)
    state['ttt_hours_accum'] += ttt / 60.0
    state['ttt_runs'] += 1
    return melt, ttt

def balance_error():
    # input (purchased) = melted + losses + yard stock
    accounted = state['melted_t'] + state['handling_loss_t'] + state['yield_loss_t'] + state['yard_stock_t']
    total_in = sum(state['purchased_t'].values())
    return abs(total_in - accounted)

# ---- run: 20 heats, grade+size cells; degradation evolves naturally, overhaul
# resets at threshold. Decision demo: plate-HMS vs light-shredded charge. ----
print('scrap tiers + grade yield + size handling + tap-to-tap mirror (Yasser-calibrated)')
runs = [
    [('hms1_hms2', 'hms', 40.0)],                          # baseline HMS charge
    [('hms1_hms2', 'plate', 40.0)],                        # same grade, better size
    [('shredded', 'light', 40.0)],                         # worst size class
    [('bushing', 'plate', 20.0), ('hms1_hms2', 'hms', 20.0)],  # mixed charge
]
for i in range(20):
    cells = runs[i % len(runs)]
    melt, ttt = tick(cells)
    if i < 4 or i >= 16:
        print(f"heat {i:2d} cells {cells} cond {state['condition']:.1f} "
              f"-> TTT {ttt:.1f} min, melt {melt:.2f} t")
print('balance error:', round(balance_error(), 4))
print('handling loss:', round(state['handling_loss_t'], 2), '| yield loss:', round(state['yield_loss_t'], 2))
print('avg TTT:', round(state['ttt_hours_accum'] / state['ttt_runs'] * 60.0, 2), 'min')
print('spend:', round(state['spend_usd'], 0), 'USD')
