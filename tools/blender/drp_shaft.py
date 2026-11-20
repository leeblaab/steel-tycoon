"""S1.3 hero swap #1 — procedural DRP shaft (FORGED F-01/F-06, PLAN_FORGED §2 silhouette).

Signature: tall vertical shaft + top charge conveyor + bustle ring + reformer boxes.
Tallest machine in the plant (~9.3 units vs EAF ~3-4).

ALL locations/sizes below are DESIGN coords (three.js Y-up: x, HEIGHT, z),
converted to Blender Z-up via L()/S(). Cylinders/cones stand along Blender Z
(= design height) by default; the Blender torus already lies horizontal.

Scene fit (derived from live code, not invented):
- slice3 standalone pad = 7.2 x 6.4 (main.tsx planeGeometry), label anchor y 9.4,
  status lamp y 9.2 -> hero footprint <= 7.2 x 6.4, top ~9.3.
- fullplant places DRP at slice3-local (-8, 0, 0); the S1.2 ore belt arrives at
  DRP-local (+6, 0) from the west -> charge conveyor rises on the EAST (+x) side.
- DRI discharge chute faces east (scene FlowPulse runs east to the DRI buffer).

Run: blender --background --python drp_shaft.py -- <outdir>
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steelx_hero_lib import (  # noqa: E402
    PAL, L, S, mat, clear_scene, box, cyl, cone, torus, pivot,
    merge_static_by_material, export_glb, stats, budget_gate, render_preview, outdir_from_args,
)
import bpy  # noqa: E402

outdir = outdir_from_args()
os.makedirs(outdir, exist_ok=True)
clear_scene()

M_dri = mat('dri_body', PAL['dri'], metallic=0.45, roughness=0.55)
M_steel = mat('steel', PAL['steel'], metallic=0.4, roughness=0.6)
M_steel_l = mat('steel_light', PAL['steel_light'], metallic=0.4, roughness=0.6)
M_steel_d = mat('steel_dark', PAL['steel_dark'], metallic=0.35, roughness=0.65)
M_ore = mat('ore_belt', PAL['ore'], metallic=0.0, roughness=0.95)
M_gas = mat('gas_pipe', PAL['gas'], metallic=0.3, roughness=0.5)
M_conc = mat('concrete', PAL['concrete'], metallic=0.0, roughness=0.95)

SX = -0.9  # shaft center x (west of pad center; conveyor owns the east side)

# --- foundation ---
box('base_plinth', S(7.2, 0.3, 6.4), L(0, 0.15, 0), M_conc)
cyl('shaft_skirt', 1.5, 1.2, L(SX, 0.9, 0), M_steel_d, verts=12)

# --- shaft (the signature: tallest vertical vessel) ---
cone('shaft', 1.3, 1.15, 5.6, L(SX, 4.3, 0), M_dri, verts=12)          # h 1.5..7.1
cone('shaft_top_dome', 1.15, 0.35, 0.7, L(SX, 7.45, 0), M_dri, verts=12)
box('top_house', S(1.6, 0.9, 1.6), L(SX, 8.25, 0), M_steel_l)          # charge house, top 8.7
cyl('beacon_mast', 0.05, 0.6, L(SX, 9.0, 0), M_steel_d, verts=6)       # top 9.3 (lamp anchor)

# --- bustle ring + gas circuit (reducing gas around the shaft) ---
p_bustle = pivot('pivot_bustle_ring', L(SX, 3.4, 0))
torus('bustle_ring', 1.55, 0.18, L(SX, 3.4, 0), M_steel_l,
      major_seg=12, minor_seg=8, parent=p_bustle)  # Blender torus is already horizontal
cyl('riser_pipe_a', 0.16, 3.6, L(SX, 5.2, 1.55), M_gas, verts=8)
cyl('riser_pipe_b', 0.16, 3.6, L(SX, 5.2, -1.55), M_gas, verts=8)
cyl('downcomer_a', 0.14, 3.0, L(SX - 1.0, 5.6, 1.2), M_steel, verts=8)
cyl('downcomer_b', 0.14, 3.0, L(SX + 1.0, 5.6, -1.2), M_steel, verts=8)

# --- reformer boxes (west flank: where the reducing gas is made) ---
for side, z in (('left', 1.85), ('right', -1.85)):
    box(f'reformer_{side}', S(1.3, 2.8, 1.4), L(-2.9, 1.7, z), M_steel_l)
    cyl(f'reformer_stack_{side}', 0.18, 1.2, L(-2.9, 3.7, z), M_steel_d, verts=8)
box('gas_header', S(0.25, 0.25, 3.7), L(-2.2, 3.2, 0), M_gas)

# --- top charge conveyor (east incline gallery; the ore belt feeds its foot) ---
foot = (3.3, 0.4, 0)   # design coords
top = (SX, 8.1, 0)
dx, dy = top[0] - foot[0], top[1] - foot[1]
length = math.hypot(dx, dy)
ang = math.atan2(dy, dx)          # design rotation about Z (incline in XY plane)
p_charge = pivot('pivot_charge_conveyor', L(*foot))
p_charge.rotation_euler = (0, -ang, 0)  # design rotZ(ang) -> Blender rotY(-ang)
bpy.context.view_layer.update()


def world_of(local):
    """Pivot-local (x along incline, y normal) -> DESIGN world, so children land ON the incline."""
    ca, sa = math.cos(ang), math.sin(ang)
    return (foot[0] + local[0] * ca - local[1] * sa,
            foot[1] + local[0] * sa + local[1] * ca,
            foot[2] + local[2])


box('charge_gallery', S(length, 0.5, 0.8), L(*world_of((length / 2, 0, 0))), M_steel, rot=(0, -ang, 0), parent=p_charge)
box('charge_belt', S(length, 0.06, 0.6), L(*world_of((length / 2, 0.28, 0))), M_ore, rot=(0, -ang, 0), parent=p_charge)
# support legs (world-vertical under the gallery)
for lx in (2.0, 0.2):
    gy = foot[1] + (foot[0] - lx) / (foot[0] - top[0]) * dy  # gallery underside height
    for lz in (0.3, -0.3):
        box(f'conveyor_leg_{lx}_{lz}', S(0.18, gy - 0.3, 0.18), L(lx, 0.3 + (gy - 0.3) / 2, lz), M_steel_d)

# --- DRI discharge (east, toward the buffer conveyor) + access ladder ---
box('dri_discharge_chute', S(1.2, 0.4, 0.5), L(0.5, 0.5, 0), M_steel_d)
box('access_ladder', S(0.1, 7.0, 0.3), L(SX + 1.32, 4.0, 0.9), M_steel_d)

glb = os.path.join(outdir, 'drp_shaft.glb')
merge_static_by_material('drp')  # statics -> 1 draw/material; pivot parts stay named
export_glb(glb)
st = stats(glb)
budget_gate(st, 'DRP')
render_preview(os.path.join(outdir, 'drp_shaft_preview.png'),
               target=(0, 4.2, 0), dist=21, el_deg=30, az_deg=35)
print('DRP_BUILD_OK')
