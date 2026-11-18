// Fresh load -> Slice 4 click with a window.onerror hook installed BEFORE any app script.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4183;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    let path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    if (path === '/index.html') {
      let html = await readFile(join(DIST, 'index.html'), 'utf8');
      // inject early diagnostic hook before module scripts
      const hook = `<script>window.__hubdiag=[];window.addEventListener('error',(e)=>{window.__hubdiag.push({msg:String(e.message),stack:(e.error&&e.error.stack)||'(no stack)'});},true);</script>`;
      html = html.replace('<head>', '<head>' + hook);
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(html);
      return;
    }
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
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)));

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

// instrument HubApp-ish state: after mount, log what loop.state looks like right before/after the switch
const pre = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  return btns.map((b) => b.textContent);
});
console.log('buttons:', JSON.stringify(pre));

await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  const b = btns.find((x) => x.textContent?.includes('Slice 4'));
  b?.click();
});
await page.waitForTimeout(600);

const diag = await page.evaluate(() => window.__hubdiag ?? []);
for (const d of diag) {
  console.log('DIAG msg:', d.msg);
  console.log('DIAG stack:\n' + String(d.stack).slice(0, 2500));
}

await browser.close();
server.close();
