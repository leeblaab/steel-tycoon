# Phase 0 Audit — UI Components & Styling Inventory (Task A)

**Scope:** the five browser scenes under `web/src/ports/slice{1..5}/browser` (React 19 + React Three Fiber + Vite).
**Method:** read-only static inspection of every `main.tsx`, `index.html`, and vite config; programmatic diff of the embedded `<style>` blocks (rule sets) and of shared component/hook bodies (byte-level comparison, whitespace-normalized where noted). No tests were run. Generated 2026-10-18.

---

## 0. Headline findings

- **Every scene is one monolithic `main.tsx`** (320–448 lines) plus its own `index.html`. There are **no component files, no component directory, and no shared UI layer anywhere under `web/src`** — no `shared/`, `ui/`, or `components/` dir exists.
- **Styling is 100% ad-hoc:** a single embedded `<style>` block inside each scene's `index.html`, plus a handful of inline `style={{...}}` attributes in JSX. There are **zero `.css` files under `web/`**, and **no Tailwind, no styled-components, no CSS Modules**.
- **The five stylesheets are copy-paste forks.** 24 CSS rules are byte-identical across all five scenes; the union of all rules is only 50. Slice1 has **zero** rules unique to itself — its entire stylesheet is a subset of what other scenes already define.
- **The JS is the same story:** `useOrbitCamera` is byte-identical in slice1/3/4/5; `LabelCameraBridge` + `LabelLayer` + module-level `CAM`/`LABELS` globals + the `Building` box component recur in 4–5 scenes with only cosmetic (formatting) or trivial (`label`→`text`, added `cls`) drift. Slice2 is the deliberate outlier (fixed camera, GLB models, module-level playback state).
- **Config hygiene issue:** slice5's vite dev server is configured on **port 5173 — the same port as slice1** (`web/vite.config.ts`), so the two scenes cannot run concurrently.

---

## 1. Per-slice inventory

### Slice 1 — `web/src/ports/slice1/browser/` (raw materials yard / shipping)
Files: `main.tsx` (327 lines, 14.2 KB), `index.html`, `tsconfig.json`. No scoped vite config — runs via root `web/vite.config.ts` (`root: src/ports/slice1/browser`, port **5173**).

Components defined in `main.tsx`:

| Component | Renders |
|---|---|
| `useOrbitCamera()` | hook: drag-to-orbit camera, elevation clamp 15–75° |
| `Building` | generic `<mesh>` box + accent strip; pushes a label into the global `LABELS` array |
| `LabelCameraBridge` | R3F bridge stashing the live camera in module ref `CAM` |
| `LabelLayer` | **DOM overlay** outside the Canvas: projects every `LABELS` entry to screen coords on a 100 ms interval, renders `.blabel` divs into `#labels` |
| `Yard`, `Conveyor`, `Ship`, `Cranes`, `Jetty` | 3D scene content (stockpile bins, belts, GLB ship/cranes via `new URL('./assets/…', import.meta.url)`) |
| `Dispatch` | the **HUD panel**: stat rows, progress bars, badges, event log, learning note, and the **Start / Pause / Reset / Step +1** button row (500 ms `setInterval` sim ticker via `timer.current`) |
| `Scene`, `App` | Canvas wrapper (`#scene`) + flex layout (`#root`: scene left, `#overlay` right) |

Styling: embedded `<style>` in `index.html` — **29 rules**. Inline styles only for label positioning (`left`/`top`) and bar fills (`width`).
Shared vs unique: **shares all 24 core rules; contributes nothing unique** (0 unique rules). Its whole stylesheet is duplicated verbatim elsewhere.

### Slice 2 — `web/src/ports/slice2/browser/` (scrap yard → EAF charge)
Files: `main.tsx` (448 lines, 18.5 KB), `index.html`, `vite.slice2.config.ts` (port **5174**, outDir `web/cache/slice2_browser_build`).

Components: `useTick`, `FixedCamera` (**no orbit** — fixed view), `zone`, `Ground`, `CraneRig`, `Stack`/`stacksAt`/`YardStacks`, `Trucks`, `ChargeBuckets`, `EafGhost`, `ReclaimHopper`, `lerp`, `locXZ`, `LabelCameraBridge` (variant), `Labels`, `Scene`, `Overlay`, `Panel`, `App`.
HUD: `Overlay`/`Panel` render the stat/bar/badge/eventlog/learn markup, plus **charge cards** (`.charge` with `.head`) and amber tonnage labels (`.tonlabel`).

Key divergences from the other four: GLB Kenney models (`crane_magnet.glb`, `bucket.glb`, `hopper.glb`) loaded via **public `/assets/...` paths** — with a documented pitfall comment that `new URL('./assets/…', import.meta.url)` breaks under this config's root; **module-level mutable playback state** (`tick`, `playing`, `speedMul`, `listeners`/`notify`) instead of React state; `LabelCameraBridge` writes `VIEW.w/h` from `useThree().size` and `Labels` projects in a `requestAnimationFrame` loop instead of the 100 ms interval + `getBoundingClientRect()` used elsewhere. No `Building` component.

