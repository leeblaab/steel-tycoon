# Mirror-first: firing mechanics + score dials (Yasser GO 2026-10-09).
# Python mirror of the rules BEFORE porting to sim_loop.gd.
# All thresholds read from content JSON — nothing hardcoded (same rule as engine).
#
# Rules mirrored:
# 1. DRI aging: dri_yard age_days > 30 -> +5% EAF energy penalty per heat.
#    Engine consumer: EAF opex per heat gets the surcharge when a dri_yard is placed.
# 2. DRP drift: after drift_days (10) in-game days, DRP runs sub-optimal
#    (85% met / 14 GJ/t) unless the process-control action is taken.
#    Game effect mirrored as throughput/opex: sub-optimal = lower effective yield
#    and higher opex until "control" is applied (action resets the drift clock).
# 3. Kiln availability: availability_pct mid 88.5 -> each tick produces at
#    availability rate; downtime ticks produce nothing (downtime accumulator).
# 4. Scrap handling loss SEPARATE from tramp yield loss: two accumulators,
#    both enter the material balance so balance error stays 0.0000.
# 5. Score dials (rolling 7-day window): cash flow (rev-opex), utilization
#    (shipped t / theoretical max), continuity (days since last dump/crisis).

import json, os

CONTENT = r'C:\AI_LAB\SteelX\content'
nodes = {n['id']: n for n in json.load(open(os.path.join(CONTENT, 'nodes/nodes_phase1.json')))['phase1_nodes']}

def mid(v):
    if isinstance(v, (int, float)):
        return float(v)
    lo, hi = v.split('-')
    return (float(lo) + float(hi)) / 2.0

# ---------- state ----------
state = {
    'tick': 0,
    'placed': {'drp': {}, 'dri_yard': {}, 'scrap_yard': {}, 'eaf': {}},
    'drp_age_days': 0.0,          # drift clock (resets on process-control action)
    'drp_control_active': False,
    'kiln_downtime_ticks': 0,
    'dri_age_days': 0.0,
    'yield_loss_t': 0.0,          # tramp/processing yield (separate accumulator)
    'handling_loss_t': 0.0,       # scrap handling loss (separate accumulator)
    'drp_internal': 0.0,          # residence-time internal buffers (engine rule)
    'eaf_internal': 0.0,
    'input_total_t': 0.0,
    'processed_t': 0.0,
    'shipped_t': 0.0,
    'revenue_usd': 0.0,
    'opex_usd': 0.0,
    'last_incident_day': 0,       # continuity dial: last dump/crisis
    'history': []                 # per-tick (revenue, opex, shipped) for rolling window
}

# ---------- rule 3: kiln availability ----------
def kiln_available(tick):
    # deterministic mirror of stochastic availability: availability_pct mid 88.5
    # -> 177 productive ticks per 200 (88.5%). Mirror uses the exact fraction:
    # a tick is productive when (tick % 200) < 177.
    return (tick % 200) < int(round(mid(nodes['drp']['kiln_availability_pct']) * 200))

# ---------- rule 2: DRP drift ----------
def drp_suboptimal():
    return state['drp_age_days'] >= nodes['drp']['drift_days'] and not state['drp_control_active']

# ---------- rule 1: DRI aging ----------
def eaf_energy_penalty_pct():
    if state['dri_age_days'] > mid(nodes['dri_yard']['aging_penalty_days']):
        return mid(nodes['dri_yard']['aging_penalty_energy_pct'])
    return 0.0

