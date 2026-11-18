# Slice 2 GLB visual pipeline — ComfyUI models into the slice2 yard (grounding rules)

Goal: place ComfyUI-generated GLBs (gantry crane, shredder plant) on the slice2 ground plane
at believable scale, seated so their real feet touch grade.

## Pipeline order (each step gated by SME approval)
1. Generate → 2. compress (`npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt`)
   → 3. copy to `src/ports/slice2/browser/public/assets/` (THE served dir — vite root is
   `src/ports/slice2/browser/`, so the dev server serves `/main.tsx` and `/assets/*.glb` from
   THERE, not from web/ root; `browser/assets/` is a stale duplicate) → 4. import + fitTo in
   `src/ports/slice2/browser/main.tsx` → 5. vite build + headless screenshot probe → 6. SME visual check.

## THE SINKING TRAP (root cause of repeated failures)
ComfyUI GLBs bake junk/ground-plate geometry far below the real feet. Naive seat rules fail:

| Rule tried | Result |
|---|---|
| `Box3.min.y` (absolute bbox bottom) | seats the junk on grade → whole machine buried ("sinking") |
| vertex-share threshold (>2/3% bands) | gantry plate band = 19.5% of vertices, real legs only ~1% — picks the plate |
| gap-scan (<0.3% empty band) | junk and legs INTERLEAVE in Y; picked top-of-machine (baseY=4) — inverted |

**Working separator = horizontal extent.** Scan bands bottom-up (BAND=0.4 m), drop any band whose
XZ footprint exceeds 0.8·spanX AND 0.8·spanZ, first survivor = seat base: `root.position.y = lift - baseY`.

## VERIFIED GEOMETRY FACTS (probes at target scale — trust these numbers)
- Gantry (fitX 7.8, lift 0.2): y -3.7..4.0, total 50423 verts. Real leg bands y=-1.6..1.2 have
  Z-extent only 4.6 m vs full spanZ 8.7 → NO bottom band trips the both-axes rule; baseY=-4 is
  CORRECT (the "junk" below -1.2 IS the legs+end-trucks, spread along X). seatMinY=0.45, height 7.8 m. ✓
- Shredder (fitZ 24): y -2.6..2.4, total 51287 verts. Bands -2.8..-1.2 pin z-extent to full 24.0
  → dropped; building base band = y=-0.8 (z shrinks 24→18.2 there). seatMinY after seat = **-1.77**
  — a ~1.7 m blob under the building that extent-per-band rules cannot reach (its XZ footprint is
  inside the building's, not >80% on both axes). If SME reports shredder sunk, this sub-base blob
  is the cause; fix = explicit per-model Y clip or hand-set baseY, NOT another generic rule.

## Probes (web/cache/, run from web/ with node)
- `probe_s2_bands.mjs` / `probe_s2_clusters.mjs` — per-band vertex count + XZ extent + grid-cell
  occupancy at target scale. Read these BEFORE choosing a rule; never guess thresholds.
- `probe_s2_junkmap.mjs` — ASCII XZ map of vertices below cutY; shows plate/blob shape.
- `probe_s2_extent.mjs` — offline replica of the extent fitTo; must print sane seatMinY≈lift and
  visible height before trusting main.tsx behavior.

## Current values (main.tsx)
- Shredder: `fitTo(g.scene, 24, 'z')` at [18.5, 0, -4].
- Gantry: `fitTo(g.scene, 7.8, 'x', 0.2)` at [-1, 0, 8], rails y=0.15 (box 26×0.3×0.5 at z=8±3.4).

## Pitfalls
- Offline probe "verified" ≠ SME-approved: Yasser's screenshot is the gate. If he says sinking,
  re-probe geometry — don't defend the numbers.
- Vision-model reading of a dark scene can mislabel which model sinks/floating; cross-check with
  the offline seatMinY numbers before patching.
- ComfyUI GLBs export one untextured near-black material → keep the flat-material stand-in after fitTo.
