// Tests for the guided-placement lifecycle state machine (Phase 2 step: ghost slot ->
// real machine via not_built -> built -> operational, §14.4 mark). TS-only state
// machine — no Python mirror needed here (no owned economic/sim rule involved).

import { describe, it, expect } from 'vitest';
import { ConstructionLedger, DEFAULT_BUILD_DURATION_TICKS } from '../src/shared/construction.ts';

describe('ConstructionLedger lifecycle (§14.4: not_built -> built -> operational)', () => {
  it('ghost slots register as not_built; pre-built starter machines enter operational', () => {
    const c = new ConstructionLedger();
    c.register('s3_drp');
    c.register('s4_eaf_main', { preBuilt: true });
    expect(c.get('s3_drp')!.state).toBe('not_built');
    expect(c.get('s4_eaf_main')!.state).toBe('operational');
    expect(c.get('s4_eaf_main')!.ready_at_tick).toBe(0);
  });

  it('build orders construction and schedules ready_at = tick + duration', () => {
    const c = new ConstructionLedger();
    c.register('s3_drp');
    const r = c.build('s3_drp', 5, 10);
    expect(r.ok).toBe(true);
    const s = c.get('s3_drp')!;
    expect(s.state).toBe('built_pending');
    expect(s.built_from_tick).toBe(5);
    expect(s.ready_at_tick).toBe(15);
  });

  it('construction completes across N ticks on the authoritative clock', () => {
    const c = new ConstructionLedger();
    c.register('s3_drp');
    c.build('s3_drp', 0, DEFAULT_BUILD_DURATION_TICKS); // default 10 ticks
    for (let t = 1; t < 10; t++) {
      c.tick(t);
      expect(c.get('s3_drp')!.state).toBe('built_pending');
    }
    c.tick(10);
    expect(c.get('s3_drp')!.state).toBe('operational');
  });

  it('a built-now machine is operational from its build tick (duration 1 completes next tick)', () => {
    const c = new ConstructionLedger();
    c.register('s3_dri_buffer');
    expect(c.build('s3_dri_buffer', 3, 1).ok).toBe(true);
    c.tick(4);
    expect(c.get('s3_dri_buffer')!.state).toBe('operational');
  });

  it('sim tolerates a machine appearing mid-run: operational at any tick count (no built-at-tick-0 assumption)', () => {
    const c = new ConstructionLedger();
    c.register('s3_drp');
    c.build('s3_drp', 1234, 7); // deep into a resumed run
    for (let t = 1235; t < 1241; t++) c.tick(t);
    c.tick(1241);
    expect(c.get('s3_drp')!.state).toBe('operational');
  });

  it('rejects builds on unknown slots, non-ghost slots, and bad durations with understandable reasons', () => {
    const c = new ConstructionLedger();
    c.register('s4_eaf_main', { preBuilt: true });
    expect(c.build('nope', 1).ok).toBe(false);
    expect(c.build('nope', 1).reason).toContain("unknown slot 'nope'");
    expect(c.build('s4_eaf_main', 1).ok).toBe(false);
    expect(c.build('s4_eaf_main', 1).reason).toContain('operational, not buildable');
    c.register('s3_drp');
    c.build('s3_drp', 1); // now built_pending
    expect(c.build('s3_drp', 2).reason).toContain('built_pending, not buildable');
    const bad = new ConstructionLedger();
    bad.register('x');
    expect(bad.build('x', 1, 0).ok).toBe(false);
    expect(bad.build('x', 1, 2.5).ok).toBe(false);
  });

  it('progress fraction feeds the hub UI: 0 before build, ramps over N ticks, 1 when operational', () => {
    const c = new ConstructionLedger();
    c.register('s3_drp');
    expect(c.progress('s3_drp', 5)).toBe(0);
    c.build('s3_drp', 5, 10);
    expect(c.progress('s3_drp', 5)).toBe(0);
    expect(c.progress('s3_drp', 10)).toBeCloseTo(0.5);
    expect(c.progress('s3_drp', 14)).toBeCloseTo(0.9);
    c.tick(15);
    expect(c.progress('s3_drp', 15)).toBe(1);
  });

  it('construction events surface started/complete for the hub event log', () => {
    const c = new ConstructionLedger();
    c.register('s3_drp');
    c.build('s3_drp', 2, 3);
    c.tick(3);
    c.tick(5);
    expect(c.events).toEqual([
      { tick: 2, event: 'construction_started:s3_drp' },
      { tick: 5, event: 'construction_complete:s3_drp' },
    ]);
  });

  it('snapshot/restore carries construction progress across save/load (mid-build resumes)', () => {
    const c = new ConstructionLedger();
    c.register('s3_drp');
    c.register('s4_eaf_main', { preBuilt: true });
    c.build('s3_drp', 4, 10);
    c.tick(8); // partway through

    const snap = c.snapshot();
    const c2 = new ConstructionLedger();
    c2.restore(snap);
    expect(c2.get('s3_drp')!.state).toBe('built_pending');
    expect(c2.get('s3_drp')!.ready_at_tick).toBe(14);
    expect(c2.get('s4_eaf_main')!.state).toBe('operational');
    for (let t = 9; t < 14; t++) c2.tick(t);
    c2.tick(14);
    expect(c2.get('s3_drp')!.state).toBe('operational');
  });

  it('tick is idempotent for already-operational slots and does nothing to not_built ones', () => {
    const c = new ConstructionLedger();
    c.register('a', { preBuilt: true });
    c.register('b');
    c.tick(1);
    c.tick(2);
    expect(c.get('a')!.state).toBe('operational');
    expect(c.get('b')!.state).toBe('not_built');
    expect(c.events.length).toBe(0);
  });
});
