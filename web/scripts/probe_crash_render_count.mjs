// One-shot: count slice4-adapter crash attempts + log every state shape seen, to see if
// the projection runs more than once per click and whether a later render fixes it.
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
    let body = await readFile(join(DIST, path));
    if (path.endsWith('.js')) {
      body = body.toString().replace('for(let e of n.charges)(e.status===`in_furnace`',
        'window.__shapes=(window.__shapes||[]);window.__shapes.push(`${n.tick}|${Object.keys(n).slice(0,4).join(",")}`);for(let e of n.charges)(e.status===`in_furnace`');
    }
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
for (let i = 0; i < 30; i++) await page.getByRole('button', { name: /step \+1/ }).click();
await page.getByRole('button', { name: /^Save$/ }).click();
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.evaluate(() => { window.__shapes = []; }); // clear post-reload history
await page.getByRole('button', { name: /Slice 4/ }).click();
await page.waitForTimeout(600);
const shapes = await page.evaluate(() => window.__shapes ?? []);
console.log(JSON.stringify({ crashAttempts: shapes.length, shapes }, null, 2));
await browser.close(); server.close();
