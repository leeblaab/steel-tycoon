# Path 2: Kenney CC0 GLBs -> Godot. No offline render demo.
# Rule: Godot renders the GLBs directly (fixed-tilt ortho camera, Sim City style).
# This script only assembles per-node GLBs from the approved mapping, with flat
# colors baked in (Yasser color grammar), so Godot shows colors without
# relying on Kenney's colormap texture. Simple assembly, no over-engineering.
# COLOR PITFALL (verified 2026-10-07 headless probe): Godot's GLB import reads
# VERTEX colors, not face colors — face-baked colors come back null on import.
# Bake vertex colors here so the colors survive import.
import trimesh, numpy as np, math, os, json

CC0 = r'C:\AI_LAB\SteelX\content\assets\models\cc0'
OUT = r'C:\AI_LAB\SteelX\godot\content\assets\models\cc0'
os.makedirs(OUT, exist_ok=True)

PAL = {  # SteelX color grammar (Yasser-approved)
    'concrete': (0.525, 0.545, 0.631),
    'steel':    (0.588, 0.608, 0.647),
    'ore_red':  (0.690, 0.376, 0.255),
    'scrap':    (0.392, 0.412, 0.431),
    'hot':      (1.0, 0.494, 0.267),
    'teal':     (0.302, 0.627, 0.588),
    'dark':     (0.302, 0.302, 0.412),
    'product':  (0.588, 0.608, 0.647),
}

# part -> color by role (simple rule, no per-part table)
def part_color(part):
    p = part.lower()
    if 'building' in p or 'floor' in p: return PAL['concrete']
    if 'chimney' in p: return PAL['dark']
    if 'container' in p: return PAL['teal']
    if 'conveyor' in p: return PAL['teal']
    if 'crane' in p: return PAL['dark']
    if 'box' in p: return PAL['scrap']
    if 'machine' in p or 'piston' in p: return PAL['hot']
    if 'tank' in p: return PAL['ore_red']
    return PAL['steel']

mapping = json.load(open(os.path.join(CC0, 'cc0_mapping_draft.json')))
report = []
for node, spec in mapping['nodes'].items():
    scene = trimesh.Scene()
    for part in spec['parts']:
        path = os.path.join(CC0, part if part.endswith('.glb') else part + '.glb')
        s = trimesh.load(path)
        geoms = list(s.geometry.values()) if isinstance(s, trimesh.Scene) else [s]
        for g in geoms:
            col = tuple(int(c*255) for c in part_color(part)) + (255,)
            vc = np.tile(np.array(col), (g.vertices.shape[0], 1))
            g.visual = trimesh.visual.ColorVisuals(mesh=g, vertex_colors=vc)
            scene.add_geometry(g)
    out = os.path.join(OUT, node + '.glb')
    scene.export(out)
    report.append((node, len(spec['parts']), len(scene.geometry), os.path.getsize(out)))

for r in report: print(r)
print('total nodes:', len(report))
