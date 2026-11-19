# Next-session prompt (copy from the fenced block below into a fresh SteelX session)

```
Continue SteelX Stage 0. Read STATE.md first, then load the steel-plant-game skill and its
references/checkpoint_2026-11-19_s04.md — it has all S0.5 scoping facts.

State: S0.3 CLOSED, S0.4 CLOSED (Yasser gated 2026-11-19; duplicate-EAF fix c45cffe).
Local master head = c45cffe; SIX commits unpushed (origin/master still 1c37f6c). Do NOT
push until Yasser says Wi-Fi is back, then push first thing.

TASK — S0.5 persistence v2 (fullplant save/load), one micro-step at a time, each step
gated by my explicit approval; no proactive coding beyond the step I approved:
1. Wire fullplant autosave/restore around shared/save_load.ts — the fullplant port has NO
   save/load today (localStorage only exists in hub/main.tsx). Propose the data structure
   first (which slot, when autosave fires, what shape), wait for approval, then code.
2. Extend GameSave coverage: quest window fields (window_baseline, window_open_tick ride
   QuestProgress rows already; loadSave's row check only validates id/status — extend it)
   and onboarding state (onboarding.ts {index, built[], clockRunning}) so a resumed
   campaign does not replay onboarding. Reject-never-default: bump SNAPSHOT_SCHEMA_VERSION
   / QUESTS_SCHEMA_VERSION per the save_load.ts rules.
3. Tests mirror-first for any sim-rule change; suite must be green (25 files / 195 tests,
   `cd web && npx vitest run --root .`) before each commit. Commit locally only.

After S0.5 commits: ask me the parked SME questions listed in the checkpoint file
(q2/q3/opt bands, ship cadence 3–5 days — mirror-first if changed, EAF draw vs ~180 t/tap).
Then Stage 0 is done and we move to Stage 1 (Chapter 1: The Ore Belt) per docs/PLAN_FORGED.md.

Loop discipline: never repeat an identical tool call; verify before claiming done.
```
