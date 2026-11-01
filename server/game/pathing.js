// Movement cost, A* pathfinding and reachable-cell flood for tactical maps.
// Pure ESM (no Node-only imports). 8-directional movement, every step costs 5 ft (difficult terrain 10 ft),
// no diagonal corner-cutting past blocked terrain, size-aware (a Large creature needs its whole 2x2 footprint free).

import { getGrids } from "./vision.js";

const DIRS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** cellCost(map, x, y) -> feet to ENTER the cell: 5 normal, 10 difficult, Infinity blocked (or out of bounds) */
export function cellCost(map, x, y) {
  if (!(x >= 0 && y >= 0 && x < map.w && y < map.h)) return Infinity;
  const c = getGrids(map).cost[y * map.w + x];
  return c === 0 ? Infinity : c;
}

/** distanceFeet(a, b): Chebyshev distance * 5, edge to edge when a.size / b.size are given */
export function distanceFeet(a, b) {
  const sa = Math.max(1, (a && a.size) | 0 || 1);
  const sb = Math.max(1, (b && b.size) | 0 || 1);
  const gx = Math.max(0, b.x - (a.x + sa - 1), a.x - (b.x + sb - 1));
  const gy = Math.max(0, b.y - (a.y + sa - 1), a.y - (b.y + sb - 1));
  return Math.max(gx, gy) * 5;
}

// ---------------------------------------------------------------------------------------------------------------

class MinHeap {
  constructor() {
    this.k = [];
    this.v = [];
  }
  get size() {
    return this.k.length;
  }
  push(key, val) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop() {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop();
    const lv = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
}

// Builds position evaluators for a creature of `size`: terrain(i) -> cost of the footprint ignoring creatures (0 =
// blocked), enter(i) -> cost including isBlocked (0 = blocked), ends(i) -> may finish movement here.
function makeMover(map, opts) {
  const { w, h } = map;
  const g = getGrids(map);
  const size = Math.max(1, (opts && opts.size) | 0 || 1);
  const isBlocked = (opts && opts.isBlocked) || null;
  const isOccupied = (opts && opts.isOccupied) || null;
  const n = w * h;
  const tCache = new Int16Array(n).fill(-1);
  const bCache = isBlocked ? new Int8Array(n).fill(-1) : null;
  const oCache = isOccupied ? new Int8Array(n).fill(-1) : null;
  const maxX = w - size;
  const maxY = h - size;

  function terrain(x, y) {
    if (x < 0 || y < 0 || x > maxX || y > maxY) return 0;
    const i = y * w + x;
    let c = tCache[i];
    if (c >= 0) return c;
    c = 5;
    for (let yy = y; yy < y + size && c; yy++) {
      for (let xx = x; xx < x + size; xx++) {
        const cc = g.cost[yy * w + xx];
        if (cc === 0) {
          c = 0;
          break;
        }
        if (cc > c) c = cc;
      }
    }
    tCache[i] = c;
    return c;
  }
  function cellBlocked(xx, yy) {
    const j = yy * w + xx;
    let b = bCache[j];
    if (b < 0) {
      b = isBlocked(xx, yy) ? 1 : 0;
      bCache[j] = b;
    }
    return b === 1;
  }
  function enter(x, y) {
    const c = terrain(x, y);
    if (!c || !isBlocked) return c;
    for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) if (cellBlocked(xx, yy)) return 0;
    return c;
  }
  function ends(x, y) {
    if (!isOccupied) return true;
    for (let yy = y; yy < y + size; yy++) {
      for (let xx = x; xx < x + size; xx++) {
        const j = yy * w + xx;
        let o = oCache[j];
        if (o < 0) {
          o = isOccupied(xx, yy) ? 1 : 0;
          oCache[j] = o;
        }
        if (o === 1) return false;
      }
    }
    return true;
  }
  return { w, h, size, terrain, enter, ends };
}

/**
 * findPath(map, from, to, { size = 1, isBlocked = () => false, isOccupied?, maxFeet = Infinity } = {})
 *   -> { path: [{x,y}, ...], feet } | null
 * 8-directional A*; path includes `from` and `to`. isBlocked(x, y) adds blockers (e.g. hostile creatures).
 * isOccupied(x, y) (optional) marks cells you may pass through but not end on (e.g. allies).
 */
