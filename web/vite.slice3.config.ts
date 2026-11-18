// Slice-3 browser scoped Vite config — closes the known gap that slice3/browser has no
// vite config of its own (running it with the root config collides on 5173). Slice3's
// existing files are NOT modified; this config only points at them. Ports: 5173 slice1,
// 5174 slice2, 5175 slice4, 5173 slice5 (known collision), hub 5177 — so 5176 is free.
// Run from the web/ workspace:
//   npx vite --config vite.slice3.config.ts
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: path.resolve(__dirname, 'src/ports/slice3/browser'),
  server: { port: 5176, host: '127.0.0.1' },
  // Scratch dist dir — never overwrites any existing build output.
  build: { outDir: path.resolve(__dirname, 'cache/slice3_browser_build_check'), emptyOutDir: true },
});
