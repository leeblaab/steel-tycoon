# STEELX — ROADMAP V3 18.10.2026
## From Five Simulation Slices to a Complete, Playable Factory-Building Game

**Project:** SteelX  
**Roadmap version:** V3  
**Primary objective:** Deliver one integrated, playable browser-based industrial factory simulator covering five progressive levels, from raw-material receiving through finished-steel dispatch.

> **【MARKED 19.10 — AGREED REVIEW MARKS]** This file carries inline review marks agreed between Yasser and Hermes on 19.10.2026 after repository inspection. Marks are additive; original roadmap text is unchanged except where a mark explicitly supersedes it (marked as such). Agreed outcome: **Phase -1 (S2 browser scene) → Phase 0 audit → SME decisions gate → Phases 1–8.**

> **【MARKED 19.10 GAMEPLAY — GAMEPLAY CONCEPT LAYER WEAVED IN]** The approved gameplay concept (`docs/gameplay.md`, final merged v2, Yasser draft master structure + agent data tables/learning lines as appendices) is woven into this roadmap at the mapped sections (§4 levels, §5 quest pattern/economy, §6.6 card taxonomy, §7.5 construction verbs, §12 pacing, §13 persistence, §15 phase contracts). The layer is **concept-level**: it names player experience targets and quest contracts; it does not change settled roadmap rules — lifecycle states (`not_built → built → operational`), deterministic tick authority (§8.6/§14.1), budget-cosmetic ruling (see §5.5 GAMEPLAY mark for its scope), maintenance layer = GAME phase 2. Where a gameplay target needs new capability, it is recorded as a **work package** against the owning phase, not a rewrite of the phase. Authoritative gameplay text lives in `docs/gameplay.md`; marks here are pointers + settled decisions, never competing copies.

---

# 1. EXECUTIVE DIRECTIVE

We have reached a major milestone: all five simulation slices have been developed, their logic has passed its respective checks according to the current project status, and the web app has been built for each slice.

> **【MARKED 19.10 — CORRECTION TO THIS CLAIM (repo inspection)]** "Web app built for each slice" is not exactly true on disk today:
> - **S1:** mirror green + TS port (`slice1_berth_yard.ts`, parity tests) + browser scene accepted as demo. ✅
> - **S2:** mirror fixed 18.10 (commit a160825, reproduces win True); **no TS port and no browser scene** — `web/src/ports/slice2/browser/` contains assets only; the scene was interrupted 17.10. ❌
> - **S3–S5:** browser scenes built and verified 17.10, but each scene runs its own independent `sim.ts` reimplementation (~390–430 lines) with **no parity TS port** of the Python mirror. They are log-replay verification harnesses, not yet sim-driven apps with operational controls. ⚠️
> Consequence: "connect the five slices" = (a) build the missing S2 scene from its frozen event log (interpolation-only, slice5 pattern), and (b) consolidate four parallel `sim.ts` reimplementations into one authoritative simulation (§8.1). Both are named explicitly in §15 marks below.

The next phase is not to build five more simulations.

The next phase is to turn the existing work into **one connected, persistent, interactive game**.

The player must start with an empty or minimally equipped factory site, progressively build infrastructure, unlock new industrial capabilities, complete quests, learn how a steelworks operates, identify bottlenecks, and ultimately operate a complete steel production chain.

By the end of Roadmap V3, a player must be able to:

1. Start a new game.
2. Build and configure a factory from scratch through progressive unlocks.
3. Place, rotate, and connect equipment in a 3D environment.
4. Receive and transport raw materials.
5. Store, reserve, transfer, and consume materials correctly.
6. Operate the scrap and DRI supply systems.
7. Produce steel through EAF, LRF, and CCM.
8. Process billets through a rolling mill.
9. Store finished products, fulfill orders, and dispatch shipments.
10. Complete quests, earn rewards, unlock new levels, and access educational information cards.
11. Observe equipment, material flows, production events, bottlenecks, and failures through appropriate visual feedback.
12. Save progress, reload a game, and continue from the same factory state.
13. Complete the five-level campaign without encountering disconnected simulation states, impossible objectives, or fabricated inventory.

The final deliverable is a playable game, not merely a prototype architecture, a set of screenshots, a collection of isolated scenes, or a collection of green tests.

## 1.1 Priority hierarchy

When making implementation decisions, use this order:

1. **Working gameplay and correct simulation logic.**
2. **Integration of all five slices into one continuous factory.**
3. **Player construction, progression, and quest completion.**
4. **Clear feedback, educational pop-ups, and operational visibility.**
5. **Consistent, polished UI and meaningful 3D assets.**
6. **Animations and visual effects that improve understanding.**
7. Additional realism and optional features.

Do not sacrifice a working game to pursue perfect industrial fidelity, elaborate abstractions, or cosmetic details.

Use plausible, internally consistent demo values. Treat them as game configuration, not validated industrial benchmarks. Do not invent claims about real-world plant performance.

---

# 2. EXISTING FOUNDATION — PRESERVE AND REUSE

Before implementing anything, inspect the existing repository and identify the current working state.

The project already has five simulation slices:

- Slice 1: Port and raw-material logistics.
- Slice 2: Scrap receiving, storage, crane handling, and charge preparation.
- Slice 3: Direct reduced iron (DRI) supply and handling.
- Slice 4: EAF, LRF, continuous casting, and billet production.
- Slice 5: Rolling mills, finished-goods handling, orders, and dispatch.

The project has also used React, TypeScript, React Three Fiber, a Godot reference/runtime, Python mirror logic, and JSON-based configurations during development. Confirm the actual current repository structure and ownership of each module rather than assuming every previous implementation detail remains unchanged.

## 2.1 Non-negotiable preservation rules

- Reuse the existing simulation logic wherever it is correct.
- Do not rewrite all five slices just to make integration easier.
- Do not discard existing web app implementations without a demonstrated reason.
- Keep the simulation independent of rendering frame rate.
- Preserve deterministic tick-based simulation behavior where already implemented.
- Pausing the simulation must stop simulation ticks.
- Preserve appropriate RNG state and deterministic behavior.
- Keep configuration and content data-driven wherever practical.
- Preserve existing material accounting, reservation, deadline, and process constraints.
- Use explicit contracts at boundaries between systems.
- Keep Godot and Python reference implementations available where they serve as useful regression or parity references.
- Do not introduce a second implementation of a business rule when an existing implementation already owns it.

If the current architecture conflicts with integration, document the smallest necessary interface adjustment. Do not launch a general architecture rewrite.

## 2.2 Establish the current state

Perform one bounded inspection of the repository and produce a short inventory covering:

- Current application entry point.
- Existing web app and scene structure.
- How the five slices are currently launched.
- Current simulation state and tick mechanism.
- Inventory ownership and material-transfer mechanisms.
- Equipment placement and connection capabilities, if any.
- Current quest or objective support, if any.
- Save/load support, if any.
- Existing UI components and styling system.
- Existing 3D assets, models, textures, and licenses.
- Current tests and known blockers.
- Which features already work and which still need implementation.

Do not rerun all five simulation test suites just to rediscover their status. Use existing results and source inspection unless a concrete integration defect requires a focused test.

After this inventory, begin implementation. Do not allow the audit to become a project of its own.

> **【MARKED 19.10 — PHASE 0 IS PARTLY DONE; SCOPE IT TO THE GAPS]** As of 19.10 the following is already established by source inspection (do not re-derive it in Phase 0): slice launch = per-slice `index.html` + separate vite configs (`vite.config.ts` roots at slice1 browser, `vite.slice4/5.config.ts`); no shared entry point; each scene ticks its own `sim.ts` inside its own `useFrame` — **no shared clock exists** (§8.6 is a build-from-scratch item, not a preservation item); inventory ownership is per-scene with no cross-slice registry; save/load support: none; quest support: none; existing connection-validity rule lives in the mirror (`mirror/connection_validity_mirror.py` — a rule to port, not to invent); known blockers: S3 starvation fixture contradiction, S2 priority-verb story, billet-grade contract question (see §15 SME gate). Remaining Phase 0 work is therefore narrow: UI components/styling inventory, asset manifest with licenses, and confirming what of the four `sim.ts` files is reusable vs. must be replaced by parity ports.

---

# 3. THE CORE GAME EXPERIENCE

SteelX should combine three experiences.

### A. Factory builder

The player constructs the physical factory:

- Selects equipment from an unlocked build menu.
- Places and rotates equipment.
- Connects conveyors and material routes.
- Configures storage, capacity, and selected operational parameters.
- Validates connections before operating.
- Expands the factory as new levels unlock.

### B. Industrial simulation

The factory behaves like a coherent production system:

- Equipment processes material over simulation ticks.
- Materials move between identifiable inventories and buffers.
- Equipment has operating states.
- Capacity and timing constraints affect production.
- Shared equipment creates bottlenecks.
- Orders create production requirements.
- Failures have understandable causes.
- Material balance remains consistent.

### C. Learning and progression

The player develops industrial understanding:

- Quests introduce new systems.
- Information cards explain equipment and processes.
- Warnings explain what is wrong and why.
- Level completion demonstrates an operational capability.
- New levels unlock additional equipment and systems.
- Performance summaries explain throughput, bottlenecks, utilization, and losses.

The player should understand not just *what* to build, but *why* the factory needs it and *what happens when it is configured incorrectly*.

> **【MARKED 19.10 GAMEPLAY — §3 OPENER: CORE LOOP AND PLAYER ROLE (from gameplay.md §0)】** The three experiences above run on one loop: **Discover → Diagnose → Decide → Run and observe → Improve and unlock**. The player is the **plant manager, not the operator of every machine**: routine industrial processes are automated by default; the player intervenes for a meaningful decision, bottleneck, investment, scheduling choice, or recovery action, and may inspect any system without committing to an action. Every main quest carries: a clear situation, a measurable objective, at least one meaningful decision, visible cause and effect, and a concise learning takeaway. North star: *make the player solve five increasingly complex factory problems — not manage five increasingly complicated collections of controls.* Four verbs cover every click on the factory — **Inspect / Build / Decide-Operate / Maintain** — mapping 1:1 onto the card taxonomy in §6.6 and the card types in gameplay.md §5.1.

---

# 4. CAMPAIGN STRUCTURE: FIVE PROGRESSIVE LEVELS

## 4.1 One continuous factory

The campaign must use one persistent factory and one continuous material-production chain.

The five levels are progressive milestones, not five disconnected mini-games.

Level 1 creates the port and raw-material logistics infrastructure. Level 2 adds scrap handling to that factory. Level 3 adds the DRI route. Level 4 adds steelmaking and casting. Level 5 adds rolling, finished-goods storage, and dispatch.

When a new level unlocks:

- The existing factory remains in place.
- Previously completed quests remain completed.
- Existing equipment remains built.
- Existing inventories remain valid.
- Simulation progress remains consistent.
- The new level unlocks additional build options, objectives, and operating capabilities.
- The player does not rebuild the entire site from scratch.

The player may begin a separate new campaign if the game offers a new-game option, but progression within a campaign must be persistent.

> **【MARKED 19.10 GAMEPLAY — CAMPAIGN PACING TARGETS (from gameplay.md §1.1)】** Gameplay targets for the single continuous factory (playtest-validated targets, not simulation-calibration requirements): **4 main quests per level (20 total) + 1 optional challenge per level (5 total)**; first meaningful success within 2–3 minutes; early quest duration 2–5 min, later 4–8 min; one primary learning concept per level; usually 2–3 meaningful options per decision; simulation speed Pause / Normal / Fast; **no irreversible campaign failure state**; scoring on completion, efficiency, quality (sustainability later); replayability through optional scenarios. Each quest follows the five-part pattern **Situation → Goal → Decision → Consequence → Learning**, and quest types rotate (diagnosis, building/improvement, planning/prioritization, production, balancing, delivery under pressure) so no two consecutive quests repeat the same interaction pattern.

## 4.2 Level definitions

### Level 1 — Raw-Material Logistics

**Theme:** Establish the port-to-yard supply chain.

**Existing simulation foundation:** Slice 1.

**Unlocked equipment and systems:**

- Berth or receiving point.
- Ship unloading equipment.
- Conveyors and transfer points.
- Raw-material yard.
- Internal material-transfer equipment and routes.
- Basic inventory and throughput panels.

**Suggested quests:**

1. **Prepare the site:** Place the required receiving and storage equipment.
2. **Build the route:** Connect the berth, conveyors, transfer points, and yard.
3. **Receive the first shipment:** Unload a ship and verify that inventory increases.
4. **Transfer material:** Move material through the configured route into the intended destination.
5. **Prove the logistics chain:** Meet a configured receiving or transfer objective without violating capacity or material-balance rules.

**Quest completion must be based on actual simulation state.** Placing a conveyor alone must not complete a quest requiring material to travel through it.

**Level completion:**

The player demonstrates that a functioning raw-material logistics route exists and that material reaches its intended storage location.

**Unlock reward:**

Scrap-yard equipment and the Level 2 introduction.

> **【MARKED 19.10 GAMEPLAY — LEVEL 1 GAMEPLAY CONTRACT (gameplay.md §2.1)】** Primary learning objective: *production starts with reliable material supply* ("I have a factory, but can I get the materials moving?"). The suggested quests above map 1:1 to the gameplay quest contract **First Arrival → Keep It Moving → Feed the Furnace → First Steel** (learning outcomes: material must enter before production consumes it; handling limits production even with stock; upstream shortage starves downstream; the plant is a connected flow). Optional challenge: *No Idle Furnace* (hit the target while minimizing avoidable starvation). Simplified in Level 1: tariffs, detailed chemistry, maintenance schedules, complex finance. Completion test: the player can explain why reliable upstream supply matters downstream. Prerequisite note: slice1's parity port must be wired into the hub catalog (deferred item recorded in `web/docs/PHASE1_FINALIZATION_REPORT.md`).

