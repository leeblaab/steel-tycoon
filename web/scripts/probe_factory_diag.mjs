// Probe v6: R3F interaction diagnostics — is the event target connected, are slot meshes
// in the interaction list, and does a manual raycast at the EAF hit them?
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

out.diag = await page.evaluate(() => ({
  bridge: !!window.__r3f,
  events_connected: window.__r3f_events_connected ?? null,
  interaction_count: typeof window.__r3f_interaction_count === 'function' ? window.__r3f_interaction_count() : null,
}));

// Manual raycast through the live scene with the real camera at the EAF world point.
out.manual_ray = await page.evaluate(() => {
  const st = window.__r3f;
  if (!st) return null;
  let scene = st.camera; while (scene.parent) scene = scene.parent;
  return { has_scene: !!scene, scene_children: scene.children.length };
});

console.log(JSON.stringify({ ...out, errors }, null, 2));
await browser.close();
server.close();
