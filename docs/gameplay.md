# SteelX — gameplay.md (final merged gameplay concept, v2)

**Status:** `APPROVED — final merge of Yasser's Structured Gameplay Draft v1 (master structure) with agent draft v0 (data tables + learning lines as appendices). Approved in discussion 19.10; ready for injection into roadmap V3.`

**How this file was merged (standing ruling):**
- Yasser's Draft v1 is the **master**: §0–§9 below follow its structure and decisions verbatim in intent.
- Agent draft v0 contributes **Appendix A** (data-table inventory + per-unit data fields) and **Appendix B** (specific learning lines + maintenance/asset data concepts).
- Two agreed amendments are folded into the master text:
  1. **Economy timing fix:** cash and simple costs must exist from **Level 2** (its "Expand or Optimize?" quest needs money to spend), not Level 5 — see §3.9 and §4.6.
  2. **Dependency note:** Level 2 stands on **Slice 2 getting a sim** (S2 has none today — roadmap fact) — see §2.2 and Appendix C.

**Purpose.** The player-facing gameplay contract for SteelX across five campaign levels, plus the data-layer inventory that feeds content JSON + economy spec. Gameplay concept only — it does not prescribe code or implementation architecture.

**Scope & numbers rule.** Industrial values are game-design placeholders / game-plausible approximations, not engineering recommendations or industry-precision data (standing ruling).

---

## 0. Core Game Concept and Loop

> SteelX is a factory-building and problem-solving game in which the player grows one persistent steel plant, fulfils production objectives, diagnoses bottlenecks, makes meaningful decisions, and learns how the entire factory works together.

The player acts as the **plant manager**. Routine industrial processes run automatically by default. The player intervenes when a meaningful decision, bottleneck, investment, scheduling choice, or recovery action is needed.

### Core loop

1. **Discover** — a production problem, new capability, or customer objective appears.
2. **Diagnose** — inspect the factory and identify the cause, not just the symptom.
3. **Decide** — select a plan, allocate a resource, prioritize work, or improve capacity.
4. **Run and observe** — watch the factory respond at normal or accelerated simulation speed.
5. **Improve and unlock** — receive feedback, earn a result, and unlock the next capability.

Every main quest should include:
- a clear situation;
- a measurable objective;
- at least one meaningful player decision;
- visible cause and effect;
- a concise learning takeaway or debrief.

Not every quest requires a pop-up. The factory itself should communicate as much information as possible.

### Player role

The player is the plant manager, not the operator of every individual machine.

- Routine operations are automated by default.
- The player sets priorities, chooses upgrades, balances material flow, selects simplified production options, and resolves important bottlenecks.
- Advanced controls may be available later as optional detail, not mandatory micromanagement.
- The player can inspect any system without committing to an action.

### Four verbs (kept from draft v0 — they map 1:1 onto the card types in §5.1)

Every click on the factory is one of four verbs:

| Verb | Meaning | Card/UI primitive (§5) |
|---|---|---|
| **Inspect** | always available, free, observe-only (shipped in Phase 1) | Discovery / inspection cards |
| **Build** | ghost slot → real machine (costs cash, takes construction time) | Build confirm sheet |
| **Decide/Operate** | set priorities, schedules, product choices | Decision card + control panel |
| **Maintain** | planned maintenance or recovery response | Diagnosis card + maintenance sheet |

`AGREED constraint:` the tick loop stays authoritative and deterministic (save/load marks); construction takes N ticks (`not_built → built → operational` lifecycle — roadmap rule).

---

## 1. Campaign Structure and Progression

### 1.1 Campaign structure

| Parameter | Value |
|---|---|
| Main campaign | 5 levels |
| Persistent factory | One factory grows across all levels |
| Main quests | 4 per level; 20 total |
| Optional challenges | 1 per level; 5 total |
| First meaningful success | Target within 2–3 minutes |
| Early quest duration | Target 2–5 minutes |
| Later quest duration | Target 4–8 minutes |
| New core concept | One primary concept per level |
| Decision complexity | Usually 2–3 meaningful options at a time |
| Simulation speed | Pause, normal, fast |
| Campaign failure | No irreversible game-over state |
| Progression | Quests, equipment/capability unlocks, factory milestones |
| Scoring | Completion, efficiency, quality; sustainability introduced later |
| Replayability | Optional scenarios after or alongside campaign progression |

These are gameplay targets to validate through playtesting, not measured outcomes or simulation-calibration requirements.

### 1.2 Level escalation

- **Level 1 — The First Flow:** raw materials and logistics.
- **Level 2 — The Scrap Challenge:** shared transport, queues, and bottlenecks. *(depends on Slice 2 sim — see §2.2 note)*
- **Level 3 — The Buffer Strategy:** continuous supply versus batch demand.
- **Level 4 — From Melt to Billet:** refining, quality, and casting synchronization.
- **Level 5 — The Complete Steelworks:** rolling, orders, delivery, and whole-plant performance.

