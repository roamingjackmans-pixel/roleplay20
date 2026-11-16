import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const clientDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(clientDir, '..');

// The version code shown on the home page: "v" + the number of commits (higher = newer) and the commit it was built
// from ("+" if it was built with uncommitted changes). The server reads the same stamp from dist/version.json.
function buildVersion() {
  const git = (args) => { try { return execSync(`git ${args}`, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch { return ''; } };
  const count = git('rev-list --count HEAD');
  const hash = git('rev-parse --short=7 HEAD') || 'dev';
  const dirty = git('status --porcelain --untracked-files=no') ? '+' : '';
  return { code: count ? `v${count}${dirty}` : 'dev', hash: hash + dirty, builtAt: new Date().toISOString() };
}
const version = buildVersion();

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
  plugins: [react(), {
    name: 'rp20-version',
    apply: 'build',
    writeBundle(opts) { writeFileSync(resolve(opts.dir || resolve(clientDir, 'dist'), 'version.json'), JSON.stringify(version)); },
  }],
  define: { __RP20_VERSION__: JSON.stringify(version) },
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
