# SteelX — STATE (the only session opener)

**Read this first. Plan from `docs/PLAN_FORGED.md` (THE active plan). Do not plan from
roadmap V3/V2 or old session prompts — those are frozen history.**

## What this project is
Browser-based DRI-EAF steel plant tycoon + digital-twin process simulator (fun + learning).
React + Three.js + TypeScript frontend, deterministic tick-based sim engines. Python mirror
implementations of every slice with parity tests against the TS ports. Mobile app is the
end goal; desktop/browser for now. No-rush iterative cadence, one Go-gated micro-step at a time.

## People
- **Yasser** — SME and owner. 16 years steel-mill operations/engineering (DRP, rolling mills,
  ISO 9001/14001/45001, CMMS/TPM). Technical authority on steelmaking: his domain corrections
  are ground truth. Own numbers must come from industry sources (worldsteel, GAST, vendor refs)
  and be presented as plausible ranges, never invented precision.
- **Hermes agent** — execution. One micro-step per Go; never anticipate the next step; stop
  after the requested output and wait for "Go".

## Repo & remote
- Local: `C:\AI_LAB\SteelX` (branch `master` tracks origin).
- GitHub: `leeblaab/steel-tycoon` — **PUBLIC during the audit window**; flip private after:
  `gh repo edit leeblaab/steel-tycoon --visibility private`.
- Slim orphan history on remote (~60 MB). Full old history = local-only branch `master-legacy`.
- On disk but untracked by design: `assets_incoming/`, `godot/`, `docs/archive/`, and the CC0
  vendor model kits under `content/_vendor/cc0/` (hash manifest + inventory tracked in git instead).

## Current position (FORGED plan)
- **S0.1 DONE** — `content/` published in git (F-02): game JSON, cards, icons tracked; 160 MB
  CC0 kits out of git with manifest.
- **S0.2 DONE** — docs reset: STATE.md + DECISIONS.md, README corrected, license split
  (Apache-2.0 code / CC BY-SA 4.0 content / THIRD_PARTY), `npm test` made real.
