// S1.2 ore-belt parity — replay the Python mirror dump row-by-row against ore_belt.ts.
// Dump built by web/tests/scratch_registry/build_ore_belt_dump.py: the REAL slice1 mirror
// (seed-11 state, FixedDraws no-fire) feeds each tick's `arrived_t` delta into a literal
// Python clone of this belt chain; DRP commissions at tick 30. If TS and the mirror agree
// on every tick view AND closure, the game belt is the same ruleset as the twin.

// @ts-expect-error vitest resolves bare node builtins without @types/node (as in save_load.test.ts)
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  freshOreBeltState, stepOreBelt, commissionDrp, beltDepositYard,
  beltLedgerView, beltInvariants,
} from '../src/shared/ore_belt.ts';

const REPO = 'C:/AI_LAB/SteelX';

interface DumpRow {
  tick: number; slice_arrived_t: number; yard_t: number; buffer_t: number;
  drp_intake_t: number; in_transit_t: number;
}
interface Dump {
  fixture_id: string; schema_version: number;
  belt: { rate_tph: number; chunk_t: number; travel_ticks: number; commission_tick: number };
  tick_count: number; rows: DumpRow[]; deposits_total: number; closure_total: number;
}

const dump = JSON.parse(
  readFileSync(`${REPO}/web/tests/scratch_registry/ore_belt_dump.json`, 'utf-8'),
) as Dump;

describe('ore_belt.ts mirrors the Python ore-belt clone row-by-row', () => {
  it(`replays all ${dump.rows.length} ticks of '${dump.fixture_id}' with identical views`, () => {
    expect(dump.schema_version).toBe(1);
    let st = freshOreBeltState(dump.belt.rate_tph, dump.belt.chunk_t, dump.belt.travel_ticks);
    let prevArrived = 0.0;

    for (const row of dump.rows) {
      const delta = row.slice_arrived_t - prevArrived;
      prevArrived = row.slice_arrived_t;
      if (delta > 0) st = beltDepositYard(st, delta);
      st = stepOreBelt(st);
      if (row.tick === dump.belt.commission_tick) st = commissionDrp(st);

      const v = beltLedgerView(st);
      expect(v.yard_t, `tick ${row.tick} yard`).toBeCloseTo(row.yard_t, 5);
      expect(v.buffer_t, `tick ${row.tick} buffer`).toBeCloseTo(row.buffer_t, 5);
      expect(v.drp_intake_t, `tick ${row.tick} drp_intake`).toBeCloseTo(row.drp_intake_t, 5);
      expect(v.in_transit_t, `tick ${row.tick} in_transit`).toBeCloseTo(row.in_transit_t, 5);
    }

    const close = beltInvariants(st, dump.deposits_total);
    expect(close.ok, close.detail).toBe(true);
  });

  it('dump closure identity holds (deposits == inventories + in transit)', () => {
    let sum = 0;
    for (const r of dump.rows) {
      const last = dump.rows[dump.rows.length - 1];
      if (r === last) sum = r.yard_t + r.buffer_t + r.drp_intake_t + r.in_transit_t;
    }
    expect(Math.abs(sum - dump.closure_total)).toBeLessThan(1e-4);
    expect(Math.abs(dump.deposits_total - dump.closure_total)).toBeLessThan(1e-4);
  });

  it('negative control: same-tick teleport (travel_ticks=0) is rejected by the belt', () => {
    expect(() => freshOreBeltState(dump.belt.rate_tph, dump.belt.chunk_t, 0)).toThrow();
  });
});
