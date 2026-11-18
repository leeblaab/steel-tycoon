# Slice 1 canonical fixture — accepted scenario (Yasser GO 2026-10-13).
# Built from the verified probe_slice1_v17 run data (no re-run of the scenario).
# Scenario: capacity-mismatch bottleneck + intervention that shifts the constraint.
import json

FIXTURE_PATH = 'C:/AI_Lab/SteelX/fixtures/operations_domain3/d3_slice1_berth_bottleneck_seed11_120.json'

fixture = {
    "fixture_id": "d3_slice1_berth_bottleneck_seed11_120",
    "schema_version": 1,
    "domain": "operations_domain3",
    "status": "active_slice1_scenario",
    "note": (
        "Canonical Slice 1 scenario (accepted 2026-10-13). Capacity-mismatch path from EXISTING "
        "rules: dispatch effective_tph pinned at 40.0 < conveyor fill 41.6667 t/tick, so the yard "
        "can only fill from the conveyor side. FixedDraws all 0.5 = no-fire path (p = 24/1800 * 0.7 "
        "= 0.0093333 < 0.5; draws still consumed, contract intact). Yard starts EMPTY. Single berth, "
        "FIFO. Intervention at tick 48 (player decision moment): second crane -> effective_tph 80.0 "
        ">= unload rate 41.6667 -> throughput improves, but yard capacity (5000 t) becomes the next "
        "binding constraint: congestion fires at tick 96, upstream blocked 1521.6667 t at tick 120. "
        "The bottleneck SHIFTS downstream rather than being eliminated — valid learning outcome."
    ),
    "seed": 11,
    "prng": "xorshift32",
    "asset_order": ["eaf", "drp", "cc", "bar_mill", "wire_rod_mill", "crane"],
    "initial_state": {
        "day": 0,
        "generator_state": 11,
        "yard_stock_t": 0.0,
        "berth_ships": [],
        "dispatch_override": {"effective_tph": 40.0},
        "rng": "FixedDraws([0.5] * 720) — no-fire path (6 draws/tick x 120 ticks)"
    },
    "actions": [
        {"tick": 48, "type": "intervention", "asset": "crane", "change": "second crane: effective_tph 40.0 -> 80.0"}
    ],
    "tick_order": "mirror tick_ops order reproduced exactly",
    "cadence_boundary": "day += 1 BEFORE berth stages; arrivals on day % 24 == 0",
    "tick_count": 120,
    "tolerance": {"usd": 0.01, "tonnes": 1e-6, "categorical": "exact"},
    "expected_outputs": {
        "events": {
            "arrivals": [24, 48, 72, 96, 120],
            "berth_refusals": [24, 48, 72, 96, 120],
            "departures": [47, 71, 95, 119],
            "congestion_first_fire_tick": 96
        },
        "key_ticks": {
            "24": {"yard_stock_t": 521.6666666666667, "dispatched_t": 1920.0, "arrived_t": 2441.6666666666665, "upstream_blocked_t": 0.0, "ships_at_berth": 1, "congestion_flag": False},
            "47": {"yard_stock_t": 1940.0000000000007, "dispatched_t": 3760.0, "arrived_t": 5700.000000000001, "upstream_blocked_t": 0.0, "ships_at_berth": 0, "congestion_flag": False},
            "48": {"yard_stock_t": 2001.6666666666674, "dispatched_t": 3840.0, "arrived_t": 5841.666666666668, "upstream_blocked_t": 0.0, "ships_at_berth": 1, "congestion_flag": False},
            "96": {"yard_stock_t": 4920.0, "dispatched_t": 7680.0, "arrived_t": 12599.999999999989, "upstream_blocked_t": 41.66666666666606, "ships_at_berth": 1, "congestion_flag": False},
            "120": {"yard_stock_t": 4920.0, "dispatched_t": 9600.0, "arrived_t": 14519.999999999989, "upstream_blocked_t": 1521.6666666666733, "ships_at_berth": 1, "congestion_flag": True}
        },
        "material_balance": {
            "form": "opening(0) + berth_accepted + conveyor_accepted = closing_stock + dispatched",
            "berth_accepted_t": 3833.3333,
            "conveyor_accepted_t": 10686.6667,
            "closing_stock_t": 4920.0,
            "dispatched_t": 9600.0,
            "residual_t": 0.0,
            "must_hold": True
        },
        "per_ship_balance": {
            "form": "initial_cargo = accepted + remaining_aboard (no modelled losses or transfers)",
            "ships": {
                "S1": {"initial": 1000.0, "accepted": 1000.0, "remaining": 0.0, "residual": 0.0},
                "S2": {"initial": 1000.0, "accepted": 1000.0, "remaining": 0.0, "residual": 0.0},
                "S3": {"initial": 1000.0, "accepted": 1000.0, "remaining": 0.0, "residual": 0.0},
                "S4": {"initial": 1000.0, "accepted": 1000.0, "remaining": 0.0, "residual": 0.0},
                "S5": {"initial": 1000.0, "accepted": 0.0, "remaining": 1000.0, "residual": 0.0, "note": "arrived tick 120, no unload on arrival tick — valid under current rules"}
            },
            "must_hold": True
        },
        "intervention_effect": {
            "before": {"dispatch_tph": 40.0, "throughput_at_fix_tick": 3840.0},
            "after": {"dispatch_tph": 80.0, "throughput_at_tick_120": 9600.0},
            "constraint_shift": "dispatch capacity -> yard capacity (5000 t); congestion fires tick 96, upstream blocked 1521.6667 t at tick 120",
            "learning_outcome": "intervention improves throughput but shifts the bottleneck downstream; player must inspect and understand the shift"
        },
        "counters_at_tick_120": {
            "unload_blocked_t": 0.0,
            "berth_blocked_t": 0,
            "congestion_flag": True,
            "demurrage_usd": 0.0,
            "ship_days_beyond_free": 0.0,
            "ships_arrived": 5,
            "ships_departed": 4
        }
    },
    "negative_control": {
        "form": "double-counting berth cargo breaks the yard balance",
        "expected_residual_if_double_counted": -3833.3333,
        "must_detect": True
    }
}

with open(FIXTURE_PATH, "w", encoding="utf-8") as f:
    json.dump(fixture, f, indent=2)
print("fixture written:", FIXTURE_PATH)