export function findPath(map, from, to, opts = {}) {
  if (!map || !from || !to) return null;
  const maxFeet = opts.maxFeet ?? Infinity;
  const M = makeMover(map, opts);
  const { w } = M;
  const fx = from.x | 0;
  const fy = from.y | 0;
  const tx = to.x | 0;
  const ty = to.y | 0;
  if (fx === tx && fy === ty) return { path: [{ x: fx, y: fy }], feet: 0 };
  if (!M.enter(tx, ty) || !M.ends(tx, ty)) return null;
  if (fx < 0 || fy < 0 || fx >= map.w || fy >= map.h) return null;

  const n = map.w * map.h;
  const gScore = new Float64Array(n).fill(Infinity);
  const came = new Int32Array(n).fill(-1);
  const closed = new Uint8Array(n);
  const start = fy * w + fx;
  const goal = ty * w + tx;
  const heur = (x, y) => {
    const dx = Math.abs(x - tx);
    const dy = Math.abs(y - ty);
    // Chebyshev (exact lower bound) + a tiny Euclidean tie-breaker for straighter-looking paths
    return 5 * (dx > dy ? dx : dy) + 0.001 * Math.sqrt(dx * dx + dy * dy);
  };
  gScore[start] = 0;
  const open = new MinHeap();
  open.push(heur(fx, fy), start);
  while (open.size) {
    const cur = open.pop();
    if (closed[cur]) continue;
    if (cur === goal) break;
    closed[cur] = 1;
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const gc = gScore[cur];
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0];
      const dy = DIRS[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      const c = M.enter(nx, ny);
      if (!c) continue;
      if (dx && dy && (!M.terrain(cx + dx, cy) || !M.terrain(cx, cy + dy))) continue; // no corner cutting
      const ni = ny * w + nx;
      if (closed[ni]) continue;
      const ng = gc + c;
      if (ng > maxFeet || ng >= gScore[ni]) continue;
      gScore[ni] = ng;
      came[ni] = cur;
      open.push(ng + heur(nx, ny), ni);
    }
  }
  if (!Number.isFinite(gScore[goal])) return null;
  const path = [];
  for (let i = goal; i !== -1; i = came[i]) {
    const x = i % w;
    path.push({ x, y: (i - x) / w });
    if (i === start) break;
  }
  path.reverse();
  return { path, feet: gScore[goal] };
}

/**
 * reachableCells(map, from, maxFeet, { size = 1, isBlocked, isOccupied } = {}) -> Map<"x,y", feet>
 * Dijkstra flood within the budget (for the movement overlay). Includes `from` at 0 ft. Cells for which
 * isOccupied() is true are passed through but not included as end points.
 */
export function reachableCells(map, from, maxFeet, opts = {}) {
  const out = new Map();
  if (!map || !from) return out;
  const M = makeMover(map, opts);
  const { w } = M;
  const fx = from.x | 0;
  const fy = from.y | 0;
  if (fx < 0 || fy < 0 || fx >= map.w || fy >= map.h) return out;
  const budget = Number.isFinite(maxFeet) ? maxFeet : Infinity;
  const n = map.w * map.h;
  const dist = new Float64Array(n).fill(Infinity);
  const start = fy * w + fx;
  dist[start] = 0;
  const open = new MinHeap();
  open.push(0, start);
  while (open.size) {
    const cur = open.pop();
    const cx = cur % w;
    const cy = (cur - cx) / w;
    const dc = dist[cur];
    if (out.has(`${cx},${cy}`)) continue;
    if (cur === start || M.ends(cx, cy)) out.set(`${cx},${cy}`, dc);
    else out.set(`${cx},${cy}`, -1); // visited marker, removed below
    for (let d = 0; d < 8; d++) {
      const dx = DIRS[d][0];
      const dy = DIRS[d][1];
      const nx = cx + dx;
      const ny = cy + dy;
      const c = M.enter(nx, ny);
      if (!c) continue;
      if (dx && dy && (!M.terrain(cx + dx, cy) || !M.terrain(cx, cy + dy))) continue;
      const ni = ny * w + nx;
      const nd = dc + c;
      if (nd > budget || nd >= dist[ni]) continue;
      dist[ni] = nd;
      open.push(nd, ni);
    }
  }
  for (const [k, v] of out) if (v < 0) out.delete(k);
  return out;
}
