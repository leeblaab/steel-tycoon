# Domain 3 (ops/logistics) TS port — verification report

Scope: read-only verification of `web/src/ports/operations/` ownership; no files outside this directory were modified. Target under test: `web/src/ops_domain3.ts` (commit f91b94d), `web/src/prng.ts`, `web/tests/parity_ops.test.ts`, `web/tests/gate0.test.ts`, mirror `mirror/operations_domain3_mirror.py`, fixture `fixtures/operations_domain3/d3_ops_baseline_seed7_180.json`.

## 1. Fresh vitest run (acceptance gate)

`npx vitest run` from `C:/AI_Lab/SteelX/web`, fresh process, 2026-10-12:

```
 RUN  v5.0.4 C:/AI_LAB/SteelX/web
 Test Files  2 passed (2)
      Tests  7 passed (7)
   Duration  104ms
```

7/7 PASS as expected: fixture schema contract, fixture D3 parity, pure-tick non-mutation, sandbox isolation, draw-contract probe, gate #0 canonical xorshift32 vector, zero-seed guard.

## 2. Per-contract check results (TS tick vs Python mirror)

| Contract | Result | Evidence |
|---|---|---|
| Tick order | PASS | `tickOps` executes wages → per-asset draws/breakdowns → planned shutdown → production → crane KPI → berth arrive → berth wait → berth unload/depart → dispatch chain (lines 172–257), identical stage order to mirror `tick_ops` (lines 242–372). Fixture `tick_order` field lists the same sequence. |
| Cadence boundary (day += 1 BEFORE berth stages; arrivals on `day % 24 == 0`) | PASS | TS line 172 increments day before all stages; line 213 gates arrivals on `day % 24 == 0`. Independent Python replay under the TS/engine cadence reproduces the fixture exactly; the alternative boundary (day += 1 after berth stages) diverges (wages 2790000 vs 2799000, ships_departed 7 vs 6, berth_blocked_t 1.0 vs 0.0, wait_ship_days 6.9583 vs 6.5417) — so the fixture is pinned to the engine cadence and the TS reproduces it, not "fixed". |
| Draw contract (6 draws/tick, fixed order `['eaf','drp','cc','bar_mill','wire_rod_mill','crane']`, draws consumed for down assets too, injection still draws) | PASS | TS lines 178–197: `draw()` runs unconditionally per asset in `ASSET_ORDER` before the down-branch `continue`; injection (`fires = true`, line 182) fires after the draw is consumed. Config asset order is validated against `ASSET_ORDER` at load (line 88, reject on mismatch). Independent replay consumed 180 × 6 = 1080 draws and landed on generator_state 1250607942 = fixture value. |
| Pure state-in / state-out | PASS | `tickOps` clones input via `structuredClone` (line 169) and mutates only the clone; vitest 'pure tick: input state never mutated' green; `sandboxRun` asserts real state unchanged after hypothetical ticks (lines 264–271), vitest sandbox test green. |
| Generator state inside state | PASS | `generator_state` is a field of `OpsState` (line 22), advanced inside the tick (lines 179–180), not a seed+index; matches the Phase2_UI_Plan §2.2 contract. |
| Zero-seed guard | PASS | `freshState` throws on seed 0 (line 129); `draw()` throws if zero state is reached (line 149); `prngInit` throws on 0 (prng.ts line 11); gate0 'zero-seed guard rejects' green. |
| Reject-never-default config validation | PASS (with documented divergences, §4) | `loadOpsConfig` throws named errors on schema_version ≠ 1, missing top-level fields, missing asset/container fields, non-positive numbers, non-integer `berth_capacity`/`arrival_ships_per_day`/`congestion_ticks`, band multiplier outside (0,1], and asset-order mismatch. No silent defaults anywhere; live content file validates clean (both sides read the same JSON). |
| xorshift32 spec byte-identical | PASS | TS `draw()`/`xorshift32Next` masks each step to uint32 (`>>> 0`) exactly as the Python `& 0xFFFFFFFF` spec; gate #0 vector reproduces (6.295018830870981e-05, 0.01574742817686578, 0.6164041025602268). |

## 3. Fixture D3 parity (independent cross-check)

