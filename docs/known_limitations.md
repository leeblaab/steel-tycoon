# SteelX — Known Limitations (as of 2026-10-12)

## Berth tests — DEFERRED again (fresh-process run 2026-10-12, Phase 3 session; Yasser decision (b))

**Status:** Fresh-process run of the mirror as it stands on disk: 29 PASS / 3 FAIL. The three FAILs are the recorded berth test-construction checks (berth→yard block, berth capacity, berth identity). The earlier "RESOLVED (32/32)" entry was superseded: the current on-disk helper does not reproduce those PASS results. Yasser decision (b): document as deferred, move to Phase 3 — no patch, no re-run, no weakened assertion.

**Re-run under the TS cadence (tested, not assumed):** the TS port reproduces the cadence boundary exactly (`web/src/ops_domain3.ts`: `day += 1` before all stages, arrivals on `day % 24 == 0`), and the mirror's `tick_ops` already increments day before the berth stages — so the mirror berth tests ARE the TS-cadence run. Re-running did not resolve them. The fault is helper construction, not the cadence boundary.

**Root cause (trace-proven, test construction only — production berth logic untouched):**
1. The `berth_only` isolation flag is consumed at the top of `tick_ops` BEFORE the berth stages run, so the drain-skip `elif` is never reached: the dispatch stage drains the yard-full pre-fill every tick (yard 4920 instead of 5000), so the berth→yard block never fires in the isolated tests. `tick_berth()` re-arms the flag after the consume point, but the consume happens before the berth stages, so the re-arm lands after the drain — the pre-fill never survives to the block assertion.
2. The helper contradicts the berth accounting contract: the identity scenario must start with the yard at ZERO (a pre-fill inherited from the block test contaminates the identity), while the block test needs the yard FULL. One helper cannot serve both; the block and identity checks must be separate constructions.
3. Corrected-construction probe (documented, NOT applied per decision (b)): yard zero + drain skipped + berth-only dispatch cap 0 + assertions at ticks where no day-tick lands (47, 71) — second-arrival-refused leg PASS, double-count negative control PASS, block and identity legs still FAIL (blocked 0 vs expected 958.3333). Two independent construction defects remain open.

**Berth RULE itself is correct:** baseline reconciles fully (7 arrivals, 6 departures, 1 ship at berth, 7 ship-days, identity intact), FIFO green, demurrage free-time and billing legs green, cadence green, double-count negative control genuinely detects. Fixture record: `fixtures/operations_domain3/d3_berth_tests_as_recorded_seed11_72.json` (status `deferred_test_construction`, exact expected-vs-actual pinned).

**Do not re-investigate or re-run** unless a later change makes it necessary or new evidence reveals a genuine production defect. Phase 3 berth model must reproduce the cadence boundary exactly; the deferred tests are re-run under the TS cadence once the TS berth model exists — test it, don't assume.

## Domain 4 negative controls — RESOLVED (N1 PASS, N6 PASS, 2026-10-12)

**N1 (PASS):** The earlier −44.0 vs −80.0 divergence was a construction defect: the injection added `byproduct_tons/10` each tick — the CUMULATIVE slag, producing a triangular accumulation — instead of the tick's own contribution. Rule-derived expectation: slag participates on eaf+drp only (2 assets × 0.040 × 100 t = 8.0 t/tick × 10 ticks = 80.0 t). Corrected injection double-counts exactly the tick's contribution; fresh-process run: exact error −80.0000000000 t, matches the rule-derived expectation; healthy run error 0.0000000000 t.

**N6 (PASS):** The threshold was unreachable under the old construction because the gate measures the PLANT AVERAGE over all six assets: eaf 0.80 + drp 1.30 diluted by cc/bar_mill/wire_rod/crane small intensities → avg 0.375 < 0.60, so the healthy rule correctly flagged green. Rebuilt within the config's own validation ranges (eaf 0.80, drp 1.30, cc/bar_mill/wire_rod/crane 0.60) → avg 0.7662 ≥ 0.60: no flag/premium/REC, penalty paid; broken variant diverges as intended. Fresh-process run: PASS.

**Production logic unchanged in both cases; no assertion weakened.**

## Domain 2 — calibration placeholders

