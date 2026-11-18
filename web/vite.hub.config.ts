// Hub-scoped Vite config (isolation rule: web/vite.config.ts belongs to slice1 and must
// not be edited). Hub lives at src/hub on its own port so slice1's 5173, slice2's 5174
// and slice4's 5175 stay untouched. Run from the web/ workspace:
//   npx vite --config vite.hub.config.ts
//   npx vite build --config vite.hub.config.ts   (scratch dist only — see outDir)
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/hub'),
  server: { port: 5177, host: '127.0.0.1' },
  // Scratch dist dir (web/cache/hub_build_check) — never overwrites any existing dist.
  build: { outDir: path.resolve(__dirname, 'cache/hub_build_check'), emptyOutDir: true },
});
