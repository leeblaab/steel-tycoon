"""SteelX procedural hero library — FORGED F-01 ("Factorio-flat-3D").

Blender 5.x headless. Conventions:
- 1 Blender unit = 1 scene unit (heroes are built at FINAL scene size; scene scale = 1).
- Y-up glTF export (three.js convention).
- Flat-shaded low-poly; stream-color material slots mirror web palette.ts.
- Deterministic: no RNG anywhere. Same script -> byte-identical geometry.
- Budget per hero: < 2,500 tris, < 150 KB GLB, named semantic parts + pivot empties.

Color pipeline note: palette.ts hex values are sRGB; three.js converts them to
linear at material creation. glTF baseColorFactor is LINEAR, so we convert
sRGB -> linear here; the loaded GLB then matches the in-game palette exactly.
"""
import bpy
import math
import os
import sys
import json

# palette.ts STREAM + the scene's steel/concrete tones (main.tsx mesh colors).
PAL = {
    'ore': '#6e3b2e',          # pellets / charge belt
    'dri': '#9aa3ad',          # DRI shaft body (product stream)
    'scrap': '#8a5a3c',
    'gas': '#d9c14a',          # utility gas pipes
    'water': '#3fa8a0',
    'hot_metal': '#ff9a3c',
    'steel': '#4a525c',        # structural steel (scene standard)
    'steel_light': '#565d66',
    'steel_dark': '#3a3f46',
    'concrete': '#3a3f46',
    'paint_yellow': '#c9a13f', # crane / hazard paint (scene RTG color)
    'hull_red': '#7a3b2e',     # bulk-carrier hull (rust red-brown, ore family)
    'hull_dark': '#2a3038',
    'deck': '#565d66',
    'house_white': '#9aa3ad',
    'copper': '#b87333',       # bus bars / copper conductors
    'graphite': '#23262b',     # electrodes (near-black, plan utilities grammar)
    'refractory': '#2a3038',   # furnace rim / ladle shell
}


def hex_to_rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))


def L(x, y, z):
    """Design location (three.js Y-up: x, HEIGHT, z) -> Blender Z-up (x, -z, y).
    Round-trips exactly through export_yup=True: glTF gets (x, y, z) back."""
    return (x, -z, y)


def S(x, y, z):
    """Design size (x, HEIGHT, z) -> Blender size (x, z, height)."""
    return (x, z, y)


def R(rx, ry, rz):
    """Design euler (three.js Y-up) -> Blender euler (Z-up): (rx, -rz, ry).
    Verified: design rotZ(a) -> Blender rotY(-a) (incline gallery);
    design rotY(a) -> Blender rotZ(a) (horizontal arm); design rotX shared."""
    return (rx, -rz, ry)


