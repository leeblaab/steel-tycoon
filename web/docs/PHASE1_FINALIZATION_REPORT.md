# SteelX — Phase 1 Finalization Report

Date: 2026-10-19 · Scope: Roadmap V3 Phase 1 build items (a–d) + verification.
Status: **Phase 1 complete.** All build items shipped and verified end-to-end in the live WebGL hub scene.

## What was built (build item d — tap-to-inspect factory scene)

- **Common plant layout** `content/layout/factory_layout_v1.json` + typed loader `web/src/shared/factory_layout.ts`: 6 painted zones (yard → DRP → EAF → LRF → CCM → mill), flow arrows, slot definitions with owner-slice tags. Approx game numbers (per Yasser's ruling: gameplay-first, not industry-accurate).
- **Factory scene** `web/src/scene/factory_scene.tsx`: one continuous R3F scene in the hub (`web/src/scene/factory_view.tsx` wired into `main.tsx`), all slices visible as static dioramas + per-slice FOCUS mode (only the focused slice's sim ticks — hub tickloop unchanged).
- **Inspection cards** `web/src/shared/inspection_cards.ts`: tap a machine → card. Focused slice gets a live "what it is doing now" telemetry card; neighbor slices get an explicit "belongs to another slice" card; unbuilt ghost slots get a capacity/cost preview card. Card schema matches the roadmap's popup info-card layer.
- **Camera fit + aim** (this session's fix): camera distance now solves the *horizontal* binding constraint measured from the real canvas box (ResizeObserver), and a `CameraAim` component (inside `<Canvas>`, per the LabelCameraBridge rule) aims at the footprint center. Before the fix, distant slots projected outside the canvas so their clicks never reached R3F; after, the whole 104-unit plant fits the box symmetrically.

## Verification evidence (all on the shipped bundle `index-CxND7hBX.js`)

| Check | Result |
|---|---|
| Tap probe, **Slice 4 focus** — all 9 slot meshes clicked at projected screen positions | 9/9 cards: live telemetry for EAF ("Melting charge C2 — 40.0 t"), LRF, Caster; neighbor cards for slice1/slice5 units; preview cards for ghost slots (`s1_scrap_yard`, `s3_drp`, `s3_dri_buffer`). Page errors: 0 |
| Tap probe, **Slice 5 focus** — same 9 slots | 9/9 cards: live telemetry for Rebar Mill ("Rolling a batch — 10.0 t"), neighbor cards for slice4 units, ghost previews unchanged. Page errors: 0 |
| Vitest suite (14 test files: layout, gate0, hub_tickloop, inspection_cards, inventory_registry, parity_ops, save_load, slice3/4/5 parity, economics/production_core/slice1/sustainability port parities) | **123 passed / 123** |
| `node scripts/smoke_resume.mjs` (save → reload → "continued from tick 30"; slice-switch rebuilds fresh loop) | **PASS** on the new bundle |

## Deferred items → Phase 2 (kept, not fixed — per instruction)

1. **Slice 1 berth live-telemetry parity**: `s1_berth_1` currently only shows the neighbor card when slice1 isn't focused; its sim exposes no "doing now" detail line yet (transport starts paused). Needs a small state→detail mapping in slice1's adapter.
2. **Camera orbit / free look + pinch-zoom** — roadmap decision 1 puts free camera in Phase 2 build mode; Phase 1 keeps the fixed cinematic fit view. Fit math also doesn't yet account for label overflow on very narrow phone aspect ratios (labels can clip).
3. **Label overlay polish**: zone labels and slot labels are plain DOM text; "doing now" detail truncation, occlusion, and label decluttering at small canvases are Phase-2 UI work (Phase2_UI_Plan.md).
4. **Maintenance/asset-management cards** ("doing now" observe-only cards shipped; interactive maintenance actions stay in GAME phase 2 per the factory design agreement of 19.10).
5. **DebugBridge / probe scaffolding**: `window.__r3f`, `__r3f_interaction()` and ~10 throwaway probe scripts (`web/scripts/probe_factory_*`, `web/cache/tmp_ray*`) were the verification rig. Decision needed at review: keep DebugBridge behind a dev flag or strip it before any store build.
6. **Commit pending**: everything above is currently uncommitted working-tree changes (modified `web/src/hub/{catalog,main}.ts(x)`; new `content/layout/`, `web/src/scene/`, `web/src/shared/factory_layout.ts`, `inspection_cards.ts`, tests). Suggested commit split at review: layout+loader → cards → scene+wiring → camera fix.
7. **Layout numbers sanity pass**: zone/slot numbers are plausible game approximations (e.g. DRP 500k–2.5M t/yr, EAF cost bands) — fine for Phase 1; a worldsteel/GAST grounding pass is optional polish, not a blocker.

## Known pitfalls recorded (scene work)

- Any R3F hook outside `<Canvas>` crashes the whole app (LabelCameraBridge / CameraAim precedent).
- Vite hub build must run in background (`npx vite build --config vite.hub.config.ts`, outDir `web/cache/hub_build_check`) then copy `assets/` + `index.html` into `web/src/hub/dist/hub`; the static server must serve that dist dir exactly.
- Vitest needs `--root .` from `web/` (a port subfolder's package context otherwise hijacks test discovery).
