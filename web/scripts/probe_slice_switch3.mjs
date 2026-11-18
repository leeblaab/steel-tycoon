// Playwright probe v3: fresh load -> click Slice 4; capture the real pageerror stack and a
// follow-up step+1 (transport-on-old-loop race test). Separate file from probe_slice_switch.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4181;
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
page.on('pageerror', (e) => errs.push(String(e.stack ?? e).slice(0, 1500)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

const tickBefore = await page.evaluate(() => document.body.innerText.match(/tick\n(\d+)/)?.[1]);
await page.getByRole('button', { name: /Slice 4/ }).click();
await page.waitForTimeout(50); // snapshot before React settles
const tickImmediate = await page.evaluate(() => document.body.innerText.match(/tick\n(\d+)/)?.[1] ?? null);
await page.waitForTimeout(800);
const tickSettled = await page.evaluate(() => document.body.innerText.match(/tick\n(\d+)/)?.[1] ?? null);

let stepErr = null;
try {
  await page.getByRole('button', { name: /step \+1/ }).click({ timeout: 4000 });
} catch (e) { stepErr = String(e).slice(0, 150); }
await page.waitForTimeout(300);
const tickAfterStep = await page.evaluate(() => document.body.innerText.match(/tick\n(\d+)/)?.[1] ?? null);

console.log(JSON.stringify({ tickBefore, tickImmediate, tickSettled, stepErr, tickAfterStep, errs }, null, 2));
await browser.close();
server.close();
