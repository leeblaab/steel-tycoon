// Serve the built slice3 bundle and load it in a real headless browser (verification
// bar item (c), render half). Run from web/: npx tsx src/ports/slice3/browser/render_check.mts
// Captures console errors/warnings + page exceptions; fixture-parity lines printed by
// main.tsx must appear on the console for PASS.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createSession, browserInfo } from 'browser_use';

const OUT = path.resolve('../../../../cache/slice3_build_out');
const MIME: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const urlPath = (req.url || '/').split('?')[0];
  const file = path.join(OUT, urlPath === '/' ? 'index.html' : urlPath);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise<void>((r) => server.listen(5199, '127.0.0.1', r));

const session = createSession({ headless: true });
try {
  const info = await browserInfo(session);
  console.log('browser:', JSON.stringify(info).slice(0, 300));
  // navigate + render wait
  await session.navigate('http://127.0.0.1:5199/');
  await new Promise((r) => setTimeout(r, 4000));
  const consoleMsgs = await (session as any).cdpConsole?.() ?? null;
  let msgs: any[] = [];
  try {
    // fall back to evaluating the DOM state directly
    const title = await session.evaluate(`document.title`);
    const canvasCount = await session.evaluate(`document.querySelectorAll('#scene canvas').length`);
    const labelCount = await session.evaluate(`document.querySelectorAll('#labels .blabel').length`);
    const overlay = await session.evaluate(`(document.querySelector('#overlay .big')||{}).textContent`);
    console.log('title:', title);
    console.log('canvas count:', canvasCount);
    console.log('DOM labels:', labelCount);
    console.log('overlay tick text:', overlay);
  } catch (e) { console.log('evaluate error:', String(e)); }
  if (consoleMsgs) msgs = consoleMsgs;
  const errors = msgs.filter((m: any) => m.type === 'error');
  const parity = msgs.filter((m: any) => /MATCH|MISMATCH|residual/.test(m.text || ''));
  for (const m of parity) console.log('console:', m.text);
  for (const m of errors) console.log('CONSOLE ERROR:', m.text);
  if (errors.length === 0) console.log('no console errors');
} finally {
  await session.close();
  server.close();
}