Styling: embedded `<style>` — **34 rules**. Unique to slice2: `.charge`, `.charge .head`, `.tonlabel` (amber), `#overlay { max-width: 340px }`.
Shared vs unique: shares 24 core rules + 6 more with slice5; **closest sibling is slice5** (30 shared, differ only in card class name, tonlabel color, overlay width).

### Slice 3 — `web/src/ports/slice3/browser/` (hot DRI / EAF melt flow)
Files: `main.tsx` (416 lines, 20.0 KB), `index.html`, `tsconfig.json`, plus build/render check scripts (`build_check.mts`, `render_check.mts`). **No vite config at all** — must be run with an ad-hoc `--root`.

Components: `useOrbitCamera`, `Building`, `LabelCameraBridge`, `LabelLayer` (all four byte-identical to slice1), then `DrpUnit`, `Conveyor`, `Buffer`, `Eaf`, `FlowCubes` (3D content), `Scene`, `App` (HUD with stat rows, `.bar` progress bars, badges, event log, learn panel, playback buttons).

Styling: embedded `<style>` — **29 rules**, 28 shared with slice1. Unique to slice3: bare `.bar > div { height: 100% }` (slice1's adds `background: #3f7fbf`).
Shared vs unique: near-fork of slice1; all scene models (`DrpUnit`, `Eaf`, …) are unique.

### Slice 4 — `web/src/ports/slice4/browser/` (ladle / secondary metallurgy)
Files: `main.tsx` (320 lines, 17.5 KB), `index.html`, `tsconfig.json`; runs via root-level `web/vite.slice4.config.ts` (port **5175**, outDir `C:/AI_LAB/SteelX/cache/s4_build_out`).

Components: `useOrbitCamera` (identical to slice1), `LabelCameraBridge` + `LabelLayer` (**same logic, reformatted onto single lines**; `LABELS` entries renamed `label`→`text` and gain a `cls` field), `Building` (same drift), `stageState`, `slotX`, `FlowCube`, `ladleFreeInView`, `Scene`, `App`.
HUD: unique **`#ladleHud`** floating panel top-right of the scene (`stageState` + `ladleFreeInView` — described in CSS as "the pedagogical core"), `.indicator` amber tags, amber progress bars, and a `button.active` selected-state style.

Styling: embedded `<style>` — **35 rules**. Unique to slice4 (7): `#ladleHud`, `#ladleHud .big`, `#ladleHud .dot`, `.indicator`, `button.active`, amber `.bar > div { background: #c9a15a }`, plus a comment line.
Shared vs unique: shares all 24 core rules; the most CSS divergence of any slice, but every shared rule is still a copy.

### Slice 5 — `web/src/ports/slice5/browser/` (finished-goods dispatch / competing orders)
Files: `main.tsx` (334 lines, 18.6 KB), `index.html`, `tsconfig.json`, `vite.slice5.config.ts` (port **5173 — collides with slice1**, outDir `web/cache/slice5_browser_build`).

Components: `useOrbitCamera` (identical to slice1), `LabelCameraBridge`/`LabelLayer`/`Building` (slice4-style one-line reformatting, `cls` field), `BilletYardModel`, `RebarMillModel`, `ProductYardModel`, `DispatchCraneModel`, `useLerp`, `CarrierMove`, `DispatchMove`, `CompetingBadge`, `OrderDocks`, `Scene`, `App`.
HUD: **order cards** (`.order` with `.head`) mirroring slice2's charge cards, blue tonnage labels, badges for competing orders, event log, playback buttons.

Styling: embedded `<style>` — **34 rules**. Unique to slice5 (3): `.order`, `.order .head`, `.tonlabel` (blue variant).
Shared vs unique: near-fork of slice2 with the card vocabulary renamed charge→order; 30 rules shared between them.

---

## 2. Shared UI directory check

`web/src` contains only `ports/{economics, operations, production_core, slice1…slice5, sustainability}` (plus a build-cache dir). **No `shared/`, `ui/`, `components/`, or similar directory exists.** All cross-scene reuse is copy-paste inside each scene's own `main.tsx`.

---

## 3. Shared vs duplicated — synthesis table

### 3a. CSS rule overlap (rules = normalized selector+body lines from each `<style>` block)

| Slice pair | Identical rules | Only in left | Only in right |
|---|---|---|---|
| slice1 ↔ slice2 | 25 | 4 | 9 |
| slice1 ↔ slice3 | **28** | 1 | 1 |
| slice1 ↔ slice4 | 26 | 3 | 9 |
| slice1 ↔ slice5 | 25 | 4 | 9 |
| slice2 ↔ slice3 | 24 | 10 | 5 |
| slice2 ↔ slice4 | 25 | 9 | 10 |
| slice2 ↔ slice5 | **30** | 4 | 4 |
| slice3 ↔ slice4 | 26 | 3 | 9 |
| slice3 ↔ slice5 | 24 | 5 | 10 |
| slice4 ↔ slice5 | 26 | 9 | 8 |

Rule counts: s1 29 · s2 34 · s3 29 · s4 35 · s5 34. **Shared by all five: 24. Union of all rules: 50.** Rules unique to exactly one slice: s1 **0**, s2 4 (`.charge`, `.charge .head`, `.tonlabel` amber, overlay max-width 340px), s3 1 (bare `.bar > div`), s4 7 (`#ladleHud` +2, `.indicator`, `button.active`, amber bar fill, comment), s5 3 (`.order`, `.order .head`, `.tonlabel` blue).

The 24 universally shared rules are the de-facto design system: dark base (`html,body`, `:root { color-scheme: dark }`), layout (`#root` flex, `#scene`, `#labels` overlay), panels (`h1`, `h2`, `.learn`, `.stat`, `.bar`, `.badge` + `.on`/`.off`), buttons (`button`, `.primary`, `.danger`, `:disabled`), labels & text (`#overlay .big`, `.blabel`, `.hint`, `.blocked`, `.flow`, `.eventlog div`).

### 3b. JS component/hook overlap (byte-level diff of function bodies)

| Piece | slice1 | slice2 | slice3 | slice4 | slice5 | Verdict |
|---|---|---|---|---|---|---|
| `useOrbitCamera` | ✔ | ✘ (`FixedCamera`) | ✔ | ✔ | ✔ | **Byte-identical in s1/s3/s4/s5** (incl. 15–75° elevation clamp) |
| `LabelCameraBridge` + `CAM` ref | ✔ | variant (`size`→`VIEW.w/h`) | ✔ identical | ✔ (one-line format) | ✔ (one-line format) | Same pattern in all 5; 3 byte-identical to s1 |
| `LabelLayer`/`Labels` DOM-overlay projection + `LABELS` global | ✔ | variant (rAF loop) | ✔ identical | ✔ (`label`→`text`, +`cls`) | ✔ (+`cls`) | Same algorithm in all 5; cosmetic drift only |
| `Building` (box + accent, self-registers label) | ✔ | ✘ | ✔ identical | ✔ reformatted/renamed | ✔ reformatted | Copy-paste in s1/s3/s4/s5 |
| HUD panel markup: `.stat`, `.bar`, `.badge`, `.eventlog`, `.learn` | ✔ | ✔ | ✔ | ✔ | ✔ | Same class vocabulary + JSX structure in all 5 |
| Start / Pause / Reset / Step +1 button row | ✔ | ✔ (via `Panel`) | ✔ | ✔ | ✔ | Copy-paste control strip in all 5 |
| 100 ms label-refresh interval | ✔ | ✘ | ✔ | ✔ | ✔ | Identical literal in 4/5 |
| Card component (`.charge` / `.order`) | ✘ | ✔ | ✘ | ✘ | ✔ | s2↔s5 structural fork, renamed |
| Scene models (`Yard`, `DrpUnit`, `Eaf`, `BilletYardModel`, …) | unique per slice | | | | | Genuinely slice-specific |

Also duplicated as *conventions* (not code): module-level `CAM` ref + mutable `LABELS.push()` from inside render (`Building` mutates a module array during render — fragile), the 500 ms sim-ticker `setInterval`, and clone-per-GLB-instance pitfall comments (s1, s2, s5).

---

## 4. What a Phase 1 shared UI shell should consolidate

A `web/src/shared/ui/` package would absorb, in priority order:

1. **One stylesheet / theme token file** (~24 rules): the dark palette, panel/bar/badge/stat/button/hint/learn classes, layout frame (`#root`/`#scene`/`#labels`). Per-slice styles then shrink to genuine deltas only — slice4's `#ladleHud`/`.indicator`, s2/s5 card + tonlabel color variants (parameterize as a `tone` prop or CSS custom property instead of forking `.charge` vs `.order`).
2. **The label system**: `LabelCameraBridge` + a single `LabelLayer` with a stable `{id, text, cls, world}` contract and one projection strategy (rAF), eliminating the three drifting variants and the mutable global `LABELS.push()`-during-render hack.
3. **`useOrbitCamera`** as-is (already byte-identical 4×) plus slice2's `FixedCamera` as a mode of the same hook.
4. **`Building`** with the `cls`/label-contract fix, shared by s1/s3/s4/s5.
5. **Playback controls + HUD primitives**: `StatRow`, `Bar`, `Badge`, `EventLog`, `LearnPanel`, and a `PlaybackControls` (Start/Pause/Reset/Step) component bound to one ticker hook — currently 5 hand-rolled copies with two different state models (React state vs slice2 module globals).

Net effect: ~50 union CSS rules collapse to ~1 shared base + ≤7 deltas, and four byte-level code families (~4 helpers × 3–4 copies) collapse to single implementations. Also fix during Phase 1: give slice5 its own dev port (currently collides with slice1 at 5173), and give slice3 a scoped vite config like slices 2/4/5.

---

*Read-only audit; no files modified outside `docs/phase0_audit_ui.md`. Pairwise overlap numbers are reproducible by normalizing each `<style>` block to non-empty trimmed lines and intersecting the sets.*
