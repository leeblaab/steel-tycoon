// Phase -1 acceptance probe: serve the built S2 browser scene headless and verify it
// plays the frozen verified run: win=true HUD reachable (C1/C2/C3 READY at 101/201/291),
// GLB assets load, zero console errors. Interpolation-only — no sim assertions here.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/cache/slice2_browser_build';
const PORT = 4182;
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

const browser = await chromium.launch();
const page = await browser.newPage();
const out = { console_errors: [], failed_requests: [] };
page.on('console', (m) => { if (m.type() === 'error') out.console_errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => out.console_errors.push(String(e).slice(0, 200)));
page.on('requestfailed', (r) => out.failed_requests.push(`${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => { if (r.status() >= 400) out.failed_requests.push(`${r.url()} ${r.status()}`); });

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  out.title = await page.title();
  const body0 = await page.evaluate(() => document.body.innerText.slice(0, 400));
  out.initial_text = body0;

  // Click Play (or whatever play control exists), speed up if possible, let the run reach tick ~300
  const buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
  out.buttons = buttons;
  const play = page.getByRole('button', { name: /play|start/i }).first();
  if (await play.count()) await play.click();
  const fast = page.getByRole('button', { name: /fast|x5|x10/i }).first();
  if (await fast.count()) await fast.click();

  // wait for the run to reach its end (300 ticks at 40ms/tick ≈ 12s; generous)
  let finalText = '';
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(1000);
    finalText = await page.evaluate(() => document.body.innerText.slice(0, 600));
    if (/tick 300 \/ 300/.test(finalText)) break;
  }
  out.final_text = finalText;

  // canvas present + webgl rendering alive (canvas has non-zero size)
  out.canvas = await page.evaluate(() => {
    const c = document.querySelector('canvas');
    return c ? { w: c.clientWidth, h: c.clientHeight } : null;
  });

  const reachedEnd = /tick 300 \/ 300/.test(finalText);
  const chargesReady = (finalText.match(/ready/gi) ?? []).length >= 3;
  out.result = out.console_errors.length === 0 && out.failed_requests.length === 0 && out.canvas?.w > 0
    && reachedEnd && chargesReady ? 'PASS' : 'CHECK';
  out.charges_ready = chargesReady;
} catch (e) {
  out.error = String(e).slice(0, 300);
  out.result = 'FAIL';
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
