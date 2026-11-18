# SteelX — Foundations Definitions (approved A–E, 2026-10-10)

Micro-step 1 = data structure only. No logic, no validation code yet.

## A. Canonical units
- Mass: metric tonne (t). Money: USD. Time: tick = 1 in-game hour; day = 24 ticks.
- New JSON fields follow `<quantity>_<unit>` naming (e.g. `capacity_t_y`, `rate_t_h`, `energy_gj_t`).
- Existing fields are NOT renamed (engine + mirror read them); a mapping table below is the contract.

| Existing field | Canonical unit |
|---|---|
| capacity_t_year | t/y |
| supply_rate_t_month | t/mo |
| scrap_arrival_t_day | t/d |
| rate_t_h / effective_tph / crane_rate_t_h | t/h |
| power_kwh_t, power_delta_kwh_t_per_10pct_dri | kWh/t |
| energy_gj_t | GJ/t |
| buffer_days, drift_days, aging_penalty_days | in-game days |
| cycle_min, tap_to_tap_min, truck_cycle_min | minutes |
| stockpile_kt | kt (= 1000 t) |
| capex_usd, capex_usd_mid, capex_usd_per_tpa, opex_per_t | USD (capex_usd_per_tpa = USD per t/y) |
| *_pct fields | percent |

## B. Balance boundary per stage (Inputs = Products + By-products + Losses + ΔInventory)
- **Input boundary:** material entering the system at jetty (ore) and scrap_yard intake (scrap). One count per tick at entry.
- **DRP:** dust/fines + unreduced (FeO) → `yield_loss` accumulator.
- **EAF:** physical handling loss → `handling_loss` (separate, SME rule); oxidation/melt yield → `yield_loss`.
- **Caster/mills:** scale + crop/cobble → `yield_loss` (named accumulator when rolling yields land; scale becomes its own accumulator only if the sustainability domain sells it).
- **WIP (ΔInventory):** node stock/internal/out_buf/overflow, flow link stocks, heats (waiting/casting/held).
- **Exit:** `sold` (dispatch load-out), `dumped` (100% loss).
- **Future streams:** slag, dust, by-products live as losses until the sustainability domain converts them to sellable outputs — at that point they move from Losses to Products in the equation. The boundary list is the contract that makes this move explicit.

## C. Tolerance rule
- Balance test asserts against the UNROUNDED value: tolerance 1e-6 t per accumulator (float accumulation error only).
- Reporting gate stays: test_runner prints balance to 4 decimals, gate `< 0.01` t.
- JSON round-trip float comparisons keep tolerance `absf(a-b) < 0.01`.

## D. schema_version (micro-step 1 — added to every content JSON)
- Top-level `"schema_version": 1` on every content JSON.
- Savegame: `"schema_version": 1` + migration policy — loader rejects unknown versions (fail-fast), never silently defaults.
- Version bump rule: +1 on any field-shape change; save migration required on every bump.

## E. Validation contract (micro-step 2 — logic, gated separately)
- ContentLoader rejects missing required fields and out-of-range values with a named error (file + field), instead of `get(key, default)`.
- Required-field sets defined per file type in `content/schema/` (card, map, node, sequence, sound, upgrade, price).
- Range validation: numeric fields must parse; string ranges (`"500000-2500000"`) validated as lo<=hi.
- `_mid` fields must lie **within** their band (Yasser decision 2026-10-10, Option 1: stored `_mid` values are deliberate game-balance calibrations, not band midpoints — contract is containment, not equality).
- Sequence step rule by type (live shapes, 2026-10-10): every step has `step`+`type`; card step needs `id`; build steps need `card_id`+`node_id`; milestone needs `flag`.
