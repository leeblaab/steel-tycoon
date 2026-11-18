// Static probe: locate the crash site in the built hub bundle precisely.
import { readFileSync, readdirSync } from 'node:fs';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub/assets';
const file = process.argv[2] ?? `${DIST}/index-CXZSDY_6.js`;
const src = readFileSync(file, 'utf8');
const lines = src.split('\n');

// 1) every occurrence of busy_charge_id with its line:col
let occ = [];
for (let i = 0; i < lines.length; i++) {
  let idx = lines[i].indexOf('busy_charge_id');
  while (idx !== -1) {
    occ.push({ line: i + 1, col: idx + 1, ctx: lines[i].slice(Math.max(0, idx - 60), idx + 40) });
    idx = lines[i].indexOf('busy_charge_id', idx + 1);
  }
}
console.log('busy_charge_id occurrences:', occ.length);
for (const o of occ) console.log(`  ${o.line}:${o.col}  …${o.ctx}…`);

// 2) the exact crash coordinate: line 5603 col 27893 (1-based) — show a window
const L = 5603, C = 27893;
if (lines.length >= L) {
  const l = lines[L - 1];
  console.log(`\ncrash window ${L}:${C}:`);
  console.log(JSON.stringify(l.slice(Math.max(0, C - 400), C + 200)));
}

// 3) find the enclosing function name near the crash (search backwards for `function` or `=>`)
const l = lines[L - 1] ?? '';
const before = l.slice(0, C);
const fnMatch = [...before.matchAll(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)];
const lastFn = fnMatch[fnMatch.length - 1];
console.log('\nnearest preceding named function:', lastFn ? lastFn[1] : '(none)');
const arrowStart = before.lastIndexOf('=>');
console.log('nearest preceding => at col', arrowStart);

// 4) list all bundle asset files
console.log('\nassets:', readdirSync(DIST).join(', '));
