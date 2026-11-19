// One-shot live-rig probe: reads renderer/scene state via the __steelxRig hook that
// ViewCamera publishes (useThree context — reliable, unlike fiber walking).
import { chromium } from 'playwright';
const url = 'http://localhost:5178/' + (process.argv[2] ?? '');
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForSelector('#scene canvas');
await page.waitForTimeout(3000);
const out = await page.evaluate(() => {
  const rig = window.__steelxRig;
  return rig ? rig() : 'NO_RIG_HOOK';
});
console.log(JSON.stringify(out, null, 1));
await browser.close();