def srgb_to_linear(c):
    return tuple((v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c)


def mat(name, hex_color, metallic=0.3, roughness=0.7):
    m = bpy.data.materials.get(name)
    if m is not None:
        return m
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    lin = srgb_to_linear(hex_to_rgb(hex_color))
    bsdf.inputs['Base Color'].default_value = (lin[0], lin[1], lin[2], 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    m.diffuse_color = (lin[0], lin[1], lin[2], 1.0)  # Workbench MATERIAL preview color
    return m


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.cameras):
        for b in list(block):
            if b.users == 0:
                block.remove(b)


def _finish(o, name, material, parent):
    o.name = name
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(material)
    bpy.ops.object.shade_flat()
    if parent is not None:
        bpy.context.view_layer.update()  # parent.matrix_world is lazy — force before invert
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


def box(name, size, loc, material, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object
    o.scale = size
    return _finish(o, name, material, parent)


def cyl(name, r, depth, loc, material, verts=10, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.object, name, material, parent)


def cone(name, r_bottom, r_top, depth, loc, material, verts=10, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r_bottom, radius2=r_top, depth=depth, location=loc, rotation=rot)
    return _finish(bpy.context.object, name, material, parent)


def torus(name, major_r, minor_r, loc, material, major_seg=12, minor_seg=8, rot=(0, 0, 0), parent=None):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_r, minor_radius=minor_r,
                                     major_segments=major_seg, minor_segments=minor_seg,
                                     location=loc, rotation=rot)
    return _finish(bpy.context.object, name, material, parent)


def pivot(name, loc):
    """Named empty = animatable pivot node in the exported GLB."""
    bpy.ops.object.empty_add(type='PLAIN_AXES', location=loc)
    o = bpy.context.object
    o.name = name
    o.empty_display_size = 0.3
    return o


def join_named(parts, name, parent=None):
    """Join already-built meshes into ONE named mesh (1 draw), then parent.
    For parts that always animate TOGETHER under one pivot (e.g. EAF electrodes share
    one bore value; turret ladles+arm share one rotation). Geometry unchanged; the
    renderer addresses the joined name. S4.1 draw-budget lesson: named-per-part heroes
    blow the <=150 visible-draw budget — merge co-moving parts, keep only independently
    animated / emissive parts separate."""
    objs = [bpy.data.objects[n] if isinstance(n, str) else n for n in parts]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.object
    o.name = name
    if parent is not None:
        bpy.context.view_layer.update()
        o.parent = parent
        o.matrix_parent_inverse = parent.matrix_world.inverted()
    return o


def merge_static_by_material(hero_label, exclude=()):
    """Join UNPARENTED static meshes that share a material into one mesh per material
    (1 draw call each) — the visible-draw budget gate. Pivot-parented parts (animation)
    and named exclusions (runtime-moving/emissive parts) stay separate. Deterministic;
    call BEFORE export_glb. Tri count unchanged; node count drops."""
    groups = {}
    for o in list(bpy.data.objects):
        if o.type != 'MESH' or o.parent is not None or o.name in exclude:
            continue
        if not o.data.materials:
            continue
        groups.setdefault(o.data.materials[0].name, []).append(o)
    for matname, objs in groups.items():
        if len(objs) < 2:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        for o in objs:
            o.select_set(True)
        bpy.context.view_layer.objects.active = objs[0]
        bpy.ops.object.join()
        bpy.context.object.name = f'{hero_label}_static_{matname}'


def export_glb(filepath):
    bpy.ops.object.select_all(action='DESELECT')
    meshes = []
    for o in bpy.data.objects:
        if o.type in {'MESH', 'EMPTY'}:
            o.select_set(True)
            if o.type == 'MESH':
                meshes.append(o)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.export_scene.gltf(
        filepath=filepath,
        export_format='GLB',
        use_selection=True,
        export_yup=True,
        export_apply=True,
    )


def stats(filepath):
    deps = bpy.context.evaluated_depsgraph_get()
    tris = 0
    nodes = []
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for o in bpy.data.objects:
        if o.type == 'EMPTY':
            nodes.append(o.name + ' [pivot]')
            continue
        if o.type != 'MESH':
            continue
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        nodes.append(o.name)
        for v in me.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
        ev.to_mesh_clear()
    return {
        'tris': tris,
        'bytes': os.path.getsize(filepath),
        'nodes': nodes,
        'bbox_min_blender': [round(v, 3) for v in mn],
        'bbox_max_blender': [round(v, 3) for v in mx],
        'size_design_xyz': [round(mx[0] - mn[0], 3), round(mx[2] - mn[2], 3), round(mx[1] - mn[1], 3)],
        'height_range': [round(mn[2], 3), round(mx[2], 3)],
    }


def budget_gate(st, label, max_tris=2500, max_bytes=150000):
    ok = st['tris'] < max_tris and st['bytes'] < max_bytes
    print(f'{label}_STATS ' + json.dumps(st))
    print(f'{label}_BUDGET {"PASS" if ok else "FAIL"} (tris {st["tris"]}/{max_tris}, bytes {st["bytes"]}/{max_bytes})')
    assert ok, f'{label} budget exceeded'


def render_preview(png_path, target=(0, 3, 0), dist=22, el_deg=35, az_deg=30, res=(960, 720), ground=True):
    """Workbench (CPU) preview render — works headless, no GPU context needed.
    target is DESIGN coords (x, height, z). Added AFTER export so ground/camera
    never leak into the GLB."""
    scene = bpy.context.scene
    bt = L(*target)
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=80, location=(bt[0], bt[1], 0))
        g = bpy.context.object
        g.name = '__preview_ground'
        g.data.materials.append(mat('__ground', '#5a5b56', metallic=0.0, roughness=0.95))
        bpy.ops.object.shade_flat()
    tgt = pivot('__cam_target', bt)
    cam_data = bpy.data.cameras.new('__PreviewCam')
    cam_data.lens = 50
    cam = bpy.data.objects.new('__PreviewCam', cam_data)
    bpy.context.collection.objects.link(cam)
    el = math.radians(el_deg)
    az = math.radians(az_deg)
    cam.location = L(
        target[0] + dist * math.cos(el) * math.sin(az),
        target[1] + dist * math.sin(el),
        target[2] + dist * math.cos(el) * math.cos(az),
    )
    con = cam.constraints.new('TRACK_TO')
    con.target = tgt
    con.track_axis = 'TRACK_NEGATIVE_Z'
    con.up_axis = 'UP_Y'
    scene.camera = cam
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'MATERIAL'
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = 'BOTH'
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = res[0]
    scene.render.resolution_y = res[1]
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = png_path
    bpy.ops.render.render(write_still=True)
    print(f'RENDER_OK {png_path}')


def outdir_from_args(default='.'):
    if '--' in sys.argv:
        rest = sys.argv[sys.argv.index('--') + 1:]
        if rest:
            return rest[0]
    return default
