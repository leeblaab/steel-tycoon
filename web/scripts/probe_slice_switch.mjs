// Playwright probe: reproduce the smoke test's slice-switch path — fresh load (no save),
// click "Slice 4", capture any pageerror stack + resulting HUD tick.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4179;
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
await page.addInitScript(() => {
  window.__probeErrs = [];
  window.addEventListener('error', (e) => {
    window.__probeErrs.push({ msg: String(e.message), stack: String(e.error?.stack ?? '').slice(0, 1500) });
  });
});
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// fresh load — no localStorage save at all
const tickBefore = await page.evaluate(() => document.body.innerText.match(/tick\n(\d+)/)?.[1]);
let clickErr = null;
try {
  await page.getByRole('button', { name: /Slice 4/ }).click({ timeout: 5000 });
} catch (e) { clickErr = String(e).slice(0, 200); }
await page.waitForTimeout(600);
const tickAfterSwitch = await page.evaluate(() => document.body.innerText.match(/tick\n(\d+)/)?.[1]);
const errs = await page.evaluate(() => window.__probeErrs);

console.log(JSON.stringify({ tickBefore, clickErr, tickAfterSwitch, errs }, null, 2));
await browser.close();
server.close();
