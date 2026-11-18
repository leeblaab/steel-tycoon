# Task 2 — Grade-based pricing mirror. MICRO-STEP 1: DATA STRUCTURE ONLY.
# No logic, no print statements. Values sourced from content/prices/price_ladder_draft.json
# and the SME-calibrated scrap bands. No numbers invented.

# --- 5 grades (per Yasser's list) ---
# Note: the draft has 6 entries; "CQ/High-strength" merges the draft's
# "1008 high-strength" and "CQ-15" rows. The merged grade's band/limits are
# marked TBD pending Yasser's decision — see question at bottom.

GRADES = [
    {
        "id": "B500B",
        "product": "rebar",
        "price_usd_t": (620, 650),
        "cu_max": 0.25,
        "sn_max": 0.05,
        "requires": None,
    },
    {
        "id": "QST32-3",
        "product": "rebar",
        "price_usd_t": (675, 700),
        "cu_max": 0.10,
        "sn_max": 0.02,
        "requires": "qtb",
    },
    {
        "id": "SAE1006_1008_commodity",
        "product": "wire_rod",
        "price_usd_t": (595, 665),
        "cu_max": 0.25,
        "sn_max": 0.05,
        "requires": None,
    },
    {
        "id": "CQ_high_strength",
        "product": "wire_rod",
        "price_usd_t": (640, 680),
        "cu_max": 0.12,
        "sn_max": 0.025,
        "requires": None,
    },
    {
        "id": "SG-2_special",
        "product": "wire_rod",
        "price_usd_t": (680, 720),
        "cu_max": 0.05,
        "sn_max": 0.01,
        "requires": None,
    },
]

# --- 3 scrap grades (SME-calibrated bands, Cu/Sn as ranges) ---
SCRAP_GRADES = [
    {
        "id": "bushing",
        "tier": "premium",
        "cu_avg": (0.00, 0.05),
        "sn_avg": (0.00, 0.01),
    },
    {
        "id": "HMS1_2",
        "tier": "baseline",
        "cu_avg": (0.10, 0.25),
        "sn_avg": (0.02, 0.05),
    },
    {
        "id": "shredded",
        "tier": "high_yield_loss",
        "cu_avg": (0.25, 0.50),
        "sn_avg": (0.04, 0.08),
    },
]

# --- MICRO-STEP 2: CALCULATION LOGIC ONLY (no prints, no test execution) ---
# Assumption (flagged, not invented): each scrap grade contributes its band
# MIDPOINT as its average Cu/Sn level. DRI contributes 0.0% tramp.
# Weights are normalized by their sum, so a blend dict may include a "DRI"
# key (contributes 0.0) or omit it (remainder treated as DRI = 0.0 contribution).

SCRAP_BY_ID = {g["id"]: g for g in SCRAP_GRADES}

def calculate_heat_chemistry(scrap_blend):
    """Mass-weighted average Cu and Sn percentages for a heat charge.

    scrap_blend: {scrap_grade_id: weight_fraction}, e.g. {"bushing": 0.4, "HMS1_2": 0.6}
    Returns (cu_pct, sn_pct).
    """
    cu_sum = 0.0
    sn_sum = 0.0
    total_w = 0.0

    for grade_id, weight in scrap_blend.items():
        if grade_id == "DRI":
            grade_cu = grade_sn = 0.0  # DRI contributes 0.0% tramp
        else:
            grade = SCRAP_BY_ID[grade_id]
            grade_cu = (grade["cu_avg"][0] + grade["cu_avg"][1]) / 2.0
            grade_sn = (grade["sn_avg"][0] + grade["sn_avg"][1]) / 2.0

        cu_sum += weight * grade_cu
        sn_sum += weight * grade_sn
        total_w += weight

    return (cu_sum / total_w, sn_sum / total_w)

# --- MICRO-STEP 3: GRADE ASSIGNMENT LOGIC ONLY (no prints, no test execution) ---
# Ranking rule: highest-value grade the chemistry qualifies for, by price-band
# MIDPOINT descending. Chemistry-only — 'requires' gates (e.g. QTB) are NOT
# checked here; that is a capability check, not a chemistry check.
# At-limit chemistry passes (cu_max / sn_max are maximums, inclusive).

FALLBACK_ID = "off_grade_scrap"

def assign_grade(cu_pct, sn_pct):
    """Return the ID of the highest-value grade this chemistry qualifies for,
    or FALLBACK_ID if it fails all 5 grades.
    """
    best_id = None
    best_mid = -1.0

    for grade in GRADES:
        if cu_pct <= grade["cu_max"] and sn_pct <= grade["sn_max"]:
            mid = (grade["price_usd_t"][0] + grade["price_usd_t"][1]) / 2.0
            if mid > best_mid:
                best_mid = mid
                best_id = grade["id"]

    return best_id if best_id is not None else FALLBACK_ID

# --- MICRO-STEP 4: REVENUE CALCULATION LOGIC ONLY (no prints, no test execution) ---
# Revenue uses the exact midpoint of each grade's price band.
# Fallback price 475 USD/t per Yasser's decision (mid-point of the $450-500/t
# off-grade/scrap band). In the Godot engine this value must come from JSON,
# not hardcoded — hardcoded here only because this is the Python mirror.

FALLBACK_PRICE_USD_T = 475.0

GRADES_BY_ID = {g["id"]: g for g in GRADES}

def calculate_revenue(tonnes, grade_id):
    """Revenue = tonnes x price-band midpoint (or fallback price for off-grade)."""
    if grade_id == FALLBACK_ID:
        price = FALLBACK_PRICE_USD_T
    else:
        band = GRADES_BY_ID[grade_id]["price_usd_t"]
        price = (band[0] + band[1]) / 2.0

    return tonnes * price

# --- MICRO-STEP 5: PRINT STATEMENTS / TEST EXECUTION ---
if __name__ == "__main__":
    TEST_BLENDS = [
        {"bushing": 0.4, "HMS1_2": 0.6},
        {"bushing": 1.0},
        {"HMS1_2": 0.5, "DRI": 0.5},
        {"shredded": 0.3, "DRI": 0.7},
        {"bushing": 0.2, "HMS1_2": 0.8},
        {"shredded": 1.0},
    ]

    TEST_TONNES = 100.0

    for blend in TEST_BLENDS:
        cu, sn = calculate_heat_chemistry(blend)
        grade = assign_grade(cu, sn)
        revenue = calculate_revenue(TEST_TONNES, grade)
        blend_str = ", ".join(f"{k} {v:.2f}" for k, v in blend.items())
        print(f"Blend: [{blend_str}] | Cu: {cu:.4f}% Sn: {sn:.4f}% | Grade: {grade} | Revenue (100t): ${revenue:.2f}")
