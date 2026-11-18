// Fresh load -> Slice 4 click; monkey-patch every adapter's project to log the state it receives.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4190;
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
  // Wrap for..of iteration failures: catch TypeError from any for-of over a non-array.
  window.__projlog = [];
  const origDefine = Object.defineProperty;
  // Hook JSON-free: intercept the slice4 adapter's project by wrapping every function defined in the bundle? Not possible.
  // Instead: wrap Array.prototype[Symbol.iterator] getter (defineProperty on prototype) to capture a stack when called on non-array.
  const desc = Object.getOwnPropertyDescriptor(Array.prototype, Symbol.iterator);
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    get() {
      return function () {
        if (!Array.isArray(this)) {
          let keys = 'n/a';
          try { keys = Object.keys(this).slice(0, 25).join(','); } catch {}
          window.__projlog.push({ ctor: String(this?.constructor?.name), keys, tick: this?.tick, stack: new Error('iter').stack });
        }
        return desc.value.call(this);
      };
    },
  });
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
console.log('before click projlog:', JSON.stringify(await page.evaluate(() => window.__projlog.map(e => ({ ctor: e.ctor, keys: e.keys })) )));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
const projlog = await page.evaluate(() => window.__projlog);
console.log('after click projlog entries:', projlog.length);
for (const e of projlog.slice(0, 6)) {
  console.log('target ctor:', e.ctor, 'keys:', e.keys, 'tick:', e.tick);
  console.log('stack:\n' + String(e.stack).slice(0, 900));
}

await browser.close();
server.close();
