// Builds (and caches) the static, pre-rendered base image of a TacticalMap:
// terrain + walls + objects, plus metadata used by the per-frame renderer.
import { hashStr, clamp, makeRand } from './rng.js';
import { makeCanvas } from './paint.js';
import { normalizeTheme, styleFor } from './themes.js';
import { analyzeMap, paintTerrain } from './terrain.js';
import { paintWalls, doorOrientation } from './walls.js';
import { paintObjects, isFireObject } from './objects.js';
import { makeNoiseFields, cellsPath } from './masks.js';

const CACHE = new Map(); // key -> base
const CACHE_MAX = 4;

export function baseKey(map) {
  if (!map) return '';
  const objs = (map.objects || []).map((o) => `${o.id}:${o.kind}:${o.x},${o.y},${o.w || 1},${o.h || 1},${o.rot || 0},${o.hidden ? 1 : 0}`).join('|');
  return `${map.id}|${map.seed}|${map.w}x${map.h}|${map.theme}|${hashStr(map.tiles || '')}|${hashStr(objs)}`;
}

function pixelBudget() {
  const mem = typeof navigator !== 'undefined' && navigator.deviceMemory ? navigator.deviceMemory : 8;
  const coarse = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
  return coarse || mem <= 4 ? 4.5e6 : 8.5e6;
}

export function getBase(map) {
  const key = baseKey(map);
  let b = CACHE.get(key);
  if (b) {
    CACHE.delete(key);
    CACHE.set(key, b);
    return b;
  }
  b = renderBase(map);
  b.key = key;
  CACHE.set(key, b);
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return b;
}
export function peekBase(map) {
  return CACHE.get(baseKey(map)) || null;
}

export function renderBase(map) {
  const t0 = performance.now();
  const w = Math.max(1, map.w | 0), h = Math.max(1, map.h | 0);
  const theme = normalizeTheme(map.theme);
  const pal = styleFor(theme);
  const seed = (map.seed | 0) || hashStr(map.id || 'map');
  const S = clamp(Math.floor(Math.sqrt(pixelBudget() / (w * h))), 28, 100);
  const info = analyzeMap(map);
  const canvas = makeCanvas(w * S, h * S);
  const scratch = makeCanvas(w * S, h * S);
  const ctx = canvas.getContext('2d');
  const nf = makeNoiseFields(w, h, 10, seed);

  paintTerrain(ctx, scratch, info, pal, S, seed, nf);
  paintWalls(ctx, scratch, info, pal, S, seed, nf);
  paintObjects(ctx, map.objects || [], S, { theme, pal, info, dm: true });

  if (pal.grade) {
    const [col, a, mode] = pal.grade;
    ctx.save();
    ctx.globalCompositeOperation = mode || 'multiply';
    ctx.globalAlpha = a;
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, w * S, h * S);
    ctx.restore();
  }
  // release scratch memory
  scratch.width = scratch.height = 1;

  // ---- metadata for the live renderer ----
  const lights = [];
  for (const l of map.lights || []) {
    lights.push({ id: l.id, x: l.x + 0.5, y: l.y + 0.5, bright: (l.bright || 0) / 5, dim: (l.dim || 0) / 5, color: l.color || '#ffb347', flicker: l.flicker !== false && !!l.flicker });
  }
  const fires = [];
  for (const o of map.objects || []) {
    const cx = o.x + (o.w || 1) / 2, cy = o.y + (o.h || 1) / 2;
    if (o.light && (o.light.bright || o.light.dim)) {
      lights.push({ id: o.id, x: cx, y: cy, bright: (o.light.bright || 0) / 5, dim: (o.light.dim || 0) / 5, color: o.light.color || '#ff9a3c', flicker: o.light.flicker !== false });
    }
    if (isFireObject(o)) {
      const size = o.kind === 'torch' ? 0.11 : o.kind === 'campfire' ? 0.24 : o.kind === 'brazier' ? 0.22 : 0.2;
      fires.push({ x: cx, y: cy, r: size * Math.min(o.w || 1, o.h || 1), kind: o.kind, seed: hashStr(o.id || `${o.x},${o.y}`) % 1000 });
      if (!o.light) lights.push({ id: `fire_${o.id}`, x: cx, y: cy, bright: 1.2, dim: 1.5, color: '#ff9a3c', flicker: true, soft: true });
    }
    if (o.kind === 'crystal' || (o.kind === 'mushroom' && (theme === 'cave' || theme === 'mine'))) {
      if (!o.light) lights.push({ id: `glow_${o.id}`, x: cx, y: cy, bright: 0.3, dim: 1.0, color: o.kind === 'crystal' ? '#7fd8ff' : '#6ad0c8', flicker: false, soft: true });
    }
  }
  const water = [];
  const R = makeRand(seed ^ 0x77);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const t = info.at(x, y);
      if (t === '~' || t === 'w' || (t === ' ' && pal.seaVoid)) {
        water.push({ x: x + 0.15 + R.next() * 0.7, y: y + 0.15 + R.next() * 0.7, p: R.next() * 100, s: 0.6 + R.next() * 0.8, deep: t !== '~' });
      }
    }
  const doors = (map.doors || []).map((d) => ({ ...d, orient: doorOrientation(info, d.x, d.y) }));
  const floorPath = cellsPath(w, h, (x, y) => {
    const t = info.at(x, y);
    return t !== '#' && t !== ' ';
  }, 1);
  // light glows only touch floors and the faces of walls, never the solid rock behind them
  const litPath = cellsPath(w, h, (x, y) => {
    const t = info.at(x, y);
    if (t === ' ') return !!pal.seaVoid;
    return t !== '#' || info.wallDist[y * w + x] <= 1;
  }, 1);
  const ms = performance.now() - t0;
  return { canvas, S, w, h, theme, pal, info, lights, fires, water, doors, floorPath, litPath, seed, ms };
}