Each level retains the factory from previous levels. The campaign should feel like one plant evolving, not five unrelated tutorials.

### 1.3 Quest pattern

Each quest follows a flexible five-part pattern:

1. **Situation:** what is happening?
2. **Goal:** what must the player achieve?
3. **Decision:** what can the player do?
4. **Consequence:** what visibly changes?
5. **Learning:** what principle did the player experience?

Quest types should rotate between diagnosis, building/improvement, planning/prioritization, production, balancing, and delivery under pressure. Avoid repeating the same quest type back-to-back unless the second quest introduces a meaningful new twist.

### 1.4 Unlocks and ghost slots

- Ghost slots may preview future capabilities and explain the relevant unlock condition.
- Unlocking a machine should solve a new gameplay need or introduce a new decision—not merely add another card to the interface.
- New equipment should produce a visible factory milestone.
- The player should understand why the new capability matters before being asked to manage it.

---

### 1.5 Guided first build — the game-start flow (Slice 1 first)

The campaign always runs on the **fullplant home scene** (one continuous factory). The first thing the player sees is a guided build sequence that teaches one equipment step at a time until Slice 1 is built and operating, then hands off to Quest 1 (§2.1). The step order itself is data-driven in `content/sequence/level1_draft.json`; the cards it references live in `content/cards/cards_phase1_draft.json`. This section fixes the behavior rules of that flow:

**Flow shape (Slice 1 scope, for now):**

| Step | What happens | Card |
|---|---|---|
| 0 | Game start: welcome popup over the empty site — "Welcome to SteelX", the first steel-manufacturing simulator of its kind, one-paragraph intro. | `intro_integrated_plant` (welcome copy revised) |
| 1 | Camera shows the **empty general layout**: all slice footprints visible as ghost slots (per §1.4), nothing built, later slices greyed/locked. | — |
| 2 | A popup card points at the first equipment slot (the Jetty): technical introduction — what a jetty/berth is, ship cadence, its role as the plant's front door. Confirming the card triggers the guided build. | `jetty_logistics` |
| 3 | Cheap build reveal: the model fades/scales in over ~1s with a "coming online" pulse — no construction-crane animation (settled rule: animate material, not machines). The sim clock starts on this completion. | — |
| 4+ | Each next step: one popup card pointing at the next slot, confirm → built → joins the running sim. One card at a time; palette/ghost slots highlight only the next required step. | per-step `card_id` in the sequence file |
| End | Slice 1 complete (exit condition below) → onboarding ends, Quest 1 *First Arrival* becomes active. | quest panel takes over |

**Behavior rules:**

- **Time rule (supersedes the older "sim runs during construction" note):** the sim clock is **frozen** from game start until the Jetty build completes; from then on it runs, and every equipment built afterwards joins a live, ticking plant. The Jetty completing is literally "the plant starts."
- **Fully guided:** each step's equipment appears at its pre-defined footprint — no free placement in this flow (free/choice placement may come later as a mechanic).
- **Conveyors keep their per-segment steps** from the sequence file (easiest path: the data already lists them; no merge needed).
- **Card presentation:** step cards show in the right panel (or above-screen on small layouts), always with a visual pointer to the target slot. Cards carry real industrial information — this is the learning layer, kept technical and plausible (ranges, not invented precision).
- **Exit condition ("Slice 1 built and operating"):** all Slice-1 slots built **and** the first material actually flowing in the live sim (`ships_arrived >= 1`, yard `arrived_t > 0`). Quest completion stays driven by real simulation state.
- After Slice 1's flow is shipped, the same pattern extends slice by slice (S2 → S5); later-slice steps stay locked/greyed until their slice unlocks.

---

## 2. Level Design and Quest Contract

## 2.1 Level 1 — The First Flow: Raw Materials and Logistics

**Primary learning objective:** Production starts with reliable material supply.

**Player fantasy:** "I have a factory, but can I get the materials moving?"

**Starting situation:** The plant has a basic production route, but raw-material handling is incomplete or inefficient.

| Quest | Situation and objective | Main player decision/action | Learning outcome |
|---|---|---|---|
| 1. First Arrival | Receive the first cargo ship and get raw material into the yard. | Observe and initiate/confirm the basic unloading route. | Material must enter the plant before production can consume it. |
| 2. Keep It Moving | Material is available, but movement through the route is restricted. | Identify the restricted link and choose a simple flow improvement. | Material handling can limit production even when stock exists. |
| 3. Feed the Furnace | The EAF needs a sufficient scrap supply for a production cycle. | Prioritize replenishment or adjust the supply plan. | Upstream shortages cause downstream starvation. |
| 4. First Steel | Restore a stable material flow and complete the first production milestone. | Keep the supply route balanced during the run. | The plant is a connected flow, not a collection of isolated machines. |

**Optional challenge — No Idle Furnace:** Meet the production target while minimizing avoidable raw-material starvation.

