# Sim-City Blockout Demo — full plant, one render
# Rules: Kenney CC0 parts, flat face colors, simple blockout shapes, fixed 32-deg camera.
import trimesh, numpy as np, math, os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
CC0 = os.path.dirname(BASE)

PAL = {  # SteelX color grammar (Yasser-approved)
    'concrete': (0.525, 0.545, 0.631),
    'steel':    (0.588, 0.608, 0.647),
    'ore_red':  (0.690, 0.376, 0.255),
    'scrap':    (0.392, 0.412, 0.431),
    'hot':      (1.0, 0.494, 0.267),
    'teal':     (0.302, 0.627, 0.588),
    'dark':     (0.302, 0.302, 0.412),
    'product':  (0.588, 0.608, 0.647),   # product steel = grey (Yasser correction)
}

def color_geom(geom, color):
    geom.visual = trimesh.visual.ColorVisuals(mesh=geom, face_colors=np.tile(np.array(color)+(255,), (geom.faces.shape[0],)))
    return geom

def load_glb(path):
    s = trimesh.load(os.path.join(CC0, path))
    return s if isinstance(s, trimesh.Scene) else trimesh.Scene(s)

def place(scene, glb_path, pos, color, rot_z=0.0):
    s = load_glb(glb_path)
    for geom in s.geometry.values():
        g = geom.copy()
        if rot_z:
            g.apply_transform(trimesh.transformations.rotation_matrix(math.radians(rot_z), [0,0,1]))
        g.apply_translation(pos)
        scene.add_geometry(color_geom(g, color))

def add_box(scene, extents, pos, color):
    b = trimesh.creation.box(extents=extents)
    b.apply_translation(pos)
    scene.add_geometry(color_geom(b, color))

def render(scene, w=1400, h=900, bg=(24,28,34)):
    az, el = math.radians(45), math.radians(32)
    scene.set_camera(angles=(math.degrees(el), math.degrees(az), 0), distance=48, center=(0,0,1.0))
    img = scene.save_image(resolution=(w,h), background=bg)
    return Image.open(__import__('io').BytesIO(img))

# Level 1 guided-sequence layout (left-to-right flow, Sim City snake). Cell = 2 m.
L = 2.0
NODES = {  # id: (grid_x, grid_y, footprint_w, footprint_h)
    'jetty':        (0, 0, 3, 2),
    'scrap_yard':   (0, 4, 3, 3),
    'drp':          (4, 0, 3, 2),
    'eaf':          (8, 0, 3, 3),
    'lf':           (12, 0, 2, 2),
    'cc':           (14, 0, 2, 4),
    'billet_yard':  (17, 0, 2, 3),
    'bar_mill':     (17, 4, 2, 4),
    'wire_rod_mill':(12, 4, 2, 4),
    'dispatch':     (15, 4, 2, 3),
}

def footprint_center(nid):
    gx, gy, w, h = NODES[nid]
    return ((gx + w/2.0)*L, (gy + h/2.0)*L)

sc = trimesh.scene.Scene()

# ground slab (single slab — road/green pack pending)
add_box(sc, [40.0, 16.0, 0.05], (19.0, 7.0, 0.025), PAL['concrete'])

def node_blockout(nid, parts):
    cx, cy = footprint_center(nid)
    gx, gy, w, h = NODES[nid]
    add_box(sc, [w*L*0.9, h*L*0.9, 0.9], (cx, cy, 0.5), PAL['concrete'])  # simple hall
    for p in parts:
        place(sc, p[0], (cx + p[1]*L, cy + p[2]*L, 0.95 + p[3]), PAL[p[4]], rot_z=p[5] if len(p) > 5 else 0.0)

node_blockout('jetty', [('city-kit-industrial/shipping-container-a.glb', -0.8, 0, 0, 'teal'),
                        ('factory-kit/crane.glb', 0.8, 0, 0, 'dark')])
node_blockout('scrap_yard', [('factory-kit/crane-magnet.glb', 0, 0.8, 0, 'dark'),
                             ('factory-kit/box-large.glb', -0.8, -0.5, 0, 'scrap')])
node_blockout('drp', [('city-kit-industrial/chimney-medium.glb', -1.0, 0.5, 0, 'dark'),
                      ('factory-kit/machine.glb', 0.8, -0.5, 0, 'hot'),
                      ('factory-kit/box-large.glb', 0.5, 0.8, 0, 'ore_red')])
node_blockout('eaf', [('city-kit-industrial/chimney-large.glb', -1.0, 0.5, 0, 'dark'),
                      ('factory-kit/piston-round.glb', 0.8, -0.5, 0, 'hot'),
                      ('factory-kit/box-wide.glb', -0.5, -0.8, 0, 'scrap')])
node_blockout('lf', [('factory-kit/machine.glb', 0, 0, 0, 'hot')])
node_blockout('cc', [('factory-kit/structure-tall.glb', 0, 0, 0, 'steel'),
                     ('factory-kit/machine.glb', 0, 0.8, 0, 'hot')])
node_blockout('billet_yard', [('factory-kit/box-wide.glb', 0, 0, 0, 'product'),
                              ('factory-kit/crane.glb', 0.5, 0.8, 0, 'dark')])
node_blockout('bar_mill', [('factory-kit/machine-bed.glb', 0, 0, 0, 'steel'),
                           ('factory-kit/box-wide.glb', 0, 1.0, 0, 'product')])
node_blockout('wire_rod_mill', [('factory-kit/machine-bed.glb', 0, 0, 0, 'steel'),
                                ('factory-kit/box-wide.glb', 0, 1.0, 0, 'product')])
node_blockout('dispatch', [('factory-kit/crane.glb', 0, 0, 0, 'dark'),
                           ('city-kit-industrial/shipping-container-b.glb', 0.5, 0.8, 0, 'product')])

# belts: repeatable segments between footprint centers, material-colored
BELTS = [
    ('jetty', 'drp', 'ore_red'),
    ('scrap_yard', 'eaf', 'scrap'),
    ('drp', 'eaf', 'ore_red'),
    ('eaf', 'lf', 'hot'),
    ('lf', 'cc', 'hot'),
    ('cc', 'billet_yard', 'hot'),
    ('billet_yard', 'bar_mill', 'product'),
    ('billet_yard', 'wire_rod_mill', 'product'),
    ('bar_mill', 'dispatch', 'product'),
    ('wire_rod_mill', 'dispatch', 'product'),
]
for a, b, col in BELTS:
    ax, ay = footprint_center(a); bx, by = footprint_center(b)
    dist = math.hypot(bx-ax, by-ay)
    n = max(1, int(dist // L))
    for i in range(n):
        t = (i + 0.5) / n
        x, y = ax + (bx-ax)*t, ay + (by-ay)*t
        add_box(sc, [L*0.9, L*0.35, 0.12], (x, y, 0.12), PAL[col])

img = render(sc)
combo = Image.new('RGB', (1400, 940), (24,28,34))
combo.paste(img, (0, 0))
d = ImageDraw.Draw(combo)
try: font = ImageFont.truetype('arial.ttf', 20)
except Exception: font = ImageFont.load_default()
d.text((10, 912), 'Sim-City blockout demo - Level 1 full plant - Kenney CC0, flat colors, fixed 32deg camera', fill=(230,230,230), font=font)
combo.save(os.path.join(BASE, 'simcity_demo.png'))
print('saved', os.path.join(BASE, 'simcity_demo.png'))
