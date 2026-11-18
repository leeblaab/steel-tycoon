# PLAN_FORGED — SteelX full refurbishment plan (v1.0, Go-pending)

**Status: THE ACTIVE PLAN. This document overrides all phase numbering and planning
documents that came before it.** `docs/Raodmap V3.md`, `RoadMap_V2.md` and the session
prompts become frozen history the moment S0.2 lands — nobody plans from them again.
Owner: Yasser (SME). Execution: Hermes agent, one Go-gated micro-step at a time.

---

## 0. Premise (settled 18.11)

- The engine core is good: mirror-first deterministic engines, per-tick ledger closure,
  pure-data onboarding, card content pipeline. Keep; adjust only where listed.
- The game logic and calculations are good. Same.
- We are completely behind on **visuals and gameplay presentation**. This plan fixes that.
- If forgetting our 3D assets solves the issue, we forget them. Nothing is sacred.

## 1. Settled decisions (SME approvals — copy into DECISIONS.md at S0.2)

| ID | Date | Decision | Supersedes |
|---|---|---|---|
| F-01 | 18.11 | Heroes = procedural Blender-Python ("Factorio-flat-3D"); scenery = Kenney CC0; textures/HDRI = Poly Haven; ComfyUI demoted to 2D concept/card art only | pristine-GLB rebuild program |
| F-02 | 18.11 | `content/` published in-repo; project direction = open source | content/ gitignore exclusion |
| F-03 | 18.11 | Stream-color material language is the PRIMARY visual grammar; zone tints demoted to secondary pad color | per-zone rainbow identity |
| F-04 | 18.11 | Art bar = "readable industrial diorama"; SME gates on "reads as a real plant's flow and equipment", never photoreal; NO day/night, NO DOF, no photoreal ambitions | (clarifies §9) |
| F-05 | 18.11 | Treatment order: lighting + palette + fog applied to the CURRENT scene first; before-screenshot captured for measurable after | — |
| F-06 | 18.11 | Nothing sacred: every old hero GLB (incl. rebuilt 21 MB jetty.glb) dies at its slice gate; swap = add new + delete old + validate budget in ONE gated commit; one hero per gate; repo keeps shrinking | rebuild-all approval |
| F-07 | 18.11 | Breadth freeze: no S2 scheduling engine, no seventh slice, no extra economy systems until the six slices are connected and readable | — |
| F-08 | 18.11 | Mill routing (rebar vs wire rod) = visuals first, real player decision only when the order book exists; billet→mill interface stays tonnage-only (grade-OUT stands); minimal mirror logic now | — |
| F-09 | 18.11 | Gate discipline: sensory gate ("Yasser plays it, says it reads right") + per stage one objective perf gate (draw calls/tris/fps budget) + one "still playable" smoke; a closed stage never reopens (anti-polish-loop rule) | — |
| F-10 | 18.11 | License: **Apache-2.0 code + CC BY-SA 4.0 content** (NC dropped; SME monetizes as copyright holder via dual-license if ever needed) | ISC license field, "proprietary" README claim |

## 2. Visual language spec (approved palette — shared constants module in S0.4)

### Material streams (dominant everywhere: ground strips, belts, tokens, UI, cards)
| Stream | Color | Notes |
|---|---|---|
| Scrap | rust orange-brown `#8a5a3c` | |
| Ore / pellets | dark red-brown `#6e3b2e` | |
| DRI / HBI | silver-gray `#9aa3ad` | |
| Hot metal (liquid) | incandescent `#ff9a3c` | **emissive**, near-white core in tap stream |
| Slag | dark gray-green `#4a4f45` | |
| Billet hot→cold | `#ff7a1f` → steel blue-gray | emissive fades with "temperature" |
| Rebar (finished) | steel blue `#5b7c99` | straight strapped bundles |
| Wire rod (finished) | lighter blue | coiled — the coil is the signature |
| Utilities | water teal, gas yellow, oxygen light-blue, graphite near-black | |

### State grammar (every machine, always)
- **idle** = desaturated, no emissive
- **running** = stream-colored emissive pulse + a moving part
- **blocked / starved** = amber warning ring + icon (driven by existing sim
  `tone`, `ladle_wait`, `caster_wait`, `heats_starved` — the data already exists)