Independent Python replay of the fixture under xorshift32, engine cadence, spares['eaf']=1 override (documented baseline construction): all 24 expected outputs match within fixture tolerances (usd 0.01, tonnes 1e-6, categorical exact). Key values reproduced: generator_state 1250607942, breakdowns 0, planned_outages 2, wages_usd 2799000.0, demurrage_usd 0.0, ships 7/6/1, berth_blocked_t 0.0, berth_wait_ship_days 6.5416666666666785, beyond_free 0.0, arrived_t 19320.0, dispatched_t 14400.0, yard_stock_t 4920.0, buffered_t 400.0, produced_t 107600.0, upstream_blocked_t 5221.6666666666915, congestion_flag true, crane 180/180, restricted_streak 85, day 180. The vitest parity test (TS side) is green against the same fixture in the fresh run above.

## 4. Divergences found (documented, not fixed — files not owned)

1. **Headcount integer gate (TS vs mirror):** mirror `validate_ops` requires `headcount` to be a strict `int` (line 103); TS `isNum` accepts any positive finite number, so a fractional headcount (e.g. 30.5) passes in TS but is rejected by the mirror. The live content file is unaffected (all headcounts are whole numbers), so no fixture divergence. Per the skill convention, integer gates should accept whole-number floats (JSON parses numerics as floats) but reject fractional ones — the TS gate is looser than the mirror's. Deferred: `web/src/ops_domain3.ts` is not in this agent's ownership.
2. **Morale band threshold range:** mirror rejects thresholds outside 0–100 (line 133); TS does not range-check `threshold` (only requires a finite number). Live config is in range; no fixture divergence. Deferred, same ownership reason.
3. **Mirror `sme_pending` asset field:** mirror requires `sme_pending` per asset (line 73); TS validator does not check it. Metadata-only; no behavioral divergence on the fixture. Deferred.
4. **Draw-value scaling:** mirror compares `rng.random()` (Python `random.Random` in [0,1)); TS divides the uint32 word by `0xFFFFFFFF` (max draw = 1.0, exclusive of 0). Under the shared xorshift32 spec both sides produce the same sequence (verified by gate #0 and the fixture replay), so this is not a divergence for fixture runs; noted for completeness.

None of these changed any fixture outcome; the fresh vitest run and the independent replay both reproduce the canonical values exactly.

## 5. Known deferred berth test-construction status (must remain visible)

Per `docs/known_limitations.md`, the two berth test-construction FAILs are test construction, not engine defects, and the cadence behavior must be reproduced, not "fixed":

- **Berth material-identity test (Domain 3 parity): DEFERRED.** Mirror cadence (`day += 1` after berth stages) lands its day-tick at tick 24, so the 9c assertion at tick 48 sees `berth_blocked_t == 0` and the identity balances; the engine/TS cadence (`day += 1` before berth stages) lands the day-tick at tick 48, so the first refused arrival lands ON the assertion tick (`berth_blocked_t == 1`) and the identity form subtracts cargo for a ship that never entered the berth (LHS 0 vs RHS 1000; fails at 48 and 72). Negative control genuinely detects double-counting — the fault is the assertion measuring across a boundary the engine cadence does not expose. A correct form requires Yasser's GO; not applied.
- **Stage 5 berth in-transit check:** was DEFERRED as test construction (17/18 checks); resolved 2026-10-12 by the per-ship partition form under Yasser GO — the 41.6667 t gap was the missing per-ship credited term, not in-transit cargo; no engine logic changed.
- Fresh mirror run this session (frozen oracle): 29 PASS / 3 FAIL lines; the FAILs are the recorded berth test-construction checks (berth->yard block, berth capacity, berth identity) — status unchanged, not weakened, reported honestly.

The TS port reproduces the cadence boundary exactly (line 172 comment: "cadence boundary: day increment happens BEFORE the berth stages"), which is the required behavior inheritance.

## 6. Verdict

PASS. The TS ops/logistics port is 1:1 with the mirror on tick order, cadence boundary, draw contract, purity, generator-in-state, and zero-seed guard; fixture D3 parity is green in a fresh vitest run (7/7) and independently reproduced by a Python replay. Three validator strictness divergences (headcount integer, band threshold range, sme_pending) are documented and deferred to the file owner; no engine defect found.

Files created: `web/src/ports/operations/VERIFICATION.md` (this report). No other files touched.