### Level 2 — Scrap Yard and Charge Preparation

**Theme:** Prepare the correct scrap grades and quantities for steelmaking.

**Existing simulation foundation:** Slice 2.

**Unlocked equipment and systems:**

- Scrap receiving area.
- Truck receiving and unloading.
- Scrap stacks and storage zones.
- Shared crane.
- Crane task queue and priority controls.
- Grade-specific inventory.
- Charge buckets and charge-readiness status.

**Suggested quests:**

1. **Establish scrap storage:** Build and configure the required scrap stacks.
2. **Receive scrap grades:** Receive and stack the required grades.
3. **Operate the crane:** Perform receiving, stacking, reclaiming, and charging tasks using the shared crane.
4. **Prepare a valid charge:** Supply the required grades and usable tonnage to a charge bucket.
5. **Manage the deadline:** Complete the required charge-preparation objectives within the configured time limits.

**Required gameplay rules:**

- One shared crane must respect its actual task availability.
- Active tasks must not be interrupted unless the simulation explicitly supports interruption.
- Queue priorities must have a visible, understandable effect.

> **【MARKED 19.10 — SME DECISION REQUIRED BEFORE LEVEL 2 IS BUILDABLE]** The frozen S2 fixture (a160825) contains an **inert priority verb**: C3 slack is 9 ticks and no scenario demonstrates priority changing an outcome. As written, this rule has no demonstrable gameplay case. Decision needed before Phase 3: engineer a scenario where queue priority genuinely changes readiness timing, or soften the rule text. (Recorded in fixture for SME calibration.)
- A charge must not consume unavailable material.
- Charge-specific reservations must prevent later charges from consuming material allocated to earlier charges.
- Insufficient material must produce a meaningful refusal or failure reason.
- Deadline failures must be based on actual readiness time.
- A charge becomes ready on or before its deadline when `readiness_tick <= deadline_tick`.

**Level completion:**

The player successfully prepares the required charges using available material and the shared crane.

**Unlock reward:**

DRI receiving, handling, and buffer equipment.

> **【MARKED 19.10 GAMEPLAY — LEVEL 2 GAMEPLAY CONTRACT (gameplay.md §2.2)】** Primary learning objective: *a bottleneck can restrict the whole production chain* ("the materials are here, so why is production still waiting?"). Quest contract **Too Many Requests → Find the Bottleneck → Expand or Optimize? → Keep the Furnace Fed** (shared resources force prioritization; the visible symptom may not be the root cause; investment is not always better than optimization; flow balance spans connected areas). Optional challenge: *The One-Crane Shift*. New mechanics: shared resources, queue priority, basic capacity investment, bottleneck diagnosis. **Economy enters at Level 2** (simple cash + upgrade costs live — see §5.5 GAMEPLAY mark) so "Expand or Optimize?" is a real trade-off. Simplified: random catastrophic breakdowns, detailed maintenance simulation. Completion test: the player can identify a bottleneck and compare investment vs operational optimization. **Hard prerequisite: Level 2 gameplay stands on Slice 2 getting a sim** (parity port only today — work package recorded in §15 Phase -1/3 marks).

### Level 3 — DRI Supply

**Theme:** Create a second reliable charge-material supply stream.

**Existing simulation foundation:** Slice 3.

**Unlocked equipment and systems:**

- DRI receiving or production interface, as represented by the existing simulation.
- DRI handling equipment.
- Conveyors and transfer routes.
- DRI buffer storage.
- Supply-demand monitoring.
- Equipment availability and trip warnings.

Do not invent an additional DRI production process if the current slice only models its arrival, handling, or supply interface. Preserve the existing scope and contracts.

**Suggested quests:**

1. **Establish DRI handling:** Place the required equipment and buffer.
2. **Connect the DRI route:** Build the route to the intended downstream interface.
3. **Build buffer capacity:** Ensure the configured storage capacity supports the intended operating scenario.
4. **Maintain the supply:** Deliver the required DRI quantity without exhausting the buffer.
5. **Resolve a supply interruption:** Identify and correct a configured starvation or equipment-trip scenario.

> **【MARKED 19.10 — SME DECISION REQUIRED BEFORE LEVEL 3 IS BUILDABLE]** Quest 5 depends on the unresolved S3 starvation fixture: current fixtures contradict (identical DRP params, opposite expectations; fill run proven correct; starve needs one approved parameter change — demand must exceed 2.0 t/tick at the mirror's 20 t heat). This is a content/contract decision, not a code fix. Settle it before Phase 4.

**Level completion:**

The player demonstrates a functional DRI supply path with valid inventory and operating behavior.

**Unlock reward:**

Steelmaking and casting equipment.

> **【MARKED 19.10 GAMEPLAY — LEVEL 3 GAMEPLAY CONTRACT (gameplay.md §2.3)】** Primary learning objective: *buffers decouple processes with different production rhythms* ("how do I keep two different processes working together?"). Quest contract **A Different Iron Source → Too Much or Too Little → Plan Ahead → Balance the Rhythm** (different iron sources support the route differently; buffer levels reveal supply/demand mismatch; planning ahead protects batch operations; buffers flex between continuous and batch). Optional challenge: *No Empty Buffer*. New mechanics: buffer levels, continuous-vs-batch production, simple supply planning. Simplified: advanced gas optimization, detailed DRI chemistry (DRP ramp-rate reality stays a learning line, not micromanagement — gameplay.md §3.3). Completion test: the player can explain why a buffer exists and how it protects downstream production. OPEX awareness begins to grow here (§5.5 GAMEPLAY economy ramp).

### Level 4 — Steelmaking and Casting

**Theme:** Turn prepared charge materials into cast billets.

**Existing simulation foundation:** Slice 4.

**Unlocked equipment and systems:**

- Electric Arc Furnace (EAF).
- Ladle Furnace (LRF).
- Continuous Casting Machine (CCM).
- Ladle and tundish cycle representations already supported by the simulation.
- Billet output and storage interface.
- Basic energy and production monitoring.

**Suggested quests:**

1. **Build the melt shop:** Place the required EAF, LRF, and CCM equipment.
2. **Connect the material streams:** Connect scrap and DRI supply interfaces to the melt shop.
3. **Produce the first heat:** Make the required charge material available and complete the configured EAF operation.
4. **Refine and cast:** Progress the heat through LRF and CCM, respecting existing process constraints.
5. **Build billet inventory:** Produce and transfer the required billets into the billet yard.

**Required gameplay rules:**

- The EAF cannot consume a charge that is not ready.
- Refining and casting must follow the existing process sequence.
- Equipment and ladle-cycle constraints must be respected where already implemented.
- Casting cannot create billet inventory without a valid upstream production event.
- Billets must have an identifiable grade or compatibility property if required by the current Slice 5 contract.

> **【MARKED 19.10 — CONTRACT DECISION REQUIRED BEFORE PHASE 5]** As implemented today, **Slice 5 does not model billet grades** — the hedge in this rule currently resolves to "not required." Two options: (a) add grade/compatibility to the billet entity in Level 4 plumbing so Level 5 can route compatible billets, or (b) keep compatibility out of V3 scope and say so explicitly. Cheapest to settle before Phase 5 because it touches both contracts; decide deliberately (§14.4), not silently at integration time.
- Energy and material accounting must remain consistent with the existing model.

**Level completion:**

The player produces the required quantity of valid billets and stores them in the intended inventory.

**Unlock reward:**

Rolling mills, finished-goods storage, and order fulfillment.

> **【MARKED 19.10 GAMEPLAY — LEVEL 4 GAMEPLAY CONTRACT (gameplay.md §2.4)】** Primary learning objective: *producing liquid steel is not enough; refining and casting must work together* ("can I produce the right steel at the right time without disrupting the line?"). Quest contract **The First Heat → Meet the Specification → Keep Casting → A Stable Casting Run** (EAF is batch-based with a visible cycle; refining hits the product spec; timing mismatches create waiting; stages coordinate, not optimize in isolation). Optional challenge: *Quality First*. New mechanics: EAF batch scheduling as a simple charge-priority puzzle (approved decision), simplified product specifications (`specs.json`, B1/B2-style grades — not chemistry), LRF treatment options, casting synchronization. Serious casting events stay rare, signalled, explainable, recoverable (approved breakdown rule). Completion test: the player understands the production sequence and why quality and timing matter between furnace and caster.

### Level 5 — Rolling, Finished Goods, and Dispatch

**Theme:** Convert billets into saleable products and fulfill customer orders.

**Existing simulation foundation:** Slice 5.

**Unlocked equipment and systems:**

- Billet feeding and allocation.
- Rebar or bar mill.
- Wire rod mill.
- Finished-product storage.
- External dispatch.
- Customer orders and delivery status.
- Basic production and commercial performance panels.

**Suggested quests:**

1. **Build the rolling route:** Place and connect the billet yard to the selected mill.
2. **Allocate compatible billets:** Route suitable billets to the correct production line.
3. **Produce finished steel:** Run the rolling process and create valid finished-product inventory.
4. **Fulfill an order:** Allocate the correct product and quantity to an order.
5. **Dispatch and complete the campaign:** Dispatch the required finished product and review the end-to-end factory performance.

**Required gameplay rules:**

- A mill cannot consume unavailable billets.
- Billet compatibility must be respected where represented in the existing model.
- Finished-product inventory must come from valid production.
- Orders cannot be completed by dispatching the wrong product or quantity.
- External dispatch must reduce the appropriate finished-product inventory.
- Production, order fulfillment, and material accounting must remain consistent.

**Campaign completion:**

The player completes a valid production chain from raw-material receiving through finished-steel dispatch.

Show a campaign completion screen containing a concise factory performance summary and a clear option to continue operating the factory in free-play mode.

> **【MARKED 19.10 GAMEPLAY — LEVEL 5 GAMEPLAY CONTRACT (gameplay.md §2.5)】** Primary learning objective: *the whole plant must work together to meet customer demand* ("I have a working steel plant — can I run it well enough to fulfil orders?"). Quest contract **Turn Billets into Products → Choose Your Order → Find the Whole-Plant Bottleneck → Deliver the Steel** (rolling makes saleable product; order selection is a trade-off; the final constraint may originate far upstream; end-to-end performance beats any single machine). Optional challenge: *Best Plant Performance*. Orders are simple accept/select choices — no negotiation (approved decision); full order economics (revenue, deadlines, penalties via `orders.json`) arrive with Level 5's order book. Advanced systems now appropriate as optional depth: maintenance planning, energy-efficiency upgrades, sustainability scoring, advanced scheduling. Completion test: the player can explain how decisions across the whole chain influence delivery. Campaign completion screen carries the Bronze/Silver/Gold result tiers (see §5 GAMEPLAY failure/recovery mark).

---

# 5. QUEST SYSTEM

Implement one reusable quest system. Do not hard-code five unrelated quest interfaces.

## 5.1 Quest definition

Each quest should support data-driven fields equivalent to:

- Stable quest ID.
- Level ID.
- Title.
- Short description.
- Detailed instructions.
- Prerequisites.
- Required actions or state conditions.
- Completion criteria.
- Optional failure or deadline criteria.
- Reward.
- Related equipment IDs.
- Related learning-card IDs.
- Status.
- Progress.
- Completion message.

Use the existing JSON/configuration approach if appropriate. Match the actual project schema and avoid introducing unnecessary abstractions.

## 5.2 Quest lifecycle

Support these states:

- Locked.
- Available.
- Active.
- Completed.
- Failed, only where the objective genuinely supports failure.
- Optional objectives may be tracked separately.

Quest transitions must be driven by actual game state and events, not by UI button clicks alone.

Examples:

- `equipment_placed`
- `route_connected`
- `shipment_received`
- `inventory_threshold_reached`
- `material_transfer_completed`
- `charge_ready`
- `heat_completed`
- `billet_produced`
- `order_fulfilled`
- `shipment_dispatched`

These are illustrative event concepts, not instructions to create duplicate event systems if equivalent events already exist.

> **【MARKED 19.10 GAMEPLAY — §5.2 QUEST PATTERN ADDEND (gameplay.md §1.3)】** Beyond the lifecycle states above, each quest's content data carries the five-part pattern fields — **situation / goal / decision options / consequence presentation / learning takeaway** — so quest variety is authored, not emergent by accident. Quest types rotate across a level (diagnosis, building/improvement, planning/prioritization, production under constraints, balancing, delivery under pressure); consecutive same-type quests only with a meaningful new twist. Failure/recovery rule (gameplay.md §4.2): quest failure never restarts the campaign — it explains what went wrong and offers retry/adjustment/alternative; results may award **Bronze/Silver/Gold** tiers on completion, efficiency, quality, resource use. A poor result teaches rather than merely punishes; no irreversible campaign loss (approved decision).

