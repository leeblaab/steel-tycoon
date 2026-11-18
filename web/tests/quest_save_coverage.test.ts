// Phase 2 quest save/load coverage (headless vitest probe — TS imports resolve natively).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { MemorySaveStorage, writeSave, loadSave, SAVE_FILE_KEY } from '../src/shared/save_load.ts';
import { QuestTracker, loadLevelQuests } from '../src/shared/quest_tracker.ts';
import { freshSlice1HubState, advanceSlice1HubState } from '../src/ports/slice1/slice1_hub.ts';
import { freshSlice1HubStateV2, advanceSlice1HubStateV2, applyDecision } from '../src/ports/slice1/slice1_decide.ts';

const doc = JSON.parse(readFileSync('C:/AI_LAB/SteelX/content/quests.json', 'utf8'));
const level = loadLevelQuests(doc, 'level_1');

describe('Phase 2 persistence coverage: quest progress rides the save snapshot (§13)', () => {
  it('save@30 with quest_progress -> reload restores statuses and continuation stays identical', () => {
    const storage = new MemorySaveStorage();
    const t1 = new QuestTracker(level);
    let st = freshSlice1HubState();
    for (let i = 0; i < 30; i++) { st = advanceSlice1HubState(st); t1.update({ tick: st.tick, state: st }); }
    const saved = writeSave(storage, 'main', 'slice1', st, t1.snapshotProgress());
    expect(saved.quest_progress).toBeTruthy();

    const reloaded = loadSave(storage, 'main', { knownSliceIds: ['slice1', 'slice3', 'slice4', 'slice5'] });
    expect(reloaded.quest_progress!.l1_q1_first_arrival.status).toBe('completed'); // q1 done by tick 24
    const t2 = new QuestTracker(level);
    t2.restoreProgress(reloaded.quest_progress!);

    // continuation identity: resumed pair vs straight run must match exactly.
    // t1 advanced st to tick 30; resume `a` from the saved snapshot and continue 30 more
    // ticks (-> tick 60), compared against continuing the SAME live `st` 30 ticks.
    let a = structuredClone(reloaded.state); const ta = t2;
    for (let i = 0; i < 30; i++) { a = advanceSlice1HubState(a); ta.update({ tick: a.tick, state: a }); }
    const t3 = new QuestTracker(level);
    t3.restoreProgress(saved.quest_progress!); // same restored starting point
    let b = st;
    for (let i = 0; i < 30; i++) { b = advanceSlice1HubState(b); t3.update({ tick: b.tick, state: b }); }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.stringify(ta.snapshotProgress())).toBe(JSON.stringify(t3.snapshotProgress()));
  });

  it('malformed quest_progress row is rejected at load, not defaulted', () => {
    const storage = new MemorySaveStorage();
    let st = freshSlice1HubState();
    for (let i = 0; i < 5; i++) st = advanceSlice1HubState(st);
    const t = new QuestTracker(level);
    const saved = writeSave(storage, 'main', 'slice1', st, t.snapshotProgress());
    const bad = JSON.parse(JSON.stringify({ format: 'steelx-save', format_version: 1, saves: { main: saved } }));
    bad.saves.main.quest_progress.l1_q1_first_arrival.status = 'failed';
    storage.write(SAVE_FILE_KEY, JSON.stringify(bad)); // same key writeSave used
    expect(() => loadSave(storage, 'main', { knownSliceIds: ['slice1'] })).toThrow(/malformed/);
  });

  it('construction snapshot rides the save: mid-build slots restore, malformed rows rejected', () => {
    const storage = new MemorySaveStorage();
    let st = freshSlice1HubState();
    for (let i = 0; i < 5; i++) st = advanceSlice1HubState(st);
    const t = new QuestTracker(level);
    const construction = [
      { slot_id: 'ghost_eaf', state: 'built_pending', built_from_tick: 2, ready_at_tick: 12 },
      { slot_id: 'scrap_yard', state: 'operational', built_from_tick: 0, ready_at_tick: 0 },
    ];
    const saved = writeSave(storage, 'main', 'slice1', st, t.snapshotProgress(), construction);
    expect(saved.construction).toBeTruthy();

    const reloaded = loadSave(storage, 'main', { knownSliceIds: ['slice1'] });
    expect(reloaded.construction).toEqual(construction); // verbatim round-trip

    // malformed lifecycle row must reject at load, same rule as quest_progress rows
    const bad = JSON.parse(JSON.stringify({ format: 'steelx-save', format_version: 1, saves: { main: saved } }));
    bad.saves.main.construction[0].state = 'under_construction'; // not a lifecycle state
    storage.write(SAVE_FILE_KEY, JSON.stringify(bad));
    expect(() => loadSave(storage, 'main', { knownSliceIds: ['slice1'] })).toThrow(/construction row is malformed/);
  });

  it('routes snapshot rides the save: connections restore verbatim, malformed rows rejected', () => {
    const storage = new MemorySaveStorage();
    let st = freshSlice1HubState();
    for (let i = 0; i < 5; i++) st = advanceSlice1HubState(st);
    const t = new QuestTracker(level);
    const routes = [
      { from: 'cc', to: 'billet_yard', connected_at_tick: 3 },
      { from: 'billet_yard', to: 'bar_mill', connected_at_tick: 4 },
    ];
    const saved = writeSave(storage, 'main', 'slice1', st, t.snapshotProgress(), null, routes);
    expect(saved.routes).toBeTruthy();

    const reloaded = loadSave(storage, 'main', { knownSliceIds: ['slice1'] });
    expect(reloaded.routes).toEqual(routes); // verbatim round-trip

    // malformed route row must reject at load, same rule as construction rows
    const bad = JSON.parse(JSON.stringify({ format: 'steelx-save', format_version: 1, saves: { main: saved } }));
    bad.saves.main.routes[0].to = 42; // not a node id string
    storage.write(SAVE_FILE_KEY, JSON.stringify(bad));
    expect(() => loadSave(storage, 'main', { knownSliceIds: ['slice1'] })).toThrow(/routes row is malformed/);
  });

  it('decisions log rides the save: rows round-trip verbatim, malformed rows rejected', () => {
    const storage = new MemorySaveStorage();
    let st = freshSlice1HubStateV2();
    for (let i = 0; i < 5; i++) st = advanceSlice1HubStateV2(st);
    applyDecision(st, 'stop', 'eaf');
    applyDecision(st, 'schedule_maintenance', 'drp', 3);
    const saved = writeSave(storage, 'main', 'slice1', st, null, null, null, st.decisions);
    expect(saved.decisions).toBeTruthy();

    const reloaded = loadSave(storage, 'main', { knownSliceIds: ['slice1'] });
    expect(reloaded.decisions).toEqual(st.decisions); // verbatim round-trip
    // the state snapshot itself carries the log (the hub's resume path), too
    expect((reloaded.state as any).decisions.length).toBe(2);

    // malformed decision row must reject at load, same rule as route rows
    const bad = JSON.parse(JSON.stringify({ format: 'steelx-save', format_version: 1, saves: { main: saved } }));
    bad.saves.main.decisions[0].verb = 'demolish'; // not a decide verb
    storage.write(SAVE_FILE_KEY, JSON.stringify(bad));
    expect(() => loadSave(storage, 'main', { knownSliceIds: ['slice1'] })).toThrow(/decisions row is malformed/);
  });

  it('a pre-Phase-2 save without quest_progress still loads (quest restore skipped)', () => {
    const storage = new MemorySaveStorage();
    let st = freshSlice1HubState();
    for (let i = 0; i < 5; i++) st = advanceSlice1HubState(st);
    const legacy = { format: 'steelx-save', format_version: 1, saves: { main: {
      schema_version: 1, saved_at: new Date().toISOString(), slice_id: 'slice1', tick: st.tick,
      rng_state: { word: (st as any).generator_state ?? null }, state: st,
    } } };
    storage.write(SAVE_FILE_KEY, JSON.stringify(legacy));
    const save = loadSave(storage, 'main', { knownSliceIds: ['slice1'] });
    expect(save.quest_progress ?? null).toBeNull();
  });
});