**New mechanics:** Ship arrival, unloading, stockpiles, material movement, basic throughput.

**Visual milestones:** Ship unloading, conveyor movement, growing stockpile, furnace cycle, first production success.

**Keep simplified:** Tariffs, detailed chemistry, maintenance schedules, and complex finance.

**Level completion:** The player can explain why reliable upstream supply matters to downstream production.

## 2.2 Level 2 — The Scrap Challenge: Capacity and Bottlenecks

**Primary learning objective:** A bottleneck can restrict the whole production chain.

**Player fantasy:** "The materials are here, so why is production still waiting?"

**Starting situation:** Scrap demand increases. Shared crane and storage capacity can no longer serve every request immediately.

| Quest | Situation and objective | Main player decision/action | Learning outcome |
|---|---|---|---|
| 1. Too Many Requests | Multiple requests compete for a shared crane. | Set a sensible queue priority. | Shared resources force prioritization. |
| 2. Find the Bottleneck | Production is delayed despite material being present. | Diagnose stock availability, crane throughput, or destination capacity. | The visible symptom may not be the root cause. |
| 3. Expand or Optimize? | The current handling arrangement is limiting throughput. | Choose a capacity improvement or a better operating plan. | Investment is not always better than optimization. |
| 4. Keep the Furnace Fed | Meet a production target without excessive queues or shortages. | Balance crane priorities and material replenishment. | Flow balance matters across connected areas. |

**Optional challenge — The One-Crane Shift:** Achieve the target with existing crane capacity.

**New mechanics:** Shared resources, queue priority, basic capacity investment, bottleneck diagnosis. **Economy enters here (amendment):** simple cash + upgrade costs are live from Level 2 so "Expand or Optimize?" is a real trade-off (§3.9).

**Visual milestones:** Crane journeys, charging-bucket movement, visible queue reduction, balanced stockpiles.

**Keep simplified:** Random catastrophic breakdowns and detailed maintenance simulation.

**Level completion:** The player can identify a bottleneck and compare investment with operational optimization.

> **Implementation dependency note (roadmap fact, 19.10):** Level 2's mechanics — shared cranes, queues, congestion — stand on **Slice 2 getting a sim**. Today S2 has no sim in the engine; its parity port (`slice2_*`) exists as reference only. Roadmap injection must place "S2 sim build" as a prerequisite work package for any Level-2 gameplay slice.

## 2.3 Level 3 — The Buffer Strategy: Continuous Supply and Batch Demand

**Primary learning objective:** Buffers decouple processes with different production rhythms.

**Player fantasy:** "How do I keep two different processes working together?"

**Starting situation:** The DRP produces continuously, while the EAF consumes material in batches. Supply and demand do not naturally align at every moment.

| Quest | Situation and objective | Main player decision/action | Learning outcome |
|---|---|---|---|
| 1. A Different Iron Source | DRI becomes available as another input route. | Introduce DRI into the simplified supply plan. | Different iron sources support the production route in different ways. |
| 2. Too Much or Too Little | The DRI buffer drains or approaches capacity. | Adjust supply, demand, or timing. | Buffer levels reveal a mismatch between production and consumption. |
| 3. Plan Ahead | A period of higher EAF demand is approaching. | Prepare the buffer before the demand peak. | Planning ahead protects batch operations from supply variation. |
| 4. Balance the Rhythm | Complete a production target while coordinating DRI supply and EAF consumption. | Maintain a suitable buffer range during the run. | Buffers provide flexibility between continuous and batch processes. |

**Optional challenge — No Empty Buffer:** Maintain uninterrupted DRI availability during a demanding production period.

**New mechanics:** Buffer levels, continuous versus batch production, simple supply planning, capacity trade-offs.

**Visual milestones:** DRI output, changing buffer level, incoming charges, recovery from a shortage.

**Keep simplified:** Advanced gas optimization and detailed DRI chemistry.

**Level completion:** The player can explain why a buffer exists and how it protects downstream production.

## 2.4 Level 4 — From Melt to Billet: Quality and Synchronization

**Primary learning objective:** Producing liquid steel is not enough; refining and casting must work together.

**Player fantasy:** "Can I produce the right steel at the right time without disrupting the line?"

**Starting situation:** Upstream supply is established. The player must coordinate melting, refining, and continuous casting.

| Quest | Situation and objective | Main player decision/action | Learning outcome |
|---|---|---|---|
| 1. The First Heat | Complete a furnace charge and produce a heat. | Select a simple charge priority and start the production cycle. | EAF production is batch-based and has a visible cycle. |
| 2. Meet the Specification | A product requires a specified quality grade. | Choose a simplified alloy/treatment option. | Refining helps a heat meet the required product specification. |
| 3. Keep Casting | Ladle availability and caster demand are not well synchronized. | Adjust a simple sequence or priority. | Timing mismatches create waiting and reduce flow. |
| 4. A Stable Casting Run | Produce the required billet quantity while controlling quality and intermediate inventory. | Balance throughput, quality, and available buffer capacity. | The stages must be coordinated, not optimized in isolation. |

