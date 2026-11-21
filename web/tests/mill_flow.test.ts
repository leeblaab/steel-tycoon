// S5.4 — mill_flow projection pins (pure functions; determinism rule 5: no RNG).
import { describe, expect, it } from 'vitest';
import { SCENARIO } from '../src/ports/slice5/browser/sim';
import { ELONGATION_TOTAL, MILL_BANDS, lerpFlow, millFlow } from '../src/ports/slice5/browser/mill_flow';

const ROLL = 20; // synthetic tick grid for band-edge pins — a 6-tick grid can't land
                 // a sample inside every 0.30/0.55/0.80 band, so the edge test runs on
                 // a finer grid while the browser drives from per-tick records.

describe('mill_flow (S5.4 nod-animation projection)', () => {
  it('scenario roll cycle is observable: every phase fires within one roll', () => {
    const rt = SCENARIO.rebar_mill.roll_ticks;
    const seen = new Set<string>();
    for (let e = 0; e < rt; e++) seen.add(millFlow(true, e, rt).phase!);
    expect([...seen].sort()).toEqual(['cooling', 'reheat', 'rolling', 'shear']);
  });

  it('idle outside a roll: no bar, no channels', () => {
    const f = millFlow(false, 0, ROLL);
    expect(f.active).toBe(false);
    expect(f.phase).toBeNull();
    expect(f.barHeadX).toBeNull();
    expect(f.glow).toBe(0);
  });

  it('phase bands match the shared MILL_PHASE_BANDS contract', () => {
    const seen: string[] = [];
    for (let e = 0; e < ROLL; e++) {
      const p = millFlow(true, e, ROLL).phase!;
      if (!seen.length || seen[seen.length - 1] !== p) seen.push(p);
    }
    expect(seen).toEqual(['reheat', 'rolling', 'cooling', 'shear']);
    // band edges agree with the shared enum (0.30/0.55/0.80 of roll_ticks):
    // ceil(a*ROLL) is the first tick inside the band and the tick before it is
    // still outside; floor(b*ROLL)+1 has moved on. (A sample exactly ON the edge
    // belongs to the NEXT band — frac < b in the shared bandOf, same here.)
    for (const [name, a, b] of MILL_BANDS) {
      expect(millFlow(true, Math.ceil(a * ROLL), ROLL).phase).toBe(name);
      if (a > 0) expect(millFlow(true, Math.ceil(a * ROLL) - 1, ROLL).phase).not.toBe(name);
      if (b < 1) expect(millFlow(true, Math.floor(b * ROLL) + 1, ROLL).phase).not.toBe(name);
    }
  });

  it('rolling: bar head advances monotonically across the stands', () => {
    const xs = Array.from({ length: ROLL }, (_, e) => millFlow(true, e, ROLL))
      .filter((f) => f.phase === 'rolling').map((f) => f.barHeadX!);
    expect(xs.length).toBeGreaterThan(1);
    xs.slice(1).forEach((x, i) => expect(x).toBeGreaterThan(xs[i]));
  });

  it('elongation grows 1 -> ELONGATION_TOTAL across the roll (bar gets longer as it thins)', () => {
    expect(millFlow(true, 0, ROLL).elongation).toBe(1);
    const rolling = millFlow(true, Math.ceil(0.4 * ROLL), ROLL);
    expect(rolling.elongation).toBeGreaterThan(1);
    expect(rolling.elongation).toBeLessThanOrEqual(ELONGATION_TOTAL);
    expect(millFlow(true, ROLL - 1, ROLL).elongation).toBeCloseTo(ELONGATION_TOTAL, 3);
  });

  it('cooling: walk advances and glow fades hot -> black (SME non-negotiable)', () => {
    const frames = Array.from({ length: ROLL }, (_, e) => millFlow(true, e, ROLL))
      .filter((f) => f.phase === 'cooling');
    expect(frames.length).toBeGreaterThan(1);
    frames.slice(1).forEach((f, i) => {
      expect(f.bedWalk).toBeGreaterThan(frames[i].bedWalk);
      expect(f.glow).toBeLessThan(frames[i].glow);
    });
    const shear = millFlow(true, ROLL - 1, ROLL);
    expect(shear.shearing).toBe(true);
    expect(shear.glow).toBe(0); // cold shear at the bed exit
  });

  it('reheat window flags the discharge glow cue', () => {
    const f = millFlow(true, 0, ROLL);
    expect(f.phase).toBe('reheat');
    expect(f.discharging).toBe(true);
  });

  it('lerpFlow interpolates channels (pure, deterministic)', () => {
    const a = millFlow(true, 2, ROLL);
    const b = millFlow(true, 3, ROLL);
    const m = lerpFlow(a, b, 0.5);
    expect(m.pp).toBeCloseTo((a.pp + b.pp) / 2, 6);
    expect(m.glow).toBeCloseTo((a.glow + b.glow) / 2, 6);
    if (a.barHeadX !== null && b.barHeadX !== null) {
      expect(m.barHeadX).toBeCloseTo((a.barHeadX + b.barHeadX) / 2, 6);
    }
    // t=0/1 reproduce the endpoints exactly
    const e0 = lerpFlow(a, b, 0);
    expect(e0.pp).toBe(a.pp);
    expect(e0.glow).toBe(a.glow);
  });

  it('invalid roll_ticks never divides by zero', () => {
    expect(millFlow(true, 5, 0).active).toBe(false);
  });
});
