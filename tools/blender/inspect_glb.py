"""Inspect existing GLBs (Kenney kitbash sources for the jetty rebuild).
Run: blender --background --python inspect_glb.py -- <glb> [<glb> ...]
Prints node names, tri counts, bbox — no export, no scene changes kept.
"""
import os
import sys
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from steelx_hero_lib import clear_scene  # noqa: E402

argv = sys.argv
files = argv[argv.index('--') + 1:] if '--' in argv else []
for f in files:
    clear_scene()
    bpy = __import__('bpy')
    bpy.ops.import_scene.gltf(filepath=f)
    deps = bpy.context.evaluated_depsgraph_get()
    tris = 0
    nodes = []
    mn = [1e9] * 3
    mx = [-1e9] * 3
    for o in bpy.data.objects:
        if o.type != 'MESH':
            nodes.append(f'{o.name} [{o.type}]')
            continue
        ev = o.evaluated_get(deps)
        me = ev.to_mesh()
        me.calc_loop_triangles()
        tris += len(me.loop_triangles)
        nodes.append(f'{o.name} ({len(me.loop_triangles)} tris, mats={[m.name if m else None for m in me.materials]})')
        for v in me.vertices:
            w = o.matrix_world @ v.co
            for i in range(3):
                mn[i] = min(mn[i], w[i])
                mx[i] = max(mx[i], w[i])
        ev.to_mesh_clear()
    print('INSPECT ' + json.dumps({
        'file': f, 'bytes': os.path.getsize(f), 'tris': tris,
        'bbox_min': [round(v, 3) for v in mn], 'bbox_max': [round(v, 3) for v in mx],
        'size_xyz': [round(mx[i] - mn[i], 3) for i in range(3)],
        'nodes': nodes,
    }))
print('INSPECT_DONE')