- **S0.3 CLOSED** — engine gate (`engineRunning()`) + F-12 quest contract: STRICT CHAIN +
  windowed since-completion deltas for cumulative fields (`quest_tracker.ts`, tests in
  `quest_windowing.test.ts`), q1 retuned to arrived_t>=3000 (Yasser's number). Commits
  `52bda26`→`825a949`. Parked to end of Stage 0: q2/q3/opt bands, ship cadence (3–5 days),
  EAF draw vs 180 t/tap.
- **S0.4 DONE (gated by Yasser 2026-11-19: "rest looks good enough" + one specific fix)** — relight committed (`c697fc7` WIP, `81bc671` bisect session: dev
  rig-override URL params + `__steelxRig` hook, dead probe scripts deleted, A/B evidence in
  `docs/evidence/s04_ab/`). Dark-scene suspects fog + ACES tone mapping DISPROVEN by A/B
  bisect — relight v2 already fixed brightness at pixel level (mean RGB 26–38 → 55–61,
  near-black 38–66% → 7–16%). Perf caveat: headless draw/tri growth vs `perf_before.json`
  comes from slices 3–5 geometry now building in the guided flow, not a relight regression.
  Waiting on Yasser's sensory verdict before marking S0.4 DONE. **Verdict received**
  ("layout much improved, rest looks good enough") + one specific fix shipped: duplicate
  EAF ghost in slice-3 zone removed (`c45cffe`) — the single EAF lives in the meltshop;
  root cause was `Slice3` gating on the shared `'eaf'` node_id. A/B re-shot confirms
  exactly one EAF (eaffix_* evidence). S0.4 CLOSED pending final bookkeeping below.
- **S0.5 CLOSED** — persistence v2 (`371f09d`): save schema v2 (slices map + onboarding
  block, strict validation), autosave every 32 ticks + visibilitychange, boot `tryRestore()`,
  unlock re-derivation.
- **STAGE 0 CLOSED — SME tuning pass settled (Yasser via Qwen, 19.11):** q2 = ONE tap
  (`produced_t >= 180` if liquid steel; ~150 if cast product); q3 = shipment event + one-load
  proving quantity (~30–50 t), time window only as Bronze/Silver/Gold modifier, never hard
  fail in Level 1; optionals in Level 1 = gentle behavior nudges (starved ticks / idle /
  queue), ratio metrics shown on cards but NOT gated until Level 4–5; ship cadence 3–5 days
  OK for coastal feed (~10–20 kt parcels) — cargo size tied to cadence, randomized within
  band via seeded xorshift32 mirror-first, FIRST arrival pinned early/fixed for the tutorial;
  EAF tap size confirmed 180 t — draw bands ~380–450 kWh/t scrap-dominant, ~500–600 DRI-heavy
  (~70–110 MWh/tap), tap-to-tap 50–60 min (power-on 40–50), transformer ~100–140 MVA, curve
  bore-in→peak→taper; correct mirror ONLY if wildly off (<300/>700 kWh/t or <35/>90 min).
  Tuning is a content pass folded into Stage 1+ — does not stall the spine.
- Vendor-kit gate CHECKED (19.11): every GLB the fullplant scene references lives in git under
  `web/src/ports/*/browser/assets/` (jetty/drp/feed/eaf/lrf/ccm/rebar_mill all tracked);
  `content/_vendor/cc0/` is referenced by ZERO code — unused source packs only. Fresh-clone gate holds.
- **Stage 1 — Chapter 1: The Ore Belt** per PLAN_FORGED, in progress:
  - **S1.1 DONE** (`f5367c9` mirror + `8770312` TS port): registry_handoff primitives
    (transfer/reserve/release + in_transit ledger with arrival_tick, earmark lifecycle,
    closure 1e-6) — Python mirror ALL PASS incl. negatives; parity test pinned vs dump.
  - **S1.2 DONE** (`c8b3c92` core + `c4e39f3` integration, pushed): belt is a real transfer
    edge (yard→ore_buffer→drp_intake) riding GameSession (build→tick→save/restore).
  - **S1.2 visual layer DONE** (`38aca98`, pushed): OreBelt instanced tokens riding
    GameSession; live-browser verified (token count == min(ledger,48) every sampled frame).
  - **S1.3 CLOSED** (sensory verdict PASSED — Yasser "Perfect", 20.11; F-09 no reopening)
    — hero swap #1 per F-06: procedural DRP shaft (`tools/blender/drp_shaft.py`, 668 tris / 59 KB) +
    jetty rebuild (procedural pier + Kenney crane/ship kitbash, 1,730 tris / 126 KB),
    both built at FINAL scene size (scale 1, named pivots). Old `drp.glb` (20.8 MB) +
    `jetty.glb` (21.0 MB) DELETED in the same commit; all three consumers re-pointed
    (fullplant + slice1 + slice3). Gates measured: suite 30/234, all 3 ports build,
    full-campaign smoke zero console errors, GLB download 77.3→16.5 MB, tris/frame
    1.40M→6.8k, visible meshes 143 (≤150), headless fps 6→51. Evidence: `docs/evidence/s13/`.
  - **S1.4 DONE (code + objective gates; SME sensory verdict PENDING)** — ore-yard mound
    fill: `yardMoundView` pure projection (shared/ore_belt.ts, MOUND_REF_T = 5000 t design
    value), rAF-driven cone mound in the raw yard (scale = yard_ore ledger tonnage), static
    scrap bin + stacker boom (scrap is truck-fed, only ore rides the belt). +5 projection
    tests. Live probe: mound scale == projection on all 20 sampled frames while the plant
    ticks, zero console errors (`docs/evidence/s14/`). **Stage 1 objective work complete.**
  - NEXT: **Stage 2 — The Heat**: S2.0 heat-phase enum (mirror-first) → S2.1 EAF hero swap
    → S2.2 heat-cycle animation (SME non-negotiables in PLAN_FORGED S2.2).
  - **S2.0 DONE** — heat-phase enum (`charge/melt/refine/tap` + `phase_progress`) added
    mirror-first to `slice4_mirror.py` + 1:1 TS port: PURE DERIVATION from the existing
    countdown (bands 15/55/20/10%, sme_pending design values) — tap timing, events,
    counters, balance UNCHANGED (max raw balance 2.84e-14 identical). Mirror P1-P3 phase
    contract tests PASS; parity dump regenerated; +3 parity tests (suite 30 files / 242).
  - **S2.1 DONE (code + objective gates; SME sensory verdict PENDING)** — hero swap #2:
    procedural EAF (`tools/blender/eaf_hero.py`, 712 tris / 59 KB; pivots pivot_vessel /
    pivot_roof, electrode_a/b/c, ladle/ladle_car/ladle_bath, tap_spout, state_light).
    Old `eaf.glb` ×2 DELETED same commit (−3.2 MB); fullplant + slice3 + slice4 re-pointed
    (slice3 shares slice4's asset). NEW CONVENTION: `merge_static_by_material` at export —
    statics join to 1 draw/material, pivot/animatable parts stay named (visible meshes
    173→141 ≤ 150 after the EAF's 30 parts blew the budget). Suite green, 3 ports build,
    campaign smoke 0 errors. Evidence: `docs/evidence/s21/`.
  - **S2.2 DONE (code + objective gates; SME sensory verdict PENDING)** — heat-cycle
    animation driven by the S2.0 enum: `shared/eaf_heat_pose.ts` pure pose targets (+10
    tests) + `EafHeatCycle` renderer (roof swings SIDEWAYS on charge, electrodes bore on
    melt, heavy ~35° tilt on tap with 1.1 s smoothing, fat incandescent stream + near-white
    core, restrained sparks, smoke, ladle glows + travels to LF). Sub-tick wall-clock frac
    interpolation (1-tick tap band would otherwise never animate); paused = hold pose.
    Live probe timeline verified ALL phases (roof 69°, tilt 26.8°→35°, stream gated, ladle
    2.15→4.54→LF glow 1.79); 148 meshes ≤150; 0 console errors; suite 31 files / 252.
    Evidence: `docs/evidence/s22/`. **STAGE 2 objective work complete.**
  - NEXT: **Stage 3 — The Route**: S3.1 handoffs #2/#3 (scrap yard→EAF, DRI stockpile→EAF;
    mirror-first registry transfers + fill levels on all yards/buffers) → S3.2 state lights
    + amber rings wired to existing `starved`/`wait` events. Sensory verdicts pending for
    S1.4, S2.1, S2.2 (Yasser AFK during the batch; play and judge on return).

## The game as it plays today
Fullplant app (`web/src/ports/fullplant`, dev port 5178 via `start_digital_twin_v2.bat` —
detached vite servers, logs `twin_<port>.log`). Onboarding quest chain at top of right pane:
step 1 Welcome → 2 Jetty & Ship Cadence → 3 Scrap Grades → 4 Ore Belt — Port to Plant.
Five slice sims complete (slice1 berth/jetty, slice2 yards+DRP supply, slice3 DRP, slice4
EAF/LF/CCM, slice5 mills); each is a pure tick engine with a Python mirror + parity tests.

## Hard rules (violations have burned us before)
- **Loop discipline:** before ANY tool call, check the identical call hasn't already returned
  this turn. If yes — answer from what's in hand and stop.
- Mirror-first: sim logic is proven in a Python mirror, then ported to TS with parity tests.
- Deterministic test failures are not flaky — diagnose from the failure in hand.
- Engine slice IDs (`slice1..5`, catalog entries, quest mapping) never get renamed for
  presentation reasons; "Chapter" is presentation-only naming.
- Closed stage gates never reopen (anti-polish rule, F-09).
- Unknown values are asked, never invented.

## Verified facts (measured, not remembered — re-measure if in doubt)
- Test suite: `cd web && npx vitest run --root .` → **31 files / 252 tests green** (re-measured
  20.11 at S2.2; +10 heat-pose projection tests).
- Fresh-clone gate passed at S0.1 (stranger's clone builds and plays step 1).
- Remote master head: S1.3 hero-swap commit (20.11) — in sync after push; `git log -1` for hash.
- S1.3 perf (headless SwiftShader, relative deltas only): GLB download 16.5 MB, tris/frame 6.8k,
  visible meshes 143, fps 51. Baseline + after JSONs in `docs/evidence/s13/`.

## Key docs
| Doc | Role |
|---|---|
| `docs/PLAN_FORGED.md` | THE active plan (stages, gates, visual spec, F-decisions) |
| `STATE.md` | this file — session opener only |
| `DECISIONS.md` | settled decisions ledger (F-01…F-10 + audit-derived) |
| `docs/gameplay.md`, `docs/economy_spec.md`, `docs/sim_loop_spec.md`, `docs/foundations_definitions.md` | live contracts/specs |
| `docs/audit_1_architecture_qwen.md`, `docs/audit_2_visuals_qwen.md` | external audit evidence (findings not all verified) |
| `docs/Raodmap V3.md`, `RoadMap_V2.md`, old session prompts | FROZEN history — never plan from these |
