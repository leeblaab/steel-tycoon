// Step-C animation probe v2: hub ticks are slow (140 ms/tick) and slice1's first ship
// arrives at day 24 (~tick 34), so we seed a save whose snapshot already has a berthed
// ship, load it via the Load button (resume path), and prove: hull present + bobbing;
// then New game -> hull gone (fresh state has no ship). Hull presence must track sim
// state ONLY. Zero console errors.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4177;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// Seed a save with a berthed ship: fresh slice1 hub state advanced to just before the
// first arrival (tick 33), then one ship pushed manually — resume path rebuilds from it.
const seedScript = `
import { freshSlice1HubStateV2, advanceSlice1HubStateV2 } from '../src/ports/slice1/slice1_decide.ts';
import { MemorySaveStorage, writeSave } from '../src/shared/save_load.ts';
let st = freshSlice1HubStateV2();
for (let i = 0; i < 33; i++) st = advanceSlice1HubStateV2(st);
st.berth_ships.push({ id: 'S1', on_board_t: 800, wait_days: 1.5 }); // berthed ship in snapshot
const storage = new MemorySaveStorage();
writeSave(storage, 'main', 'slice1', st, null, null, null, st.decisions);
console.log(JSON.stringify(storage.read('steelx-save')));
`;
await writeFile('C:/AI_LAB/SteelX/web/cache/tmp_seed_save.mts', seedScript);
const seedRaw = await new Promise((res, rej) => {
  execFile('npx', ['tsx', 'cache/tmp_seed_save.mts'], { cwd: 'C:/AI_LAB/SteelX/web', shell: true }, (err, out2) => {
    if (err) rej(err); else res(out2.trim());
  });
});
// storage.read returns the stored STRING — unwrap one JSON layer so localStorage gets
// the save-file object itself (what the hub's readSaveFile expects).
const seedJson = typeof JSON.parse(seedRaw) === 'string' ? JSON.parse(seedRaw) : seedRaw;

const browser = await chromium.launch();
const page = await browser.newPage();
const out = { console_errors: [] };
page.on('console', (m) => { if (m.type() === 'error') out.console_errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => out.console_errors.push(String(e).slice(0, 300)));

// Hull detection: walk the R3F scene graph via the debug bridge and count meshes whose
// hull geometry (4.2 x 1.1 x 1.8) is present — that box exists only inside HullAtBerth.
const hullInfo = () => page.evaluate(() => {
  const scene = window.__r3f_scene;
  if (!scene) return null;
  const hulls = [];
  scene.traverse((o) => {
    if (o.isMesh && o.geometry?.parameters && o.geometry.parameters.width === 4.2
        && o.geometry.parameters.height === 1.1 && o.geometry.parameters.depth === 1.8) {
      hulls.push({ parent_y: o.parent?.position?.y ?? null });
    }
  });
  return hulls;
});

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  const s1 = page.getByRole('button', { name: /Slice 1|slice1/i });
  if (await s1.count()) { await s1.first().click(); await page.waitForTimeout(300); }

  // fresh state: no ship -> no hull
  out.hulls_fresh = await hullInfo();

  // seed the save, then click Load — resume path must show the hull
  await page.evaluate((raw) => localStorage.setItem('steelx-save', raw), seedJson);
  await page.getByRole('button', { name: /^Load$/ }).click();
  await page.waitForTimeout(800);
  out.hulls_after_load = await hullInfo();

  // bob: sample parent y twice ~600ms apart while the ship is berthed
  const y1 = (await hullInfo())?.[0]?.parent_y ?? null;
  await page.waitForTimeout(600);
  const y2 = (await hullInfo())?.[0]?.parent_y ?? null;
  out.bob = { y1, y2, moved: y1 !== null && y2 !== null && Math.abs(y1 - y2) > 0.01 };

  // New game: fresh state has no ship -> hull gone
  await page.getByRole('button', { name: /New game/ }).click();
  await page.waitForTimeout(800);
  out.hulls_after_newgame = await hullInfo();

  out.result = out.hulls_fresh?.length === 0 && out.hulls_after_load.length >= 1 && out.bob.moved
    && out.hulls_after_newgame.length === 0 && out.console_errors.length === 0 ? 'PASS' : 'FAIL';
} catch (e) {
  out.error = String(e).slice(0, 400);
  out.result = 'FAIL';
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
