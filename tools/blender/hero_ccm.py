"""S4.1 hero swap #3 — procedural CASTER ARC (FORGED F-01/F-06).

Silhouette (PLAN_FORGED Stage 4): ladle turret (2 seats) over a CURVED copper mold,
strand bending to horizontal through straightener stands, cut-torch gantry.
SME non-negotiable pivots for S4.2:
- pivot_turret: 'turret_load' (arm + both ladles + nozzle, ONE joined mesh) rotates
  (design rotY; three: rotation.y) to swap active/wait ladles.
- pivot_mold: 'mold_unit' (block + flange joined) oscillates vertically (position.y).
- torch_head: named mesh, travels along the strand (position.x) + cut spark.
Strand glow / billet rows are S4.2 renderer work (instanced, hot->cold fade) — NOT
permanent hero meshes (draw budget). State is carried by the S3.2 amber/green ring.

DRAW BUDGET (S4.1 lesson): 8 visible draws total — 5 merged statics + turret_load +
mold_unit + torch_head. Co-moving parts are JOINED (join_named), never named-per-part.

Scene fit (derived from live anchors): fullplant cc slot slice4-local (5,0,0), ring r3.0,
LF neighbor at 0 (spacing 5), EAF footprint 5.8x4.0x4.0 -> caster 5.6 x 4.2, height ~4.0
(ladle rims; DRP 9.3 stays tallest). Built at FINAL scene size (scale 1). min-y = 0.
Strand runs +x (east, toward the billet yard). sme_pending: curve radius / stand count.

Run: blender --background --python hero_ccm.py -- <outdir>
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

M_steel_l = mat('steel_light', PAL['steel_light'], metallic=0.4, roughness=0.6)
M_steel_d = mat('steel_dark', PAL['steel_dark'], metallic=0.35, roughness=0.65)
M_copper = mat('mold_copper', PAL['copper'], metallic=0.8, roughness=0.3)
M_refract = mat('refractory', PAL['refractory'], metallic=0.05, roughness=0.9)
M_yellow = mat('hazard_yellow', PAL['paint_yellow'], metallic=0.2, roughness=0.6)
M_graph = mat('torch_body', PAL['graphite'], metallic=0.15, roughness=0.45)

# --- foundation (dark pad joins the steel_dark static group: 1 draw) ---
box('base_pad', S(5.6, 0.25, 4.2), L(0, 0.125, 0), M_steel_d)

# --- ladle turret: fixed column + rotating arm with two ladle seats ---
cyl('turret_column', 0.32, 2.5, L(-1.8, 1.5, 0), M_steel_d, verts=12)
cyl('turret_cap', 0.45, 0.2, L(-1.8, 2.85, 0), M_steel_l, verts=12)
p_turret = pivot('pivot_turret', L(-1.8, 2.95, 0))
box('turret_arm', S(3.6, 0.22, 0.55), L(-1.8, 2.95, 0), M_refract)
cone('ladle_a', 0.42, 0.55, 0.85, L(-0.5, 3.5, 0), M_refract, verts=12)
cyl('nozzle_a', 0.06, 0.3, L(-0.5, 2.92, 0), M_refract, verts=8)
cone('ladle_b', 0.42, 0.55, 0.85, L(-3.1, 3.5, 0), M_refract, verts=12)
# all co-rotate under pivot_turret, one material -> ONE draw
join_named(['turret_arm', 'ladle_a', 'nozzle_a', 'ladle_b'], 'turret_load', parent=p_turret)

# --- tundish (fixed, between active ladle and mold; joins steel_dark statics) ---
box('tundish', S(0.75, 0.4, 0.55), L(-0.5, 2.5, 0), M_steel_d)
box('tundish_rim', S(0.85, 0.1, 0.65), L(-0.5, 2.75, 0), M_steel_d)

# --- curved mold on the oscillation pivot (copper = the real mold material) ---
p_mold = pivot('pivot_mold', L(-0.5, 1.85, 0))
box('mold_block', S(0.55, 0.75, 0.55), L(-0.5, 1.85, 0), M_copper)
box('mold_flange', S(0.7, 0.12, 0.7), L(-0.5, 2.28, 0), M_copper)
join_named(['mold_block', 'mold_flange'], 'mold_unit', parent=p_mold)
# strand bends vertical -> horizontal: two fanned copper guide segments (static)
box('mold_curve_1', S(0.5, 0.3, 0.55), L(-0.42, 1.32, 0), M_copper, rot=R(0, 0, math.radians(-25)))
box('mold_curve_2', S(0.5, 0.28, 0.55), L(-0.18, 1.02, 0), M_copper, rot=R(0, 0, math.radians(-50)))

# --- roller table + straightener stands (the horizontal run, +x east) ---
box('table_bed', S(2.4, 0.14, 0.7), L(1.55, 0.68, 0), M_steel_d)
for i, rx in enumerate((0.55, 0.95, 1.35, 1.75, 2.15, 2.55)):
    cyl(f'table_roll_{i}', 0.09, 0.72, L(rx, 0.82, 0), M_steel_l, verts=8, rot=R(math.pi / 2, 0, 0))
for sx in (1.15, 1.75):
    for sz in (-0.4, 0.4):
        box(f'stand_post_{sx}_{sz}', S(0.14, 0.75, 0.14), L(sx, 1.15, sz), M_steel_l)
    box(f'stand_crown_{sx}', S(0.34, 0.16, 0.95), L(sx, 1.6, 0), M_steel_l)
    cyl(f'stand_roll_{sx}', 0.13, 0.8, L(sx, 1.25, 0), M_steel_l, verts=10, rot=R(math.pi / 2, 0, 0))

# --- cut-torch gantry (hazard yellow) + traveling torch head ---
for sz in (-0.55, 0.55):
    box(f'torch_post_{sz}', S(0.14, 1.3, 0.14), L(2.35, 0.9, sz), M_yellow)
box('torch_beam', S(0.18, 0.18, 1.3), L(2.35, 1.62, 0), M_yellow)
cone('torch_head', 0.09, 0.03, 0.3, L(2.35, 1.35, 0), M_graph, verts=8)

# --- electrical house + state-light mast (lamp itself = S3.2 ring, no extra draw) ---
box('electrical_house', S(1.0, 1.1, 0.8), L(-2.5, 0.8, 1.5), M_steel_d)
box('light_mast', S(0.12, 3.2, 0.12), L(-2.6, 1.85, -1.6), M_steel_l)

glb = os.path.join(outdir, 'ccm_hero.glb')
merge_static_by_material('ccm', exclude=('torch_head',))
export_glb(glb)
st = stats(glb)
budget_gate(st, 'CCM')
render_preview(os.path.join(outdir, 'ccm_hero_preview.png'),
               target=(0, 1.8, 0), dist=13, el_deg=30, az_deg=35)
print('CCM_BUILD_OK')