**Optional challenge — Quality First:** Meet the quality target while minimizing avoidable delays and material loss.

**New mechanics:** EAF batch scheduling, simplified product specifications, LRF treatment, casting synchronization.

**Visual milestones:** Charging, melting, tapping, ladle transfer, refining, strand casting, billet accumulation.

**Keep simplified:** Detailed chemistry controls and frequent random breakout events. Serious casting events should be rare, signalled, explainable, and recoverable.

**Level completion:** The player understands the production sequence and why quality and timing matter between the furnace and caster.

## 2.5 Level 5 — The Complete Steelworks: Orders, Efficiency and Delivery

**Primary learning objective:** The whole plant must work together to meet customer demand.

**Player fantasy:** "I have a working steel plant. Can I run it well enough to fulfil orders?"

**Starting situation:** The factory can produce billets, but finished-product demand adds deadlines, competing priorities, and resource constraints.

| Quest | Situation and objective | Main player decision/action | Learning outcome |
|---|---|---|---|
| 1. Turn Billets into Products | The plant has billets but needs finished rebar. | Start or prioritize the rolling route. | Rolling converts semi-finished steel into a saleable product. |
| 2. Choose Your Order | Two orders have different quantities, deadlines, or rewards. | Select the order that best fits current capability. | Order selection involves trade-offs. |
| 3. Find the Whole-Plant Bottleneck | An end-to-end production target is being missed. | Diagnose whether the cause is upstream supply, melting, casting, or rolling. | The final constraint may originate far upstream. |
| 4. Deliver the Steel | Fulfil the main order while balancing stock, quality, and timing. | Coordinate the production chain and dispatch. | End-to-end performance matters more than any one machine's output. |

**Optional challenge — Best Plant Performance:** Meet delivery and quality targets while minimizing energy use and avoidable downtime.

**New mechanics:** Finished goods, order selection, deadlines, full revenue/cost economics (order book), plant-wide performance.

**Visual milestones:** Rolling stands in operation, hot-product movement, finished bundles, inventory accumulation, dispatch.

**Advanced systems now appropriate:** Optional maintenance planning, energy-efficiency upgrades, sustainability scoring, advanced scheduling.

**Level completion:** The player can explain how decisions across the entire chain influence the final delivery.

---

## 3. Zone and System Gameplay Contract

The original equipment structure remains the reference for the factory systems. This section defines their proposed gameplay role, keeping routine operation automated and emphasizing player decisions. Data-field details per unit live in **Appendix A**.

### 3.1 Yard and Berths — Slice 1 (`s1_*`)

**Identity:** Raw-material arrival and entry into the plant.

**Role in flow:** The starting point for supply; shortages can starve downstream processes.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Berths begin available; additional capacity may be unlocked through a quest. |
| Inspect | Show berth occupancy, next ship ETA, stockpile quantity, and a clear supply status. |
| Player action | Prioritize unloading or improve the material supply plan when a meaningful bottleneck exists. |
| Failure/pressure | Full berths, delayed unloading, or low stock can restrict downstream supply. |
| Learning | Raw-material availability and handling affect production continuity. |
| Avoid | Requiring constant manual ship orders or detailed scrap-blend control in Level 1. |

### 3.2 Transport and Shared Handling — Slice 2 (`s2_*`)

**Identity:** Conveyors, cranes, buckets, and other material-transfer links.

**Role in flow:** Moves material between stages and can become a shared-resource bottleneck.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Core routes are available for the level; upgrades unlock when a quest needs them. |
| Inspect | Show flow status, throughput relative to capacity, queue depth, and the blocked destination if applicable. |
| Player action | Prioritize a shared resource, improve a route, or invest in additional capacity. |
| Failure/pressure | Congestion creates visible queues and may starve a downstream process. |
| Learning | Material handling can limit production even when equipment and stock are available. |
| Avoid | Making every conveyor a separately managed control panel. |

> Dependency: this contract is realizable only once S2 has a sim (§2.2 note, Appendix C).

### 3.3 DRP and DRI Buffer — Slice 3 (`s3_drp`, `s3_dri_buffer`)

**Identity:** Continuous DRI production and the buffer connecting it to batch-based EAF demand.

**Role in flow:** Protects the EAF from supply-demand timing mismatches.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Introduced in Level 3 through a guided quest. |
| Inspect | Show DRI output trend, buffer level, and whether supply is ahead of or behind demand. |
| Player action | Adjust a simplified supply plan, buffer capacity, or demand timing. |
| Failure/pressure | A depleted buffer risks EAF starvation; a full buffer indicates excess supply relative to use. |
| Learning | Buffers create flexibility between continuous production and batch consumption. |
| Avoid | Advanced gas controls and ramp-rate micromanagement in the core campaign. |

