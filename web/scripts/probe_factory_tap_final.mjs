// Final tap verification v2: click the EAF machine at its top cap (y=2.2) — the mesh center
// projects onto a DOM label strip whose wide text occludes the center from hit-testing.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4196;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const out = {};
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Slice 4/ }).click();
for (let i = 0; i < 15; i++) await page.getByRole('button', { name: /step \+1/ }).click();

// Project a world point to viewport px via the live camera.
const projectWorld = async (x, y, z) => page.evaluate(([x, y, z]) => {
  const st = window.__r3f;
  const V3 = st.camera.position.constructor;
  const v = new V3(x, y, z).project(st.camera);
  const c = document.querySelector('#factory-scene canvas');
  const r = c.getBoundingClientRect();
  return { left: r.left + (v.x * 0.5 + 0.5) * r.width, top: r.top + (-v.y * 0.5 + 0.5) * r.height };
}, [x, y, z]);

const clickWorld = async (x, y, z, label) => {
  const pt = await projectWorld(x, y, z);
  await page.mouse.click(pt.left, pt.top);
  await page.evaluate(() => window.__r3f.invalidate());
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => document.querySelector('.steelx-cardpopup')?.textContent ?? null);
  await page.evaluate(() => document.querySelector('.steelx-cardpopup button')?.click());
  await page.waitForTimeout(200);
  return { [label]: card, closed: await page.evaluate(() => document.querySelector('.steelx-cardpopup') === null) };
};

// s4_eaf_main top cap (y=2.2): above the occluding label strip.
out.eaf_card = await clickWorld(50, 2.2, 8, 's4_eaf_main');
// ghost preview card
out.ghost_card = await clickWorld(14, 0.35, 8, 's1_scrap_yard');

console.log(JSON.stringify({ ...out, errors }, null, 2));
await browser.close();
server.close();
