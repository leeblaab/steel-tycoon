# Steel Tycoon — Audit 2: Visuals & Art Direction

**Evidence basis.** Read-only GitHub API inspection of HEAD `cbafea5`: I parsed the actual GLB binary chunks (`eaf.glb`, `conveyor.glb`, `ship.glb`), read the render file (`fullplant/browser/main.tsx`, 852 lines), `layout.ts`, `view_camera.tsx`, the card modules, and the agreed visual gates (`factory_scene_design_v1.md`, roadmap §9 + the 19.10/25.10 marks). I could not run Blender or the vite app here, so the Blender script below is a **draft for an agent to execute and verify**, not a tested artifact. Nothing modified or pushed.

**Verified visual facts (these ground every claim):**

| Fact | Evidence |
|---|---|
| The "hero" EAF is **104,224 triangles, 49,615 verts, 1 mesh, 1 node, ZERO materials, ZERO textures, ZERO animations** | `eaf.glb` JSON chunk: `meshes:1, prims:1, nodes:1, images:0, textures:0, materials:[{baseColorFactor:null}]` |
| It is quantization-defective: `KHR_mesh_quantization` **required**, POSITION = int16-normalized with min/max in integer units (±32767), **NORMAL = unsigned-byte (5121) normalized — invalid for normals per glTF spec** | `eaf.glb` accessors; generator `glTF-Transform v4.5.1` |
| The loader is already fighting this: a "bounds probe" workaround exists because quantized ±32767 min/max create a giant bounding volume that "casts shadow over the whole jetty" | `main.tsx:300–334` comments |
| Kenney scenery by contrast: conveyor **196 tris**, ship **850 tris / 3 named meshes**, float positions, palette texture, named nodes | `conveyor.glb`, `ship.glb` (generator `UnityGLTF`) |
| Lighting = `ambientLight 0.35` + one `directionalLight 1.3`; **no `castShadow` on the light** (mesh `castShadow` flags are inert), no environment, no fog, no post | `main.tsx:805–806`; `package.json` has no postprocessing/drei deps |
| Color language is **per-zone rainbow**, not per-material: slice1 blue, slice2 purple, slice3 amber, slice4 red, slice5 green | `main.tsx:241 ZONE_COLORS` |
| Flow viz exists but is minimal: **one traveling pulse dot per conveyor line** (`FlowPulse`, 2.4 s traverse, sim-gated) + a hot-metal `pointLight` + a green glow disc | `main.tsx:624–651, 401–415` |
| GLBs are placed at **arbitrary uniform scales** (jetty ×21, drp ×8, eaf ×4.5/×3, ccm ×6) — not designed proportions | `main.tsx:469–589` |
| **3 image files in the entire repo** (2 screenshots + 1 Kenney colormap); **no audio, no HDRI, no PBR textures** | tree media scan |
| Cards are **plain-text lines** (`lines: string[]`) — live sim projections, but no diagrams/cutaways | `inspection_cards.ts:11`, `onboarding_cards.ts:8–15` |
| Camera is already touch-ready (1-finger orbit, pinch zoom, 2-finger pan), elevation clamped 15–75°, fov 45, free 360° orbit | `view_camera.tsx:2–5, 70–87` |
| The agreed design **already mandates** visible material flow, distinct silhouettes, consistent state-color semantics, sim-driven (never decorative) animation | `factory_scene_design_v1.md:6`; roadmap:909, 1090, 1371 |

---

## 1. Verdict (3 sentences, brutal)

The diorama reads as an unfinished graybox: the "hero" machines are **104K-triangle untextured single-node blobs with broken normals** that you cannot identify as an EAF, a caster, or anything else, sitting on a dark plane under flat shadowless light with a rainbow of zone tints and one lonely pulse dot per conveyor. The SME is right that it "presents nothing" — but the cause is **not** a shortage of asset fidelity; it's that the scene encodes none of the three things a tycoon player must see at a glance: *what each machine IS* (designed silhouette), *what it is DOING* (state), and *where material GOES* (flow). Rebuilding the GLBs alone will not fix this — the presentation layer (silhouette language, stream colors, sim-driven flow tokens, state lights, mood) is ~80% of the problem and is mostly missing, and the agreed design docs already require exactly these things.

---

## 2. Part A — The models

### A1. ComfyUI image-to-3D: salvageable corruption, unrepairable design

**Two separate questions, two different answers.**