### 3.4 EAF — Slice 4 (`s4_eaf_main`)

**Identity:** Batch melting of scrap and/or DRI into liquid steel.

**Role in flow:** Main steelmaking stage; consumes prepared inputs and supplies downstream refining.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Available early; advanced scheduling and optimization are introduced progressively. |
| Inspect | Show current charge, cycle stage, material availability, and time to the next milestone. |
| Player action | Set charge priority or select a simplified charge option when the quest calls for it. |
| Failure/pressure | Input starvation or poor timing can delay downstream production. |
| Learning | EAF production is batch-based and depends on input supply and scheduling. |
| Avoid | Requiring constant control of power, oxygen, carbon, lining wear, and tariffs in the main campaign. |

### 3.5 LRF — Slice 4 (`s4_lrf`)

**Identity:** Ladle refining and quality adjustment.

**Role in flow:** Helps ensure the steel meets a simplified product specification before casting.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Introduced as part of the Level 4 steelmaking route. |
| Inspect | Show the target grade, current simplified quality status, and treatment progress. |
| Player action | Choose an appropriate treatment option for the target grade. |
| Failure/pressure | Incorrect choices may lead to extra treatment, delay, or a lower result score. |
| Learning | A successful melt still needs the right refining treatment for its intended product. |
| Avoid | A chemistry mini-game with detailed values in the core campaign. |

### 3.6 CCM — Slice 4 (`s4_ccm_strand1`)

**Identity:** Continuous casting of liquid steel into billets.

**Role in flow:** Converts refined steel into semi-finished stock and links steelmaking rhythm to rolling demand.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Introduced in Level 4; additional strands may be later upgrades or optional advanced content. |
| Inspect | Show caster status, casting progress, ladle availability, and billet output. |
| Player action | Adjust a simplified sequence or priority when synchronization is the quest objective. |
| Failure/pressure | Ladle/caster timing mismatch creates waiting; serious events are rare and recoverable. |
| Learning | Casting is a pacing link between upstream steelmaking and downstream production. |
| Avoid | Random catastrophic events without warning or clear player agency. |

### 3.7 Billet Yard — Slice 5 (`s5_billet_yard`)

**Identity:** Intermediate buffer between casting and rolling.

**Role in flow:** Separates caster timing from rolling-mill demand and maintenance windows.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Available in a simple form when needed; detailed capacity choices appear later. |
| Inspect | Show billet stock, whether supply is building or draining, and simple cover/status information. |
| Player action | Balance rolling demand, stock accumulation, and optional buffer-capacity upgrades. |
| Failure/pressure | An empty yard can starve rolling; a full yard can constrain casting. |
| Learning | Intermediate inventory buys flexibility but does not eliminate the need for flow balance. |
| Avoid | Making the player manage multiple inventory metrics before understanding buffers. |

### 3.8 Rolling Mill — Slice 5 (`s5_rebar_mill`)

**Identity:** Converts billets into finished rebar and later product families.

**Role in flow:** Final production stage for the initial campaign; fulfills customer demand.

| Field | Gameplay contract |
|---|---|
| Lifecycle | Introduced as the finished-product route; additional products may be later content. |
| Inspect | Show current product, rolling status, output quantity, and order progress. |
| Player action | Select an order, prioritize production, or choose a simplified product/sequence option. |
| Failure/pressure | Billet shortages, poor sequencing, or missed deadlines affect the quest result. |
| Learning | Finished-product planning must account for upstream availability, line capacity, and customer demand. |
| Avoid | Negotiation systems, complex product mixes, and constant maintenance micromanagement in the core campaign. |

### 3.9 Economics and Sustainability (amended — economy enters at Level 2)

| System | Gameplay contract |
|---|---|
| Economy | **Cash + simple costs are live from Level 2** (upgrade purchases, "Expand or Optimize?" trade-off). Costs expand progressively: OPEX awareness in Level 3–4, full order revenue/penalties in Level 5. |
| Energy | Introduce energy feedback before making efficiency upgrades mandatory later. |
| Sustainability | Feedback first; more meaningful trade-offs in advanced content and optional challenges. |
| Avoid | Complex finance, tariffs, detailed emissions calculations, or balance-sheet management in the early campaign. |

---

## 4. Cross-Cutting Gameplay Systems

### 4.1 Time and simulation speed

- **Paused:** inspect information, study the factory, plan without pressure.
- **Normal:** intended gameplay pace with meaningful visual feedback.
- **Fast:** compress repetitive production periods while preserving important events.

Fast-forward must never hide critical consequences silently. Important changes should remain visible through notifications, status colours, milestones, or a post-run summary. `AGREED constraint:` the tick loop stays authoritative and deterministic (save/load marks).

### 4.2 Failure and recovery

