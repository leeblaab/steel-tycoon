// F-12 quest-evaluation contract tests (FORGED S0.3 follow-up, SME-settled by Yasser):
//  (a) STRICT CHAIN — quest qN's criteria are evaluated only after q(N−1) completed;
//      the optional challenge chains strictly after the LAST main quest (Yasser 2026-11-18).
//  (b) WINDOWED CUMULATIVE CONDITIONS — cumulative since-tick-0 accumulators measure as a
//      DELTA over the window since the previous quest completed, never a snapshot.
import { describe, it, expect } from 'vitest';
import { QuestTracker, loadLevelQuests, type LevelQuestDoc, type QuestsDoc } from '../src/shared/quest_tracker.ts';

const DOC: QuestsDoc = {
  schema_version: 1,
  levels: [
    {
      id: 'level_1',
      quests: [
        { id: 'q_a', title: 'A', quest_type: 'diagnosis', decision: { kind: 'observe_and_confirm' }, cards: [], success_criteria: { slice: 'slice1', conditions: [{ field: 'ships_arrived', op: '>=', value: 1 }] } },
        { id: 'q_b', title: 'B', quest_type: 'improvement', decision: { kind: 'diagnose_then_improve' }, cards: [], success_criteria: { slice: 'slice1', conditions: [{ field: 'arrived_t', op: '>=', value: 5000 }] } },
        { id: 'q_c', title: 'C', quest_type: 'improvement', decision: { kind: 'diagnose_then_improve' }, cards: [], success_criteria: { slice: 'slice1', conditions: [{ field: 'unload_blocked_t', op: '<=', value: 100 }] } },
      ],
      optional_challenges: [
        { id: 'q_opt', title: 'Opt', quest_type: 'balancing', decision: { kind: 'balance_flow_over_run' }, cards: [], success_criteria: { slice: 'slice1', conditions: [{ field: 'upstream_blocked_t', op: '<=', value: 0 }] } },
      ],
    },
  ],
};
const LEVEL = loadLevelQuests(DOC, 'level_1');

