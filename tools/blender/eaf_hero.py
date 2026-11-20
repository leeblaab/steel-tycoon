"""S2.1 hero swap #2 — procedural EAF (FORGED F-01/F-06; adapts audit_2 A4 draft structure).

Silhouette (PLAN_FORGED §2): squat round vessel on trunnions + 3 electrodes in triangle
+ swing roof + transformer house. SME non-negotiable pivots for S2.2:
- pivot_vessel: slow heavy tilt ~30-40 deg on trunnions (design rotZ; three: rotation.z = -tilt)
- pivot_roof: roof swings SIDEWAYS off the shell to charge (design rotY at the mast;
  three: rotation.y). Electrodes + arms ride the roof pivot (raise + swing away with it).
- electrode_a/b/c: named meshes, bore = position.y translation (three, glTF Y-up).
- tap_spout rides pivot_vessel; ladle + ladle_car named for glow + travel.

Scene fit (derived from live code): fullplant eaf slot at slice4-local (-5,0,0), neighbors
feed (-10) / lf (0) -> footprint ~5.8 x 4.0, height ~4.0 (DRP 9.3 stays tallest).
Built at FINAL scene size (scale 1). min-y = 0 (bbox seating rule).

Run: blender --background --python eaf_hero.py -- <outdir>
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steelx_hero_lib import (  # noqa: E402
    PAL, L, S, R, mat, clear_scene, box, cyl, cone, pivot,
    join_named, merge_static_by_material, export_glb, stats, budget_gate, render_preview, outdir_from_args,
)
import bpy  # noqa: E402

outdir = outdir_from_args()
os.makedirs(outdir, exist_ok=True)
clear_scene()

M_shell = mat('eaf_shell', PAL['steel'], metallic=0.45, roughness=0.55)
M_steel_l = mat('steel_light', PAL['steel_light'], metallic=0.4, roughness=0.6)
M_steel_d = mat('steel_dark', PAL['steel_dark'], metallic=0.35, roughness=0.65)
M_refract = mat('refractory', PAL['refractory'], metallic=0.05, roughness=0.9)
M_graph = mat('graphite', PAL['graphite'], metallic=0.15, roughness=0.45)
M_copper = mat('copper_bus', PAL['copper'], metallic=0.8, roughness=0.3)
M_conc = mat('concrete', PAL['concrete'], metallic=0.0, roughness=0.95)
M_bath = mat('ladle_bath', '#3a2020', metallic=0.0, roughness=0.8)  # scene sets emissive at runtime
M_lamp = mat('state_light', '#3fd97a', metallic=0.0, roughness=0.4)

# --- foundation + trunnion stands (axis at vessel mid-height 1.85, like a real EAF) ---
box('base_pad', S(5.6, 0.25, 4.2), L(0, 0.125, 0), M_conc)
for sx in (-1.25, 1.25):
    box(f'trunnion_stand_{sx}', S(0.35, 1.6, 0.8), L(sx, 1.05, 0), M_steel_d)

# --- vessel on the tilt pivot (trunnion axis at h 1.85 = vessel CG, along design Z) ---
p_vessel = pivot('pivot_vessel', L(0, 1.85, 0))
cone('vessel_shell', 1.3, 1.5, 1.3, L(0, 1.85, 0), M_shell, verts=14, parent=p_vessel)
cyl('refractory_rim', 1.52, 0.18, L(0, 2.55, 0), M_refract, verts=14)
cyl('trunnion_ring', 1.72, 0.35, L(0, 1.85, 0), M_steel_l, verts=14, rot=R(math.pi / 2, 0, 0), parent=p_vessel)
box('tap_spout', S(0.55, 0.3, 0.45), L(1.55, 1.75, 0), M_refract)
# S4.1 draw budget: rim + spout share the vessel pivot and material -> 1 draw.
join_named(['refractory_rim', 'tap_spout'], 'vessel_refractory', parent=p_vessel)

# --- swing roof: mast FIXED west of vessel; roof+arms+electrodes ride pivot_roof ---
box('electrode_mast', S(0.28, 2.6, 0.28), L(-1.95, 2.6, 0), M_steel_l)  # 1.3..3.9, fixed
cyl('state_light', 0.1, 0.12, L(-1.95, 3.96, 0), M_lamp, verts=8)
p_roof = pivot('pivot_roof', L(-1.95, 2.7, 0))
cone('roof', 1.55, 0.45, 0.35, L(0, 2.78, 0), M_steel_l, verts=14)
cyl('roof_cap', 0.3, 0.18, L(0, 3.0, 0), M_steel_l, verts=10)
# S4.1 draw budget: roof + cap co-move, same material -> 1 draw.
join_named(['roof', 'roof_cap'], 'roof_unit', parent=p_roof)
_el_cols, _el_arms = [], []
for name, ang in (('a', 90), ('b', 210), ('c', 330)):
    a = math.radians(ang)
    ex, ez = 0.7 * math.cos(a), 0.7 * math.sin(a)
    # electrode: graphite column through the roof into the vessel (bore = position.y).
    # Long above-roof section (to 3.9) so the triangle READS as three columns, not stubs.
    _el_cols.append(cyl(f'electrode_{name}', 0.11, 2.25, L(ex, 2.775, ez), M_graph, verts=8))
    # copper arm from mast head to electrode top (horizontal, design rotY)
    dx, dz = ex - (-1.95), ez - 0.0
    arm_len = math.hypot(dx, dz)
    arm_ang = math.atan2(dx, dz)
    _el_arms.append(box(f'electrode_arm_{name}', S(0.12, 0.12, arm_len),
        L(-1.95 + dx / 2, 3.75, dz / 2), M_copper, rot=R(0, arm_ang, 0)))
# S4.1 draw budget: all 3 electrodes share ONE bore value (eaf_heat_pose) -> merge to 1
# draw; the renderer animates the joined 'electrodes' mesh. Arms likewise co-move.
join_named(_el_cols, 'electrodes', parent=p_roof)
join_named(_el_arms, 'electrode_arms', parent=p_roof)

# --- transformer house + copper bus bars (FRONT-left: visible from the home camera +Z) ---
box('transformer_house', S(1.2, 1.4, 1.0), L(-2.4, 0.95, 1.6), M_steel_d)
for bz in (1.35, 1.6, 1.85):
    box(f'bus_bar_{bz}', S(1.5, 0.08, 0.08), L(-1.55, 2.0, bz), M_copper)

# --- ladle on car under the tap (receives the heat; travels to LF in S2.2/S4.2) ---
box('ladle_car', S(1.3, 0.22, 0.9), L(2.15, 0.36, 0), M_graph)
for wx in (1.7, 2.6):
    for wz in (-0.45, 0.45):
        cyl(f'car_wheel_{wx}_{wz}', 0.12, 0.1, L(wx, 0.12, wz), M_steel_d, verts=8, rot=R(math.pi / 2, 0, 0))
cone('ladle', 0.42, 0.55, 0.85, L(2.15, 0.9, 0), M_refract, verts=12)
cyl('ladle_bath', 0.44, 0.06, L(2.15, 1.28, 0), M_bath, verts=12)

glb = os.path.join(outdir, 'eaf_hero.glb')
# ladle/car/bath travel + glow at runtime; state_light emissive is sim-driven -> keep named.
merge_static_by_material('eaf', exclude=('ladle', 'ladle_bath', 'ladle_car', 'state_light'))
export_glb(glb)
st = stats(glb)
budget_gate(st, 'EAF')
render_preview(os.path.join(outdir, 'eaf_hero_preview.png'),
               target=(0, 1.8, 0), dist=13, el_deg=30, az_deg=35)
print('EAF_BUILD_OK')
