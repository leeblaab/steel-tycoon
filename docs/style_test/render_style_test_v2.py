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

def render(scene, w=900, h=600, bg=(24,28,34)):
    az, el = math.radians(45), math.radians(32)   # shared camera for both variants
    scene.set_camera(angles=(math.degrees(el), math.degrees(az), 0), distance=14, center=(0,0,1.0))
    img = scene.save_image(resolution=(w,h), background=bg)
    return Image.open(__import__('io').BytesIO(img))

# ---------- VARIANT A: Kenney CC0 assembly, DRP footprint 3x2 cells (1 cell = 2 m) ----------
scA = trimesh.scene.Scene()
add_box(scA, [6.0, 4.0, 0.06], (0, 0, 0.03), PAL['concrete'])            # ground slab
place(scA, 'city-kit-industrial/building-m.glb', (-1.2, 0.6, 0.06), PAL['concrete'])   # plant hall
place(scA, 'factory-kit/pipe-large.glb', (1.2, -0.4, 1.06), PAL['steel'])               # shaft base
place(scA, 'factory-kit/pipe-large-long.glb', (1.2, -0.4, 2.6), PAL['steel'], rot_z=90) # shaft top
place(scA, 'city-kit-industrial/chimney-medium.glb', (-2.4, -1.2, 0.06), PAL['dark'])   # chimney
place(scA, 'factory-kit/machine.glb', (0.2, -1.4, 0.06), PAL['hot'])                     # reformer/hot zone
place(scA, 'factory-kit/conveyor-long.glb', (2.6, -1.6, 0.06), PAL['teal'])              # ore belt
place(scA, 'factory-kit/conveyor-corner.glb', (2.6, 0.4, 0.06), PAL['teal'])
place(scA, 'factory-kit/box-large.glb', (2.2, 1.2, 0.06), PAL['ore_red'])                # ore pile
place(scA, 'factory-kit/box-wide.glb', (1.4, 1.4, 0.06), PAL['ore_red'])
imgA = render(scA)

# ---------- VARIANT B: Blender-style blockout, same camera, same palette ----------
scB = trimesh.scene.Scene()
add_box(scB, [6.0, 4.0, 0.06], (0, 0, 0.03), PAL['concrete'])
add_box(scB, [1.2, 1.2, 3.2], (1.2, -0.4, 1.66), PAL['steel'])           # shaft tower
cone = trimesh.creation.cone(radius=0.8, height=0.9); cone.apply_translation((1.2, -0.4, 3.86))
scB.add_geometry(color_geom(cone, PAL['hot']))                                                    # hot cap
add_box(scB, [2.6, 2.0, 1.1], (-1.2, 0.6, 0.61), PAL['concrete'])        # hall
add_box(scB, [2.6, 2.0, 0.12], (-1.2, 0.6, 1.22), PAL['dark'])           # roof
cyl = trimesh.creation.cylinder(radius=0.22, height=1.9); cyl.apply_translation((-2.4, -1.2, 1.01))
scB.add_geometry(color_geom(cyl, PAL['dark']))                                                     # chimney
add_box(scB, [3.0, 0.5, 0.12], (2.2, -1.6, 0.12), PAL['teal'])           # belt ribbon
pile = trimesh.creation.cone(radius=1.0, height=0.7); pile.apply_translation((1.8, 1.2, 0.41))
scB.add_geometry(color_geom(pile, PAL['ore_red']))                                                    # ore pile
imgB = render(scB)

combo = Image.new('RGB', (1810, 640), (24, 28, 34))
combo.paste(imgA, (5, 10)); combo.paste(imgB, (910, 10))
d = ImageDraw.Draw(combo)
try: font = ImageFont.truetype('arial.ttf', 22)
except Exception: font = ImageFont.load_default()
d.text((15, 612), 'Variant A - Kenney CC0 assembly', fill=(230,230,230), font=font)
d.text((920, 612), 'Variant B - Blender-style blockout', fill=(230,230,230), font=font)
combo.save(os.path.join(BASE, 'side_by_side.png'))
imgA.save(os.path.join(BASE, 'variant_a_kenney.png'))
imgB.save(os.path.join(BASE, 'variant_b_blockout.png'))
print('saved to', BASE)
