# S5.3 — Hero swap #4: rebar mill (procedural, FORGED F-01)

## What changed (one commit: add + delete + validate)
- ADD `tools/blender/hero_rebar_mill.py` — procedural Blender-Python hero: beam-heating furnace (yellow-banded, mouth at +x), roller table, FOUR twin-column stands (STAND_X = 0.05 / 0.65 / 1.25 / 1.7), run-out table to +x toward the product yard. Named animatable node `charge_gate` (excluded from static merge).
- ADD `web/src/ports/slice5/browser/assets/rebar_mill_hero.glb` — 42,848 B / 572 tris / 4 draws (budget gate PASS: ≤2500 tris, ≤150 KB).
- DELETE `web/src/ports/slice5/browser/assets/rebar_mill.glb` — old ComfyUI "rm 1024" box line, 1,627,360 B (38x heavier).
- WIRE slice5 twin (`main.tsx`): `RebarMillModel` now loads the hero at scale 1 (built at final scene size), rig = `charge_gate` slide (eased open while `mill.busy`), busy-gated furnace-mouth glow, hot-bar-on-table overlay while a batch is in process. Old inline cooling-bed/bar meshes removed.
- WIRE fullplant (`main.tsx`): new `RebarMillFullplant` component (same rig via `useRafLoop`, busy from `SESSION.stateOf('slice5').mill.busy`); old `Glb rebar_mill.glb` + inline cooling-bed removed; FlowPulse kept.

## Scoping decision (needs Yasser sign-off)
`content/layout/factory_layout_v1.json` has no separate reheat-furnace or wire-rod-mill slot, and the s5_rebar_mill note says "V3 covers the rebar branch only (wire-rod is a later phase)". The hero therefore folds the reheat furnace INTO the rebar-mill model (furnace + stands + run-out as one line). Wire-rod hero deferred.

## Iteration history (hero script)
1st build: roller orientation wrong, stands read as a comb -> fixed stand silhouette (twin columns + yellow collars), gaps closed. 2nd review: mouth/gate placement -> fixed. 3rd review: "no remaining defect".

## Gates
- vitest: 34 files / 292 tests green (before and after wiring).
- vite build slice5: OK (`rebar_mill_hero-CumfXoem.glb` 42.84 kB emitted).
- vite build fullplant: OK (hero URL inlined into JS chunk; only the pre-existing chunk-size warning).
- Budget gate in script run: REBAR_MILL tris 572/2500, bytes 42848/150000 PASS; nodes `charge_gate`, `furnace_shell`, statics steel_dark/steel_light; size_design_xyz [8.5, 2.6, 1.6]; min-y 0 (grounded).
- Browser (:5179, fresh load): GLB fetched with zero console errors; close-up confirms coherent left-to-right line — dark furnace box w/ yellow mouth band at right end, roller table, four upright stands, run-out slab to +x. Mid-roll screenshot: hot orange bar on the table while `on mill: 20 t`. Zone-fit screenshot: no overlap with billet yard (left) or product-yard stacks (right).
- Evidence: s53_0_hero_studio.png (Blender preview), s53_1_mill_idle_closeup.png, s53_2_roll_busy.png, s53_3_zone_fit.png.

## Known cosmetic notes (not blocking, logged)
- Browser viewport is small/dark; the run-out slab sits at stand height with a short step after the stands — physically plausible (roll centreline to table transition), reads slightly "elevated" in dark screenshots.
- Gate-slide and mouth-glow states are hard to see in dim thumbnails; rig verified wired in code and busy-state visible via hot bar.
