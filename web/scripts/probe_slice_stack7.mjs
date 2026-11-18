// Fresh load -> Slice 4 click; instrument the module graph via a wrapper script that imports the real bundle.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4188;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    if (path === '/index.html') {
      let html = await readFile(join(DIST, 'index.html'), 'utf8');
      // replace the real entry script with our wrapper
      html = html.replace(/<script[^>]*src="([^"]*assets\/index[^"]*\.js)"[^>]*><\/script>/, '<script type="module" src="/wrapper.js"></script>');
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
    if (path === '/wrapper.js') {
      const real = (await readFile(join(DIST, 'index.html'), 'utf8')).match(/assets\/index[^"]*\.js/)[0];
      const wrapper = `
import * as bundle from '/${real}';
console.log('WRAPPER moduleExports:', Object.keys(bundle));
window.__bundle_exports = Object.keys(bundle);
// real entry already ran its side effects on import (createRoot render)
`;
      res.writeHead(200, { 'content-type': 'text/javascript' });
      res.end(wrapper);
      return;
    }
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('not found: ' + path);
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 300)));
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 150)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
const exports_ = await page.evaluate(() => window.__bundle_exports);
console.log('bundle exports visible to wrapper:', JSON.stringify(exports_));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(500);
const hud = await page.evaluate(() => document.querySelectorAll('.steelx-stat').length);
console.log('hud rows after click:', hud);

await browser.close();
server.close();
