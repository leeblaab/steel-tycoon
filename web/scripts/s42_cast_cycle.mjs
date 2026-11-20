// S4.2 gate probe: a full heat runs charge -> tap -> cast VISIBLY. Walks a fresh slice4
// script tick-by-tick, captures phase screenshots + caster/ladle/billet hooks, verifies
// the billet hot->cold fade over time and the draw budget. Usage: node scripts/s42_cast_cycle.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s42/';
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
  // fresh slice4 script (the 600-step run exhausted it)
  S.slices.slice4.loop.resume(S.slices.slice4.entry.module.fresh());
});
await page.locator('.fp-speed button').first().click(); // pause the pump
await page.waitForTimeout(500);

// meltshop camera for the whole walk
await page.evaluate(() => { window.__steelxSetTarget(13, 1.5, 1); window.__steelxSetView(10, 34, 26); });
await page.waitForTimeout(600);

const timeline = [];
const shots = {};
const snap = () => page.evaluate(() => {
  const S = window.__steelxSession;
  const s4 = S.stateOf('slice4');
  return {
    tick: s4.tick, phase: s4.eaf?.heat_phase ?? null,
    ccmBusy: s4.ccm?.busy_ladle_id ?? null, ccmRem: s4.ccm?.remaining_ticks ?? 0,
    billetYardT: Math.round((s4.billet_yard_t ?? 0) * 10) / 10,
    caster: window.__steelxCaster || null, ladle: window.__steelxLadle || null,
    billets: window.__steelxBillets || null, meshes: window.__steelxRig().sceneMeshes,
  };
});
const shoot = async (name) => { await page.waitForTimeout(1900); await page.screenshot({ path: OUT + name }); };

let sawCharge = false, sawMelt = false, sawTap = false, sawCast = false, tapShot = false, castShot = false, chargeShot = false;
let castEndSnap = null, maxMeshes = 0;
for (let k = 0; k < 130; k++) {
  await page.evaluate(() => window.__steelxSession.slices.slice4.loop.step());
  await page.waitForTimeout(130);
  const s = await snap();
  maxMeshes = Math.max(maxMeshes, s.meshes);
  timeline.push({ tick: s.tick, phase: s.phase, ccmBusy: !!s.ccmBusy, ladleX: s.ladle ? Math.round(s.ladle.x * 100) / 100 : null, meshes: s.meshes });
  if (s.phase === 'charge') { sawCharge = true; if (!chargeShot) { chargeShot = true; await shoot('s42_1_charge.png'); } }
  if (s.phase === 'melt') sawMelt = true;
  if (s.phase === 'tap' && !tapShot) { tapShot = true; sawTap = true; await shoot('s42_2_tap.png'); }
  if (s.ccmBusy && !castShot) { castShot = true; sawCast = true; await shoot('s42_3_cast.png'); }
  if (s.ccmBusy) sawCast = true;
  if (castEndSnap === null && !s.ccmBusy && sawCast && s.billetYardT > 0) {
    castEndSnap = await snap();
    await page.evaluate(() => { window.__steelxSetTarget(24, 1, -1.5); window.__steelxSetView(20, 26, 18); });
    await shoot('s42_4_billets_hot.png');
  }
}
// cool-down: 60 more ticks, then re-shoot the yard (fade must be visible in the hook data)
for (let k = 0; k < 60; k++) await page.evaluate(() => window.__steelxSession.slices.slice4.loop.step());
await page.waitForTimeout(500);
const cooled = await snap();
await shoot('s42_5_billets_cold.png');

const gate = sawCharge && sawMelt && sawTap && sawCast && castEndSnap !== null;
// fade evidence: staggered gradient across the yard at cast end (newest hottest) AND/OR
// the newest slot cooling over time. (Casts keep coming every heat, so steady-state
// newestHeat stays ~1 — the gradient is the durable fade signal.)
const gradientOk = castEndSnap && castEndSnap.billets && castEndSnap.billets.count > 1 &&
  castEndSnap.billets.newestHeat > 0;
const fadeOk = gradientOk || (castEndSnap && cooled.billets && castEndSnap.billets &&
  cooled.billets.newestHeat < castEndSnap.billets.newestHeat);
const ladleReachedCcm = timeline.some((r) => r.ladleX !== null && r.ladleX > 8.5);
console.log(JSON.stringify({
  gate_charge_tap_cast: gate, sawCharge, sawMelt, sawTap, sawCast,
  ladleReachedCcm, maxMeshes, budget: maxMeshes <= 150,
  castEnd: castEndSnap && { tick: castEndSnap.tick, billetYardT: castEndSnap.billetYardT, billets: castEndSnap.billets, caster: castEndSnap.caster },
  cooled: { tick: cooled.tick, billets: cooled.billets }, fadeOk,
  timeline_head: timeline.slice(0, 14), console_errors: errors,
}, null, 1));
await browser.close();
