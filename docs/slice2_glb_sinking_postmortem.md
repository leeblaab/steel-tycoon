# Slice 2 GLB visual pipeline — ComfyUI models into the slice2 yard

Goal: place ComfyUI-generated GLBs (gantry crane, shredder plant) on the slice2 ground plane
at believable scale, seated so their real feet touch grade.

## Pipeline order (each step gated by SME approval)
1. Generate → 2. compress (`npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt`)
   → 3. copy to BOTH `src/ports/slice2/browser/assets/` and `public/assets/` → 4. import + fitTo
   in `src/ports/slice2/browser/main.tsx` → 5. vite build + headless screenshot probe → 6. SME visual check.

## THE SINKING TRAP (root cause of repeated failures)
ComfyUI GLBs bake a **ground plate / yard slab** into the mesh — flat geometry that spans the
model's FULL X and Z extent at the bottom bands. Naive seat rules fail:

| Rule tried | Result |
|---|---|
| `Box3.min.y` (absolute bbox bottom) | seats the PLATE on grade → whole machine buried ("sinking") |
| vertex-share threshold (>2/3% bands) | gantry plate band = 19.5% of vertices, real legs only ~1% — picks the plate |
| gap-scan (<0.3% empty band) | junk and legs INTERLEAVE in Y; picked top-of-machine (baseY=4) — inverted |

**Working separator = horizontal extent.** A ground plate spans >80% of the model's XZ box on
BOTH axes. Real gantry legs span full X but only ~half Z → survive the filter. Scan bands
bottom-up (BAND=0.4 m), drop any band whose XZ footprint exceeds 0.8·spanX AND 0.8·spanZ,
first survivor = seat base: `root.position.y = lift - baseY`.

## Probes (web/cache/, run from web/ with node)
- `probe_s2_bands.mjs` / `probe_s2_clusters.mjs` — per-band vertex count + XZ extent + grid-cell
  occupancy at target scale. Read these BEFORE choosing a rule; never guess thresholds.
- `probe_s2_junkmap.mjs` — ASCII XZ map of vertices below cutY; shows the plate slab shape.
- `probe_s2_extent.mjs` — offline replica of the extent fitTo; must print sane seatMinY≈lift and
  visible height before touching main.tsx.

## Current values (main.tsx)
- Shredder: `fitTo(g.scene, 24, 'z')` at [18.5, 0, -4] — building base band ≈ y=-0.8 after fitZ(24).
- Gantry: `fitTo(g.scene, 7.8, 'x', 0.2)` at [-1, 0, 8], rails y=0.15. lift 0.2 clears rail height.

## Pitfalls
- Offline probe "verified" ≠ SME-approved: Yasser's screenshot is the gate. If he says sinking,
  re-probe geometry — don't defend the numbers.
- Gantry junk/legs interleave in Y (plate at -4..-1.2 overlaps leg bands) — Y-only rules can never
  separate them; only XZ extent can.
- ComfyUI GLBs export one untextured near-black material → keep the flat-material stand-in after fitTo.