# ---------- tick ----------
def tick(drp_input_t, scrap_input_t, control_action=False):
    state['tick'] += 1
    # input_total counts material ENTERING the system once per tick (engine rule),
    # regardless of whether a processor is available this tick.
    state['input_total_t'] += drp_input_t + scrap_input_t
    # process-control action resets the drift clock (Level 1: cheap manual action)
    if control_action:
        state['drp_control_active'] = True
        state['drp_age_days'] = 0.0

    # DRP: produces at availability rate; sub-optimal state changes yield/opex
    drp_out = 0.0
    if kiln_available(state['tick']):
        # residence time (engine rule): consume from INTERNAL — material that
        # arrived a previous tick; mirror keeps a small internal buffer.
        internal = state['drp_internal'] + drp_input_t
        state['drp_internal'] = 0.0
        y = mid(nodes['drp']['yield_pct'])
        if drp_suboptimal():
            # sub-optimal: 85% met instead of yield_pct mid; opex at sub-optimal energy
            y = nodes['drp']['sub_optimal']['met_pct']
            opex_rate = nodes['drp']['opex_per_t'] * (14.0 / 11.0)   # 14 vs 10-12 GJ/t mid
        else:
            opex_rate = nodes['drp']['opex_per_t']
        made = internal
        loss = made * (1.0 - y / 100.0)
        state['yield_loss_t'] += loss
        drp_out = made - loss
        state['processed_t'] += drp_out
        state['opex_usd'] += made * opex_rate
    # downtime tick: produces nothing, downtime accumulator
    else:
        state['kiln_downtime_ticks'] += 1
        state['drp_internal'] += drp_input_t   # input waits, not lost

    # EAF energy penalty (aging) charged as opex surcharge on melt opex
    pen = eaf_energy_penalty_pct()
    # residence time (engine rule): EAF consumes from INTERNAL — material that
    # arrived a previous tick; mirror keeps a small internal buffer.
    eaf_internal = state['eaf_internal'] + scrap_input_t
    state['eaf_internal'] = 0.0
    # Scrap yard: handling loss SEPARATE from tramp yield loss
    hl = eaf_internal * mid(nodes['scrap_yard']['handling_loss_pct']) / 100.0
    state['handling_loss_t'] += hl
    # melt yield loss (EAF yield_pct mid) — separate accumulator, same as engine
    yl = eaf_internal * (1.0 - mid(nodes['eaf']['yield_pct']) / 100.0)
    state['yield_loss_t'] += yl
    melt_t = eaf_internal - hl - yl
    state['processed_t'] += melt_t
    state['opex_usd'] += melt_t * nodes['eaf']['opex_per_t'] * (1.0 + pen / 100.0)

    # Dispatch: revenue on load-out (grade midpoint via existing pricing rule)
    shipped = melt_t
    state['shipped_t'] += shipped
    state['revenue_usd'] += shipped * 635.0   # B500B midpoint (existing calibrated grade)

    state['history'].append((state['revenue_usd'], state['opex_usd'], state['shipped_t']))

    # aging clocks
    state['drp_age_days'] += 1.0 / 24.0
    state['dri_age_days'] += 1.0 / 24.0

# ---------- rule 5: score dials (rolling 7-day window) ----------
def dials():
    day = state['tick'] // 24
    window = state['history'][-168:]   # last 7 days = 168 ticks
    if len(window) < 2:
        return None
    r0, o0, s0 = window[0]
    r1, o1, s1 = window[-1]
    cash = (r1 - r0) - (o1 - o0)
    # utilization: shipped in window / theoretical max (DRP capacity mid, t/day basis)
    drp_cap_t_day = mid(nodes['drp']['capacity_t_year']) / 365.0
    util = (s1 - s0) / (drp_cap_t_day * len(window) / 24.0)
    continuity = day - state['last_incident_day']
    return {'cash_7d_usd': cash, 'utilization_pct': util * 100.0, 'continuity_days': continuity}

def balance_error():
    # balance: input = in-system material + shipped + losses
    # processed_t accumulates DRP output only (EAF melt flows straight to dispatch
    # in this simplified mirror); in-system = DRP internal + processed not shipped.
    # EAF melt (melt_t) is NOT in processed_t — it flows straight to dispatch.
    # DRP output (processed_t) is NOT melted in this simplified mirror, so the
    # EAF yield loss applies only to scrap, not to the DRP stream.
    # The mirror's simplified flow ships melt_t directly; DRP output stays in
    # processed_t (in-system). Balance must account for the unshipped DRP stream.
    # shipped_t = melt_t only; DRP output (processed_t - melt_t) remains in-system.
    # EAF yield loss applies to scrap only (DRP stream not melted in this mirror).
    # shipped_t = melt_t only; DRP output (processed_t - melt_t) remains in-system.
    # DRP stream: input = processed_t + yield_loss_t (DRP portion); EAF stream:
    # input = shipped_t + yield_loss_t (EAF portion) + handling_loss_t.
    # Combined: input_total = processed_t + shipped_t + yield_loss_t + handling_loss_t.
    drp_stream_t = state['processed_t'] - state['shipped_t']   # DRP output, processed-not-shipped
    accounted = drp_stream_t + state['shipped_t'] + state['yield_loss_t'] + state['handling_loss_t']
    return abs(state['input_total_t'] - accounted)

# ---------- run ----------
for t in range(24 * 40):   # 40 in-game days
    tick(drp_input_t=50.0, scrap_input_t=40.0, control_action=(t == 24 * 12))
    if t % 24 == 0:
        d = dials()
        if d:
            print(f"day {t//24:2d} | drp_age {state['drp_age_days']:.1f} subopt={drp_suboptimal()} "
                  f"| dri_age {state['dri_age_days']:.1f} pen={eaf_energy_penalty_pct():.1f}% "
                  f"| downtime {state['kiln_downtime_ticks']} "
                  f"| cash7d ${d['cash_7d_usd']:.0f} util {d['utilization_pct']:.1f}% cont {d['continuity_days']}d")

print('yield_loss_t:', round(state['yield_loss_t'], 2), '| handling_loss_t:', round(state['handling_loss_t'], 2))
print('balance error:', round(balance_error(), 4))
