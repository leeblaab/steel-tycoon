> **FROZEN HISTORY (18.11):** superseded by `docs/PLAN_FORGED.md`. Do not plan from this file.
SteelX — Detailed Plan (Roadmap v2)
Governing principles
Brain first, body later. Logic is engine-agnostic; presentation is swappable.
JSON = config, engine = rules. Specs, recipes, chemistry limits, prices, layout, scenarios, saves in JSON; state machines, yield math, scheduling in the simulation layer.
Mirror-first workflow is the parity mechanism. Python mirror = single source of truth for every feature; port to GDScript; headless regression. In Phase 2, the same mirror becomes the contract the TypeScript core must pass — no two independently maintained rule implementations.
Formal material balance: Inputs = Products + By-products + Losses + ΔInventory, with explicit stage boundaries (slag, dust, scale, oxidation, WIP), documented tolerances, separate mass- and elemental-balance tests where appropriate. Rounded 4-decimal display ≠ zero error.
Four acceptance gates per feature: software correctness, physical consistency, operational credibility (you as SME judge, industry-sourced ranges), playability (each feature must create a real trade-off decision).
Schema governance: schema_version per persistent format, stable IDs, explicit units, config-vs-state separation, save migration, validation that rejects instead of silently defaulting.
Phase 1 — Engine & Logic Expansion (current focus)
Build order (dependency-driven):

0. Foundations — units, balance boundaries + tolerances, stable IDs, schema_version, save-game migration policy, deterministic test contracts. No feature work before this is defined.

1. Production core — new steel grades; yield & scrap ratio grade/size-wise; scrap price tiers; tap-to-tap as a first-class variable (scrap quality × furnace condition × crew); shredder plant node; QTB/QTR/QST tech-tree upgrades; LRF alloy micro-management (alloy cost vs QC-downgrade risk).

2. Economics — sales index; order book (grade, tonnage, due date, late penalty); forward contracts vs spot; QC downgrades (Prime/Secondary/Prompt); utilities cost breakdown (water, air, electricity, NG); specific energy consumption KPI per asset (kWh/t, Nm³ NG/t).

3. Operations & logistics — MTBF/MTTR per asset + condition degradation between overhauls; scheduled plant-wise shutdowns; spare parts inventory; manpower cost; bonuses/benefits → morale mechanic (breakdown rates, tap-to-tap); dispatch crane utilization; yard capacity as physical constraint (crane → dispatch → yard → jetty congestion chain); lead times + demurrage.

4. Sustainability — by-product revenue (slag, EAF dust); carbon tax / emissions tracking; green premium / RECs; energy recovery (off-gas, waste heat boilers).

Per-feature protocol (unchanged): one micro-step at a time — data structure → logic → prints, each gated by your approval; mirror first, then port, then headless regression; no rendering work.

Level gating: carbon tax, forward contracts, shredder behind Level 2/3 unlocks — early game stays simple.

Phase 2 — R3F Web App Migration
UI layer: React + Tailwind, DOM HUD/panels/tooltips over the canvas — no text drawn inside WebGL.
3D layer: R3F, orthographic isometric camera, GLBs placed on grid coordinates from the logic layer.
Data layer: the same JSON files consumed directly.
Component-based: FactoryGrid, JettyModel, CrisisModal, etc.
No redesign: direct translation of verified state machines to TypeScript, with parity tests against the mirror.
Engine-home decision (shared core vs TS rewrite vs WASM) deferred until Phase 2 is actually on the table.
What I recorded
Memory: the two-phase structure, JSON-config-not-brain rule, mirror as parity reference, formal balance definition, dependency order, four gates, deferred portability decision. (Consolidated some stale entries to fit the budget.)
Skill (steel-plant-game): full roadmap v2 section added — phase definitions, architectural contract, the consolidated feature domain list, Phase 2 architecture, and a note that the earlier micro-phase/UI-Phase history predates v2 and the UI phase remains locked.
Plan is complete and aligned. Next actionable step when you give it: the Foundations micro-step — balance boundaries, units, tolerances, schema_version — as discussion first, then the first feature domain (production core) when you approve.