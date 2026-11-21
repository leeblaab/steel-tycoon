"""S5.4-prep hero swaps #5/#6 — procedural GANTRY YARD (billet yard + product yard).

WHY: the slice5/fullplant yards were inline box stand-ins with MIXED scale math
(gantry posts placed in bay coords but scaled 0.6x -> columns short of the runway;
crane group offset [0,-1,-6] buried the bridge; racks/billets on a third axis).
Yasser 21.11: "not matching coordinates, little random parts thrown everywhere,
they duplicate of each other". This hero bakes ONE coherent yard at final size —
floor plate, runway rails ON real columns, cross ties, storage racks per bay, and
an overhead gantry crane riding the rails — all aligned by construction.

ONE script, two GLBs (identical geometry, different stock color), so the two yards
stay honest siblings: billet yard = tan hot-billet bars, product yard = green
rebar bundles. Fill level stays renderer-side (tonnes -> show/hide per-bay groups).

PIVOTS / animatable parts (renderer drives them; shipped unparented at rest pose,
renderer re-parents by name — same seam as charge_gate):
- crane_bridge: slides along z (travel); renderer groups trucks/ropes/hook/payload
  under it with offsets relative to the bridge rest position.
- stock_b0..b4: per-bay merged bar stacks; renderer shows bays floor(5*frac) up.

Scene fit (final scene size, scale 1): local x -2.6..2.6 (runway columns),
z 0..11.4 (5 bays @ pitch 1.92 from z=2.16), height <= 4.7. min-y = 0 grounded.

Run: blender --background --python hero_gantry_yard.py -- <outdir>
"""
import os
import sys

import bpy  # noqa: E402  (runs inside Blender)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steelx_hero_lib import (  # noqa: E402
    PAL, L, S, mat, clear_scene, box,
    merge_static_by_material, export_glb, stats, budget_gate, render_preview, outdir_from_args,
)

outdir = outdir_from_args()
os.makedirs(outdir, exist_ok=True)

# Layout constants (final scene size — mirrors the fixed yard plot; deterministic).
BAY_Z0, BAY_PITCH, N_BAYS = 2.16, 1.92, 5          # bay centres z = 2.16 .. 9.84
COL_Z0, COL_Z1 = 1.32, 10.68                       # column-pair z's (rails span these)
RAIL_LEN = COL_Z1 - COL_Z0 + 1.2                   # rail beam length (overhang .6 each end)
RAIL_CZ = (COL_Z0 + COL_Z1) / 2                    # rail centre z
BRIDGE_Y, HOOK_Y = 4.32, 3.55                      # crane riding height / hoist rest


def bay_z(i):
    return BAY_Z0 + i * BAY_PITCH


CRANE_REST_Z = bay_z(2)                            # crane rest pose = middle bay


def build_yard(stock_hex: str, glb_name: str, label: str):
    clear_scene()

    M_steel_l = mat('steel_light', PAL['steel_light'], metallic=0.4, roughness=0.6)
    M_steel_d = mat('steel_dark', PAL['steel_dark'], metallic=0.35, roughness=0.65)
    M_paint = mat('paint_yellow', PAL['paint_yellow'], metallic=0.2, roughness=0.7)
    M_stock = mat('stock', stock_hex, metallic=0.4, roughness=0.55)

    # ---------- Ground: yard floor plate (grounded at y=0, top face 0.04) ----------
    box('yard_floor', S(5.6, 0.04, RAIL_LEN + 1.2), L(0, 0.02, RAIL_CZ), M_steel_d)

    # ---------- Runway: columns + rail beams resting ON column tops ----------
    for x in (-2.6, 2.6):
        for z in (COL_Z0, COL_Z1):
            box(f'col_{x}_{z}', S(0.34, 4.38, 0.34), L(x, 2.19, z), M_steel_l)
        box(f'rail_{x}', S(0.36, 0.22, RAIL_LEN), L(x, 4.49, RAIL_CZ), M_steel_l)  # base 4.38 = column top
    # cross tie beams between the rails at each column line (portal frame look)
    for z in (COL_Z0, COL_Z1):
        box(f'tie_{z}', S(5.2, 0.2, 0.24), L(0, 4.6, z), M_steel_l)

    # ---------- Storage racks: one per bay (two skid rails along x, grounded) ----------
    for i in range(N_BAYS):
        zb = bay_z(i)
        for dz in (-0.55, 0.55):
            box(f'rack_{i}_{dz}', S(4.4, 0.26, 0.3), L(0, 0.17, zb + dz), M_steel_d)

    # ---------- Stock rows: per-bay merged nodes (renderer shows/hides by tonnes) ---
    for i in range(N_BAYS):
        zb = bay_z(i)
        for k in range(9):
            row, col = k % 3, k // 3               # 3 across the bay, 3 high
            box(f'stock_b{i}_{k}', S(4.2, 0.15, 0.15),
                L(0, 0.38 + col * 0.17, zb - 0.44 + row * 0.44), M_stock)

    # ---------- Overhead gantry crane RIDING the rails (end trucks wrap rail tops) --
    box('crane_bridge', S(5.24, 0.36, 0.6), L(0, BRIDGE_Y, CRANE_REST_Z), M_paint)
    for dx in (-2.6, 2.6):                          # trucks wrap rails (rail inside shell)
        box(f'truck_{dx}', S(0.56, 0.62, 0.9), L(dx, 4.49, CRANE_REST_Z), M_paint)
    for dx in (-1.1, 1.1):                          # trolley wheels ON the bridge top
        box(f'trolley_wheel_{dx}', S(0.3, 0.16, 0.5), L(dx, 4.58, CRANE_REST_Z), M_steel_l)
    box('crane_hook', S(0.5, 0.42, 0.6), L(0, HOOK_Y, CRANE_REST_Z), M_steel_l)
    for dx in (-0.18, 0.18):                        # hoist ropes (static merge keeps them)
        box(f'rope_{dx}', S(0.07, BRIDGE_Y - HOOK_Y + 0.34, 0.07),
            L(dx, (BRIDGE_Y + HOOK_Y) / 2, CRANE_REST_Z), M_paint)
    # payload stand-in (hidden at runtime unless carrying; single bar shape)
    box('crane_payload', S(4.2, 0.15, 0.15), L(0, 3.16, CRANE_REST_Z), M_stock)

    # ---------- Draw-budget merge (crane parts + per-bay stock nodes stay separate) --
    bay_nodes = tuple(f'stock_b{i}' for i in range(N_BAYS))
    for i in range(N_BAYS):  # join each bay's bars FIRST -> named nodes survive the merge
        objs = [bpy.data.objects[f'stock_b{i}_{k}'] for k in range(9)]
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        bpy.context.object.name = bay_nodes[i]
    merge_static_by_material(label, exclude=bay_nodes + ('crane_bridge', 'truck_-2.6',
                                                         'truck_2.6', 'crane_hook',
                                                         'crane_payload', 'rope_-0.18', 'rope_0.18'))

    glb = os.path.join(outdir, glb_name)
    export_glb(glb)
    budget_gate(stats(glb), label.upper())
    return glb


build_yard('#c9a15a', 'gantry_yard_billet.glb', 'yard_billet')   # hot-billet tan
build_yard('#4fae7d', 'gantry_yard_product.glb', 'yard_product')  # rebar-bundle green

# Preview render LAST (ground/camera added after the real GLBs are exported).
render_preview(os.path.join(outdir, 'gantry_yard_hero.png'), target=(0, 2.2, 6.0), dist=17, el_deg=24, az_deg=35)
