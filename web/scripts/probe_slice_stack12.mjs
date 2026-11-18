// Fresh load -> Slice 4 click; capture the crash-time arguments via a Function-constructor wrapper? No.
// Use CDP: pause on the exception and inspect the frame's local variables.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const DIST = 'C:/AI_LAB/SteelX/web/src/hub/dist/hub';
const PORT = 4193;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  try {
    const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    const body = await readFile(join(DIST, path));
    res.writeHead(200, { 'content-type': MIME[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('not found');
  }
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const browser = await chromium.launch();
const page = await browser.newPage();
const cdp = await page.context().newCDPSession(page);
await cdp.send('Debugger.enable');

let pausedInfo = null;
cdp.on('Debugger.paused', async (evt) => {
  const callFrames = evt.callFrames ?? [];
  const frames = [];
  for (const f of callFrames.slice(0, 6)) {
    const vars = [];
    for (const scope of f.scopeChain ?? []) {
      if (scope.type === 'local' && scope.object?.properties) {
        for (const p of scope.object.properties.slice(0, 12)) {
          let val = p.value?.value;
          if (val === undefined && p.value?.description) val = p.value.description;
          vars.push(`${p.name}=${typeof val === 'object' ? JSON.stringify(val)?.slice(0, 160) : String(val).slice(0, 80)}`);
        }
      }
    }
    frames.push({ fn: f.functionName, loc: `${f.url.split('/').pop()}:${f.lineNumber}:${f.columnNumber}`, vars });
  }
  pausedInfo = { reason: evt.reason, frames };
  await cdp.send('Debugger.resume').catch(() => {});
});

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle' });
await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.steelx-controls button')];
  btns.find((x) => x.textContent?.includes('Slice 4'))?.click();
});
await page.waitForTimeout(1500);

if (pausedInfo) {
  console.log('PAUSED reason:', pausedInfo.reason);
  for (const f of pausedInfo.frames) {
    console.log(`frame ${f.fn} @ ${f.loc}`);
    console.log('  locals:', f.vars.join(' | '));
  }
} else {
  console.log('no debugger pause captured');
}

await browser.close();
server.close();
