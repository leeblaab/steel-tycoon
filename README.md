# Steel Tycoon — Steel Plant Tycoon & Digital Twin Process Simulator

**A browser-based industrial factory-building game about how a real steelworks works — from the first cargo ship at the berth to the finished rebar leaving the mill.**

Steel Tycoon is a tycoon/management sim built for fun first and learning second. You start with an empty plot of land beside the water and build a DRI-EAF long-products plant one piece at a time: jetty, yards, direct-reduction plant, electric arc furnace, ladle furnace, caster, rolling mill, dispatch. Every piece of equipment you place pops an information card with real engineering numbers — throughput bands, capex/opex ranges, bottleneck warnings — sourced from public industry references (worldsteel, GAST, vendor literature) and calibrated against 16 years of hands-on steel-mill operations experience.

> **Status:** playable browser prototype. The full-plant "play home" (Slice 1 → Level-1 quests → guided build chain) runs on React + Three.js with a deterministic tick-based simulation. Five slice simulations are complete and under regression; integration into one persistent game is the active roadmap phase.

---

## Table of contents

- [What the game is](#what-the-game-is)
- [Gameplay loop](#gameplay-loop)
- [The five slices](#the-five-slices)
- [Learning layer: info cards & content pipeline](#learning-layer-info-cards--content-pipeline)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Running the web app](#running-the-web-app)
- [Testing & verification](#testing--verification)
- [Design principles](#design-principles)
- [Roadmap](#roadmap)
- [Tech stack](#tech-stack)

---

## What the game is

- **Genre:** factory-building / plant-management tycoon, economy-lite (layout + throughput + capex/opex, visible bottlenecks). No micro-managed energy grid in v1 — energy arrives later as an upgrade axis.
- **Route (Phase 1):** one buildable route — **DRI-EAF long products** (rebar / wire rod). Alternative routes (BOF, 100%-scrap EAF) appear as unlockable knowledge cards, not buildable chains.
- **Visual language:** the top-down process-flow diagram *is* the game — a readable 3D plant you orbit, zoom, and tap. Drill-in views of mill internals come later.
- **Sessions:** designed for short, digestible play sessions; the sim is deterministic and tick-based so it can run headless, in tests, and in CI exactly as it runs on screen.
- **Units:** metric tonnes and USD throughout.

## Gameplay loop

1. **Guided start (Slice 1).** A new game walks you through the berth slice: information card → ghost footprint → *Build* → the equipment physically appears in the world (jetty, stockyard, crane). Nothing else on the site is visible or buildable yet.
2. **Park & play.** When Slice 1 is built, the guided build **parks**. You now *operate* what you built: Level-1 quests ("receive the first ship", "keep material moving", "feed the furnace", "first steel") run against live simulation state. Completing the quests commissions the next areas and releases the build chain for Slice 2 onward.
3. **Build → operate → repeat.** Each slice adds a stage of the chain (reduction, melting, casting, rolling, dispatch). Quests gate progression; bottlenecks — mismatched capacities, starved furnaces, jammed conveyors — are the real difficulty.
4. **Learn as you go.** Placing equipment pops info cards with plausible engineering ranges and design notes ("A charging bay that can't feed the furnace turns the best EAF into a waiting room."). Cards collect into a codex.

## The five slices

| Slice | Zone | What it covers |
|-------|------|----------------|
| **S1** | Berth & raw-material receiving | Jetty, ship unloading, stockyard, scrap yards, handling equipment |
| **S2** | Prep / support zone | Processing and support infrastructure (engine redesign in progress) |
| **S3** | Reduction | DRP (gas-based shaft-furnace DRI plant), DRI buffer, hot-briquetting context |
| **S4** | Meltshop & casting | EAF, ladle furnace, continuous caster, billet yard, scrap-charge logistics |
| **S5** | Rolling & dispatch | Rebar mill, cooling beds, finished-goods yard, order dispatch |

Each slice exists as an independently verified simulation plus a 3D browser scene; the current roadmap phase is consolidation into one shared, persistent world (see [Roadmap](#roadmap)).

## Learning layer: info cards & content pipeline

All game content is **data-driven** — JSON files validated against a schema (`content/schema/card.schema.json`), never hardcoded numbers in UI code.

The calibration workflow is the project's quality backbone:

1. Drafts are generated from public industry sources (worldsteel yearbook, GAST statistics, vendor reference literature) and written as **plausible ranges**, flagged `sme_pending`. No invented precision, ever.
2. A steel-industry SME (16 years in mill operations and engineering — DRP, rolling mills, ISO 9001/14001/45001, CMMS/TPM) reviews every card against real plant behavior.
3. Corrections are written back into the content JSON; cards graduate from `sme_pending` to calibrated.

Phase 1 deliberately uses **generic technology names** (no vendor trademarks); real product names are deferred to a later licensing phase.

## Architecture

The project follows a **mirror-first simulation discipline**:

- **Python mirror** — each slice's logic is first written and regression-tested as a headless Python simulation with a frozen event log. This caught several bugs that looked like engine problems but were logic problems.
- **TypeScript port + parity tests** — the slice logic is ported to TypeScript and validated against the mirror's outputs (`parity_*.test.ts`), so game logic has two independent implementations agreeing on results.
- **One authoritative sim, deterministic ticks** — slices currently run per-scene `sim.ts` reimplementations; consolidation into a single shared simulation with one tick authority is an explicit roadmap work package. The sim advances in fixed plant-minute ticks and is fully decoupled from rendering.
- **3D scene = pure function of session state.** Equipment appears only when built (`builtNode()` / `sliceBuildDone()` gates); slices 2-5 are hidden until their builds land, with per-node GLB reveal as each guided step confirms.

```
content JSON ──► sim (deterministic ticks) ──► session state ──► React/Three.js scene
      ▲                                              │
      │                                              ▼
 card schema ◄────────── info cards / quests ◄── quest tracker + onboarding sequencer
```

## Repository layout

```
content/                     # all game data (JSON, schema-validated)
  schema/                    #   card + content schemas
  nodes/                     #   buildable nodes, flow connections, conveyors, dispatch
  cards/                     #   info-card drafts (SME calibration workflow)
  sequence/                  #   guided-build step sequences (level1_draft.json)
  quests.json                #   quest definitions + completion criteria
  economy/ prices/ layout/   #   economics domain, price ladders, factory layout geometry
  maps/ operations/ scrap/ upgrades/ sustainability/ assets/ sounds/
web/                         # the web app (TypeScript, React, Three.js, Vite)
  src/shared/                #   cross-slice modules: construction, layout, inspection
                             #   cards, inventory registry, quest tracker, route ledger,
                             #   save/load, camera
  src/ports/                 #   one port per slice + the integrated fullplant home
    fullplant/browser/       #     the live play-home: main.tsx (3D scene), session.ts
                             #       (game session state), onboarding*.ts(x) (guided flow),
                             #       hud.tsx, layout.ts
    slice1..slice5/          #     per-slice browser scenes + sim.ts (+ shared TS ports)
    economics/ production_core/ sustainability/   # domain ports with parity tests
  tests/                     #   vitest regression suite (22 files / 177 tests)
docs/                        # PLAN_FORGED.md (active plan), specs, audits, frozen history
STATE.md / DECISIONS.md      # session opener + settled-decisions ledger
```

## Running the web app

Requirements: Node.js 20+ and npm. From `web/`:

```bash
npm install

# full-plant play home (the main game surface)
npx vite --config src/ports/fullplant/browser/vite.fullplant.config.ts
# → http://localhost:5178

# production build of the play home
npx vite build --config src/ports/fullplant/browser/vite.fullplant.config.ts
```

Individual slice scenes have their own entry points under `web/src/ports/sliceN/browser/` (each with an `index.html` and, where present, a dedicated Vite config).

## Testing & verification

```bash
cd web
npx vitest run --root .
```

- **22 test files / 177 tests** (`npm test`) covering construction, layout, gate checks, tick loop, inspection cards, inventory registry, save/load, onboarding sequencing, quest tracking, and per-slice parity against the Python mirrors.
- Parity discipline: slice logic is cross-checked between the TypeScript port and a headless Python mirror; material-balance error is asserted at 0.0000 in regression runs.
- E2E smoke checks use Playwright against the running dev server (guided-build flow, quest completion, GLB reveal on build).

## Design principles

- **Plausible ranges over fake precision.** Every owned number comes from an industry source and is presented as a range until SME-calibrated.
- **The simulation is the single source of truth.** UI state derives from sim/session state; placement, budgets, and unlocks all read from it.
- **Progressive disclosure.** You see and build only what the current slice has unlocked — a clean site that fills up as you play, not a wall of buttons.
- **Quests gate construction, not timers.** The next slice's build chain opens when you've *operated* the previous one successfully.
- **Determinism first.** Ticks are fixed-step and reproducible; headless runs in CI exercise the exact same logic as the browser.
- **Learning rides on top of play.** Cards and codex explain what you just built — never a tutorial wall.

## Roadmap

The authoritative plan lives in `docs/PLAN_FORGED.md` (the six-chapter refurbishment plan — it overrides all earlier roadmaps); `docs/gameplay.md` remains the live gameplay concept layer. `docs/Raodmap V3.md` / `RoadMap_V2.md` are frozen history. Headlines:

- **Now:** Stage 0 foundation — content published *(landed)*, docs reset + licensing split, commissioning fix, scene relight (lighting/palette/fog), persistence v2.
- **Next:** the six chapters of the material route (Ore Belt → Heat → Route → Cast → Mills → Shipment), one procedural hero model per chapter gate.
- **Later:** maintenance/TPM layer, energy as an upgrade axis, drill-in mill internals, mobile packaging.

## Tech stack

| Layer | Tech |
|-------|------|
| Rendering | Three.js + React Three Fiber bindings (React 19), GLB assets for equipment models |
| App shell | TypeScript, React, Vite |
| Simulation | Deterministic tick engine (TypeScript), Python mirror implementations for regression parity |
| Content | JSON with schema validation (`content/schema/`) |
| Tests | Vitest (unit + parity), Playwright (E2E smoke) |

## License

Code is licensed under the **Apache License 2.0** (see `LICENSE`). Game content under
`content/` (cards, quest text, economy figures, icons) is licensed under **CC BY-SA 4.0**
(see `CONTENT_LICENSE`). Third-party assets and their licenses are recorded in
`THIRD_PARTY.md` (Kenney CC0 kits; the kits themselves are downloaded separately — hash
manifests live in `content/_vendor/`). Equipment references use generic technology names
only; no vendor trademarks. The engineering figures are educational approximations from
public industry sources — they are ranges for gameplay and learning, not design values for
real plants.
