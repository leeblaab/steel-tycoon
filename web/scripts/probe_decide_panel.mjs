// Step-B browser probe: prove the DecidePanel renders on slice1 with the six verbs,
// a valid decision (stop eaf) mutates state + surfaces the engine message + lands in
// the event log, an invalid decision (start an already-running asset) is rejected with
// its reason, Save carries `decisions` into localStorage under 'steelx-save', reload
// restores the decision log inside the resumed state, and zero console errors.
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

const decideNote = () => page.evaluate(() => document.querySelector('.steelx-decide-note')?.textContent ?? null);
const decideLog = () => page.evaluate(() => {
  const ul = document.querySelector('.steelx-decide-log');
  if (!ul) return null;
  return [...ul.querySelectorAll('li')].map((li) => li.textContent.trim().slice(0, 120));
});

async function pickAsset(value) {
  await page.locator('.steelx-decide-panel select').first().selectOption(value);
}
async function clickBtn(text) {
  await page.locator('.steelx-decide-panel button', { hasText: text }).click();
  await page.waitForTimeout(250);
}

try {
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });

  const s1 = page.getByRole('button', { name: /Slice 1|slice1/i });
  if (await s1.count()) { await s1.first().click(); await page.waitForTimeout(300); }

  // 1. DecidePanel renders with the six action buttons over the declared assets
  out.panel = await page.evaluate(() => {
    const p = document.querySelector('.steelx-decide-panel');
    if (!p) return null;
    const btns = [...p.querySelectorAll('button')].map((b) => b.textContent.trim());
    const opts = [...p.querySelectorAll('select')][0]?.options ?? [];
    return { title: p.querySelector('h3')?.textContent ?? null, buttons: btns, assets: [...opts].map((o) => o.value) };
  });

  // 2. valid decision: stop eaf — engine message + log entry + event log line
  await pickAsset('eaf');
  await clickBtn('Stop');
  out.after_stop = { note: await decideNote(), log: await decideLog() };
  out.event_log_has_stop = await page.evaluate(() => document.body.innerText.includes('decide_stop:eaf'));

  // 3. invalid decision: stop eaf twice — second one rejected with a reason
  await clickBtn('Stop');
  out.after_double_stop = { note: await decideNote(), log: await decideLog() };

  // 4. overtime on eaf target accepted (message names the window)
  await clickBtn('Run overtime');
  out.after_overtime = { note: await decideNote() };

  // 5. Save carries decisions into localStorage under the plain save key
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(300);
  out.saved_decisions = await page.evaluate(() => {
    const raw = localStorage.getItem('steelx-save');
    if (!raw) return null;
    try { return JSON.parse(raw).saves.main.decisions ?? null; } catch { return 'PARSE_FAIL:' + String(raw).slice(0, 40); }
  });

  // 6. reload — decision log restored inside the resumed state (panel shows rows)
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);
  out.after_reload = { log: await decideLog() };

  const hasPanel = !!out.panel && out.panel.buttons.length >= 6;
  const stopOk = (out.after_stop.log ?? []).some((t) => t.includes('stop') && t.includes('eaf')) && !!out.after_stop.note;
  const rejected = !!out.after_double_stop.note && /already/i.test(out.after_double_stop.note);
  const savedOk = Array.isArray(out.saved_decisions) && out.saved_decisions.some((d) => d.verb === 'stop' && d.target === 'eaf')
    && out.saved_decisions.some((d) => d.verb === 'overtime');
  const restored = (out.after_reload.log ?? []).some((t) => t.includes('stop') && t.includes('eaf'));

  out.result = hasPanel && stopOk && rejected && out.event_log_has_stop && savedOk && restored && out.console_errors.length === 0
    ? 'PASS' : 'FAIL';
} catch (e) {
  out.error = String(e).slice(0, 400);
  out.result = 'FAIL';
} finally {
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
  server.close();
}
