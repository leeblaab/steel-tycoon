// S0.3 commissioning-fix tests (PLAN_FORGED gate: "no machine produces before you build it").
// TS-only state logic — no owned economic/sim rule, so no Python mirror needed here.

import { describe, it, expect } from 'vitest';
import { QUEST_BUILD_UNLOCK, SLICE_BUILD_NODES, sliceBuildDone } from '../src/shared/commissioning.ts';
import { initState, advance, loadSequence } from '../src/ports/fullplant/browser/onboarding.ts';

const SEQ = loadSequence({
  level1_sequence: [
    { step: 0, type: 'card', id: 'intro' },
    { step: 1, type: 'build', node_id: 'jetty' },
    { step: 2, type: 'build', node_id: 'scrap_yard' },
    { step: 3, type: 'build', node_id: 'conv_ore_drp' },
    { step: 4, type: 'park' },
    { step: 5, type: 'resume' },
    { step: 6, type: 'build', node_id: 'drp' },
    { step: 7, type: 'build', node_id: 'conv_dri_eaf' },
  ],
});

function buildAll(nodes: string[]) {
  const st = initState();
  // walk the sequence tapping each listed node's build step; a unit test has no quest
  // tracker, so the park gate is passed through directly (index++).
  for (const n of nodes) {
    while (true) {
      const step = st.index >= 0 ? SEQ[st.index] : null;
      if (!step) throw new Error(`sequence exhausted before ${n}`);
      if (step.type === 'build' && step.node_id === n) { advance(SEQ, st); break; }
      if (step.type === 'park') { st.index += 1; continue; } // skip the quest gate at unit level
      if (step.type === 'build' || step.type === 'card' || step.type === 'resume') { advance(SEQ, st); continue; }
      throw new Error(`unexpected ${step.type} step before building ${n}`);
    }
  }
  return st;
}

describe('S0.3 commissioning: quest unlocks the BUILD CHAIN, not the engine', () => {
  it('quest->area map covers exactly the four level-1 main quests', () => {
    expect(Object.keys(QUEST_BUILD_UNLOCK).sort()).toEqual([
      'l1_q1_first_arrival', 'l1_q2_keep_it_moving', 'l1_q3_feed_the_furnace', 'l1_q4_first_steel',
    ]);
  });

  it('a commissioned-but-unbuilt slice is NOT build-done -> its engine must not tick', () => {
    // player built only slice1; q1..q3 all completed (commissioning unlock) — but drp etc.
    // are not placed, so slice3/4/5 stay engine-stopped.
    const st = buildAll(['jetty', 'scrap_yard', 'conv_ore_drp']);
    expect(sliceBuildDone(st, 'slice1')).toBe(true);
    expect(sliceBuildDone(st, 'slice3')).toBe(false);
    expect(sliceBuildDone(st, 'slice4')).toBe(false);
    expect(sliceBuildDone(st, 'slice5')).toBe(false);
  });

  it('partial builds do not start an engine (every node required)', () => {
    const st = buildAll(['jetty', 'scrap_yard', 'conv_ore_drp', 'drp']); // conv_dri_eaf missing
    expect(sliceBuildDone(st, 'slice3')).toBe(false);
  });

  it('full slice build flips engine start (drp + conv_dri_eaf)', () => {
    const st = buildAll(['jetty', 'scrap_yard', 'conv_ore_drp', 'drp', 'conv_dri_eaf']);
    expect(sliceBuildDone(st, 'slice3')).toBe(true);
  });

  it('slice2 has no sequence builds -> never engine-starts by building (no engine yet)', () => {
    const st = buildAll(['jetty']);
    expect(sliceBuildDone(st, 'slice2')).toBe(false);
    expect(SLICE_BUILD_NODES['slice2']).toBeUndefined();
  });

  it('unlock map targets only slices that have engines or a pending placeholder', () => {
    for (const slice of Object.values(QUEST_BUILD_UNLOCK)) {
      expect(['slice2', 'slice3', 'slice4', 'slice5']).toContain(slice);
    }
  });
});
