// Fresh load -> Slice 4 click; instrument the module graph via a wrapper that imports real modules and re-mounts.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const SRC = 'C:/AI_LAB/SteelX/web/src';
const PORT = 4189;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.ts': 'text/plain', '.tsx': 'text/plain', '.json': 'application/json' };

// serve the whole web dir so vite-style module imports work? They won't (no transpile).
// Instead: build a small entry with esbuild on the fly using node esbuild from web/node_modules.
import { build } from 'esbuild';

const result = await build({
  stdin: {
    contents: `
import { buildCatalog } from '/C:/AI_LAB/SteelX/web/src/hub/catalog.ts';
import { HubTickLoop } from '/C:/AI_LAB/SteelX/web/src/hub/tickloop.ts';
import { InventoryRegistry } from '/C:/AI_LAB/SteelX/web/src/shared/inventory_registry.ts';
window.__probe = async () => {
  const catalog = buildCatalog();
  const registry = new InventoryRegistry();
  for (const e of catalog) registry.register(e.adapter);
  const e3 = catalog.find((e) => e.id === 'slice3');
  let loop = new HubTickLoop(e3.module, registry);
  const out = { s3keys: Object.keys(loop.state), s3check: registry.check('slice3', loop.state).ok };
  const e4 = catalog.find((e) => e.id === 'slice4');
  loop = new HubTickLoop(e4.module, registry);
  const st = loop.state;
  out.s4keys = Object.keys(st);
  out.s4chargesIsArray = Array.isArray(st.charges);
  out.s4chargesLen = st.charges ? st.charges.length : null;
  out.s4eaf = JSON.stringify(st.eaf);
  try {
    const snap = registry.project('slice4', st);
    out.s4terms = snap.terms.map(t => t.id + '=' + t.value).join(',');
  } catch (err) {
    out.projectErr = String(err);
  }
  return out;
};
`,
    resolveDir: 'C:/AI_LAB/SteelX/web',
    loader: 'tsx',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'browser',
  absPaths: true,
});
const wrapperCode = result.outputFiles[0].text;

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url.split('?')[0];
    if (path === '/') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script type="module" src="/probe.js"></script></body></html>');
      return;
    }
    if (path === '/probe.js') {
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(wrapperCode);
      return;
    }
    res.writeHead(404); res.end('nf');
  } catch {
    res.writeHead(500); res.end('err');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200), '\n', (e.stack ?? '').slice(0, 800)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const out = await page.evaluate(() => window.__probe());
console.log('PROBE RESULT:', JSON.stringify(out, null, 1));

await browser.close();
server.close();
