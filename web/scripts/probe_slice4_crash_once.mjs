// One-shot instrumented probe: reload-resume then click Slice 4, capture the real error stack.
import { chromium } from 'playwright';
const PORT = 4176;
const browser = await chromium.launch();
const page = await browser.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.stack || String(e)));
await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
for (let i = 0; i < 30; i++) await page.getByRole('button', { name: /step \+1/ }).click();
await page.getByRole('button', { name: /^Save$/ }).click();
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(800);
const before = errs.length;
await page.getByRole('button', { name: /Slice 4/ }).click();
await page.waitForTimeout(600);
console.log(JSON.stringify({ newErrs: errs.slice(before) }, null, 2));
await browser.close();
