import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/ports/slice1/browser',
  server: { port: 5173, host: '127.0.0.1' },
});
