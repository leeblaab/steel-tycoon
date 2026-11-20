// S2.2 heat-cycle pose projection — pure-data tests (no browser needed).
// Pins the SME non-negotiables: sideways roof swing on charge, bore-down on melt,
// heavy 30-40 deg tilt on tap with gated stream, hot-ladle glow + travel to LF.
import { describe, it, expect } from 'vitest';
import {
  eafPoseView, easeInOutCubic,
  ROOF_SWING_MAX, TILT_MAX, BORE_RAISED, BORE_IN, LADLE_HOME_X, LADLE_LF_X, STREAM_TILT_GATE,
} from '../src/shared/eaf_heat_pose.ts';

const at = (phase: string | null, p: number) => ({ heat_phase: phase as any, phase_progress: p, busy_charge_id: phase ? 'C1' : null });

describe('idle / null state', () => {
  it('no phase -> roof closed, electrodes raised, vessel level, no stream, ladle home', () => {
    for (const eaf of [null, undefined, at(null, 0)]) {
      const v = eafPoseView(eaf as any, null);
      expect(v.roofSwing).toBe(0);
      expect(v.bore).toBe(BORE_RAISED);
      expect(v.tilt).toBe(0);
      expect(v.stream).toBe(false);
      expect(v.powerOn).toBe(false);
      expect(v.ladleTargetX).toBe(LADLE_HOME_X);
      expect(v.glow).toBe(0);
    }
  });
});

describe('charge: roof swings SIDEWAYS off the shell', () => {
  it('swing monotone 0 -> ROOF_SWING_MAX, electrodes stay raised, no stream', () => {
    let prev = -1;
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const v = eafPoseView(at('charge', p), null);
      expect(v.roofSwing).toBeGreaterThanOrEqual(prev);
      prev = v.roofSwing;
      expect(v.bore).toBe(BORE_RAISED);
      expect(v.tilt).toBe(0);
      expect(v.stream).toBe(false);
    }
    expect(prev).toBeCloseTo(ROOF_SWING_MAX, 10);
  });
});

describe('melt: roof closes, electrodes bore down, power on', () => {
  it('roof fully closed by 15% of melt; bore monotone raised -> in', () => {
    expect(eafPoseView(at('melt', 0.15), null).roofSwing).toBeCloseTo(0, 10);
    expect(eafPoseView(at('melt', 0.5), null).roofSwing).toBe(0);
    let prev = BORE_RAISED - 1;
    for (const p of [0, 0.2, 0.5, 0.8, 1]) {
      const v = eafPoseView(at('melt', p), null);
      expect(v.bore).toBeGreaterThan(prev);
      prev = v.bore;
      expect(v.powerOn).toBe(true);
      expect(v.tilt).toBe(0);
    }
    expect(prev).toBeCloseTo(BORE_IN, 10);
  });
});

describe('refine: hold bore, power on, no motion targets', () => {
  it('bore in, roof closed, no tilt/stream', () => {
    const v = eafPoseView(at('refine', 0.5), null);
    expect(v.bore).toBe(BORE_IN);
    expect(v.roofSwing).toBe(0);
    expect(v.tilt).toBe(0);
    expect(v.stream).toBe(false);
    expect(v.powerOn).toBe(true);
  });
});

describe('tap: slow heavy tilt in the SME 30-40 deg band, gated stream', () => {
  it('tilt monotone 0 -> 30-40 deg; stream only after the gate; electrodes raise', () => {
    let prev = -1;
    for (const p of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const v = eafPoseView(at('tap', p), null);
      expect(v.tilt).toBeGreaterThanOrEqual(prev);
      prev = v.tilt;
      expect(v.stream).toBe(p > STREAM_TILT_GATE);
      expect(v.powerOn).toBe(false);
    }
    const deg = (prev * 180) / Math.PI;
    expect(deg).toBeGreaterThanOrEqual(30);
    expect(deg).toBeLessThanOrEqual(40);
    expect(eafPoseView(at('tap', 1), null).bore).toBeCloseTo(BORE_RAISED, 10);
  });
});

describe('ladle cycle: glow + travel to LF, stream off once it leaves', () => {
  it('hot ladle -> LF target + glow; idle with hot ladle never streams', () => {
    const hot = { metal_t: 38.15, refined: false };
    const v = eafPoseView(at(null, 0), hot);
    expect(v.ladleTargetX).toBe(LADLE_LF_X);
    expect(v.glow).toBeCloseTo(1.8, 10);
    expect(v.stream).toBe(false);
    const cold = eafPoseView(at(null, 0), { metal_t: 0, refined: false });
    expect(cold.ladleTargetX).toBe(LADLE_HOME_X);
    expect(cold.glow).toBe(0);
  });
  it('tap phase heats the bath glow before the tap event credits metal', () => {
    const v = eafPoseView(at('tap', 0.8), { metal_t: 0 });
    expect(v.glow).toBeGreaterThan(0);
    expect(v.ladleTargetX).toBe(LADLE_HOME_X); // still under the spout
  });
});

describe('purity + clamping', () => {
  it('inputs never mutated; progress clamped to [0,1]; easing bounded', () => {
    const eaf = at('tap', 0.5);
    const ladle = { metal_t: 10, refined: false };
    const before = JSON.stringify([eaf, ladle]);
    eafPoseView(eaf, ladle);
    expect(JSON.stringify([eaf, ladle])).toBe(before);
    expect(eafPoseView(at('tap', -3), null).tilt).toBe(0);
    expect(eafPoseView(at('tap', 9), null).tilt).toBeCloseTo(TILT_MAX, 10);
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
    expect(easeInOutCubic(0.5)).toBeCloseTo(0.5, 10);
  });
});

describe('sub-tick frac interpolation (1-tick tap band must still animate)', () => {
  it('tap at progress 0 + frac 1 -> full tilt + stream; frac 0.5 -> partial tilt', () => {
    const full = eafPoseView(at('tap', 0), null, { frac: 1, totalTicks: 10 });
    expect(full.tilt).toBeCloseTo(TILT_MAX, 10);
    expect(full.stream).toBe(true);
    const mid = eafPoseView(at('tap', 0), null, { frac: 0.5, totalTicks: 10 });
    expect(mid.tilt).toBeGreaterThan(0);
    expect(mid.tilt).toBeLessThan(TILT_MAX);
    expect(mid.stream).toBe(true); // 0.5 > STREAM_TILT_GATE
    const early = eafPoseView(at('tap', 0), null, { frac: 0.2, totalTicks: 10 });
    expect(early.stream).toBe(false); // 0.2 < gate
  });
  it('frac never pushes past the band end; charge completes within its 2 ticks', () => {
    const v = eafPoseView(at('charge', 0.67), null, { frac: 1, totalTicks: 10 });
    expect(v.roofSwing).toBeCloseTo(ROOF_SWING_MAX, 10);
    const clamped = eafPoseView(at('melt', 0.5), null, { frac: 9, totalTicks: 10 });
    expect(clamped.bore).toBeLessThanOrEqual(BORE_IN);
  });
});
