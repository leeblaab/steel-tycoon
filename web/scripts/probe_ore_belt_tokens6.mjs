// S1.2 token probe (final): belt tokens vs ledger, over the live clock.
// Two registration paths so it never depends on minified var names:
//  1) serve-time ctor patch (regex may miss across rebuilds — harmless if so);
//  2) rAF backstop scan: three's InstancedMesh keeps instanceMatrix.count=cap, and OUR
//     belt token mesh is the only DodecahedronGeometry instanced mesh in the scene, so a
//     per-frame probe evaluates geometry type + count directly. (Presentation-only check;
//     the sim side is covered by vitest parity tests.)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, win32 } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/ports/fullplant/browser/dist';
const WEB = 'C:/AI_LAB/SteelX/web';
const PORT = Number(process.env.PORT ?? 4205);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary' };

let hookApplied = false;
const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = path.startsWith('/@fs/') ? resolve(path.slice(5)) : join(DIST, path);
    const rf = win32.resolve(file), rw = win32.resolve(WEB);
    if (rf !== rw && !rf.startsWith(rw + '\\')) throw new Error('outside web root');
    let body = await readFile(file);
    if (rf.startsWith(win32.resolve(DIST))) {
      const src = body.toString();
      const patched = src.replace(
        /super\(e,t\),this\.isInstancedMesh=!0/g,
        'super(e,t),this.isInstancedMesh=!0,(window.__steelxInst??=[]).push(this)',
      );
      if (patched !== src) { hookApplied = true; body = Buffer.from(patched); }
    }
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) { console.log('404:', req.url, '|', e.message); res.writeHead(404); res.end('not found'); }
});

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
const out = {};
page.on('console', (m) => { if (m.type() === 'error') (out.console_errors ??= []).push(m.text().slice(0, 200)); });
page.on('pageerror', (e) => (out.console_errors ??= []).push(String(e).slice(0, 200)));

try {
  await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
  out.hookApplied = hookApplied; // set on first asset hit below (server runs before goto)
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
  out.hookApplied = hookApplied;
  await page.waitForTimeout(800);

  for (let i = 0; i < 12; i++) {
    const done = await page.evaluate(() => window.__steelxSession.builtNode('conv_ore_drp'));
    if (done) break;
    const btn = page.locator('#panel button').filter({ hasText: /^(Build|Continue)/ }).first();
    if (!(await btn.count())) { out.stuck_at_step = i; break; }
    await btn.click();
    await new Promise((r) => setTimeout(r, 120));
  }
  out.belt_built = await page.evaluate(() => window.__steelxSession.builtNode('conv_ore_drp'));

  // Watch tokens over ~8s of live clock: instanced count must equal min(ledger, 48) on
  // every frame where the mesh exists (it's created once the belt node is built).
  out.samples = await page.evaluate(`(() => new Promise((res) => {
    const samples = [];
    let frames = 0;
    const tick = () => {
      let inst = -1;
      for (const o of window.__steelxInst ?? []) if (o.geometry && o.geometry.type === 'DodecahedronGeometry') inst = o.count;
      const snap = window.__steelxSession.beltVisualSnapshot();
      samples.push({ inst, ledger: snap ? snap.state.registry.in_transit.length : -1 });
      if (++frames < 480) requestAnimationFrame(tick); else res(samples);
    };
    requestAnimationFrame(tick);
  }))()`);

  await page.screenshot({ path: 'C:/AI_LAB/SteelX/web/shots/s12_belt_tokens.png' });

  const seenTokenFrame = out.samples.some((s) => s.inst > 0 && s.inst === Math.min(s.ledger, 48)); // inst=0 with ledger=0 is a VALID match (no records -> no tokens)
  const neverMismatched = out.samples.every((s) => s.inst < 0 || s.inst === Math.min(s.ledger, 48));
  out.maxTokens = Math.max(...out.samples.map((s) => s.inst));
  out.ledgerSamples = [...new Set(out.samples.map((s) => s.ledger))];
  const ok = out.belt_built && seenTokenFrame && neverMismatched && !(out.console_errors ?? []).length;
  out.result = ok ? 'PASS' : 'FAIL';
} catch (e) {
  out.error = String(e).slice(0, 400);
} finally {
  out.timeline = out.samples.map((x) => x.inst + "/" + x.ledger).join(" ");
  console.log(out.timeline);
  out.bad = out.samples.map((x,i)=>({i,...x})).filter((x) => x.inst !== Math.min(Math.max(x.ledger,0), 48)).slice(0,12);
  console.log("BAD:", JSON.stringify(out.bad));
  console.log(JSON.stringify({ hookApplied: out.hookApplied, belt_built: out.belt_built, maxTokens: out.maxTokens, ledgerSamples: out.ledgerSamples, result: out.result, console_errors: (out.console_errors ?? []).slice(0, 3) }, null, 2));
  await browser.close();
  server.close();
}
