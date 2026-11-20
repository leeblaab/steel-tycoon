// S3.2 state-light projection — pure-data tests. Pins the PLAN_FORGED state grammar:
// idle desaturated / running green pulse / blocked-starved amber; feed shortfall
// overrides a busy tone (the furnace runs but its feed is short).
import { describe, it, expect } from 'vitest';
import { stateLightView, feedAmberSignal, AMBER, RUN_GREEN, IDLE_GRAY } from '../src/shared/state_lights.ts';

describe('state grammar', () => {
  it('idle / unknown -> desaturated, no pulse, not amber', () => {
    for (const tone of ['idle', null, undefined] as const) {
      const v = stateLightView(tone as any, false);
      expect(v.color).toBe(IDLE_GRAY);
      expect(v.pulse).toBe(false);
      expect(v.amber).toBe(false);
    }
  });
  it('busy -> green pulse, not amber', () => {
    const v = stateLightView('busy', false);
    expect(v.color).toBe(RUN_GREEN);
    expect(v.pulse).toBe(true);
    expect(v.amber).toBe(false);
  });
  it('waiting -> amber pulse', () => {
    const v = stateLightView('waiting', false);
    expect(v.color).toBe(AMBER);
    expect(v.pulse).toBe(true);
    expect(v.amber).toBe(true);
  });
  it('feed shortfall overrides busy AND idle -> amber', () => {
    for (const tone of ['busy', 'idle', 'waiting', null] as const) {
      const v = stateLightView(tone as any, true);
      expect(v.color).toBe(AMBER);
      expect(v.amber).toBe(true);
    }
  });
  it('brightness ordering: amber > running > idle', () => {
    expect(stateLightView('waiting', false).level).toBeGreaterThan(stateLightView('busy', false).level);
    expect(stateLightView('busy', false).level).toBeGreaterThan(stateLightView('idle', false).level);
  });
  it('feedAmberSignal: shortfall event OR empty EAF scrap interface', () => {
    expect(feedAmberSignal(true, 50)).toBe(true);
    expect(feedAmberSignal(false, 0)).toBe(true);
    expect(feedAmberSignal(false, -1)).toBe(true);
    expect(feedAmberSignal(false, 50)).toBe(false);
  });
});
