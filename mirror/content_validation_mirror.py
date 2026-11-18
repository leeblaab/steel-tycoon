# Mirror-first: content validation contract (Foundations micro-step 2, Yasser GO 2026-10-10).
# Python mirror of the validation rules BEFORE porting to content_loader.gd.
# Rules (definitions doc A-E, approved):
# 1. Every content JSON must be an object with schema_version == 1 (list-shaped
#    files wrapped as {schema_version, items}).
# 2. Required-field sets per file type; missing field = named error (file + field).
# 3. Numeric fields must parse; string ranges "lo-hi" validated lo <= hi.
# 4. *_mid fields must lie WITHIN their numeric source band (Yasser decision
#    2026-10-10, Option 1: stored _mid values are deliberate game-balance
#    calibrations, not band midpoints — the contract is containment, not
#    equality; 13 real-content values sit below band midpoints by design).
# 5. Reject, never default: validation returns errors; loader must not silently
#    substitute defaults.
# Required-field sets below are the PROPOSED contract — Yasser approval gate before
# porting to GDScript. Kept minimal (identity + SME fields only).

import json, os

CONTENT = r'C:\AI_LAB\SteelX\content'
EXPECTED_VERSION = 1

REQUIRED = {
    'nodes/nodes_phase1.json': {
        'top': ['phase1_nodes', 'flow'],
        'item': {
            'phase1_nodes': ['id', 'name', 'category', 'sme_pending'],
            'flow': ['from', 'to'],   # transport may be null (no belt)
        },
    },
    'cards/cards_phase1_draft.json': {
        'top': ['items'],
        'item': {'items': ['id', 'title', 'category', 'body', 'sme_pending']},
    },
    'sequence/level1_draft.json': {
        'top': ['level1_sequence'],
        # Step types differ (intro card / build / milestone): id only on the intro
        # card step; build steps carry card_id+node_id; the completion step carries
        # flag. Contract: every step has step+type; card step needs id; build steps
        # need card_id+node_id; milestone needs flag.
        'item': {},
        'step_rule': {
            'all': ['step', 'type'],
            'by_type': {'card': ['id'], 'build': ['card_id', 'node_id'], 'milestone': ['flag']},
        },
    },
    'sounds/sounds_phase1.json': {
        'top': ['sound_events'],
        'item': {},   # event -> file map, not an array
    },
    'prices/price_ladder_draft.json': {
        'top': ['grades', 'fallback'],
        'item': {'grades': ['id', 'product', 'price_usd_t', 'cu_max', 'sn_max', 'sme_pending']},
    },
    'upgrades/upgrades_phase1_draft.json': {
        'top': ['upgrades'],
        'item': {'upgrades': ['id', 'name', 'category', 'cost_usd', 'effect', 'sme_pending']},
    },
    'maps/maps_phase1_draft.json': {
        'top': ['maps'],
        'item': {'maps': ['id', 'title', 'symbols', 'edges', 'sme_pending']},
    },
    'nodes/conveyors_draft.json': {
        'top': ['conveyors', 'scrap_feed'],
        'item': {'conveyors': ['id', 'name', 'category', 'from', 'to', 'sme_pending']},
    },
    'nodes/dispatch_draft.json': {
        'top': ['id', 'name', 'category', 'sme_pending'],
        'item': {},   # single object, not an array
    },
    'scrap/scrap_tiers.json': {
        'top': ['grades', 'sizes', 'furnace_condition'],
        'item': {
            'grades': ['id', 'price_usd_t', 'yield_loss_pct', 'ttt_quality_factor', 'sme_pending'],
            'sizes': ['id', 'handling_loss_pct', 'sme_pending'],
        },
    },
    'schema/card.schema.json': {'top': None, 'item': {}},
    'schema/map.schema.json': {'top': None, 'item': {}},
    'assets/models/cc0/cc0_mapping_draft.json': {'top': None, 'item': {}},
    'assets/models/cc0/cc0_inventory.json': {'top': None, 'item': {}},
    # Domain 2 / Domain 4 configs: shape governance lives in each domain mirror
    # (reject-never-default); the central walk adds schema_version + numeric-band
    # checks. Listed here so the central sweep covers EVERY content JSON — no file
    # may be silently skipped.
    'economy/economics_domain2.json': {'top': None, 'item': {}},
    'sustainability/sustainability_domain4.json': {'top': None, 'item': {}},
}

def parse_num(s):
    # numeric with optional magnitude suffix (M, K); raises ValueError otherwise.
    s = s.strip()
    mult = 1.0
    if s.endswith('M'):
        mult, s = 1e6, s[:-1]
    elif s.endswith('K'):
        mult, s = 1e3, s[:-1]
    return float(s) * mult

def parse_range(v):
    # "lo-hi" string range (suffixes allowed, e.g. "20-50M"); negative lo handled.
    if isinstance(v, (int, float)):
        return (float(v), float(v))
    parts = v.split('-')
    return (parse_num(parts[0]), parse_num(parts[-1]))

