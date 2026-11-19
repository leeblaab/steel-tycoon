// S0.4 perf probe (Playwright): loads the fullplant scene, drives the guided build so all
// slice engines run, then samples renderer.info + fps for the BEFORE baseline / AFTER delta.
// Usage: node scripts/perf_probe.mjs <url> <outfile.json>
// NOTE: hooks.js must be injected as an init script (addInitScript) — it patches the three
// module's createInstance so WebGLRenderer snapshots land on window.__steelxPerf BEFORE
// R3F renders anything; fiber-walking the canvas proved unreliable in R3F v9.
import { chromium } from 'playwright';
import { writeFileSync, readFileSync } from 'node:fs';

const url = process.argv[2] ?? 'http://localhost:5178/';
const out = process.argv[3] ?? 'docs/evidence/s04_perf_before.json';
const hooks = readFileSync(new URL('./perf_hooks.js', import.meta.url), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.addInitScript(hooks);
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(4000); // let GLBs load

// Drive the guided build: dismiss cards + confirm every build step (jetty -> ... -> slice5).
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

// Fast-forward sim: step the plant a lot so engines animate.
const ticks = await page.evaluate(async () => {
  const S = window.__steelxSession;
  if (!S?.onboard.clockRunning) return -1;
  let n = 0;
  try { for (; n < 600; n++) S.stepPlant(); } catch (e) { return `ERR@${n}: ${e.message}`; }
  // park gate: finish quests so all slices commission, then build every remaining step.
  const log2 = [];
  for (let i = 0; i < 80 && S.onboard.index >= 0; i++) {
    const step = S.seqSteps[S.onboard.index];
    if (!step) break;
    if (step.type === 'build') { S.confirmBuild(); log2.push('build:' + step.node_id); }
    else if (step.type === 'park') { S.onboardingComplete(); }
    else S.dismissCard();
    for (let k = 0; k < 10; k++) S.stepPlant(); // keep quests advancing between builds
  }
  return { n, log2 };
});

const stats = await page.evaluate(async () => {
  // GL-level counters from perf_hooks.js (draw calls / triangle estimate per frame).
  const counts = window.__steelxPerf?.counts ?? null;
  const before = counts ? { calls: counts.calls, tris: counts.tris, progs: counts.progs.size } : null;
  // fps + per-frame draw stats: count rAF frames AND GL calls over 2s
  let frames = 0;
  const calls0 = counts ? counts.calls : 0, tris0 = counts ? counts.tris : 0;
  const t0 = performance.now();
  await new Promise((res) => {
    const loop = () => { frames++; if (performance.now() - t0 < 2000) requestAnimationFrame(loop); else res(null); };
    requestAnimationFrame(loop);
  });
  const dt = performance.now() - t0;
  return {
    fps: Math.round((frames / dt) * 1000),
    draw_calls_per_frame: counts ? Math.round(((counts.calls - calls0) / Math.max(frames, 1)) * 10) / 10 : null,
    tris_per_frame: counts ? Math.round((counts.tris - tris0) / Math.max(frames, 1)) : null,
    programs: before?.progs ?? null,
    gl_total_calls: before?.calls ?? null,
  };
});

const download = await page.evaluate(async () => {
  const entries = performance.getEntriesByType('resource');
  let total = 0, glb = 0;
  for (const e of entries) {
    const sz = e.transferSize ?? 0;
    total += sz;
    if (e.name.endsWith('.glb')) glb += sz;
  }
  return { resources_kb: Math.round(total / 1024), glb_kb: Math.round(glb / 1024), count: entries.length };
});

writeFileSync(out, JSON.stringify({ url, built, ticks, ...stats, download, ts: new Date().toISOString() }, null, 2));
const shot = out.replace(/\.json$/, '') + '.png';
await page.screenshot({ path: shot });
console.log(JSON.stringify({ built, ticks, ...stats, download, shot }));
await browser.close();