> **【MARKED 19.10 — IMPLEMENTATION GUIDANCE (agreed)]** The required event vocabulary largely **already exists** in the frozen slice event logs (`charge_ready`, arrivals/departures, `heat_completed`, dispatch events in fixtures and each scene's `sim.ts`). Agreed approach: quests subscribe to existing slice event emissions; do not build a new parallel event bus.

## 5.3 Objective verification

Use objective conditions that can be evaluated deterministically.

Examples:

- Build three required equipment items.
- Connect a source to a valid destination.
- Receive at least a configured quantity of material.
- Maintain inventory above a minimum threshold.
- Complete a required number of charges.
- Produce a target billet quantity.
- Dispatch a target finished-product quantity.

Avoid vague objectives such as “improve factory efficiency” unless there is an explicit measurable criterion.

## 5.4 Quest interface

The UI must provide:

- A quest panel showing current objectives.
- Clear current progress.
- A visible indication of the active quest.
- Locked or upcoming objectives where appropriate.
- Completion feedback.
- Reward feedback.
- A way to inspect quest details.
- A clear next objective when a quest completes.

Do not interrupt the player with a large modal for every minor event. Use small notifications for routine progress and reserve larger dialogs for important milestones.

> **【MARKED 19.10 GAMEPLAY — §5.4 QUEST UI PRINCIPLES (gameplay.md §0, §4.5)】** The quest panel is the campaign's spine but not the only teacher: **the factory itself communicates** — machine status colours, queue growth/shrinkage, buffer levels rising or falling, waiting at ladle/caster/rolling interfaces, visible construction progress, output accumulation after success. Cards explain what the player is already seeing; they are never the only feedback mechanism. Not every quest needs a pop-up. During longer production cycles the game must always offer a meaningful next action (inspect, plan, upgrade) rather than idle waiting.

## 5.5 Rewards and unlocks

Rewards can include:

- Unlocking new equipment.
- Unlocking the next level.
- Construction credits or a simple budget, if an economy is implemented.
- New information cards.
- Optional performance ratings.
- Access to advanced operating controls.

Do not introduce a complex currency or economy unless it materially improves the core game. The first priority is progression and meaningful objectives.

> **【MARKED 19.10 — AGREED: ECONOMY IS A V3 NON-GOAL]** No construction costs, credits, or budget in Roadmap V3. Equipment unlocks through quest completion only. "Construction cost" fields stay out of equipment contracts so `economics_domain2.ts` does not leak into build gameplay. Revisit only if the campaign genuinely requires it.

> **【MARKED 19.10 — AGREED (supersedes the mark above): BUDGET = COSMETIC COST NUMBERS ONLY]** Agreed refinement: progression stays **gated unlocks** (quest completion → equipment available, no credits, no failure penalties), but the build menu shows **real-world cost figures as learning content** — cosmetic data fields in card/content data only ("a bucket-wheel crane costs on the order of $X"), never wired into sim contracts or `economics_domain2.ts`. This preserves tycoon flavor at near-zero implementation risk. A real economy (budget, placement mistakes costing money) stays out of V3 and would be its own milestone decision later if ever wanted.

> **【MARKED 19.10 GAMEPLAY — ECONOMY RAMP (gameplay.md §3.9/§4.6; scopes the mark above to build costs)】** The gameplay concept introduces a **simple player economy starting at Level 2**: a cash wallet plus upgrade-purchase costs, so "Expand or Optimize?" is a genuine trade-off; OPEX awareness grows through Levels 3–4; full order economics (revenue, deadlines, penalties via `orders.json`) arrive with Level 5's order book. Scope reconciliation with the two marks above: **they remain settled as written for build costs** — equipment unlocks stay quest-gated and no construction-cost field enters sim contracts in V3; the GAMEPLAY layer adds only *upgrade purchases from a cash wallet*, which is the "its own milestone decision later" the previous mark anticipated, now decided: it enters at Level 2. No failure penalties drain cash (no irreversible loss rule); `economics_domain2.ts` stays out of sim contracts — economy lives in content/config and the hub's already-live economics port (Appendix C), not new systems. Data fields (`units.json` cost bands, `upgrades.json`, `orders.json`) are Appendix A work packages feeding the content JSON milestone.

---

# 6. EDUCATIONAL INFORMATION CARDS AND POP-UPS

Learning is a core feature of SteelX, not an afterthought.

Implement a consistent, reusable information-card system that explains industrial processes without overwhelming the player.

## 6.1 Card categories

### Equipment cards

Explain:

- Equipment name.
- What it does.
- Why it is needed.
- Inputs and outputs.
- Important operating constraints.
- Common failure or bottleneck.
- Related equipment.

Example: a conveyor card explains that the conveyor transfers material between defined endpoints, its configured capacity, and why a disconnected route prevents material transfer.

### Process cards

Explain the relevant industrial process in concise, understandable language.

Examples:

- Ship unloading and stockyard logistics.
- Scrap preparation.
- DRI handling.
- EAF melting.
- LRF refining.
- Continuous casting.
- Billet rolling.
- Finished-goods dispatch.

### Quest guidance cards

Explain the objective, required steps, and how the game will evaluate success.

### Operational warning cards

Explain the problem, its cause, its effect, and the available corrective action.

Examples:

- Source inventory is insufficient.
- Destination storage is full.
- Conveyor route is disconnected.
- Shared crane queue is delaying a charge.
- DRI buffer is empty.
- Required charge is not ready.
- Casting is waiting for an upstream process.
- Compatible billets are unavailable.
- Finished inventory is insufficient for an order.

### Milestone cards

Appear when a player unlocks a level, completes a major quest, or completes the campaign.

## 6.2 Card interaction

Cards should support:

- A clear title.
- Concise explanation.
- Relevant illustration or equipment model where available.
- Optional “Learn more” detail.
- Dismiss or close.
- Optional “Go to equipment” or “Show me” action.
- Suppression of repeated introductory tips after the player has acknowledged them, where appropriate.

Avoid forcing the player through the same tutorial repeatedly.

## 6.3 Contextual information

Where practical, selecting an equipment item should open an information panel showing:

- Name and equipment type.
- Operating status.
- Current inventory or throughput.
- Capacity.
- Input/output connections.
- Active warning.
- Relevant quest.
- Related learning card.

Values must come from actual simulation state. Never display invented operational readings as if they were live values.

## 6.4 Learning content quality

Use concise explanations suitable for learners who may not have steel-industry experience.

Separate:

- Established industrial concepts.
- Simplified game rules.
- Configurable demo values.

Do not label a simplified game value as a verified industrial standard.

## 6.5 Hint triggers and escalation (added; agreed)

Diagnostic warnings alone do not reach a beginner who is simply stuck without generating any simulation failure. Agreed rules:

- **Quest-stalled detection:** an active quest with no measurable progress for a defined window (configurable tick threshold, set per quest in content data), or repeated invalid attempts against the same objective, counts as "stuck" and triggers a hint even though nothing failed in the simulation.
- **One hint per distinct cause-state:** each unique blocking cause fires at most once while that state persists; acknowledged hints do not re-explain themselves (enforces §6.2 suppression concretely).
- **Escalation ladder — diagnostic → actionable nudge → explicit help:** first tier states what is wrong and why ("Charge C2 cannot be prepared: only 18 t of the required 30 t HMS is available"). Second tier states what to do next ("you need more HMS — reclaim more scrap or queue an arrival"). Third tier: a visible hint button on any blocked machine that opens the full explanation card.
- Hints are content-driven like cards (content data with trigger keys), not hardcoded per scenario.

> **【MARKED 19.10 — AGREED]** §6.5 is adopted as written above; implement inside the Phase 1 shell's quest evaluation so every level phase inherits it rather than retrofitting it later.

## 6.6 Card appearance triggers (added; agreed)

Every card gets an explicit moment of appearance declared in its content data — no ad-hoc popups:

- `on_quest_accepted` — context and industrial information about what the player is about to do.
- `on_first_attempt_failed` — guidance explaining what went wrong on the player's first genuine attempt.
- `on_quest_completed` — what just happened industrially, closing the learning loop.

Cards stay in `content/cards/` as data-driven entries (§14.3); each quest entry names its cards and triggers; the delivery mechanism is implemented once.

> **【MARKED 19.10 — AGREED (refines §5.5)]** This trigger scheme supersedes the "before/during/after" wording in the §5.5 card bullet with the concrete keys above.

> **【MARKED 19.10 GAMEPLAY — CARD TYPE TAXONOMY + VERB MAPPING (gameplay.md §5.1, §0)】** The four triggers above pair with four **card types** declared in each card's content data: **Discovery** (introduce a machine/capability and its role in the flow), **Decision** (meaningful options with understandable trade-offs), **Diagnosis** (observed problem, likely cause, possible response), **Milestone** (achievement confirmed + short learning debrief). Mapping: `on_quest_accepted` → Discovery; `on_first_attempt_failed` → Diagnosis; `on_quest_completed` → Milestone; Decision cards ride the player-initiated controls. These pair 1:1 with the four factory verbs Inspect / Build / Decide-Operate / Maintain (§3 opener mark): every click on the factory is one verb, every verb has a card/UI primitive. Card rules (gameplay.md §5.2): concise, contextual, interrupt only when useful; inspection cards may show live values/trends/status (Phase 1's tap-to-inspect pattern already satisfies this contract); no permanent panel per machine — visual state carries much of the message. Learning one-liners each card should carry are in gameplay.md Appendix B.

---

# 7. BUILDING, PLACEMENT, AND CONNECTION GAMEPLAY

The player must have meaningful control over factory construction.

## 7.1 Build mode

Provide a consistent equipment/build menu organized by category:

- Logistics.
- Storage.
- Scrap handling.
- DRI handling.
- Steelmaking.
- Casting.
- Rolling.
- Finished goods and dispatch.

Only show equipment currently unlocked, with locked items optionally visible as future goals.

Each equipment item should have:

- Icon and name.
- Short purpose description.
- Construction cost only if a budget exists.
- Placement footprint.
- Rotation support.
- Valid-placement indication.
- Relevant build prerequisites.

## 7.2 Placement

The player should be able to:

- Select an equipment item.
- Preview it before placement.
- Place it on the factory floor.
- Rotate it.
- Cancel placement.
- Select and inspect existing equipment.
- Move or remove equipment where the current game rules permit it.

Use grid-based placement if it fits the existing scene architecture. Avoid building a sophisticated construction physics system unless necessary.

> **【MARKED 19.10 — AGREED: PHASED PLACEMENT SCOPE]** To keep Phase 2 small and prove the pattern before investing in an editor: **Phases 2–3 use guided placement only** — predefined build slots where equipment snaps to fixed positions (place the crane, place the conveyor between two fixed ports). Free-form grid placement across the whole site is deferred until after Level 2 validates the slot-based pattern. This still satisfies "meaningful construction control" for V3 without a full construction editor.

Provide clear visual feedback for:

- Valid placement.
- Invalid placement.
- Overlapping equipment.
- Missing prerequisite.
- Disallowed connection.

Do not permit a player to accidentally destroy essential progress without a clear warning.

## 7.3 Connections

Connections are central to the gameplay.

The player must be able to establish logical material routes between compatible equipment endpoints.

The system should validate:

- Source and destination compatibility.
- Whether the source and destination are connected.
- Direction of material flow where applicable.
- Capacity constraints already supported by the model.
- Required intermediate equipment.
- Whether the route can support the intended operation.

A visually connected route must correspond to a valid logical connection. A route must not be considered operational merely because two objects appear close together.

## 7.4 Conveyors and material routes

Provide a simple, usable method to connect conveyors and transfer points.

Potential implementation options include snapping to connection nodes, selecting source and destination endpoints, or drawing a route between valid ports. Choose the approach that best fits the existing application.

Do not build advanced pathfinding in this roadmap unless the existing simulation depends on it.

> **【MARKED 19.10 — IMPLEMENTATION GUIDANCE (agreed)]** A connection-validity rule already exists in the mirror (`mirror/connection_validity_mirror.py`). Port that rule to TS as the route validator; do not invent a new one (§2.1: no second implementation of an owned business rule).

The player should be able to see why a route is invalid and what must change to fix it.

## 7.5 Construction versus simulation

Keep construction actions separate from production simulation ticks.

Pausing the simulation must stop production and material movement, while allowing the player to inspect the factory and perform permitted construction actions.

Construction must not create, destroy, or transfer inventory unless an explicit game rule requires it.

> **【MARKED 19.10 GAMEPLAY — BUILD VERB AND GHOST-SLOT UNLOCK CONTRACT (gameplay.md §1.4, §0)】** Building is the **Build verb**: ghost slot → real machine, taking construction time across N ticks on the settled `not_built → built → operational` lifecycle (no rule change here). Ghost slots may preview future capabilities and state the unlock condition. Design rule for every unlock: a new machine must solve a new gameplay need or introduce a new decision — never merely add another panel to the interface; it should produce a visible factory milestone, and the player should understand *why* the capability matters (Discovery card) before being asked to manage it.

---

# 8. CONNECT THE FIVE SIMULATION SLICES

This is the most important technical component of Roadmap V3.

## 8.1 One shared simulation state

The integrated factory must use one authoritative state for:

- Simulation tick and running/paused state.
- Equipment and operating status.
- Material inventories.
- Material transfers.
- Reservations.
- Work-in-progress.
- Production outputs.
- Shared equipment tasks.
- Orders and dispatch.
- Quest conditions.
- Relevant performance metrics.

The UI may maintain separate presentation state, but it must not maintain independent copies of production inventory or process state that can diverge from the simulation.

> **【MARKED 19.10 — AGREED ENGINE DECISION (reversible)]** Today there is **no shared simulation to consolidate**: S3–S5 each run their own `sim.ts` reimplementation and S2 has none. Agreed Phase 1 approach: **keep per-slice simulation modules under one authoritative tick loop and one shared inventory registry**, rather than rewriting the five sims into a new core. Slice logic stays owned by its slice (preserving §2.1); integration happens at explicit transfer interfaces (§8.3), not inside a monolith. Where a browser `sim.ts` diverges from its Python mirror, the **mirror is the parity source** and the TS sim is corrected or replaced by a parity port (S1 pattern: `slice1_berth_yard.ts` + parity tests). Reversible decision per §19; recorded here so Phase 0 does not stall on it.

