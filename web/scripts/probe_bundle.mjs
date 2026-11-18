// Probe the built hub bundle directly in Chromium: does slice4's tick() work standalone?
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4177;
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
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

const out = await page.evaluate(async () => {
  const assetName = [...document.querySelectorAll('script')].map((s) => s.src).find((s) => s.includes('/assets/'));
  const mod = await import(assetName); // the app bundle re-executes? No — modules cache. Instead fetch source text:
  const src = await (await fetch(assetName)).text();
  return { assetName, moduleExports: Object.keys(mod ?? {}), src_len: src.length };
});
console.log(JSON.stringify(out, null, 2));

await browser.close();
server.close();
