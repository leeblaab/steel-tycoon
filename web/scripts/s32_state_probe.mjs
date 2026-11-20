// S3.2 state-light probe: rings track live sim tone; deliberate DRP starvation turns
// the DRP ring AMBER (the named gate). Usage: node scripts/s32_state_probe.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s32/';
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
const baseline = await page.evaluate(() => ({ rings: window.__steelxRings, meshes: window.__steelxRig().sceneMeshes }));

// Deliberate DRP starvation: restart slice3's script, run to just before a scripted
// heat_plan tick, empty the DRI buffer (lots + tonnage together, ledger-consistent),
// then step onto the plan tick -> SKIPPED -> starved -> amber ring.
const starve = await page.evaluate(`(() => {
  const S = window.__steelxSession;
  const entry = S.slices.slice3.entry;
  const plan = entry.fixture.scenario.eaf.heat_plan;
  const target = plan[plan.length - 1];
  S.slices.slice3.loop.resume(entry.module.fresh());
  for (let k = 0; k < target - 1; k++) S.slices.slice3.loop.step();
  const s3 = S.stateOf('slice3');
  S.slices.slice3.loop.resume({ ...s3, buffer: [], buffer_t: 0 });
  S.slices.slice3.loop.step();
  const s3b = S.stateOf('slice3');
  const ev = (s3b.events || []).filter((e) => e.tick === s3b.tick).map((e) => e.event || e.kind || JSON.stringify(e).slice(0, 60));
  return { target, tick: s3b.tick, events: ev, tone: S.cardFor('slice3') && S.cardFor('slice3').tone };
})()`);
await page.waitForTimeout(500);
const afterRings = await page.evaluate(() => window.__steelxRings);

// Screenshots: full plant with rings + close-up of the amber DRP.
await page.evaluate(() => { window.__steelxSetTarget(8, 1.5, 2); window.__steelxSetView(0, 42, 30); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's32_plant_rings.png' });
await page.evaluate(() => { window.__steelxSetTarget(-14, 1, 10); window.__steelxSetView(15, 24, 16); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's32_drp_amber.png' });
const rig = await page.evaluate(() => window.__steelxRig());

console.log(JSON.stringify({ baseline, starve, afterRings, drpAmber: afterRings?.drp?.amber === true, sceneMeshes: rig.sceneMeshes, console_errors: errors }, null, 1));
await browser.close();
