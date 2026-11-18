# S2 crane priority-collision probe (Decision 1, design-only).
# Copies the frozen fixture IN MEMORY (json.loads(json.dumps(...))) and applies
# ONLY scenario-value changes from docs/s2_collision_scenario_plan.md:
#   delta 1: truck_loads gains {'tick': 269, grade hms1_hms2, 30.0t}
#            (backlog arrival; truck_arrival_ticks synced)
# Scenario constants unchanged: reclaim@40 (prio 1), charge plan
# 41/86/141/186/231/276, deadlines 240/270/300, grab 2.0 m3, ticks 300.
# Two configs differ ONLY in the player's priority verb on queued task
# T40-reclaim (2 = deprioritized vs fixture default 1). No rule touched.
#
# Hand-computed collision geometry (validated by this probe):
#   decision tick T = 69: crane frees P1-hms; queue holds
#     T40-reclaim  prio1, est 9 ticks  (FIFO-earlier)
#     T60-bushing  prio2, est 15 ticks
#   charge P1-bush is planned for tick 86 -> slack = 86 - (69+9) = 8 <= 15.
#   reclaim priority 1 -> crane takes reclaim 69-77 -> T78-hms arrival outranks
#   the still-queued bushing receive -> stack short at 85 -> P1-bush refused
#   -> C1 fails 'insufficient_usable_tonnage' @240, cascade C3 'planning'.
#   reclaim priority 2 (verb from tick 41) -> crane takes T60-bushing 69-83,
#   reclaim runs idle window 84-92 -> baseline win C1@101/C2@201/C3@291.

import sys, json
sys.path.insert(0, r'C:\AI_LAB\SteelX\mirror')
import slice2_mirror as m

BASE = m.load_fixture()  # frozen fixture; never written back

CHARGE_PLAN = {
    41:  [('P1-hms', 30.0, 'hms1_hms2')],
    86:  [('P1-bush', 15.0, 'bushing')],
    141: [('P2-hms', 30.0, 'hms1_hms2')],
    186: [('P2-bush', 15.0, 'bushing')],
    231: [('P3-hms', 30.0, 'hms1_hms2')],
    276: [('P3-bush', 15.0, 'bushing')],
}

def scenario_copy():
    """In-memory copy of the frozen fixture with ONLY the plan's value deltas."""
    fx = json.loads(json.dumps(BASE))
    loads = list(fx['scenario']['truck_loads'])
    loads.append({'tick': 269, 'grade': 'hms1_hms2', 'tonnes': 30.0})
    loads.sort(key=lambda l: l['tick'])
    fx['scenario']['truck_loads'] = loads
    fx['scenario']['truck_arrival_ticks'] = [l['tick'] for l in loads]
    return fx

def report(name, fx, verb):
    state, _ = m.run(fx, verb, CHARGE_PLAN)
    print(f"\n=== {name} ===")
    print(f"win: {state['win']}")
    for c in state['charges']:
        slack = (c['deadline'] - c['readiness_timestamp']) if c['readiness_timestamp'] else None
        if c['failure_cause']:
            print(f"  {c['charge_id']}: FAILED cause={c['failure_cause']} "
                  f"(deadline {c['deadline']}, never ready)")
        else:
            print(f"  {c['charge_id']}: {c['status']} ready@{c['readiness_timestamp']} "
                  f"deadline={c['deadline']} slack={slack}")
    keys = ('reclaim task enters', 'refused', 'FAILED', 'starts reclaiming',
            'completes reclaiming', 'starts receiving T60', 'completes receiving T60')
    for e in state['events']:
        if any(k in e['event'] for k in keys):
            print(f"  [t{e['tick']}] {e['event']}")
    return state

fx = scenario_copy()
win = report("CONFIG A — T40-reclaim deprioritized to 2 (verb from tick 41)",
             fx, {t: {'T40-reclaim': 2} for t in range(41, 301)})
lose = report("CONFIG B — fixture default priority (T40-reclaim stays 1)", fx, {})

flip = win['win'] and not lose['win']
slack_ok = any(c['readiness_timestamp'] is None or c['deadline'] - c['readiness_timestamp'] <= 15
               for c in lose['charges'])
print(f"\ncollision flip demonstrated: {flip} "
      f"(decision tick 69, slack at decision = 8 <= 15)")
