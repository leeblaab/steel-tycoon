# Phase 0 Audit — Task C: S3/S4/S5 browser `sim.ts` vs Python mirrors

Date: 2026-10-19 · Method: **source inspection only** (no TS tests written or run). Files compared line-by-line:

| Slice | Browser sim | Python mirror | Lines |
|---|---|---|---|
| S3 | `web/src/ports/slice3/browser/sim.ts` | `mirror/slice3_mirror.py` | 388 / 280 |
| S4 | `web/src/ports/slice4/browser/sim.ts` | `mirror/slice4_mirror.py` | 427 / 403 |
| S5 | `web/src/ports/slice5/browser/sim.ts` | `mirror/slice5_mirror.py` | 386 / 373 |

Reference pattern: S1 (`slice1_berth_yard.ts` + `parity_slice1.test.ts`). Roadmap §8.1 mark (19.10): **the Python mirror is the parity source**; a diverged TS sim is corrected or replaced by an S1-pattern parity port. S2 browser scene is interpolation-only from fixtures — out of scope here.

Cross-import check: none of the three sims import the shared domain ports (`web/src/ports/economics|operations|production_core`); each is self-contained per §2.1 (slice-owned logic). Only S3 imports shared code — `xorshift32Next` from `web/src/prng.ts`, which is spec-identical to `mirror/xorshift32_check.py` (same shifts 13/17/5, draw = state / 0xFFFFFFFF, zero-state rejected in both). S4 and S5 have no RNG in the rule path (scripted), matching their mirrors.

---

## S3 — DRP → DRI buffer → EAF heat plan

**Verdict: (a) faithful port — keep with a fresh parity test.** The file header claims a line-by-line port and the body substantiates it.

Rule-level comparison (all match):
- RNG: `xorshift32Next` shared module vs Python `xorshift32_next`; trip gate `if draw < p_trip`, seed advanced on every tick of an active trip — identical consumption sequence.
- Tick stage order DRP supply → EAF heat plan → buffer thresholds; FIFO lot take (`lots.sort(key=arrival_tick)` ≡ `sorted(lots, key=l["arrival_tick"])`), epsilon 1e-9 draw rule in both.
- Trip gate: only ticks with `drp_running` roll the die; `end = tick + trip_duration - 1`; events `TRIP fires at {tick}` / `TRIP ends at {tick+1}` — identical strings.
- Starve/fill thresholds (`<`, `>=`) and event vocabulary `'FILL state'` / `'STARVE risk'`; refusal cause `'refused'→blocked`, `'SKIPPED'→starved`; `failure_cause` attribution `plan_overdraw` vs `buffer_starved` — identical.
- Balance residual formula (`entered - dri_buffer_t - charged_t_total`) identical; win = `heats_completed >= 3`.
- Embedded fixture values match `fixtures/slice3/s3_dri_buffer_scenario_seed11_120.json` expected_outputs (fill/blocked/starve/trip tick lists, H30/H50/H80 skipped with `buffer_starved`, win false).

Divergences found:
- **Structural only**: Python keeps the generator state inside sim state (`st["rng_state"]`, per §12.1); TS carries a separate mutable `PrngState` object and clones tick input/output state. Semantics equal for linear runs, but this is exactly the seam a parity test must pin before S3 joins a shared authoritative tick loop (§8.1).
- No divergence in any transfer, deadline, or refusal rule was found.

Risk if kept: low. The header's "line-by-line port" claim is unverified by any test runner today — a fresh S1-pattern parity test is cheap and sufficient.

## S4 — EAF → LRF → CCM ladle cycle

**Verdict: (a) faithful on rules, with four data/representation divergences to fix — keep the TS sim, port from Python only if the fixes balloon.**

Matching core logic (verified line-by-line):
- Stage order deliveries → indicators → EAF → LRF → CCM (completion → handoff → wait) → balance, including the N3 same-tick-handoff fix and the bath-as-residence-term material-balance correction (`entered - ladle_in_eaf - ladle_in_lrf - ccm_active - billet_yard_t` in both).
- Gated tapping: heat starts only when `ladles_free > 0 && charge_ready` (the Yasser 15.10 decision); starve accounting per tick; energy charged at tap (`SEC × charge_t`).
- Ladle cycle state machine, FIFO delivery sort by deadline, expiry rule, maintenance/shift event strings — identical vocabulary.
- Embedded `EXPECTED_OUTPUTS` match the fixture: heat_starts [1,12,24,36,48], taps [11,…58], casts [19,…66], 5 heats / 65 starved / 120000 kWh / 186.935 t billet; `caster_wait_ticks == 0` assertion honored in both.

