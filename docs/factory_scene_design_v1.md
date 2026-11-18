# Factory scene design v1 — decisions gate CLOSED (agreed by Yasser, 2026-10-19)

Design item (d) of Phase 1. Four decisions approved; these are the binding rules for building the common factory scene.

## 1. General layout with all slices visible + per-slice focus mode
- One continuous plant scene: material visibly flows yard → DRP → EAF → LRF → CCM → mill. Spatial process flow is the strongest teaching device — a backed-up bottleneck teaches congestion without a lecture.
- Painted flat-color zones + ghost unbuilt slots per the agreed visual rules (fixed cinematic camera until Phase 2 build mode).
- **Focus rule (binding): focus = only this slice's sim ticks.** Neighbor slices stand as static dioramas — painted zones, idle machines, ghost slots, optionally frozen "last known state" telemetry. Running five authoritative loops in lockstep is cross-slice transfer design (§8.3) and belongs to a later phase, not the shell.
- Technical note: the hub today runs one slice loop at a time (clicking Slice 4 rebuilds state fresh) — this matches the diorama rule directly.

## 2. "What is this machine doing now" cards first; maintenance/asset mgmt deferred
- Inspection card = pure view over sim state, zero new mechanics. Slice4 already emits exactly this language (`ladle_wait`, `caster_wait`, `busy_charge_id`, …) — the card is literally a projection.
- Observe-only in V3. CMMS-style condition/maintenance (user's 16-year domain: ISO 9001/14001/45001, CMMS/TPM) lands in **GAME phase 2**, because maintenance only becomes interesting once there is a downtime-cost economy.

## 3. Webapp now; mobile packaging in GAME phase 2
- Guard (binding interaction rule): keep the primitive touch-simple even on web — tap machine → card; no hover-dependent UI, no tiny targets. "Adding mobile later" must stay packaging, not a UI redesign. The hub's DOM-overlay pattern already passes this test; keep it when the 3D scene lands.

## 4. Ghost slots carry preview cards (approved recommendation)
- Every ghost/unbuilt slot shows a preview card on tap: capacity, rough cost band from content JSON, and one learning line — e.g. "a DRP discharges continuously; this slot holds its output so the EAF never starves."
- Cost near-zero in V3 (no building mechanic yet): content JSON + existing InfoCard component.
- This is where tycoon-fantasy and the learning layer fuse cheapest: the player reads a future machine before ever building it, and §6.6 card triggers get something to fire on.

## Scope boundary
Maintenance/asset management and mobile packaging are **GAME phase 2 items — explicitly NOT roadmap V3 items**. Recorded so they don't creep into Phase 1 build sessions.
