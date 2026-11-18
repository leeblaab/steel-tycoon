import { defineConfig } from "vite";

export default defineConfig({
  root: "src/ports/slice4/browser",
  build: { outDir: "C:/AI_LAB/SteelX/cache/s4_build_out", emptyOutDir: true },
  server: { port: 5175, host: "127.0.0.1" },
});