## 8.2 End-to-end material flow

The intended production chain is:

**Ships → unloading → raw-material yard → internal logistics → scrap/DRI supply → EAF → LRF → CCM → billet yard → rolling mill → finished-goods yard → dispatch → customer orders.**

This is a conceptual chain, not a requirement to force every material through every subsystem.

Scrap and DRI are parallel charge-material streams. Their inventories and routes must feed the appropriate downstream interfaces. The model must not assume that all raw materials follow the same physical path.

## 8.3 Explicit interfaces

Define and document the boundaries between slices.

At minimum, each material-transfer interface must communicate:

- Material identity or grade.
- Quantity.
- Source.
- Destination.
- Transfer timing or completion event.
- Relevant availability or reservation status.
- Failure or refusal reason.

Use the existing contracts where possible. Add only the missing fields required for integration.

## 8.4 Inventory ownership

Avoid duplicate inventory.

If two systems refer to the same physical stockpile, they must share one authoritative inventory or exchange material through explicit transfers. They must not each maintain a full independent copy of the same stock.

A downstream system may maintain its own buffer only when it represents a genuinely separate physical location.

## 8.5 Material accounting

Maintain the existing material-balance principles:

Inputs = products + by-products + losses + change in inventory, within the defined boundary.

Ensure that the accounting boundary clearly identifies what is included. Material transferred between internal subsystems must not be counted as new external input each time it changes location.

Distinguish actual material losses from rounding and display formatting. Do not hide discrepancies by rounding the underlying state or changing test expectations without a justified contract decision.

## 8.6 Shared time and scheduling

> **【MARKED 19.10 GAMEPLAY — TIME AND SIMULATION-SPEED CONTRACT (gameplay.md §4.1)】** Player-facing speed states: **Paused** (inspect, study, plan without pressure), **Normal** (intended pace with meaningful visual feedback), **Fast** (compress repetitive production while preserving important events). Fast-forward must never hide critical consequences silently — key changes stay visible via notifications, status colours, milestones, or a post-run summary. `AGREED constraint` restated: the shared tick loop stays authoritative and deterministic under all speed states (this section's rules govern; gameplay adds only the presentation layer).

All integrated systems must operate against the same simulation timeline.

- One tick advances the authoritative simulation.
- The renderer's frame rate must not determine production.
- Pausing stops simulation progression.
- Shared equipment must not execute conflicting tasks simultaneously.
- Arrival and completion events must be handled consistently.
- Deadline checks must use a clearly defined timing convention.
- Material cannot be consumed before it is available.
- Equipment outputs must be produced by valid upstream operations.

Avoid independently advancing a slice clock while the rest of the factory is paused or running.

## 8.7 Integration strategy

Integrate incrementally.

First establish the shared state and one end-to-end material transfer. Then connect the systems in campaign order.

Do not attempt to connect all five slices in one enormous patch.

> **【MARKED 19.10 — AGREED: HANDOFF CHECKPOINT AFTER EVERY LEVEL PHASE]** §8.4/§8.5 principles must be *tested at each boundary*, not first exercised in Phase 8. After each level phase (3, 4, 5, 6), run one bounded handoff check in the integrated game: material placed by the previous level's system is consumed by the new level's system through an explicit transfer, with balance closure asserted at the boundary (S1 yard → S2 crane reclaim; S2/S3 charge materials → EAF; S4 billets → mill; finished goods → dispatch). One focused run per phase, fresh process — this catches duplicate-inventory and consumed-before-available bugs early.

---

# 9. VISUAL DIRECTION: REPLACE THE BOX-ONLY FACTORY

The current 3D environment relies heavily on boxes and placeholder shapes. That is acceptable for logic development, but the playable campaign needs recognizable industrial equipment.

The goal is not photorealism. The goal is a coherent, readable industrial environment with recognizable machinery, understandable scale, and a consistent art style.

## 9.1 Asset sourcing

Investigate Kenney's official asset library first:

https://kenney.nl/assets

Use appropriate free, reusable models and environment assets where they fit the game. Check the license and attribution requirements for every asset pack actually used.

Potential asset categories:

- Industrial buildings and sheds.
- Containers and cargo.
- Trucks and transport vehicles.
- Cranes and lifting equipment.
- Conveyors and structural components.
- Storage containers and yard objects.
- Barriers, pipes, platforms, and stairs.
- General environment props.
- UI icons and interface elements.

Kenney assets may not provide every steel-industry machine required. Do not force an unsuitable generic asset into a role where it becomes misleading.

> **【MARKED 19.10 — AGREED ASSET SPLIT (asset inventory verified from staged packs)]** Agreed per-class sourcing: **Kenney Factory Kit 3.0** (staged) for connectable conveyor segments (straight/corner/T/slope variants), catwalks, tanks, chimneys, yard boxes; **Kenney City-Kit Industrial** for shipping containers, water tower, background buildings; **procedural three.js primitives** (the proven EAF/ladle recipe from earlier subagent work — cylinder shell + domed floor + tapered cone + glowing electrodes) for hero teaching machines: EAF, ladle, CCM line, bucket crane; existing custom GLBs (`SHIP.glb`, `DRP.glb`) stay. Recognizability comes from silhouette + proportion + industrial color coding, not polygon count. Kenney is scenery; hero machines are custom.

## 9.2 Custom assets

For equipment not adequately covered by available assets, create simple custom models.

Acceptable approaches:

- Procedural geometry using Three.js or React Three Fiber.
- Blender Python scripts that generate repeatable low-poly industrial models.
- Blender-authored models exported as GLB/GLTF.
- Simplified modular equipment constructed from reusable components.

Suitable initial custom models include:

- EAF shell and electrode assembly.
- LRF station.
- Continuous caster and roller tables.
- Industrial crane.
- Scrap buckets and charge buckets.
- Billet stacks.
- Rolling mill stands.
- Basic conveyor modules.
- Ship-unloading equipment.

These models need to be recognizable and useful in the game. They do not need engineering-grade geometry or internal mechanical detail.

## 9.3 Reusable asset pipeline

Establish a small, consistent asset workflow:

1. Identify the asset requirement.
2. Search the existing project and appropriate asset libraries.
3. Verify license and source.
4. Reuse an appropriate existing model where possible.
5. Create a simplified model only when needed.
6. Normalize scale, orientation, and pivot.
7. Optimize geometry and materials for browser performance.
8. Export or import in a supported format.
9. Test the model in the actual factory scene.
10. Record asset provenance and attribution where required.

Use a clear asset manifest or equivalent documentation.

Do not download large collections of unrelated models. Prefer a small curated set of useful assets.

## 9.4 Visual hierarchy

Use distinct silhouettes and materials so that players can recognize:

- Storage areas.
- Conveyors.
- Crane equipment.
- Furnaces.
- Casting lines.
- Rolling mills.
- Finished-goods stacks.

Keep the camera angle, scale, lighting, and material style consistent.

Avoid a mixture of highly realistic models, cartoon assets, and unrelated visual styles unless a deliberate art direction makes them coherent.

> **【MARKED 19.10 — AGREED VISUAL RULES (camera, ground, placeholder treatment)]** (1) **Camera:** fixed cinematic angle per level through Phase -1/1; free orbit camera arrives with Phase 2 build mode (building demands it). (2) **Ground/site treatment:** every level scene gets a ground plane with painted flat-color zones (yard area, berth line, roads) — zero-model site identity, added from Phase -1 onward. (3) **Placeholder rule:** the box is never the final look; an unbuilt guided slot shows a ghost/wireframe outline of the machine that will occupy it, doubling as the §5.5 guided-build UI. (4) **Anti-black-hole discipline:** one visual pass per level, never rework finished levels (pairs with the Phase 7 mark in §15).

## 9.5 Performance

The web app must remain responsive.

- Reuse shared geometry and materials where possible.
- Use instancing for repeated objects when appropriate.
- Avoid unnecessarily dense models.
- Optimize textures and shadows.
- Load only the assets needed for the current scene.
- Provide sensible fallbacks when an asset cannot load.
- Avoid adding a large dependency for a feature that can be implemented simply.

---

# 10. ANIMATIONS AND VISUAL FEEDBACK

Animations should communicate real simulation activity, not merely decorate the scene.

Every animation that represents industrial activity must be tied to the authoritative simulation state.

## 10.1 Core animations

### Ships and receiving

- Ship arrival or docking indication.
- Unloading equipment movement.
- Material discharge animation or particle stream.
- Visible change in the receiving area as material is transferred.

### Conveyors

- Belt movement while operating.
- Material movement along a valid route.
- Clear stopped state when the conveyor is idle, blocked, disconnected, or unavailable.

### Cranes

- Crane movement between relevant locations.
- Grab lowering and raising where supported by the visual model.
- Material pickup and release.
- Visible task-queue or active-task indication.

Do not animate a crane completing a task if the simulation has not completed that task.

### DRI handling

- Material transfer through the route.
- Buffer fill-level changes.
- Operating or unavailable state.

### EAF, LRF, and CCM

- Furnace operating-state indicators.
- Appropriate glow or controlled light effects while the EAF is operating.
- Ladle movement or transfer where supported.
- Casting strand or roller movement while casting.
- Billet emergence and transfer to storage.

Do not invent a complex metallurgical animation system. Use clear, lightweight representations that match the current process model.

### Rolling mill

- Billet entry and movement.
- Roller motion while operating.
- Finished-product output.
- Finished-goods inventory changes.

### Dispatch

- Product loading.
- Vehicle or shipment departure indication.
- Order status transition.

## 10.2 Animation rules

- Animations must reflect actual simulation state.
- They must not independently change inventory or production.
- They must not determine whether a quest completes.
- Pausing must freeze simulation-driven motion in a consistent way.
- Avoid animation systems that run expensive per-frame simulation logic.
- Provide understandable states for idle, operating, blocked, faulted, and completed tasks where relevant.
- Prefer simple state-driven animations over complex physical simulations.

## 10.3 Feedback for invisible events

Not every industrial operation can be represented visually in detail. Use complementary signals:

- Status lights.
- Progress indicators.
- Material-flow indicators.
- Inventory level changes.
- Event log entries.
- Short notifications.
- Equipment inspection cards.

The player should be able to understand what happened even if the 3D animation is simplified.

---

# 11. A UNIFIED UI DESIGN SYSTEM

The five slices must not look or behave like five separate applications.

Create one shared UI system and use it throughout the campaign.

## 11.1 Common interface layout

Establish a consistent layout with:

**Top status bar**
- Current level and campaign progress.
- Simulation tick or elapsed time.
- Running/paused state.
- Relevant factory-wide indicators.
- Save status where useful.

**Left or side panel**
- Quest objectives.
- Build menu.
- Equipment categories.
- Contextual task information.

**Main 3D viewport**
- Factory site.
- Placement and connection interactions.
- Equipment selection.
- Material routes and animation.
- Camera controls.

**Right contextual panel**
- Selected equipment.
- Inputs and outputs.
- Inventory, capacity, and operating state.
- Warnings.
- Relevant information card.
- Available actions.

**Bottom or secondary panel**
- Event log.
- Alerts.
- Production timeline or relevant metrics.
- Task queue when the selected equipment supports one.

These are recommended roles, not a mandate to overcrowd the screen. Adapt the layout to the existing application and available viewport.

## 11.2 UI consistency

Define reusable components and shared styling for:

- Buttons.
- Panels.
- Modal dialogs.
- Pop-up cards.
- Equipment cards.
- Quest rows.
- Progress indicators.
- Status badges.
- Alerts and notifications.
- Tables and metrics.
- Tooltips.
- Confirmation dialogs.
- Loading and error states.

Use a restrained industrial visual language: consistent spacing, typography, color semantics, iconography, and panel treatment.

Color must have consistent meaning throughout the game. For example, use consistent visual semantics for available, operating, blocked, warning, and failed states.

Do not rely on color alone; include text or icons where necessary.

## 11.3 Interaction consistency

- Selecting equipment opens the same style of contextual panel everywhere.
- The same keyboard and mouse conventions apply across all levels.
- The same play/pause controls operate the whole simulation.
- Quest completion feedback uses one reusable pattern.
- Information cards have consistent interaction behavior.
- Build and connection modes have clear entry and exit actions.
- Destructive actions require appropriate confirmation.
- Loading, errors, and unavailable assets have consistent fallback behavior.

## 11.4 Responsive behavior

Prioritize desktop browser gameplay, with enough flexibility for smaller windows.

The game must not break when the browser is resized. At minimum, panels should remain usable and the main viewport should remain accessible.

Do not make a separate mobile game in this roadmap.

---

# 12. GAMEPLAY DASHBOARD AND OPERATIONAL INSIGHT

The player needs to understand the factory's condition without reading source code or opening developer tools.

Provide an appropriate selection of:

- Material inventory by location and grade.
- Equipment operating status.
- Current task and queue where relevant.
- Production output.
- Material-flow status.
- Bottleneck or blocking reason.
- Order fulfillment status.
- Relevant capacity or utilization indicators.
- Material balance status for diagnostics or educational review.

Do not put every metric on the screen at all times. Show detailed information contextually and keep the main HUD readable.

## 12.1 Bottlenecks as gameplay

The game should naturally expose constraints such as:

- A full stockyard blocking unloading.
- A disconnected conveyor stopping transfer.
- A shared crane delaying charge preparation.
- Insufficient scrap grade or usable tonnage.
- DRI starvation.
- A downstream process waiting for upstream material.
- Casting constrained by the current cycle.
- A rolling mill waiting for compatible billets.
- A dispatch order waiting for sufficient finished goods.

A bottleneck must result from the simulation state, not from an arbitrary UI warning.

