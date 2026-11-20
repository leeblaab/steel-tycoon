"""S1.3 hero swap #1b — jetty rebuild: Kenney kitbash + procedural pier (PLAN_FORGED S1.3).

Kitbash sources (existing, Kenney-derived, already in repo):
- slice1/browser/assets/ship.glb  (850 tris, cargo ship, long axis Blender Y)
- slice1/browser/assets/crane.glb (564 tris, harbor crane with arm)
Procedural: pier deck on piles, quay edge, bollards, crane rails, grab + cable.

Design coords (three.js Y-up) via L()/S(). Model origin = QUAY EDGE (x=0);
pier extends -x into the water; fullplant places it at slice1-local (-5, 0, 0)
so the water rect (local x -19..-5) receives the ship. Ship sets world scale.

Named pivots: pivot_crane (rail travel), pivot_ship (future berth arrival/departure).

Run: blender --background --python jetty_pier.py -- <outdir> <assets_dir>
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steelx_hero_lib import (  # noqa: E402
    PAL, L, S, mat, clear_scene, box, cyl, pivot,
    export_glb, stats, budget_gate, render_preview, outdir_from_args,
)
import bpy  # noqa: E402
from mathutils import Vector, Matrix  # noqa: E402

argv = sys.argv
rest = argv[argv.index('--') + 1:] if '--' in argv else []
outdir = rest[0] if rest else '.'
assets = rest[1] if len(rest) > 1 else 'C:/AI_LAB/SteelX/web/src/ports/slice1/browser/assets'
os.makedirs(outdir, exist_ok=True)
clear_scene()

M_conc = mat('concrete', PAL['concrete'], metallic=0.0, roughness=0.95)
M_steel = mat('steel', PAL['steel'], metallic=0.4, roughness=0.6)
M_steel_d = mat('steel_dark', PAL['steel_dark'], metallic=0.35, roughness=0.65)
M_paint = mat('crane_paint', PAL['paint_yellow'], metallic=0.3, roughness=0.55)


def world_bbox(objs):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
    return mn, mx


def import_centered(path):
    """Import a GLB and re-center its combined XY bbox on the origin (Z untouched)."""
    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.import_scene.gltf(filepath=path)
    objs = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    bpy.context.view_layer.update()
    mn, mx = world_bbox(objs)
    cx, cy = (mn.x + mx.x) / 2, (mn.y + mx.y) / 2
    for o in objs:
        o.location.x -= cx
        o.location.y -= cy
    bpy.context.view_layer.update()
    return objs


def parent_to(objs, p):
    """Kitbash parts are pre-centered at the origin: bind with IDENTITY inverse so the
    pivot's full transform (location/rotation/scale) PLACES them. (The inverse-cancel
    pattern in _finish is for children already built at their final world position.)"""
    bpy.context.view_layer.update()
    ident = Matrix.Identity(4)
    for o in objs:
        o.parent = p
        o.matrix_parent_inverse = ident


# --- procedural pier (origin at quay edge, deck reaches -x over the water) ---
box('pier_deck', S(7.0, 0.5, 4.6), L(-3.5, 1.0, 0), M_conc)
box('quay_edge', S(0.5, 1.3, 4.6), L(0.25, 0.65, 0), M_conc)
for px in (-1.5, -3.5, -5.5):
    for pz in (-1.6, 1.6):
        # piles stop AT the waterline (min y = 0): both scenes seat GLBs by bbox-min,
        # so anything below 0 would lift the whole hero and float the ship.
        cyl(f'pile_{px}_{pz}', 0.22, 1.1, L(px, 0.55, pz), M_steel_d, verts=8)
for bz in (-1.5, 1.5):
    cyl(f'bollard_{bz}', 0.12, 0.35, L(-0.3, 1.42, bz), M_steel_d, verts=8)
for rz in (-2.0, 2.0):
    box(f'crane_rail_{rz}', S(6.5, 0.08, 0.12), L(-3.5, 1.29, rz), M_steel)

# --- Kenney crane on the rails (arm toward the ship = -x; orientation verified in render) ---
crane_objs = import_centered(os.path.join(assets, 'crane.glb'))
p_crane = pivot('pivot_crane', L(-4.0, 1.25, 0))
p_crane.rotation_euler = (0, 0, math.pi / 2)
p_crane.scale = (1.1, 1.1, 1.1)
parent_to(crane_objs, p_crane)
# grab unloader boom extension: the Kenney arm tip reaches ~x -6.0, short of the ship
# (near edge -7.06) — extend the boom over the hold, then hang cable + grab under it.
box('boom_extension', S(3.4, 0.22, 0.22), L(-7.4, 4.5, 0), M_paint, parent=p_crane)
cyl('crane_cable', 0.03, 1.4, L(-8.6, 3.8, 0), M_steel_d, verts=6, parent=p_crane)
box('crane_grab', S(0.55, 0.45, 0.55), L(-8.6, 2.875, 0), M_paint, parent=p_crane)

# --- Kenney ship alongside (long axis along the berth; hull bottom at waterline) ---
ship_objs = import_centered(os.path.join(assets, 'ship.glb'))
p_ship = pivot('pivot_ship', L(-9.2, 0.0, 0))
p_ship.scale = (1.09, 1.09, 1.09)
parent_to(ship_objs, p_ship)

glb = os.path.join(outdir, 'jetty_pier.glb')
export_glb(glb)
st = stats(glb)
budget_gate(st, 'JETTY')

# preview-only water patch (AFTER export — never in the GLB)
M_water = mat('__water', '#1d3a52', metallic=0.1, roughness=0.4)
box('__preview_water', S(14, 0.02, 16), L(-12, 0.005, 0), M_water)
render_preview(os.path.join(outdir, 'jetty_pier_preview.png'),
               target=(-4.5, 2.2, 0), dist=27, el_deg=30, az_deg=35)
print('JETTY_BUILD_OK')
