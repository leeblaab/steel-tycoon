// S1.2 game-session integration: the belt built at onboarding step 4 (conv_ore_drp) is a
// live transfer edge inside GameSession — it rides slice1's `arrived_t` stream, commissions
// drp_intake when the DRP joins, keeps its own closed ledger under stepPlant, and survives
// autosave/restore ("restored == live" with the ore_belt block).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameSession, validateOreBeltBlock } from '../src/ports/fullplant/browser/session.ts';
import { MemorySaveStorage, FULLPLANT_SAVE_FILE_KEY } from '../src/shared/save_load.ts';
import { beltLedgerView, beltTokenView } from '../src/shared/ore_belt.ts';

const ROOT = 'C:/AI_LAB/SteelX';
const questsDoc = JSON.parse(readFileSync(`${ROOT}/content/quests.json`, 'utf8'));
const seqDoc = JSON.parse(readFileSync(`${ROOT}/content/sequence/level1_draft.json`, 'utf8'));

function freshSession(storage = new MemorySaveStorage()): GameSession {
  const s = new GameSession(questsDoc as any, seqDoc);
  s.setSaveStorage(storage);
  return s;
}

/** Walk the guided sequence until `nodeId` is confirmed (same skip pattern as save_v2 tests). */
function buildUntil(s: GameSession, nodeId: string): void {
  let guard = 0;
  while (guard++ < 200) {
    const step = s.onboard.index >= 0 ? s.seqSteps[s.onboard.index] : null;
    if (!step) throw new Error(`sequence exhausted before ${nodeId}`);
    if (step.type === 'build' && step.node_id === nodeId) { s.confirmBuild(); return; }
    if (step.type === 'park') { s.onboardingComplete(); continue; }
    if (step.type === 'resume') { s.dismissCard(); continue; }
    if (step.type === 'build' || step.type === 'card') { s.confirmBuild(); s.dismissCard(); continue; }
    throw new Error(`unexpected step type ${step.type} before ${nodeId}`);
  }
  throw new Error(`sequence exhausted before ${nodeId}`);
}

describe('belt lifecycle inside GameSession (S1.2)', () => {
  it('no belt before the conv_ore_drp guided build; belt appears exactly at that step', () => {
    const s = freshSession();
    buildUntil(s, 'jetty');
    expect(s.belt).toBeNull(); // step 4 not reached yet
    buildUntil(s, 'conv_ore_drp');
    expect(s.belt).not.toBeNull();
    expect(s.belt!.drpCommissioned).toBe(false); // DRP area doesn't exist yet
    expect(s.events.some((e) => e.event === 'ore_belt_built')).toBe(true);
  });

  it('stepPlant feeds the yard from slice1 arrived_t deltas and closes the belt ledger', () => {
    const s = freshSession();
    buildUntil(s, 'conv_ore_drp'); // all slice1 nodes built -> engine + clock run
    expect(s.engineRunning('slice1')).toBe(true);
    for (let i = 0; i < 40; i++) s.stepPlant();
    const v = beltLedgerView(s.belt!);
    const s1 = s.stateOf('slice1') as any;
    // Everything slice1 credited since the belt exists is somewhere in the belt ledger.
    expect(s.beltDepositsTotal).toBeCloseTo(s1.arrived_t, 6);
    expect(v.yard_t + v.buffer_t + v.in_transit_t).toBeCloseTo(s.beltDepositsTotal, 5);
    expect(v.drp_intake_t).toBe(0); // DRP never joined -> second hop closed
    expect(v.buffer_t).toBeGreaterThan(0); // belt genuinely moved ore (not teleport: some landed)
  });

  it('ensureDrpCommissioned opens the second hop and drains pre-built buffer stock', () => {
    const s = freshSession();
    buildUntil(s, 'conv_ore_drp');
    for (let i = 0; i < 40; i++) s.stepPlant();
    const before = beltLedgerView(s.belt!);
    expect(before.buffer_t).toBeGreaterThan(0);

    s.ensureDrpCommissioned();
    expect(s.belt!.drpCommissioned).toBe(true);
    expect(s.events.some((e) => e.event === 'drp_intake_open')).toBe(true);

    for (let i = 0; i < 60; i++) s.stepPlant();
    const after = beltLedgerView(s.belt!);
    expect(after.drp_intake_t).toBeGreaterThan(0); // pre-step-6 stock reached the DRP
    const s1 = s.stateOf('slice1') as any;
    expect(after.yard_t + after.buffer_t + after.drp_intake_t + after.in_transit_t)
      .toBeCloseTo(s.beltDepositsTotal, 5); // still closed after commissioning
  });

  it('belt state survives autosave -> restore and keeps ticking identically', () => {
    const storage = new MemorySaveStorage();
    const s = freshSession(storage);
    buildUntil(s, 'conv_ore_drp');
    for (let i = 0; i < 30; i++) s.stepPlant();
    s.ensureDrpCommissioned();
    for (let i = 0; i < 10; i++) s.stepPlant();
    expect(s.autosave()).toBe(true);

    const raw = JSON.parse(storage.read(FULLPLANT_SAVE_FILE_KEY)!).saves.main;
    expect(raw.ore_belt).toBeTruthy(); // block written
    expect(raw.ore_belt.deposits_total).toBeCloseTo(s.beltDepositsTotal, 6);

    const s2 = freshSession(new MemorySaveStorage());
    const save = JSON.parse(storage.read(FULLPLANT_SAVE_FILE_KEY)!).saves.main;
    s2.restoreFrom(save);
    expect(s2.belt).not.toBeNull();
    expect(s2.belt!.drpCommissioned).toBe(true); // second hop survived the round trip
    const v1 = beltLedgerView(s.belt!), v2 = beltLedgerView(s2.belt!);
    expect(v2.yard_t).toBeCloseTo(v1.yard_t, 6);
    expect(v2.buffer_t).toBeCloseTo(v1.buffer_t, 6);
    expect(v2.drp_intake_t).toBeCloseTo(v1.drp_intake_t, 6);
    expect(v2.in_transit_t).toBeCloseTo(v1.in_transit_t, 6);

    // restored == live: both advance one more tick to the same ledger view
    s.stepPlant(); s2.stepPlant();
    const a = beltLedgerView(s.belt!), b = beltLedgerView(s2.belt!);
    expect(b.yard_t).toBeCloseTo(a.yard_t, 6);
    expect(b.buffer_t).toBeCloseTo(a.buffer_t, 6);
    expect(b.drp_intake_t).toBeCloseTo(a.drp_intake_t, 6);
    expect(b.in_transit_t).toBeCloseTo(a.in_transit_t, 6);
  });

  it('pre-S1.2 save without an ore_belt block restores with a fresh (null) belt', () => {
    const storage = new MemorySaveStorage();
    const s = freshSession(storage);
    buildUntil(s, 'jetty'); // no belt built in this session either
    buildUntil(s, 'scrap_yard');
    buildUntil(s, 'conv_ore_drp');
    for (let i = 0; i < 12; i++) s.stepPlant();
    expect(s.autosave()).toBe(true);
    const file = JSON.parse(storage.read(FULLPLANT_SAVE_FILE_KEY)!);
    delete file.saves.main.ore_belt; // simulate an older save
    storage.write(FULLPLANT_SAVE_FILE_KEY, JSON.stringify(file));

    const s2 = freshSession(new MemorySaveStorage());
    s2.restoreFrom(file.saves.main);
    expect(s2.belt).toBeNull();
    expect(s2.beltDepositsTotal).toBe(0.0);
  });
});

