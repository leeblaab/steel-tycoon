import trimesh, pyrender, numpy as np, math, os
from PIL import Image

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, 'style_test')
os.makedirs(OUT, exist_ok=True)

# SteelX color grammar (Yasser-approved): concrete/steel grey, ore red, scrap grey, hot orange, transport teal
PAL = {
    'concrete': (0.525, 0.545, 0.631),
    'steel':    (0.588, 0.608, 0.647),
    'ore_red':  (0.690, 0.376, 0.255),
    'scrap':    (0.392, 0.412, 0.431),
    'hot':      (1.0, 0.494, 0.267),
    'teal':     (0.302, 0.627, 0.588),
    'dark':     (0.302, 0.302, 0.412),
}

def flat_mat(color):
    return pyrender.MetallicRoughnessMaterial(
        baseColorFactor=color + (1.0,), metallicFactor=0.0, roughnessFactor=0.8)

def load_glb(path):
    s = trimesh.load(path)
    return s if isinstance(s, trimesh.Scene) else trimesh.Scene(s)

def render(sc, w=900, h=600, bg=(0.145, 0.165, 0.204)):
    r = pyrender.OffscreenRenderer(w, h)
    az, el = math.radians(45), math.radians(32)   # shared camera: fixed tilt, 2:1-ish
    dist = 12.0
    eye = np.array([math.cos(el)*math.cos(az), math.cos(el)*math.sin(az), math.sin(el)]) * dist
    T = np.eye(4); T[:3, 3] = eye
    # look at origin
    fwd = -eye / np.linalg.norm(eye)
    up = np.array([0, 0, 1.0])
    right = np.cross(fwd, up); right /= np.linalg.norm(right)
    trueup = np.cross(right, fwd)
    R = np.column_stack([right, trueup, fwd])
    pose = np.eye(4); pose[:3, :3] = R; pose[:3, 3] = eye
    cam = pyrender.OrthographicCamera(xmag=7.0, ymag=7.0*h/w, zfar=40.0)
    sc.add(cam, pose=pose)
    light = pyrender.DirectionalLight(color=np.array([1.0, 1.0, 1.0]), intensity=1.5)
    lp = np.eye(4); lp[:3, 3] = np.array([4, -6, 8])
    # orient light toward origin
    lf = -lp[:3, 3] / np.linalg.norm(lp[:3, 3])
    lr = np.cross(lf, np.array([0,0,1.0])); lr /= np.linalg.norm(lr)
    lu = np.cross(lr, lf)
    lR = np.column_stack([lr, lu, lf]); lp[:3, :3] = lR
    sc.add(light, pose=lp)
    amb = pyrender.Scene()  # not used; ambient via clear color trick below
    rgb, depth = r.render(sc)
    # composite over background
    mask = depth > 0
    out = np.full_like(rgb, np.array([int(c*255) for c in bg]))
    out[mask] = rgb[mask]
    r.delete()
    return Image.fromarray(out)

def place(scene, glb_path, pos, color, rot_z=0.0, scale=1.0):
    s = load_glb(glb_path)
    for geom in s.geometry.values():
        g = geom.copy()
        g.apply_scale(scale)
        if rot_z:
            R = trimesh.transformations.rotation_matrix(math.radians(rot_z), [0,0,1])
            g.apply_transform(R)
        g.apply_translation(pos)
        scene.add(pyrender.Mesh.from_trimesh(g, material=flat_mat(color)))

# ---------------- VARIANT A: Kenney assembly (DRP, footprint 3x2 cells = 6x4 m) ----------------
scA = pyrender.Scene()
# ground slab 6x4 m
slab = trimesh.creation.box(extents=[6.0, 4.0, 0.06])
slab.apply_translation([0, 0, 0.03])
scA.add(pyrender.Mesh.from_trimesh(slab, material=flat_mat(PAL['concrete'])))
# building shell (building-m ~1.3x1.5x1.7)
place(scA, 'city-kit-industrial/building-m.glb', (-1.2, 0.6, 0.06), PAL['concrete'])
# long shaft: pipe-large stack (reduction shaft)
place(scA, 'factory-kit/pipe-large.glb', (1.2, -0.4, 1.06), PAL['steel'])
place(scA, 'factory-kit/pipe-large-long.glb', (1.2, -0.4, 2.6), PAL['steel'], rot_z=90)
# chimney
place(scA, 'city-kit-industrial/chimney-medium.glb', (-2.4, -1.2, 0.06), PAL['dark'])
# reformer/hot zone marker
place(scA, 'factory-kit/machine.glb', (0.2, -1.4, 0.06), PAL['hot'])
# ore conveyor arriving (teal transport)
for i in range(3):
    place(scA, 'factory-kit/conveyor-long.glb', (2.6, -1.6 + i*0.0, 0.06), PAL['teal'])
