// Serve the built fullplant dist for headless probes (perf_probe.mjs, hero shots).
// Handles the app's absolute /@fs/ GLB URLs (main.tsx SRC constant) the same way
// probe_ore_belt_tokens6.mjs does, minus the instanced-mesh ctor patch.
// Usage: node scripts/serve_dist.mjs [port]   (default 4210)
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, win32 } from 'node:path';

const DIST = 'C:/AI_LAB/SteelX/web/src/ports/fullplant/browser/dist';
const WEB = 'C:/AI_LAB/SteelX/web';
const PORT = Number(process.argv[2] ?? 4210);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

const server = http.createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/') path = '/index.html';
    const file = path.startsWith('/@fs/') ? resolve(path.slice(5)) : join(DIST, path);
    const rf = win32.resolve(file), rw = win32.resolve(WEB);
    if (rf !== rw && !rf.startsWith(rw + '\\')) throw new Error('outside web root');
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' });
    res.end(body);
  } catch (e) {
    res.writeHead(404); res.end('not found');
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`serving fullplant dist on http://127.0.0.1:${PORT}/`));