- Quest failure should be recoverable without restarting the entire campaign.
- Failed runs should explain what went wrong and provide a retry, adjustment, or alternative approach.
- The game may award Bronze/Silver/Gold results based on completion, efficiency, quality, and resource use.
- A poor result should teach rather than merely punish.

### 4.3 Quest variety

The campaign should rotate between: diagnosis; building/improvement; planning/prioritization; production under constraints; balancing competing demands; delivery under time pressure; optimization/efficiency challenges.

Avoid long sequences of the same interaction pattern. A level may introduce one dominant mechanic, but its quests should exercise it in different ways.

### 4.4 Replayability and optional mastery

Optional challenges should support players who want deeper engagement without forcing them into a second campaign. Possible challenge goals include: fewer breakdowns; lower energy per tonne; higher first-pass quality; smaller stockpiles; faster delivery; better return on investment; stable output during difficult demand patterns.

Replayability comes from changing objectives and constraints—not simply repeating the same production target.

### 4.5 Factory visibility as a learning system

The factory itself should communicate through: machine status colours; queue growth and material movement; buffer levels rising or falling; waiting at ladle, caster, or rolling interfaces; visible construction and upgrade progress; output accumulation after success; reduced queues after a good decision.

Cards explain what the player is already seeing. They should not be the only feedback mechanism.

### 4.6 Economy ramp (amended)

Cash and simple costs enter at **Level 2** so "Expand or Optimize?" is a genuine trade-off; OPEX awareness grows in Levels 3–4; full order economics (revenue, deadlines, penalties) arrive with Level 5's order book. The hub's economics port already exists — this is a content/config question, not a new system (Appendix C).

---

## 5. Information Cards and Player Guidance

### 5.1 Card types

| Card type | Purpose |
|---|---|
| **Discovery card** | Introduce a machine or capability and explain its role in the flow. |
| **Decision card** | Present meaningful options with understandable trade-offs. |
| **Diagnosis card** | Explain an observed problem, likely cause, and possible response. |
| **Milestone card** | Confirm achievement and provide a short learning debrief. |

These four types map 1:1 onto the Inspect/Build/Decide/Maintain verbs in §0 and onto the roadmap §6.6 card-trigger taxonomy.

### 5.2 Card rules

- Cards should be concise, contextual, and interrupt only when useful.
- They should explain what is happening now, not repeat generic descriptions endlessly.
- An inspection card may show live values, trends, current status, and the unit's role in production.
- A decision card should show consequences without overwhelming the player with advanced data.
- Not every machine needs a permanent information panel; visual state can carry much of the message.

### 5.3 Hint escalation (aligned with roadmap §6.5)

1. Visual signal or status change.
2. Short contextual hint.
3. Diagnostic suggestion after repeated failure or inactivity.
4. Optional guided solution for a stuck player.

The game should not solve every problem automatically, but it should never leave the player without a next action.

---

## 6. Content Production Contract (what each quest needs authored)

For each quest, content production must define:

1. **Situation content:** trigger, location, factory state, affected systems.
2. **Objective content:** measurable success condition and target range.
3. **Decision content:** options, costs or trade-offs, expected consequences, recovery options.
4. **Learning content:** discovery card, diagnostic explanation, milestone debrief.
5. **Visual-event content:** simulation event, corresponding animation, notification priority.
6. **Progression content:** unlock condition, factory milestone, next quest.
7. **Scoring content:** completion, efficiency, quality, and later sustainability criteria.
8. **Challenge content:** scenario constraints, target conditions, result tiers.

All numerical values remain game-design placeholders unless separately approved. This document does not require repeated calibration of placeholder values. The concrete table inventory is in **Appendix A**.

---

## 7. Gameplay Acceptance Criteria

The gameplay proposal is ready for deeper implementation planning when the design can support these tests:

- [ ] A new player can achieve a meaningful success within 2–3 minutes.
- [ ] Each level introduces a distinct industrial problem.
- [ ] Every quest has a clear objective and reason to exist.
- [ ] Most quests require a decision, diagnosis, or trade-off—not just waiting or clicking.
- [ ] Important player decisions produce visible consequences.
- [ ] Selected bottleneck quests permit at least two plausible approaches.
- [ ] Failures are explainable and recoverable.
- [ ] Routine machine operation does not require constant micromanagement.
- [ ] Information cards are concise, contextual, and useful.
- [ ] The factory visibly develops across the five levels.
- [ ] The quest sequence varies the type of challenge.
- [ ] Optional challenges reward mastery without blocking the campaign.
- [ ] Players can explain the main industrial lesson from each level.
- [ ] Animation reflects actual simulation state.
- [ ] The game provides a meaningful next action during longer production cycles.

These criteria are design targets to be evaluated through playtesting.

---

## 8. Decisions and Status

The following are the **approved default directions** for SteelX gameplay (settlement of the v0 decision queue is shown in parentheses):

