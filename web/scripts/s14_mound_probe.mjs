// S1.4 mound-fill probe: the ore mound's live scale must equal yardMoundView(ledger)
// on every sampled frame while the plant ticks. The mound is the ONLY three
// ConeGeometry in the fullplant scene (DRP cones live inside the GLB as BufferGeometry),
// so geometry-type identification needs no minified-name hooks.
// Usage: node scripts/s14_mound_probe.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s14/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL0, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(2500);

// Build through step 4 (jetty -> scrap_yard -> conv_ore_drp) so the yard + belt exist.
const built = await page.evaluate(async () => {
  const S = window.__steelxSession;
  const log = [];
  for (let i = 0; i < 20 && S.onboard.index >= 0; i++) {
    const step = S.seqSteps[S.onboard.index];
    if (!step) break;
    if (step.type === 'build') { S.confirmBuild(); log.push(step.node_id); if (step.node_id === 'conv_ore_drp') break; }
    else S.dismissCard();
    await new Promise((r) => setTimeout(r, 60));
  }
  return log;
});

// Sample mound scale vs ledger expectation over ~6s while stepping the plant.
const samples = await page.evaluate(`(() => new Promise((res) => {
  const out = [];
  const S = window.__steelxSession;
  let n = 0;
  const tick = () => {
    const mound = window.__steelxMound || null;
    const snap = S.beltVisualSnapshot();
    const yard = snap ? (snap.state.registry.inventories['yard_ore'] || {}).usable_t || 0 : 0;
    const frac = Math.max(0, Math.min(1, yard / 5000));
    const expH = 0.25 + frac * 2.15;
    out.push({
      yard_t: Math.round(yard * 10) / 10,
      scale_y: mound ? Math.round(mound.scale.y * 1000) / 1000 : null,
      expected_y: Math.round(expH * 1000) / 1000,
      scale_x: mound ? Math.round(mound.scale.x * 1000) / 1000 : null,
    });
    n++;
    if (n % 4 === 0) { for (let k = 0; k < 5; k++) S.stepPlant(); }
    if (n < 24) setTimeout(tick, 250); else res(out);
  };
  tick();
}))()`);

// Yard framing shot: world (-36, -2) = slice1(-40,-2) + yard local (4,0).
await page.evaluate(() => { window.__steelxSetTarget(-36, 1, -2); window.__steelxSetView(20, 38, 18); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's14_ore_mound.png' });
await page.evaluate(() => window.__steelxResetView());
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + 's14_fullplant.png' });

const tracked = samples.filter((s) => s.scale_y !== null);
const ok = tracked.length > 0 && tracked.every((s) => Math.abs(s.scale_y - s.expected_y) < 0.002);
console.log(JSON.stringify({ built, samples: tracked.length, match: ok, first: samples.slice(0, 3), last: samples.slice(-3), console_errors: errors }, null, 1));
await browser.close();
