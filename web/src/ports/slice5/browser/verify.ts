// Headless verification driver for the Slice 5 browser sim.
// Runs sim.ts exactly as the scene imports it (tsx / vite share the same TS semantics) and
// prints the field-by-field comparison against the fixture's expected_outputs.
// Run: cd web && npx tsx src/ports/slice5/browser/verify.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { runSlice5, SCENARIO, EXPECTED } from './sim.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = resolve(here, '../../../../..', 'fixtures/slice5/s5_billet_rebar_dispatch_orders_seed11_120.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf-8'));

// Guard: the embedded scenario/expected copies must equal the fixture (fixture wins).
const embScenario = SCENARIO as any;
const fxScenario = fixture.scenario;
const embedChecks = [
  ['initial_billet_t', embScenario.billet_yard.initial_billet_t, fxScenario.billet_yard.initial_billet_t],
  ['carrier batch/move', JSON.stringify(embScenario.billet_carrier), JSON.stringify({ batch_t_per_move: fxScenario.billet_carrier.batch_t_per_move, move_ticks: fxScenario.billet_carrier.move_ticks })],
  ['mill', JSON.stringify(embScenario.rebar_mill), JSON.stringify({ batch_t_per_move: fxScenario.rebar_mill.batch_t_per_move, roll_ticks: fxScenario.rebar_mill.roll_ticks, yield_loss_pct: fxScenario.rebar_mill.yield_loss_pct })],
  ['product_yard capacity', embScenario.product_yard.capacity_t, fxScenario.product_yard.capacity_t],
  ['dispatch_crane', JSON.stringify(embScenario.dispatch_crane), JSON.stringify({ batch_t_per_move: fxScenario.dispatch_crane.batch_t_per_move, move_ticks: fxScenario.dispatch_crane.move_ticks })],
  ['orders', JSON.stringify(embScenario.orders.map((o: any) => ({ order_id: o.order_id, required_t: o.required_t, deadline_tick: o.deadline_tick }))),
   JSON.stringify(fxScenario.orders.map((o: any) => ({ order_id: o.order_id, required_t: o.required_t, deadline_tick: o.deadline_tick })))],
  ['competing_task tick', embScenario.competing_task.tick, fxScenario.competing_task.tick],
  ['expected.events.dispatch_move_starts', JSON.stringify(EXPECTED.dispatch_move_starts), JSON.stringify(fixture.expected_outputs.events.dispatch_move_starts)],
  ['expected.counters_at_tick_120', JSON.stringify(Object.entries(EXPECTED.counters_at_tick_120).filter(([k]) => k !== 'revenue_note').map(([k, v]) => [k, v])),
   JSON.stringify(Object.entries(fixture.expected_outputs.counters_at_tick_120).filter(([k]: any) => k !== 'revenue_note').map(([k, v]) => [k, v]))],
];

const result = runSlice5();

console.log('=== embedded-copy guards (fixture vs sim.ts build-time copies) ===');
let embedOk = true;
for (const [name, a, b] of embedChecks) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) embedOk = false;
  console.log(`${ok ? 'MATCH   ' : 'MISMATCH'} embed ${name}: sim=${JSON.stringify(a)} fixture=${JSON.stringify(b)}`);
}

console.log('\n=== sim.ts run vs fixture expected_outputs (field by field) ===');
for (const line of result.verify.lines) console.log(line);

// Balance check faithful to the fixture schema: material_balance.balance_error_at_end (tolerance
// 1e-6) plus the key-tick balance snapshots. [OPEN QUESTION 3 in sim.ts]: a raw per-tick mirror
// dump shows mid-run residuals up to 100 t because billet tonnage leaves the yard at move start
// and enters the identity only on mill delivery; the fixture does not assert a clean per-tick
// residual, so we do not either — we report end + key ticks exactly like the mirror/fixture.
const maxRes = Math.abs(result.state.balance_error);
const keyBal = [43, 72, 120].map((t) => Math.abs(result.records[t - 1].balance_error));
console.log(`balance residual: at tick 120 = ${maxRes}; at key ticks [43,72,120] = ${keyBal.join(', ')} (fixture tolerance ${EXPECTED.tolerance})`);

// negative scenario mode from the fixture (negative_controls.no_billet_stock): run the same tick
// path with initial_billet_t = 0 and assert rolls/dispatch == 0, balance closed.
const origBillet = SCENARIO.billet_yard.initial_billet_t;
SCENARIO.billet_yard.initial_billet_t = 0.0;
const neg = runSlice5();
SCENARIO.billet_yard.initial_billet_t = origBillet;
const c = neg.state.counters;
const negOk = c.rolls_completed === 0 && c.dispatch_moves_completed === 0 && Math.abs(neg.state.balance_error) < 1e-6;
console.log('\n=== negative mode: no_billet_stock (fixture negative_controls.no_billet_stock) ===');
console.log(`${negOk ? 'MATCH   ' : 'MISMATCH'} no_billet: rolls=${c.rolls_completed} dispatch=${c.dispatch_moves_completed} balance=${neg.state.balance_error}`);

const allOk = embedOk && result.verify.ok && maxRes <= EXPECTED.tolerance && negOk;
console.log(`\nOVERALL: ${allOk ? 'ALL MATCH' : 'MISMATCH PRESENT'}`);
if (!allOk) process.exit(1);
