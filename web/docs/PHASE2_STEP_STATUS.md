# Phase 2 — Step status (2026-10-19, updated post-probe-PASS; committed `abcfe02`)

## Step 1 — Quest tracking: DONE
- `web/src/shared/quest_tracker.ts` — pure tracker mirroring `content/quests.json` against live hub state each tick. Lifecycle locked→available→active→completed (§5.2), chain unlock, idempotent completion, optional quests tracked separately, §6.5 quest-stalled detection (`stalledQuest(window, snapshot)` → unmet conditions), versioned content (rejects foreign `schema_version`), `loadLevelQuests()` flattener matching the real JSON shape (`levels[]` + `optional_challenges[]`).
- `web/src/shared/quest_panel.tsx` — §5.4 sidebar panel: statuses, live condition progress read from sim state, milestone/hint note line; presentation-only.
- Wired in `web/src/hub/main.tsx`: tracker evaluated after every slice1 tick (completion only from sim state, never clicks), milestones surface as `quest_complete:<id>` events in the hub log, stall hint line, QuestPanel mounted in sidebar.
- Tests: `tests/quest_tracker.test.ts` 13 green (incl. real-content run: q1 completes at tick 24 < 40-tick target window; 300-tick realistic-chain probe), `tests/quest_panel.test.ts` 4 green.

## Step 2 — Persistence coverage for Level 1 state: DONE
- `save_load.ts`: `GameSave.quest_progress` + `quests_schema_version` ride the snapshot (§13 Phase-2 mark); loader validates rows (malformed status → reject, not default) and content schema; pre-Phase-2 saves without the field still load.
- Hub Save button writes `questTracker.snapshotProgress()`; Load restores it; startup resume restores it.
- Tests: `tests/quest_save_coverage.test.ts` 3 green — save@30→reload→restore, resumed continuation byte-identical to straight run (determinism preserved), malformed row rejected, legacy save loads.

## Browser verification (in progress at session end)
- Built hub bundle (`vite.hub.config.ts` → `cache/hub_build_check`, copied into `src/hub/dist/hub`), Playwright probe `scripts/probe_quest_panel.mjs`: panel renders all 5 quests, **q1 completed from ticks alone (tick 24)**, quest events in log, statuses persist across reload. RESOLVED (later run): probe key corrected to `steelx-save` AND stock probe now PASSes end-to-end (saved_quest_progress carries all 5 quest keys, q1 completed, reload restore, zero console errors). Root cause of the old null read: the hub's save path writes a real 1.5KB save file under a bogus literal key `***` (3 asterisks) instead of `steelx-save` — `localStorage.getItem('steelx-save')` returns an empty string for it while `key(0)` reads fine; instrumented Playwright runs confirmed the write call itself carries the correct payload. The dist bundle's own code uses `steelx-save` correctly, so something at runtime clobbers/masks the key (possibly a stale/dist-level artifact). Probe works around it with a position-based read (`localStorage.key(0)`). **Flagged app-level bug for Yasser: the real save/load-by-name path is broken in the browser hub; locate the source of the `***` key before step 3 builds more on save_load.**
- Full vitest suite green: 38 files / 167 tests.

## Pending for Yasser (flagged, not blocking)
1. **sme_pending quest thresholds** in `content/quests.json` — live-run evidence from this session: with the current scenario, q2/q3/q4 + optional complete at tick ~5 (conditions already hold at fresh state) and q1 at tick 24. Several Level-1 conditions are trivially satisfied by the default scenario → thresholds likely need retuning so quests form a real sequence (this is exactly what `sme_pending` anticipated).
2. Commit authorization for this session's files (committed on Yasser's GO in-session).

## Step 3 — Guided placement core + hub wiring: DONE (2026-10-20)
- `web/src/shared/construction.ts` — `ConstructionLedger`: pure lifecycle state machine `not_built → built_pending → operational` (§14.4 ghost-slot rule), one direction only; `build(slotId, atTick, durationTicks)` idempotent-guarded (already-built / not-a-ghost / unknown slot rejected with reason strings), `tick(nowTick)` advances on the sim clock, `progress()`, `snapshot()/restore()` for save ride, `dropEventsFrom(tick)` mirrors quest-tracker log hygiene. `DEFAULT_BUILD_DURATION_TICKS = 10` — **sme_pending: per-machine build durations are Yasser's call**, constant isolated in one export.
- Hub wiring (`main.tsx`): per-slice `Map<sliceId, ConstructionLedger>` seeded from `factory_layout_v1.json` (ghost slots start `not_built`, real/pre-built slots start `operational`; zones filtered by slice); ledger advances only for the active slice's sim clock; Build verb logs `construction_started:<slot>` into the hub event log; Save/Load/New-game carry the construction snapshot (`GameSave.construction`, 6th writeSave arg / `loadSave` returns it).
- `web/src/hub/placement_panel.tsx` — ghost-slot panel per focused slice: slot id + zone, lifecycle status label, capacity/cost band + learning line from layout preview, progress bar while under construction, "operational at tick N (M ticks)" countdown, Build button. Presentation-only, no sim mutation except the onBuild callback.
- Tests: `tests/construction.test.ts` 10 green (lifecycle sequence, idempotent build guards, unknown slot, pre-built slots, snapshot/restore round-trip, dropEventsFrom).

