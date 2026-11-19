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
- Next: **S0.5** persistence v2 (quest window fields in save) once S0.4 gate passes →
  then Stage 1 (Chapter 1: The Ore Belt). Remote push pending (8 commits unpushed as of 560c797; Wi-Fi off).

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
- Test suite: `cd web && npx vitest run --root .` → **25 files / 195 tests green** (S0.4 WIP, 11.19).
- Fresh-clone gate passed at S0.1 (stranger's clone builds and plays step 1).
- Remote master head: `1c37f6c` — local is 3 commits ahead (`52bda26`, `825a949`, `c697fc7`), push when network allows.

## Key docs
| Doc | Role |
|---|---|
| `docs/PLAN_FORGED.md` | THE active plan (stages, gates, visual spec, F-decisions) |
| `STATE.md` | this file — session opener only |
| `DECISIONS.md` | settled decisions ledger (F-01…F-10 + audit-derived) |
| `docs/gameplay.md`, `docs/economy_spec.md`, `docs/sim_loop_spec.md`, `docs/foundations_definitions.md` | live contracts/specs |
| `docs/audit_1_architecture_qwen.md`, `docs/audit_2_visuals_qwen.md` | external audit evidence (findings not all verified) |
| `docs/Raodmap V3.md`, `RoadMap_V2.md`, old session prompts | FROZEN history — never plan from these |
