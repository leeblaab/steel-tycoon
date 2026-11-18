#!/usr/bin/env python3
"""UI Phase asset pipeline: resize/rename incoming images into the game folders.

Rules (locked 2026-10-07):
- Iso tiles  -> content/assets/icons/<node_id>.png      (1024x1024)
- Symbols    -> content/assets/symbols/<plant_id>_<symbol>.png (512x512)
- Palette    -> content/assets/palette/<node_id>.png    (512x512)

Incoming names are free-form; this script maps them by keyword.
Missing files get dummy placeholders (same look for all) until Yasser replaces
them — replace a file in the game folder + restart = updated in-game.
"""
import os
from PIL import Image

SRC = r"C:\AI_LAB\SteelX\assets_incoming"
DST = r"C:\AI_LAB\SteelX\content\assets"
ICON_DIR = os.path.join(DST, "icons")
SYM_DIR = os.path.join(DST, "symbols")
PAL_DIR = os.path.join(DST, "palette")
for d in (ICON_DIR, SYM_DIR, PAL_DIR):
    os.makedirs(d, exist_ok=True)

NODE_IDS = ["jetty", "scrap_yard", "dri_yard", "drp", "eaf", "lf", "cc",
           "bar_mill", "wire_rod_mill", "billet_yard", "finished_yard", "dispatch",
           "conv_ore_drp", "conv_dri_eaf", "conv_ccm_billet", "conv_billet_rebar",
           "conv_billet_wr", "conv_mill_dispatch", "scrap_feed"]

# Symbol keys used by content/maps/maps_phase1_draft.json
SYMBOL_KEYS = {
    "drp": ["stockyard", "conveyor", "shaft_furnace", "reformer", "scrubber",
            "compressor", "heat_recovery", "screen", "product"],
    "smp_overview": ["eaf", "ladle", "caster"],
    "eaf": ["crane", "product", "eaf", "tap"],
    "lf": ["ladle", "addition", "screen"],
    "cc": ["ladle", "tundish", "caster", "product"],
    "bar_mill": ["furnace", "stand", "qtb", "cooling", "press"],
    "wire_rod_mill": ["furnace", "stand", "cooling", "coil"],
}

def square_resize(src, dst, size):
    im = Image.open(src).convert("RGB")
    # Tiles and symbols are drawn 1:1 at display size (64 px grid cell, 48 px map
    # symbol) so no runtime downscaling happens — the gl_compatibility renderer
    # produces white/pixelized mush when a big texture is shrunk every frame.
    # Palette icons keep 512 (button scales them cleanly).
    if "icons" in dst:
        size = 64
    elif "symbols" in dst:
        size = 48
    im = im.resize((size, size), Image.LANCZOS)
    im.save(dst)
    return dst

def dummy(dst, size, color):
    Image.new("RGB", (size, size), color).save(dst)

# 1) Incoming files -> game folders (keyword mapping by filename)
mapped = []
for fname in os.listdir(SRC):
    path = os.path.join(SRC, fname)
    if not os.path.isfile(path):
        continue
    low = fname.lower()
    if "iso" in low:
        node = "drp" if "drp" in low else "smp"
        out = square_resize(path, os.path.join(ICON_DIR, f"{node}.png"), 1024)
    elif "drill" in low:
        out = square_resize(path, os.path.join(SYM_DIR, "drp_shaft_furnace.png"), 512)
    elif "icon" in low:
        node = "drp" if "drp" in low else "smp"
        out = square_resize(path, os.path.join(PAL_DIR, f"{node}.png"), 512)
    else:
        continue
    mapped.append(out)

# 2) Dummies for everything not yet provided
for node in NODE_IDS:
    p = os.path.join(ICON_DIR, f"{node}.png")
    if not os.path.exists(p):
        dummy(p, 1024, (120, 130, 140))
    p = os.path.join(PAL_DIR, f"{node}.png")
    if not os.path.exists(p):
        dummy(p, 512, (120, 130, 140))
for plant, keys in SYMBOL_KEYS.items():
    for key in keys:
        p = os.path.join(SYM_DIR, f"{plant}_{key}.png")
        if not os.path.exists(p):
            dummy(p, 512, (235, 235, 235))

print("mapped:", mapped)
print("icons:", len(os.listdir(ICON_DIR)), "| symbols:", len(os.listdir(SYM_DIR)), "| palette:", len(os.listdir(PAL_DIR)))
