// One-shot: instrument the bundle to capture a JS stack trace at every slice4-adapter
// project() call, so we can see WHICH React render path feeds it a slice3-shaped state.
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
    let body = await readFile(join(DIST, path));
    if (path.endsWith('.js')) {
      const needle = 'for(let e of n.charges)';
      console.error('needle present:', body.toString().includes(needle));
      body = body.toString().replace(needle,
        'window.__traces=(window.__traces||[]);if(!Array.isArray(n.charges))window.__traces.push(new Error("shape="+n.tick+"|"+Object.keys(n).join(",")).stack);for(let e of n.charges)');
    }
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 80)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
for (let i = 0; i < 30; i++) await page.getByRole('button', { name: /step \+1/ }).click();
await page.getByRole('button', { name: /^Save$/ }).click();
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const reloadTraces = await page.evaluate(() => window.__traces ?? []);
await page.evaluate(() => { window.__traces = []; });
await page.getByRole('button', { name: /Slice 4/ }).click();
await page.waitForTimeout(600);
const clickTraces = await page.evaluate(() => window.__traces ?? []);
console.log(JSON.stringify({ errs, reloadTraceCount: reloadTraces.length, clickTraces }, null, 2));
await browser.close(); server.close();