> **【MARKED 19.10 GAMEPLAY — BOTTLENECKS AND BREAKDOWNS AS GAMEPLAY (gameplay.md §3 zone contracts, §8 approved decisions)】** Every zone carries a gameplay pressure contract in `docs/gameplay.md` §3 (full table there): each of the eight zones — yard/berths, transport/shared handling, DRP+buffer, EAF, LRF, CCM, billet yard, rolling mill — defines its Inspect view, player action, failure/pressure state, learning outcome, and an explicit "Avoid" row against micromanagement (no per-conveyor panels, no chemistry mini-game, no gas/ramp-rate controls in the core campaign). Approved breakdown rule: failures are **predictable where possible, rare, signalled, and recoverable** — never blind punishment of player error; planned-vs-unplanned wear tradeoffs (lining life, roll life) stay as data fields now for the GAME-phase-2 maintenance layer. The billet yard is a basic buffer when needed with capacity choices introduced progressively (approved decision). Optional mastery challenges target fewer breakdowns, lower energy per tonne, higher first-pass quality, faster delivery — replayability from changed constraints, not repeated targets.

## 12.2 Helpful diagnostic messages

Messages should identify the issue and provide an actionable explanation.

Poor message: “Operation failed.”

Better message: “Charge C2 cannot be prepared: only 18 t of the required 30 t HMS is available.”

Poor message: “Conveyor error.”

Better message: “Material cannot reach the scrap yard because the route from the receiving point is disconnected.”

These are examples; actual displayed quantities and causes must be derived from the current state.

---

# 13. SAVE, LOAD, AND CAMPAIGN PERSISTENCE

The campaign must retain the player's progress.

## 13.1 Minimum requirements

Support:

- New game.
- Save current game.
- Load saved game.
- Continue campaign.
- Reset or start a new campaign with a clear confirmation.
- Export and import save data if supported by the existing architecture.

Preserve:

- Current level and completed quests.
- Equipment placement and configuration.
- Connection topology.
- Material inventory.
- Current simulation tick and relevant running state.
- Work in progress.
- Active tasks and queues.
- Orders and dispatch status.
- Unlocks and campaign rewards.
- RNG state where needed for deterministic continuation.

Use versioned save data and provide a sensible failure message if a save is invalid or incompatible.

Avoid introducing a server backend unless required by the existing product design. Browser-based local persistence and export/import may be sufficient for the initial playable release.

> **【MARKED 19.10 GAMEPLAY — PERSISTENCE IS THE "ONE PLANT EVOLVING" FEEL (gameplay.md §1.1/§1.4)】** Gameplay requirement riding on the save/load mark below: the saved campaign must make progression *felt* — ghost slots and unlock state, factory milestones already reached, quest pattern progress (including Bronze/Silver/Gold result tiers), and economy state from Level 2 onward all persist alongside the simulation snapshot listed above. "The campaign should feel like one plant evolving, not five unrelated tutorials" is an acceptance-level gameplay expectation for §16.A items (persistence across levels).

> **【MARKED 19.10 — AGREED: SAVE/LOAD MOVES TO PHASE 1 (supersedes Phase 2 placement)]** No save/load exists today, and saves must capture RNG state for deterministic continuation — retrofitting persistence after levels are wired is where bugs hide. The versioned snapshot of tick + running state + inventory + unlocks moves **from Phase 2 into the Phase 1 shell**, starting minimal (new game / save / load / continue). Quest completion, equipment placement and full connection topology persist incrementally as each phase adds them. The Phase 2 bullet "Save/load of the current campaign state" is superseded by this mark.

---

# 14. TECHNICAL ARCHITECTURE

Keep the architecture understandable and appropriately small.

## 14.1 Simulation engine

The simulation should own:

- Tick progression.
- Material accounting.
- Process rules.
- Equipment state.
- Task scheduling.
- Material transfers.
- Production outputs.
- Order fulfillment.
- Quest-relevant events and state transitions.

The renderer should present this state, not become a second simulation engine.

## 14.2 Rendering layer

React Three Fiber should render:

- Factory geometry.
- Equipment models.
- Material routes.
- State-driven animations.
- Placement previews.
- Selection and interaction indicators.

React UI components should handle:

- Menus.
- Quests.
- Pop-ups.
- Information panels.
- Configuration controls.
- Save/load interface.
- Metrics and event logs.

Keep simulation rules out of visual component code wherever practical.

## 14.3 Configuration

Use versioned configuration for appropriate game content:

- Equipment definitions.
- Equipment footprints and connection ports.
- Equipment categories and unlock requirements.
- Quest definitions.
- Level prerequisites.
- Demo production and material values.
- Learning-card content.
- Asset references.
- Relevant animation and visual metadata.

Avoid turning every small property into a configurable subsystem. Use data-driven definitions where they provide reuse across levels.

> **【MARKED 19.10 GAMEPLAY — CONTENT-JSON WORK PACKAGE (gameplay.md Appendices A/B; feeds §14.3)]** The gameplay layer's content needs one authored batch, slotted into the roadmap cadence (not a new architecture): master tables `units.json` / `quests.json` (20 main + 5 optional with five-part pattern fields) / `orders.json` / `specs.json` / `upgrades.json` / `tariffs.json`, per-unit game-plausible bands, and the Appendix B learning one-liners each card carries. All values stay **game-design placeholders unless separately approved** — no calibration loops (§17.2); asset-management fields (lining life, roll life, changeover time) exist as data only, respecting the GAME-phase-2 maintenance boundary. The eight settled gameplay decisions (gameplay.md §8: plant-manager role, visible-not-micromanaged transport, simple charge-priority EAF scheduling, accept/select-only orders, simple-first billet yard, rare-signalled-recoverable breakdowns, feedback-first sustainability, no irreversible campaign loss) are recorded as approved default directions here so content authoring never reopens them in chat.

## 14.4 Contracts

Document the minimum contracts needed for:

- Equipment.
- Material inventory.
- Material transfer.
- Process operation.
- Orders.
- Quest evaluation.
- Save data.
- Asset references.

Prefer existing types and schemas over parallel abstractions.

If a contract must change, make the change deliberately and update its actual consumers. Do not silently adapt one slice in a way that breaks another.

> **【MARKED 19.10 — AGREED: EQUIPMENT LIFECYCLE RULE (small change, recorded now; implemented in Phase 2)]** The "start from scratch" campaign requires an explicit lifecycle in the equipment contract: `not_built → built (from this tick) → operational`. Simulation code must tolerate a machine appearing mid-run (a built-now machine is operational from its build tick), and any pre-placed equipment in current scenes becomes declared "pre-built starter state" rather than hardcoded scenery. Recorded now so Phases -1/0/1 do not bake in "machines exist at scene load" assumptions that Phase 2 would have to tear out.

---

# 15. IMPLEMENTATION PHASES

Execute the roadmap as small, playable milestones. Do not implement the entire campaign in one enormous change.

> **【MARKED 19.10 — AGREED PHASE ORDER (supersedes nothing else in this section)]** Agreed execution order: **Phase -1 → Phase 0 → SME decisions gate → Phase 1 → … → Phase 8.** The S2 browser scene ships *before* the audit so the audit boundaries stay clean, and four content/contract decisions are settled before the level phases that depend on them.

## Phase -1 — Ship the S2 browser scene (added; agreed)

Build the missing Slice 2 browser scene from the **frozen event log** of the verified honest run (fixture a160825: win True; C1 ready@101, C2@201, C3@291 @ deadlines 240/270/300). Interpolation-only rendering per the slice5 pattern — no new simulation logic, no fixture changes. Assets already staged in `web/src/ports/slice2/browser/assets/` (crane_magnet, bucket, conveyor, box_large).

> **【MARKED 19.10 — AGREED: PHASE -1 USES THE FINAL VISUAL MIX FROM DAY ONE]** The S2 scene is built with the agreed §9.1/§9.4 visual rules immediately — Kenney Factory Kit conveyors where they fit, procedural primitives / staged GLBs for crane and bucket, ground plane with painted zones — instead of shipping boxes first and reworking in Phase 2. Costs roughly a day extra, avoids building the scene twice, and gives an early read on the final art style.

**Milestone:** S2 renders its verified run in the browser like S1/S3/S4/S5, closing the last gap in "all five slices have a scene."

> **【MARKED 20.10 — PHASE -1 COMPLETE: S2 BROWSER SCENE LANDED + PROBE-VERIFIED]** The scene (`web/src/ports/slice2/browser/main.tsx`, 448 lines, interpolation-only per the agreed rule) plays the frozen verified run in a real browser build: Playwright probe `web/scripts/probe_slice2_scene.mjs` **PASS** — tick 0→300 with zero console errors and zero failed requests, HUD reaches `charges ready: 3 / 3` (C1/C2/C3 all `ready` at 101/201/291), canvas live 891×720. Visual mix from day one per the agreed mark: staged Kenney Factory Kit GLBs (crane_magnet, bucket, hopper, conveyor, box_large) + procedural zones ground plane; evidence screenshot `web/docs/screenshots/slice2_scene_tick300.png` shows stacks/buckets/hopper/charge rows rendered. **Asset pitfall found & fixed:** plain Vite copies only *imported* assets — runtime `/assets/*.glb` fetches 404'd, and Kenney GLBs reference a shared `Textures/colormap.png` (GLTFLoader logged "Couldn't load texture"). Fix: `publicDir` on the scoped config (`vite.slice2.config.ts`) staging the 5 GLBs + colormap.png under `src/ports/slice2/browser/public/assets/`; rebuild carries them automatically. Screenshot pitfall: headless WebGL canvas `toDataURL` returns black without `preserveDrawingBuffer: true` — patched via Playwright `addInitScript` in `web/scripts/screenshot_slice2.mjs`. All five slices now have a scene.

## Phase 0 — Bounded repository assessment

Identify what is already implemented, what is reusable, and what is missing.

Deliverable: a concise implementation map and a short ordered backlog.

Stop inspecting once the critical decisions are clear.

## SME decisions gate (added; agreed — chat, before Phase 1)

Four content/contract decisions must be settled in chat with Yasser before the phases that depend on them begin:

1. **S2 priority story** (blocks Phase 3 gameplay design): engineer a scenario where crane queue priority genuinely changes an outcome, or soften the §4.2 Level-2 rule text. Current fixture's priority verb is inert (C3 slack 9).
2. **S3 starvation fixture** (blocks Phase 4 quest 5): approve the one parameter change so demand exceeds supply at the mirror's heat size, resolving the fill/starve contradiction.
3. **Billet grade contract** (blocks Phase 5/6 plumbing): add grade/compatibility to the billet entity in V3, or declare compatibility out of scope explicitly.
4. **Save snapshot scope confirmation** (Phase 1 shell): agreed minimum = versioned snapshot of tick + running state + inventory + unlocks + RNG state; placement/connections added as phases produce them.

Deliverable: four one-paragraph decisions recorded in this file or docs/. No code during the gate.

**【MARKED 19.10 — GATE CLOSED 2026-10-18: all four approved by Yasser (evidence brief: docs/SME_gate_brief.md)】**

1. **S2 priority story → collision fixture.** Engineer a crane priority-collision scenario as a content-only change (no sim rule change): backlog receiving + reclaim + charge tasks competing for the single crane right before a deadline, so queue priority flips which charge makes its deadline. Design target: slack ≤ grab-duration gap (~5-15 ticks at the decision tick — the frozen run's C3 geometry already runs at slack 9). §4.2 rule text stands unchanged. New fixture derived from mirror runs with stated provenance, frozen once accepted.
2. **S3 starvation parameters → confirmed as resolved on disk.** The approved change (heat_plan cadence 10, trips 20/45/70) stands: starve fixture win=false with H30/H50/H80 `buffer_starved`, fill negative win=true; both mirror-derived. This is the baseline for Phase 4 quest 5. All four scenario parameters stay `game-balance` provenance and remain retunable without touching rules.
3. **Billet grade compatibility → explicitly OUT of V3 scope.** Billets stay tonnage-only end-to-end; orders constrain product grade only at the finished-goods end. Recorded as an intentional, named simplification with a post-V3 extension point at the billet entity (grade routing). If modeled later it must land before yard/mill integration, not mid-integration.
4. **Save snapshot v1 schema approved exactly as:** `{ save_version, level_id, tick, running, rng_state, inventories[], unlocks[], quest_progress? }` — browser local persistence (localStorage + export/import JSON); invalid/incompatible saves fail with a clear message rather than silent reset; placement/connections added when Phase 2 produces them.

> **【MARKED 19.10 — PHASE 1 PROGRESS UPDATE (in progress; uncommitted working tree)]** Since `c5b4c8b`: **save/load v1 LANDED** (`web/src/shared/save_load.ts` + `web/tests/save_load.test.ts` green; schema doc `docs/save_load_v1_schema.md`; versioned snapshot, single slot `main`, hub New-game/Save/Load buttons + continue-on-startup resume with ledger validation) — closes remaining item (b). **Inventory-registry leak-test rework LANDED** (`tests/inventory_registry.test.ts` green against reworked negative control) — closes remaining item (a). Hub loop gained `resume()`; hub startup resumes a saved slice/state on load (verified headless: save@30 → reload → resume → step clean, vitest + Playwright probe). **OPEN BLOCKER (CLOSED 19.10):** browser hub app crashed on Slice 4 switch — `TypeError: n.charges is not iterable` inside the slice4 adapter's `project()` during render. Root cause: React-render-path desync, not stale build and not the sim sequence — a committed render ran with `sliceId='slice4'` (new `entry`) while the `useState`-held loop still held slice3 state; the render-phase synchronous rebuild (`setLoop`) cannot replace that same pass's hook state before `registry.project(...)` reads it (React 19.3.0). Fix: per-entry loops — `Map<sliceId, HubTickLoop>` built from the catalog in a ref; `st`, adapter key and balance check all resolve from the SAME entry object in every render pass, so no foreign-shaped state can reach an adapter regardless of render ordering (setState-in-render removed entirely). Verified: one rebuild + smoke green end-to-end (`scripts/smoke_resume.mjs`: save@30 → reload "continued from tick 30" HUD 30 → Slice 4 click → new game, tick 0; no console errors). Smoke-run pitfall for later sessions: the static server must serve `web/src/hub/dist/hub` exactly — serving `dist/` yields a directory listing and the smoke sees zero buttons (looks like a crash, isn't). Remaining Phase 1 items unchanged for: (c) parity_slice1.test.ts fixture-path debt; (d) common factory scene + equipment selection/inspection pattern (design gate with Yasser).

> **【MARKED 19.10 — ITEM (c) CLOSED; FIXTURE RE-ACCEPTED AGAINST MEASURED RUN]** The 5 pre-existing parity failures were **fixture prose, not a fixture-path problem**: the full-trace sweep proved only cap-80/conveyor-100 reproduces all 5 key ticks exactly (the cap-40/conveyor-41.6667 construction in the old note never worked). Fixture re-accepted from measured canonical run: `berth_refusals → []` (every arrival lands on an empty berth — S1 departs 47/71/95/119), congestion first fire tick 98, S5 accepted 41.6667 / remaining 958.3333 (berth stage precedes dispatch in both engines; arrival tick unloads its first slice). Mirror `verify_slice1_fixture.py` reworked to capture events inside the single walk (no cadence reconstruction) + unload-attempt per-ship accounting: **16 PASS / 0 FAIL**. TS parity port corrected to measured values (S5 live-state check; "yard at cap" assertion restated as congestion+upstream-blocked with yard working level 4920 t from the key-tick snapshot): **6/6 green**; full web suite 32 files / 125 tests green. Committed `1e5a57f`. Remaining Phase 1 item: (d) common factory scene + equipment selection/inspection pattern (design gate with Yasser).

