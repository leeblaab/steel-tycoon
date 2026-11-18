// Fresh load -> Slice 4 click; wrap Array[Symbol.iterator] via getter, capture target identity.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4191;
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
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 150)));

await page.addInitScript(() => {
  window.__iterbad = [];
  const desc = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    get() {
      return function () {
        if (!Array.isArray(this)) {
          let keys = 'n/a';
          try { keys = Object.keys(this).slice(0, 30).join(','); } catch {}
          window.__iterbad.push({ ctor: String(this?.constructor?.name), keys, tick: this?.tick });
        }
        return desc.value.call(this);
      };
    },
  });
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
console.log('before click iterbad:', JSON.stringify(await page.evaluate(() => window.__iterbad)));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
const bad = await page.evaluate(() => window.__iterbad);
console.log('after click iterbad entries:', bad.length);
for (const e of bad.slice(0, 8)) console.log(JSON.stringify(e));

await browser.close();
server.close();
