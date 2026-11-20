// S4.1 caster hero swap probe: new hero present (named pivots/parts), old soup gone,
// draw budget held, screenshots for the sensory gate. Usage: node scripts/s41_ccm_probe.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s41/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL0, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(2500);

await page.evaluate(async () => {
  const S = window.__steelxSession;
  for (let i = 0; i < 60 && S.onboard.index >= 0; i++) {
    const step = S.seqSteps[S.onboard.index];
    if (!step) break;
    if (step.type === 'build') S.confirmBuild();
    else if (step.type === 'park') { if (!S.onboardingComplete()) { await new Promise((r) => setTimeout(r, 50)); continue; } }
    else S.dismissCard();
    await new Promise((r) => setTimeout(r, 50));
  }
  for (let n = 0; n < 600; n++) S.stepPlant();
  for (let i = 0; i < 80 && S.onboard.index >= 0; i++) {
    const step = S.seqSteps[S.onboard.index];
    if (!step) break;
    if (step.type === 'build') S.confirmBuild();
    else if (step.type === 'park') S.onboardingComplete();
    else S.dismissCard();
    for (let k = 0; k < 10; k++) S.stepPlant();
  }
});
await page.locator('.fp-speed button').first().click();
await page.waitForTimeout(600);
const rig = await page.evaluate(() => window.__steelxRig());

// Screenshots: caster close-up + meltshop row.
await page.evaluate(() => { window.__steelxSetTarget(19, 1.5, 2); window.__steelxSetView(25, 26, 18); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's41_caster_hero.png' });
await page.evaluate(() => { window.__steelxSetTarget(12, 1.5, 2); window.__steelxSetView(0, 38, 28); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's41_meltshop_row.png' });

const partsOk = ['pivot_turret', 'pivot_mold', 'turret_load', 'mold_unit', 'torch_head', 'electrodes', 'roof_unit', 'vessel_refractory'].every((k) => rig.heroParts[k]);
console.log(JSON.stringify({ sceneMeshes_idle: rig.sceneMeshes, heroParts: rig.heroParts, partsOk, budget_idle: rig.sceneMeshes <= 150, console_errors: errors }, null, 1));
await browser.close();
