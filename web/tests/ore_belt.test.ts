// S1.2 ore-belt wiring tests — deterministic, no fixture needed (no RNG in the belt layer;
// the registry primitives themselves are pinned by registry_handoff_parity.test.ts).
// Pins: boundary-buffer pattern, two-phase handoff through the belt, commissioning drain,
// closure invariants, and the planBeltLoad capacity/chunk arithmetic.

import { describe, it, expect } from 'vitest';
import {
  freshOreBeltState, stepOreBelt, commissionDrp, beltDepositYard,
  beltRatePerTick, planBeltLoad, beltLedgerView, beltInvariants,
  yardMoundView, MOUND_REF_T,
  YARD_INV, BUFFER_INV, DRP_INTAKE_INV,
} from '../src/shared/ore_belt.ts';

describe('belt arithmetic', () => {
  it('rate = tph / 24 (one tick = 15 plant-minutes)', () => {
    expect(beltRatePerTick(600)).toBeCloseTo(25.0, 10);
    expect(() => beltRatePerTick(0)).toThrow();
  });

  it('planBeltLoad moves whole chunks only, capped by capacity', () => {
    expect(planBeltLoad(100, 25, 25)).toBe(25);
    expect(planBeltLoad(10, 25, 25)).toBe(0); // partial chunk never starts
    expect(planBeltLoad(1000, 25, 25)).toBe(25);
    expect(planBeltLoad(60, 80, 30)).toBe(60); // two chunks under a bigger cap
    expect(planBeltLoad(0, 25, 25)).toBe(0);
  });

  it('travel_ticks must be an integer >= 1 (no same-tick teleport)', () => {
    expect(() => freshOreBeltState(600, 25, 0)).toThrow(/integer >= 1/);
    expect(() => freshOreBeltState(600, 25, 1.5)).toThrow(/integer >= 1/);
  });
});

describe('boundary buffer pattern (step 4 before DRP exists)', () => {
  it('belt runs yard -> buffer with zero DRP inventories; nothing teleports', () => {
    let st = freshOreBeltState(600, 25, 2); // 25 t/tick cap, 25 t chunks, 2-tick run
    st = beltDepositYard(st, 100.0); // one cargo's worth landed in the yard
    const initialDeposits = 100.0;

    st = stepOreBelt(st); // tick 1: load A departs (arrives tick 3)
    let v = beltLedgerView(st);
    expect(v.yard_t).toBe(75);
    expect(v.buffer_t).toBe(0); // NOT credited yet — two-phase handoff
    expect(v.in_transit_t).toBe(25);

    st = stepOreBelt(st); // tick 2: load B departs
    v = beltLedgerView(st);
    expect(v.yard_t).toBe(50);
    expect(v.buffer_t).toBe(0);
    expect(v.in_transit_t).toBe(50);

    st = stepOreBelt(st); // tick 3: A arrives, C departs
    v = beltLedgerView(st);
    expect(v.buffer_t).toBe(25);
    expect(v.yard_t).toBe(25);

    for (let i = 0; i < 6; i++) st = stepOreBelt(st);
    v = beltLedgerView(st);
    expect(v.buffer_t).toBe(100); // everything landed eventually
    expect(v.in_transit_t).toBe(0);
    expect(DRP_INTAKE_INV in st.registry.inventories).toBe(false); // DRP never joined
    expect(beltInvariants(st, initialDeposits).ok).toBe(true);
  });

  it('commissioning drains the pre-built buffer stock into drp_intake', () => {
    let st = freshOreBeltState(600, 25, 2);
    st = beltDepositYard(st, 100.0);
    for (let i = 0; i < 7; i++) st = stepOreBelt(st); // buffer full at 100 t
    expect(beltLedgerView(st).buffer_t).toBe(100);

    st = commissionDrp(st); // step 6 build: DRP joins the ledger
    expect(beltLedgerView(st).drp_intake_t).toBe(0); // credit is never same-tick

    st = stepOreBelt(st); // tick after commissioning: drain load departs
    let v = beltLedgerView(st);
    expect(v.drp_intake_t).toBe(0);
    expect(v.in_transit_t).toBeGreaterThanOrEqual(25);

    for (let i = 0; i < 10; i++) st = stepOreBelt(st);
    v = beltLedgerView(st);
    expect(v.drp_intake_t).toBe(100); // pre-step-6 stock all reached the DRP
    expect(v.buffer_t).toBe(0);
    expect(beltInvariants(st, 100.0).ok).toBe(true);
  });

  it('step-4-only game keeps ticking cleanly with an empty yard (no negative loads)', () => {
    let st = freshOreBeltState();
    for (let i = 0; i < 5; i++) st = stepOreBelt(st);
    expect(beltLedgerView(st).in_transit_t).toBe(0);
    expect(beltInvariants(st, 0.0).ok).toBe(true);
  });

  it('double commissioning is a no-op (idempotent)', () => {
    let st = commissionDrp(freshOreBeltState());
    const snap = JSON.stringify(st.registry);
    st = commissionDrp(st);
    expect(JSON.stringify(st.registry)).toBe(snap);
  });
});