Divergences found (named):
1. **Yield source**: Python `load_scrap_tiers()` reads `content/scrap/scrap_tiers.json` at runtime; TS hardcodes `YIELD = {hms1_hms2:5.0, bushing:3.0, shredded:8.0}`. Values currently identical to the JSON — but content is Yasser-calibrated and will change; TS silently drifts. Fix: import/embed the same JSON (S1 already imports `ops_config.js`).
2. **Missing ledger**: Python keeps `dri_materials` with a per-item `consumed_t` field; TS consumes DRI by scalar amount only — no DRI material lineage in state or snapshot output. Contract-wise (`contracts.dri_charge_material`) the TS state under-reports what the mirror exposes.
3. **State shape**: Python EAF state carries explicit `bath_t`; TS drops it and reconstructs bath as `charge_ready ? total : 0`. Observationally equal today; representationally diverged for a shared inventory registry (§8.1).
4. **Negative-control modeling**: fixture control `ladle_never_released` is implemented in Python as `ccm_ticks_per_ladle = 10**6`; TS models it as "never release ladle" (`if (!variant)`), and the double-count control injects a phantom 1 t entry — both flagged `[OPEN QUESTION]` in the TS header. Control semantics differ from the mirror's knob-based approach.

Risk if kept: medium — drift risk on yields, and the snapshot omits contract fields Phase 2 UI/SME review will want.

## S5 — Billet yard → carrier → rebar mill → product yard → dispatch orders

**Verdict: (b) diverged enough that a parity port from the Python mirror is cheaper/safer.** The happy-path rules match, but the TS sim is structurally incomplete in ways a test alone cannot close.

Matching core logic:
- Stage order deadlines → competing task → carrier → mill → dispatch enqueue → crane FIFO (priority then enqueue tick) — identical; lazy dispatch rule (`batch = min(stock, batch_t_per_move)` at completion, Option A canonical) present in both; revenue on outflow at `PRICE_MID_B500B = 635.0`; order completion/late vocabulary identical.
- Embedded fixture values match `s5_...seed11_120.json` (carrier starts 1,6,…46; roll completions 11,…74; O1@35, O2@63, O3 partial 19.6 t).

Divergences found (named):
1. **Missing test seams**: Python exposes `double_count` and `max_dispatch_moves` in `SimConfig`; the mirror's re-enqueue is gated by `if st["dispatch_moves"] < max_dispatch_moves`. TS has neither — it re-enqueues unconditionally, so the fixture's `double_count_control` (residual > 1.0) cannot be reproduced from the TS sim at all.
2. **No scenario validation**: Python `validate_scenario()` enforces contract invariants (batch sizes positive, capacities ≥ batch, order grades known); TS has no equivalent — bad configs fail silently instead of raising.
3. **Uncounted visual payloads**: TS adds scene-only state `carrier_transit_t` / `mill_in_process_t` that the mirror's balance identity does not count; the TS balance stage compensates by subtracting `carrier.batch_t`/`mill.batch_t` on completion ticks, producing mid-run residuals up to 100.0 (flagged `[OPEN QUESTION 2]` in its own header). The mirror has no such fields — a shared-registry sim cannot carry uncounted tonnage (§8.1: "must not maintain independent copies of production inventory").
4. **Fixture coverage**: TS verifies only `order_completions`, `dispatched_t_total`, `win`; Python asserts the full event vocabulary (blocked-empty counts, key-tick snapshots incl. `mill_in_process_t` mirror value, competing-task ordering).

Risk if kept: high — the uncounted-payload hack is precisely the divergence class §8.1 exists to eliminate; fixing it means rewriting the balance stage anyway, so a port from the mirror is the cheaper path.

---

## Recommended Phase 1 consolidation backlog (ordered)

1. **S5 parity port first** (verdict b): create `web/src/ports/slice5/slice5_flow.ts` as a line-by-line port of `mirror/slice5_mirror.py` (S1 pattern), with `parity_slice5.test.ts` asserting the full fixture expected_outputs incl. blocked-empty counts, key ticks 43/72/120, and both negative controls (`double_count`, `max_dispatch_moves`). Scene then consumes the port; scene-only animation state moves to presentation state, never sim state.
2. **S4 parity test + three fixes** (verdict a): build `parity_slice4.test.ts` against the fixture first (it should pass today on event ticks/counters), then fix: yield source → `content/scrap/scrap_tiers.json`; add `dri_materials` ledger with `consumed_t`; restore explicit `bath_t`; align negative-control knobs (`ccm_ticks_per_ladle = 10**6`) with the mirror. Re-run parity after each fix.
3. **S3 parity test** (verdict a, cheapest): build `parity_slice3.test.ts` against `s3_dri_buffer_scenario_seed11_120.json` + both negative scenarios; then move rng state into sim state (`rng_state` field) to match the mirror's §12.1 contract before S3 joins the shared tick loop.
4. **Shared registry onboarding**: with per-slice parity ports green, wire the three slices behind one authoritative tick loop and shared inventory registry (§8.1 agreed approach); the fixture JSONs become the acceptance suite for each slice port.

Ordering rationale: S5 is the only structural rewrite; doing it first converts the riskiest divergence into the proven S1 pattern and gives Phase 1 a second worked example before touching the two faithful ports, which need only tests plus small fixes.

## Caveats
- Inspection-only: no TS was compiled or executed, so "fixture values match" means the embedded scenario/expected constants were compared to the fixture JSONs by reading, not by running `verifyAgainstExpected`/`compareFixture`.
- S1's browser sim (`slice1/browser/sim.ts`, 146 lines) imports `ops_domain3.js`/`ops_config.js` from `operations/`; none of S3–S5 do — consolidation should decide whether slice-owned sims may import shared domain ports or only their own fixtures/config.