1. **Player role:** plant manager; routine operation automated. *(settles v0 Q1: "operate" is automated by default; player intervenes)*
2. **Transport:** visible and meaningful, but not individually micromanaged. *(settles v0 Q2: visible system, card-driven — plumbing with a face, not per-conveyor panels)*
3. **EAF scheduling:** simple charge-priority decisions first; advanced controls later. *(settles v0 Q3: charge scheduler starts as a simple priority puzzle)*
4. **Contracts:** simple, understandable order choices introduced in Level 5. *(settles v0 Q4: accept/select depth only, no negotiation)*
5. **Billet yard:** a basic buffer available when needed; capacity management introduced progressively. *(settles v0 Q5: simple form first, paid upgrades later)*
6. **Breakdowns:** predictable where possible, rare, signalled, and recoverable. *(settles v0 Q6: random-with-mitigation, never blind player-error punishment)*
7. **Sustainability:** feedback first, more meaningful trade-offs in later gameplay. *(settles v0 Q7: flavor→score progression)*
8. **Losing conditions:** no irreversible campaign loss. *(settles v0 Q8: softer than tycoon bankruptcy)*
9. **Learning:** concepts taught through decisions and consequences, supported by concise cards.
10. **Engagement:** varied quests, visible milestones, and optional replay challenges.
11. **Game-start flow (§1.5):** fullplant home is the only campaign host; Slice 1 opens with a fully guided build sequence (welcome card → ghost-slot layout → per-equipment info cards at fixed footprints); sim clock frozen until the Jetty completes, then runs; cheap fade/scale build reveal only; onboarding exits when Slice 1 slots are built and first material flows in the live sim. *(Yasser confirmed 2026-10-26; supersedes the 2026-10-04 "sim runs during construction" note in `content/sequence/level1_draft.json`.)*

**Status:** `APPROVED as the gameplay concept layer; detailed content JSON and implementation packages follow roadmap cadence.`

---

## 9. Final Design Rule

SteelX should not ask the player to manage every industrial control. It should ask the player to understand the plant, identify the important problem, choose a sensible action, and see the consequences.

The five levels should progressively teach:
1. **Flow** — get material into and through the plant.
2. **Bottlenecks** — understand shared capacity and queues.
3. **Buffers** — balance continuous supply and batch demand.
4. **Quality and synchronization** — coordinate melting, refining, and casting.
5. **End-to-end performance** — turn billets into finished products and fulfil orders.

**Design target:** a factory-management game that is engaging because every quest offers a clear problem, a meaningful choice, a visible outcome, and an industrial lesson.

**North-star statement:** *Make the player solve five increasingly complex factory problems—not manage five increasingly complicated collections of controls.*

---
---

# APPENDIX A — Data-table inventory (from agent draft v0; feeds content JSON + economy spec)

All values are game-plausible approximation bands, never invented precision (standing ruling). Depth is trimmed to what the approved campaign actually touches: no chemistry mini-game fields, no negotiation fields, no per-conveyor panels.

## A.1 Master tables

| Table | Contents | Feeds |
|---|---|---|
| `units.json` | every unit: capacity bands, build cost band, build time (ticks), health decay rate | content JSON, economy spec |
| `quests.json` | 20 main + 5 optional: situation, goal, decision options, success criteria, scoring tiers, learning takeaway | quest engine / campaign layer |
| `orders.json` | product, qty, deadline, price, penalty (Level 5 order book) | economy spec |
| `tariffs.json` | power tariff curve $/kWh by tick-window (Level 4+ optional depth) | economy spec |
| `specs.json` | simplified grades per product family (B1/B2-style rebar grades, not chemistry) | LRF treatment options |
| `upgrades.json` | tech tree: cost, effect on unit stats, unlock quest | progression content |

## A.2 Per-unit data fields (game-plausible bands; calibrated later via playtest/SME pass if needed)

**Slice 1 — Yard & Berths (`s1_*`):** berth count/capacity, yard capacity kt, arrival cadence (ships/tick window), stockpile tonnage. *(Ship queue/demurrage fee kept from S1 sim as background pressure only in main campaign; blend grades are flavor, not a player mechanic — §3.1 "Avoid".)*

**Slice 2 — Transport (`s2_*`):** per-link capacity t/tick, queue depth limits, crane count + cycle time, upgrade cost bands, priority weight per request class. *(Requires S2 sim first — Appendix C.)*

**Slice 3 — DRP & buffer (`s3_drp`, `s3_dri_buffer`):** capacity band (ghost card shipped: 500k–2.5M t/yr; cost band 75–87 placeholder units), ramp rate %/tick, buffer kt capacity + level, gas cost $/t DRI. *(Ramp-rate reality is a learning line, not micromanagement — §3.3 "Avoid".)*

**Slice 4 — EAF (`s4_eaf_main`):** shell capacity t/charge, melt time ticks, power kWh/t (+ tariff curve availability Level 4+), **lining life in cycles**, unplanned-breakdown probability when unmaintained.

