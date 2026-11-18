# Steel Process Digital Twin

**A deterministic, process-level simulation of a DRI–EAF long-products steelworks**

*Prepared November 2026 — SteelX project. All industrial values are plausible industry bands (worldsteel, GAST, vendor references) calibrated against 16 years of mill operations and engineering experience; they are presented as ranges, not invented precision.*

---

## 1. What the twin models

One continuous plant on one site, built and operated stage by stage along the DRI–EAF long-products route:

**Ship berth → Raw-material yards (ore / scrap) → DRP (gas-based shaft furnace) → DRI buffer → EAF → Ladle Furnace → Continuous Caster → Billet yard → Rebar / wire-rod mill → Cooling bed → Finished-goods yard → Dispatch**

The twin is **tick-driven and deterministic**: one tick = 1 in-game hour; a 15-minute session covers ~3 plant-days. The same simulation runs headless in tests exactly as it runs on screen — every number you see on the 3D scene is read out of the sim, never painted on.

The player (or trainee) acts as **plant manager**: routine process runs automatically; interventions happen at decision moments — capacity investments, queue priorities, buffer planning, quality choices, shutdown windows.

## 2. Structure: five process slices + cross-cutting domains

The plant is decomposed into five process slices, each an independently verified simulation with its own live scene, plus domain ports that cut across all of them.

| Slice | Zone | What it owns |
|---|---|---|
| **S1** | Berth & raw-material receiving | Berth and ship cadence (arrival every 2–4 days, unloader 500–1000 t/h), stockyard capacity, scrap yards, handling equipment |
| **S2** | Scrap prep & transport | Shared cranes, cycle times, queue priority, charge preparation — material handling as the real throughput limiter |
| **S3** | Reduction | DRP capacity band (500k–2.5M t/yr), ramp rate %/tick, DRI buffer (kt), gas cost $/t DRI |
| **S4** | Meltshop & casting | EAF (shell t/charge, tap-to-tap time, kWh/t, lining life in cycles), LRF (treatment time, alloy cost by grade), CCM (strand speed, break-out risk vs casting speed, `caster_wait`) |
| **S5** | Rolling & dispatch | Rebar mill (line speed, changeover ticks, roll life in t-rolled), billet yard as *casting-days of cover*, order book with deadlines and penalties |

Cross-cutting domain ports (already live):

- **Economics** — cash wallet, CAPEX on build/upgrade, OPEX per machine per tick, order revenue & penalties.
- **Sustainability** — plant-wide energy kWh/t, CO₂ t/yr feedback.
- **Operations / production core** — shared lifecycle states (`not_built → built → operational`), construction time in ticks, save/load persistence.

## 3. Links between slices: the flow graph

Slices are not islands — they are nodes and links in one directed flow graph, and the physics of the connections is where plant behavior emerges:

- **Every tick processes nodes in topological order**: jetty → yards → DRP → EAF → LF → CCM → mills → dispatch.
- **Handoff rule per node:** `available = min(upstream_output, buffer_stock)`; `actual = min(capacity, available)`; the difference accumulates as a **queue** on the link.
- **Buffers decouple rhythms.** The DRP discharges continuously; the EAF consumes in batches — the DRI buffer exists so the furnace never starves. Yards and billet yard act the same way at their boundaries (billet yard is expressed to the manager as *days of casting cover*, exactly how planners think).
- **Congestion propagates upstream.** When a queue exceeds buffer capacity, upstream is hard-capped to downstream capacity and a congestion flag raises. A jammed conveyor throttles the ship unloader three stages back.
- **The governing constraint rule (SME):** the caster caps the whole meltshop regardless of furnace power — "the caster is the metronome of the plant; everything syncs to it."
- **The heat is the only discrete object** crossing slice boundaries: {size, DRI share, Cu/Sn tramp content, grade, status}. Its chemistry comes from the input blend (scrap grade mix + DRI share); DRI share drives power draw per a calibrated rule. Tramp penalties are per-grade statistics, not flavor text — quality is carried through the graph, not asserted at the end.

## 4. The engine: calculations and invariants

**Mass balance is the contract.** For every stage: `Inputs = Products + By-products + Losses + ΔInventory`, with named loss accumulators that match how a real mill closes its balance sheet:

| Stage | Loss accumulator |
|---|---|
| DRP | dust/fines + unreduced (FeO) → yield_loss |
| EAF | physical handling loss (separate) + oxidation/melt yield loss |
| Caster / mills | scale + crop/cobble → yield_loss |
| Exit | sold (dispatch), dumped (100% loss) |

The regression suite asserts material-balance error at **0.0000 t** (tolerance 1e-6 per accumulator — float noise only). Future by-product streams (slag, dust) live as losses until the sustainability domain converts them to sellable products; the boundary list is the contract that makes that move explicit.

**Yield chain:** EAF yield (base + tramp penalty per grade) → CCM 96–98% → mill yield. Losses compound downstream exactly as in a real plant.

**Throughput & bottleneck math (per tick, per node):**

```
available_input = min(upstream_output_tph, buffer_remaining)
actual_throughput = min(capacity_tph, available_input)
queue += upstream_output − actual_throughput
Bottleneck when capacity_tph < upstream_output_tph
Hard cap + congestion flag when queue > buffer_max
```

