// S2.1 EAF hero evidence: full guided build, then framed shots of the new procedural EAF
// in the live meltshop + a plant overview. Usage: node scripts/s21_eaf_shots.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s21/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL0, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(3000);

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

// EAF close-up: world (9, 2) = slice4 zone (14,2) + eaf local (-5,0).
await page.evaluate(() => { window.__steelxSetTarget(9, 1.8, 2); window.__steelxSetView(15, 32, 15); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's21_eaf_hero.png' });
// Meltshop row: feed -> EAF -> LF -> CCM.
await page.evaluate(() => { window.__steelxSetTarget(14, 1.5, 2); window.__steelxSetView(0, 38, 30); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's21_meltshop.png' });
await page.evaluate(() => window.__steelxResetView());
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + 's21_fullplant.png' });

console.log(JSON.stringify({ built, ticks, rig, console_errors: errors }, null, 1));
await browser.close();
