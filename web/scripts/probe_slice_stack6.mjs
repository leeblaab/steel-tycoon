// Fresh load -> Slice 4 click; hook Array.prototype[Symbol.iterator] via defineProperty on Array.prototype and capture stack at crash.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4187;
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
  window.__crash = null;
  const orig = Array.prototype[Symbol.iterator];
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    get() {
      return function () {
        if (!Array.isArray(this)) {
          let keys = 'n/a';
          try { keys = Object.keys(this).slice(0, 25).join(','); } catch {}
          window.__crash = {
            ctor: String(this?.constructor?.name),
            keys,
            tick: this?.tick,
            stack: new Error('probe').stack,
          };
        }
        return orig.call(this);
      };
    },
  });
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
console.log('before click crash:', JSON.stringify(await page.evaluate(() => window.__crash)));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
const crash = await page.evaluate(() => window.__crash);
if (crash) {
  console.log('CRASH target ctor:', crash.ctor, 'keys:', crash.keys, 'tick:', crash.tick);
  console.log('probe stack:\n' + String(crash.stack).slice(0, 1200));
} else {
  console.log('no iterator crash captured');
}

await browser.close();
server.close();