describe('yard credit rides the slice1 arrival stream', () => {
  it('deposit -> belt -> buffer tracks the ledger quantity for token counts', () => {
    let st = freshOreBeltState(600, 25, 1); // 1-tick run keeps the math tight
    st = beltDepositYard(st, 50.0);
    st = stepOreBelt(st); // load departs tick 1, arrives tick 2
    let v = beltLedgerView(st);
    expect(v.in_transit_t + v.buffer_t + v.yard_t).toBe(50);
    st = stepOreBelt(st);
    v = beltLedgerView(st);
    expect(v.buffer_t).toBe(25); // tick-1 load landed; tick-2 load in flight
    st = stepOreBelt(st);
    v = beltLedgerView(st);
    expect(v.buffer_t).toBe(50);
  });
});

describe('S1.4 yard mound projection (pure data — the mound IS the inventory)', () => {
  it('null state (belt not built yet) -> minimum mound, never negative', () => {
    const v = yardMoundView(null);
    expect(v.frac).toBe(0);
    expect(v.height).toBeCloseTo(0.25, 10);
    expect(v.radius).toBeCloseTo(0.8, 10);
  });

  it('fill fraction is tonnage / reference, clamped to [0,1]', () => {
    let st = freshOreBeltState();
    expect(yardMoundView(st).frac).toBe(0);
    st = beltDepositYard(st, MOUND_REF_T / 2);
    expect(yardMoundView(st).frac).toBeCloseTo(0.5, 10);
    st = beltDepositYard(st, MOUND_REF_T * 10); // way over reference
    const v = yardMoundView(st);
    expect(v.frac).toBe(1);
    expect(v.height).toBeCloseTo(2.4, 10);
    expect(v.radius).toBeCloseTo(2.2, 10);
  });

  it('height and radius are monotone in tonnage', () => {
    let st = freshOreBeltState();
    let prevH = 0, prevR = 0;
    for (const t of [100, 400, 1000, 1500, 1900]) { // deposits ADD: cumulative 100..4900 stays under ref
      st = beltDepositYard(st, t);
      const v = yardMoundView(st);
      expect(v.height).toBeGreaterThan(prevH);
      expect(v.radius).toBeGreaterThan(prevR);
      prevH = v.height; prevR = v.radius;
    }
  });

  it('mound shrinks as the belt drains the yard (tracks the live ledger)', () => {
    let st = freshOreBeltState(600, 25, 1);
    st = beltDepositYard(st, 2000);
    const before = yardMoundView(st).frac;
    for (let i = 0; i < 20; i++) st = stepOreBelt(st); // 25 t/tick leaves the yard
    const after = yardMoundView(st).frac;
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo((2000 - 20 * 25) / MOUND_REF_T, 6);
  });

  it('projection never mutates the ledger; bad reference throws', () => {
    const st = beltDepositYard(freshOreBeltState(), 1234);
    const snap = JSON.stringify(st);
    yardMoundView(st);
    expect(JSON.stringify(st)).toBe(snap);
    expect(() => yardMoundView(st, 0)).toThrow(/positive/);
    expect(() => yardMoundView(st, -5)).toThrow(/positive/);
  });
});
