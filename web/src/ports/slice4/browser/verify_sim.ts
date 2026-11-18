// Programmatic verification: TS sim vs fixture expected_outputs (field by field)
// AND TS sim vs the Python mirror run (stdout-parsed), plus balance residuals at
// key ticks 19/30/66 and tick 120. Run with: npx tsx src/ports/slice4/browser/verify_sim.ts
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runSlice4, extractEventTicks, EXPECTED_OUTPUTS, KEY_TICKS, SCENARIO, NEGATIVE_CONTROLS } from './sim.js';

const REPO = process.env.STEELX_REPO ?? 'C:/AI_LAB/SteelX';
const fxPath = `${REPO}/fixtures/slice4/s4_eaf_lrf_ccm_billet_seed11_120.json`;
const fixture = JSON.parse(readFileSync(fxPath, 'utf-8'));
const expected = fixture.expected_outputs;

let failures = 0;
function cmp(path: string, actual: unknown, expctd: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expctd);
  const ok = a === e || (typeof actual === 'number' && typeof expctd === 'number' && Math.abs(actual - expctd) < 1e-9);
  if (!ok) failures++;
  console.log(`${ok ? 'MATCH    ' : 'MISMATCH '} ${path}: ts=${a} expected=${e}`);
}

console.log('=== S4 verification: TS sim vs fixture expected_outputs ===');
const r = runSlice4();
const ev = extractEventTicks(r);
for (const k of Object.keys(expected.events)) {
  cmp(`events.${k}`, (ev as any)[k], (expected.events as any)[k]);
}
for (const tk of Object.keys(expected.key_ticks)) {
  const rec = r.records[Number(tk) - 1];
  cmp(`key_ticks.${tk}.ladles_free`, rec.ladles_free, expected.key_ticks[tk].ladles_free);
  cmp(`key_ticks.${tk}.billet_yard_t`, rec.billet_yard_t, expected.key_ticks[tk].billet_yard_t);
  cmp(`key_ticks.${tk}.balance_error`, rec.balance_error, expected.key_ticks[tk].balance_error);
}
cmp('material_balance.balance_error_at_end', r.balanceErrorEnd, expected.material_balance.balance_error_at_end);
for (const k of Object.keys(expected.counters_at_tick_120)) {
  cmp(`counters_at_tick_120.${k}`, (r.counters as any)[k], (expected.counters_at_tick_120 as any)[k]);
}

console.log('=== balance residual at every tick (max abs) ===');
const maxRes = Math.max(...r.records.map((rec) => Math.abs(rec.balance_error)));
console.log(`max |balance_error| over 120 ticks: ${maxRes} (fixture tolerance ${expected.material_balance.tolerance})`);
if (!(maxRes < expected.material_balance.tolerance)) failures++;

console.log('=== cross-check vs Python mirror run (single source of truth) ===');
const py = execFileSync('python', [`${REPO}/mirror/slice4_mirror.py`], { encoding: 'utf-8' });
console.log(py.trimEnd());
const g = (re: RegExp) => { const m = py.match(re); return m ? Number(m[1]) : NaN; };
cmp('mirror.heats_tapped', r.counters.heats_tapped, g(/heats tapped:\s+(\d+)/));
cmp('mirror.heats_starved', r.counters.heats_starved, g(/starved:\s+(\d+)/));
cmp('mirror.refines_completed', r.counters.refines_completed, g(/refines:\s+(\d+)/));
cmp('mirror.casts_completed', r.counters.casts_completed, g(/casts:\s+(\d+)/));
cmp('mirror.ladle_wait_ticks', r.counters.ladle_wait_ticks, g(/ladle wait ticks:\s+(\d+)/));
cmp('mirror.caster_wait_ticks', r.counters.caster_wait_ticks, g(/caster wait ticks:\s+(\d+)/));
cmp('mirror.energy_kwh_total', r.counters.energy_kwh_total, g(/energy:\s+([\d.]+) kWh/));
cmp('mirror.billet_t_total', Math.round(r.billetYardT * 1000) / 1000, g(/billet yard:\s+([\d.]+) t/));

console.log('=== negative scenario modes (fixture negative_controls) ===');
const n1 = runSlice4({ variant: 'no_charge_delivery' });
const ctl1 = NEGATIVE_CONTROLS[0];
const ok1 = ctl1.assert(n1);
if (!ok1) failures++;
const neg = fixture.negative_controls ?? expected.negative_controls;
console.log(`${ok1 ? 'MATCH    ' : 'MISMATCH '} N1 no_charge_delivery: tapped=${n1.counters.heats_tapped} starved=${n1.counters.heats_starved} balance=${n1.balanceErrorEnd}`);
cmp('N1 fixture heats_tapped', n1.counters.heats_tapped, neg.no_charge_delivery.heats_tapped);
cmp('N1 fixture heats_starved', n1.counters.heats_starved, neg.no_charge_delivery.heats_starved);
const n2 = runSlice4({ variant: 'ladle_never_released' });
const ctl2 = NEGATIVE_CONTROLS[1];
const ok2 = ctl2.assert(n2) && r.counters.casts_completed > 0;
if (!ok2) failures++;
console.log(`${ok2 ? 'MATCH    ' : 'MISMATCH '} N2 ladle_never_released: casts=${n2.counters.casts_completed} ladle_wait=${n2.counters.ladle_wait_ticks} (healthy casts=${r.counters.casts_completed})`);
cmp('N2 fixture casts_completed', n2.counters.casts_completed, neg.ladle_never_released.casts_completed);

console.log(`\nRESULT: ${failures === 0 ? 'ALL MATCH' : failures + ' MISMATCH(ES)'} | win=${r.win}`);
if (failures > 0) process.exitCode = 1;
