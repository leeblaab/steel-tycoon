# Throwaway dump: fresh slice3_mirror replay -> JSON for the TS parity test.
# Reads ONLY the mirror + fixture (frozen dirs untouched); writes only this scratch dir.
import json, os, sys

sys.path.insert(0, r'C:\AI_LAB\SteelX\mirror')
import slice3_mirror as m

HERE = os.path.dirname(os.path.abspath(__file__))
fx = m.load_fixture()
m.validate_scenario(fx)

# --- primary fixture: full state walk to capture prng_state at every tick ---
state = m.fresh_state(fx)
prng_series = []
for _ in range(fx['scenario']['ticks']):
    state = m.tick(state, fx)
    prng_series.append({'tick': state['tick'], 'prng_state': state['prng_state']})
state, records = m.run(fx)
summary = m.summarize(state, records, fx)

# --- fill-negative fixture (run the mirror code path on it too) ---
fx2 = m.load_fixture(os.path.join(r'C:\AI_LAB\SteelX', 'fixtures', 'slice3',
                                  's3_fill_negative_seed11_120.json'))
m.validate_scenario(fx2)
state2, records2 = m.run(fx2)
summary2 = m.summarize(state2, records2, fx2)

# --- plan_overdraw negative control (mirror __main__ L276-280 verbatim) ---
bad = json.loads(json.dumps(fx))
bad['scenario']['eaf']['charge_t'] = 120.0
st_bad, rec_bad = m.run(bad)
causes = sorted({h['failure_cause'] for h in st_bad['heats'] if h['status'] == 'skipped'})

# --- canonical xorshift32 vector (gate #0 semantics, seed 1 first three draws) ---
xvec = []
st_ = 1
for _ in range(3):
    st_, d = m.xorshift32_next(st_)
    xvec.append(d)

out = {
    'primary': {
        'fixture_id': fx['fixture_id'],
        'records': records,
        'final_state_events_tail_ticks': [e for e in state['events'] if e['tick'] >= 118],
        'prng_series': prng_series,
        'heats_final': state['heats'],
        'win': state['win'],
        'summary': summary,
    },
    'fill_negative': {
        'fixture_id': fx2['fixture_id'],
        'records': records2,
        'win': state2['win'],
        'summary': summary2,
    },
    'plan_overdraw_control': {
        'win': st_bad['win'],
        'causes': causes,
        'heat_statuses': {h['material_id']: [h['status'], h.get('failure_cause')] for h in st_bad['heats']},
    },
    'xorshift_vector_seed1': xvec,
}
path = os.path.join(HERE, 'mirror_dump.json')
with open(path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=1)
print('wrote', path)
print('primary win:', out['primary']['win'], 'summary:', out['primary']['summary'])
print('fill win:', out['fill_negative']['win'])
print('plan_overdraw control:', out['plan_overdraw_control']['win'], out['plan_overdraw_control']['causes'])
print('xorshift seed1 vec:', xvec)