place(scA, 'factory-kit/conveyor-long.glb', (2.6, -1.6, 0.06), PAL['teal'])
# ore pile (ore red boxes)
place(scA, 'factory-kit/box-large.glb', (2.2, 1.2, 0.06), PAL['ore_red'])
place(scA, 'factory-kit/box-wide.glb', (1.4, 1.4, 0.06), PAL['ore_red'])
imgA = render(scA)
imgA.save(os.path.join(OUT, 'variant_a_kenney.png'))

# ---------------- VARIANT B: Blender-style blockout (same camera, same palette) ----------------
scB = pyrender.Scene()
slab2 = trimesh.creation.box(extents=[6.0, 4.0, 0.06])
slab2.apply_translation([0, 0, 0.03])
scB.add(pyrender.Mesh.from_trimesh(slab2, material=flat_mat(PAL['concrete'])))
# stylized shaft tower: tapered box + cap
tower = trimesh.creation.box(extents=[1.2, 1.2, 3.2])
tower.apply_translation([1.2, -0.4, 1.66])
scB.add(pyrender.Mesh.from_trimesh(tower, material=flat_mat(PAL['steel'])))
cap = trimesh.creation.cone(radius=0.8, height=0.9)
cap.apply_translation([1.2, -0.4, 3.86])
scB.add(pyrender.Mesh.from_trimesh(cap, material=flat_mat(PAL['hot'])))
# plant hall: low wide box with roof line
hall = trimesh.creation.box(extents=[2.6, 2.0, 1.1])
hall.apply_translation([-1.2, 0.6, 0.61])
scB.add(pyrender.Mesh.from_trimesh(hall, material=flat_mat(PAL['concrete'])))
roof = trimesh.creation.box(extents=[2.6, 2.0, 0.12])
roof.apply_translation([-1.2, 0.6, 1.22])
scB.add(pyrender.Mesh.from_trimesh(roof, material=flat_mat(PAL['dark'])))
# chimney cylinder
chim = trimesh.creation.cylinder(radius=0.22, height=1.9)
chim.apply_translation([-2.4, -1.2, 1.01])
scB.add(pyrender.Mesh.from_trimesh(chim, material=flat_mat(PAL['dark'])))
# conveyor ribbon (teal)
belt = trimesh.creation.box(extents=[3.0, 0.5, 0.12])
belt.apply_translation([2.2, -1.6, 0.12])
scB.add(pyrender.Mesh.from_trimesh(belt, material=flat_mat(PAL['teal'])))
# ore pile: low poly cone
pile = trimesh.creation.cone(radius=1.0, height=0.7)
pile.apply_translation([1.8, 1.2, 0.41])
scB.add(pyrender.Mesh.from_trimesh(pile, material=flat_mat(PAL['ore_red'])))
imgB = render(scB)
imgB.save(os.path.join(OUT, 'variant_b_blockout.png'))

# side-by-side
combo = Image.new('RGB', (900, 620), (24, 28, 34))
combo.paste(imgA, (0, 0)); combo.paste(imgB, (0, 600-0))  # placeholder, fixed below
from PIL import ImageDraw, ImageFont
combo = Image.new('RGB', (1810, 620), (24, 28, 34))
combo.paste(imgA, (5, 10)); combo.paste(imgB, (910, 10))
d = ImageDraw.Draw(combo)
try: font = ImageFont.truetype('arial.ttf', 22)
except Exception: font = ImageFont.load_default()
d.text((15, 590), 'Variant A — Kenney assembly', fill=(230,230,230), font=font)
d.text((920, 590), 'Variant B — Blender-style blockout', fill=(230,230,230), font=font)
combo.save(os.path.join(OUT, 'side_by_side.png'))
print('saved:', os.listdir(OUT))
