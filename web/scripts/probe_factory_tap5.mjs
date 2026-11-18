// Probe v5: is R3F pointer dispatch alive at all? Dispatch synthetic pointerdown/up on the
// canvas center (EAF sits there) with demand pulses, and also try a slow real mouse move+click.
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

async function cardText() {
  return page.evaluate(() => document.querySelector('.steelx-cardpopup')?.textContent ?? null);
}

// A) synthetic pointer events on canvas center with pulses
out.synthetic = await page.evaluate(async () => {
  const c = document.querySelector('#factory-scene canvas');
  const r = c.getBoundingClientRect();
  const x = r.left + r.width / 2;
  const y = r.top + r.height / 2;
  const opts = { clientX: x, clientY: y, bubbles: true, cancelable: true, pointerId: 1 };
  c.dispatchEvent(new PointerEvent('pointerdown', opts));
  c.dispatchEvent(new PointerEvent('pointerup', opts));
  window.__r3f.invalidate();
  await new Promise((res) => setTimeout(() => { window.__r3f.invalidate(); res(null); }, 300));
  return document.querySelector('.steelx-cardpopup')?.textContent ?? null;
});

// B) real mouse: move slowly over the canvas, then click center
await page.mouse.move(400, 250);
await page.waitForTimeout(100);
await page.evaluate(() => window.__r3f.invalidate());
await page.mouse.move(640, 280, { steps: 10 });
await page.waitForTimeout(100);
await page.evaluate(() => window.__r3f.invalidate());
const box = await page.evaluate(() => { const r = document.querySelector('#factory-scene canvas').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; });
await page.mouse.click(box.left + box.width / 2, box.top + box.height / 2);
await page.evaluate(() => window.__r3f.invalidate());
await page.waitForTimeout(400);
out.real_mouse = await cardText();

console.log(JSON.stringify({ ...out, errors }, null, 2));
await browser.close();
server.close();
