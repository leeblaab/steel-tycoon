# S5.3b evidence — yard hero swaps #5/#6 + slice5 relight (21.11)

## What changed
- `tools/blender/hero_gantry_yard.py` -> `gantry_yard_billet.glb` + `gantry_yard_product.glb`
  (876 tris / 69.2 kB each — budget PASS; crane_bridge, crane_hook, crane_payload, rope_±0.18,
  stock_b0..b4, truck_±2.6, yard_*_static nodes verified offline in the GLB).
- `web/src/ports/slice5/browser/main.tsx`: -191/+88 lines. Deleted inline YardCrane,
  BilletYardModel, makeGantrySide, ProductRack, GantryCrane, ProductYardModel; ONE shared
  `GantryYardHero` component drives both yards (travel+hoist loop when busy, parks middle bay).
- SME pass-2 fix: `YARD_SCALE_H = 1/3` on the model root, re-pinned by hero centre
  (`YARD_CX = 0`, `YARD_CZ = 5.88`; hero extents X -2.88..2.88, Z 0..11.76). Label height 2.6.
- Slice5 relight: fullplant golden-hour rig (hemisphereLight #a8c4de/#7a5f4b @1.1,
  directionalLight [-30,42,60] #ffe2b8 @3.2 with shadows, ACESFilmicToneMapping, bg #3d4a58).

## Verification (all measured, not remembered)
- `vite build --config src/ports/slice5/browser/vite.slice5.config.ts` OK; final clean-build
  hash `index-qy9K4r8F.js` matches pre-debug-hook build (TEMP DEBUG capture hook removed).
- `npx vitest run --root .` -> 34 files / 292 tests green.
- Served via `vite preview` :4173; mid-run screenshots at tick ~32 and ~38 of 120, canvas
  1011x800 (first shots at 365px were a harness-resize artifact — re-shot at proper size).
- Vision pass verdicts (yard_heroes_clean_build.png): coherent yards YES; smaller than mill
  + flanking without overlap YES; stock shown iff telemetry says so (billet yard populated,
  product yard empty @0.0 t) YES; no scattered/floating parts YES.
- Soft observation, not a defect: ground plane #17202a + dark materials still read dim at
  small scale; code matches the fullplant rig Yasser already accepted.

## Files
- `yard_heroes_scaled.png` — mid-run (tick 38) after the 1/3-scale + centring fix.
- `yard_heroes_clean_build.png` — final clean production build, tick 32, all checks YES.
