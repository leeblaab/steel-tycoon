// Programmatic fixture comparison for Slice 3 (verification bar item (a)+(b)).
// Run: npx tsx src/ports/slice3/browser/verify_fixtures.ts   (from web/)
// Prints field-by-field MATCH/MISMATCH vs each fixture's expected_outputs + balance residual.

import { runSlice3, compareFixture, balanceResidual, summarize, S3_STARVE_FIXTURE, S3_FILL_FIXTURE } from './sim.js';

let allOk = true;
for (const fx of [S3_STARVE_FIXTURE, S3_FILL_FIXTURE]) {
  const res = runSlice3(fx);
  const checks = compareFixture(res);
  const s = summarize(res);
  console.log(`=== ${fx.fixture_id} ===`);
  for (const c of checks) {
    console.log(`  ${c.field.padEnd(18)} ${c.match ? 'MATCH' : 'MISMATCH'}${c.sim_len !== undefined ? ` (${c.sim_len} ticks)` : ''}`);
    if (!c.match) allOk = false;
  }
  const resid = balanceResidual(res);
  const closes = Math.abs(resid) < 1e-9;
  console.log(`  balance: buffer_end=${res.buffer_end_t.toFixed(4)}t discharged=${res.discharged_t.toFixed(1)}t taken=${res.taken_t.toFixed(1)}t refused=${res.refused_t.toFixed(1)}t residual=${resid.toFixed(6)} ${closes ? 'CLOSED' : 'OPEN'}`);
  if (!closes) allOk = false;
  // heats detail line (mirror-style log)
  for (const [hid, [st, cause]] of Object.entries(s.heats)) {
    console.log(`  heat ${hid}: ${st}${cause ? ` cause=${cause}` : ''}`);
  }
}
console.log(allOk ? 'FIXTURE PARITY: PASS' : 'FIXTURE PARITY: FAIL');
process.exit(allOk ? 0 : 1);
