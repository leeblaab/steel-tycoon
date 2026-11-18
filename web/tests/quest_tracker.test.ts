// Phase 2 quest-tracking tests (Roadmap V3 §5.2 lifecycle driven by sim state only).
import { describe, it, expect } from 'vitest';
import { QuestTracker, loadLevelQuests, QUESTS_SCHEMA_VERSION, type QuestsDoc } from '../src/shared/quest_tracker.ts';
import { freshSlice1HubState, advanceSlice1HubState, runSlice1HubTicks } from '../src/ports/slice1/slice1_hub.ts';

const DOC: QuestsDoc = {
  schema_version: 1,
  levels: [
    {
      id: 'level_1',
      quests: [
        { id: 'q_a', title: 'A', quest_type: 'diagnosis', decision: { kind: 'observe_and_confirm' }, cards: [], success_criteria: { slice: 'slice1', conditions: [{ field: 'ships_arrived', op: '>=', value: 1 }] } },
        { id: 'q_b', title: 'B', quest_type: 'improvement', decision: { kind: 'diagnose_then_improve' }, cards: [], success_criteria: { slice: 'slice1', conditions: [{ field: 'arrived_t', op: '>=', value: 5000 }] } },
      ],
      optional_challenges: [
        { id: 'q_opt', title: 'Opt', quest_type: 'balancing', decision: { kind: 'balance_flow_over_run' }, cards: [], success_criteria: { slice: 'slice1', conditions: [{ field: 'upstream_blocked_t', op: '<=', value: 0 }] } },
      ],
    },
  ],
};
const LEVEL = loadLevelQuests(DOC, 'level_1');

const snap = (st: any) => ({ tick: st.tick, state: st, events: st.events ?? [] });

describe('quest tracker lifecycle', () => {
  it('initial chain: first main active, rest locked, optional available', () => {
    const t = new QuestTracker(LEVEL);
    const p = t.snapshotProgress();
    expect(p.q_a.status).toBe('active');
    expect(p.q_b.status).toBe('locked');
    expect(p.q_opt.status).toBe('available');
    expect(t.activeQuestId()).toBe('q_a');
  });

  it('completion is state-driven and unlocks the next main quest on the same tick', () => {
    const t = new QuestTracker(LEVEL);
    // q_a condition met at tick 7
    let fired = t.update({ tick: 6, state: { ships_arrived: 0 }, events: [] });
    expect(fired).toEqual([]);
    fired = t.update({ tick: 7, state: { ships_arrived: 1, arrived_t: 0 }, events: [] });
    expect(fired).toEqual(['q_a']);
    const p = t.snapshotProgress();
    expect(p.q_a.status).toBe('completed');
    expect(p.q_a.completed_at_tick).toBe(7);
    expect(p.q_b.status).toBe('active');
    expect(t.activeQuestId()).toBe('q_b');
  });

  it('idempotent: a completed quest never re-fires and progress stays completed', () => {
    const t = new QuestTracker(LEVEL);
    t.update({ tick: 1, state: { ships_arrived: 2, arrived_t: 9000 }, events: [] }); // both met same tick
    const again = t.update({ tick: 2, state: { ships_arrived: 3, arrived_t: 9500 }, events: [] });
    expect(again).toEqual([]);
    expect(t.levelComplete()).toBe(true);
  });

  it('optional quest tracks independently and never gates the chain', () => {
    const t = new QuestTracker(LEVEL);
    const fired = t.update({ tick: 1, state: { ships_arrived: 0, arrived_t: 0, upstream_blocked_t: 0 }, events: [] });
    expect(fired).toEqual(['q_opt']); // optional completes while mains unmet
    const p = t.snapshotProgress();
    expect(p.q_a.status).toBe('active');
    expect(t.levelComplete()).toBe(false);
  });

  it('unknown state field never satisfies a condition', () => {
    const t = new QuestTracker(LEVEL);
    const fired = t.update({ tick: 1, state: { nope: 99 }, events: [] });
    expect(fired).toEqual([]);
  });

  it('restoreProgress round-trips completed state (save/load coverage)', () => {
    const t = new QuestTracker(LEVEL);
    t.update({ tick: 7, state: { ships_arrived: 1 }, events: [] });
    const saved = t.snapshotProgress();
    const t2 = new QuestTracker(LEVEL);
    t2.restoreProgress(saved);
    const p = t2.snapshotProgress();
    expect(p.q_a.status).toBe('completed');
    expect(p.q_a.completed_at_tick).toBe(7);
    expect(p.q_b.status).toBe('active');
    expect(t2.activeQuestId()).toBe('q_b');
  });

  it('invalid saved status is rejected, not defaulted', () => {
    const t = new QuestTracker(LEVEL);
    expect(() => t.restoreProgress({ q_a: { id: 'q_a', status: 'failed' as any, conditions_met: false, completed_at_tick: null } })).toThrow(/invalid saved status/);
  });

  it('unsupported quests.json schema_version is rejected (versioned content, §14.3)', () => {
    const bad = { ...DOC, schema_version: 99 };
    expect(() => new QuestTracker(loadLevelQuests(bad, 'level_1'))).toThrow(/schema_version/);
    expect(QUESTS_SCHEMA_VERSION).toBe(1);
  });

  it('§6.5 quest-stalled detection: active quest with unmet conditions past the window reports the blocker', () => {
    const t = new QuestTracker(LEVEL);
    // q_a needs ships_arrived>=1; feed it a state that never satisfies it
    expect(t.stalledQuest(10, { tick: 5, state: { ships_arrived: 0 } })).toBeNull(); // inside window
    const s = t.stalledQuest(10, { tick: 30, state: { ships_arrived: 0 } });
    expect(s).not.toBeNull();
    expect(s!.quest.id).toBe('q_a');
    expect(s!.unmet.map((c) => c.field)).toEqual(['ships_arrived']);
    // once conditions met, no stall report
    t.update({ tick: 31, state: { ships_arrived: 1 } });
    expect(t.stalledQuest(10, { tick: 40, state: { ships_arrived: 1 } })).toBeNull();
  });

  it('rejects a foreign quests.json schema version', () => {
    expect(() => new QuestTracker({ ...DOC, schema_version: 2 } as any)).toThrow(/schema_version/);
  });
});

