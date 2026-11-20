// S3.1 feed-chain probe: gauge scales track the live ledgers, the feed block survives
// autosave -> reload, and the campaign stays ledger-clean. Usage: node scripts/s31_feed_probe.mjs [url]
import { chromium } from 'playwright';

const URL0 = process.argv[2] ?? 'http://127.0.0.1:4210/';
const OUT = 'C:/AI_LAB/SteelX/docs/evidence/s31/';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
await page.goto(URL0, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(2500);

// Full guided build (same driver as perf_probe).
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
await page.locator('.fp-speed button').first().click(); // pause the pump (real UI path)
await page.waitForTimeout(600);

// Gauge tracking: sample scales vs ledger expectations over a few stepped ticks.
const gaugeCheck = await page.evaluate(`(() => new Promise((res) => {
  const S = window.__steelxSession;
  const clamp = (f) => Math.max(0.02, Math.min(1, f));
  const out = [];
  let n = 0;
  const tick = () => {
    const g = window.__steelxGauges || {};
    const s1 = S.stateOf('slice1') || {};
    const s3 = S.stateOf('slice3') || {};
    const cap = (S.slices.slice3.entry || {}).fixture?.scenario?.buffer?.capacity_t ?? 1000;
    const fs = S.feedVisualSnapshot();
    const inv = fs ? fs.state.registry.inventories : {};
    const exp = {
      scrap_bin: clamp((s1.yard_stock_t || 0) / 5000),
      dri_buffer: clamp((s3.buffer_t || 0) / cap),
      eaf_scrap: clamp(((inv.eaf_scrap || {}).usable_t || 0) / 200),
      eaf_dri: clamp(((inv.eaf_dri || {}).usable_t || 0) / 200),
    };
    const row = { tick: S.tick };
    for (const k of Object.keys(exp)) {
      row[k] = g[k] ? Math.round(g[k].scale.y * 1000) / 1000 : null;
      row[k + '_exp'] = Math.round(exp[k] * 1000) / 1000;
    }
    out.push(row);
    n++;
    if (n % 3 === 0) { for (let k = 0; k < 5; k++) S.stepPlant(); }
    if (n < 12) setTimeout(tick, 200); else res(out);
  };
  tick();
}))()`);

// Save/restore round-trip with the feed block.
const before = await page.evaluate(() => {
  const S = window.__steelxSession;
  S.autosave();
  const raw = JSON.parse(localStorage.getItem('steelx-fullplant-save'));
  const blk = raw.saves.main.meltshop_feed;
  return { hasBlock: !!blk, deposits: blk?.deposits_total, consumedScrap: blk?.state?.consumedScrapT, consumedDri: blk?.state?.consumedDriT, regTick: blk?.state?.registry?.tick };
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.locator('.fp-speed button').first().click(); // pause BEFORE the pump advances the restored state
await page.waitForTimeout(2000);
const after = await page.evaluate(() => {
  const S = window.__steelxSession;
  const fs = S.feedVisualSnapshot();
  return { feedRestored: !!fs, deposits: fs?.deposits_total, consumedScrap: fs?.state?.consumedScrapT, consumedDri: fs?.state?.consumedDriT, regTick: fs?.state?.registry?.tick, eafCommissioned: fs?.state?.eafCommissioned };
});

// Screenshots: meltshop row with the feed gauges + raw yard.
await page.evaluate(() => { window.__steelxSetTarget(8, 1.5, 2); window.__steelxSetView(0, 38, 28); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's31_meltshop_feed.png' });
await page.evaluate(() => { window.__steelxSetTarget(-36, 1, -2); window.__steelxSetView(20, 38, 18); });
await page.waitForTimeout(700);
await page.screenshot({ path: OUT + 's31_raw_yard.png' });
const rig = await page.evaluate(() => window.__steelxRig());

const tracked = gaugeCheck.filter((r) => r.scrap_bin !== null);
const match = tracked.length > 0 && tracked.every((r) =>
  Math.abs(r.scrap_bin - r.scrap_bin_exp) < 0.002 && Math.abs(r.dri_buffer - r.dri_buffer_exp) < 0.002 &&
  Math.abs(r.eaf_scrap - r.eaf_scrap_exp) < 0.002 && Math.abs(r.eaf_dri - r.eaf_dri_exp) < 0.002);
const restored = before.hasBlock && after.feedRestored && before.deposits === after.deposits &&
  before.consumedScrap === after.consumedScrap && before.consumedDri === after.consumedDri && before.regTick === after.regTick;
console.log(JSON.stringify({ gaugeSamples: tracked.length, gaugeMatch: match, first: gaugeCheck[0], last: gaugeCheck[gaugeCheck.length - 1], before, after, restored, sceneMeshes: rig.sceneMeshes, console_errors: errors }, null, 1));
await browser.close();
