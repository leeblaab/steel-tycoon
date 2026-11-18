# Economy Formulas Spec — one game tick = 1 in-game hour
Engine-agnostic; every threshold reads from content/nodes/nodes_phase1.json.

## 1. Throughput per tick
For node N in topological order (jetty -> yards -> DRP -> EAF -> LF -> CC -> mills -> finished):
    available_input = min(upstream_output_tph, buffer_remaining(N))
    actual_throughput(N) = min(capacity_tph(N), available_input)
    queue(N) += upstream_output_tph - actual_throughput(N)   # backed-up material
Nodes without a capacity field (yards) act as buffers: out = min(capacity_tph, stock_t).

## 2. Bottleneck rule
N is the bottleneck when capacity_tph(N) < upstream_output_tph.
- Yards absorb the gap up to buffer_max (stockpile_kt / buffer_days).
- If queue > buffer_max, upstream is throttled to downstream capacity (hard cap) and a congestion flag is raised.
- Governing limit (SME rule): the caster caps the whole melt shop regardless of furnace power.

## 3. Opex per tick
opex_tick(N) = actual_throughput_tph * opex_per_t * energy_multiplier(N)
energy_multiplier(EAF) = 1 + hold_penalty_pct/100 + aging_penalty_pct/100
  - hold_penalty_pct from cc.hold_penalty_tiers (float-safe: hours_held compared as float)
  - aging penalty fires when dri_yard stockpile_age_days > 30
Energy cost add-on: kwh_per_t * tariff_usd_per_kwh (tariff = game constant, ~0.06).

## 4. Budget
Budget -= capex_usd_mid at placement. Budget -= sum(opex_tick) each tick.
Revenue (economy-lite): finished_yard outflow * price_per_t (placeholder 650 USD/t, SME pending).

## 5. Tier lookup (float-safe)
Resolve hold tier with float comparison (hours_held <= tier.max_hour), not int truncation,
so 1.5h lands in tier 2, not tier 1.
