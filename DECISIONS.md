# SteelX — DECISIONS ledger

Newest first. A decision here is settled: don't reopen it in chat or code without the SME
explicitly reopening it. IDs: F-xx = FORGED plan decisions (18.11), D-xx = older settled
contracts carried forward from frozen docs.

## FORGED decisions (settled 18.11 — source: docs/PLAN_FORGED.md §1)

| ID | Decision | Supersedes |
|---|---|---|
| F-01 | Heroes = procedural Blender-Python ("Factorio-flat-3D"); scenery = Kenney CC0; textures/HDRI = Poly Haven; ComfyUI demoted to 2D concept/card art only | pristine-GLB rebuild program |
| F-02 | `content/` published in-repo; project direction = open source | content/ gitignore exclusion |
| F-03 | Stream-color material language is the PRIMARY visual grammar; zone tints demoted to secondary pad color | per-zone rainbow identity |
| F-04 | Art bar = "readable industrial diorama"; SME gates on "reads as a real plant's flow and equipment", never photoreal; NO day/night, NO DOF | — |
| F-05 | Treatment order: lighting + palette + fog applied to the CURRENT scene first; before-screenshot captured for measurable after | — |
| F-06 | Nothing sacred: every old hero GLB (incl. rebuilt 21 MB jetty.glb) dies at its chapter gate; swap = add new + delete old + validate budget in ONE gated commit; one hero per gate; repo keeps shrinking | rebuild-all approval |
| F-06a | 20.11 (Yasser, "we can do the same for all"): ALL remaining legacy hero GLBs (lrf, feed, any other) retire at the chapter gate that replaces them — same add+delete+validate one-commit discipline; no standalone rebuild passes | piecemeal hero retirement |
| F-07 | Breadth freeze: no S2 scheduling engine, no seventh chapter, no extra economy systems until the six chapters are connected and readable (Stage 5 guard: dispatch revenue counter ONLY) | — |
| F-08 | Mill routing (rebar vs wire rod) = visuals first, real player decision only when the order book exists; billet→mill interface stays tonnage-only | — |
| F-09 | Gate discipline: sensory gate ("Yasser plays it, says it reads right") + per stage one objective perf gate + one "still playable" smoke; a closed stage never reopens | — |
| F-10 | License: Apache-2.0 code + CC BY-SA 4.0 content (NC dropped; SME monetizes as copyright holder via dual-license if needed) | ISC license field, "proprietary" README claim |
| F-11 | Commissioning rule (S0.3): quest completion ONLY unlocks the next slice's build chain; an engine ticks only when its slice is unlocked AND every sequence-build node of that slice is placed — "no machine produces before you build it" | quest-commissioned engines ticking from tick 1 |
| F-12 | Quest evaluation (S0.3, SME): Level quests evaluate as a STRICT CHAIN (qN evaluable only after q(N−1) completes); "keep it clean" conditions (unload_blocked / upstream_blocked bands) measure over the SINCE-PREVIOUS-QUEST-COMPLETION cumulative window, never a single-tick snapshot | q2/q3/q4 passing trivially at tick ~5 before q1 |
| F-12a | Quest threshold retune (partial, 19.11): SME numbers applied where given — q1 arrived_t ≥ 3000 t (three 1,000 t ships), produced_t bands kept as-is ("keep as it is"); PARKED for end of Stage 0: q2 unload band ("small band" — number TBC), q3 starvation band, opt-challenge band, ship cadence (Yasser: 1 ship / 3–5 days vs current daily), EAF draw calibration vs ~180 t/tap | slice1 probe trace shows daily-arrival + 600 t/tick draw makes all bands freebies; cadence change is an ops-config decision, not quest JSON |

## Sim contracts carried forward (from frozen roadmap/specs — these stay LIVE)

