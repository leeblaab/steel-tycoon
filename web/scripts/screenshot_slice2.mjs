// Visual evidence for Phase -1: load the built S2 scene headless, play to tick 300,
// composite WebGL canvas + HUD text into one PNG saved under web/docs/screenshots/.
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/cache/slice2_browser_build';
const PORT = 4183;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png' };

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
const page = await browser.newPage({ viewport: { width: 1400, height: 800 } });
// preserveDrawingBuffer patch BEFORE app loads so canvas.toDataURL() sees the last frame
page.addInitScript(() => {
  const orig = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs, ...rest) {
    if (type === 'webgl' || type === 'webgl2') attrs = { ...(attrs ?? {}), preserveDrawingBuffer: true };
    return orig.call(this, type, attrs, ...rest);
  };
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /play/i }).first().click();
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(500);
    const t = await page.evaluate(() => document.body.innerText);
    if (/tick 300 \/ 300/.test(t)) break;
  }
  // grab the R3F canvas pixels via toDataURL (needs preserveDrawingBuffer OR same-frame read)
  const dataUrl = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    if (!c) return null;
    try { return c.toDataURL('image/png'); } catch { return 'ERR:' + 'tainted'; }
  });
  if (dataUrl && dataUrl.startsWith('data:image/png')) {
    const b64 = dataUrl.split(',')[1];
    await writeFile('C:/AI_LAB/SteelX/web/docs/screenshots/slice2_scene_tick300.png', Buffer.from(b64, 'base64'));
    console.log('SHOT_SAVED canvas-only');
  } else {
    // fallback: full page screenshot (canvas may show blank without preserveDrawingBuffer)
    await page.screenshot({ path: 'C:/AI_LAB/SteelX/web/docs/screenshots/slice2_scene_tick300.png' });
    console.log('SHOT_SAVED full-page fallback', dataUrl ? String(dataUrl).slice(0, 40) : 'no canvas');
  }
  console.log('errors:', errors.length);
} finally {
  await browser.close();
  server.close();
}
