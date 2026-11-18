// Playwright probe: reload with slice4 save@30, then attempt a step click; capture the full
// error stack + which tick/state produced it. This isolates whether the crash is in the
// resumed-state path (save/load) or elsewhere.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4178;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('nf'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e.stack ?? e).slice(0, 1200)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// seed: step to 30 and save
for (let i = 0; i < 30; i++) await page.getByRole('button', { name: /step \+1/ }).click();
await page.getByRole('button', { name: /^Save$/ }).click();
await page.waitForTimeout(200);

// reload — resume happens here
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const tickAfterReload = await page.evaluate(() => document.body.innerText.match(/tick\n(\d+)/)?.[1]);

let stepErr = null;
try {
  await page.getByRole('button', { name: /step \+1/ }).click({ timeout: 5000 });
} catch (e) { stepErr = String(e).slice(0, 200); }
await page.waitForTimeout(400);

console.log(JSON.stringify({ tickAfterReload, errs, stepErr }, null, 2));
await browser.close();
server.close();
