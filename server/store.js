// Tiny JSON document store. Everything lives in memory and is written to disk shortly after it changes
// (atomic write: temp file + rename). Plenty for a handful of players.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const pending = new Map(); // file -> timer
const docs = new Map();    // file -> object

function filePath(name) {
  return path.join(config.dataDir, name);
}

function writeNow(name) {
  const obj = docs.get(name);
  if (obj === undefined) return;
  const file = filePath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj));
  fs.renameSync(tmp, file);
}

/** Load (or create) a JSON document. Returns the live object; call save(name) after mutating it. */
export function load(name, fallback) {
  if (docs.has(name)) return docs.get(name);
  const file = filePath(name);
  let obj;
  try {
    obj = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') console.error(`[store] could not read ${name}:`, e.message);
    obj = typeof fallback === 'function' ? fallback() : structuredClone(fallback ?? {});
  }
  docs.set(name, obj);
  return obj;
}

export function save(name, delay = 400) {
  if (pending.has(name)) return;
  pending.set(name, setTimeout(() => {
    pending.delete(name);
    try { writeNow(name); } catch (e) { console.error(`[store] could not write ${name}:`, e.message); }
  }, delay));
}

export function put(name, obj) {
  docs.set(name, obj);
  save(name);
}

export function remove(name) {
  docs.delete(name);
  const t = pending.get(name);
  if (t) { clearTimeout(t); pending.delete(name); }
  try { fs.unlinkSync(filePath(name)); } catch { /* already gone */ }
}

export function list(dir) {
  try {
    return fs.readdirSync(filePath(dir)).filter((f) => f.endsWith('.json')).map((f) => `${dir}/${f}`);
  } catch {
    return [];
  }
}

/** Append a line to a JSON-lines archive (old log entries, AI call records). */
export function appendLine(name, obj) {
  const file = filePath(name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFile(file, JSON.stringify(obj) + '\n', () => {});
}

export function flushAll() {
  for (const [name, t] of pending) {
    clearTimeout(t);
    try { writeNow(name); } catch (e) { console.error(`[store] flush ${name}:`, e.message); }
  }
  pending.clear();
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { flushAll(); process.exit(0); });
}
process.on('exit', flushAll);
