// Probe v2: factory scene interaction — tap machine + ghost meshes in the WebGL canvas.
// Real mouse clicks at viewport points computed from manifest world positions with our own
// camera math (fov 45, pos [cx,46,cz+38], look at [cx,0,cz]); grid-sweep fallback.
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
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const out = {};
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

await page.getByRole('button', { name: /Slice 4/ }).click();
for (let i = 0; i < 15; i++) await page.getByRole('button', { name: /step \+1/ }).click();

const box = await page.evaluate(() => {
  const c = document.querySelector('#factory-scene canvas');
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});
out.canvas_box = box;

const xsAll = layoutRaw.zones.flatMap((zn) => zn.bounds.x);
const zsAll = layoutRaw.zones.flatMap((zn) => zn.bounds.z);
const cx = (Math.min(...xsAll) + Math.max(...xsAll)) / 2;
const cz = (Math.min(...zsAll) + Math.max(...zsAll)) / 2;

function project(x, y, z) {
  const eye = [cx, 46, cz + 38];
  const target = [cx, 0, cz];
  let fwd = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const flen = Math.hypot(...fwd); fwd = fwd.map((v) => v / flen);
  let right = [-fwd[2], 0, fwd[0]]; // cross(fwd, up=(0,1,0))
  const rlen = Math.hypot(...right); if (rlen === 0) return null;
  right = right.map((v) => v / rlen);
  const up = [right[1] * fwd[2] - right[2] * fwd[1], right[2] * fwd[0] - right[0] * fwd[2], right[0] * fwd[1] - right[1] * fwd[0]];
  const rel = [x - eye[0], y - eye[1], z - eye[2]];
  const camX = rel[0] * right[0] + rel[1] * right[1] + rel[2] * right[2];
  const camY = rel[0] * up[0] + rel[1] * up[1] + rel[2] * up[2];
  const camZ = rel[0] * fwd[0] + rel[1] * fwd[1] + rel[2] * fwd[2];
  if (camZ <= 0) return null;
  const fov = 45 * Math.PI / 180;
  const aspect = box.width / box.height;
  const ndcX = (camX / camZ) / (Math.tan(fov / 2) * aspect);
  const ndcY = (camY / camZ) / Math.tan(fov / 2);
  if (Math.abs(ndcX) > 1 || Math.abs(ndcY) > 1) return null;
  return { x: box.left + (ndcX * 0.5 + 0.5) * box.width, y: box.top + (-ndcY * 0.5 + 0.5) * box.height };
}

async function cardText() {
  return page.evaluate(() => document.querySelector('pre')?.textContent ?? null);
}
async function closeCard() {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => /close|✕|×/i.test(x.textContent ?? ''));
    if (b) b.click();
  });
  await page.waitForTimeout(250);
}

async function tapWorld(slot, labelRe) {
  const p = project(slot.position.x, slot.kind === 'machine' ? 1.1 : 0.35, slot.position.z);
  if (p !== null) {
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(400);
    const card = await cardText();
    if (card !== null && labelRe.test(card)) return { slot: slot.id, method: 'projection', card: card.slice(0, 240) };
    if (card !== null) await closeCard();
  }
  for (let fy = 0.15; fy <= 0.9; fy += 0.1) {
    for (let fx = 0.1; fx <= 0.9; fx += 0.1) {
      await page.mouse.click(box.left + fx * box.width, box.top + fy * box.height);
      await page.waitForTimeout(120);
      const card = await cardText();
      if (card !== null && labelRe.test(card)) return { slot: slot.id, method: 'grid', at: [fx, fy], card: card.slice(0, 240) };
      if (card !== null) await closeCard();
    }
  }
  return { slot: slot.id, method: 'none', card: null };
}

const eafSlot = layoutRaw.slots.find((s) => s.inspect_key === 'eaf');
out.tap_eaf = await tapWorld(eafSlot, /EAF|what it is doing/);
await closeCard();
const ghostSlot = layoutRaw.slots.find((s) => s.kind === 'ghost');
out.ghost_id = ghostSlot.id;
out.tap_ghost = await tapWorld(ghostSlot, new RegExp(ghostSlot.id));

// Slice-switch crash guard with the factory mounted: slice5 -> step -> slice3 -> step.
await page.getByRole('button', { name: /Slice 5/ }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /step \+1/ }).click();
await page.getByRole('button', { name: /Slice 3/ }).click();
await page.waitForTimeout(600);
await page.getByRole('button', { name: /step \+1/ }).click();

console.log(JSON.stringify({ ...out, errors }, null, 2));
await browser.close();
server.close();