| ID | Contract | Source |
|---|---|---|
| D-01 | Pure ticks: state-in → state-out; no hidden globals. RNG = xorshift32, one word stored INSIDE the state (`generator_state`/`prng_state`); canonical mapping `uniform(a,b) = a + (b-a)*draw`, `draw = state/0xFFFFFFFF` after one step — the ONLY mapping mirrors use | mirror/build_fixtures.py header; roadmap marks |
| D-02 | Per-tick ledger closure at tolerance 1e-6 t per accumulator (float accumulation error only); reporting gate prints balance to 4 decimals, gate < 0.01 t; JSON round-trip float comparisons keep abs diff < 0.01 | docs/foundations_definitions.md §C |
| D-03 | Quest-gated unlocks: equipment/capability unlock when a quest needs it; no construction-cost field enters sim contracts (economy lives in content/config + hub economics port) | roadmap 19.10 GAMEPLAY marks |
| D-04 | No irreversible campaign failure: quest failure explains and offers retry/adjustment/alternative; Bronze/Silver/Gold tiers; a poor result teaches | gameplay.md §4.2/§8 |
| D-05 | Canonical units: t / USD / tick = 1 in-game hour (day = 24 ticks); new JSON fields follow `<quantity>_<unit>` naming; existing engine fields NOT renamed (mapping table is the contract) | foundations_definitions.md §A |
| D-06 | Balance boundary per stage: Inputs = Products + By-products + Losses + ΔInventory; DRP yield_loss, EAF handling_loss + yield_loss separate; slag/dust live as losses until sustainability sells them | foundations_definitions.md §B |
| D-07 | `schema_version: 1` top-level on every content JSON and savegame; loader rejects unknown versions fail-fast, never silently defaults | foundations_definitions.md §D |
| D-08 | Revenue at dispatch outflow only (material actually sold); storage buffers must not hide the money problem | sim_loop_spec.md §2.6 |
| D-09 | Eight settled gameplay directions: plant-manager role; transport visible-not-micromanaged; simple charge-priority EAF scheduling; accept/select-only orders; simple-first billet yard; rare-signalled-recoverable breakdowns; feedback-first sustainability; no irreversible campaign loss | gameplay.md §8 (recorded roadmap 19.10) |
| D-10 | Content values are game-design placeholders flagged `sme_pending` unless SME-approved; no calibration loops; engineering figures = educational approximations from public industry sources, presented as ranges | roadmap content-JSON mark; README |

## Audit-derived entries (Qwen audits 1–2 — findings NOT yet verified by us; promote only after verification)
None promoted yet. Verification candidates tracked in PLAN_FORGED stage work
(clone-build → fixed at S0.1; commissioning fix = S0.3; persistence v2 = S0.5; GLB size
gate = F-06 chapter swaps).

## Stage gate records (measured, not remembered)
- **S1.3 (20.11) — hero swap #1 DRP + jetty:** per-hero budgets PASS (DRP 668 tris / 59 KB;
  jetty 1,730 tris / 126 KB; named pivots both). Scene gates: GLB download 77,341→16,466 KB;
  tris/frame 1,401,783→6,771; visible meshes 143 ≤ 150 (GL draws incl. shadow pass 232.6 —
  the ≤150 budget reads as VISIBLE/main-pass draws); headless SwiftShader fps 6→51; suite
  30 files / 234 tests; full-campaign smoke zero console errors. Evidence: docs/evidence/s13/.
  Conventions settled: heroes built at FINAL scene size (1 unit = 1 scene unit, scale 1 —
  no normalize-then-scale knob); Blender scripts use design Y-up coords via L()/S() converters;
  GLB min-y = 0 (both scenes seat models by bbox-min, anything below 0 floats the hero).
  Sensory gate: PASSED (Yasser "Perfect", 20.11) — S1.3 CLOSED.
- **S1.4 (20.11) — ore-yard mound fill:** yardMoundView pure projection (frac = yard_ore /
  MOUND_REF_T, clamped; height 0.25+2.15·frac, radius 0.8+1.4·frac; MOUND_REF_T = 5000 t is a
  PRESENTATION design value, SME calibrates at sensory gate — not a sim rule). +5 tests
  (suite 239). Live probe 20/20 sampled frames scale == projection, zero console errors.
  Evidence: docs/evidence/s14/. Sensory gate: PENDING Yasser. Stage 1 objective work complete.
- **S2.0 (20.11) — heat-phase enum contract:** `eaf.heat_phase` ∈ charge/melt/refine/tap|null +
  `eaf.phase_progress` 0..1, PURE DERIVATION from remaining_ticks/eaf_heat_ticks (bands
  charge [0,0.15) melt [0.15,0.70) refine [0.70,0.90) tap [0.90,1.0); sme_pending design bands
  shaped like a real heat). No new timing rules — tap fires exactly at remaining==0; events,
  counters, balance byte-identical (max raw 2.84e-14). Set unconditionally each tick so
  pre-S2.0 saves heal on first tick. Mirror P1-P3 + TS runPhaseTests pinned vs regenerated
  dump; suite 242. Drives S2.2 animation AND the Stage-6 cutaway cards (one contract).
