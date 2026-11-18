// Reproduction probe: load the shipped dist bundle with SAVE_FILE_KEY patched to a
// sentinel value; if the '***' literal disappears from localStorage, it is a constant
// inlined from source (not a runtime clobber). Read-only against the real build.
import http from 'node:http';
import { readFile, writeFile, cp } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const SRC_DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PATCHED_DIST = 'C:/AI_LAB/SteelX/web/cache/probe_patched_dist';
const PORT = 4180;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

// Copy dist and patch the inlined constant to a sentinel.
await cp(SRC_DIST, PATCHED_DIST, { recursive: true });
const JS = 'assets/index-BfBJHgi5.js';
let js = await readFile(join(PATCHED_DIST, JS), 'utf8');
const before = js;
js = js.replaceAll('read(`***`)', 'read(`SENTINEL_READ`)').replaceAll('write(`***`,', 'write(`SENTINEL_WRITE`,');
if (js === before) { console.log(JSON.stringify({ error: 'no *** call sites found in bundle' })); process.exit(1); }
await writeFile(join(PATCHED_DIST, JS), js);

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const body = await readFile(join(PATCHED_DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const out = { console_errors: [] };
page.on('console', (m) => { if (m.type() === 'error') out.console_errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => out.console_errors.push(String(e).slice(0, 300)));

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  const s1 = page.getByRole('button', { name: /Slice 1|slice1/i });
  if (await s1.count()) { await s1.first().click(); await page.waitForTimeout(300); }
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: /step \+1/ }).click();
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(400);
  out.localStorage_keys = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return keys.map((k) => ({ key: k, len: (localStorage.getItem(k) ?? '').length }));
  });
} catch (e) {
  out.error = String(e).slice(0, 400);
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