Order book late penalty %, QC haircut %, utilities split, sales-index band are Hermes-recommended demo values flagged `sme_pending` (Yasser decision 2026-10-11: recommended values accepted, editable later; no stalling over calibration).

## Domain 3 parity — berth material-identity test — DEFERRED (2026-10-12, Stage 5)

**Status:** DEFERRED as test construction. Engine berth logic untouched; no assertion weakened. The other 23 parity checks PASS in a fresh process (exit code 1, `=== 1 failure(s) ===`).

**Correction applied (Yasser GO, 2026-10-12):** the identity scenario now runs on its own construction — independent `FixedDraws` provider sized to its own tick count (432 draws = 72 ticks × 6 assets; the shared 360-draw provider was exhausted mid-run at tick 60), yard initialized to zero for the identity, and the berth-blocking/cargo-status assertions kept as separate checks over their own pre-filled construction.

**Evidence that the correction is not sufficient — the identity FORM is cadence-dependent:**
- Mirror cadence: `day += 1` AFTER the berth stages, so the mirror's day-tick lands at tick 24; its 9c assertion at tick 48 sees `berth_blocked_t == 0` (first refused arrival lands at tick 48, after the assertion) → identity balances: accepted 2000 − blocked 0 − unload-blocked 0 = onboard 958.33 + yard 1041.67.
- Engine cadence: `day += 1` BEFORE the berth stages, so the engine's day-tick lands at tick 48; the first refused arrival lands ON the assertion tick (`berth_blocked_t == 1`). The identity form subtracts `berth_blocked_cargo` for a ship that never entered the berth — LHS `1000 − 1000 − 0 = 0` vs RHS `onboard 1000 + yard 0 = 1000`. Fails at tick 48 and at tick 72 (`1000 − 2000 = −1000` vs `1000 + 0`).
- The negative control (double-counting one ship's cargo) genuinely breaks the identity — detection is real; the fault is the assertion measuring over a boundary the engine's cadence does not expose.

**Classification:** test-construction limitation, not an engine defect. The mirror is the source of truth for the identity rule; the parity harness asserts at a different day-tick boundary. A correct engine-side form must measure cargo ACCEPTED INTO THE BERTH (ships_arrived × ship_cargo_t, refused arrivals tracked separately and never subtracted), or assert at a tick where `berth_blocked_t == 0` — either change alters the assertion shape and requires Yasser's GO. Not applied; recorded here.

**Do not re-investigate or re-run** unless a later change makes it necessary or new evidence reveals a genuine production defect.

## Stage 5 acceptance harness — berth in-transit cargo — DEFERRED (2026-10-12, Stage 5)

**Status:** DEFERRED as test construction. Engine berth logic untouched; no assertion weakened. The Stage 5 cross-domain acceptance run (`mirror/stage5_acceptance.py`, fresh process, exit code 1) passes 17/18 checks; the single failure is the berth identity check.

**Evidence (single probe, seed 101, 120 ticks):** accepted 5000 t (5 arrivals × 1000) vs departed 4000 t (4 departures) + on-board 958.3333 t + credited-to-yard 41.6667 t = 5000 t — identity closes exactly once the per-ship credited term is included. The 41.67 t gap was the missing per-ship credited term for the ship at berth (S5: 1000 − 958.3333 = 41.6667 t), NOT in-transit cargo: the mirror credits the berth transfer to the yard at the SAME tick the cargo leaves the ship (tick_ops berth branch, `yard_stock_t += accepted_t`), so no cargo sits between berth and yard at the snapshot. The mirror's own yard identity (`arrived = dispatched + yard`) passes cleanly alongside it — no double count exists; the harness form omitted the berth ship's credited term.

**Resolution (Yasser GO, 2026-10-12):** the integrated assertion was corrected to the per-ship partition — `accepted = departed + Σ_ship (credited_ship + on_board_ship)`, with `credited_ship = SHIP_CARGO_T − on_board_ship` valid only under the verified zero-blocked condition (asserted as a scenario precondition), and departed ships' cargo accounted once (DEPART fires only when on_board reaches 0, so their full cargo was already credited before departure and must not be added again). Fresh-process run: 0 failures; negative control (double-crediting the berth ship's transfer) still detects the intended violation. Test-only change; no engine or mirror logic modified.

**Do not re-investigate or re-run** unless a later change makes it necessary or new evidence reveals a genuine production defect.
