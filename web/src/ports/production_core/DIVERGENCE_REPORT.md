# Divergence report — fixture D1 (`d1_scrap_20heats_seed11`)

Status: **RESOLVED 2026-10-12 — fixture rebuilt clean (Yasser GO).** The failing run below is preserved as the record; nothing was weakened.

## Resolution

- **Root cause (verified from disk):** `mirror/build_fixtures.py` used `pcm.state` — the mirror's module-level state, already advanced by 20 heats at import time — so `expected_outputs` recorded a continuation (40 heats) while `actions`/`tick_count` recorded only the fixture loop (20). Internally inconsistent: rule fields required 40 ticks, `generator_state` required exactly 120 draws (6/tick × 20).
- **Rebuild (Yasser GO, one fresh process):** `mirror/rebuild_d1_fixture.py` constructs its own fresh state, runs 20 ticks with the documented decision-demo action cycle, advances the generator 6 draws/tick in fixed asset order, and records expected outputs from that exact run. Read back once.
- **Clean fixture values:** tick 20, generator_state **2632950184** (unchanged — 120 draws, canonical contract), purchased {bushing 100, hms1_hms2 500, shredded 200}, handling 12.5, yield 44.0, melted 743.5, ttt_runs 20, ttt_hours_accum 18.764374999999998, spend 246,000, condition 90.0, crew 1.0, balance_error 2.27e-13.
- **Port correction (one fix, one fresh run):** the port had advanced the generator 1 draw/tick; corrected to the canonical 6-draw contract. Fresh vitest run: **28/28 PASS** (full suite). The rule logic was never in question — tick-1 state was byte-identical to the mirror before any correction.

## Original failing run (preserved, commit af568c4)

Actual = TS port replaying the recorded `initial_state` through 20 actions with 1 draw/tick (the port's then-implementation): every accumulator exactly half the fixture expectation (tick 20 vs 40, melted 743.5 vs 1487.0, spend 246,000 vs 492,000, condition 90 vs 95, generator 547593033 vs 2632950184). PASS at that run: yard_stock_t, crew_factor, balance_error. Investigation (one): tick-1 state byte-identical to a Python replay of the mirror rules — port correct; divergence was in the fixture, not the port.

## Harness note (test location)

The vitest harness (v5.0.4, no config, `type: commonjs`) resolves `.js` import specifiers from `tests/` (gate0 passes with `../src/prng.js`) but fails module resolution from the nested `tests/ports/production_core/` path (`Cannot find module '../../src/ports/production_core/production_core.js'` — confirmed once with a minimal probe test). Per the task's fallback rule, the parity test lives inside the owned directory: `web/src/ports/production_core/parity_production_core.test.ts`. The test reads the fixture JSON from disk at the absolute path and replays from the recorded initial_state.

## Files

- `production_core.ts` — the 1:1 port (pure tick, shared PRNG import, reject-never-default loader, canonical 6-draw contract)
- `parity_production_core.test.ts` — vitest parity test (inside owned dir due to harness resolution)
- This report — the preserved record of the failing run and the correction