**Slice 4 — LRF (`s4_lrf`):** treatment time ticks, alloy/treatment cost $/t by simplified grade, spec table per order.

**Slice 4 — CCM (`s4_ccm_strand1`):** strand speed m/tick, billet length options, **break-out probability vs casting-speed setting** (mitigable), turret ladle capacity, `caster_wait` hook (already simulated in S4).

**Slice 5 — Billet yard (`s5_billet_yard`):** capacity expressed as **casting-days of cover** (the player-facing number), current cover days, upgrade cost bands. *(Ghost card shipped: 3–10 days of casting capacity.)*

**Slice 5 — Rolling mill (`s5_rebar_mill`):** line speed t/tick per product, **changeover time ticks**, **roll life in t-rolled**, order progress fields, deadline/penalty fields from `orders.json`.

**Side systems (already live hub ports):** economics port → cash wallet (from Level 2), OPEX per machine per tick, CAPEX on build/upgrade, order revenue & penalties; sustainability port → energy kWh/t plant-wide, CO₂ t/yr feedback badge.

---

# APPENDIX B — Learning lines and asset-management data concepts (from agent draft v0)

## B.1 Approved learning lines (the one-liners cards should carry)

| Unit | Learning line |
|---|---|
| Yard/scrap | "Scrap is the EAF's diet: grade mix decides energy cost and steel quality." |
| Transport | "Material handling is where real plants lose tonnes per day." |
| DRP/buffer | "A DRP discharges continuously; the buffer exists so the EAF never starves." *(already on shipped ghost card)* |
| EAF | "An EAF is an electrical bill with a furnace attached — scheduling around power windows is real mill math." + "EAFs hate stopping: cold charges cost." |
| LRF | "Chemistry is the product — a good melt still needs refining to hit spec." |
| CCM | "The caster is the metronome of the plant — everything syncs to it." |
| Billet yard | "Buffers buy you time to fix things; zero buffer = zero forgiveness." |
| Rolling mill | "A rolling mill's money is in changeover planning and roll management, not just speed." |
| Efficiency upgrades | "Efficiency upgrades are maintenance you get paid for." |

## B.2 Asset-management data concepts (maintenance layer, GAME phase 2 boundary respected)

Kept as **data fields** now so the future maintenance system needs no schema redesign — they are not player-facing micromanagement in the core campaign (§3 "Avoid" rows):

- **Lining life** (EAF): cycles until refurbishment; predictable wear warning → planned shutdown window vs rare signalled breakdown.
- **Roll life** (mill): tonnes rolled until roll change; planned change vs wear-out quality defects/downgrades.
- **Changeover time** (mill): ticks between product families; the Level 5 scheduling decision lever.
- Health decay + planned-vs-unplanned downtime tradeoff per machine is the single mechanic that makes maintenance cards interactive in GAME phase 2 (roadmap boundary respected).

---

# APPENDIX C — Implementation dependency notes (no roadmap conflicts)

1. **Level 2 → S2 sim:** Level 2's shared-crane/queue mechanics require a Slice 2 sim, which does not exist today (parity port only). Roadmap injection must list "S2 sim" as a prerequisite work package before any Level-2 gameplay build.
2. **Slice 1 selector gap:** `slice1_berth_yard` parity port exists but slice1 is absent from the hub catalog — deferred item already recorded in `web/docs/PHASE1_FINALIZATION_REPORT.md`; Level 1 gameplay needs it wired into the hub.
3. **Economy ports exist:** economics + sustainability side ports are already live in the hub; §4.6's economy ramp is a content/config question, not a new system.
4. **Observe-only cards shipped:** Phase 1's tap-to-inspect pattern satisfies §5.2's inspection-card contract exactly; Decision/Diagnosis/Milestone card types (§5.1) are the remaining card work.

---

# APPENDIX D — Injection map into roadmap V3 (how this file merges — agent's job, executed at merge step)

| gameplay.md section | Injects into roadmap V3 as |
|---|---|
| §0 core loop + four verbs | new "Gameplay concept" section opener (design north-star) |
| §1 campaign structure + §2 five levels/quests | **level-phases section** — each level becomes a phase with its quest contract |
| §3 zone contracts | per-slice gameplay notes under existing slice sections (no architecture changes) |
| §4 cross-cutting systems | merged into existing pacing/save-load marks; new failure-recovery + scoring marks |
| §5 card types | merged into **§6.6 card triggers** (four card types = trigger taxonomy) |
| §8 decisions | recorded as 【MARKED】 decision entries resolving the v0 open questions |
| Appendices A/B | content JSON + economy spec work packages |
| Appendix C | prerequisite work-package notes (S2 sim, slice1 catalog wiring) |

Conflict rule: nothing in this file overrides a settled roadmap decision; where gameplay touches a settled rule (lifecycle states, tick determinism, budget=cosmetic, GAME-phase-2 maintenance boundary), the roadmap rule is cited inline and respected.