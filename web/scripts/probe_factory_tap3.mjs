// Probe v3: factory tap — use LabelLayer DOM positions as anchors (same world points the
// overlay projects), then click just BELOW each label to hit the 3D mesh under it.
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
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 400)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 300)}`); });

const out = {};
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Slice 4/ }).click();
for (let i = 0; i < 15; i++) await page.getByRole('button', { name: /step \+1/ }).click();

out.labels = await page.evaluate(() => {
  const wrap = document.querySelector('#factory-labels');
  if (!wrap) return null;
  return [...wrap.children].map((d) => ({ text: d.textContent, left: parseFloat(d.style.left), top: parseFloat(d.style.top) }));
});

const canvasBox = await page.evaluate(() => {
  const c = document.querySelector('#factory-scene canvas');
  const r = c.getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height };
});

async function cardText() {
  return page.evaluate(() => document.querySelector('.steelx-cardpopup')?.textContent ?? null);
}
async function closeCard() {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll('button')].find((x) => x.textContent === 'close');
    if (b) b.click();
  });
  await page.waitForTimeout(200);
}

async function tapNear(labelText, offsets) {
  const label = out.labels.find((l) => l.text.includes(labelText));
  if (!label) return { label: labelText, found: false };
  for (const [dx, dy] of offsets) {
    await page.mouse.click(canvasBox.left + label.left + dx, canvasBox.top + label.top + dy);
    await page.waitForTimeout(300);
    const card = await cardText();
    if (card !== null) return { label: labelText, card: card.slice(0, 260) };
  }
  return { label: labelText, found: true, card: null };
}

out.tap_eaf = await tapNear('s4_eaf_main', [[0, 150], [0, 120], [0, 180], [-20, 150], [20, 150], [0, 90]]);
await closeCard();
out.tap_ccm = await tapNear('s4_ccm', [[0, 150], [0, 120], [0, 180]]);
await closeCard();
out.tap_ghost = await tapNear('(not built)', [[0, 60], [0, 40], [0, 80], [0, 20]]);

console.log(JSON.stringify({ ...out, errors }, null, 2));
await browser.close();
server.close();
