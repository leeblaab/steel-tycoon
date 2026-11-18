// Slice-2 scoped Vite config (isolation rule: web/vite.config.ts belongs to slice1 and must not be
// edited). Slice5 pattern. Run from the web/ workspace so node_modules resolution works:
//   npx vite --config src/ports/slice2/browser/vite.slice2.config.ts
//   npx vite build --config src/ports/slice2/browser/vite.slice2.config.ts
// Phase -1 asset pitfall (20.10): main.tsx loads staged GLBs at runtime from '/assets/*.glb'
// — plain Vite copies only *imported* assets, so the served dist must carry the .glb files
// plus Kenney's shared Textures/colormap.png next to them (GLTFLoader resolves relative refs).
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  server: { port: 5174, host: '127.0.0.1' },
  publicDir: path.resolve(__dirname, 'public'),
  build: { outDir: path.resolve(__dirname, '../../../cache/slice2_browser_build') },
});
