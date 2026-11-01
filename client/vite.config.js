import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const clientDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(clientDir, '..');

// Multi-page build: only include entry pages that exist (index.html is written by the main UI).
// RP_PAGES=map-demo (comma list) limits the build to some pages, e.g. to check one page in isolation.
const only = process.env.RP_PAGES ? process.env.RP_PAGES.split(',').map((s) => s.trim().replace(/\.html$/, '')) : null;
const pages = ['index.html', 'map-demo.html'].filter((p) => !only || only.includes(p.replace(/\.html$/, '')));
const input = {};
for (const page of pages) {
  const file = resolve(clientDir, page);
  if (existsSync(file)) input[page.replace(/\.html$/, '')] = file;
}

export default defineConfig({
  root: clientDir,
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(clientDir, 'dist'),
    emptyOutDir: true,
    manifest: true,
    rolldownOptions: { input },
  },
  server: {
    port: 5173,
    // shared/ and server/game/ (browser-safe pure ESM) live outside client/
    fs: { allow: [repoRoot] },
    proxy: {
      '/api': { target: 'http://localhost:3020', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:3020', ws: true, changeOrigin: true },
    },
  },
});
