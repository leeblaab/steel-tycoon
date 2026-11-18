// Slice-5 scoped Vite config (isolation rule: web/vite.config.ts belongs to slice1 and must not be
// edited). Run from the web/ workspace so node_modules resolution works:
//   npx vite --config src/ports/slice5/browser/vite.slice5.config.ts
//   npx vite build --config src/ports/slice5/browser/vite.slice5.config.ts
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  server: { port: 5173 },
  // PITFALL (21.10): path.resolve is relative to __dirname, NOT the vite root —
  // '../../../cache' lands in web/src/cache while `vite preview` serves web/cache
  // -> stale Oct-17 build silently served (slice5 headless black-screen cause).
  // Four levels up = web/ so build and preview agree on web/cache/slice5_browser_build.
  build: { outDir: path.resolve(__dirname, '../../../../cache/slice5_browser_build') },
});
