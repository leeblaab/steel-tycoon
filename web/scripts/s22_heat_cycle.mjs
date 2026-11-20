// S2.2 heat-cycle probe: steps the LIVE plant tick-by-tick through one EAF heat and
// samples the animation rig (__steelxEaf) at each phase — roof swing on charge, bore on
// melt, heavy tilt + stream on tap, ladle glow + travel after the tap event. Screenshots
// at charge (roof open) and tap (stream). Trust the per-phase timeline print.
// Usage: node scripts/s22_heat_cycle.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s22/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL0, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(3000);

// Full guided build + commissioning (same driver as perf_probe).
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
// Restart slice4's scripted scenario: the 120-tick fixture holds only 5 heats and the
// build driver's pre-roll consumes them all. resume(fresh) is the existing test seam.
await page.evaluate(() => {
  const S = window.__steelxSession;
  const rt = S.slices.slice4;
  rt.loop.resume(rt.entry.module.fresh());
});
// Stop the HUD pump via the REAL UI path (setSpeed re-renders -> effect clears the
// interval; assigning session.speed directly would leave the pump running).
await page.locator('.fp-speed button').first().click();
// Frame the EAF: world (9, 2) = slice4 zone (14,2) + local (-5,0).
await page.evaluate(() => { window.__steelxSetTarget(9, 1.6, 2); window.__steelxSetView(18, 28, 13); });
await page.waitForTimeout(800);

// Walk tick-by-tick until a fresh heat starts, then follow it through all four phases.
const timeline = await page.evaluate(`(() => new Promise(async (res) => {
  const S = window.__steelxSession;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const snap = (label) => {
    const e = window.__steelxEaf || {};
    return { label, phase: e.phase, progress: Math.round((e.progress || 0) * 100) / 100,
      roofDeg: Math.round(e.roofDeg || 0), tiltDeg: Math.round((e.tiltDeg || 0) * 10) / 10,
      bore: Math.round((e.disp ? e.disp.bore : 0) * 100) / 100,
      ladleX: Math.round((e.disp ? e.disp.ladleX : 0) * 100) / 100,
      glow: Math.round((e.disp ? e.disp.glow : 0) * 100) / 100, stream: !!e.stream };
  };
  const out = [];
  // find the next heat start (phase becomes charge)
  let guard = 0;
  while (guard++ < 300) {
    S.stepPlant();
    const ph = (S.stateOf('slice4') || {}).eaf || {};
    if (ph.heat_phase === 'charge' && ph.phase_progress === 0) break;
  }
  await wait(700); out.push(snap('charge-start'));
  S.stepPlant(); // advance within charge (paused frac=1 holds end-of-tick pose)
  await wait(900); out.push(snap('charge-mid'));
  // walk to melt
  guard = 0;
  while (guard++ < 30) { S.stepPlant(); const ph = (S.stateOf('slice4') || {}).eaf || {}; if (ph.heat_phase === 'melt') break; }
  await wait(900); out.push(snap('melt'));
  // walk to refine
  guard = 0;
  while (guard++ < 30) { S.stepPlant(); const ph = (S.stateOf('slice4') || {}).eaf || {}; if (ph.heat_phase === 'refine') break; }
  await wait(500); out.push(snap('refine'));
  // walk to tap, let the heavy tilt develop
  guard = 0;
  while (guard++ < 30) { S.stepPlant(); const ph = (S.stateOf('slice4') || {}).eaf || {}; if (ph.heat_phase === 'tap') break; }
  await wait(1600); out.push(snap('tap'));
  // past the tap event: ladle carries metal -> travels to LF glowing
  guard = 0;
  while (guard++ < 30) { S.stepPlant(); const ph = (S.stateOf('slice4') || {}).eaf || {}; if (!ph.heat_phase) break; }
  await wait(1200); out.push(snap('post-tap-1'));
  await wait(1500); out.push(snap('post-tap-2'));
  res(out);
}))()`);

// Re-run one heat for the screenshots (deterministic sim -> same phases).
await page.evaluate(`(() => new Promise(async (res) => {
  const S = window.__steelxSession;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let guard = 0;
  while (guard++ < 300) { S.stepPlant(); const ph = (S.stateOf('slice4') || {}).eaf || {}; if (ph.heat_phase === 'charge' && ph.phase_progress === 0) break; }
  S.stepPlant(); // roof fully open (charge tick 2 + paused frac)
  await wait(1100); res(null);
}))()`);
await page.screenshot({ path: OUT + 's22_charge_roof_open.png' });
await page.evaluate(`(() => new Promise(async (res) => {
  const S = window.__steelxSession;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let guard = 0;
  while (guard++ < 40) { S.stepPlant(); const ph = (S.stateOf('slice4') || {}).eaf || {}; if (ph.heat_phase === 'tap') break; }
  await wait(1700); res(null);
}))()`);
await page.screenshot({ path: OUT + 's22_tap_stream.png' });
const rig = await page.evaluate(() => window.__steelxRig());
console.log(JSON.stringify({ timeline, rig: { sceneMeshes: rig.sceneMeshes }, console_errors: errors }, null, 1));
await browser.close();
