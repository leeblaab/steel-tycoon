# Sim-Loop Spec v1 — confirmed 2026-10-04 (extends economy_spec.md)

## 1. Clock
- 1 tick = 1 in-game hour = **12 real seconds** (configurable 10–15).
- 1 in-game day ≈ 4.8 min real time → a 15-min session ≈ 3 in-game days.
- Fast-forward 2x/3x available when no decision is pending (waiting for ships).
- **Crisis auto-pause**: sim pauses with a player choice when (a) a heat hits tier 3 (dump / chemical injection / hold), or (b) a congestion flag raises. Decision moments must never flash past.

## 2. Tick algorithm
For each tick, in topological order over the flow graph (nodes + conveyor links):
1. **Ship event**: arrival cadence every 2–4 in-game days; unloader runs 500–1000 t/h across multiple ticks (unloading is itself a flow, not an instant deposit).
2. `available(N) = min(upstream_out, buffer_stock(N))`
   `actual(N) = min(capacity_tph(N), available(N))`
   `queue(N) += upstream_out - actual(N)`
3. Yards = buffers: outflow = min(capacity, stock). Congestion flag when queue > buffer_max → upstream hard-capped to downstream capacity.
4. **Heat object at EAF** (the only discrete object in the sim):
   - heat = {tap_hour, size_t, dri_share_pct, cu_pct, sn_pct, grade, status}
   - chemistry comes from the input blend (scrap grade mix + DRI share); DRI share drives power per calibrated rule.
   - tap event every tap-to-tap interval; tier escalation per hold_penalty_tiers (float-safe).
5. **Yield chain**: EAF yield (base + tramp penalty per grade) → CCM 96–98% → mill yield. Tramp penalties are per-grade stats, not flavor text.
6. **Revenue at dispatch outflow only** (material actually sold), at the grade price from the price ladder. Storage buffers must not hide the money problem.
7. Opex per tick per economy_spec.md (energy multiplier includes hold + aging penalties).

## 3. Milestones / event flags
- `first_heat_milestone`: heat tapped without dump AND its billet reached a rolling mill. Level 1 completion = all sequence nodes placed + this flag. Then Free Play / Optimization mode unlocks.
- Bottleneck stats tracked per node: queue_tph, congestion_ticks, opex_usd — these are the trigger inputs for upgrade visibility.

## 4. Upgrade visibility rule
An upgrade appears in the palette only when its bottleneck is firing (queue > 0 for N consecutive ticks, or opex above threshold). Otherwise it's a shopping list, not a game. Prerequisites encode process truth (e.g. QTB requires EAF + CCM upgrades because QT needs clean steel and consistent hot billet).

## 5. UI hooks (for the Palette build)
- Queue bar above each node; red pulse on congestion flag.
- Palette icons locked to the next required Level 1 step (greyed until turn).
- Crisis pause UI: choice buttons (hold / inject / dump) with consequence preview.

## 6. Level 1 sequence (content-driven, see content/sequence/level1_draft.json)
Intro card → Jetty → Scrap Yard (own step: two-input EAF, tramp/yield taught early) → Conveyor jetty→scrap → Conveyor jetty→DRI yard → DRP → Conveyor DRI→EAF → SMP (EAF, LF, CCM) → Billet Yard → Rebar Mill → Wire Rod Mill → Dispatch.
