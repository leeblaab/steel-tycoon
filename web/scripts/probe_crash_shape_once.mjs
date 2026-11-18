// One-shot: patch the slice4 adapter in the live bundle to log the state shape that crashes it.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4177;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    let path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    let body = await readFile(join(DIST, path));
    if (path.endsWith('.js')) {
      // instrument: log state keys right before the slice4 adapter iterates charges
      body = body.toString().replace('for(let e of n.charges)(e.status===`in_furnace`',
        'window.__shape={tick:n.tick,keys:Object.keys(n).join(","),hasCharges:Array.isArray(n.charges)};for(let e of n.charges)(e.status===`in_furnace`');
    }
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
for (let i = 0; i < 30; i++) await page.getByRole('button', { name: /step \+1/ }).click();
await page.getByRole('button', { name: /^Save$/ }).click();
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const shapeBefore = await page.evaluate(() => window.__shape ?? null);
await page.getByRole('button', { name: /Slice 4/ }).click();
await page.waitForTimeout(600);
const shapeAfter = await page.evaluate(() => window.__shape ?? null);
console.log(JSON.stringify({ errs, shapeBefore, shapeAfter }, null, 2));
await browser.close(); server.close();
