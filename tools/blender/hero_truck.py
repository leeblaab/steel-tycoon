"""S5.4-prep hero swap #7 — procedural FLATBED TRUCK (dispatch fleet).

WHY: the slice5 dispatch crane stand-in (box column + jib) read ugly next to the new
yard heroes. Yasser 21.11: replace it with "2 or 3 moving trucks between the product
yard and the dispatch area". The sim keeps its abstract `dispatch_crane` resource
(engine untouched, F-07 breadth freeze); only the VISUAL grammar changes — a truck
drives each dispatch move.

ONE hero GLB, three instances in the renderer (clone per instance). Built at final
scene size (scale 1), grounded min-y = 0, facing +x so the renderer only translates.

ANIMATABLE NODES (renderer drives them):
- wheel_fl/fr/ml/mr/rl/rr : 6 individual named wheel meshes — a joined wheel PAIR
  would orbit about its origin instead of rolling, so wheels are deliberately NOT
  merged (6 tiny draws; statics get merged instead).
- bundle: cargo node; renderer shows it iff the move carries tonnage.

Scene fit (final scene size): length x -1.05..1.05, width z -0.42..0.42, height <= 1.15.

Run: blender --background --python hero_truck.py -- <outdir>
"""
import os
import sys

import bpy  # noqa: E402  (runs inside Blender)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steelx_hero_lib import (  # noqa: E402
    PAL, L, S, R, mat, clear_scene, box, cyl,
    merge_static_by_material, export_glb, stats, budget_gate, render_preview, outdir_from_args,
)

outdir = outdir_from_args()
os.makedirs(outdir, exist_ok=True)

clear_scene()

M_cab = mat('truck_cab', PAL['paint_yellow'], metallic=0.2, roughness=0.7)
M_flat = mat('truck_flat', PAL['steel_dark'], metallic=0.35, roughness=0.65)
M_tire = mat('truck_tire', '#23262b', metallic=0.1, roughness=0.9)
M_bundle = mat('truck_bundle', '#4fae7d', metallic=0.4, roughness=0.55)  # rebar bundle green

# ---------- Flatbed deck (grounded: chassis bottom y=0.52, deck top y=0.62) ----------
box('flatbed', S(1.9, 0.1, 0.8), L(-0.1, 0.57, 0), M_flat)

# ---------- Cab at +x end (forward = +x); windshield is a darker inset face ----------
box('cab', S(0.62, 0.52, 0.74), L(0.68, 0.88, 0), M_cab)
box('windshield', S(0.1, 0.26, 0.6), L(0.97, 0.98, 0), M_flat)

# ---------- Wheels: r=0.30 -> axle y=0.30 (rolls clear of the 0.52 chassis bottom);
# cylinder axis along z (R(90,0,0)). Axles at x -0.75 / +0.45 (typical 3-axle spacing:
# rear bogie close together — that "peanut" is a tandem bogie, not an overlap bug). ----
WHEEL_R = 0.30
for nm, x in (('r', -0.75), ('m', -0.45), ('f', 0.45)):
    for side, z in (('l', -0.42), ('r', 0.42)):
        cyl(f'wheel_{nm}{side}', WHEEL_R, 0.16, L(x, WHEEL_R, z), M_tire, verts=10,
            rot=R(90, 0, 0))

# ---------- Cargo bundle on the deck (renderer toggles visibility) ----------
box('bundle', S(1.25, 0.34, 0.62), L(-0.25, 0.79, 0), M_bundle)

# Draw-budget merge: statics per material (cab+windshield share a slot -> joined;
# flatbed alone stays). Wheels + bundle excluded: wheels spin individually, bundle toggles.
merge_static_by_material('truck', exclude=tuple(
    f'wheel_{a}{b}' for a in 'fmr' for b in 'lr') + ('bundle',))

glb_path = os.path.join(outdir, 'flatbed_truck.glb')
export_glb(glb_path)
budget_gate(stats(glb_path), 'FLATBED TRUCK')

# Preview render LAST (ground/camera added after the real GLB is exported).
render_preview(os.path.join(outdir, 'flatbed_truck_hero.png'), target=(0, 0.6, 0), dist=5, el_deg=18, az_deg=35)
