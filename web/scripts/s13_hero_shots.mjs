// S1.3 hero-swap evidence probe: drives the full guided build (same path as perf_probe),
// then captures framed screenshots of the new jetty + DRP heroes in the LIVE fullplant
// scene, plus the visible-mesh count (main-pass draw proxy) and console errors.
// Usage: node scripts/s13_hero_shots.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s13/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL0, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(3000);

// Guided build phase 1 (jetty -> yard -> ore belt), same driver as perf_probe.mjs.
const built = await page.evaluate(async () => {
  const S = window.__steelxSession;
  if (!S) return 'NO_SESSION_HOOK';
  const log = [];
  for (let i = 0; i < 60 && S.onboard.index >= 0; i++) {
    const step = S.seqSteps[S.onboard.index];
    if (!step) break;
    if (step.type === 'build') { S.confirmBuild(); log.push('build:' + step.node_id); }
    else if (step.type === 'park') { if (!S.onboardingComplete()) { await new Promise((r) => setTimeout(r, 50)); continue; } }
    else S.dismissCard();
    await new Promise((r) => setTimeout(r, 50));
  }
  return log;
});
// Fast-forward + finish the chain so every slice commissions.
const ticks = await page.evaluate(async () => {
  const S = window.__steelxSession;
  if (!S?.onboard.clockRunning) return -1;
  let n = 0;
  try { for (; n < 600; n++) S.stepPlant(); } catch (e) { return `ERR@${n}: ${e.message}`; }
  const log2 = [];
  for (let i = 0; i < 80 && S.onboard.index >= 0; i++) {
    const step = S.seqSteps[S.onboard.index];
    if (!step) break;
    if (step.type === 'build') { S.confirmBuild(); log2.push('build:' + step.node_id); }
    else if (step.type === 'park') { S.onboardingComplete(); }
    else S.dismissCard();
    for (let k = 0; k < 10; k++) S.stepPlant();
  }
  return { n, log2 };
});
await page.waitForTimeout(1500);

const rig = await page.evaluate(() => window.__steelxRig());
// Overview (home framing) — whole plant with both new heroes.
await page.evaluate(() => window.__steelxResetView());
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's13_fullplant_after.png' });
// Jetty hero framing: world center ~(-50, -2) = slice1(-40,-2) + berth local(-10, 0).
await page.evaluate(() => { window.__steelxSetTarget(-50, 1.5, -2); window.__steelxSetView(20, 38, 26); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's13_jetty_hero.png' });
// DRP hero framing: world (-14, 10) = slice3(-6,10) + local(-8,0); look up at the shaft.
await page.evaluate(() => { window.__steelxSetTarget(-14, 4, 10); window.__steelxSetView(25, 30, 22); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's13_drp_hero.png' });

console.log(JSON.stringify({ built, ticks, rig, console_errors: errors }, null, 1));
await browser.close();