**Opex math (per tick):**

```
opex(N) = actual_throughput × opex_per_t × energy_multiplier
energy_multiplier(EAF) = 1 + hold_penalty_pct/100 + aging_penalty_pct/100
   hold penalty: tiered by ladle hours held (float-safe tier lookup)
   aging penalty: DRI stockpile age > 30 days
energy add-on: kWh/t × tariff ($/kWh, time-of-use curve available)
```

Revenue is recognized **only at dispatch outflow**, at the grade price from the price ladder — storage buffers cannot hide a money problem.

**Determinism & verification discipline.** Every slice's logic was first written as a headless Python mirror with a frozen event log, then ported to TypeScript and cross-checked by parity tests (197 automated tests). Two independent implementations must agree on every tick. This caught several bugs that looked like engine problems but were logic problems — the same discipline a digital-twin validation program would demand.

## 5. KPIs the twin tracks

**Per node (live):** throughput t/h vs nameplate capacity, queue depth (t/h), congestion ticks, utilization, opex $/t at that node. These are also the triggers for upgrade visibility — an investment option appears only when its bottleneck is actually firing.

**Meltshop:** tap-to-tap time, ladle hold hours (tiered penalty), caster waiting vs furnace waiting, heats to spec, lining cycles remaining.

**Rolling & dispatch:** changeover count and time, roll life consumed, order on-time delivery, deadline penalties incurred.

**Plant level (end-to-end):** t of finished product per campaign day, overall yield (% of input tonnes reaching dispatch), energy kWh/t, CO₂ t/yr, cash margin (revenue − opex − capex amortization), avoidable-downtime exposure. The Level-5 challenge is scored exactly this way: *meet delivery and quality targets while minimizing energy use and avoidable downtime.*

## 6. Economics, shutdowns and maintenance layers

**Economy ramp mirrors how a mill manager actually learns the business:**
- Simple cash + upgrade costs live from Level 2 — "Expand or Optimize?" is a genuine trade-off (investment vs operating plan).
- OPEX awareness (energy multipliers, hold/aging penalties) through Levels 3–4.
- Full order economics at Level 5: order book with quantities, deadlines, prices and penalties; whole-plant bottleneck diagnosis.

**Maintenance & shutdown layer.** The asset-management data model is already embedded in every unit's fields so the maintenance system needs no schema redesign:

| Concept | Field | Twin behavior |
|---|---|---|
| EAF lining life | cycles until refurbishment | Predictable wear warning → planned shutdown window vs rare signalled breakdown |
| Mill roll life | tonnes rolled until change | Planned change vs wear-out → quality defects and downgrades |
| Changeover time | ticks between product families | The scheduling lever; mill money is in changeover planning, not just speed |
| Health decay | per machine | Planned-vs-unplanned downtime tradeoff — the core mechanic of the maintenance layer |

Design stance (deliberate): breakdowns are **predictable where possible, rare, signalled and recoverable** — no random catastrophic failure punishing the operator. Downtime becomes interesting only once it has a cost economy attached; the twin models hold penalties, aging penalties and delivery penalties first, so maintenance decisions land on top of a real cost signal. Efficiency upgrades are modeled as "maintenance you get paid for."

## 7. Learning layer: why this is more than a game

Every machine carries schema-validated information cards with **real engineering bands**, collected into a codex. The calibration workflow is the quality backbone:

1. Drafts generated from public industry sources (worldsteel yearbook, GAST statistics, vendor reference literature), written as plausible ranges, flagged `sme_pending`.
2. A steel-industry SME (16 years in mill operations and engineering — DRP, rolling mills, ISO 9001/14001/45001, CMMS/TPM) reviews every card against real plant behavior.
3. Corrections written back to content JSON; cards graduate to calibrated. No invented precision, ever.

The pedagogy is decision-based: five campaign levels teach **flow → bottlenecks → buffers → quality & synchronization → end-to-end performance**, each through quests with a situation, a measurable goal, a real trade-off, visible consequences, and a short debrief. North star: *make the player solve five increasingly complex factory problems — not manage five increasingly complicated collections of controls.*

## 8. Current status & roadmap

**Running today (live demo):** integrated full-plant play home with guided Slice-1 build and Level-1 quests; all five slice scenes live independently; economics and sustainability ports wired into the hub. Five slices' logic verified by 42 test files / 197 tests including Python↔TypeScript parity.

**Active roadmap phase (V3):** consolidation of per-slice simulations into **one authoritative simulation** with a single tick authority over the shared world; Slice-2 sim build; persistence across the full five-slice campaign.

**Next layers, in order:** maintenance/TPM interactivity (data already modeled), energy as an upgrade axis with time-of-use tariffs, drill-in mill internals, sustainability products (slag/dust from losses to revenue), mobile packaging.

---

*Demo map: one launcher starts six local sessions — the integrated plant (:5178) plus each slice scene (:5173 berth/yard, :5174 scrap & transport, :5176 DRP, :5175 meltshop/caster, :5179 rolling/dispatch). Slice scenes are today independent views of the same process model; consolidation into one shared running twin is the current work package.*
