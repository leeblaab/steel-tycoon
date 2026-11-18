// Fresh load -> Slice 4 click; find the slice4 adapter (whose project crashes) and dump its fx fixture.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4185;
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

// Patch Array.prototype[Symbol.iterator] to catch the non-iterable target at crash time
await page.addInitScript(() => {
  window.__baditer = null;
  const orig = Array.prototype[Symbol.iterator];
  Object.defineProperty(Array.prototype, Symbol.iterator, {
    configurable: true,
    value: function () {
      if (!Array.isArray(this)) {
        window.__baditer = { keys: Object.keys(this).slice(0, 25), tick: this.tick, ctor: this.constructor?.name };
      }
      return orig.call(this);
    },
  });
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const before = await page.evaluate(() => ({ bad: window.__baditer, hudRows: document.querySelectorAll('.steelx-stat').length }));
console.log('before click:', JSON.stringify(before));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
const after = await page.evaluate(() => ({ bad: window.__baditer, hudRows: document.querySelectorAll('.steelx-stat').length }));
console.log('after click:', JSON.stringify(after, null, 1));

// Forensics on the fixture behind the slice4 adapter via React fiber props (catalog buttons carry entry objects)
const fx = await page.evaluate(() => {
  const rootEl = document.getElementById('root');
  const key = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer$'));
  if (!key) return { err: 'no container' };
  let fiber = rootEl[key];
  const seen = new Set();
  const found = [];
  function walk(f, depth) {
    if (!f || depth > 30 || seen.has(f)) return;
    seen.add(f);
    // look for props containing a fixture or catalog entry
    const p = f.memoizedProps;
    if (p && typeof p === 'object') {
      for (const [k, v] of Object.entries(p)) {
        try {
          if (v && typeof v === 'object' && v.scenario) {
            found.push({ prop: k, scenarioKeys: Object.keys(v.scenario).slice(0, 25), ladles: v.scenario.ladles, chargesLen: v.scenario.charge_plan?.length });
          }
        } catch {}
      }
    }
    walk(f.child, depth + 1);
    walk(f.sibling, depth + 1);
  }
  walk(fiber, 0);
  return found.slice(0, 6);
});
console.log('fixtures seen in fiber props:', JSON.stringify(fx, null, 1));

await browser.close();
server.close();
