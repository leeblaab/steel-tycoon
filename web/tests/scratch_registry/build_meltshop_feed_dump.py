# S3.1 meltshop-feed parity dump — drive the REAL slice1 (ops domain3), slice3 and slice4
# mirrors for 60 ticks. slice1 dispatched_t deltas deposit the scrap edge; slice3
# discharged_t_total deltas deposit the DRI edge; slice4 heat-start transitions
# (delivered -> in_furnace) are owner-tagged consumptions (scrap rows / DRI rows).
# The literal clone (mirror/meltshop_feed_mirror.py) replays the same chain so the TS
# parity test can compare row-by-row. EAF commissions at tick 30 mid-run.
import sys, json
sys.path.insert(0, 'mirror')
import operations_domain3_mirror as m1
import slice3_mirror as m3
import slice4_mirror as m4
import meltshop_feed_mirror as mf

TICKS = 60
COMMISSION_TICK = 30

cfg = m1.load_ops_config('C:/AI_LAB/SteelX/content/operations/operations_domain3.json')
rng = m1.FixedDraws([0.5] * (6 * TICKS))
s1 = m1.fresh_state()
fx3 = m3.load_fixture()
s3 = m3.fresh_state(fx3)
fx4 = m4.load_fixture()
tiers = m4.load_scrap_tiers()
s4 = m4.fresh_state(fx4)
for ch in fx4['scenario']['charge_plan']:
    s4['charges'].append({
        'charge_id': ch['charge_id'], 'recipe_id': ch['recipe_id'],
        'grade_composition': [{'grade': g['grade'], 'required_usable_t': g['required_usable_t'],
                               'actual_usable_t': g['actual_usable_t']} for g in ch['composition']],
        'readiness_timestamp': None, 'deadline': ch['deadline_tick'],
        'status': 'planning', 'failure_cause': None,
    })
for mm in fx4['scenario']['dri_plan']:
    s4['dri_materials'].append({
        'material_id': mm['material_id'], 'usable_t': mm['usable_t'],
        'quality_metadata': {}, 'source': 'DRI buffer',
        'readiness_timestamp': mm['ready_tick'], 'destination': 'EAF feed interface',
        'consumed_t': 0.0,
    })
for i in range(fx4['scenario']['ladles']):
    s4['ladles'].append({'ladle_id': f"L{i+1}", 'status': 'free',
                         'busy_charge_id': None, 'busy_since': None,
                         'metal_t': 0.0, 'refined': False})

feed = mf.fresh_feed_state()
prev_dispatched = s1['dispatched_t']
prev_discharged = s3['discharged_t_total']
prev_status = {c['charge_id']: c['status'] for c in s4['charges']}
deposits_total = 0.0
rows = []
for t in range(1, TICKS + 1):
    s1 = m1.tick_ops(rng, s1) or s1
    s3 = m3.tick(s3, fx3)
    s4 = m4.tick(s4, fx4, tiers)
    dsc = s1['dispatched_t'] - prev_dispatched
    prev_dispatched = s1['dispatched_t']
    ddr = s3['discharged_t_total'] - prev_discharged
    prev_discharged = s3['discharged_t_total']
    if dsc > 0:
        mf.deposit_scrap(feed, dsc); deposits_total += dsc
    if ddr > 0:
        mf.deposit_dri(feed, ddr); deposits_total += ddr
    cons = []
    for c in s4['charges']:
        if c['status'] == 'in_furnace' and prev_status.get(c['charge_id']) != 'in_furnace':
            cons.append({
                'charge_id': c['charge_id'],
                'scrap_t': sum(r['actual_usable_t'] for r in c['grade_composition'] if r['grade'] != 'DRI'),
                'dri_t': sum(r['actual_usable_t'] for r in c['grade_composition'] if r['grade'] == 'DRI'),
            })
        prev_status[c['charge_id']] = c['status']
    mf.step_feed(feed, cons)
    if t == COMMISSION_TICK:
        mf.commission_eaf(feed)
    v = mf.ledger_view(feed)
    rows.append({
        'tick': t,
        'consumptions': cons,
        'slice_dispatched_t': round(s1['dispatched_t'], 6),
        'slice_discharged_t': round(s3['discharged_t_total'], 6),
        'scrap_bucket_t': round(v['scrap_bucket_t'], 6),
        'dri_feed_buffer_t': round(v['dri_feed_buffer_t'], 6),
        'eaf_scrap_t': round(v['eaf_scrap_t'], 6),
        'eaf_dri_t': round(v['eaf_dri_t'], 6),
        'in_transit_t': round(v['in_transit_t'], 6),
        'consumed_scrap_t': round(v['consumed_scrap_t'], 6),
        'consumed_dri_t': round(v['consumed_dri_t'], 6),
        'shortfalls_this_tick': sum(1 for e in feed['reg'].events
                                    if e['tick'] == feed['reg'].tick and 'SHORTFALL' in e['event']),
    })
inv = mf.invariants(feed, deposits_total)
fixture = {
    'fixture_id': 'meltshop_feed_v1', 'schema_version': 1,
    'note': ('slice1 ops mirror (seed 11, FixedDraws no-fire) dispatched_t deltas + slice3 mirror '
             'discharged_t_total deltas deposit the two feed edges; slice4 mirror heat starts are '
             'owner-tagged consumptions; literal clone of meltshop_feed.ts; EAF commissions at tick '
             f'{COMMISSION_TICK}'),
    'scrap_edge': mf.SCRAP_EDGE, 'dri_edge': mf.DRI_EDGE,
    'commission_tick': COMMISSION_TICK, 'tick_count': TICKS,
    'rows': rows,
    'deposits_total': round(deposits_total, 6),
    'closure_ok': inv['ok'], 'closure_detail': inv['detail'],
}
with open('web/tests/scratch_registry/meltshop_feed_dump.json', 'w') as f:
    json.dump(fixture, f, indent=2)
print('dump written; deposits', round(deposits_total, 3), 'closure', inv)
print('final:', {k: rows[-1][k] for k in ('scrap_bucket_t', 'dri_feed_buffer_t', 'eaf_scrap_t', 'eaf_dri_t', 'consumed_scrap_t', 'consumed_dri_t')})
print('total shortfall events:', sum(r['shortfalls_this_tick'] for r in rows))