### Silhouette cues (readable from ~42° above, one glance)
| Machine | Signature | Scale note |
|---|---|---|
| Jetty/unloader | pier + ship hull + grab crane on rails | ship sets world scale |
| Stockyard | flat pad + conical stockpile mounds (height = inventory) + stacker/reclaimer boom | low, wide |
| DRP shaft | tall vertical shaft + top charge conveyor + bustle ring + reformer boxes | **tallest** |
| EAF | squat round vessel on trunnions + 3 electrodes in triangle + swing roof + transformer house | vessel ~8 m dia |
| LF | smaller ladle-on-car + single small mast + alloy hoppers — "EAF's little brother" | ladle ~4 m |
| Caster | the ARC: turret (2 ladles) → curved mold → straighteners → cut torch | arc r ~10 m |
| Reheat furnace | long dark tunnel, glowing bar exits at charge table | before mills |
| Rebar mill | long building + stands line + **cooling bed walk-out** + shear; straight bundles | longest (~100 m) |
| Wire-rod mill | stands + **looping/lay-down coil former**; coils stack | medium |
| Billet/finished yard | instanced bars fading hot→gray; strapped hex bundles; coils | long, low |
| Dispatch | weighbridge + truck/rail loadout + bundle/coil stacks | low |

### Camera grammar
Keep touch-ready free orbit; clamp default azimuth to plant-flow axis (flow reads
left→right); 3 zoom presets (plant / zone / machine); scripted tween per quest step.
Consistent orientation beats freedom for a learning sim.

### Lighting rig (fixed golden-hour mood)
One warm directional sun (~35°, long shadows, one 1024 shadow map desktop / blob
shadows mobile) + hemisphere fill (sky-blue / rust bounce) + steel-blue distance fog;
emissive hot metal + state lights do the "alive" work; AO baked into vertex colors by
Blender scripts; Poly Haven 1K HDRI desktop only. NO day/night cycle, NO DOF.

### Perf budgets (phased so no gate is unpassable by design)
- **S0.4 gate = baseline + relight delta:** record draw calls / fps / download size at
  S0.4 BEFORE relighting; the gate is "must not regress vs that baseline". The soup
  heroes blow the absolute tri budget before any swap, so no absolute tri gate here.
- **Absolute budgets gate from Stage 1 onward**, as heroes go procedural one per gate:
  ≤150 draw calls · ≤200k visible tris · ≤256 MB GPU textures · ≤60 MB total download ·
  30 fps floor on mid-tier phone · every hero <2,500 tris / <150 KB / named pivots.

## 3. The spine: six CHAPTERS = the material route (this IS the gameplay)

**Naming rule (settled):** "Chapter" = a route/presentation chapter. The engine slice
IDs (`slice1/2/3/4/5`, catalog entries, parity ports, quest mapping) are UNCHANGED —
we never rename or refactor engine identifiers for presentation reasons.

```
Chapter 1 — THE ORE BELT   yard → belt → DRP shaft; ore tokens crawl the belt; mound fills
Chapter 2 — THE HEAT       scrap charge → EAF tilt/tap → glowing tap-stream → ladle car moves
Chapter 3 — THE ROUTE      DRI stockpile + scrap feed → fill levels; starve it → amber spreads
Chapter 4 — THE CAST       caster arc: turret → curved mold → withdrawal → cut torch;
                           billets exit hot in rows
Chapter 5 — THE MILLS      reheat furnace discharge glow → glowing bar THREADS the stands at
                           speed (gets longer as it thins) → cooling-bed WALK-OUT (bars step
                           across, glow fading to black) → shear + strapping; wire-rod line
                           with coil signature (rebar line live, rod line visible-but-idle)
Chapter 6 — THE SHIPMENT   finished yard: strapped rebar bundles + rod coils → truck/rail
                           loadout → weighbridge → counter roll → campaign completes
```

Every chapter gate = SME plays the quest chain up to that point and says it reads right,
plus ledger-closure tests green, plus perf budget holds. Gameplay (quest steps), first
real cross-slice handoffs, one procedural hero, and presentation layer land together —
never as separate tracks.

## 4. Stages and micro-steps (each ☐ = one Go-gated micro-step)

### STAGE 0 — Foundation (repo true + scene relit; ~2–3 sessions)
- **S0.1** Un-ignore `content/` (F-02), commit it. Fresh-clone gate: `npm ci` → vite
  build → vitest → step-1 smoke on a clean clone. *Gate: a stranger's clone builds and plays step 1.*
- **S0.2** Docs reset: `STATE.md` (≤150 lines, the only session opener) +
  `DECISIONS.md` (F-01…F-10 + audit-derived entries) + this file marked active;
  roadmap V3/V2 frozen as history — **but first copy the settled sim contracts out of
  them into DECISIONS.md so "overrides all" doesn't orphan them**: state-in/state-out
  pure ticks, xorshift32 RNG word inside state, quest-gated unlocks, no irreversible
  failure, per-tick ledger closure at 1e-6; README corrected (real test counts, real
  layout, Apache-2.0/CC BY-SA, "what this is" front page); `license` field fixed;
  `npm test` made real; license files split: `LICENSE` (Apache-2.0 code) +
  `CONTENT_LICENSE` (CC BY-SA 4.0 content/) + `THIRD_PARTY.md` (Kenney CC0, Poly Haven
  CC0, etc.); in-game **Credits/About panel** carrying CC BY-SA attribution + Kenney /
  Poly Haven CC0 notices (built alongside the first UI touch, completed by Stage 6).
