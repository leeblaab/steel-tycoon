// S1.1 registry-handoff parity test — web/src/shared/registry_handoff.ts against the
// pinned mirror dump (mirror/registry_handoff_mirror.py is the oracle; no RNG, so
// exact-value parity on inventories, in-transit counts, event streams, closure).
// Also pins the six negative behaviors the mirror proves.

import { test } from 'vitest';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import {
  freshRegistryState, registerInventory, deposit, reserve, releaseReserve,
  transfer, registryTick, ledgerClosure, reservationsValid, availableT,
} from '../src/shared/registry_handoff';

const REPO = `${__dirname}/../..`;
const DUMP: any = JSON.parse(
  readFileSync(`${REPO}/web/tests/scratch_registry/mirror_dump.json`, 'utf-8'),
);

function replayPositive() {
  let st = freshRegistryState();
  for (const inv of ['yard_ore', 'belt_buffer', 'drp_intake']) st = registerInventory(st, inv);
  st = deposit(st, 'yard_ore', 1000.0);
  st = reserve(st, 'yard_ore', 400.0, 'belt task #1');
  st = transfer(st, 'yard_ore', 'belt_buffer', 400.0, 3);
  for (let i = 0; i < 6; i++) st = registryTick(st);
  st = transfer(st, 'belt_buffer', 'drp_intake', 400.0, 2);
  for (let i = 0; i < 2; i++) st = registryTick(st);
  return st;
}

test('positive scenario: per-tick inventories and in-transit counts match the mirror', () => {
  let st = freshRegistryState();
  for (const inv of ['yard_ore', 'belt_buffer', 'drp_intake']) st = registerInventory(st, inv);
  st = deposit(st, 'yard_ore', 1000.0);
  st = reserve(st, 'yard_ore', 400.0, 'belt task #1');
  st = transfer(st, 'yard_ore', 'belt_buffer', 400.0, 3);
  const ops = DUMP.positive.ops;
  let k = 0;
  for (let i = 0; i < 6; i++, k++) {
    st = registryTick(st);
    assert.deepEqual(
      { tick: st.tick, in_transit: st.in_transit.length, yard_ore: st.inventories.yard_ore.usable_t, belt_buffer: st.inventories.belt_buffer.usable_t, drp_intake: st.inventories.drp_intake.usable_t },
      ops[k], `tick ${st.tick}`);
  }
  st = transfer(st, 'belt_buffer', 'drp_intake', 400.0, 2);
  for (let i = 0; i < 2; i++, k++) {
    st = registryTick(st);
    assert.deepEqual(
      { tick: st.tick, in_transit: st.in_transit.length, yard_ore: st.inventories.yard_ore.usable_t, belt_buffer: st.inventories.belt_buffer.usable_t, drp_intake: st.inventories.drp_intake.usable_t },
      ops[k], `tick ${st.tick}`);
  }
  assert.equal(st.reserved.yard_ore ?? 0.0, DUMP.positive.final_reserved.yard_ore ?? 0.0);
  const close = ledgerClosure(st, DUMP.positive.initial_deposits);
  assert.ok(close.ok);
  assert.ok(Math.abs(close.total - DUMP.positive.closure_total) < 1e-9);
});

test('positive scenario: event stream matches the mirror exactly', () => {
  const st = replayPositive();
  assert.equal(JSON.stringify(st.events), JSON.stringify(DUMP.positive.events));
});

test('interleaved scenario: two in-flight transfers credit on independent arrival ticks', () => {
  let st = freshRegistryState();
  for (const inv of ['yard', 'buf1', 'buf2']) st = registerInventory(st, inv);
  st = deposit(st, 'yard', 500.0);
  st = transfer(st, 'yard', 'buf1', 200.0, 2);
  st = transfer(st, 'yard', 'buf2', 300.0, 5);
  DUMP.interleaved.ops.forEach((exp: any, i: number) => {
    st = registryTick(st);
    assert.deepEqual(
      { tick: st.tick, in_transit: st.in_transit.length, yard: st.inventories.yard.usable_t, buf1: st.inventories.buf1.usable_t, buf2: st.inventories.buf2.usable_t },
      exp, `tick ${st.tick}`);
  });
  assert.equal(JSON.stringify(st.events), JSON.stringify(DUMP.interleaved.events));
  assert.ok(ledgerClosure(st, DUMP.interleaved.initial_deposits).ok);
});

test('negatives: unknown inventory / short reserve / negative release / from==to / same-tick', () => {
  let st = freshRegistryState();
  st = registerInventory(st, 'a');
  st = deposit(st, 'a', 100.0);

  // unknown transfer target: refused + event + tonnage unchanged
  const before = st.inventories.a.usable_t;
  let n = transfer(st, 'a', 'ghost', 50.0, 2);
  assert.equal(n.events.at(-1)!.event.includes('refused'), true);
  assert.equal(n.inventories.a.usable_t, before);
  assert.equal(n.in_transit.length, 0);

  // short reserve refused, state unchanged
  n = reserve(st, 'a', 500.0, 'too big');
  assert.ok(n.events.at(-1)!.event.includes('reserve refused'));
  assert.equal(availableT(n, 'a'), 100.0);

  // negative release refused (earmark cannot go below zero)
  n = reserve(st, 'a', 30.0, 'task');
  n = releaseReserve(n, 'a', 40.0);
  assert.ok(n.events.at(-1)!.event.includes('release refused'));
  assert.equal(n.reserved.a, 30.0);

  // from == to refused
  n = transfer(st, 'a', 'a', 10.0, 2);
  assert.ok(n.events.at(-1)!.event.includes('from == to'));

  // same-tick teleport is a hard error
  assert.throws(() => transfer(st, 'a', 'b', 10.0, 0), /integer >= 1/);

  // reservations invariant holds after every valid op
  assert.ok(reservationsValid(replayPositive()).ok);
});

test('purity: functions never mutate the caller state (clone-per-call)', () => {
  let st = freshRegistryState();
  st = registerInventory(st, 'a');
  st = registerInventory(st, 'b');
  st = deposit(st, 'a', 100.0);
  const snapshot = JSON.stringify(st);
  transfer(st, 'a', 'b', 50.0, 2);
  registryTick(st);
  reserve(st, 'a', 10.0, 'x');
  assert.equal(JSON.stringify(st), snapshot);
});
