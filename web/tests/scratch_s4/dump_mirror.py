# Throwaway dump: fresh post-patch slice4_mirror replay -> JSON for the TS parity test.
# Reads ONLY the mirror + fixture + content (frozen dirs untouched); writes only this scratch dir.
import json, os, sys

sys.path.insert(0, r'C:\AI_LAB\SteelX\mirror')
import slice4_mirror as m

HERE = os.path.dirname(os.path.abspath(__file__))
fx = m.load_fixture()
tiers = m.load_scrap_tiers()

state, records = m.run(fx, tiers)

# per-tick bath_t + dri consumed_t snapshots (not exposed by mirror's own records)
bath_series = []
consumed_series = []
st = m.fresh_state(fx)
for ch in fx['scenario']['charge_plan']:
    st['charges'].append({
        'charge_id': ch['charge_id'], 'recipe_id': ch['recipe_id'],
        'grade_composition': [{'grade': g['grade'], 'required_usable_t': g['required_usable_t'],
                               'actual_usable_t': g['actual_usable_t']} for g in ch['composition']],
        'readiness_timestamp': None, 'deadline': ch['deadline_tick'],
        'status': 'planning', 'failure_cause': None,
    })
for mm in fx['scenario']['dri_plan']:
    st['dri_materials'].append({
        'material_id': mm['material_id'], 'usable_t': mm['usable_t'],
        'quality_metadata': {}, 'source': 'DRI buffer',
        'readiness_timestamp': mm['ready_tick'], 'destination': 'EAF feed interface',
        'consumed_t': 0.0,
    })
for i in range(fx['scenario']['ladles']):
    st['ladles'].append({'ladle_id': f"L{i+1}", 'status': 'free',
                         'busy_charge_id': None, 'busy_since': None,
                         'metal_t': 0.0, 'refined': False})
raw_max = 0.0
for _ in range(fx['scenario']['ticks']):
    st = m.tick(st, fx, tiers)
    bath_series.append({'tick': st['tick'], 'bath_t': st['eaf']['bath_t']})
    consumed_series.append({'tick': st['tick'],
                            'consumed_t': [d['consumed_t'] for d in st['dri_materials']]})
    raw_max = max(raw_max, abs(st['balance_error']))

neg = m.run_negative_tests(fx, tiers)

out = {
    'win': state['win'],
    'counters': state['counters'],
    'billet_yard_t': state['billet_yard_t'],
    'balance_error_raw': state['balance_error'],
    'max_abs_balance_error_raw_all_ticks': raw_max,
    'charge_statuses': {c['charge_id']: {'status': c['status'], 'failure_cause': c['failure_cause']}
                        for c in state['charges']},
    'dri_consumed_final': {d['material_id']: d['consumed_t'] for d in state['dri_materials']},
    'ladles_final': st['ladles'],
    'records': records,
    'bath_series': bath_series,
    'consumed_series': consumed_series,
    'negative_tests': [{'name': n, 'ok': bool(o), 'detail': d} for n, o, d in neg],
}
path = os.path.join(HERE, 'mirror_dump.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=1)
print('wrote', path)
print('win:', out['win'], 'max_abs_balance_error:', out['max_abs_balance_error_raw_all_ticks'])
print('bath distinct:', sorted({b['bath_t'] for b in bath_series}))
print('consumed final:', out['dri_consumed_final'])
for t in out['negative_tests']:
    print(('PASS' if t['ok'] else 'FAIL'), t['name'], '-', t['detail'])
