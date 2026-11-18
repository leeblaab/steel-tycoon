// Probe: serve the hub dist exactly (pitfall: must be web/src/hub/dist/hub, not dist/)
// and capture pageerror + body text to diagnose the "[object Object]" JSON.parse crash.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4181;
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
page.on('pageerror', (e) => errors.push(String(e).slice(0, 800)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 400)}`); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
console.log(JSON.stringify({ buttons, errors }, null, 2));

await browser.close();
server.close();
