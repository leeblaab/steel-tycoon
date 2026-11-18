// S0.3 engine gate: quest unlocks the build chain, building starts the engine — THE gate
// from PLAN_FORGED ("no machine produces before you build it"). Drives a real GameSession
// over the REAL content files + ticks and asserts quest completion never starts an engine.
//
// NOTE (S0.3 finding, for threshold retune): with the CURRENT placeholder quest numbers
// (all sme_pending) q2/q3/q4 complete at tick ~5 — before q1 (tick 24) — so the park gate
// opens too early and the quest chain loses its gating power. The engine gate itself is
// correct here: even with slice3's build chain open, no DRP production happens until the
// player places drp + conv_dri_eaf. Threshold values are SME decisions (Yasser) — next step.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameSession } from '../src/ports/fullplant/browser/session.ts';

const ROOT = 'C:/AI_LAB/SteelX'; // same convention as the other content-reading tests
const questsDoc = JSON.parse(readFileSync(`${ROOT}/content/quests.json`, 'utf8'));
const seqDoc = JSON.parse(readFileSync(`${ROOT}/content/sequence/level1_draft.json`, 'utf8'));

function freshSession(): GameSession {
  return new GameSession(questsDoc as any, seqDoc);
}

/** Tap through the guided flow until each named node is confirmed-built. Park steps go
 *  through the real gate (onboardingComplete) — it only opens when quest snapshots say so. */
function buildUpTo(s: GameSession, nodes: string[]): void {
  for (const n of nodes) {
    let guard = 0;
    while (guard++ < 100) {
      const step = s.onboard.index >= 0 ? s.seqSteps[s.onboard.index] : null;
      if (!step) throw new Error(`sequence exhausted before ${n}`);
      if (step.type === 'build' && step.node_id === n) { s.confirmBuild(); break; }
      if (step.type === 'park') { s.onboardingComplete(); continue; }
      if (step.type === 'resume') { s.dismissCard(); continue; }
      if (step.type === 'build' || step.type === 'card') {
        if (step.type === 'build') s.confirmBuild(); else s.dismissCard();
        continue;
      }
      throw new Error(`unexpected ${step.type} step before building ${n}`);
    }
  }
}

describe('S0.3 engine gate: quest unlocks the build chain, building starts the engine', () => {
  it('nothing ticks before the jetty is built (clock frozen)', () => {
    const s = freshSession();
    expect(s.stepPlant()).toEqual([]); // guard refuses pre-jetty
    expect(s.tick).toBe(0);
  });

  it('slice1 engine starts only when all three slice-1 nodes are built', () => {
    const s = freshSession();
    buildUpTo(s, ['jetty']);
    expect(s.onboard.clockRunning).toBe(true); // jetty rule: clock runs
    expect(s.engineRunning('slice1')).toBe(false); // but engine waits for the full slice
    buildUpTo(s, ['scrap_yard', 'conv_ore_drp']);
    expect(s.engineRunning('slice1')).toBe(true);
  });

  it('QUEST COMPLETION NEVER STARTS AN ENGINE — even with the area unlocked', () => {
    const s = freshSession();
    buildUpTo(s, ['jetty', 'scrap_yard', 'conv_ore_drp']); // slice1 live
    // Tick until q1 completes (ships_arrived >= 1). Optional challenges may fire alongside —
    // loop on the MAIN quest, not "any completion".
    let done: string[] = [];
    for (let i = 0; i < 200 && !done.includes('l1_q1_first_arrival'); i++) done = s.stepPlant();
    expect(done).toContain('l1_q1_first_arrival'); // q1 fired...
    expect(s.slices['slice3'].unlocked).toBe(true); // ...build chain for slice3 opened...
    expect(s.engineRunning('slice3')).toBe(false); // ...but the DRP engine MUST NOT tick (nothing built)
    const s3Before = JSON.stringify(s.stateOf('slice3'));
    s.stepPlant(); s.stepPlant();
    expect(JSON.stringify(s.stateOf('slice3'))).toBe(s3Before); // zero drift in an unbuilt DRP area
  });

  it('the engine starts the tick its own last sequence node is placed', () => {
    const s = freshSession();
    buildUpTo(s, ['jetty', 'scrap_yard', 'conv_ore_drp']); // slice1 live
    for (let i = 0; i < 200; i++) { if (s.stepPlant().includes('l1_q1_first_arrival')) break; }
    expect(s.slices['slice3'].unlocked).toBe(true); // q1 opened the chain
    buildUpTo(s, ['drp']); // park opens early on current placeholder thresholds (see header note)
    expect(s.engineRunning('slice3')).toBe(false); // conv_dri_eaf still missing
    buildUpTo(s, ['conv_dri_eaf']);
    expect(s.engineRunning('slice3')).toBe(true); // engine joins the live ticking plant
  });

  it('slice2 (no sequence builds) never engine-ticks even after q4 commissions it', () => {
    const s = freshSession();
    expect(s.engineRunning('slice2')).toBe(false);
    s.unlockSlice('slice2'); // pretend q4 fired
    expect(s.slices['slice2'].unlocked).toBe(true);
    expect(s.engineRunning('slice2')).toBe(false); // no engine exists — never ticks
  });
});