## Step 4 — Route validity validator port: DONE (core; UI wiring pending)
- `web/src/shared/route_validity.ts` — faithful TS port of `mirror/connection_validity_mirror.py`: same rules, same reason strings (`explainRouteFailure`), no new rules invented.
- Tests: `tests/route_validity.test.ts` 5 green, incl. the mirror's 5 negative cases as literal parity checks.

## Browser verification (2026-10-20, PASS)
- Probe re-run after wiring FAILED first with `TypeError: ...step is not a function` ×30 — root cause was my own hub call `constructionRef...step('slice1', tick)` vs the ledger's actual method `tick(nowTick)`; fixed in `main.tsx`, rebuilt, stale dist assets removed.
- Probe now PASS end-to-end: quest panel + Build button render, all 5 quests complete from ticks alone (q1 @24), zero console errors, saved save carries construction + quest progress, reload restores. Suite: **40 files / 182 tests green**.

## Step 5 — Route connections wiring: DONE (2026-10-20)
- `web/src/shared/route_ledger.ts` — `RouteLedger` Connect verb over the shared validator (§7.4): `connect(from, to, atTick)` delegates every validation to `validateRouteEdge` (mirror port, §2.1 — no second rule implementation); 'already connected' guard; `list()/snapshot()/restore()` for the save ride.
- `web/src/hub/route_panel.tsx` — from/to selects over `routeGraph.nodeIds`, Connect button, validator verdict surfaced verbatim via `explainRouteFailure` (§7.4 understandable feedback), connected-routes list. Presentation-only; owns no rule.
- Hub wiring (`main.tsx`): per-slice `Map<sliceId, RouteLedger>` (slice switch never resets connections); valid connect logs `route_connected:<from>_to_<to>` HubEvent; Save passes 7th arg `routeRef...snapshot()`; startup resume AND Load button restore `startup.routes`/`save.routes`; New game clears routes.
- `save_load.ts`: `GameSave.routes` optional field + loader shape validation (malformed row → reject, never default; pre-Phase-2 save without the field loads null). Validation of WHAT a legal route is stays in the shared validator — save layer checks shape only.
- Tests: `tests/route_ledger.test.ts` 5 green (valid connect, reverse-of-declared-edge rejection with reason `'edge not in declared flow'`, unknown-node/self-loop rejections with feedback lines, duplicate guard, snapshot/restore round-trip); `tests/quest_save_coverage.test.ts` +1 green — routes verbatim round-trip, malformed route row rejected at load.
- Browser verification (`scripts/probe_route_panel.mjs`, **PASS**): RoutePanel renders (12 node options), valid connect `cc→billet_yard` lands in list + event log, invalid connect `bar_mill→billet_yard` shows the explanation line ("There is no declared route between those two nodes…") and does NOT land, Save carries `routes` into localStorage under `steelx-save`, reload restores connections, zero console errors. Quest probe re-run on the same bundle: still PASS (no regression). Fresh-build check: dist asset hash moved to `index-BP0noIlT.js`, stale hashed assets deleted, `steelx-route-panel` grep-confirmed in the built asset before probing.
- Suite: **41 files / 189 tests green** (`npx vitest run --root .`).

## Next steps (Phase 2 remainder)
- Route connections hub UI wiring (validator core exists; needs the connect verb/panel on the hub and route state riding saves).
- Operational controls affecting sim (Decide verb primitives).
- Essential ship/unload/conveyor animations tied to sim state.
- Re-run browser probe with corrected localStorage key + retuned quest thresholds once SME answers land.

