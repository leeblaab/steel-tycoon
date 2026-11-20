// S4.2 cast-chapter projections — pure-data tests (caster pose, billet hot->cold fade,
// ladle-car continuation to the caster). Pins the PLAN_FORGED Stage 4 grammar.
import { describe, it, expect } from 'vitest';
import { casterPoseView, billetYardView, lastCastAgeTicks, TORCH_HOME_X, BILLET_SLOTS, BILLET_COOL_TICKS } from '../src/shared/caster_pose.ts';
import { eafPoseView, LADLE_CCM_X, LADLE_LF_X, LADLE_HOME_X } from '../src/shared/eaf_heat_pose.ts';

describe('caster pose (existing ccm signals only)', () => {
  it('idle: turret indexed (PI), mold still, torch parked', () => {
    for (const ccm of [null, undefined, { busy_ladle_id: null }]) {
      const p = casterPoseView(ccm as any, 3.7);
      expect(p.casting).toBe(false);
      expect(p.turretTarget).toBe(Math.PI);
      expect(p.moldOsc).toBe(0);
      expect(p.torchX).toBe(TORCH_HOME_X);
    }
  });
  it('casting: turret over mold, mold oscillates within stroke, torch traverses', () => {
    for (let t = 0; t < 20; t += 0.7) {
      const p = casterPoseView({ busy_ladle_id: 'ladle-2', remaining_ticks: 5 }, t);
      expect(p.casting).toBe(true);
      expect(p.turretTarget).toBe(0);
      expect(Math.abs(p.moldOsc)).toBeLessThanOrEqual(0.045 + 1e-9);
      expect(Math.abs(p.torchX - TORCH_HOME_X)).toBeLessThanOrEqual(0.22 + 1e-9);
    }
  });
});

describe('billet yard hot->cold fade (sim billet age)', () => {
  it('tonnage -> slot count, capped at 18', () => {
    expect(billetYardView(0, 0).count).toBe(0);
    expect(billetYardView(95, 0).count).toBe(9);
    expect(billetYardView(5000, 0).count).toBe(BILLET_SLOTS);
    expect(billetYardView(-5, 0).count).toBe(0);
  });
  it('fresh cast: newest slot full heat, older slots staggered cooler', () => {
    const v = billetYardView(180, 0);
    expect(v.count).toBe(18);
    expect(v.heat[17]).toBe(1);
    expect(v.heat[0]).toBeLessThan(v.heat[17]);
    for (let i = 1; i < 18; i++) expect(v.heat[i]).toBeGreaterThanOrEqual(v.heat[i - 1]);
  });
  it('fully cooled after the cooling window (+stagger)', () => {
    const v = billetYardView(180, BILLET_COOL_TICKS + 18 * 6);
    expect(v.heat.every((h) => h === 0)).toBe(true);
  });
  it('heat monotone decreasing with age', () => {
    const a = billetYardView(180, 5).heat[17];
    const b = billetYardView(180, 20).heat[17];
    expect(a).toBeGreaterThan(b);
  });
});

describe('lastCastAgeTicks (existing event strings)', () => {
  const ev = [
    { tick: 10, event: 'CCM cast starts for ladle l1' },
    { tick: 18, event: 'CCM casts ladle l1: 96.0t billet -> billet yard' },
    { tick: 30, event: 'CCM cast starts for ladle l2' },
    { tick: 38, event: 'CCM casts ladle l2: 95.0t billet -> billet yard' },
    { tick: 40, event: 'EAF heat starts' },
  ];
  it('finds the LAST cast completion, not cast starts', () => {
    expect(lastCastAgeTicks(ev, 50)).toBe(12);
  });
  it('no events / no cast -> huge age (everything cold)', () => {
    expect(lastCastAgeTicks([], 50)).toBeGreaterThan(1e6);
    expect(lastCastAgeTicks(null, 50)).toBeGreaterThan(1e6);
    expect(lastCastAgeTicks([{ tick: 1, event: 'CCM cast starts for ladle l1' }], 50)).toBeGreaterThan(1e6);
  });
});

describe('ladle car continuation EAF -> LF -> caster (S4.2)', () => {
  const hot = { metal_t: 90 };
  it('casting flag sends the hot ladle to the caster seat', () => {
    const p = eafPoseView(null, hot, { casting: true });
    expect(p.ladleTargetX).toBe(LADLE_CCM_X);
  });
  it('hot but not casting -> LF; empty -> home', () => {
    expect(eafPoseView(null, hot, {}).ladleTargetX).toBe(LADLE_LF_X);
    expect(eafPoseView(null, { metal_t: 0 }, {}).ladleTargetX).toBe(LADLE_HOME_X);
  });
  it('casting flag with empty ladle still targets caster (car repositioning)', () => {
    expect(eafPoseView(null, null, { casting: true }).ladleTargetX).toBe(LADLE_CCM_X);
  });
});
