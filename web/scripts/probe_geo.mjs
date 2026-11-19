// One-shot live geometry probe: how many meshes does the scene actually contain?
import { chromium } from 'playwright';
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('console', m => { if (m.type() === 'error') console.log('PAGE_ERR:', m.text().slice(0, 200)); });
await page.goto('http://localhost:5178/', { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(4000);
const out = await page.evaluate(() =>
  typeof window.__steelxMeshCount === 'function' ? window.__steelxMeshCount() : 'NO_HOOK');
console.log(JSON.stringify(out));
const dbg = await page.evaluate(() => {
  const c = document.querySelector('#scene canvas');
  return {
    canvasKeys: Object.keys(c).filter(k => k.startsWith('__react') || k === '__r3f'),
    parentTag: c.parentElement?.tagName + '#' + c.parentElement?.id,
    parentKeys: Object.keys(c.parentElement ?? {}).filter(k => k.startsWith('__react')).slice(0, 4),
  };
});
console.log(JSON.stringify(dbg));
await browser.close();
