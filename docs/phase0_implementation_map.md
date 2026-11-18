# SteelX — Phase 0 Implementation Map + Ordered Backlog

Roadmap V3 §15 Phase 0 deliverable ("a concise implementation map and a short ordered backlog"). Prepared 2026-10-18. Scope per §2.2 mark: only the three gap questions (UI/styling, asset manifest, sim.ts reusability). Established facts were not re-derived. Detail lives in the three audit reports; this file is the map + backlog. No commits made (§17.5).

## Verified evidence base

- `docs/phase0_audit_ui.md` — UI/styling inventory (child audit A, spot-checked against disk: 5 monolithic `main.tsx`, zero project `.css` files, configs as claimed).
- `docs/phase0_audit_assets.md` — asset manifest with licenses (audit B; three Kenney packs confirmed on disk).
- `docs/phase0_audit_sims.md` — sim.ts parity verdicts (audit C, source-inspection method — caveat: by reading, not executing).
- `docs/SME_gate_brief.md` — gate evidence for the four decisions.

## Implementation map (what exists → what Phase 1 consumes)

| Layer | Today | Reusable as-is | Must change in Phase 1 |
|---|---|---|---|
| Entry points | 5 separate `index.html` + vite configs (`vite.config.ts` roots S1, `vite.slice4/5/slice2.config.ts`; **S3 has no config file** — runs ad-hoc; S5 dev port collides with S1 on 5173) | per-scene launch for regression checks | one application entry point + shared scene shell |
| UI | each `main.tsx` (320–448 lines) inlines all components; embedded `<style>` per index.html; **24 CSS rules byte-identical across all five**, union 50; no shared dir exists | the 24-rule base sheet, HUD markup vocabulary (`.stat/.bar/.badge/.eventlog/.learn`), Start/Pause/Step controls | extract `web/src/ui/`: base stylesheet, HUD primitives, label system (`LabelCameraBridge`+`LabelLayer`, 4–5 copies), `useOrbitCamera` (4 identical copies) + fixed camera (S2 variant) |
| Simulation | S1: parity port `slice1_berth_yard.ts` ✅. S2 scene: interpolation-only from frozen timeline ✅ (no sim). S3/S4/S5: independent `sim.ts` reimplementations in-scene | tick logic of all three (verdicts below) | one authoritative tick loop + shared inventory registry (§8.1 mark); rng state must live **inside** sim state for §13 saves |
| Sim parity verdicts | — | **S3: keep** (line-faithful port; only gap: rng state outside sim state). **S4: keep with 4 fixes** (hardcoded yields vs `content/scrap/scrap_tiers.json` runtime load; missing `dri_materials` ledger; no explicit `bath_t`; negative-control modeling differs) | **S5: replace** with parity port from `slice5_mirror.py` — TS lacks test seams (`double_count`, `max_dispatch_moves`), has uncounted visual payloads (`carrier_transit_t`, `mill_in_process_t`) compensated by ≤100 t mid-run balance residuals (the §8.1-forbidden divergence class) |
| Content/config | `content/` (cards, scrap tiers, prices, schema…), fixtures as acceptance data | all of it; frozen fixtures = parity acceptance suite | quest/card content wiring starts Phase 2 |
| Assets | Kenney Factory Kit 3.0 / City-Kit Industrial 2.0 / City Kit Roads 2.2 — **all CC0** (attribution optional, credit block drafted in audit B); custom GLBs are Yasser's own (project-owned); `SHIP.glb`/`DRP.glb` provenance flag | everything; visual-mix policy already proven in S2 scene | commit License.txts + LICENSES.md attribution record (small, license-hygiene) |
| Save/load | none | — | minimal versioned snapshot in Phase 1 shell (§13 mark, pending Decision 4 confirmation) |

## Ordered backlog (Phase 0 output → Phase 1 input)

1. **SME gate** — answer Decisions 1, 3, 4 in `docs/SME_gate_brief.md` (Decision 2 already resolved on disk; needs confirmation only). No code during the gate.
2. **S5 parity port** from `slice5_mirror.py` + fixture-driven parity test (worst divergence first).
3. **S4 targeted fixes** (yield source, dri ledger, bath_t, negative control) + S4 parity test; **S3 rng-into-state fix** + S3 parity test. Acceptance data: frozen fixtures per slice.
4. **Shared UI shell extraction**: `web/src/ui/` — 24-rule base sheet, HUD primitives, label system, camera hooks; wire into all five scenes without visual change (refactor gate = same visuals).
5. **One entry point + one tick loop + shared inventory registry** wrapping per-slice sim modules (§8.1 mark); fix S3 missing vite config and the 5173 port collision while wiring the shell.
6. **Save/load v1** per Decision 4 schema (versioned snapshot: save_version, level_id, tick, running, rng_state, inventories, unlocks, quest_progress?).
7. **License hygiene commit**: Kenney License.txts + attribution block (tiny; bundle with any later authorized commit).

## Phase 0 status: CLOSED

All three gap questions answered; critical decisions are clear; per §Phase-0 discipline ("stop inspecting once the critical decisions are clear") inspection stops here. Next in roadmap order: **SME decisions gate** → Phase 1.
