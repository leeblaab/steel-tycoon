// Fresh load -> Slice 4 click; capture the state object that reaches the crashing project().
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4184;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/' || req.url.startsWith('/index.html')) {
      let html = await readFile(join(DIST, 'index.html'), 'utf8');
      // instrument the slice4 adapter's project via a Proxy on its module namespace export is not possible;
      // instead wrap InventoryRegistry.prototype.project if exported class... bundle is minified (class p).
      // Simplest: hook window.onerror + JSON dump of localStorage saves.
      const hook = `<script>window.__hubdiag=[];window.addEventListener('error',(e)=>{window.__hubdiag.push({msg:String(e.message)});},true);</script>`;
      html = html.replace('<head>', '<head>' + hook);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    const path = req.url.split('?')[0];
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
page.on('console', (m) => { if (m.type() === 'warn' || m.type() === 'error') console.log('[console]', m.text().slice(0, 300)); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const ls = await page.evaluate(() => ({ keys: Object.keys(localStorage), vals: Object.entries(localStorage).map(([k, v]) => [k, String(v).slice(0, 120)]) }));
console.log('localStorage at fresh load:', JSON.stringify(ls, null, 1));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
const diag = await page.evaluate(() => window.__hubdiag ?? []);
console.log('diag:', JSON.stringify(diag));

// React fiber forensics: find the root fiber and dump HubApp state hooks
const fibers = await page.evaluate(() => {
  const rootEl = document.getElementById('root');
  const key = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer$') || k.startsWith('_reactContainer$'));
  if (!key) return { err: 'no react container key', keys: Object.keys(rootEl).slice(0, 10) };
  let fiber = rootEl[key];
  const out = [];
  const seen = new Set();
  function walk(f, depth) {
    if (!f || depth > 40 || seen.has(f)) return;
    seen.add(f);
    const name = f.type?.name ?? (typeof f.type === 'string' ? f.type : f.tag === 3 ? 'Root' : f.tag === 0 ? 'unknown-fn' : 'tag' + f.tag);
    if (f.memoizedState) {
      let h = f.memoizedState, i = 0;
      while (h && i < 12) {
        let v = h.memoizedState;
        let desc;
        try {
          if (v && typeof v === 'object') {
            if (Array.isArray(v)) desc = `array(${v.length})`;
            else if (v.state && v.log !== undefined) desc = `HUBLOOP keys=${Object.keys(v).join(',')} stateKeys=${v.state && Object.keys(v.state).join(',')}`;
            else desc = `obj{${Object.keys(v).slice(0, 12).join(',')}}`;
          } else if (typeof v === 'function') desc = 'fn';
          else desc = JSON.stringify(v);
        } catch { desc = '(unserializable)'; }
        out.push(`${name} hook${i}: ${desc}`);
        h = h.next; i++;
      }
    }
    walk(f.child, depth + 1);
    if (depth < 6) walk(f.sibling, depth + 1);
  }
  walk(fiber, 0);
  return out.slice(0, 40);
});
console.log('fibers:', JSON.stringify(fibers, null, 1));

await browser.close();
server.close();
