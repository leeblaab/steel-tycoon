// Build/render check scoped to the slice3 browser folder (verification bar item (c)).
// Run from web/: npx tsx src/ports/slice3/browser/build_check.ts
import { build } from 'vite';
// No @vitejs/plugin-react: not installed and new deps are out of scope this round;
// Vite's built-in esbuild pipeline transforms TSX fine (fast-refresh is dev-only).

build({
  root: 'src/ports/slice3/browser',
  logLevel: 'info',
  build: { outDir: '../../../../cache/slice3_build_out', emptyOutDir: true },
}).then(() => {
  console.log('VITE BUILD OK (scoped to src/ports/slice3/browser)');
}).catch((err) => {
  console.error('VITE BUILD FAILED');
  console.error(err);
  process.exit(1);
});