def validate_file(rel, doc):
    errors = []
    if not isinstance(doc, dict):
        errors.append(f"{rel}: not an object (must be {{schema_version, items}})")
        return errors
    if doc.get('schema_version') != EXPECTED_VERSION:
        errors.append(f"{rel}: schema_version missing or != {EXPECTED_VERSION}")
    req = REQUIRED.get(rel, {'top': None, 'item': {}})
    if req['top']:
        for k in req['top']:
            if k not in doc:
                errors.append(f"{rel}: missing required top-level field '{k}'")
    for container, fields in req['item'].items():
        for i, item in enumerate(doc.get(container, [])):
            for f in fields:
                if f not in item:
                    errors.append(f"{rel}: {container}[{i}] missing required field '{f}'")
    # step_rule: per-type required fields (sequence steps differ by type)
    rule = req.get('step_rule')
    if rule:
        for container, _ in req['item'].items():
            for i, item in enumerate(doc.get(container, [])):
                for f in rule['all']:
                    if f not in item:
                        errors.append(f"{rel}: {container}[{i}] missing required field '{f}'")
                for f in rule['by_type'].get(item.get('type'), []):
                    if f not in item:
                        errors.append(f"{rel}: {container}[{i}] (type={item.get('type')}) missing required field '{f}'")
    walk_numeric(doc, '', rel, errors)
    return errors

NUMERIC_FIELDS = {
    'capex_usd', 'capex_usd_mid', 'capex_usd_per_tpa', 'opex_per_t',
    'supply_rate_t_month', 'scrap_arrival_t_day', 'scrap_arrival_t_day_mid',
    'stockpile_kt', 'handling_loss_pct', 'handling_loss_pct_mid',
    'yield_pct', 'kiln_availability_pct', 'kiln_availability_pct_mid',
    'capacity_t_year', 'power_kwh_t', 'power_delta_kwh_t_per_10pct_dri',
    'dri_soft_ceiling_pct', 'rate_t_h', 'effective_tph', 'crane_rate_t_h',
    'truck_size_t', 'truck_cycle_min', 'cycle_min', 'tap_to_tap_min', 'tap_t',
    'buffer_days', 'drift_days', 'aging_penalty_days', 'aging_penalty_energy_pct',
    'met_pct', 'energy_gj_t', 'strands',
    'price_usd_t', 'yield_loss_pct', 'ttt_quality_factor', 'handling_loss_pct',
    'condition_overhaul_at', 'ttt_degrade_max', 'degrade_rate_per_heat',
}

def walk_numeric(obj, path, rel, errors):
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k in NUMERIC_FIELDS:
                try:
                    lo, hi = parse_range(str(v))
                    if lo > hi:
                        errors.append(f"{rel}: {path}{k} range inverted (lo>hi)")
                except ValueError:
                    errors.append(f"{rel}: {path}{k} unparseable numeric value '{v}'")
            if k.endswith('_mid') and isinstance(v, (int, float)):
                src = k[:-4]
                if src in obj and src in NUMERIC_FIELDS:
                    lo, hi = parse_range(str(obj[src]))
                    if not (lo - 1e-9 <= float(v) <= hi + 1e-9):
                        errors.append(f"{rel}: {path}{k} outside band '{obj[src]}'")
            walk_numeric(v, path + k + '.', rel, errors)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            walk_numeric(v, path + f'[{i}].', rel, errors)

def main():
    all_errors = []
    for rel in sorted(REQUIRED):
        p = os.path.join(CONTENT, rel)
        doc = json.load(open(p, encoding='utf-8'))
        all_errors.extend(validate_file(rel, doc))

    # Negative tests (rule 5: reject, never default) — must FAIL as intended.
    neg = []
    bad = json.loads('{"schema_version": 2, "phase1_nodes": [], "flow": []}')
    neg += validate_file('nodes/nodes_phase1.json', bad)
    bad2 = json.loads('{"schema_version": 1, "phase1_nodes": [{"id": "x", "name": "n", "category": "equipment"}], "flow": []}')
    neg += validate_file('nodes/nodes_phase1.json', bad2)
    bad3 = json.loads('{"schema_version": 1, "phase1_nodes": [{"id": "x", "name": "n", "category": "equipment", "sme_pending": false, "capex_usd": "50-20", "capex_usd_mid": 35000000.0}], "flow": []}')
    neg += validate_file('nodes/nodes_phase1.json', bad3)
    bad4 = json.loads('{"schema_version": 1, "phase1_nodes": [{"id": "x", "name": "n", "category": "equipment", "sme_pending": false, "capex_usd": "20-50M", "capex_usd_mid": 60000000.0}], "flow": []}')
    neg += validate_file('nodes/nodes_phase1.json', bad4)
    print('negative tests (must fail as intended):')
    for e in neg:
        print('  ', e)

    if all_errors:
        print('VALIDATION ERRORS (real content):')
        for e in all_errors:
            print(' ', e)
    else:
        print(f'validation: 0 errors across {len(REQUIRED)} content JSONs')
    return all_errors

if __name__ == '__main__':
    main()