describe('F-12 strict chain', () => {
  it('optional challenge is locked until the LAST main quest completes', () => {
    const t = new QuestTracker(LEVEL);
    expect(t.snapshotProgress().q_opt.status).toBe('locked');
    // q_a done -> q_b active, optional still locked
    t.update({ tick: 1, state: { ships_arrived: 1 }, events: [] });
    expect(t.snapshotProgress().q_opt.status).toBe('locked');
    // q_b window delta met (arrived_t +5000 since baseline 0) -> q_b completes at tick 2;
    // q_c opens but evaluates only from the NEXT tick (strictly after); opt stays locked.
    t.update({ tick: 2, state: { ships_arrived: 1, arrived_t: 5000 }, events: [] });
    expect(t.snapshotProgress().q_opt.status).toBe('locked');
    // q_c evaluates and completes (its <= condition holds; window baseline from q_b completion)
    const fired3 = t.update({ tick: 3, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 0, upstream_blocked_t: 0 }, events: [] });
    expect(fired3).toEqual(['q_c']);
    expect(t.snapshotProgress().q_opt.status).toBe('available');
    // optional evaluates from the next tick with its own window; delta 0 <= 0 -> completes
    const fired4 = t.update({ tick: 4, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 0, upstream_blocked_t: 0 }, events: [] });
    expect(fired4).toEqual(['q_opt']);
    expect(t.snapshotProgress().q_opt.completed_at_tick).toBe(4);
  });

  it('later main quest conditions never fire before its predecessor completed (strict chain)', () => {
    const t = new QuestTracker(LEVEL);
    // q_b's condition (arrived_t>=5000) is ALREADY met at tick 1, but q_a hasn't completed:
    const fired = t.update({ tick: 1, state: { ships_arrived: 0, arrived_t: 9000 }, events: [] });
    expect(fired).toEqual([]); // nothing fires — q_a unmet, q_b locked out of evaluation
    // q_a completes at tick 2; q_b's window baseline = arrived_t snapshot (9000) at that moment.
    const fired2 = t.update({ tick: 2, state: { ships_arrived: 1, arrived_t: 9000 }, events: [] });
    expect(fired2).toEqual(['q_a']);
    expect(t.snapshotProgress().q_b.status).toBe('active');
    // windowed: q_b needs +5000 OVER its baseline (9000) — snapshot 9000 gives delta 0, no fire.
    const fired3 = t.update({ tick: 3, state: { ships_arrived: 1, arrived_t: 9000 }, events: [] });
    expect(fired3).toEqual([]);
    // once the window delta reaches 5000 (arrived_t 14000), q_b completes.
    const fired4 = t.update({ tick: 4, state: { ships_arrived: 1, arrived_t: 14000 }, events: [] });
    expect(fired4).toEqual(['q_b']);
  });

  it('windowed cumulative condition: delta since previous completion, not snapshot', () => {
    const t = new QuestTracker(LEVEL);
    // q_a completes at tick 1; q_c's window baseline = unload_blocked_t at q_b's completion.
    t.update({ tick: 1, state: { ships_arrived: 1, unload_blocked_t: 0 }, events: [] });
    t.update({ tick: 2, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 900 }, events: [] }); // q_b completes; q_c opens (un-evaluated this tick)
    expect(t.snapshotProgress().q_c.status).toBe('active');    // q_c evaluates NOW with baseline 900: snapshot (950 <= 100) would FAIL; delta (950-900=50 <= 100) PASSES.
    const fired = t.update({ tick: 3, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 950 }, events: [] });
    expect(fired).toEqual(['q_c']);
  });

  it('windowed condition fails when the WINDOW delta exceeds the band even if snapshot is small', () => {
    const t = new QuestTracker(LEVEL);
    t.update({ tick: 1, state: { ships_arrived: 1 }, events: [] });
    t.update({ tick: 2, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 0 }, events: [] }); // q_b done -> q_c opens (baseline snapshotted next eval)
    const firedEval = t.update({ tick: 3, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 400 }, events: [] }); // baseline from q_b completion = 0; delta 400 > band 100
    expect(firedEval).toEqual([]);
  });

  it('cumulative fields are windowed; non-cumulative snapshot fields keep raw semantics', () => {
    const t = new QuestTracker(LEVEL);
    // q_a uses ships_arrived (a count) and arrived_t (cumulative tons). For q_a the chain
    // baseline is tick 0 (no predecessor): windowed arrived_t == raw value at tick 0 start.
    const fired = t.update({ tick: 1, state: { ships_arrived: 2, arrived_t: 9000 }, events: [] });
    expect(fired).toEqual(['q_a']); // first quest: window from tick 0 == raw value
  });

  it('progress snapshot carries window baselines; restoreProgress round-trips them', () => {
    const t = new QuestTracker(LEVEL);
    t.update({ tick: 1, state: { ships_arrived: 1, unload_blocked_t: 10 }, events: [] });
    t.update({ tick: 2, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 900 }, events: [] }); // q_b done -> q_c opens with baseline 900 (un-evaluated this tick)
    const saved = t.snapshotProgress();
    expect(saved.q_c.window_baseline).toBeTruthy();
    expect(saved.q_c.window_baseline!.unload_blocked_t).toBe(900);

    const t2 = new QuestTracker(LEVEL);
    t2.restoreProgress(saved);
    const p2 = t2.snapshotProgress();
    expect(p2.q_c.status).toBe('active');
    expect(p2.q_c.window_baseline!.unload_blocked_t).toBe(900);
    // continuation uses the restored baseline, not a fresh one
    const fired = t2.update({ tick: 3, state: { ships_arrived: 1, arrived_t: 5000, unload_blocked_t: 950 }, events: [] });
    expect(fired).toEqual(['q_c']); // delta 50 <= 100 against restored baseline
  });

  it('deterministic: identical runs produce identical progress maps (incl. baselines)', () => {
    const build = () => {
      const t = new QuestTracker(LEVEL);
      for (let tick = 1; tick <= 5; tick++) {
        t.update({ tick, state: { ships_arrived: tick >= 1 ? 1 : 0, arrived_t: tick * 3000, unload_blocked_t: tick * 200, upstream_blocked_t: tick * 10 }, events: [] });
      }
      return t.snapshotProgress();
    };
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });
});