> **【MARKED 19.10 — FACTORY SCENE DESIGN GATE CLOSED — ITEM (d); PHASE 1 DESIGN COMPLETE]** Item (d)'s design gate settled in chat with Yasser; all four decisions approved as written in `docs/factory_scene_design_v1.md` (binding rules there; that file is the source of truth for the build session):
> 1. **General layout + focus mode:** one continuous plant scene, all slices visible — material visibly flows yard → DRP → EAF → LRF → CCM → mill (painted zones + ghost unbuilt slots per §895 visual rules). **Focus = only the focused slice's sim ticks; neighbor slices are static dioramas** (painted zones, idle machines, ghost slots, optional frozen last-known telemetry). Five loops in lockstep is cross-slice transfer design (§8.3) — a later phase, not the shell.
> 2. **Cards:** observe-only "what is this machine doing now" cards first — pure view over sim state (slice4 already emits `ladle_wait` / `caster_wait` / `busy_charge_id`; zero new mechanics). Maintenance/asset management deferred to **GAME phase 2** (needs a downtime-cost economy first).
> 3. **Platform:** webapp now; mobile is GAME-phase-2 packaging. Binding interaction guard: touch-simple even on web — tap machine → card, no hover-dependent UI, no tiny targets; hub DOM-overlay pattern carries into the 3D scene.
> 4. **Ghost slots:** carry preview cards — capacity, rough cost band from content JSON, one learning line (e.g. "a DRP discharges continuously; this slot holds its output so the EAF never starves"). Content JSON + existing InfoCard component only; gives §6.6 card triggers something to fire on.
>
> Scope boundary recorded: maintenance/asset mgmt and mobile packaging are GAME phase 2 items, **not** roadmap V3 items. With (a)–(d) all closed, Phase 1's remaining work is purely the build of item (d): common factory scene + equipment selection/inspection pattern per `docs/factory_scene_design_v1.md`.

> **【MARKED 19.10 — ITEM (d) BUILT & VERIFIED; PHASE 1 COMPLETE]** Item (d) shipped per the four gate decisions: common plant layout `content/layout/factory_layout_v1.json` + typed loader `web/src/shared/factory_layout.ts` (6 painted zones yard→DRP→EAF→LRF→CCM→mill, flow arrows, ghost unbuilt slots); R3F factory scene `web/src/scene/factory_scene.tsx` wired into the hub (`factory_view.tsx` in `main.tsx`) with per-slice FOCUS mode (only the focused slice's sim ticks; neighbors static dioramas — matches the hub one-loop-at-a-time rule); tap-to-inspect cards `web/src/shared/inspection_cards.ts` (focused slice = live "what it is doing now" telemetry card, neighbor units = explicit "belongs to another slice" card, ghost slots = capacity/cost preview card). Camera pitfall fixed same day: fit must solve the **horizontal** binding constraint measured from the real canvas box (ResizeObserver), and a `CameraAim` component inside `<Canvas>` aims at the footprint center — before this, distant machines projected outside the canvas and their taps never reached R3F. Verified end-to-end on the shipped bundle: Playwright tap probes in focus slice4 AND focus slice5 hit **9/9 slots each** (live EAF/LRF/Caster & Rebar Mill telemetry cards, neighbor cards, ghost previews; 0 page errors); vitest core suite **123/123 green** (14 files incl. new `factory_layout` + `inspection_cards` tests); `scripts/smoke_resume.mjs` **PASS**. Full evidence + deferred list in `web/docs/PHASE1_FINALIZATION_REPORT.md`. Deferred to review/Phase 2: slice1 berth live-detail mapping; camera orbit/zoom & label polish (Phase2_UI_Plan); maintenance-action cards (GAME phase 2); keep-vs-strip DebugBridge probe scaffolding decision.

## Phase 1 — Shared gameplay shell

Implement or consolidate:

- One application entry point.
- One common factory scene.
- One simulation clock and running/paused state.
- Common UI shell.
- Shared equipment selection and inspection pattern.
- Basic campaign and level state.
- A simple persistent factory state.

> **【MARKED 19.10 — PHASE 1 SCOPE CLARIFICATION (agreed)]** The engine decision is already made (§8.1 mark): one authoritative tick loop + shared inventory registry wrapping per-slice sim modules; no monolith rewrite. Phase 1 must **name the consolidation plan for the four `sim.ts` reimplementations**: each slice either keeps its TS sim only if it passes a fresh parity check against its Python mirror, or is replaced by a parity port (S1 pattern). Save/load lives here (minimal versioned snapshot per §13 mark), not in Phase 2.

> **【MARKED 18.10 — PHASE 1 PROGRESS (in progress)]** Landed and committed (`4d37240`): shared hub entry point (`web/src/hub/`: catalog, scenario seed, `tickloop.ts` — one authoritative tick loop), shared UI layer (`web/src/ui/`: HUD, cards, controls, runloop, format), shared inventory registry + port adapters (`web/src/shared/inventory_registry.ts`, `port_adapters.ts`; ledger semantics: closure ledgers residual≈0 every tick, residence ledger cross-checks the port's `balance_error` at every tick). Parity ports done per §8.1 consolidation plan: S4 (`535730f`), S5 + S3 (`472a5dc`) — S3 TS parity 15 tests green. Hub tick-loop test green. **Remaining Phase 1 items:** (a) inventory-registry negative-control leak test needs rework — slice5 recomputes `balance_error` from state every tick, so small injected leaks are re-absorbed by clamp transfers and never desync the ledger; (b) save/load v1 (minimal versioned snapshot per §13 mark) not yet built; (c) known debt: 5 pre-existing `parity_slice1.test.ts` fixture-path failures; (d) common factory scene + equipment selection/inspection pattern not yet built.

**Milestone:** launch the game into one consistent factory-building environment.

> **【MARKED 19.10 GAMEPLAY — PHASE 1 GAMEPLAY WORK PACKAGES (gameplay.md Appendix C)】** Two gameplay prerequisites attach to the shell so level phases don't rediscover them: **(1) slice1 hub-catalog wiring** — `slice1_berth_yard` parity port exists but slice1 is absent from the hub catalog (deferred item in `web/docs/PHASE1_FINALIZATION_REPORT.md`); Level 1 gameplay cannot start until it's wired. **(2) speed-state UI** — Pause/Normal/Fast presentation states (§8.6 GAMEPLAY mark) belong to the shell's runloop, not per-level retrofit. The four-verb interaction model (Inspect shipped in Phase 1; Build/Decide/Maintain primitives scaffolded even if their mechanics land in later phases) is the shell's UI contract for every level phase to inherit.

> **【MARKED 25.10 — GENERAL-LAYOUT GAMEPLAY CONTRACT (agreed, chat)]** The full-plant overview port (`web/src/ports/fullplant/browser/`, :5178) is confirmed as **the gameplay home** — this closes Phase 1 remaining item (d) "common factory scene + equipment selection/inspection pattern" (selection/card grammar below; inspection reuses §6 cards). Binding clauses:
> **(1) View hierarchy:** full plant view = normal play; slice scenes = drill-in sub-view (3D orbit/zoom, same camera grammar); a third equipment-wise dig-in (flat vector process maps) comes later, after this contract's items ship. Sim time keeps running during drill-ins — no cheat-pause.
> **(2) Progression states:** every station has exactly three states — `locked` (not yet quest-marked), `under construction` (quest active; equipment commissions one by one with build animation), `live` (ticking). By campaign end the whole plant ticks simultaneously. Zone-boundary buffers absorb output while downstream stations are not yet live (brownfield-expansion feel).
> **(3) Build verb = quest-scripted commissioning:** all positions fixed (LAYOUT table), no freeform placement, no random placement; "build" means triggering/completing scripted commissioning steps tied to quests. Costs may apply; placement never.
> **(4) Time contract:** 1 logical tick = **15 plant-minutes**; Normal ≈ 1 tick/s, Fast = 3 ticks/s (3×), Paused = frozen. Engine stays authoritative/deterministic (§8.6 governs); these are presentation constants, one knob each. Sub-tick events (tap, ladle transfer) are represented by animation within the tick, not simulated separately.
> **(5) Camera:** free orbit/pan/zoom + snap-focus anchors (tap zone label → focus that station).
> **(6) Tap→card (two tiers):** stations always tappable (large hit targets) → §6 info card; individual equipment tappable at zoom/drill-in. One selection at a time; selected station gets orange rim/outline + label lift; tap empty ground or same unit to deselect, tapping another unit moves selection directly; cards open beside the panel, never modal-covering the plant.
> **(7) HUD right panel:** score/KPIs, quests, logs as collapsible dropdown sections (accordion), replacing the current flat per-slice card list. Skeuomorphic dials only where needle position is itself the lesson; otherwise numbers + trend sparklines.
> **(8) Overview animation is sim-driven:** flow motion (beds, cranes, glow, gas) speed/direction read from tick data, never decorative loops. State color grammar reuses the fixed palette: locked = desaturated grey, under-construction marker, live, bottleneck warning (orange-red pulse at jammed transfer per §12.1), maintenance-needed.
> **(9) Land/unlock:** free to look ahead (locked stations visible but greyed); building is quest-gated. No paid land unlock for now.
> **(10) Save scope ("full save"):** versioned snapshot (§13) covering per-slice sim state, shared inventory registry, layout + commissioned-equipment state, quest progress/log, unlocked zones, speed setting. Slots: autosave + level-completion checkpoint (no manual multi-slot yet).
> **(11) Layout shape:** the plant is NOT a straight line — final geography is a **Z-shape**: slices 1→2→3 run forward along X, slice 3 folds back (Z leg), slices 4–5 run forward again on the return row. Positions stay data-driven (LAYOUT table x/z per station); re-layout is a data edit and no code may assume straight-line adjacency.


## Phase 2 — Level 1 playable

Integrate Slice 1 into the shared game.

