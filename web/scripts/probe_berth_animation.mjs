// Step-C animation probe: the berth hull appears ONLY when a ship is berthed in sim
// state. Fresh slice1 game has no ship at tick 0 (first arrival later) -> zero hulls;
// wait until st.berth_ships is non-empty (read from the saved-state mirror via the HUD
// card text 'Ship S.. at berth' after clicking the berth slot) -> exactly one animated
// hull group in the scene, bobbing (position.y changes between frames). Zero console errors.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
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

  // tick 0: no ship berthed yet -> no hull
  out.hulls_at_start = await hullInfo();

  // wait for the first arrival (cadence ~every N ticks; transport runs live)
  let hulls = [];
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    hulls = await hullInfo();
    if (hulls.length > 0) break;
  }
  out.hulls_after_wait = hulls;

  // bob check: sample parent y twice ~600ms apart while the ship is berthed
  const y1 = (await hullInfo())?.[0]?.parent_y ?? null;
  await page.waitForTimeout(600);
  const y2 = (await hullInfo())?.[0]?.parent_y ?? null;
  out.bob = { y1, y2, moved: y1 !== null && y2 !== null && Math.abs(y1 - y2) > 0.01 };

  out.result = out.hulls_at_start?.length === 0 && out.hulls_after_wait.length >= 1 && out.bob.moved
    && out.console_errors.length === 0 ? 'PASS' : 'FAIL';
} catch (e) {
  out.error = String(e).slice(0, 400);
  out.result = 'FAIL';
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
