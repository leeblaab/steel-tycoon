// Step-2 browser probe: hub serves the Phase-2 build; prove the quest panel renders,
// quests complete from real ticks (Step +1 x30), Save carries quest_progress into
// localStorage, and reload restores it. Self-contained (own static server on 4178).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4178;
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

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

  // 1. quest panel present with Level-1 chain rendered
  out.panel = await page.evaluate(() => {
    const p = document.querySelector('.steelx-quest-panel');
    if (!p) return null;
    return {
      title: p.querySelector('h2')?.textContent ?? null,
      rows: [...p.querySelectorAll('.steelx-quest-row')].map((r) => ({
        status: r.getAttribute('data-status'),
        text: r.textContent.slice(0, 90),
      })),
    };
  });

  // 2. slice1 must be the focused slice for quest tracking; ensure it is selected
  out.buttons = await page.evaluate(() => [...document.querySelectorAll('button')].map((b) => b.textContent));
  const s1 = page.getByRole('button', { name: /Slice 1|slice1/i });
  if (await s1.count()) { await s1.first().click(); await page.waitForTimeout(300); }

  // 3. tick 30 times — q1 should complete from sim state alone
  for (let i = 0; i < 30; i++) await page.getByRole('button', { name: /step \+1/ }).click();
  await page.waitForTimeout(400);
  out.after_30_ticks = await page.evaluate(() => {
    const p = document.querySelector('.steelx-quest-panel');
    return [...p.querySelectorAll('.steelx-quest-row')].map((r) => ({
      status: r.getAttribute('data-status'),
      text: r.textContent.slice(0, 120),
    }));
  });
  out.event_log_has_quest = await page.evaluate(() => document.body.innerText.includes('quest_complete'));

  // 4. Save carries quest_progress into localStorage.
  // FIXED 2026-10-20: the '***' save-key anomaly was a source bug in save_load.ts
  // (SAVE_FILE_KEY literal); name-based read restored here.
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(300);
  out.saved_quest_progress = await page.evaluate(() => {
    // Actual SAVE_FILE_KEY in src/shared/save_load.ts (minified bundle confirms `steelx-save`)
    const key = 'steelx-save';
    const raw = key === null ? null : localStorage.getItem(key);
    if (!raw) return null;
    const s = JSON.parse(raw).saves.main;
    return s.quest_progress ?? null;
  });

  // 5. reload — quest statuses restored, not reset
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  out.after_reload = await page.evaluate(() => {
    const p = document.querySelector('.steelx-quest-panel');
    return [...p.querySelectorAll('.steelx-quest-row')].map((r) => ({
      status: r.getAttribute('data-status'),
      text: r.textContent.slice(0, 90),
    }));
  });

  const q1done = (a) => a?.some((r) => r.status === 'completed' && /First Arrival/i.test(r.text));
  out.result = out.panel && out.panel.rows.length >= 5
    && q1done(out.after_30_ticks) && out.saved_quest_progress?.l1_q1_first_arrival?.status === 'completed'
    && q1done(out.after_reload) && out.console_errors.length === 0
    ? 'PASS' : 'FAIL';
} catch (e) {
  out.error = String(e).slice(0, 400);
  out.result = 'FAIL';
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
