// Step-A browser probe: prove the RoutePanel renders, a valid connect (cc→billet_yard)
// lands in the list + event log, an invalid connect (bar_mill→billet_yard) surfaces the
// validator's explanation line WITHOUT landing, Save carries `routes` into localStorage
// under 'steelx-save', reload restores connections, and zero console errors.
// Self-contained (own static server on 4179, serving web/src/hub/dist/hub exactly).
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
const out = { console_errors: [] };
page.on('console', (m) => { if (m.type() === 'error') out.console_errors.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => out.console_errors.push(String(e).slice(0, 300)));

const routeList = () => page.evaluate(() => {
  const ul = document.querySelector('.steelx-route-list');
  if (!ul) return null;
  return [...ul.querySelectorAll('li')].map((li) => li.textContent.trim().slice(0, 80));
});
const routeNote = () => page.evaluate(() => document.querySelector('.steelx-route-note')?.textContent ?? null);

async function pick(selectIndex, value) {
  const selects = page.locator('.steelx-route-panel select');
  await selects.nth(selectIndex).selectOption(value);
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

  // slice1 must be focused (event log + Save slot live on the active slice)
  const s1 = page.getByRole('button', { name: /Slice 1|slice1/i });
  if (await s1.count()) { await s1.first().click(); await page.waitForTimeout(300); }

  // 1. RoutePanel renders with from/to selects over the declared node ids
  out.panel = await page.evaluate(() => {
    const p = document.querySelector('.steelx-route-panel');
    if (!p) return null;
    const opts = [...p.querySelectorAll('select')].map((s) => [...s.options].map((o) => o.value));
    return { title: p.querySelector('h3')?.textContent ?? null, options0: opts[0]?.length ?? 0, hasConnectBtn: !!([...p.querySelectorAll('button')].find((b) => b.textContent === 'Connect')) };
  });

  // 2. valid connect: cc → billet_yard lands in list + event log
  await pick(0, 'cc');
  await pick(1, 'billet_yard');
  await page.locator('.steelx-route-panel button', { hasText: 'Connect' }).click();
  await page.waitForTimeout(300);
  out.after_valid_connect = { list: await routeList(), note: await routeNote() };
  out.event_log_has_route = await page.evaluate(() => document.body.innerText.includes('route_connected:cc_to_billet_yard'));

  // 3. invalid connect: bar_mill → billet_yard rejected with explanation, NOT in list
  await pick(0, 'bar_mill');
  await pick(1, 'billet_yard');
  await page.locator('.steelx-route-panel button', { hasText: 'Connect' }).click();
  await page.waitForTimeout(300);
  out.after_invalid_connect = { list: await routeList(), note: await routeNote() };

  // 4. Save carries routes into localStorage under the plain save key
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(300);
  out.saved_routes = await page.evaluate(() => {
    const raw = localStorage.getItem('steelx-save');
    if (!raw) return null;
    return JSON.parse(raw).saves.main.routes ?? null;
  });

  // 5. reload — connections restored, not reset
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  out.after_reload = { list: await routeList() };

  const validLanded = (out.after_valid_connect.list ?? []).some((t) => t.includes('cc → billet_yard'));
  const invalidRejected = !(out.after_invalid_connect.list ?? []).some((t) => t.includes('bar_mill → billet_yard'))
    && !!out.after_invalid_connect.note;
  const savedOk = Array.isArray(out.saved_routes) && out.saved_routes.some((r) => r.from === 'cc' && r.to === 'billet_yard');
  const restored = (out.after_reload.list ?? []).some((t) => t.includes('cc → billet_yard'));

  out.result = out.panel?.hasConnectBtn && validLanded && out.event_log_has_route
    && invalidRejected && savedOk && restored && out.console_errors.length === 0
    ? 'PASS' : 'FAIL';
} catch (e) {
  out.error = String(e).slice(0, 400);
  out.result = 'FAIL';
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