> **【MARKED 19.10 — PRE-PHASE-2 STEPS LANDED (commit `5b06425`)]** Both agreed pre-Phase-2 steps landed before this phase starts. **(1) Slice 1 wired into the hub catalog** (Phase-1 deferred item #1): new hub port `web/src/ports/slice1/slice1_hub.ts` wraps the untouched `ops_domain3` engine into the HubTickLoop state shape (`{tick, events}` + OpsState verbatim; generator word inside as `generator_state`, so save/load v1 resume is deterministic like every other slice). The parity port `slice1_berth_yard.ts` stays untouched — the hub plays the LIVE scenario (content-config cadence, real per-tick xorshift32 draws, no interventions until quest actions land here in Phase 2). Wiring: catalog entry + `slice1Adapter` (ledger identity `arrived_t == yard_stock_t + dispatched_t` checked every tick), `inspectSlice1Slot` live berth card, factory-view slice1 focus branch, save/load RNG capture reads `prng_state` OR `generator_state`. Verified: vitest 147/147 (new `slice1_hub_port.test.ts`: fresh-state shape, per-tick ledger closure ×120, JSON round-trip continuation identity, arrival/depart edges) + `scripts/smoke_resume.mjs` PASS with 4 slice buttons. **(2) Level 1 quest content authored**: `content/quests.json` — 4 main quests (First Arrival → Keep It Moving → Feed the Furnace → First Steel) + optional *No Idle Furnace*, five-part pattern fields per §5.2 GAMEPLAY mark, Appendix A shape, quest-type rotation diagnosis→improvement→prioritization→balancing; success criteria reference live slice1 hub state fields verbatim (`ships_arrived`, `arrived_t`, `unload_blocked_t`, `berth_wait_ship_days_beyond_free`, `produced_t`, `upstream_blocked_t`, `congestion_flag`); all numbers game-plausible placeholders flagged `sme_pending`. Phase 2's "Quest tracking" bullet now has its content contract.

> **【MARKED 19.10 — PHASE 2 IN PROGRESS: STEPS 1–2 DONE + PROBE PASS (commits `c13fc39`, `abcfe02`)]** **"Quest tracking" bullet is LANDED and end-to-end verified.** (1) State-driven tracker (`web/src/shared/quest_tracker.ts` + `web/src/hub/components/quest_panel.tsx`, wired in hub `main.tsx`): per-tick slice-1 criteria evaluation against live hub state (no event bus), quest_complete events, stall hint (§5.4 GAMEPLAY "always a meaningful next action"). (2) Persistence coverage bullet done: `GameSave.quest_progress` in save/load v1 (`web/src/shared/save_load.ts`). (3) Browser probe PASS (`web/scripts/probe_quest_panel.mjs`, commit `abcfe02`): q1 completed @ tick 24, Save click → reload restores all completed quests + tick, zero console errors. Evidence flagged `sme_pending` untouched: fresh-state q2/q3/q4+optional complete at ~tick 5 vs q1 at tick 24 — thresholds need SME retune at phase end. **App-level bug flagged (unfixed):** hub browser save writes the real save under a bogus literal localStorage key `***` (`getItem('steelx-save')` empty; bundle code itself uses `SAVE_FILE_KEY='steelx-save'` correctly) — startup resume-by-name broken in-browser; root cause unverified, follow-up = fresh hub `vite build` + name-based re-probe, else instrument `LocalStorageSaveStorage`. Remaining Phase 2 bullets: guided placement lifecycle (`not_built→built→operational`), valid route connections (port `mirror/connection_validity_mirror.py` to TS), operational controls, information cards, animations. Live status doc: `web/docs/PHASE2_STEP_STATUS.md`; next-session start prompt: `docs/phase2_next_prompt.md`. Suite: 38 files / 167 tests green (`npx vitest run --root .`).

> **【MARKED 20.10 — PHASE 2 STEPS 3–4 DONE (guided placement + route validator core)]** **`***` save-key anomaly CLOSED**: source bug located/fixed in `save_load.ts`; probe reads `getItem('steelx-save')` by name, non-empty verified. **(1) Guided placement bullet LANDED end-to-end**: pure lifecycle state machine `web/src/shared/construction.ts` (`ConstructionLedger`: `not_built → built_pending → operational` per §14.4 mark — one direction, idempotent build guards with reason strings, `tick(nowTick)` on the sim clock, snapshot/restore; `DEFAULT_BUILD_DURATION_TICKS=10` flagged `sme_pending`, per-machine durations are Yasser's call) + hub wiring in `main.tsx` (per-slice ledgers seeded from `factory_layout_v1.json` ghosts/pre-built, active slice advances on the authoritative clock, Build verb logs `construction_started:<slot>`) + presentation panel `web/src/hub/placement_panel.tsx` (ghost slots, preview line, progress bar, operational countdown, Build button) + Save/Load/New-game carry `GameSave.construction`. 10 tests green. **(2) Route-connections bullet: validator core LANDED** — `web/src/shared/route_validity.ts`, faithful TS port of `mirror/connection_validity_mirror.py` (§7.4 mark, no new rule; verbatim reason strings + `explainRouteFailure()` player-facing lines per "player should see why a route is invalid"); 5 parity tests incl. the mirror's 5 negative cases. Hub connect-verb UI wiring remains open (next step). Browser probe re-PASS on the rebuilt bundle after fixing a hub call-site method-name bug (`step(...)` vs `tick(...)`) — pitfall recorded. Suite: **40 files / 182 tests green**. Remaining Phase 2 bullets: route-connections hub wiring, operational controls (Decide verb), information cards, animations.

> **【MARKED 20.10 — PHASE 2 STEP 5 DONE (route-connections wiring complete; commit pending Yasser's GO)]** **Route-connections bullet now LANDED end-to-end.** `web/src/shared/route_ledger.ts` (`RouteLedger` Connect verb: every connect delegates to `validateRouteEdge` per §7.4/§2.1 — no second rule implementation; 'already connected' guard; snapshot/restore) + hub wiring in `main.tsx` (per-slice ledgers, valid connect logs `route_connected:<from>_to_<to>`, Save 7th arg carries `GameSave.routes`, startup resume AND Load button restore routes, New game clears them) + presentation panel `web/src/hub/route_panel.tsx` (from/to selects over declared node ids, validator verdict surfaced verbatim per "player should see why a route is invalid"). Save layer validates SHAPE only; legality stays in the shared validator. Tests: `route_ledger.test.ts` 5 green + routes save round-trip test (`quest_save_coverage.test.ts`) green. Browser probe PASS (`scripts/probe_route_panel.mjs`): valid `cc→billet_yard` lands in list + event log, invalid `bar_mill→billet_yard` shows the explanation line and does NOT land, Save carries `routes` under `steelx-save`, reload restores, zero console errors; quest probe re-PASS on the same bundle (no regression). Suite: **41 files / 189 tests green**. Remaining Phase 2 bullets: operational controls (Decide verb — semantics to be defined with Yasser), information cards, animations.

> **【MARKED 20.10 — PHASE 2 STEP B DONE (operational controls / Decide verbs; commit pending Yasser's GO)]** **Operational-controls bullet now LANDED end-to-end.** Semantics Q1–Q6 agreed (`docs/stepB_semantics_v1.md`). Mirror-first: Python mirror extended first (`mirror/operations_domain3_mirror.py`, D1–D6 PASS, no-Decide baseline byte-stable vs the frozen fixture), then ported 1:1 to TS. Engine verbs `decideStop / decideStart / decideScheduleMaintenance / decideCancelMaintenance / decideOrderSpare / decideOvertime` in `web/src/ops_domain3.ts` — the engine owns validation AND human-readable `{ok, message}` feedback (idle keeps payroll and still consumes the RNG draw for byte-stability; PM = future-day outage that resets only its own wear clock; spare cap stock+pipeline ≤ 3 with 7-day lead; overtime shifts one morale band worse during the window + equal-length recovery tail back to normal, mid-recovery stacking refused, cap 7 days). `ops_config.ts`: optional validated `decide` block + defaults. Hub port `web/src/ports/slice1/slice1_decide.ts`: `decisions: DecisionRow[]` log lives inside the loop state (save/load v1 carries it verbatim); `applyDecision` delegates to the engine — the only mutators — and records rejections too; catalog slice1 entry switched to V2. Panel `web/src/hub/decide_panel.tsx`: six verbs over the six declared assets, engine message surfaced verbatim, owns no rule (route-panel pattern). Save coverage: `GameSave.decisions` + loader shape validation. Tests: `tests/parity_ops_decide.test.ts` 7 green; suite **42 files / 197 tests green**. Browser probe PASS (`scripts/probe_decide_panel.mjs`): panel renders with all six verbs, valid stop lands in log + event log, double-stop rejected ('eaf is already stopped'), overtime accepted naming the risk window, Save carries `decisions` under `steelx-save`, reload restores, zero console errors; route probe re-PASS on the same bundle. Detail: `web/docs/PHASE2_STEP_STATUS.md` §Step B. Remaining Phase 2 bullets: information cards (hub InfoCards already live per slice — polish pass done via Step B's per-action learning messages), essential sim-driven animations.

> **【MARKED 20.10 — PHASE 2 STEP C DONE + PHASE 2 FINALIZED (commit `pending` — committed this landing)]** **Information-cards and essential-animations bullets LANDED; all seven Phase 2 checklist items are now complete.** **(1) Information cards:** hub `InfoCard` per slice + tap-to-inspect `CardPopup` cards in the factory scene (`inspection_cards.ts`, live sim projections) already carried this bullet; Step C adds no new machinery — Step B's per-action `{ok, message}` engine feedback (surfaced verbatim in the decide panel) delivers the learning layer on every operational verb. **(2) Essential animation:** `HullAtBerth` in `web/src/scene/factory_scene.tsx` — hull+superstructure mesh at the berth slot appears ONLY while `st.berth_ships` is non-empty (`ship_present` fed from sim state through `factory_view.tsx`; amber when unloading blocked, same tone as cards), bobs via `useFrame` + self-`invalidate()` under the demand frameloop — presence tracks simulation state exactly, zero animation otherwise (gameplay checklist honored). Browser verification: `scripts/probe_berth_animation2.mjs` **PASS** (fresh game 0 hulls → seeded save with berthed ship → Load resumes with hull present + bobbing y 0.403→0.330 → New game hull gone; zero console errors); decide/route/quest probes re-PASS on the same bundle (`index-C4361jp8.js`); suite **42 files / 197 tests green**. Pitfall recorded: probe seed must unwrap `MemorySaveStorage.read()`'s double-JSON before seeding localStorage. **(3) Phase 2 checklist status:** Build & placement interactions ✅ (Step 3–4) · Valid route connections ✅ (Step 5) · Operational controls ✅ (Step B) · Quest tracking ✅ (Steps 1–2) · Information cards ✅ (Step C) · Essential animations ✅ (Step C) · Save/load bullet superseded by Phase 1 shell with persistence coverage ✅ (quest_progress + construction + routes + decisions). Deferred to phase review: sme_pending retunes (quest thresholds, `pm_duration_days`, build durations, morale bands). Next gate: Yasser's live test + visual comments round.

Implement:

- Build and placement interactions needed by Level 1. ✅ DONE 20.10 (Steps 3–4 — see MARKED entries above)
- Valid route connections. ✅ DONE 20.10 (Step 5 — see MARKED entry above)
- Operational controls. ✅ DONE 20.10 (Step B — see MARKED entry above; `web/docs/PHASE2_STEP_STATUS.md` §Step B)
- Quest tracking. ✅ DONE 19.10 (Steps 1–2, commits `c13fc39`/`abcfe02`)
- Information cards. ✅ DONE 20.10 (Step C — live InfoCards + per-action engine learning messages)
- Essential equipment and material animations. ✅ DONE 20.10 (Step C — HullAtBerth sim-driven berth animation)
- Save/load of the current campaign state.

> **【MARKED 19.10 — SUPERSEDED BULLET (agreed)]** "Save/load of the current campaign state" is delivered by the Phase 1 shell (§13 mark). What Phase 2 adds is persistence *coverage* for Level 1 state: placement, connections, quest progress included in the snapshot.

**Milestone:** a new player can build and operate the first raw-material logistics chain and complete Level 1.

Do not wait for the final asset library. Use suitable temporary models while replacing the most visible placeholders with curated assets.

> **【MARKED 19.10 GAMEPLAY — PHASE 2 QUEST CONTRACT (gameplay.md §2.1)】** Level 1's quest tracking implements the four-quest contract from the §4.2 Level 1 GAMEPLAY mark (**First Arrival → Keep It Moving → Feed the Furnace → First Steel** + optional *No Idle Furnace*), each authored with the five-part pattern fields (§5.2 GAMEPLAY mark) and its card set per the §6.6 taxonomy (Discovery/Diagnosis/Milestone). Gameplay acceptance for this phase: first meaningful success within 2–3 minutes, early quest duration 2–5 minutes, and the completion test — the player can explain why reliable upstream supply matters downstream. Economy is NOT active in Level 1 (enters at Level 2 per §5.5 GAMEPLAY mark).

## Phase 3 — Level 2 integration

Integrate Slice 2 into the same persistent factory.

Implement:

- Scrap yard and grade-specific storage.
- Crane task interactions.
- Reservations and charge readiness.
- Quest objectives and contextual warnings.
- Crane and material-transfer animations.

**Milestone:** the player can receive scrap, manage it, and prepare valid charges in the existing factory.

> **【MARKED 19.10 — PHASE 3 HANDOFF CHECKPOINT (agreed)]** After this milestone: material stored by the Level-1 yard is reclaimed by the S2 crane through an explicit transfer with balance closure asserted at the boundary (no duplicated stockpile inventory). Depends on SME decision 1 (priority story).

> **【MARKED 19.10 GAMEPLAY — PHASE 3 GAMEPLAY WORK PACKAGES (gameplay.md §2.2, §4.6)】** Level 2's quest contract is **Too Many Requests → Find the Bottleneck → Expand or Optimize? → Keep the Furnace Fed** (+ *The One-Crane Shift*) per the §4.2 Level 2 GAMEPLAY mark. Two work packages ride on this phase: **(1) economy goes live** — cash wallet + upgrade-purchase costs via content/config and the hub's existing economics port (§5.5 GAMEPLAY mark; no sim-contract cost fields), making "Expand or Optimize?" a real trade-off; **(2) S2 sim availability** — Level 2's shared-crane/queue gameplay requires Slice 2 running as a sim in the engine (parity-port path per §8.1), not only its frozen-log scene; the priority-quest design ("Too Many Requests") additionally depends on SME decision 1 resolving the inert-priority story so queue priority genuinely changes outcomes.

## Phase 4 — Level 3 integration

Integrate Slice 3.

Implement:

- DRI handling equipment.
- DRI buffers and routes.
- Supply monitoring.
- Relevant operating and starvation feedback.
- DRI quests and learning cards.

**Milestone:** the player can establish and operate the DRI supply path.

> **【MARKED 19.10 — PHASE 4 HANDOFF CHECKPOINT + DEPENDENCY (agreed)]** After this milestone: scrap charge (S2) and DRI buffer (S3) both reach the downstream charge-material interface as distinct streams with closure at the boundary. Depends on SME decision 2 (starvation fixture).

