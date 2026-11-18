// Full-plant overview scoped Vite config (isolation rule: per-slice configs untouched).
//   npx vite --config src/ports/fullplant/browser/vite.fullplant.config.ts --port 5178 --strictPort
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname),
  // Cross-slice imports/assets live outside this root — allow serving up to web/src.
  server: { port: 5178, allowedHosts: true, fs: { allow: [path.resolve(__dirname, '../../..')] } },
  resolve: { alias: { '@slices': path.resolve(__dirname, '../..') } },
});
