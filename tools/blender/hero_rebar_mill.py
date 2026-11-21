"""S5.3 hero swap #4 — procedural REBAR MILL (FORGED F-01/F-06).

Silhouette (PLAN_FORGED Stage 5): walking BEAM HEATING FURNACE on the charge side,
short roller-table approach, FOUR vertical closed-loop stands in a line (the rolling
signature), long RUN-OUT TABLE / cooling-bed walk-out toward the product yard.
SME note (Yasser, 16y mill ops): rebar = straight bar product -> run-out table +
cooling bed is the signature; NO coil-forming looper here (that belongs to the
wire-rod hero, a later phase per layout note).

PIVOTS / animatable parts (renderer drives them off mill.busy):
- charge_gate: named mesh at the furnace mouth; renderer slides it (position.x)
  while feeding + emissive mouth cue.
Everything else is static and merged by material (draw budget).

DRAW BUDGET (S4.1 law): <=8 visible draws — merged statics per material + charge_gate.
Co-moving parts JOINED, never named-per-part.

Scene fit (derived from live anchors): slice5-local mill anchor (-2,0,0); old rm-1024
GLB plot ~3.6 wide at scale 4. Hero built at FINAL scene size (scale 1), line runs
along +x: furnace x -4.1..-1.1, stands x -0.1..1.7, run-out to x +4.0 toward the
product yard; depth z <= 1.6, height ~2.1 (DRP 9.3 stays tallest). min-y = 0.
sme_pending: stand count 4 — plausible for a rebar line in this footprint.

Run: blender --background --python hero_rebar_mill.py -- <outdir>
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steelx_hero_lib import (  # noqa: E402
    PAL, L, S, R, mat, clear_scene, box, cyl, cone, pivot,
    join_named, merge_static_by_material, export_glb, stats, budget_gate, render_preview, outdir_from_args,
)

outdir = outdir_from_args()
os.makedirs(outdir, exist_ok=True)
clear_scene()

M_steel_l = mat('steel_light', PAL['steel_light'], metallic=0.4, roughness=0.6)
M_steel_d = mat('steel_dark', PAL['steel_dark'], metallic=0.35, roughness=0.65)
M_refrac = mat('refractory', PAL['refractory'], metallic=0.1, roughness=0.9)
M_paint = mat('paint_yellow', PAL['paint_yellow'], metallic=0.2, roughness=0.7)

# ---------- Beam heating furnace (charge side, -x) ----------
box('furnace_skid', S(3.0, 0.35, 1.6), L(-2.6, 0.175, 0), M_steel_d)
box('furnace_shell', S(2.8, 1.3, 1.4), L(-2.6, 1.0, 0), M_refrac)
box('furnace_ridge', S(2.6, 0.18, 0.5), L(-2.6, 1.74, 0), M_steel_l)
# mouth frame at the +x end (charge-gate opening)
box('mouth_frame_top', S(0.18, 0.3, 1.45), L(-1.1, 1.5, 0), M_steel_l)
box('mouth_frame_l', S(0.18, 1.4, 0.18), L(-1.1, 0.7, 0.65), M_steel_l)
box('mouth_frame_r', S(0.18, 1.4, 0.18), L(-1.1, 0.7, -0.65), M_steel_l)
# charge gate: named animatable door (renderer slides it while feeding)
box('charge_gate', S(0.12, 1.25, 1.1), L(-1.16, 0.72, 0), M_paint)
# flue stub at the furnace back
cyl('furnace_flue', 0.16, 0.8, L(-3.7, 2.2, 0), M_steel_d, verts=8)

# ---------- Roller-table approach (furnace -> stands) ----------
# roller table filling the furnace->stand gap; rail top at roll centreline (y~0.9)
box('approach_table', S(1.4, 0.16, 0.9), L(-0.35, 0.78, 0), M_steel_l)
box('approach_rail_l', S(1.4, 0.12, 0.1), L(-0.35, 0.64, 0.5), M_steel_d)
box('approach_rail_r', S(1.4, 0.12, 0.1), L(-0.35, 0.64, -0.5), M_steel_d)
box('approach_leg_a', S(0.12, 0.58, 0.12), L(-0.95, 0.3, 0), M_steel_d)
box('approach_leg_b', S(0.12, 0.58, 0.12), L(0.25, 0.3, 0), M_steel_d)
# rollers ACROSS the line (axis along z, billet travels +x); tops at roll centreline
for i, x in enumerate((-0.95, -0.65, -0.35, -0.05)):
    cyl(f'approach_roll_{i}', 0.11, 0.94, L(x, 0.84, 0), M_steel_d, verts=8,
        rot=R(math.pi / 2, 0, 0))

# ---------- Four vertical stands (the rolling signature) ----------
STAND_X = (0.05, 0.65, 1.25, 1.85)
for i, x in enumerate(STAND_X):
    box(f'stand_base_{i}', S(0.56, 0.34, 1.0), L(x, 0.17, 0), M_steel_d)
# housing = two columns + screw-down cap with a pass window between them
for i, x in enumerate(STAND_X):
    box(f'stand_col_a_{i}', S(0.3, 0.8, 0.42), L(x, 0.9, 0.32), M_steel_l)
    box(f'stand_col_b_{i}', S(0.3, 0.8, 0.42), L(x, 0.9, -0.32), M_steel_l)
    box(f'stand_cap_{i}', S(0.34, 0.22, 0.75), L(x, 1.4, 0), M_steel_l)
# mill floor continuity between housings
box('mill_floor', S(2.5, 0.16, 1.0), L(0.95, 0.42, 0), M_steel_d)

# ---------- Run-out table / cooling bed (walk-out toward product yard) ----------
# run-out top surface at roll centreline (y~0.9); clean gap after 4th stand (x>=2.4)
box('runout_table', S(2.0, 0.16, 1.3), L(3.4, 0.82, 0), M_steel_l)
for i in range(3):
    box(f'runout_leg_{i}', S(0.12, 0.74, 0.12), L(2.6 + i * 0.75, 0.37, 0.55), M_steel_d)
    box(f'runout_leg_b_{i}', S(0.12, 0.74, 0.12), L(2.6 + i * 0.75, 0.37, -0.55), M_steel_d)

# ---------- Draw-budget merge (charge_gate stays separate; renderer animates it) ----------
merge_static_by_material('rebar_mill', exclude=('charge_gate',))

glb = os.path.join(outdir, 'rebar_mill_hero.glb')
export_glb(glb)
budget_gate(stats(glb), 'REBAR_MILL')
render_preview(os.path.join(outdir, 'rebar_mill_hero.png'), target=(0, 1, 0), dist=12, el_deg=28, az_deg=35)
