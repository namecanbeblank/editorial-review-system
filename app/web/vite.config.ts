import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

/**
 * `root` is pinned to this file's own directory via `import.meta.dirname` (absolute)
 * rather than left to default to `process.cwd()`, so `npm run dev:web` / `npm run build`
 * behave identically regardless of the invoking shell's working directory. Build output
 * lands at web/dist, which server/index.ts serves as static files when present.
 */
const webRoot = import.meta.dirname;

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  build: {
    outDir: resolve(webRoot, "dist"),
    emptyOutDir: true,
  },
  server: {
    proxy: {
      "/api": "http://localhost:4610",
    },
  },
});
