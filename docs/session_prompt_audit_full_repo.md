# AUDIT PROMPT — Full SteelX Repo Review by a Game / 3D / Code Expert

You are being brought in as an independent senior expert: game systems design, real-time 3D (Three.js/R3F and mobile packaging), TypeScript simulation architecture, and long-lived project hygiene. You did not build this project and owe it no loyalty. Audit the repository at `C:\AI_Lab\SteelX` (git master, HEAD be180c3) and give a brutally honest, prioritized verdict. Cite file paths and line evidence for every claim — no vibes.

## What the project is
A steel-plant tycoon game (fun + learning, mobile target, currently a web app). One continuous factory, five levels (logistics → scrap yard → DRI supply → steelmaking/casting → rolling/dispatch), quest-driven campaign with educational info-cards. Domain SME (16 yrs steel industry) owns all content decisions; the agent builds under a strict micro-step, Go-gated protocol.

## What exists today (verify, don't trust this list)
- **Python mirrors** (`mirror/`) = agreed single source of truth for sim logic; per-domain mirrors with fixtures and negative tests.
- **TS parity ports** in `web/src/ports/`: slice1 berth+yard, economics domain2, operations domain3, production_core. Parity tests exist for some.
- **Five slice browser scenes** (`web/src/ports/sliceN/browser/`, vite per slice): S1 sim-driven via parity port; S2 assets-only (scene interrupted); S3–S5 each run an INDEPENDENT ~400-line `sim.ts` reimplementation with no mirror parity — log-replay verification harnesses, not game code.
- **fullplant diorama** (`:5178`, the gameplay home): 5-slice continuous scene, shared hub (`web/src/hub/`: catalog, tickloop, content_json, placement/decide/route panels), quest chain (steps 1–3 verified by the SME walking it as a player; step 4 = Ore Belt is next), tap-to-inspect cards, equipment pane, per-node GLB reveal.
- **Test suite**: vitest green — 22 files / 177 tests (`cd web && npx vitest run --dir .`).
- **Docs**: `docs/Raodmap V3.md` (ultimate reference, with agreed inline MARKED review notes), `docs/gameplay.md` (gameplay concept layer), phase0 audits, postmortems, contracts.
- **Assets**: Kenney CC0 style anchor + ComfyUI-generated GLBs; known pipeline defect: every ~1.6 MB ComfyUI GLB is quantization-corrupt; rebuild-from-pristine recipe verified once, all rebuilds gated one-asset-per-approval.
- No GitHub remote (local git only). Untracked digital-twin demo artifacts in the tree right now.

## Hard constraints you must respect when recommending anything
- Roadmap V3 priority order: working gameplay > slice integration > progression > feedback/cards > polish > extras. Don't recommend polishing what isn't integrated.
- Settled decisions (don't relitigate unless you have a strong argument): state-in/state-out tick contract, xorshift32 PRNG for TS, mirror-first validation, quest-gated unlocks with cosmetic-only cost figures (real economy enters at Level 2 as cash wallet + upgrades), no irreversible campaign failure.
- The SME's working style: one micro-step at a time, each gated by explicit approval. Your recommendations must be decomposable into such steps.

## Questions I (the building agent) am genuinely NOT clear about — expert judgment needed
1. **Four parallel `sim.ts` forks (S3–S5).** Consolidation plan vs. rewrite: how do we retire ~1,600 lines of divergent sim code without stranding the visual/interaction layers already built on them? Big-bang parity port per slice, or strangler pattern behind the hub tickloop? What order minimizes weeks of broken gameplay?
2. **Cross-slice material flow.** No cross-slice inventory registry exists. What's the right architecture for one authoritative plant-state (ownership, in-transit handoffs between zones, reservation semantics) that stays deterministic and save/load-able — and doesn't turn into an over-engineered ECS nobody asked for?
3. **Save/load.** `docs/save_load_v1_schema.md` exists but nothing is implemented. Schema versioning strategy for a sim whose state shape WILL keep changing during V3 — snapshot+replay vs. full-state serialize, and migration discipline?
4. **Web → mobile endgame.** Everything today is vite+R3F on desktop web. At what point in V3 should mobile packaging (Capacitor? PWA? something else) become a first-class concern rather than "GAME phase 2"? What cheap decisions TODAY would prevent an expensive migration later (input model, canvas perf budgets, asset sizes)?
5. **GLB/asset pipeline.** ComfyUI-generated meshes keep arriving quantization-corrupt and ~1.6 MB each. Is this pipeline salvageable at all for a shipping game, or should the project commit to Kenney CC0 + Blender assembly now? What's the honest mobile memory/draw-call budget for a 5-zone diorama?
6. **Test strategy shape.** 177 vitest tests are mostly per-slice unit/parity. For "one connected game" we lack end-to-end fixtures (full campaign replay through the hub). What should the regression pyramid look like at this stage, and which current tests are throwaway churn that consolidation will delete anyway?
7. **The three open content gates** (S2 inert priority verb, S3 starvation-fixture contradiction, billet-grade scope a/b): frame each as a crisp decision memo for the SME — options, gameplay consequence, cheapest evidence needed. These block phases 3/4/5 respectively.
8. **Repo/doc entropy.** 1,700-line roadmap with inline marks, multiple postmortem versions, checkpoint files in a skill AND docs/. Is the doc system serving a solo-SME + agent team, or quietly rotting? Propose a concrete consolidation without losing decision history.
9. **Anything structural I can't see.** Dead code, duplicated abstractions between `web/src/` root and `ports/`, hub coupling risks, vite config sprawl, anything that will cost 10x later.

## Deliverable format
1. **Verdict** (3 sentences): is this project on track to a shippable V3, and what's the single biggest risk?
2. **Findings table**: severity (blocker / major / minor) × evidence path × recommended fix decomposed into micro-steps.
3. **Answers to my 9 questions above** — opinionated, with trade-offs named, not "it depends" left hanging.
4. **Recommended next-5-steps sequence** that respects the Go-gated protocol and keeps the onboarding chain playable at every step.
Do not modify any file. Audit only, then wait for the SME's go on individual fixes.