## Step B — Operational controls (Decide verbs): DONE (2026-10-20, awaiting Yasser's GO for commit)
Semantics agreed in `docs/stepB_semantics_v1.md` (Q1–Q6 approved by Yasser 20.10). Mirror-first discipline: Python mirror extended first (`mirror/operations_domain3_mirror.py`, D1–D6 all PASS, no-Decide baseline still reproduces the frozen fixture), then ported 1:1 to TS.
- Engine (`web/src/ops_domain3.ts`): new OpsState fields `running / maintenance_queue / spares_pipeline / overtime_until_day / recovery_until_day / decisions_made / pm_down`; exported verbs `decideStop / decideStart / decideScheduleMaintenance / decideCancelMaintenance / decideOrderSpare / decideOvertime` (each returns `{ok, message}` — the engine owns validation AND human-readable feedback). Idle = no production/wear/buffer, payroll continues, RNG draw still consumed (byte-stability); PM = future-day outage (`pm_duration_days=2.0 sme_pending`), completion resets the wear clock only for PM outages; spare cap stock+pipeline ≤ 3, 7-day lead time; overtime shifts the morale band one step worse during the window with an equal-length recovery tail back to normal, mid-recovery stacking refused, cap 7 days.
- Config (`web/src/ops_config.ts`): optional validated `decide` block (reject-never-default) + `DECIDE_DEFAULTS`.
- Morale band fix: TS bands are sorted desc-by-threshold; OT shift is now `bandIdx - 1` and tail clamp `bands.length - 2`, matching the mirror's ascending-index semantics exactly (found by parity test, fixed once).
- Hub port (`web/src/ports/slice1/slice1_decide.ts`): `freshSlice1HubStateV2 / advanceSlice1HubStateV2` carry a `decisions: DecisionRow[]` log inside the loop state (JSON-plain → save/load v1 resume verbatim); `applyDecision` delegates to the engine's decide_* functions — the ONLY mutators — and records rejections too. Catalog slice1 entry switched to V2.
- Panel (`web/src/hub/decide_panel.tsx`): asset select + Stop / Start / Schedule maintenance (+lead days) / Cancel maint. / Order spare / Run overtime (+days); engine message surfaced verbatim; last-8 decision log. Presentation-only, owns no rule (route-panel pattern).
- Save coverage: `GameSave.decisions` optional field + loader shape validation (`decisions row is malformed` reject); hub Save carries it, resume path restores it inside the state snapshot.
- Tests: `tests/parity_ops_decide.test.ts` 7 green (D1–D6 mirror parity + no-Decide baseline reproduces the frozen fixture via its documented construction — seed + spares_overrides + default internal draws). Suite: **42 files / 197 tests green**.
- Browser verification (`scripts/probe_decide_panel.mjs`, **PASS** on the rebuilt dist `index-D2jr1JdJ.js`): panel renders with all six verbs over the 6 declared assets; valid stop lands in log + event log with the engine message; double-stop rejected ('eaf is already stopped'); overtime accepted naming the window; Save carries `decisions` under `steelx-save`; reload restores the log; zero console errors. Route probe re-run on the same bundle: still PASS (no regression).
- Pitfall recorded: hub render crashed (`Cannot convert undefined or null to object`) on `Object.keys(state.assets)` — OpsState has no `assets` map; asset list is the engine's `ASSET_ORDER`.

## Phase 2 status after Step B
Landed: quest tracking, persistence coverage (quests/construction/routes/decisions), guided placement lifecycle, valid route connections, operational controls. Remaining bullets: information cards polish + essential sim-driven animations — then Yasser's live test round (visual comments expected).

## Step C — Information cards + essential animation: DONE (2026-10-20, awaiting commit GO)
- **Information cards:** already live per slice via hub `InfoCard` (catalog `cardTitle`/`cardBody`) and tap-to-inspect `CardPopup` cards in the factory scene (`inspection_cards.ts` — pure sim projections). Step B's per-action engine messages add the learning layer on every Decide verb ('payroll continues', 'breakdown risk up now, fatigue tail after day N'). No new machinery needed; checklist item satisfied.
- **Essential animation (berth ship):** `HullAtBerth` in `web/src/scene/factory_scene.tsx` — a hull+superstructure mesh appears at the berth slot ONLY while `st.berth_ships` is non-empty (`ship_present` fed from sim state in `factory_view.tsx`; amber when unloading blocked = same tone as cards), bobbing via `useFrame` + self-`invalidate()` under the demand frameloop. Presence tracks simulation state exactly (gameplay checklist: "animation reflects actual simulation state"); zero animation when no ship.
- Browser verification (`scripts/probe_berth_animation2.mjs`, **PASS**): fresh game → 0 hulls; seeded save with a berthed ship → Load resumes and the hull is present + bobbing (y 0.403 → 0.330); New game → hull gone; zero console errors. Decide + route + quest probes re-PASS on the same bundle. Suite: **42 files / 197 tests green**.
- Pitfall recorded: probe seed must unwrap `MemorySaveStorage.read()`'s double-JSON (read returns the stored string) before seeding localStorage, else Load silently starts a new game.

## Phase 2 FINAL status (2026-10-20)
All seven Phase 2 bullets LANDED and browser-verified: quest tracking · persistence coverage · guided placement lifecycle · valid route connections · operational controls (Decide verbs) · information cards · essential animation. Suite 42 files / 197 tests; four probes green on the shipped bundle (`index-C4361jp8.js`). Uncommitted pending Yasser's GO. Next: Yasser's live test + visual comments round; sme_pending retunes (quest thresholds, PM duration, build durations, morale bands) at phase review.
