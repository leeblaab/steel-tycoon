// S0.4 debug: capture console errors + canvas pixel read via toDataURL after visual_probe flow.
import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)));
await page.goto('http://localhost:5178/', { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(6000);

const info = await page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').map((e) => e.name).find((u) => /@react-three_fiber\.js/.test(u));
  const mod = await import(url);
  const entry = [...mod._roots.values()][0];
  const st = typeof entry.store.getState === 'function' ? entry.store.getState() : entry.store;
  const gl = st.gl;
  // readPixels right after a render call — if this is black but screenshot was fine before, GL lost?
  const ctx = gl.getContext();
  const w = ctx.drawingBufferWidth, h = ctx.drawingBufferHeight;
  const px = new Uint8Array(4 * 16);
  gl.render(st.scene, st.camera);
  ctx.readPixels(w >> 1, h >> 1, 4, 4, ctx.RGBA, ctx.UNSIGNED_BYTE, px);
  let lost = false;
  try { lost = ctx.isContextLost(); } catch {}
  // sample the canvas via drawImage into a 2D canvas (works even when readPixels is black)
  const c2 = document.createElement('canvas'); c2.width = 64; c2.height = 40;
  const g2 = c2.getContext('2d');
  g2.drawImage(gl.domElement, 0, 0, 64, 40);
  const d = g2.getImageData(0, 0, 64, 40).data;
  let sr = 0, sg = 0, sb = 0;
  for (let i = 0; i < d.length; i += 4) { sr += d[i]; sg += d[i + 1]; sb += d[i + 2]; }
  const n = d.length / 4;
  return { readPixels: [...px.slice(0, 8)], drawImageMean: [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)], contextLost: lost, dbw: w, dbh: h, canvasVisible: gl.domElement.offsetParent !== null };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: 'docs/evidence/s04/dbg_direct.png' });
await browser.close();
