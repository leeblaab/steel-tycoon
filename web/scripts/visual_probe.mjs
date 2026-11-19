// S0.4 visual probe (Playwright): drives the guided build to park-complete, fast-forwards
// the sim, then takes ONE screenshot per camera preset so the relight can be judged from
// real pixels (readPixels is black headless — only p.screenshot() captures). Presets use
// the __steelxSetView/__steelxSetTarget hooks. Usage: node scripts/visual_probe.mjs [outprefix]
import { chromium } from 'playwright';

const outPrefix = process.argv[2] ?? 'v_';
// Optional rig-override query (A/B bisect), e.g. node scripts/visual_probe.mjs ab_tone0_ "?tone=0"
const rigQuery = process.argv[3] ?? '';
const url = 'http://localhost:5178/' + rigQuery;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(4000);

// Drive the guided build (same loop as perf_probe.mjs).
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

// Fast-forward sim so engines animate + quests commission slices.
const ticks = await page.evaluate(async () => {
  const S = window.__steelxSession;
  if (!S?.onboard.clockRunning) return -1;
  let n = 0;
  try { for (; n < 600; n++) S.stepPlant(); } catch (e) { return `ERR@${n}: ${e.message}`; }
  for (let i = 0; i < 80 && S.onboard.index >= 0; i++) {
    const step = S.seqSteps[S.onboard.index];
    if (!step) break;
    if (step.type === 'build') { S.confirmBuild(); }
    else if (step.type === 'park') { S.onboardingComplete(); }
    else S.dismissCard();
    for (let k = 0; k < 10; k++) S.stepPlant();
  }
  return n;
});

// Camera presets: [name, azDeg, elDeg, dist, target]
const PRESETS = [
  ['home',       null, null, null, null],                        // untouched home view
  ['sunfront',   -35, 42, 90, [-2, 1.5, 6]],                     // sun front-right of cam: warm rim + long shadows visible
  ['wide_fogtest', 0, 42, 120, [-2, 1.5, 6]],                    // pulled back: fog gradient test
  ['meltshop',   -30, 38, 55, [-6, 1.5, 8]],                     // slice3/4 bend close-in
];

for (const [name, az, el, dist, tgt] of PRESETS) {
  if (az !== null) {
    await page.evaluate(([a, e, d, t]) => {
      window.__steelxSetTarget(...t);
      window.__steelxSetView(a, e, d);
    }, [az, el, dist, tgt]);
  }
  await page.waitForTimeout(2500); // settle camera easing + sim animation
  const shot = `docs/evidence/s04/${outPrefix}${name}.png`;
  await page.screenshot({ path: shot });
  console.log('shot:', shot);
}

console.log(JSON.stringify({ built, ticks }));
await browser.close();
