// Probe v7: raycast the EAF slot via the live scene to verify world->screen mapping, then
// click exactly at the projected hit point with demand pulses.
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

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const out = {};
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Slice 4/ }).click();
for (let i = 0; i < 15; i++) await page.getByRole('button', { name: /step \+1/ }).click();

out.diag = await page.evaluate(() => ({ interaction_count: window.__r3f_interaction_count() }));

// Find the EAF mesh in the live scene (box 3x2.2x3 at y=1.1), project its center to canvas px.
const hit = await page.evaluate(() => {
  const st = window.__r3f;
  let scene = st.camera; while (scene.parent) scene = scene.parent;
  const meshes = [];
  scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const eaf = meshes.find((m) => m.geometry?.type === 'BoxGeometry' && Math.abs(m.position.y - 1.1) < 0.01 && Math.abs(m.geometry.parameters.height - 2.2) < 0.01);
  if (!eaf) return { error: 'no EAF mesh', mesh_count: meshes.length, boxes: meshes.filter((m) => m.geometry?.type === 'BoxGeometry').map((m) => ({ pos: m.position.toArray(), params: m.geometry.parameters })) };
  const V3 = st.camera.position.constructor;
  const p = new V3(eaf.position.x, eaf.position.y, eaf.position.z);
  p.project(st.camera);
  const c = document.querySelector('#factory-scene canvas');
  const r = c.getBoundingClientRect();
  return {
    mesh_pos: eaf.position.toArray(),
    ndc: [+p.x.toFixed(3), +p.y.toFixed(3)],
    canvas_px: [(p.x * 0.5 + 0.5) * r.width, (-p.y * 0.5 + 0.5) * r.height],
    canvas_box: { left: r.left, top: r.top, width: r.width, height: r.height },
  };
});
out.eaf = hit;

if (hit.canvas_px) {
  await page.mouse.click(hit.canvas_box.left + hit.canvas_px[0], hit.canvas_box.top + hit.canvas_px[1]);
  await page.evaluate(() => window.__r3f.invalidate());
  await page.waitForTimeout(400);
  out.card_after_click = await page.evaluate(() => document.querySelector('.steelx-cardpopup')?.textContent ?? null);
}

console.log(JSON.stringify({ ...out, errors }, null, 2));
await browser.close();
server.close();
