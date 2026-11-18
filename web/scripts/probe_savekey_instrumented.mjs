// Instrumented probe: wrap localStorage.setItem/removeItem before app scripts run,
// capture every key + stack that touches localStorage. Purpose: locate the source of
// the bogus '***' save-key entry (PHASE2_STEP_STATUS.md flagged bug).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4179;
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

// Instrument BEFORE any app script: record all setItem calls with stack traces.
await page.addInitScript(() => {
  window.__calls = [];
  const origSet = Storage.prototype.setItem;
  const origRemove = Storage.prototype.removeItem;
  Storage.prototype.setItem = function (k, v) {
    window.__calls.push({ op: 'set', key: k, len: String(v).length, stack: new Error().stack });
    return origSet.call(this, k, v);
  };
  Storage.prototype.removeItem = function (k) {
    window.__calls.push({ op: 'remove', key: k, stack: new Error().stack });
    return origRemove.call(this, k);
  };
});

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

  out.calls = await page.evaluate(() => (window.__calls ?? []).map((c) => ({
    op: c.op, key: c.key, len: c.len,
    stack: (c.stack ?? '').split('\n').slice(1, 6).join(' | '),
  })));
  out.localStorage_keys = await page.evaluate(() => {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    return keys.map((k) => ({ key: k, len: (localStorage.getItem(k) ?? '').length }));
  });
  out.named_read = await page.evaluate(() => (localStorage.getItem('steelx-save') ?? '').length);
} catch (e) {
  out.error = String(e).slice(0, 400);
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