> **【MARKED 19.10 GAMEPLAY — PHASE 4 QUEST CONTRACT (gameplay.md §2.3)】** Level 3's quest contract is **A Different Iron Source → Too Much or Too Little → Plan Ahead → Balance the Rhythm** (+ *No Empty Buffer*) per the §4.2 Level 3 GAMEPLAY mark: buffer-level visibility (rising/falling supply-vs-demand status on the DRP/buffer inspect cards) is the phase's core feedback mechanic; OPEX awareness begins to grow here (§5.5 GAMEPLAY economy ramp). Quest 5 of the roadmap list ("Resolve a supply interruption") pairs with the starvation-fixture SME decision — the gameplay teaching moment ("buffers protect batch operations") depends on a genuinely resolvable starvation scenario existing.

## Phase 5 — Level 4 integration

Integrate Slice 4.

Implement:

- EAF, LRF, and CCM equipment placement and connections.
- Charge consumption.
- Refining and casting progression.
- Billet output and storage.
- Relevant process animations and information cards.

**Milestone:** the player can produce valid billets from the connected charge-material streams.

> **【MARKED 19.10 — PHASE 5 HANDOFF CHECKPOINT + DEPENDENCY (agreed)]** After this milestone: a charge prepared in the integrated factory (from real S2/S3 inventory) is consumed by the EAF and emerges as billets in the billet yard with full-chain closure from receiving to billet. Depends on SME decision 3 (billet grade contract).

> **【MARKED 19.10 GAMEPLAY — PHASE 5 QUEST CONTRACT (gameplay.md §2.4)】** Level 4's quest contract is **The First Heat → Meet the Specification → Keep Casting → A Stable Casting Run** (+ *Quality First*) per the §4.2 Level 4 GAMEPLAY mark: charge-priority scheduling as a simple decision puzzle, simplified treatment options against `specs.json` grades (Decision cards), and ladle/caster synchronization built on the existing `ladle_wait` / `caster_wait` events (Diagnosis cards). "Meet the Specification" consumes the SME decision 3 outcome — if option (a) is chosen, billets carry simplified B1/B2-style grades; either way no chemistry mini-game (§12.1 GAMEPLAY zone rules).

## Phase 6 — Level 5 integration

Integrate Slice 5.

Implement:

- Billet allocation.
- Rolling mill selection and routing.
- Finished-product inventory.
- Order tracking.
- External dispatch.
- Campaign completion and performance summary.

**Milestone:** the player can complete a production order through finished-steel dispatch.

> **【MARKED 19.10 — PHASE 6 HANDOFF CHECKPOINT (agreed)]** After this milestone: billets produced in Phase 5 flow through the mill into finished-goods inventory and out through dispatch, reducing the correct inventory — one end-to-end closure assertion ships→dispatch at the game level, which doubles as an early read on the Phase 8 acceptance.

> **【MARKED 19.10 GAMEPLAY — PHASE 6 QUEST CONTRACT + ORDER BOOK (gameplay.md §2.5)】** Level 5's quest contract is **Turn Billets into Products → Choose Your Order → Find the Whole-Plant Bottleneck → Deliver the Steel** (+ *Best Plant Performance*) per the §4.2 Level 5 GAMEPLAY mark. Work packages: **order book content** (`orders.json` — product, qty, deadline, price, penalty; accept/select only, no negotiation) and full revenue/penalty economics on the hub economics port; whole-plant bottleneck diagnosis ("Find the Whole-Plant Bottleneck" is the campaign's capstone diagnostic quest — its cause may sit in any upstream zone, exercising §12.1 bottleneck rules end-to-end). Campaign completion screen carries the performance summary plus Bronze/Silver/Gold tiers (§5.2 GAMEPLAY mark).

## Phase 7 — Visual and UX completion

Replace the most prominent remaining box placeholders with appropriate Kenney assets or simple custom models.

Complete:

- Consistent equipment materials and scale.
- Key animations.
- UI styling.
- Quest feedback.
- Learning cards.
- Warning states.
- Camera and selection behavior.
- Loading and error handling.
- Asset attribution.

Do this incrementally throughout the earlier phases where it helps the player understand the gameplay. Phase 7 is for consistency and remaining gaps, not for postponing all visual work until the end.

> **【MARKED 19.10 — AGREED: PHASE 7 FORMALIZED (prevents the polish loop)]** Each level phase (2–6) ends with **exactly one asset-swap step**: replace that level's single most visible placeholder with a curated Kenney or simple custom model (assets_incoming/Kenny packs already staged, uncommitted by size policy). Phase 7 is then reduced to: attribution record, scale/material consistency sweep, and remaining minor gaps — not a fresh visual workstream.

> **【MARKED 25.10 — VISUAL/UI PHASE PROGRESS (slice-by-slice GLB method, approved)]** Visual pass runs slice by slice with Yasser's screenshot feedback rounds; GLB workflow = compress (mesh weld → simplify ~0.1% err → quantize) then swap primitive meshes for `useGLTF` models with per-model scale knobs and Box3 ground-lift. **Slice 4 UI FULLY DONE 25.10** (HEAD `c672ec1`): EAF/LRF/CCM/billet-yard GLBs in place, yard relocated to its own plot (x=10, z=-3.5) with gantry bays + bridge crane on side structures parallel to billets, per-model scales tuned by user (EAF MODEL_SCALE×1.5, CCM ×2), charge+DRI-feed box replaced by compressed general-plant GLB (`assets/feed.glb`, 20 MB→1.66 MB, `FEED_MODEL_SCALE` knob); headless probe PASS. Pending ONE final all-slices approval at the end of the visual phase. Slice 2 visual rated "very very poor design" — redesign is next major item after slice 1 edits.

## Phase 8 — Campaign acceptance

Perform a bounded end-to-end playthrough.

Verify that the five levels form one coherent factory, progression persists, and the production chain works from receiving through dispatch.

Fix only concrete blockers found in this playthrough. Avoid a new cycle of speculative testing, broad audits, or industrial recalibration.

> **【MARKED 19.10 GAMEPLAY — PHASE 8 PLAYTEST LENS (gameplay.md §7)】** Alongside the technical acceptance list (§16), the Phase 8 playthrough observes the gameplay targets as a player checklist (design targets evaluated by playing, not simulated): first meaningful success within 2–3 minutes; each level teaches one distinct industrial problem; most quests require a decision/diagnosis/trade-off rather than waiting; bottleneck quests permit ≥2 plausible approaches; failures explainable and recoverable; no constant micromanagement of routine machines; the factory visibly develops across levels; quest sequence varies challenge type; the player can explain each level's main lesson. Findings feed a playtest note, not a new verification loop (§17.2).

---

# 16. ACCEPTANCE CRITERIA

Roadmap V3 is complete only when the following requirements are demonstrated in the playable application.

## A. Campaign

- [ ] A player can start a new campaign.
- [ ] The campaign starts at Level 1.
- [ ] Levels unlock through defined completion conditions.
- [ ] Existing factory infrastructure persists across levels.
- [ ] Completed quests and unlocked equipment persist.
- [ ] The player can complete all five levels in order.
- [ ] A campaign completion screen appears after successful dispatch.

## B. Building and interaction

- [ ] The player can place the required equipment.
- [ ] Placement and rotation work where supported by the build system.
- [ ] Valid routes can be created.
- [ ] Invalid routes produce understandable feedback.
- [ ] Equipment can be inspected.
- [ ] Operating controls affect the actual simulation.
- [ ] The UI provides a consistent experience across all five levels.

## C. Simulation integration

- [ ] One authoritative simulation state is used.
- [ ] One simulation clock governs all connected systems.
- [ ] Pausing stops simulation ticks.
- [ ] Material transfers use valid source and destination inventories.
- [ ] Inventory is not duplicated across subsystem boundaries.
- [ ] Material cannot be consumed before becoming available.
- [ ] Shared equipment constraints remain active.
- [ ] Reservation rules remain correct.
- [ ] The end-to-end material chain reaches finished-product dispatch.
- [ ] Material accounting remains consistent within the declared boundary.

## D. Quests and learning

- [ ] Each level contains approximately four or five meaningful quests.
- [ ] Quest progress comes from actual game state.
- [ ] Quest completion cannot be triggered merely by clicking a completion button.
- [ ] Rewards and unlocks work.
- [ ] Equipment and process information cards are accessible.
- [ ] Relevant warnings explain the cause and effect of problems.
- [ ] Repeated tutorials do not unnecessarily interrupt the player.

## E. Visuals and animation

- [ ] Major industrial equipment is recognizable.
- [ ] The most prominent placeholder boxes have been replaced or improved.
- [ ] Asset licenses and required attribution are recorded.
- [ ] Important material movements have visual feedback.
- [ ] Equipment animations correspond to real operating states.
- [ ] Animations do not independently alter production or inventory.
- [ ] The scene remains responsive at a practical browser frame rate.

## F. Persistence

- [ ] The player can save and load a campaign.
- [ ] Quest progress and level unlocks persist.
- [ ] Equipment placement and connections persist.
- [ ] Inventory and production state persist.
- [ ] Save data has a version and invalid saves fail gracefully.

## G. Delivery

- [ ] The application builds successfully.
- [ ] The campaign can be launched through the intended entry point.
- [ ] No known critical integration defect prevents completion.
- [ ] The five-level playthrough has been demonstrated.
- [ ] Remaining limitations are documented honestly.

---

# 17. DEVELOPMENT DISCIPLINE — MANDATORY

We have already spent too much time in repeated verification loops in earlier development work. Roadmap V3 must be execution-focused.

## 17.1 Work in bounded increments

For each milestone:

1. Identify the specific missing gameplay capability.
2. Inspect the relevant source before changing it.
3. Make one coherent implementation change.
4. Run one focused verification in a fresh process when useful.
5. Open and play the actual web app for visual and gameplay acceptance.
6. Fix concrete blockers.
7. Report the result and move to the next milestone.

## 17.2 No endless verification

- Do not run the same command repeatedly without new evidence.
- Do not rerun all historical slice tests after every UI or asset change.
- Do not keep nudging deadlines or demo values to chase a green result.
- Do not modify fixtures simply to make tests pass.
- Do not invent a test failure just to justify another refactor.
- Do not investigate harmless formatting or rounding issues indefinitely.
- Do not conduct broad audits when a focused inspection answers the question.
- Do not repeatedly generate reports from the same data.
- Do not claim success without actual execution evidence.

If a focused verification fails, identify the most likely cause. Make one bounded correction if authorized and appropriate. If the problem persists, report the concrete blocker rather than entering another loop.

## 17.3 Protect working logic

Treat existing slice logic as a working foundation.

If a new gameplay feature requires an interface change, modify the smallest appropriate contract and its affected consumers. Avoid unnecessary internal rewrites.

Do not recalibrate demo values to real industrial benchmarks unless a value is physically contradictory, breaks the simulation, or prevents meaningful gameplay.

## 17.4 Protect scope

Do not add the following unless the core campaign genuinely requires them:

- Multiplayer.
- Cloud accounts.
- A complex economy.
- Advanced pathfinding.
- Realistic physics for every machine.
- Detailed internal furnace thermodynamics.
- A sophisticated quest-authoring editor.
- A large modding framework.
- Unrelated new industrial process modules.

A clean, extensible implementation is valuable. Building general-purpose systems for hypothetical future features is not the goal.

## 17.5 No unauthorized commits

Do not commit, push, or deploy changes unless explicitly authorized.

Keep modifications reviewable and report the actual files changed.

---

# 18. FINAL DELIVERABLE

At the end of Roadmap V3, deliver:

1. A single playable SteelX web application.
2. One continuous 3D factory environment.
3. Five progressively unlocked levels.
4. Approximately four or five quests per level.
5. Reusable quest tracking and objective evaluation.
6. Contextual educational information cards.
7. Equipment placement, connections, and operational controls.
8. Integrated simulation logic across all five slices.
9. Recognizable 3D industrial assets from appropriate reusable libraries and custom models where necessary.
10. State-driven equipment and material animations.
11. A consistent UI system across the entire game.
12. Persistent save/load and campaign progression.
13. An end-to-end production path from ships and raw-material logistics to finished-steel dispatch.
14. A concise record of the final acceptance playthrough and known limitations.

The player should be able to start with the first logistics quest, build the factory progressively, learn how the systems work, produce steel, fulfill an order, and complete the campaign.

That is the definition of done.

---

# 19. FIRST ACTION — START IMPLEMENTATION

> **【MARKED 19.10 — AGREED FIRST ACTION (supersedes the two paragraphs below)]** The concrete first action is: **Phase -1 — build the S2 browser scene from the frozen event log** (interpolation-only, slice5 pattern, assets already staged), then the narrowed Phase 0 gaps (§2.2 mark), then the SME decisions gate (four chat decisions), then Phase 1. The engine decision (§8.1) and placement scope (§7.2) are already made and recorded; Phase 0 must not reopen them.

Do not attempt to implement all of Roadmap V3 in one pass.

Begin with Phase 0 and then Phase 1.

Inspect the repository, identify the actual current entry point and reusable components, and determine how the five current web apps are structured. Produce a concise implementation map.

Then immediately identify the smallest playable integration milestone and implement the shared gameplay shell needed to deliver Level 1.

Do not stop after producing a design document or another abstract technical plan. The repository inspection must lead directly to implementation.

If a major architectural uncertainty blocks progress, state the exact decision required. Otherwise, make a reasonable, reversible implementation decision and continue.

The objective is to make visible, playable progress while preserving the working simulation logic.

**Roadmap V3 is successful when SteelX is a game the player can actually play from Level 1 through Level 5 — not when the roadmap itself is complete.**