// S3.1 meltshop-feed parity — replay the three-engine Python mirror dump row-by-row
// against meltshop_feed.ts (literal clone discipline, same as ore_belt_parity).
// Dump built by web/tests/scratch_registry/build_meltshop_feed_dump.py: REAL slice1 ops
// mirror (dispatched_t deltas) + slice3 mirror (discharged_t_total deltas) + slice4 mirror
// (heat-start consumptions); EAF commissions at tick 30. Regenerate with:
//   cd C:/AI_LAB/SteelX && python web/tests/scratch_registry/build_meltshop_feed_dump.py
import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  freshMeltshopFeedState, commissionEaf, feedDepositScrap, feedDepositDri,
  stepMeltshopFeed, feedLedgerView, feedInvariants, feedShortfallsThisTick,
  planFeedLoad,
} from '../src/shared/meltshop_feed.ts';

const REPO = 'C:/AI_LAB/SteelX';
const DUMP = JSON.parse(readFileSync(`${REPO}/web/tests/scratch_registry/meltshop_feed_dump.json`, 'utf-8'));

const TONNAGE_KEYS = ['scrap_bucket_t', 'dri_feed_buffer_t', 'eaf_scrap_t', 'eaf_dri_t',
  'in_transit_t', 'consumed_scrap_t', 'consumed_dri_t'] as const;

test('row-by-row parity vs the three-engine mirror dump (60 ticks, closure every tick)', () => {
  let st = freshMeltshopFeedState();
  let deposits = 0.0;
  let prevDisp = 0.0;
  let prevDisch = 0.0;
  assert.strictEqual(DUMP.rows.length, DUMP.tick_count);
  for (const row of DUMP.rows) {
    const dsc = row.slice_dispatched_t - prevDisp; prevDisp = row.slice_dispatched_t;
    const ddr = row.slice_discharged_t - prevDisch; prevDisch = row.slice_discharged_t;
    if (dsc > 0) { st = feedDepositScrap(st, dsc); deposits += dsc; }
    if (ddr > 0) { st = feedDepositDri(st, ddr); deposits += ddr; }
    st = stepMeltshopFeed(st, row.consumptions);
    if (row.tick === DUMP.commission_tick) st = commissionEaf(st);
    const v = feedLedgerView(st);
    for (const k of TONNAGE_KEYS) {
      assert.ok(Math.abs((v as any)[k] - row[k]) < 1e-6, `tick ${row.tick} ${k}: TS ${v[k as keyof typeof v]} != mirror ${row[k]}`);
    }
    assert.strictEqual(feedShortfallsThisTick(st), row.shortfalls_this_tick, `tick ${row.tick}: shortfall count`);
    assert.ok(feedInvariants(st, deposits).ok, `tick ${row.tick}: closure broke`);
  }
  assert.ok(Math.abs(deposits - DUMP.deposits_total) < 1e-6);
  assert.ok(DUMP.closure_ok);
});

test('N1 empty feed stays zero + closed (nothing fabricated)', () => {
  let st = freshMeltshopFeedState();
  for (let i = 0; i < 5; i++) st = stepMeltshopFeed(st, []);
  const v = feedLedgerView(st);
  for (const k of TONNAGE_KEYS) assert.strictEqual((v as any)[k], 0);
  assert.ok(feedInvariants(st, 0).ok);
});

test('N2 pre-commission consumption refused, closure intact', () => {
  let st = freshMeltshopFeedState();
  st = feedDepositScrap(st, 100);
  st = stepMeltshopFeed(st, [{ charge_id: 'C1', scrap_t: 30, dri_t: 10 }]);
  assert.strictEqual(st.consumedScrapT, 0);
  assert.ok(st.registry.events.some((e) => e.event.includes('not commissioned')));
  assert.ok(feedInvariants(st, 100).ok);
});

test('N3 shortfall consumes available only + event + closure exact', () => {
  let st = freshMeltshopFeedState();
  st = commissionEaf(st);
  st = feedDepositScrap(st, 20);
  st = feedDepositDri(st, 50);
  for (let i = 0; i < 6; i++) st = stepMeltshopFeed(st, []); // drain + 2-tick transit fully arrives
  st = stepMeltshopFeed(st, [{ charge_id: 'C1', scrap_t: 30, dri_t: 10 }]);
  assert.ok(Math.abs(st.consumedScrapT - 20) < 1e-6);
  assert.ok(Math.abs(st.consumedDriT - 10) < 1e-6);
  assert.ok(st.registry.events.some((e) => e.event.includes('SHORTFALL')));
  assert.ok(feedInvariants(st, 70).ok);
});

test('N4 travel_ticks >= 1 enforced at construction (no same-tick teleport)', () => {
  assert.throws(() => freshMeltshopFeedState({ travel_ticks: 0 }), /integer travel >= 1/);
  assert.throws(() => freshMeltshopFeedState({ travel_ticks: 1.5 }), /integer travel >= 1/);
  assert.throws(() => freshMeltshopFeedState(undefined, { rate_tph: 0 }), /rate\/chunk positive/);
});

test('N5 double commissioning idempotent', () => {
  let st = commissionEaf(freshMeltshopFeedState());
  const snap = JSON.stringify(st.registry.inventories);
  st = commissionEaf(st);
  assert.strictEqual(JSON.stringify(st.registry.inventories), snap);
});

test('pure tick: input state never mutated; plan arithmetic matches the belt', () => {
  const st0 = feedDepositScrap(commissionEaf(freshMeltshopFeedState()), 100);
  const before = JSON.stringify(st0);
  stepMeltshopFeed(st0, [{ charge_id: 'C1', scrap_t: 5, dri_t: 0 }]);
  assert.strictEqual(JSON.stringify(st0), before);
  assert.strictEqual(planFeedLoad(100, 9.375, 5), 5);   // scrap edge: rate-capped 5t chunks
  assert.strictEqual(planFeedLoad(100, 25, 25), 25);   // dri edge: 25t chunks
  assert.strictEqual(planFeedLoad(10, 25, 25), 0);     // partial chunk never starts
});
