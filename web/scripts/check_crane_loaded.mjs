// Quick check: does the built S2 scene actually render the crane GLB at tick 300?
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/cache/slice2_browser_build';
const PORT = 4184;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };

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

const browser = await chromium.launch({ args: ['--use-gl=angle', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage();
try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  const hud0 = await page.evaluate(() => document.body.innerText.slice(0, 60));
  const play = page.getByRole('button', { name: /play/i }).first();
  if (await play.count()) await play.click();
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => document.body.innerText.slice(0, 60));
    if (/tick 300 \/ 300/.test(t)) break;
  }
  const hud = await page.evaluate(() => document.body.innerText.slice(0, 80));
  console.log(JSON.stringify({ hud0, hud }));
} finally {
  await browser.close();
  server.close();
}
