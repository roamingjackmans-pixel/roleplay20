// Moving saved games between servers (for example from a PC to the cloud).
// makeBundle() packs the data folder into one gzipped file; when the server starts and finds that file at
// <data>/import/bundle.json.gz it writes every file back into the data folder before anything is loaded,
// then keeps the bundle as import/restored-<time>.json.gz as a backup.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Files that belong to one machine only (the old PC tunnel) and are never moved.
const SKIP = new Set(['tunnel.json', 'cloudflared.log', 'public-url.json', 'moved-to-cloud.json']);

export const BUNDLE_PATH = 'import/bundle.json.gz';

export function makeBundle(dataDir) {
  const files = {};
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      const rel = path.relative(dataDir, full).split(path.sep).join('/');
      if (e.isDirectory()) { if (rel !== 'import') walk(full); continue; }
      if (SKIP.has(rel) || e.name.endsWith('.tmp')) continue;
      files[rel] = fs.readFileSync(full).toString('base64');
    }
  };
  walk(dataDir);
  return { count: Object.keys(files).length, gz: zlib.gzipSync(JSON.stringify({ madeAt: new Date().toISOString(), files })) };
}

export function restoreBundle(dataDir) {
  const file = path.join(dataDir, ...BUNDLE_PATH.split('/'));
  if (!fs.existsSync(file)) return 0;
  const root = path.resolve(dataDir);
  const bundle = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
  let n = 0;
  for (const [rel, b64] of Object.entries(bundle.files || {})) {
    const target = path.resolve(root, rel);
    if (!target.startsWith(root + path.sep)) continue; // never write outside the data folder
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, Buffer.from(b64, 'base64'));
    n++;
  }
  fs.renameSync(file, path.join(path.dirname(file), `restored-${Date.now()}.json.gz`));
  console.log(`  📦 Restored ${n} saved files from the moved-data bundle.`);
  return n;
}
