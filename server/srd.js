// Loads the compiled SRD data (shared/srd/*.json). Reloaded lazily; missing files are empty lists.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

const NAMES = ['classes', 'races', 'backgrounds', 'spells', 'equipment', 'features', 'conditions', 'skills', 'magic-items', 'monsters', 'languages'];
export const CLIENT_SRD = new Set(['classes', 'races', 'backgrounds', 'spells', 'equipment', 'features', 'conditions', 'skills', 'magic-items', 'languages']);

let cache = null;

function read(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(config.srdDir, `${name}.json`), 'utf8'));
  } catch {
    return [];
  }
}

function indexed(list) {
  const m = new Map();
  if (Array.isArray(list)) for (const x of list) if (x && x.index) m.set(x.index, x);
  else if (list && typeof list === 'object') for (const [k, v] of Object.entries(list)) m.set(k, v);
  return m;
}

export function srd() {
  if (cache) return cache;
  const data = {};
  for (const n of NAMES) data[n === 'magic-items' ? 'magicItems' : n] = read(n);
  data.by = {};
  for (const [k, v] of Object.entries(data)) if (k !== 'by') data.by[k] = indexed(v);
  cache = data;
  return cache;
}

export function reloadSrd() {
  cache = null;
  return srd();
}

export function srdFile(name) {
  if (!CLIENT_SRD.has(name)) return null;
  const file = path.join(config.srdDir, `${name}.json`);
  return fs.existsSync(file) ? file : null;
}

/** Find a monster by index or fuzzy name ("Goblin Boss" -> goblin-boss, "wolves" -> wolf). */
export function findMonster(q) {
  const { monsters, by } = srd();
  if (!q) return null;
  const key = String(q).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  if (by.monsters.has(key)) return by.monsters.get(key);
  const singular = key.replace(/(ves)$/, 'f').replace(/(ies)$/, 'y').replace(/s$/, '');
  if (by.monsters.has(singular)) return by.monsters.get(singular);
  const list = Array.isArray(monsters) ? monsters : [];
  return list.find((m) => m.index.includes(singular) || singular.includes(m.index)) || null;
}