- **S2.1 (20.11) — EAF hero swap #2:** procedural EAF 712 tris / 59 KB (adapts audit_2 A4
  structure: tilt pivot at vessel CG h1.85, swing-roof mast pivot, electrode triangle
  90/210/330°, trunnion ring, tap spout, ladle on car, transformer + bus bars). Old eaf.glb
  ×2 deleted (−3.2 MB); slice3 shares slice4's asset via relative URL. Convention added:
  merge_static_by_material at export (statics → 1 draw/material; pivot-parented + named
  runtime parts excluded) — visible meshes 141 ≤ 150. Readability lesson: electrode columns
  must extend well above the roof to read as a triangle; put camera-side furniture at +Z
  (home cam az 0). Sensory gate: PENDING Yasser.
- **S2.2 (20.11) — heat-cycle animation:** eafPoseView pure targets (shared, +10 tests) +
  EafHeatCycle renderer. SME non-negotiables verified live: roof swings SIDEWAYS about the
  mast on charge (electrodes ride it), bore-down on melt, heavy tilt ≤35° (1.1 s smoothing
  time constant — never snaps), stream gated on tilt+ladle position, sparks/smoke restrained,
  ladle glows + travels EAF→LF. Conventions settled: (a) pose projections take wall-clock
  frac + totalTicks — a 1-tick phase band has phase_progress≡0 and would never animate
  without sub-tick interpolation; paused holds frac=1 (end-of-tick pose, no oscillation);
  (b) rAF smoothing dt MUST come from performance.now clamped ≥0 — useRafLoop restarts on
  every parent re-render and resets its t, a loop-time delta goes negative and diverges the
  pose; (c) probes pause the HUD pump via the real pause BUTTON (direct speed assignment
  doesn't re-render → interval keeps running), and restart exhausted scripted scenarios via
  loop.resume(entry.module.fresh()). Stage 2 objective gates all green; sensory PENDING.
- **S3.1 (20.11) — handoffs #2/#3 (meltshop feed):** scrap edge rides slice1 dispatched_t Δ
  (yard outbound = scrap feed per the established topology; the ore belt already claims
  arrived_t Δ — no double-count), DRI edge rides slice3 discharged_t_total Δ (NEW additive
  monotonic counter, mirror-first, parity-safe). Edges: scrap 225 tph / 5 t chunk / 2 tick
  travel (150-300 tph SME band mid; 25 t chunk would exceed the 9.375 t/tick rate cap and
  never flow — caught by mirror N3), DRI 600 tph / 25 t / 2 tick. Boundary buffers real;
  interfaces join on EAF commission; owner-tagged (charge_id) consume at slice4 heat start;
  consume what exists, event the shortfall (S3.2 amber signal), never fabricate. Closure:
  usable + in_transit + consumed == deposits (1e-6). CONTRACT READING (flagged for Yasser):
  slice engines stay deterministic replay ports (S1.2 precedent — drp_intake accumulates
  alongside slice3's script); the feed ledger is the real cross-slice account; HARD
  production gating on feed stock is a later explicit rule change with updated tests.
  Fill levels: scrap bin (yard_stock_t/5000 ops cap), DRI tank (buffer_t/fixture capacity),
  EAF interface gauges (200 t presentation ref, sme_pending). Gates: mirror N1-N5, 60-tick
  three-engine parity, suite 259/32, gauges 12/12, restore byte-exact, tap-time meshes 150.
- **S3.2 (20.11) — state lights + amber rings:** presentation-only projection of EXISTING
  sim signals (no new sim rules): zone inspection tone + feed shortfall. State grammar per
  PLAN_FORGED §2: idle desaturated / running stream-green pulse / blocked-starved amber
  (#ffb347 palette). All 4 rings = ONE InstancedMesh draw (per-instance color/scale;
  unbuilt machines scale ~0) — draw-budget discipline held: smoke 3→2 quads, decorative
  DRI tank shell removed (fill-only gauge remains) → tap-time 149 ≤150. slice3 inspector
  now surfaces the existing skipped-heat signal as 'waiting' (last-heat projection,
  auto-recovery; card and ring read the SAME source). EAF amber = shortfall event this
  tick OR empty eaf_scrap interface (persistent, honest). Gate proven live: deliberate
  buffer starvation before scripted heat tick → SKIPPED event → DRP ring green→amber
  (screenshot-verified). Session API notes: builtNode(name) returns BOOLEAN; node IDs are
  'drp'/'eaf'/'cc'/'bar_mill' (commissioning.ts SLICE_BUILD_NODES); cardFor synthesizes
  zone slots {id:`${slice}.zone`, inspect_key} — no dri_buffer slot in factory_layout.
  Known pre-existing: LabelLayer chips/banners overlap at some camera angles (later pass).
- **S4.1 (20.11) — caster hero swap #3:** ccm_hero.glb 712 tris / 52 KB, 7 visible draws
  + 2 pivots (pivot_turret→turret_load joined arm+ladles+nozzle; pivot_mold→mold_unit
  joined block+flange; torch_head travels). Strand glow / billet rows = S4.2 renderer
  work, NOT permanent hero meshes. DRAW-BUDGET LAW (join_named added to hero lib):
  parts that always animate TOGETHER under one pivot are JOINED into one mesh — EAF
  perf re-export merged electrodes 3→1 (one shared bore value), arms 3→1, roof+cap,
  rim+spout (−6 draws, geometry identical, S2.2 pose probe green). CCM structural steel
  collapsed to one tone (steel_light) for −1 more. Tap-time 150 ≤150 exactly; idle 147.
  Old ccm.glb (1.6 MB ComfyUI soup, quantized single-node) deleted in BOTH scenes same
  commit; repo shrinks monotonically (F-06). heroParts added to __steelxRig hook for
  live pivot verification. Blender render_preview PNG silently missing on this host
  (GLB export fine) — in-game screenshots are the visual gate, don't chase the preview.
  sme_pending: curve radius, stand count, ladle sizes.
- **S4.2 (20.11) — cast chapter animations + billet fade:** pure projections over EXISTING
  slice4 signals (no sim changes): casterPoseView (turret 0/PI by ccm.busy_ladle_id, mold
  sin oscillation while casting, torch traverse), billetYardView (18 slots, 10 t/slot,
  48-tick cool window, 6-tick stagger — design values sme_pending), lastCastAgeTicks.
  KEY FACTS: slice4 state.events is PER-TICK (no history) → renderer ref remembers last
  cast-completion tick; ladle selection must be casting-ladle-FIRST (else the hero ladle
  represents the new empty charge and never travels to the caster). Per-instance emissive
  on InstancedMesh: onBeforeCompile multiply totalEmissiveRadiance by diffuseColor.rgb
  (already carries instanceColor) — robust, no varying-availability assumptions. Billet
  instancing freed 17 draws (18 statics → 1): tap-time 134. Gate proven tick-by-tick:
  charge→melt→tap→cast + ladle x>8.5 + heat gradient + fade. Stage 4 COMPLETE.

- **S5.1+S5.2 audit (21.11) — AUDIT OF 2 PASS:** REPORT-ID 1 closed as superseded by S5.1
  `0f56557` + S5.2 `04c7d91`. Auditor nits accepted for later: S5.5 relabels "Shipped from the
  mill" (counter is plant-wide dispatch via crane); REPORT-ID 3 must cover S5.3; i18n deferred
  (game-phase concern); no fullplant HUD shipment strip before S5.5 (F-07).
- **S5.3 scoping (awaiting Yasser sign-off):** reheat furnace folded INTO the rebar-mill hero
  (no separate layout slot); wire-rod hero deferred — V3 covers the rebar branch only (F-08).
- **S5.3b (21.11) — yard hero swaps #5/#6 + slice5 relight:** one shared `GantryYardHero`
  component replaces six inline yard constructs; both yards from ONE procedural script
  (`hero_gantry_yard.py`) with per-instance stock/truck node names. SME pass-2 fix law:
  scale the model ROOT and re-pin by hero CENTRE (yard hero geometry runs z=0..11.76 forward
  of its origin while layout pins sit at centre — `YARD_SCALE_H=1/3`, `YARD_CZ=5.88`).
  Slice5 lighting = fullplant golden-hour rig verbatim (warm sun 3.2, hemisphere fill, ACES
  tone mapping, shadows). R3F scene-graph extraction from devtools is not reliably reachable
  in production builds (no __r3f canvas handle; blob/data-URL imports CSP-blocked) — verify
  visual claims via mid-run screenshots + vision passes instead.