describe('quest tracker against the live slice1 hub scenario', () => {
  it('real content/quests.json loads and q1 completes from the real run within its target window', async () => {
    const raw = await import('../../content/quests.json', { with: { type: 'json' } } as any);
    const doc = (raw.default ?? raw) as QuestsDoc;
    const level = loadLevelQuests(doc, 'level_1');
    expect(level.level_id).toBe('level_1');
    expect(level.quests.filter((q) => !q.optional).length).toBe(4);
    expect(level.quests.filter((q) => q.optional).length).toBe(1); // No Idle Furnace

    const t = new QuestTracker(level as any);
    let st = freshSlice1HubState();
    const q1 = level.quests.find((q) => q.id === 'l1_q1_first_arrival')!;
    expect(t.snapshotProgress()[q1.id].status).toBe('active');

    for (let i = 0; i < 40 && !t.levelComplete(); i++) {
      st = advanceSlice1HubState(st);
      t.update(snap(st));
      if (t.snapshotProgress()[q1.id].status === 'completed') break;
    }
    // first meaningful success well inside the 2-5 min early-quest target (40 ticks ≈ 5.6 s at 140 ms)
    expect(t.snapshotProgress()[q1.id].status).toBe('completed');
    expect(t.snapshotProgress()[q1.id].completed_at_tick!).toBeLessThan(40);
  });

  it('full 300-tick live run advances the chain realistically (progress from real sim state)', async () => {
    const raw = await import('../../content/quests.json', { with: { type: 'json' } } as any);
    const doc = (raw.default ?? raw) as QuestsDoc;
    const level = loadLevelQuests(doc, 'level_1');
    const t = new QuestTracker(level as any);
    let st = freshSlice1HubState();
    for (let i = 0; i < 300; i++) { st = advanceSlice1HubState(st); t.update(snap(st)); }
    const p = t.snapshotProgress();
    // q1 must complete; later quests depend on sme_pending thresholds — record actual state reached
    expect(p.l1_q1_first_arrival.status).toBe('completed');
    console.log('300-tick quest state:', JSON.stringify(p), 'produced_t=', st.produced_t, 'upstream_blocked_t=', st.upstream_blocked_t);
  });

  it('deterministic: two identical runs produce identical quest progress maps', () => {
    const build = () => {
      const t = new QuestTracker(LEVEL);
      let st = freshSlice1HubState();
      for (let i = 0; i < 120; i++) { st = advanceSlice1HubState(st); t.update(snap(st)); }
      return t.snapshotProgress();
    };
    expect(build()).toEqual(build());
  });
});
