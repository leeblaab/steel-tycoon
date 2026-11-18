
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4186;
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

await page.addInitScript(() => {
  window.__iterlog = [];
  const orig = Array.prototype[Symbol.iterator];
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    value: function () {
      if (!Array.isArray(this)) {
        let keys = 'n/a';
        try { keys = Object.keys(this).slice(0, 20).join(','); } catch {}
        window.__iterlog.push({ ctor: String(this?.constructor?.name), keys, tick: this?.tick });
      }
      return orig.call(this);
    },
  });
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
console.log('before click iterlog:', JSON.stringify(await page.evaluate(() => window.__iterlog)));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
const log = await page.evaluate(() => window.__iterlog);
console.log('after click iterlog entries:', log.length);
for (const e of log.slice(0, 8)) console.log(JSON.stringify(e));

await browser.close();
server.close();
