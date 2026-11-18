# Slice 5 browser scene — manual run / build instructions (no shared-file edits)

Files here: `index.html`, `main.tsx`, `sim.ts`, `verify.ts`. Logic source of truth: fixture
`fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json` + mirror `mirror/slice5_mirror.py`
(ported to sim.ts; verified field-by-field — see verify output).

## Headless verification (verification bar a/b)
From `C:\AI_LAB\SteelX\web`:

    npx tsx src/ports/slice5/browser/verify.ts

Prints every fixture `expected_outputs` field as MATCH/MISMATCH, the balance residual at tick 120
and key ticks, and runs the fixture's `no_billet_stock` negative control. Exit code 0 = ALL MATCH.

## Dev server (verification bar c) — scoped to this folder only
`web/vite.config.ts` pins `root: 'src/ports/slice1/browser'`; isolation forbids editing it, so use
the CLI override (verified working):

    cd C:\AI_LAB\SteelX\web
    npx vite --config src/ports/slice5/browser/vite.slice5.config.ts

Then open http://localhost:5173/. `npx vite build --config ...` does the production build check.

## Negative scenario toggle (verification bar d)
Panel button "Negative mode: no_billet_stock" mirrors the fixture's negative control
(initial_billet_t = 0 → 0 rolls, 0 dispatch, closed balance). Note: the animated scene replays the
main fixture run; the negative control is asserted headlessly in verify.ts (and printed to the
browser console at load via `console.log` of the verify lines). [OPEN QUESTION 4] A full live
replay under no_billet_stock would need a second runSlice5(mode) instance — deferred.