- **S0.3** Commissioning fix: quest completion unlocks the **build chain**; engines start
  at `sliceBuildDone`. Retune the four quest thresholds. *Gate: no machine produces before you build it.*
- **S0.4** Before/after relight of the CURRENT scene (F-05): palette constants module +
  lighting rig + fog + camera presets/tweens. **Capture before-screenshot AND perf
  baseline first** (draws/fps/download — gate is no-regression vs baseline, per phased
  budgets above). Zone rainbow demoted to pad tints; stream-color ground strips + arrows
  drawn between zones. *Gate: SME sees the after and says "that's the look".*
- **S0.5** Persistence v2 in fullplant (pulled forward from Stage 2 so the SME's stages
  1–2 play sessions survive reloads): schema memo (`onboard`, per-slice `{state, unlocked}`,
  `decisions`, `speed`) → autosave on quest-complete + checkpoint slots → probe:
  save@step4 → reload → continue, ledger-clean. *Gate: play survives reload.*

### STAGE 1 — Chapter 1: The Ore Belt (~3–4 sessions)
- **S1.1** Registry primitives: `transfer / reserve / release` + `in_transit` ledger with
  `arrival_tick` (two-phase handoff, never same-tick teleport). Boundary-closure test green.
- **S1.2** Onboarding step 4 wired to it: the belt you build IS the first transfer edge;
  instanced ore tokens (dark red-brown) traverse yard→DRP; token count tracks ledger quantity.
  **Boundary buffer pattern (25.10 clause 2):** step-4 belt is built before DRP is live, so
  wire `yard → ore boundary buffer → DRP consumes on commission`. The buffer is a real
  registry inventory, not a fudge factor — step 4 stays playable and the transfer stays
  real without forcing DRP early.
- **S1.3** Hero swap #1: procedural **DRP shaft** (Blender-Python → validate <2.5K tris,
  named pivots → integrate → delete drp.glb + jetty.glb in the same commit per F-06;
  jetty rebuilt as Kenney kitbash + procedural pier). *Gate: repo shrinks ~40 MB, scene reads better.*
- **S1.4** Ore-yard fill level (mound scale.y = inventory). *Gate: SME plays step 4 end-to-end, sees his belt work.*

### STAGE 2 — Chapter 2: The Heat (~3–4 sessions; VISUALS ONLY — audio lives in Stage 6)
- **S2.0** Contract check (mirror-first) — **verified 18.11:** `slice4_mirror.py` does NOT
  emit a heat-phase enum today; it has charge statuses (`planning/delivered/in_furnace/
  tapped`) + event strings ("EAF taps…", "LRF refine starts…"). So S2.0 = add an explicit
  per-heat phase enum (charge/melt/refine/tap) to the mirror + TS parity port FIRST —
  it is the shared contract driving both the EAF animation and the cutaway card.
- **S2.1** Hero swap #2: EAF from Qwen's draft script (audit_2 A4) — run headless Blender,
  validate, fix bugs (script is untested; budget one debug pass), integrate; old eaf.glb ×2 deleted.
- **S2.2** Heat-cycle animation driven by real sim phases (the S2.0 enum) — SME non-negotiables:
  roof swings **sideways** off the shell to charge; electrodes bore down (power on),
  raise + swing away with roof; slow heavy tilt ~30–40° on trunnions (hundreds of
  tonnes, never a snap); fat incandescent tap stream (orange-yellow, near-white core)
  spout→ladle; restrained spark shower at ladle impact; smoke rising; ladle glows from
  inside, travels to LF. *(Sound contrast melt-ROAR → tap-quiet is Stage 6 — done once.)*

### STAGE 3 — Chapter 3: The Route (~2–3 sessions)
- **S3.1** Handoffs #2/#3: scrap yard→EAF and DRI stockpile→EAF (charge-bucket reservation
  stays inside slice rules; registry exposes owner-tagged reserve/consume). Fill levels on
  all yards/buffers.
- **S3.2** State lights + amber rings wired to existing `starved`/`wait` events.
  *Gate: starve the DRP on purpose — the plant visibly turns amber where it hurts.*

