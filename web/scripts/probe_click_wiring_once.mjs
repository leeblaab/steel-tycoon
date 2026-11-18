// One-shot: patch main.tsx render in the live bundle to log (sliceId, loop mod id, state keys)
// on every HubApp render, then click Slice 4 after reload-resume.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';
const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4180;
const MIME = { '.html': 'text/html', '.js': 'text/javascript' };
const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    let body = await readFile(join(DIST, path));
    if (path.endsWith('.js')) {
      const needle = 'let x=d.state';
      console.error('needle present:', body.toString().includes(needle));
      body = body.toString().replace(needle,
        'window.__renders=(window.__renders||[]);window.__renders.push(`${c}|${d.mod.id}|${Object.keys(d.state).slice(0,3).join(",")}`);let x=d.state');
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
const reloadRenders = await page.evaluate(() => window.__renders ?? []);
await page.evaluate(() => { window.__renders = []; });
await page.getByRole('button', { name: /Slice 4/ }).click();
await page.waitForTimeout(600);
const clickRenders = await page.evaluate(() => window.__renders ?? []);
console.log(JSON.stringify({ errs, reloadRenders, clickRenders }, null, 2));
await browser.close(); server.close();
