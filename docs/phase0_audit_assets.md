# Phase 0 Audit — Asset Manifest with Licenses (Task B)

Audit date: 2026-10-18. Read-only audit; no asset files modified or copied.
Scope: `assets_incoming/` (incl. `Kenny/`), `web/src/ports/*/browser/`, provenance from git history and repo docs.

## 1. Kenney packs staged in `assets_incoming/Kenny/` (all untracked in git — `git status` shows `?? assets_incoming/Kenny/`; staged on disk by size policy)

Verified full list on disk: **3 pack folders + 2 loose GLBs + 1 shared texture**:

| Pack folder | Actual pack (per License.txt) | Creation date | License type | Attribution requirement | Model counts |
|---|---|---|---|---|---|
| `kenney_factory-kit_3.0/` | Factory Kit **3.0** | 01-05-2026 | Creative Commons Zero (CC0) — http://creativecommons.org/publicdomain/zero/1.0/ | **None required.** "Support by crediting 'Kenney' or 'www.kenney.nl' (this is not a requirement)" | 143 GLB + FBX variants |
| `kenney_city-kit-industrial_2.0/` | City Kit Industrial **2.0** | 31-08-2026 | CC0 — same URL | None required (same wording) | 37 GLB + FBX variants |
| `kenney_city-kit-roads/` | City Kit Roads **2.2** | 10-10-2026 | CC0 — same URL | None required (same wording) | 95 GLB + FBX variants |

Key verbatim terms (identical in all three License.txt files):
> License: (Creative Commons Zero, CC0) http://creativecommons.org/publicdomain/zero/1.0/
> You can use this content for personal, educational, and commercial purposes.
> Support by crediting 'Kenney' or 'www.kenney.nl' (this is not a requirement)

Loose files in `assets_incoming/Kenny/` (no License.txt of their own):
- `SHIP.glb` (78 KB), `DRP.glb` (139 KB) — repo docs (`docs/mega_prompt_slices2-5.md`, `docs/Raodmap V3.md` §"AGREED ASSET SPLIT") consistently label them as Kenney-derived. **No License.txt shipped with them; provenance should be pinned to a Kenney pack download before release.** CC0 credit line below covers them if confirmed Kenney.
- `Textures/colormap.png` — shared Kenney colormap texture (embedded into deployed GLBs).

### Attribution strings for the about screen (recommended, exact per License.txt wording)

Attribution is **not legally required** (CC0), but repo policy (`content/assets/models/cc0/LICENSES.md`: "crediting Kenney appreciated — will appear in game credits") commits to crediting. Drop-in block:

```
3D scenery models: "Kenney" (www.kenney.nl)
— Factory Kit 3.0, City Kit Industrial 2.0, City Kit Roads 2.2
Licensed under CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
```

## 2. Cross-check: which Kenney-derived models are actually used in browser scenes today

GLB references found in `web/src/ports/*/browser/main.tsx` (grep `.glb`):

| Scene | GLBs referenced | Provenance evidence |
|---|---|---|
| slice1 (`main.tsx` L131/L156) | `assets/ship.glb`, `assets/crane.glb` (×4 instances) | `crane.glb` name-matches Factory Kit 3.0 `Models/GLB format/crane.glb`; code comment says "Ship (Kenney GLB, colormap texture)". Hashes differ from staged pack copies → deployed copies are **processed variants** (colormap embedded / rescaled per SESSION_SHUTDOWN_2026-10-17_END). |
| slice2 (`main.tsx` L84–86) | `assets/crane_magnet.glb`, `assets/bucket.glb`, `assets/hopper.glb` (+ on-disk `conveyor.glb`, `box_large.glb`) | `conveyor.glb` is **byte-identical (MD5 match)** to Factory Kit 3.0 `GLB format/conveyor.glb`. `crane_magnet.glb`, `bucket.glb`, `box_large.glb`, `hopper.glb` have no name-match in packs → derived/assembled Kenney variants or custom stand-ins (git: assembled via `assemble_node_glbs.py`, commit 7c7b746 "Kenney GLBs rendered directly"; hopper added in 9c45613). |
| slice3 (`main.tsx` L6/L112) | none — placeholder box; open question to swap Kenney `DRP.glb` when supplied | — |
| slice5 (`main.tsx` L71) | none — procedural boxes as stand-ins | — |

Agreed policy for future use (Raodmap V3.md, MARKED 19.10): Factory Kit 3.0 = conveyors/catwalks/tanks/chimneys/boxes; City Kit Industrial = containers/water tower/background buildings; hero machines (EAF, ladle, CCM, bucket crane) = procedural three.js primitives or custom GLBs.

## 3. Custom / historical GLBs in `assets_incoming/` (committed to git)

Provenance: Yasser-generated via **ComfyUI** (NEXT_SESSION_PROMPT.md: "Yasser generates art himself in ComfyUI"; commit 3dd13ce "Yasser ComfyUI GLBs"; decimated copies live at `content/assets/models/cc0/yasser/` and `yasser_decimated/`). These are project-owned custom assets — no third-party license; **no attribution required**. Original colors kept (Yasser decision).

| Asset | Size | Notes / current use |
|---|---|---|
| `EAF.glb`, `ccm.glb`, `DRP.glb`, `LRF.glb`, `rm.glb`, `shredder.glb`, `wire rod.glb` | 61–79 MB each | Original ComfyUI exports; too large for web builds (size policy); decimated variants used in Godot simcity layer. Not referenced by any browser scene yet (browser uses procedural primitives per asset-split policy). |
| `EAF 1024.glb`, `ccm 1024.glb`, `LRF 1024.glb`, `rm 1024.glb`, `shredder 1024.glb`, `wire rod 1024.glb` | ~21 MB each | 1024-texture footprint-scaled variants (commit 3dd13ce), primary model layer in Godot UI phase. |

## 4. Textures / icons referenced by scenes

- Browser scenes reference **no image files** directly (grep png/jpg/webp/svg in slice main.tsx = none). Kenney `colormap.png` is embedded inside the GLBs (`assets_incoming/Kenny/Textures/colormap.png`; per-pack copies under `Models/*/GLB format/Textures/`).
- Icons/JPGs/WebPs in `assets_incoming/` (EAF.jpg, drp icon.jpg, rebars.webp, smp icon.png, …) are Yasser ComfyUI art used by the Godot UI layer (`content/assets/icons`, `content/assets/symbols`), not by browser scenes.

## 5. Findings / gaps

1. All three Kenney packs are **CC0** — no legally required attribution; recommended credit block above satisfies repo policy and License.txt's optional-credit wording.
2. `assets_incoming/Kenny/` (packs, SHIP.glb, DRP.glb, colormap) is **untracked in git** — staged on disk only, consistent with the size policy. Consider committing just the License.txt files + this manifest so license records are versioned.
3. Loose `SHIP.glb` / `DRP.glb` lack their own License.txt; label them Kenney-CC0 in credits and record the source pack when re-downloaded.
4. Deployed browser GLBs are processed variants of pack models (conveyor verified byte-identical; crane/ship rescaled/textured) — license carries over unchanged (CC0 derivatives).