describe('ore_belt save block gate (reject-never-default)', () => {
  it('absent block = null (fresh belt), malformed shapes rejected', () => {
    expect(validateOreBeltBlock(null)).toBeNull();
    expect(validateOreBeltBlock(undefined)).toBeNull();
    expect(() => validateOreBeltBlock([])).toThrow(/not an object/);
    expect(() => validateOreBeltBlock({ state: { registry: {} } })).toThrow(/registry tick/);
    expect(() => validateOreBeltBlock({ state: { registry: { tick: 3 } }, deposits_total: 'x' }))
      .toThrow(/finite number/);
  });

  it('an open-ledger block is rejected (closure gate re-runs on restore)', () => {
    const s = freshSession();
    buildUntil(s, 'conv_ore_drp');
    for (let i = 0; i < 20; i++) s.stepPlant();
    const state = structuredClone(s.belt!);
    expect(() => validateOreBeltBlock({ state, deposits_total: s.beltDepositsTotal + 50 }))
      .toThrow(/ledger gate/);
  });
});

describe('belt token view (S1.2 visual projection)', () => {
  it('one token per in_transit record, progress eases with the tick clock', () => {
    const s = freshSession();
    buildUntil(s, 'conv_ore_drp');
    for (let i = 0; i < 40; i++) s.stepPlant(); // yard has ore -> transfers in flight
    const st = s.belt!;
    const v0 = beltTokenView(st, 0);
    expect(v0.tokens.length).toBe(st.registry.in_transit.length);
    expect(v0.tokens.length).toBeGreaterThan(0);
    for (const tok of v0.tokens) {
      expect(['yard-buffer', 'buffer-drp']).toContain(tok.leg);
      expect(tok.progress).toBeGreaterThanOrEqual(0);
      expect(tok.progress).toBeLessThanOrEqual(1);
      expect(tok.size).toBeGreaterThan(0.6);
    }
    // frac raises progress but never past 1; keys are stable (same transfer_id order)
    const v1 = beltTokenView(st, 0.9);
    expect(v1.tokens.map((t) => t.key)).toEqual(v0.tokens.map((t) => t.key));
    for (let i = 0; i < v0.tokens.length; i++) {
      expect(v1.tokens[i].progress).toBeGreaterThanOrEqual(v0.tokens[i].progress);
      expect(v1.tokens[i].progress).toBeLessThanOrEqual(1);
    }
    // legs match the ledger's destinations
    for (let i = 0; i < v0.tokens.length; i++) {
      const rec = st.registry.in_transit[i];
      expect(v0.tokens[i].leg).toBe(rec.to_id === 'ore_buffer' ? 'yard-buffer' : 'buffer-drp');
    }
  });

  it('beltVisualSnapshot is a pure projection (mutating it cannot touch sim state)', () => {
    const s = freshSession();
    buildUntil(s, 'conv_ore_drp');
    for (let i = 0; i < 12; i++) s.stepPlant();
    const before = beltLedgerView(s.belt!);
    const snap = s.beltVisualSnapshot()!;
    snap.state.registry.inventories['yard_ore'].usable_t += 9999; // tamper the clone
    snap.state.registry.in_transit.push({ transfer_id: 'fake', from_id: 'a', to_id: 'b', tonnes: 1, depart_tick: 0, arrival_tick: 1 } as any);
    const after = beltLedgerView(s.belt!);
    expect(after.yard_t).toBeCloseTo(before.yard_t, 9);
    expect(after.in_transit_t).toBeCloseTo(before.in_transit_t, 9);
    // pre-build: no snapshot at all (renderer shows nothing)
    const s2 = freshSession();
    buildUntil(s2, 'jetty');
    expect(s2.beltVisualSnapshot()).toBeNull();
  });
});
