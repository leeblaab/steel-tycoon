// Fresh load -> Slice 4 click with a deep fiber walk: find the HubApp fiber and dump its hooks BEFORE/AT crash via MutationObserver? Simpler: walk fibers after crash (tree may be partially there).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4192;
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

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// Walk the fiber tree from root BEFORE clicking to learn structure
const dump = (label) => page.evaluate((lbl) => {
  const rootEl = document.getElementById('root');
  const key = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer$') || k.startsWith('__reactFiber$'));
  if (!key) return { err: 'no react key on #root', keys: Object.keys(rootEl) };
  let fiber = rootEl[key];
  const out = [];
  const seen = new Set();
  function walk(f, depth) {
    if (!f || depth > 60 || seen.has(f)) return;
    seen.add(f);
    const name = f.type?.name ?? (typeof f.type === 'string' ? `tag:${f.type}` : `tag${f.tag}:${f.elementType?.name ?? '?'}`);
    let h = f.memoizedState, i = 0;
    while (h && i < 15) {
      let v = h.memoizedState;
      let desc;
      try {
        if (v && typeof v === 'object') {
          if (Array.isArray(v)) desc = `arr(${v.length})`;
          else if ('run' in v || ('state' in v && 'log' in v)) desc = `HUBLOOP stateKeys=${v.state ? Object.keys(v.state).join(',') : '?'} modId=${v.mod?.id}`;
          else desc = `obj{${Object.keys(v).slice(0, 15).join(',')}}`;
        } else if (typeof v === 'function') desc = 'fn';
        else desc = JSON.stringify(v);
      } catch { desc = '(unser)'; }
      out.push(`${lbl} ${name} h${i}: ${desc}`);
      h = h.next; i++;
    }
    walk(f.child, depth + 1);
    if (depth < 8) walk(f.sibling, depth + 1);
  }
  walk(fiber, 0);
  return out.slice(0, 60);
}, label);

console.log('BEFORE click:', JSON.stringify(await dump('PRE'), null, 1));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
console.log('AFTER click:', JSON.stringify(await dump('POST'), null, 1));

await browser.close();
server.close();
