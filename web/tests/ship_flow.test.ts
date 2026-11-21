// S5.5 — shipment-stage projection pins (pure functions; determinism rule 5: no RNG).
import { describe, expect, it } from 'vitest';
import { BUNDLE_T, MAX_BUNDLE_PROPS, weighbridgeTicket, yardBundles } from '../src/ports/slice5/browser/ship_flow';

describe('ship_flow (S5.5 shipment-stage projections)', () => {
  it('bundle math matches productYardView floor division', () => {
    // fixture cadence: a completed roll leaves 9.8 t in the yard -> 4 bundles + 1.8 loose
    const y = yardBundles(9.8);
    expect(y.units).toBe(4);
    expect(y.loose_t).toBeCloseTo(1.8, 9);
  });

  it('exact multiples have no loose remainder', () => {
    const y = yardBundles(6 * BUNDLE_T);
    expect(y.units).toBe(6);
    expect(y.loose_t).toBeCloseTo(0, 9);
  });

  it('sub-bundle stock shows zero whole bundles, all loose', () => {
    const y = yardBundles(1.4);
    expect(y.units).toBe(0);
    expect(y.loose_t).toBeCloseTo(1.4, 9);
  });

  it('empty yard projects empty', () => {
    const y = yardBundles(0);
    expect(y.units).toBe(0);
    expect(y.loose_t).toBe(0);
  });

  it('pure: same input -> same output (no hidden state)', () => {
    expect(JSON.stringify(yardBundles(9.8))).toBe(JSON.stringify(yardBundles(9.8)));
  });

  it('presentation cap is a positive budget constant', () => {
    expect(MAX_BUNDLE_PROPS).toBeGreaterThan(0);
  });

  it('weighbridge ticket formats the sim-assigned move tonnage (no new numbers)', () => {
    expect(weighbridgeTicket(9.8)).toBe('9.8 t');
    expect(weighbridgeTicket(10)).toBe('10.0 t');
  });
});
