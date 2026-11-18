// Probe v4: factory tap via DebugBridge — real camera projection + demand-loop pulses.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4182;
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

const layoutRaw = JSON.parse(await readFile('C:/AI_LAB/SteelX/content/layout/factory_layout_v1.json', 'utf8'));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const out = {};
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Slice 4/ }).click();
for (let i = 0; i < 15; i++) await page.getByRole('button', { name: /step \+1/ }).click();

out.debug_bridge = await page.evaluate(() => ({
  present: !!window.__r3f,
  has_invalidate: typeof window.__r3f?.invalidate === 'function',
  cam_pos: window.__r3f ? window.__r3f.camera.position.toArray() : null,
  size: window.__r3f?.size ?? null,
}));

// Project world points in-page with the REAL camera; click canvas-relative coords.
async function tapSlot(slot) {
  const pt = await page.evaluate(({ x, z, kind }) => {
    const st = window.__r3f;
    if (!st) return null;
    const THREE_V = st.camera.position.constructor; // Vector3 constructor
    const v = new THREE_V(x, kind === 'machine' ? 1.1 : 0.35, z);
    v.project(st.camera);
    const c = document.querySelector('#factory-scene canvas');
    const r = c.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, ndc: [v.x, v.y] };
  }, slot);
  if (pt === null) return { slot: slot.id, error: 'no bridge' };
  const canvasBox = await page.evaluate(() => {
    const c = document.querySelector('#factory-scene canvas');
    const r = c.getBoundingClientRect();
    return { left: r.left, top: r.top };
  });
  // Pulse the demand loop so R3F processes events around the click.
  await page.evaluate(() => window.__r3f.invalidate());
  await page.mouse.click(canvasBox.left + pt.x, canvasBox.top + pt.y);
  await page.evaluate(() => { window.__r3f.invalidate(); });
  await page.waitForTimeout(400);
  await page.evaluate(() => { window.__r3f.invalidate(); });
  await page.waitForTimeout(200);
  const card = await page.evaluate(() => document.querySelector('.steelx-cardpopup')?.textContent ?? null);
  return { slot: slot.id, click: [Math.round(pt.x), Math.round(pt.y)], ndc: pt.ndc.map((n) => +n.toFixed(3)), card: card === null ? null : card.slice(0, 260) };
}

async function closeCard() {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'close');
    if (b) b.click();
  });
  await page.waitForTimeout(200);
}

const eafSlot = layoutRaw.slots.find((s) => s.inspect_key === 'eaf');
out.tap_eaf = await tapSlot(eafSlot);
await closeCard();
const ghostSlot = layoutRaw.slots.find((s) => s.kind === 'ghost');
out.ghost_id = ghostSlot.id;
out.tap_ghost = await tapSlot(ghostSlot);

console.log(JSON.stringify({ ...out, errors }, null, 2));
await browser.close();
server.close();