**(a) Can a scripted pass fix the corruption? Yes.** I parsed the file. The defects are concrete and mechanical:
- NORMAL stored as **unsigned byte normalized** (componentType 5121). Normals are signed; the glTF spec allows only FLOAT, BYTE-normalized, or SHORT-normalized for NORMAL. Unsigned-byte normals land in the [0,1] octant → shading is broken (half the surface reads flat/dark). **Fix:** discard the quantized normals and recompute from geometry (`trimesh.repair.fix_normals` / Blender "Recalculate Outside"), or re-quantize to int8.
- POSITION min/max are in **integer units (±32767)** and the node carries a generic 0.4975 scale rather than a bbox-derived dequantization transform. three.js dequantizes correctly *if* the extension is honored, but the raw integer bounds blow up bounding volumes → the shadow/bounds bug the team already worked around (`main.tsx:300`). **Fix:** bake dequantization to float positions in Python (read int16, map via accessor min/max to world extent, rewrite as 5126), recenter pivot to base, rescale to real meters. This is ~40 lines of `pygltflib`/`trimesh` and needs **no pristine source** — the quantized payload is recoverable to ~0.15 mm on a 10 m machine.

**(b) Can repair make them game-good? No — and this is the real verdict.** Even perfectly dequantized, the EAF is **104,224 triangles of marching-cubes soup in one node with no material, no texture, no semantic parts**. You cannot:
- read a silhouette (it's a featureless blob at diorama scale — the electrode arms, roof, and trunnions that *say "EAF"* are not resolved as distinct shapes);
- animate a heat (no `tilt_pivot`, no `roof_pivot`, no separate electrodes — it's one mesh, so the vessel can't tilt, the roof can't swing, the electrodes can't raise);
- color material streams (no material slots);
- fit a mobile budget (104K tris × 8 heroes ≈ 800K tris before scenery — 4–5× a sane mobile budget, for objects that look *worse* than the 196-tri Kenney conveyor).

Image-to-3D fundamentally cannot guarantee the **exact shape cues that teach** ("make it read as an EAF, not a generic furnace" is not a prompt you can reliably win). **Verdict: demote ComfyUI to 2D concept art and info-card illustrations** (where it's strong and corruption-proof). Keep the scripted dequantize pass only if you want a few background clutter props; do **not** spend the one-asset-per-approval budget rebuilding heroes from 425 MB pristine sources — you'd be polishing soup. The agreed §9.1 split (Kenney scenery + custom procedural heroes) was right; the ComfyUI hero detour is the sunk cost to cut.

### A2. From-scratch options, ranked for a no-artist team

| Rank | Option | Effort (agent-executable) | Quality ceiling | License / risk | Verdict |
|---|---|---|---|---|---|
| **1** | **Procedural box/cylinder heroes in Blender-Python** ("Factorio-flat-3D") | ~1–2 gated sessions per machine; 10 heroes ≈ 1.5–2 weeks | Stylized-readable, *exact* teaching silhouettes, named animatable parts, <2K tris & <150 KB each | None (your own geometry) | **THE answer for a learning sim.** Silhouette is designed, not generated; deterministic seed→GLB; semantic parts for free; stream colors as material slots. See A4 script. |
| **2** | **Kenney CC0 kitbash** (already the anchor) | Low; Blender-Python import→transform→merge→recolor | Good scenery, consistent palette | CC0, commercial-safe, no attribution required (credit anyway) | Keep for conveyors, cranes, trucks, ships, crates, pipes, rail. **No Kenney kit contains an EAF/LF/caster** → heroes must be procedural. Kits: Factory, Train (rail), City (roads), Pirate (ships), Space (tanks/silos read industrial). |
| **3** | **Poly Haven + ambientCG (CC0 textures/HDRIs)** | Low; download→KTX2 compress→assign | Big mood win: rusted steel, concrete, corrugated cladding, one industrial HDRI | CC0, commercial-safe | **Best additive source.** Ground/cladding textures + a 1K HDRI for desktop environment lighting. This is what's missing most (repo has zero textures). |
| **4** | **Other CC0/curated** (Sketchfab CC0/CC-BY filter, Kenney-adjacent) | Medium (per-asset vetting) | Variable topology | CC-BY needs attribution tracking; per-asset license check | Use sparingly for one-off props; never heroes. |
| **5** | **AI mesh tools** (Meshy 4 / Tripo 2.5 / Hunyuan3D-2 / Trellis) | Medium + repair gate | Cleaner than ComfyUI soup (some offer quad-remesh + PBR), but still no semantic parts, inconsistent scale, uncontrollable hero silhouettes | Meshy/Tripo commercial rights on paid tiers; Hunyuan/Trellis open but check model licenses | Only for **one-off background props** through a repair→decimate→validate gate. Not for the 10 teaching heroes. |
| ✗ | **Quixel Megascans** | — | Photoreal | **License trap: free use is restricted to Unreal Engine.** Using in a commercial Three.js game requires a paid license. | Avoid. |
| ✗ | **BlenderKit** | — | Variable | Mixed per-asset licenses (some CC0, some restricted free tier) | Not a safe blanket source; vet per asset. |

**Bottom line:** procedural heroes + Kenney scenery + Poly Haven textures/HDRIs. This is fully agent-executable, deterministic, tiny, mobile-safe, and — crucially — the *only* option where you control the teaching silhouette exactly.

### A3. The visual language: silhouette, stream color, scale, state

**Silhouette cues (readable from 45° above, one glance):**

| Machine | Signature shape (the thing that says "this is X") | Relative scale |
|---|---|---|
| Jetty / unloader | Water edge + long pier + **ship hull** (biggest single object) + tall grab crane on rails | Ship establishes world scale |
| Stockyard | Open flat pad + **conical/trapezoidal stockpile mounds** + stacker/reclaimer boom; fill = mound height | Low, wide |
| DRP (shaft) | **Tall vertical shaft** + top charge conveyor + bustle-pipe ring + reformer boxes beside | **Tallest structure** (~30–60 m real) |
| **EAF** | **Squat round vessel** (wider than tall) on trunnions + **3 graphite electrodes in a triangle** from a mast + swing roof + transformer house | Vessel ~8 m dia |
| **LF** | **Smaller round ladle on a car** + single small electrode mast + alloy hopper row — "EAF's little brother," differentiated by size + ladle car + no scrap bay | Ladle ~4 m dia |
| **Caster** | **The arc**: ladle turret (two ladles on a rotating arm) → curved segment bending horizontal → mold box → withdrawal straighteners + cut torch | Arc radius ~10 m |
| Billet yard | Rows of long thin bars (instanced); hot = orange glow fading to gray | Long, low |
| Rolling mill | **Long building** + entry/exit tables + wide flat **cooling bed** + shear; glowing bar threading through | **Longest** (~100 m) |
| Dispatch | Strapped hexagonal **bundles** + truck/rail loadout + weighbridge | Low |

**Material-stream color (consistent EVERYWHERE — ground markings, belts, tokens, UI, cards; this replaces the per-zone rainbow as the *primary* language):**

| Stream | Color | Note |
|---|---|---|
| Scrap | rust orange-brown `#8a5a3c` | |
| Ore / pellets | dark red-brown `#6e3b2e` | |
| DRI / HBI | silver-gray `#9aa3ad` | |
| Hot metal (liquid) | incandescent `#ff9a3c` | **emissive** |
| Slag | dark gray-green `#4a4f45` | |
| Billet hot → cold | `#ff7a1f` → steel blue-gray | emissive fades with temp |
| Finished rebar / wire rod | steel blue `#5b7c99` / lighter blue | |
| Utilities | water teal, gas yellow, oxygen light-blue, graphite near-black | |

Zone tints can stay as *secondary* identity (the painted pads), but **material color must dominate** — that's what teaches the route.

**State grammar (the tycoon layer, per the agreed palette semantics roadmap:1090):** every machine shows idle = desaturated/no emissive; running = stream-colored emissive pulse + a moving part; blocked/starved = amber warning ring + icon. **This is the single biggest "presents nothing" fix** — the sim already emits `ladle_wait`, `caster_wait`, `heats_starved`, `busy` (`inspection_cards.ts`); none of it is visible on the machine today.

**Scale:** exaggerate vertical ~1.2–1.5× for readability but keep the real order (DRP > EAF > LF; mill longest). Replace the arbitrary GLB scales (jetty ×21, eaf ×3) with a designed meters-based layout.

### A4. Inline flagship deliverable — procedural EAF (Blender-Python)

I chose the **script** over a generator spec: it's deterministic, agent-executable, guarantees <2 MB (will be ~80 KB), and produces the named pivots the heat-cycle animation needs. **Draft — run headless in Blender 4.x, then verify tri count + a render screenshot before integrating.**

```python
# eaf_procedural.py — stylized, game-ready Electric Arc Furnace
# RUN:  blender --background --python eaf_procedural.py
# OUT:  eaf_stylized.glb  (target < 2,500 tris, < 200 KB, named animatable parts)
# Style: Factorio-flat-3D. 1 Blender unit = 1 meter. Y-up export for three.js.
import bpy, math

OUT = "/tmp/eaf_stylized.glb"

# ---- clean scene ----
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
for c in (bpy.data.meshes, bpy.data.materials):
    for b in list(c):
        if b.users == 0: c.remove(b)

# ---- stylized PBR materials (flat colors, restrained roughness) ----
def mat(name, color, metallic=0.3, rough=0.6, emit=None, emit_str=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Roughness"].default_value = rough
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*emit, 1)
        bsdf.inputs["Emission Strength"].default_value = emit_str
    return m

PAINT   = mat("eaf_painted_steel", (0.18,0.44,0.49), 0.35, 0.55)  # industrial teal
REFRACT = mat("eaf_refractory",    (0.23,0.20,0.19), 0.0,  0.9)
GRAPH   = mat("eaf_graphite",      (0.11,0.11,0.12), 0.1,  0.4)
COPPER  = mat("eaf_copper_bus",    (0.72,0.45,0.20), 0.8,  0.3)
CONCRETE= mat("eaf_concrete",      (0.55,0.55,0.53), 0.0,  0.95)
HOT     = mat("eaf_hot_metal",     (1.0,0.48,0.12),  0.0,  0.5, emit=(1.0,0.48,0.12), emit_str=2.0)
LAMP    = mat("eaf_state_light",   (0.2,0.84,0.48),  0.0,  0.4, emit=(0.2,0.84,0.48), emit_str=1.5)

def assign(o, m):
    o.data.materials.clear(); o.data.materials.append(m)

def box(name, loc, size, m, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; o.scale = size
    bpy.ops.object.transform_apply(scale=True); assign(o, m); return o

def cyl(name, loc, r, h, m, verts=24, rot=(0,0,0)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=r, depth=h, location=loc, rotation=rot)
    o = bpy.context.object; o.name = name; assign(o, m); return o

def empty(name, loc):
    e = bpy.data.objects.new(name, None); e.empty_display_size = 0.5
    e.location = loc; bpy.context.collection.objects.link(e); return e

# ---- foundation ----
box("eaf_base_pad", (0,0,0.25), (12,12,0.5), CONCRETE)

# ---- tilt pivot + vessel (the vessel tilts around X at the trunnion axis) ----
tilt = empty("EAF_tilt_pivot", (0,0,3.0))
shell = cyl("eaf_vessel_shell", (0,0,3.0), 4.0, 5.0, PAINT, verts=32)
shell.parent = tilt
rim = cyl("eaf_refractory_rim", (0,0,5.6), 4.1, 0.5, REFRACT, verts=32); rim.parent = tilt
bottom = cyl("eaf_vessel_bottom", (0,0,0.7), 3.6, 0.6, REFRACT, verts=32); bottom.parent = tilt
# trunnion ring (visual tilt axis)
ring = cyl("eaf_trunnion_ring", (0,0,3.0), 4.3, 0.6, GRAPH, verts=32, rot=(0,math.pi/2,0)); ring.parent = tilt
# tap spout (front, lower) — hot metal stream origin
spout = box("eaf_tap_spout", (0,-4.2,1.4), (0.8,1.2,0.5), REFRACT); spout.parent = tilt
stream = cyl("eaf_tap_stream", (0,-4.6,0.7), 0.18, 1.4, HOT, verts=12); stream.parent = tilt

# ---- swing roof + electrode mast (roof swings around Y at the mast) ----
roof_pivot = empty("EAF_roof_pivot", (5.5,0,6.0))
roof = cyl("eaf_roof", (0,0,6.0), 4.2, 0.4, PAINT, verts=32); roof.parent = roof_pivot
mast = box("eaf_electrode_mast", (5.5,0,4.5), (0.8,0.8,9.0), PAINT)
# 3 electrodes in a triangle through the roof (named for raise/lower animation)
for i, ang in enumerate((90, 210, 330)):
    x = 2.2*math.cos(math.radians(ang)); y = 2.2*math.sin(math.radians(ang))
    arm = box(f"eaf_arm_{i}", (x*0.5+2.7, y*0.5, 7.2), (abs(x)+2.0, 0.3, 0.3), COPPER)
    el  = cyl(f"eaf_electrode_{i}", (x, y, 5.0), 0.25, 4.0, GRAPH, verts=12)
    el.parent = roof_pivot; arm.parent = roof_pivot

# ---- transformer house + copper bus bars ----
box("eaf_transformer_house", (8.5,3.5,1.5), (4,3,3), PAINT)
for dz in (-0.8,0,0.8):
    box(f"eaf_bus_{dz}", (6.5,3.5+dz,4.0), (3.5,0.15,0.15), COPPER)

# ---- ladle on car below the tap (receives the heat) ----
box("eaf_ladle_car", (0,-6.5,0.4), (3,2,0.8), GRAPH)
ladle = cyl("eaf_ladle", (0,-6.5,1.8), 1.6, 2.2, REFRACT, verts=24)
cyl("eaf_ladle_hot_fill", (0,-6.5,2.6), 1.4, 0.3, HOT, verts=24)

# ---- scrap bay hint + platform railing + state light ----
box("eaf_scrap_bay", (-8.5,0,0.6), (4,8,1.2), CONCRETE)
box("eaf_platform", (0,5.2,3.0), (9,1.2,0.2), GRAPH)
box("eaf_railing", (0,5.8,3.6), (9,0.1,1.0), PAINT)
cyl("eaf_state_light", (5.5,0,9.2), 0.22, 0.3, LAMP, verts=12)

# ---- export selected, apply transforms, Y-up ----
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(
    filepath=OUT, export_format='GLB', use_selection=True,
    export_apply=True, export_yup=True, export_materials='EXPORT',
    export_animations=False, export_draco_mesh_compression_enable=False)
print("WROTE", OUT)
```

**Validation gate (agent runs after Blender):**
```python
import trimesh
s = trimesh.load("/tmp/eaf_stylized.glb")
tris = sum(g.faces.shape[0] for g in s.geometry.values())
assert tris < 2500, f"tri budget blown: {tris}"
names = list(s.graph.nodes_geometry)
for required in ("EAF_tilt_pivot","EAF_roof_pivot","eaf_electrode_0","eaf_state_light"):
    assert any(required in n for n in s.graph.nodes), f"missing pivot {required}"
print("OK", tris, "tris; pivots present")
```

**Game-side wiring (three.js, ~30 lines):** traverse by name; `EAF_tilt_pivot.rotation.x` → tap tilt during `tap` phase; `EAF_roof_pivot.rotation.y` → roof swing on charge; `eaf_electrode_i.position.y` → raise/lower; `eaf_state_light` material emissive ← sim `tone` (idle/busy/waiting); `eaf_tap_stream` + `eaf_ladle_hot_fill` visibility ← heat phase. **The heat cycle becomes animatable because the parts exist** — impossible with the 1-node soup.

*(Alternative I rejected: a generator art-direction spec. Lower odds — prompt-to-3D can't guarantee the electrode-triangle silhouette or named pivots, and you'd still need the repair pass. The script wins on control, budget, and determinism.)*

---

## 3. Part B — Scene & presentation (cheapest-first)

| # | Technique | Effort | Impact | Mobile cost | Notes / evidence |
|---|---|---|---|---|---|
| 1 | **Stream-color ground flow lines + arrows** between zones (decal strips, static) | hours | **High** — instant route legibility | ~0 | Replace per-zone rainbow as primary language; uses A3 palette |
| 2 | **Machine state lights** (idle/run/blocked emissive quad + ring) driven by existing sim `tone`/`*_wait`/`starved` | hours | **Very high** — teaches bottlenecks, the core tycoon skill | ~0 | Sim already emits the state (`inspection_cards.ts`); just make it visible |
| 3 | **Fill levels**: stockpile mound `scale.y` = f(inventory); ladle/buffer emissive level | 1 day | **High** — inventory becomes visible | ~0 | Registry already exists (audit 1); pure projection |
| 4 | **Animated conveyor UV scroll** (one shared belt material, `offset.x += speed·dt`, speed from tick) | hours | Med-high — reads as motion | ~0 | Sim-driven per clause 8 (roadmap:1371) |
| 5 | **Lighting rig + mood**: enable one 1024 shadow map (desktop) / blob shadows (mobile), hemisphere fill, steel-blue distance fog, bake per-prop AO into vertex colors in Blender | 1 day | **High** — kills the flat graybox look | low (blob shadows + fog cheap; DOF **off**) | Light currently has no `castShadow` (`main.tsx:806`); no fog/AO anywhere |
| 6 | **Flow tokens**: InstancedMesh of small stream-colored cubes/spheres along splines, spawned from sim transfer events, pooled ~200 | 1–2 days | **Very high** — THE tycoon readability win ("the item is the hero") | 1 draw call/stream | Factorio/Shapez lesson: show discrete units moving, colored by type |
| 7 | **Quest-guided camera**: clamp orbit + 3 zoom presets (plant/zone/machine) + scripted tween per onboarding step | 1 day | High — teaches layout, cinematic reveal | ~0 | Camera already touch-ready (`view_camera.tsx`); add presets/tweens, keep orbit |
| 8 | **Vehicles**: ship at berth (have `ship.glb`), trucks yard→dispatch, ladle car EAF→LF→caster on rails | 2–3 days | Med-high — plant feels alive | low (instanced) | |
| 9 | **Heat glow + spark particles** at tap / caster cut (Points, additive, pooled) | 1 day | Med — juice | low | `HeatGlow` pointLight already exists (`main.tsx:646`); extend |
| 10 | **Juice**: placement pop+dust+thud; heat-complete toast+micro-shake; shipment counter roll; quest banner | 1–2 days | High fun | ~0 | Reveal pop already exists (`main.tsx:435`); extend. **Audio: synthesize with WebAudio** (oscillators+noise+envelopes) — zero asset budget, industrial clangs/hums/alarms are synth-friendly; mute toggle + first-interaction unlock |

**Camera opinion (Q5):** keep free orbit (already touch-ready) but **clamp + preset + guide**. Default elevation ~42° (current home, `main.tsx:794`) is good; lock the *default* azimuth to the plant-flow axis so flow reads left→right consistently; offer 3 zoom stops rather than infinite free zoom (prevents getting lost on a phone); tween the camera to the relevant zone on each quest step. Orthographic is worth a toggle for the "process diagram" read, but low-FOV perspective (35–45°) is fine. **Consistent orientation beats freedom for a learning sim.**

**Lighting opinion (Q7):** one warm directional sun (~35° for long shadows) + hemisphere (sky-blue / rust bounce) + ambient; **blob shadows on mobile, one 1024 map on desktop**; emissive hot metal + state lights = "alive" for free; steel-blue fog for depth + LOD-pop hiding; **DOF off on mobile**; **day/night not worth it in V3** (doubles lighting QA, hurts emissive readability) — a fixed golden-hour mood is the sweet spot; bake AO into vertex colors (agent-scriptable, zero runtime cost); Poly Haven 1K HDRI for desktop PMREM, hemisphere on mobile.

---

## 4. Part C — The whole thing

### C9. Top 5 fun+learning upgrades per unit effort
1. **Stream-color language + flow tokens** (B1+B6) — teaches the entire process route at a glance; fun = watching *your* plant work.
2. **Machine state lights + fill levels** (B2+B3) — teaches bottlenecks (the core skill); fun = fixing red→green.
3. **Quest-guided camera + zone framing** (B7) — teaches spatial layout; fun = cinematic reveal per build.
4. **Procedural hero silhouettes** (A4) — teaches equipment identity; fun = "my plant looks real."
5. **Heat-cycle animation** (EAF tilt→tap→LF→cast, A4 pivots) — teaches the batch rhythm of steelmaking; fun = the money moment.

### C10. Making the plant itself teach (ranked by feasibility)
1. **Camera callouts** with leader lines + short labels (DOM overlay — already the pattern, `main.tsx:218`). Cheap.
2. **"Tap a stream" → highlight its whole path**, dim others. Cheap, teaches the route.
3. **Fill levels + state lights** (already C9.2) — the plant teaches continuously.
4. **2D animated cutaway cards** — EAF cross-section during a heat (scrap charge → melt → oxidize → tap) and DRI shaft cross-section, animated **by the real sim phase + the SME's real numbers** (temperature curve, oxygen blow, carbon boil). **Medium effort, huge learning value, no 3D interior needed.** This is the digital-twin synergy — the accepted PDF/demo already proves the SME can teach with diagrams; reuse that grammar in-game.
5. **Full 3D interior drill-in** — expensive, defer to GAME phase 2.

**Insight:** 2D animated diagrams overlaid on cards beat 3D interiors for learning *and* cost. Cards are `lines: string[]` today (`inspection_cards.ts:11`) — adding a canvas/SVG cutaway panel keyed to sim phase is the highest-leverage learning upgrade.

### C11. If I owned it for one month (opinionated, no hedging)
- **Kill the ComfyUI hero pipeline.** Sunk cost. Keep it for 2D card art only. Stop the one-asset-per-approval pristine rebuilds — you're polishing soup.
- **Kill the 21 MB float GLBs** (jetty, drp). Replace with procedural heroes (<150 KB). Repo drops from 60 MB to <10 MB; mobile download becomes viable.
- **Re-scope visuals to "readable industrial diorama"** (Factorio × Good Company), NOT "realistic plant." The SME's realism judgment applies to **process correctness**, not polygon fidelity. Say this explicitly so the SME gates on "does it read as a real plant's *flow and equipment*" rather than "does it look like a photo."
- **Make the sim visible:** every inventory a fill level, every transfer a token, every machine a state light. *This is the game.* The architecture (registry, tickloop, live cards) already supports it — it's a presentation gap, not an engine gap.
- **One palette, one lighting rig, one camera grammar.** Consistency > variety. The rainbow zone tints demote to secondary.
- **Ship the EAF heat-cycle as the vertical slice of fun.** If watching one heat isn't satisfying, nothing else matters.
- **Defer:** day/night, DOF, realistic textures, vendor-named equipment, 3D interiors, maintenance visuals (already GAME phase 2 per the binding gate).

---

## 5. Four-week visual plan (agent micro-steps, playable at every step)

Each step is Go-gated; rollback = revert one commit; the SME plays throughout.

**Week 1 — Language & rig (no asset changes; pure presentation):**
1. Palette constants module (A3 stream colors + state grammar). Gate: SME approves palette.
2. Lighting rig: hemisphere + warm sun, enable shadows (desktop) / blob shadows (mobile), steel-blue fog. Gate: before/after screenshot.
3. Stream-color ground flow lines + arrows; demote zone rainbow to secondary pad tint. Gate: route reads left→right.
4. Camera clamps + 3 zoom presets + quest-step tween targets. Gate: onboarding walk frames each step.

**Week 2 — Make the sim visible:**
5. State lights (idle/run/blocked) from existing sim `tone`/`*_wait`/`starved`. Gate: a blocked machine visibly goes amber.
6. Fill levels on yards/buffers from the registry. Gate: pile height tracks inventory.
7. Conveyor UV scroll (speed from tick). Gate: motion matches sim, not decorative.
8. Flow-token InstancedMesh on the S1→S3 ore-belt boundary (the same boundary as audit 1's first handoff). Gate: token count matches ledger quantities; determinism preserved.

**Week 3 — Procedural heroes (one per gate):**
9. Run the A4 EAF script → validate (<2,500 tris, pivots present) → integrate → heat-cycle animation (tilt/tap/emissive). Gate: SME "this reads as an EAF" + one heat feels satisfying.
10. DRP shaft script → integrate. Gate: SME silhouette approval.
11. LF + caster scripts (arc + turret) → integrate. Gate: EAF vs LF vs caster distinguishable at a glance.
12. Delete the corrupt ComfyUI hero GLBs + dedupe (`eaf.glb` ×2, slice2 `assets/`/`public/` ×7). Gate: repo <15 MB, scene unchanged or better.

**Week 4 — Juice & learning:**
13. Placement pop+dust+thud; heat-complete toast+micro-shake; shipment truck+counter roll; quest banner. Gate: full onboarding walk feels alive.
14. WebAudio synth kit (clang/hum/alarm/chime) + mute toggle + first-interaction unlock. Gate: audio on mobile without autoplay errors.
15. 2D animated EAF cutaway card driven by sim phase + SME numbers. Gate: SME approves the teaching diagram.
16. Mobile perf probe: draw calls ≤150, tris ≤200k, textures ≤256 MB, 30 fps floor on mid-tier phone. Gate: budgets met.

**Named next (week 5+):** remaining heroes (mill, cooling bed, dispatch), Poly Haven ground/cladding textures + KTX2, stockyard mound kitbash, ladle-car rail loop.

---

*Audit/ideate only: no files modified, nothing committed or pushed. The Blender script is a draft for agent execution + verification, not a tested artifact. Awaiting the SME's Go on individual steps.*