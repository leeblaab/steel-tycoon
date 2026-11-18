// SteelX Phase-1 resume smoke test: seed a save, reload, prove "continued from tick N".
// Run standalone: node scripts/smoke_resume.mjs  (starts its own static server on 4176)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = Number(process.env.PORT ?? 4176); // reuse a server already serving this dist dir; set PORT to spawn own
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
// If something already serves this port (e.g. the session's static server), reuse it.
async function portInUse() {
  try { const r = await fetch(`http://127.0.0.1:${PORT}/`); return r.ok; } catch { return false; }
}
const reuse = await portInUse();
if (!reuse) await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const out = {};
page.on('console', (m) => { if (m.type() === 'error') (out.console_errors ??= []).push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => (out.console_errors ??= []).push(String(e).slice(0, 300)));

try {
  // A: fresh visit -> ticks run -> Save at tick ~30 (transport starts paused; step to advance)
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  out.buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
  for (let i = 0; i < 30; i++) await page.getByRole('button', { name: /step \+1/ }).click(); // deterministic ticks
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(300);
  out.after_save_note = await page.evaluate(() =>
    [...document.querySelectorAll('span')].map((s) => s.textContent).find((t) => t?.includes('saved at tick')) ?? null);

  // B: reload — THE resume test (old bug showed 'new game' at ~78ms after mount effects)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // allow every mount effect to have fired (bug fired at ~78ms)
  const bodyText = await page.evaluate(() => document.body.innerText);
  out.after_reload = {
    has_continued_note: bodyText.includes('continued from tick'),
    has_new_game_note: /new game/.test(bodyText),
    hud_tick: await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.steelx-stat')];
      const r = rows.find((x) => x.querySelector('span')?.textContent === 'tick');
      return r?.querySelector('b')?.textContent ?? null;
    }),
  };

  // C: sanity — slice buttons still rebuild fresh loops (mount effect guard works)
  await page.getByRole('button', { name: /Slice 4/ }).click();
  await page.waitForTimeout(400);
  const bodyText2 = await page.evaluate(() => document.body.innerText);
  out.after_slice_switch = {
    has_new_game_note: /new game/.test(bodyText2),
    hud_tick: await page.evaluate(() => {
      const rows = [...document.querySelectorAll('.steelx-stat')];
      const r = rows.find((x) => x.querySelector('span')?.textContent === 'tick');
      return r?.querySelector('b')?.textContent ?? null;
    }),
  };

  const pass = out.after_save_note !== null
    && out.after_reload.has_continued_note
    && !out.after_reload.has_new_game_note
    && Number(out.after_reload.hud_tick) > 0
    && out.after_slice_switch.has_new_game_note
    && out.after_slice_switch.hud_tick === '0';
  out.result = pass ? 'PASS' : 'FAIL';
} catch (e) {
  out.error = String(e).slice(0, 400);
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  if (!reuse) server.close();
}
