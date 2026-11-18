// Fresh Playwright probe: fresh load -> click Slice 4 -> capture the FULL error stack.
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
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push('[console] ' + m.text().slice(0, 400)); });
page.on('pageerror', (e) => errs.push('[pageerror] ' + String(e).slice(0, 200) + '\nSTACK:\n' + (e.stack ?? '(none)').slice(0, 1500)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
console.log('buttons:', JSON.stringify(buttons));

// click the Slice 4 button (index 3 in the slice bar per earlier probes)
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  const b = btns.find((x) => x.textContent?.includes('Slice 4'));
  b?.click();
});
await page.waitForTimeout(800);

const hud = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.steelx-stat')];
  return rows.map((r) => `${r.querySelector('span')?.textContent}=${r.querySelector('b')?.textContent}`).slice(0, 12);
});
console.log('hud after slice4 click:', JSON.stringify(hud));
console.log('errors:', errs.length ? errs.join('\n---\n') : '(none)');

await browser.close();
server.close();