### STAGE 4 — Chapter 4: The Cast (~2–3 sessions)
- **S4.1** Hero swap #3: caster arc (turret + curved mold + straighteners + cut torch,
  named pivots). Old ccm.glb deleted same commit.
- **S4.2** Billet rows instanced; emissive hot→cold fade tied to sim billet age.
  Ladle car EAF→LF→caster on rails (the batch rhythm made visible).
  *Gate: a full heat runs charge→tap→cast visibly.*

### STAGE 5 — Chapters 5–6: The Mills & The Shipment (~3–5 sessions)
**Do NOT build a new rolling-mill engine.** `slice5_mirror.py` + `slice5_sim.ts` +
15 parity tests are live. Stage 5 = **extend the existing slice5 mirror's event outputs**,
mirror-first — this saves weeks and keeps one owner per rule (§2.1).
- **S5.1** Extend slice5 mirror (Python first, then TS parity port): expose phase/event
  outputs for reheat discharge → stand-line pass flow → cooling-bed occupancy/walk-out →
  shear/bundle; two product routes (rebar live, wire rod defined-but-idle) so routing
  drops in later as a switch. Tonnage-only throughout (F-08). Fixtures + closure tests.
- **S5.2** Dispatch revenue counter ONLY: tonnage × price at dispatch, wired from D2's
  reference port if convenient. **No wallet / upgrades / spend systems** — that would
  breach the breadth freeze (F-07 guard). One owner per rule; D1/D2/D4 stay references.
- **S5.3** Hero swap #4/#5: rebar mill (long building + stands + cooling-bed walk-out) and
  wire-rod mill (coil former signature) + reheat furnace. Old rolling GLBs deleted.
- **S5.4** The mill nod animations (SME non-negotiables): **glowing bar threads the stands
  at speed, getting longer as it thins** (mass-flow continuity); **cooling-bed walk-out —
  cut bars stepping across the walking beam, glow fading to black**; reheat discharge glow
  at entry; bundle strapping at exit. Wire-rod: coil is the signature.
- **S5.5** Finished yard + dispatch: strapped hex bundles + rod coils, truck/rail loadout,
  weighbridge, shipment counter roll, quest banner. *Gate: full campaign walk step 1 →
  shipment end-to-end, reload-safe, ledger-closed plant-wide.* First complete
  "I ran a steel plant" moment.

### STAGE 6 — Juice & learning layer (pick-as-we-go after Stage 2; never blocks slices)
- WebAudio synth kit (clang/hum/alarm/chime — zero asset budget), mute toggle,
  first-interaction unlock; melt-roar→tap-quiet contrast lives here.
- Placement pop + dust + thud; heat-complete toast + micro-shake.
- Tap-a-stream → highlight its whole path, dim others (route teaching).
- **2D animated cutaway cards** driven by real sim phases + SME numbers: EAF cross-section
  during a heat (charge→melt→oxidize→tap) and DRI shaft cross-section. Highest learning
  value per unit effort; reuses the digital-twin diagram grammar.
- Poly Haven ground/cladding textures + KTX2 compression; 1K HDRI desktop env lighting.

### STAGE 7 — After the six slices prove it (planned, not scheduled)
S2 collision fixture freeze → S2 port (scheduling/priority gameplay) → drill-in contract
for legacy slice scenes → order book + mill routing as a real decision (F-08 unlocks) →
mobile packaging exploration (Capacitor; budgets already enforced since S0.4).

## 5. Standing rules for this plan

1. **Go-gated micro-steps** — one at a time, SME approves each; unknown values are asked, never invented.
2. **Anti-polish-loop (F-09)** — a closed stage never reopens; sensory gate + perf gate + smoke per stage.
3. **One hero per gate; add+delete+validate in one commit** (F-06) — repo monotonically shrinks.
4. **Mirror first** — any new engine logic (rolling mill, transfers) is proven in Python before TS parity port.
5. **Determinism never breaks** — tokens and animations are pure projections of state; save/resume stays exact.
6. **Docs discipline** — every gate appends to DECISIONS.md + refreshes STATE.md; roadmap files stay frozen.
7. **Old assets** — pristine 425 MB `assets_incoming/` moves to external backup with an in-repo hash manifest (bus-factor fix), never into git.

## 6. What "done" looks like for this plan

A stranger clones the repo, runs one command, plays a campaign from jetty to dispatch in
a plant that **reads** as a real DRI-EAF long-products mill: ore crawls belts, the EAF
tilts and taps with a glowing rope of steel, starved machines go amber, billets cool from
orange to black on the walk-out bed, rebar bundles and rod coils leave the gate, and the
whole thing runs at 30 fps on a mid-tier phone under 60 MB. The SME nods at every gate.
