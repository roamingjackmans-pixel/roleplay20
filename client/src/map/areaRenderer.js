// Area map scene builder: AreaMap (+ player knowledge) -> plain geometry for the SVG parchment renderer.
// Deterministic from map.seed. All coordinates are in a fixed W x H viewBox.
import { makeRand, fbm, vnoise, hashStr, clamp } from './rng.js';

export const AW = 1200, AH = 900;
const M = 34; // inner margin (decorative border)

// ------------------------------------------------------------------ geometry helpers
const f1 = (n) => Math.round(n * 10) / 10;
export function polyD(pts, closed = false) {
  if (!pts.length) return '';
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${f1(pts[i][0])} ${f1(pts[i][1])}`;
  return closed ? d + 'Z' : d;
}
/** Smooth path through points using quadratic curves between midpoints. */
export function smoothD(pts, closed = false) {
  const n = pts.length;
  if (n < 3) return polyD(pts, closed);
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  if (closed) {
    let s = mid(pts[n - 1], pts[0]);
    let d = `M${f1(s[0])} ${f1(s[1])}`;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = mid(pts[i], pts[(i + 1) % n]);
      d += `Q${f1(p[0])} ${f1(p[1])} ${f1(q[0])} ${f1(q[1])}`;
    }
    return d + 'Z';
  }
  let d = `M${f1(pts[0][0])} ${f1(pts[0][1])}`;
  for (let i = 1; i < n - 1; i++) {
    const q = mid(pts[i], pts[i + 1]);
    d += `Q${f1(pts[i][0])} ${f1(pts[i][1])} ${f1(q[0])} ${f1(q[1])}`;
  }
  d += `L${f1(pts[n - 1][0])} ${f1(pts[n - 1][1])}`;
  return d;
}
function catmull(pts, seg = 8) {
  if (pts.length < 3) return pts.slice();
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let k = 0; k < seg; k++) {
      const t = k / seg, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}
function resample(pts, step) {
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    const L = Math.hypot(bx - ax, by - ay);
    let t = step - carry;
    while (t <= L) {
      out.push([ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L]);
      t += step;
    }
    carry = L - (t - step);
  }
  const last = pts[pts.length - 1];
  if (Math.hypot(out[out.length - 1][0] - last[0], out[out.length - 1][1] - last[1]) > step * 0.3) out.push(last);
  return out;
}
function tangent(pts, i) {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  return [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
}
/** Tapered ribbon polygon around a polyline. widthAt(t in 0..1) -> full width. */
function ribbon(pts, widthAt) {
  const L = [], Rr = [];
  for (let i = 0; i < pts.length; i++) {
    const [tx, ty] = tangent(pts, i);
    const w = widthAt(i / (pts.length - 1)) / 2;
    L.push([pts[i][0] - ty * w, pts[i][1] + tx * w]);
    Rr.push([pts[i][0] + ty * w, pts[i][1] - tx * w]);
  }
  return L.concat(Rr.reverse());
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / L2, 0, 1);
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function segIntersect(a, b, c, d) {
  const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
  const den = r[0] * s[1] - r[1] * s[0];
  if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / den;
  const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [a[0] + t * r[0], a[1] + t * r[1], Math.atan2(r[1], r[0])];
}

/** Spatial hash of thick segments for "how far is the nearest road/river" queries. */
class SegGrid {
  constructor(cell = 48) {
    this.c = cell;
    this.m = new Map();
  }
  add(pts, half) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const x0 = Math.floor((Math.min(a[0], b[0]) - half) / this.c), x1 = Math.floor((Math.max(a[0], b[0]) + half) / this.c);
      const y0 = Math.floor((Math.min(a[1], b[1]) - half) / this.c), y1 = Math.floor((Math.max(a[1], b[1]) + half) / this.c);
      const seg = [a[0], a[1], b[0], b[1], half];
      for (let y = y0; y <= y1; y++)
        for (let x = x0; x <= x1; x++) {
          const k = x * 73856093 ^ y * 19349663;
          let arr = this.m.get(k);
          if (!arr) this.m.set(k, (arr = []));
          arr.push(seg);
        }
    }
  }
  /** clearance from (x,y) to the nearest segment edge (negative = inside) */
  clear(x, y) {
    const k = Math.floor(x / this.c) * 73856093 ^ Math.floor(y / this.c) * 19349663;
    const arr = this.m.get(k);
    if (!arr) return Infinity;
    let best = Infinity;
    for (const s of arr) {
      const d = segDist(x, y, s[0], s[1], s[2], s[3]) - s[4];
      if (d < best) best = d;
    }
    return best;
  }
}
class PointGrid {
  constructor(cell = 40) {
    this.c = cell;
    this.m = new Map();
  }
  add(x, y, r, data) {
    const k = Math.floor(x / this.c) * 73856093 ^ Math.floor(y / this.c) * 19349663;
    let a = this.m.get(k);
    if (!a) this.m.set(k, (a = []));
    a.push([x, y, r, data]);
  }
  hit(x, y, r) {
    const cx = Math.floor(x / this.c), cy = Math.floor(y / this.c);
    for (let j = cy - 1; j <= cy + 1; j++)
      for (let i = cx - 1; i <= cx + 1; i++) {
        const a = this.m.get(i * 73856093 ^ j * 19349663);
        if (!a) continue;
        for (const p of a) if (Math.hypot(p[0] - x, p[1] - y) < p[2] + r) return true;
      }
    return false;
  }
}

// ------------------------------------------------------------------ location classification
const SETTLEMENT = new Set(['town', 'city', 'village']);
const BIG_BUILDING = { temple: [34, 24, 'temple'], castle: [56, 50, 'castle'], keep: [44, 40, 'castle'], manor: [36, 26, 'manor'], guild: [30, 22, 'hall'], tavern: [26, 18, 'hall'], inn: [28, 20, 'hall'], library: [30, 22, 'hall'], barracks: [36, 18, 'hall'], jail: [24, 20, 'hall'], mill: [18, 18, 'mill'], smithy: [20, 16, 'hall'], stable: [30, 14, 'hall'], shop: [20, 16, 'hall'], tower: [16, 16, 'tower'], gate: [0, 0, 'none'], market: [0, 0, 'plaza'], square: [0, 0, 'plaza'], well: [0, 0, 'none'], bridge: [0, 0, 'none'], dock: [26, 12, 'dock'], farm: [22, 14, 'farm'], graveyard: [0, 0, 'graveyard'], house: [18, 14, 'hall'] };

export function visibleLocations(map, knowledge) {
  const locs = map.locations || [];
  if (!knowledge) return locs.map((l) => ({ ...l, _dm: true }));
  const disc = new Set(knowledge.discovered || []);
  if (knowledge.current) disc.add(knowledge.current);
  return locs.filter((l) => (knowledge.owned ? !l.secret || disc.has(l.id) : disc.has(l.id)));
}

// ------------------------------------------------------------------ main builder
export function buildArea(map, knowledge) {
  const style = ['town', 'city', 'village', 'region', 'dungeon'].includes(map.style) ? map.style : 'town';
  const seed = (map.seed | 0) || hashStr(map.id || map.name || 'area');
  const R = makeRand(seed);
  const F = map.features || {};
  const W = AW, H = AH;
  const IX0 = M, IY0 = M, IX1 = W - M, IY1 = H - M;
  const P = (l) => [IX0 + clamp(l.x, 0, 1) * (IX1 - IX0), IY0 + clamp(l.y, 0, 1) * (IY1 - IY0)];
  // The map's shape (roads, buildings, rivers, trees) comes only from the places that aren't secret, the same set for
  // every player, so everyone sees the same map and only the markers, labels and fog differ. Secret places never
  // change the drawing; once found they just get a marker.
  const everyLoc = (map.locations || []).map((l) => ({ ...l, p: P(l) }));
  const allLocs = everyLoc.filter((l) => !l.secret);
  const secretLocs = everyLoc.filter((l) => l.secret);
  const byId = new Map(allLocs.map((l) => [l.id, l]));
  const conns = (map.connections || []).filter(([a, b]) => byId.has(a) && byId.has(b));
  const shown = new Set(visibleLocations(map, knowledge).map((l) => l.id));
  const scene = { W, H, style, seed, name: map.name || 'Unnamed', description: map.description || '', roads: [], buildings: [], trees: [], hills: [], mountains: [], fields: [], rivers: [], lakes: [], bridges: [], plazas: [], graves: [], markers: [], rooms: [], corridors: [], doors: [], settlements: [] };
  const roadGrid = new SegGrid(48), waterGrid = new SegGrid(48), occ = new PointGrid(40);

  // ---------------- coast
  let seaPoly = null;
  const coast = F.coast;
  if (coast && style !== 'dungeon') {
    const docks = allLocs.filter((l) => l.kind === 'dock' || (l.kind === 'tower' && style !== 'region'));
    let depth = style === 'region' ? 0.2 : 0.16;
    if (coast === 's' && docks.length) depth = clamp(1 - Math.max(...docks.map((d) => d.y)) - 0.05, 0.08, 0.3);
    if (coast === 'n' && docks.length) depth = clamp(Math.min(...docks.map((d) => d.y)) - 0.05, 0.08, 0.3);
    if (coast === 'e' && docks.length) depth = clamp(1 - Math.max(...docks.map((d) => d.x)) - 0.05, 0.08, 0.3);
    if (coast === 'w' && docks.length) depth = clamp(Math.min(...docks.map((d) => d.x)) - 0.05, 0.08, 0.3);
    const horiz = coast === 'n' || coast === 's';
    const len = horiz ? W : H;
    const pts = [];
    for (let t = -20; t <= len + 20; t += 12) {
      const n = (fbm(t / 180, seed * 0.001, seed + 3, 4) - 0.5) * (style === 'region' ? 150 : 90) + (vnoise(t / 40, 3, seed + 9) - 0.5) * 18;
      const base = (horiz ? H : W) * depth + n;
      if (coast === 's') pts.push([t, H - base]);
      else if (coast === 'n') pts.push([t, base]);
      else if (coast === 'e') pts.push([W - base, t]);
      else pts.push([base, t]);
    }
    const corners = { s: [[W + 20, H + 20], [-20, H + 20]], n: [[W + 20, -20], [-20, -20]], e: [[W + 20, H + 20], [W + 20, -20]], w: [[-20, H + 20], [-20, -20]] }[coast];
    seaPoly = pts.concat(corners);
    scene.sea = { d: smoothD(seaPoly, true), coast: smoothD(pts), ripples: [] };
    for (let k = 1; k <= 4; k++) {
      const off = k * 9 + k * k * 2;
      const rp = pts.map(([x, y]) => (coast === 's' ? [x, y + off] : coast === 'n' ? [x, y - off] : coast === 'e' ? [x + off, y] : [x - off, y]));
      scene.sea.ripples.push({ d: smoothD(rp), o: 0.55 - k * 0.11 });
    }
  }
  const inSea = (x, y) => seaPoly && pointInPoly(x, y, seaPoly);

  // ---------------- river
  if (F.river && style !== 'dungeon') {
    const ns = F.river === 'ns';
    const attract = allLocs.filter((l) => ['bridge', 'mill', 'dock'].includes(l.kind) && style !== 'region').map((l) => {
      const p = l.p.slice();
      if (l.kind !== 'bridge') p[ns ? 0 : 1] += (R.next() < 0.5 ? -1 : 1) * 26;
      return p;
    });
    if (style === 'region') for (const l of allLocs) if (l.kind === 'town' || l.kind === 'city') attract.push([l.p[0] + (ns ? 30 : 0), l.p[1] + (ns ? 0 : 30)]);
    attract.sort((a, b) => (ns ? a[1] - b[1] : a[0] - b[0]));
    const start = ns ? [W * (0.35 + R.next() * 0.3), -30] : [-30, H * (0.35 + R.next() * 0.3)];
    const end = ns ? [W * (0.35 + R.next() * 0.3), H + 30] : [W + 30, H * (0.35 + R.next() * 0.3)];
    // keep only attractors that move monotonically and aren't too far off
    const way = [start];
    for (const a of attract) way.push(a);
    way.push(end);
    let pts = catmull(way, 10);
    // meander
    pts = resample(pts, 8).map(([x, y], i, arr) => {
      const t = i / arr.length;
      const n = (fbm(t * 4, seed * 0.01, seed + 21, 3) - 0.5) * 70 * Math.sin(Math.PI * t);
      const [tx, ty] = tangent(arr, i);
      return [x - ty * n * 0.6, y + tx * n * 0.6];
    });
    // re-pin the river onto bridge locations (smooth local pull so it still meanders elsewhere)
    for (const l of allLocs.filter((o) => o.kind === 'bridge' && style !== 'region')) {
      let bi = 0, bd = Infinity;
      pts.forEach(([x, y], i) => {
        const d = Math.hypot(x - l.p[0], y - l.p[1]);
        if (d < bd) (bd = d), (bi = i);
      });
      const dx = l.p[0] - pts[bi][0], dy = l.p[1] - pts[bi][1];
      pts = pts.map(([x, y], i) => {
        const k = Math.exp(-((i - bi) ** 2) / (2 * 14 * 14));
        return [x + dx * k, y + dy * k];
      });
    }
    if (seaPoly) {
      const k = pts.findIndex(([x, y]) => inSea(x, y));
      if (k > 3) pts = pts.slice(0, k + 2);
    }
    pts = resample(catmull(resample(pts, 30), 6), 6);
    const w0 = style === 'region' ? 3 : style === 'village' ? 9 : 12, w1 = style === 'region' ? 11 : style === 'city' ? 28 : 20;
    const poly = ribbon(pts, (t) => w0 + (w1 - w0) * t);
    scene.rivers.push({ d: smoothD(poly, true), center: smoothD(pts), w: w1 });
    waterGrid.add(pts, (w0 + w1) / 4 + 4);
    scene._riverPts = pts;
  }

  // ---------------- lakes (region)
  for (const l of allLocs) {
    if (l.kind !== 'lake') continue;
    const r = style === 'region' ? 42 : 30;
    const pts = [];
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      const k = 0.75 + fbm(Math.cos(a) * 1.5 + 5, Math.sin(a) * 1.5 + 5, seed + hashStr(l.id), 3) * 0.6;
      pts.push([l.p[0] + Math.cos(a) * r * 1.4 * k, l.p[1] + Math.sin(a) * r * k]);
    }
    scene.lakes.push({ d: smoothD(pts, true), ripples: [0.7, 0.45].map((s) => smoothD(pts.map(([x, y]) => [l.p[0] + (x - l.p[0]) * s, l.p[1] + (y - l.p[1]) * s]), true)) });
    waterGrid.add(pts.concat([pts[0]]), 6);
    occ.add(l.p[0], l.p[1], r * 1.2);
  }

  if (style === 'dungeon') return buildDungeon(scene, { ...map, connections: conns }, allLocs, byId, shown, knowledge, R, seed, P, secretLocs);

  // ---------------- settlement centre & extent
  const center = (() => {
    const c = allLocs.find((l) => l.kind === 'square' || l.kind === 'market');
    if (c) return c.p;
    if (!allLocs.length) return [W / 2, H / 2];
    return [allLocs.reduce((s, l) => s + l.p[0], 0) / allLocs.length, allLocs.reduce((s, l) => s + l.p[1], 0) / allLocs.length];
  })();
  const ext = style === 'city' ? 380 : style === 'town' ? 300 : style === 'village' ? 240 : 0;

  // ---------------- roads
  const addRoad = (pts, width, kind) => {
    const rs = resample(pts, 6);
    scene.roads.push({ d: smoothD(rs), w: width, kind, pts: rs });
    roadGrid.add(rs, width / 2);
  };
  const curve = (a, b, bend = 0.18) => {
    const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / (L || 1), ny = (b[0] - a[0]) / (L || 1);
    const off = (R.next() - 0.5) * 2 * bend * L;
    const c = [mx + nx * off, my + ny * off];
    const out = [];
    for (let t = 0; t <= 1.0001; t += 0.05) out.push([(1 - t) * (1 - t) * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) * (1 - t) * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]);
    return out;
  };
  const mainW = style === 'region' ? 4 : style === 'city' ? 13 : style === 'village' ? 9 : 11;
  const streetW = style === 'city' ? 8 : 7;
  // edge roads
  for (const side of F.roads || []) {
    const edge = { n: [W * (0.3 + R.next() * 0.4), -10], s: [W * (0.3 + R.next() * 0.4), H + 10], w: [-10, H * (0.3 + R.next() * 0.4)], e: [W + 10, H * (0.3 + R.next() * 0.4)] }[side];
    if (!edge) continue;
    let target = center;
    if (style === 'region' && allLocs.length) target = allLocs.slice().sort((a, b) => Math.hypot(a.p[0] - edge[0], a.p[1] - edge[1]) - Math.hypot(b.p[0] - edge[0], b.p[1] - edge[1]))[0].p;
    else if (allLocs.length) {
      const gate = allLocs.find((l) => l.kind === 'gate' && Math.hypot(l.p[0] - edge[0], l.p[1] - edge[1]) < 500);
      if (gate) target = gate.p;
    }
    addRoad(curve(edge, target, 0.12), mainW, 'main');
    if (inSea(edge[0], edge[1])) scene.roads.pop();
  }
  // explicit connections
  for (const [a, b] of conns) {
    const A = byId.get(a), B = byId.get(b);
    if (A && B) addRoad(curve(A.p, B.p, 0.12), style === 'region' ? mainW : streetW + 1, 'main');
  }
  // the renderer adds natural streets for settlements
  if (style !== 'region') {
    // connect every location to its nearest neighbour so nothing floats
    for (const l of allLocs) {
      if (conns.some(([a, b]) => a === l.id || b === l.id)) continue;
      const nb = allLocs.filter((o) => o !== l).sort((a, b) => Math.hypot(a.p[0] - l.p[0], a.p[1] - l.p[1]) - Math.hypot(b.p[0] - l.p[0], b.p[1] - l.p[1]))[0];
      if (nb) addRoad(curve(l.p, nb.p, 0.1), streetW, 'street');
    }
    const spokes = style === 'city' ? 8 : style === 'town' ? 5 : 3;
    const a0 = R.next() * Math.PI * 2;
    for (let i = 0; i < spokes; i++) {
      const a = a0 + (i / spokes) * Math.PI * 2 + (R.next() - 0.5) * 0.5;
      const L = ext * (0.7 + R.next() * 0.45);
      const pts = [];
      for (let t = 0; t <= 1.0001; t += 0.1) {
        const wob = (fbm(t * 3, i * 7.1, seed + 33, 2) - 0.5) * 0.5;
        pts.push([center[0] + Math.cos(a + wob * t) * L * t, center[1] + Math.sin(a + wob * t) * L * t]);
      }
      const clipped = [];
      for (const p of pts) {
        if (inSea(p[0], p[1]) || p[0] < IX0 || p[1] < IY0 || p[0] > IX1 || p[1] > IY1) break;
        clipped.push(p);
      }
      if (clipped.length > 2) addRoad(clipped, streetW, 'street');
    }
    if (style !== 'village') {
      const rings = style === 'city' ? [0.42, 0.75] : [0.55];
      for (const rr of rings) {
        let run = [];
        const flush = () => {
          if (run.length > 4) addRoad(run, streetW - 1, 'street');
          run = [];
        };
        for (let k = 0; k <= 64; k++) {
          const a = (k / 64) * Math.PI * 2;
          const r = ext * rr * (0.85 + fbm(Math.cos(a) * 1.3 + 9, Math.sin(a) * 1.3, seed + 41, 3) * 0.35);
          const p = [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r * 0.85];
          if (inSea(p[0], p[1]) || p[0] < IX0 + 10 || p[1] < IY0 + 10 || p[0] > IX1 - 10 || p[1] > IY1 - 10) flush();
          else run.push(p);
        }
        flush();
      }
    }
    if (style === 'city') {
      // alleys branching off streets
      const streets = scene.roads.filter((r) => r.kind === 'street');
      for (let i = 0; i < 26; i++) {
        const r = streets[(R.next() * streets.length) | 0];
        if (!r) break;
        const k = 1 + ((R.next() * (r.pts.length - 2)) | 0);
        const [tx, ty] = tangent(r.pts, k);
        const s = R.next() < 0.5 ? 1 : -1;
        const L = 50 + R.next() * 70;
        const p0 = r.pts[k];
        const p1 = [p0[0] - ty * s * L, p0[1] + tx * s * L];
        if (Math.hypot(p1[0] - center[0], p1[1] - center[1]) > ext * 0.95 || inSea(p1[0], p1[1])) continue;
        addRoad([p0, [(p0[0] + p1[0]) / 2 + (R.next() - 0.5) * 10, (p0[1] + p1[1]) / 2 + (R.next() - 0.5) * 10], p1], 5, 'alley');
      }
    }
  }

  // ---------------- bridges where roads cross the river
  if (scene._riverPts) {
    const rv = scene._riverPts;
    for (const road of scene.roads) {
      for (let i = 0; i < road.pts.length - 1; i++)
        for (let j = 0; j < rv.length - 1; j += 1) {
          const hit = segIntersect(road.pts[i], road.pts[i + 1], rv[j], rv[j + 1]);
          if (hit && !scene.bridges.some((b) => Math.hypot(b.x - hit[0], b.y - hit[1]) < 30)) {
            const t = j / (rv.length - 1);
            scene.bridges.push({ x: hit[0], y: hit[1], a: (hit[2] * 180) / Math.PI, len: (style === 'region' ? 11 : 12 + 16 * t) + 14, w: Math.max(road.w + 2, style === 'region' ? 6 : 10) });
          }
        }
    }
  }

  // ---------------- plazas
  for (const l of allLocs) {
    const bb = BIG_BUILDING[l.kind];
    if (style !== 'region' && bb && bb[2] === 'plaza') {
      const r = style === 'city' ? 46 : style === 'village' ? 30 : 38;
      const pts = [];
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        pts.push([l.p[0] + Math.cos(a) * r * (0.85 + R.next() * 0.25), l.p[1] + Math.sin(a) * r * (0.75 + R.next() * 0.2)]);
      }
      scene.plazas.push({ d: smoothD(pts, true), x: l.p[0], y: l.p[1], green: style === 'village' });
      occ.add(l.p[0], l.p[1], r);
    }
  }

  const clearOf = (x, y, r) => roadGrid.clear(x, y) > r && waterGrid.clear(x, y) > r && !inSea(x, y) && x > IX0 + r && y > IY0 + r && x < IX1 - r && y < IY1 - r;

  // ---------------- buildings
  if (style !== 'region') {
    const rect = (cx, cy, w, h, ang) => {
      const c = Math.cos(ang), s = Math.sin(ang);
      return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s, cy + x * s + y * c]);
    };
    const tryPlace = (cx, cy, w, h, ang, special, force) => {
      const pts = rect(cx, cy, w, h, ang);
      const r = Math.min(w, h) / 2;
      if (!force) {
        if (!clearOf(cx, cy, r + 1)) return false;
        for (const [x, y] of pts) if (roadGrid.clear(x, y) < 1.5 || waterGrid.clear(x, y) < 1 || inSea(x, y)) return false;
        if (occ.hit(cx, cy, r * 0.95)) return false;
      }
      scene.buildings.push({ x: cx, y: cy, w, h, a: (ang * 180) / Math.PI, special, shade: R.next() });
      occ.add(cx, cy, Math.max(w, h) * 0.55);
      return true;
    };
    // landmark buildings first
    for (const l of allLocs) {
      const bb = BIG_BUILDING[l.kind];
      if (!bb || !bb[0]) continue;
      // orient along the nearest road, and sit beside it (so the location marker doesn't hide the building)
      let ang = 0;
      let best = Infinity, bp = l.p;
      for (const r of scene.roads)
        for (let i = 0; i < r.pts.length; i += 2) {
          const d = Math.hypot(r.pts[i][0] - l.p[0], r.pts[i][1] - l.p[1]);
          if (d < best) {
            best = d;
            bp = r.pts[i];
            const [tx, ty] = tangent(r.pts, i);
            ang = Math.atan2(ty, tx);
          }
        }
      const sc = style === 'city' ? 1.15 : style === 'village' ? 0.85 : 1;
      if (bb[2] !== 'castle' && bb[2] !== 'graveyard') {
        // push away from the road, on whichever side the location already leans to
        let nx = -Math.sin(ang), ny = Math.cos(ang);
        if ((l.p[0] - bp[0]) * nx + (l.p[1] - bp[1]) * ny < 0) (nx = -nx), (ny = -ny);
        const off = (bb[1] * sc) / 2 + 9;
        l.bpos = [l.p[0] + nx * off, l.p[1] + ny * off];
      }
      if (bb[2] === 'graveyard') {
        scene.graves.push({ x: l.p[0], y: l.p[1], a: (ang * 180) / Math.PI, w: 56 * sc, h: 40 * sc });
        occ.add(l.p[0], l.p[1], 30 * sc);
        continue;
      }
      const [bx, by] = l.bpos || l.p;
      scene.buildings.push({ x: bx, y: by, w: bb[0] * sc, h: bb[1] * sc, a: (ang * 180) / Math.PI, special: bb[2], shade: R.next(), loc: l.id });
      occ.add(bx, by, Math.max(bb[0], bb[1]) * 0.6 * sc);
      occ.add(l.p[0], l.p[1], 12);
    }
    // rows of houses along every road
    const density = style === 'city' ? 1.25 : style === 'town' ? 1.05 : 0.8;
    const roadsSorted = scene.roads.slice().sort((a, b) => (a.kind === 'main' ? -1 : 0) - (b.kind === 'main' ? -1 : 0));
    for (const road of roadsSorted) {
      const pts = resample(road.pts, 3);
      for (const side of [-1, 1]) {
        let s = R.next() * 10;
        let i = 0;
        let acc = 0;
        while (i < pts.length - 1) {
          const step = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]);
          acc += step;
          i++;
          if (acc < s) continue;
          const [x, y] = pts[i];
          const dc = Math.hypot(x - center[0], y - center[1]) / ext;
          const p = (style === 'city' ? 1.15 - dc * 0.5 : style === 'town' ? 1.25 - dc * 0.9 : 1.1 - dc) * density;
          const bw = (style === 'city' ? 12 : 14) + R.next() * (style === 'village' ? 10 : 14);
          const bd = 10 + R.next() * (style === 'city' ? 10 : 7);
          s = acc + bw + 2 + (style === 'village' ? 14 + R.next() * 30 : R.next() < 0.15 ? 10 : 1.5);
          if (R.next() > p) continue;
          const [tx, ty] = tangent(pts, i);
          const off = road.w / 2 + 2 + bd / 2;
          const cx = x - ty * side * off, cy = y + tx * side * off;
          const ang = Math.atan2(ty, tx);
          if (tryPlace(cx, cy, bw, bd, ang, null) && style === 'city' && R.next() < 0.75) {
            // second row behind
            const off2 = off + bd / 2 + 2 + (8 + R.next() * 6);
            tryPlace(x - ty * side * off2, y + tx * side * off2, bw * (0.7 + R.next() * 0.4), 12 + R.next() * 6, ang, null);
          }
        }
      }
    }
    // cottages & sheds off the roads, clustered toward the centre (villages and towns grow organically)
    let extra = style === 'village' ? 40 : style === 'town' ? 50 : 0;
    for (let i = 0; i < extra * 3 && extra > 0; i++) {
      const a = R.next() * Math.PI * 2, d = Math.sqrt(R.next()) * ext * (style === 'village' ? 0.75 : 0.85);
      const cx = center[0] + Math.cos(a) * d, cy = center[1] + Math.sin(a) * d;
      const bw = 12 + R.next() * 10, bd = 9 + R.next() * 6;
      const ang = a + Math.PI / 2 + (R.next() - 0.5) * 0.5;
      if (roadGrid.clear(cx, cy) > 30) continue; // stay near some lane
      if (tryPlace(cx, cy, bw, bd, ang, null) && --extra <= 0) break;
    }
    // farms & fields on the outskirts
    const nFields = style === 'village' ? 12 : style === 'town' ? 10 : 4;
    for (let i = 0; i < nFields * 6 && scene.fields.length < nFields; i++) {
      const a = R.next() * Math.PI * 2, d = ext * (0.75 + R.next() * 0.6);
      const cx = center[0] + Math.cos(a) * d, cy = center[1] + Math.sin(a) * d * 0.85;
      const w = 50 + R.next() * 70, h = 34 + R.next() * 46;
      if (!clearOf(cx, cy, Math.min(w, h) / 2) || occ.hit(cx, cy, Math.max(w, h) * 0.55)) continue;
      const ang = (R.next() - 0.5) * 0.8;
      const c = Math.cos(ang), s = Math.sin(ang);
      const pts = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([x, y]) => [cx + x * c - y * s + (R.next() - 0.5) * 6, cy + x * s + y * c + (R.next() - 0.5) * 6]);
      scene.fields.push({ d: polyD(pts, true), a: (ang * 180) / Math.PI + (R.next() < 0.5 ? 0 : 90), x: cx, y: cy, tone: R.next() });
      occ.add(cx, cy, Math.max(w, h) * 0.5);
    }
    // town walls
    if (F.walls || style === 'city') buildWalls(scene, center, ext, seed, R, roadGrid, inSea, [IX0, IY0, IX1, IY1]);
  }

  // ---------------- region: settlements, mountains, hills
  if (style === 'region') {
    for (const l of allLocs) {
      if (SETTLEMENT.has(l.kind) || ['castle', 'keep', 'manor'].includes(l.kind)) {
        const n = l.kind === 'city' ? 22 : l.kind === 'town' ? 13 : l.kind === 'village' ? 6 : 0;
        const houses = [];
        for (let i = 0; i < n; i++) {
          const a = R.next() * Math.PI * 2, d = Math.sqrt(R.next()) * (l.kind === 'city' ? 22 : l.kind === 'town' ? 17 : 12);
          houses.push({ x: l.p[0] + Math.cos(a) * d, y: l.p[1] + Math.sin(a) * d * 0.8, w: 7 + R.next() * 4, h: 5 + R.next() * 3, a: (R.next() - 0.5) * 60 });
        }
        if (l.kind === 'town' || l.kind === 'city') houses.push({ x: l.p[0], y: l.p[1] - 2, w: 11, h: 8, a: 0, church: true });
        scene.settlements.push({ id: l.id, kind: l.kind, x: l.p[0], y: l.p[1], houses, walled: l.kind === 'city', r: l.kind === 'city' ? 30 : 20 });
        occ.add(l.p[0], l.p[1], l.kind === 'city' ? 40 : 28);
      }
    }
    // mountains: around mountain locations + a noise ridge if hills are high
    const hills = F.hills ?? 0.3;
    for (const l of allLocs.filter((o) => o.kind === 'mountain')) {
      for (let i = 0; i < 14; i++) {
        const a = R.next() * Math.PI * 2, d = 14 + R.next() * 70;
        const x = l.p[0] + Math.cos(a) * d * 1.3, y = l.p[1] + Math.sin(a) * d * 0.8;
        if (clearOf(x, y, 12) && !occ.hit(x, y, 12)) {
          scene.mountains.push({ x, y, s: 20 + R.next() * 16 });
          occ.add(x, y, 14);
        }
      }
    }
    for (let y = IY0 + 20; y < IY1; y += 26)
      for (let x = IX0 + 20; x < IX1; x += 30) {
        const jx = x + (R.next() - 0.5) * 20, jy = y + (R.next() - 0.5) * 16;
        const n = fbm(jx / 260, jy / 260, seed + 55, 4);
        if (n > 0.66 - hills * 0.18 && clearOf(jx, jy, 12) && !occ.hit(jx, jy, 13)) {
          scene.mountains.push({ x: jx, y: jy, s: 16 + (n - 0.55) * 60 + R.next() * 6 });
          occ.add(jx, jy, 13);
        } else if (n > 0.56 - hills * 0.15 && R.next() < 0.5 && clearOf(jx, jy, 10) && !occ.hit(jx, jy, 11)) {
          scene.hills.push({ x: jx, y: jy, s: 14 + R.next() * 8 });
          occ.add(jx, jy, 11);
        }
      }
    scene.mountains.sort((a, b) => a.y - b.y);
  } else if ((F.hills || 0) > 0) {
    const n = Math.round((F.hills || 0) * 30);
    for (let i = 0; i < n * 4 && scene.hills.length < n; i++) {
      const x = IX0 + R.next() * (IX1 - IX0), y = IY0 + R.next() * (IY1 - IY0);
      if (Math.hypot(x - center[0], y - center[1]) < ext * 1.05) continue;
      if (clearOf(x, y, 14) && !occ.hit(x, y, 16)) {
        scene.hills.push({ x, y, s: 18 + R.next() * 10 });
        occ.add(x, y, 16);
      }
    }
  }

  // ---------------- forests (stamped tree glyphs)
  const forest = F.forest ?? 0.3;
  if (forest > 0) {
    const step = style === 'region' ? 13 : 15;
    for (let y = IY0 + 8; y < IY1 - 4; y += step * 0.86)
      for (let x = IX0 + 8; x < IX1 - 4; x += step) {
        const jx = x + (R.next() - 0.5) * step * 0.8, jy = y + (R.next() - 0.5) * step * 0.8;
        const n = fbm(jx / 210, jy / 210, seed + 77, 4);
        const core = style === 'region' ? 1 : clamp((Math.hypot(jx - center[0], jy - center[1]) - ext * 0.8) / (ext * 0.5), 0, 1);
        const thr = 0.68 - forest * 0.18;
        if (n * (0.7 + core * 0.3) < thr) continue;
        const s = (style === 'region' ? 8 : 9) + R.next() * 5;
        if (!clearOf(jx, jy, s * 0.6) || occ.hit(jx, jy, s * 0.55)) continue;
        scene.trees.push({ x: jx, y: jy, s, v: (R.next() * 3) | 0, pine: fbm(jx / 90, jy / 90, seed + 99, 2) > 0.55 });
      }
    // a few lone trees in town gaps
    if (style !== 'region')
      for (let i = 0; i < 70; i++) {
        const a = R.next() * Math.PI * 2, d = R.next() * ext;
        const x = center[0] + Math.cos(a) * d, y = center[1] + Math.sin(a) * d;
        if (clearOf(x, y, 6) && !occ.hit(x, y, 6)) {
          scene.trees.push({ x, y, s: 7 + R.next() * 3, v: (R.next() * 3) | 0 });
          occ.add(x, y, 5);
        }
      }
    scene.trees.sort((a, b) => a.y - b.y);
  }

  finishScene(scene, allLocs, shown, knowledge, R, seed, style, secretLocs);
  return scene;
}

function buildWalls(scene, center, ext, seed, R, roadGrid, inSea, bounds) {
  const pts = [];
  const N = 22;
  const B = scene.buildings;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let r = ext * 0.45;
    for (const b of B) {
      const ba = Math.atan2(b.y - center[1], b.x - center[0]);
      let da = Math.abs(ba - a);
      da = Math.min(da, Math.PI * 2 - da);
      if (da < Math.PI / N * 1.6) r = Math.max(r, Math.hypot(b.x - center[0], b.y - center[1]) + 18);
    }
    r = Math.min(r, ext * 1.05);
    let p = [center[0] + Math.cos(a) * r, center[1] + Math.sin(a) * r];
    p = [clamp(p[0], bounds[0] + 14, bounds[2] - 14), clamp(p[1], bounds[1] + 14, bounds[3] - 14)];
    pts.push(p);
  }
  // smooth radii a little
  const sm = pts.map((p, i) => {
    const a = pts[(i + N - 1) % N], b = pts[(i + 1) % N];
    return [(a[0] + p[0] * 2 + b[0]) / 4, (a[1] + p[1] * 2 + b[1]) / 4];
  });
  // split the ring where it would run into the sea
  const segs = [];
  let cur = [];
  for (let i = 0; i <= N; i++) {
    const p = sm[i % N];
    if (inSea(p[0], p[1])) {
      if (cur.length > 1) segs.push(cur);
      cur = [];
    } else cur.push(p);
  }
  if (cur.length > 1) segs.push(cur);
  const towers = [];
  for (const s of segs) for (let i = 0; i < s.length; i++) if (i % 2 === 0) towers.push(s[i]);
  // gates where roads cross the wall
  const gates = [];
  for (const road of scene.roads) {
    if (road.kind !== 'main') continue;
    for (const s of segs)
      for (let i = 0; i < s.length - 1; i++)
        for (let j = 0; j < road.pts.length - 1; j++) {
          const hit = segIntersect(s[i], s[i + 1], road.pts[j], road.pts[j + 1]);
          if (hit && !gates.some((g) => Math.hypot(g.x - hit[0], g.y - hit[1]) < 30)) gates.push({ x: hit[0], y: hit[1], a: (hit[2] * 180) / Math.PI });
        }
  }
  scene.walls = { paths: segs.map((s) => polyD(s)), towers, gates };
}

// ------------------------------------------------------------------ dungeon overview
function buildDungeon(scene, map, allLocs, byId, shown, knowledge, R, seed, P, secretLocs = []) {
  const SIZE = { room: [92, 66], graveyard: [128, 82], temple: [118, 86], jail: [104, 58], well: [62, 62], portal: [70, 70], dungeon: [100, 70], cave: [96, 74], landmark: [80, 60] };
  const rooms = allLocs.map((l, i) => {
    const [bw, bh] = SIZE[l.kind] || SIZE.room;
    const k = 0.85 + (hashStr(l.id) % 100) / 300;
    return { id: l.id, loc: l, x: l.p[0], y: l.p[1], w: bw * k, h: bh * k, n: i + 1, round: l.kind === 'well' || l.kind === 'portal' };
  });
  // relax overlaps
  for (let it = 0; it < 40; it++) {
    for (let i = 0; i < rooms.length; i++)
      for (let j = i + 1; j < rooms.length; j++) {
        const a = rooms[i], b = rooms[j];
        const ox = (a.w + b.w) / 2 + 40 - Math.abs(a.x - b.x), oy = (a.h + b.h) / 2 + 40 - Math.abs(a.y - b.y);
        if (ox > 0 && oy > 0) {
          if (ox < oy) {
            const s = a.x < b.x ? -1 : 1;
            a.x += (s * ox) / 2;
            b.x -= (s * ox) / 2;
          } else {
            const s = a.y < b.y ? -1 : 1;
            a.y += (s * oy) / 2;
            b.y -= (s * oy) / 2;
          }
        }
      }
    for (const r of rooms) {
      r.x = clamp(r.x, M + r.w / 2 + 20, AW - M - r.w / 2 - 20);
      r.y = clamp(r.y, M + r.h / 2 + 20, AH - M - r.h / 2 - 20);
    }
  }
  const roomOf = new Map(rooms.map((r) => [r.id, r]));
  const visRoom = (r) => shown.has(r.id);
  const CW = 18;
  const corridor = (a, b, hFirst) => {
    const p0 = [a.x, a.y], p2 = [b.x, b.y];
    const mid = hFirst ? [b.x, a.y] : [a.x, b.y];
    return [p0, mid, p2];
  };
  for (const [ia, ib] of map.connections || []) {
    const a = roomOf.get(ia), b = roomOf.get(ib);
    if (!a || !b) continue;
    const both = visRoom(a) && visRoom(b);
    if (!both && knowledge) continue;
    const hFirst = Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? true : (hashStr(ia + ib) & 1) === 1;
    const pts = corridor(a, b, hFirst);
    scene.corridors.push({ d: polyD(pts), secret: a.loc.secret || b.loc.secret });
    // doors where the corridor leaves each room
    for (const [r, p, q] of [[a, pts[0], pts[1]], [b, pts[2], pts[1]]]) {
      const dx = Math.sign(q[0] - p[0]), dy = Math.sign(q[1] - p[1]);
      if (r.round) continue;
      const dxp = dx ? r.x + (dx * r.w) / 2 : r.x, dyp = dy ? r.y + (dy * r.h) / 2 : r.y;
      scene.doors.push({ x: dx ? dxp : r.x, y: dy ? dyp : r.y, v: !!dx });
    }
  }
  // entrance from a map edge
  for (const side of (map.features && map.features.roads) || []) {
    const target = rooms.slice().sort((a, b) => (side === 's' ? b.y - a.y : side === 'n' ? a.y - b.y : side === 'e' ? b.x - a.x : a.x - b.x))[0];
    if (!target || (knowledge && !visRoom(target))) continue;
    const edge = side === 's' ? [target.x, AH + 10] : side === 'n' ? [target.x, -10] : side === 'e' ? [AW + 10, target.y] : [-10, target.y];
    scene.corridors.push({ d: polyD([edge, [target.x, target.y]]), entrance: true });
    scene.entrance = { x: side === 'e' || side === 'w' ? (target.x + edge[0]) / 2 : target.x, y: side === 's' || side === 'n' ? (target.y + edge[1]) / 2 + (side === 's' ? target.h / 4 : -target.h / 4) : target.y, v: side === 's' || side === 'n' };
  }
  for (const r of rooms) {
    if (!visRoom(r) && knowledge) continue;
    const feats = [];
    const RR = makeRand(hashStr(r.id) ^ seed);
    const k = r.loc.kind;
    if (k === 'graveyard') for (let i = 0; i < 6; i++) feats.push({ t: 'coffin', x: r.x - r.w / 2 + 18 + (i % 3) * ((r.w - 36) / 2), y: r.y + (i < 3 ? -r.h / 4 : r.h / 4) });
    else if (k === 'temple') {
      feats.push({ t: 'altar', x: r.x, y: r.y - r.h / 2 + 18 });
      for (let i = 0; i < 3; i++) for (const s of [-1, 1]) feats.push({ t: 'pillar', x: r.x + s * r.w * 0.3, y: r.y - r.h * 0.15 + i * r.h * 0.25 });
    } else if (k === 'jail') for (let i = 0; i < 4; i++) feats.push({ t: 'cell', x: r.x - r.w / 2 + 12 + i * ((r.w - 24) / 4), y: r.y - r.h / 2, w: (r.w - 24) / 4 });
    else if (k === 'well') feats.push({ t: 'well', x: r.x, y: r.y });
    else if (k === 'portal') feats.push({ t: 'portal', x: r.x, y: r.y });
    else if (RR.next() < 0.6) for (let i = 0; i < 4; i++) feats.push({ t: 'pillar', x: r.x + (i % 2 ? 1 : -1) * r.w * 0.28, y: r.y + (i < 2 ? -1 : 1) * r.h * 0.25 });
    if (RR.next() < 0.4) feats.push({ t: 'rubble', x: r.x + (RR.next() - 0.5) * r.w * 0.6, y: r.y + (RR.next() - 0.5) * r.h * 0.6 });
    scene.rooms.push({ ...r, d: roomPath(r, RR), feats, secret: !!r.loc.secret });
  }
  scene.legend = rooms.filter((r) => !knowledge || visRoom(r)).map((r) => ({ n: r.n, name: r.loc.name, secret: r.loc.secret }));
  // place markers at room centres
  const locsAdj = allLocs.map((l) => {
    const r = roomOf.get(l.id);
    return { ...l, p: [r.x, r.y], room: r };
  });
  finishScene(scene, locsAdj, shown, knowledge, R, seed, 'dungeon', secretLocs);
  return scene;
}

function roomPath(r, RR) {
  if (r.round) {
    const pts = [];
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      const k = 1 + (RR.next() - 0.5) * 0.06;
      pts.push([r.x + Math.cos(a) * (r.w / 2) * k, r.y + Math.sin(a) * (r.h / 2) * k]);
    }
    return smoothD(pts, true);
  }
  // slightly hand-drawn rounded rectangle
  const x0 = r.x - r.w / 2, y0 = r.y - r.h / 2, x1 = r.x + r.w / 2, y1 = r.y + r.h / 2, c = 8;
  const j = () => (RR.next() - 0.5) * 2.2;
  return `M${f1(x0 + c)} ${f1(y0 + j())}L${f1(x1 - c)} ${f1(y0 + j())}Q${f1(x1)} ${f1(y0)} ${f1(x1 + j())} ${f1(y0 + c)}L${f1(x1 + j())} ${f1(y1 - c)}Q${f1(x1)} ${f1(y1)} ${f1(x1 - c)} ${f1(y1 + j())}L${f1(x0 + c)} ${f1(y1 + j())}Q${f1(x0)} ${f1(y1)} ${f1(x0 + j())} ${f1(y1 - c)}L${f1(x0 + j())} ${f1(y0 + c)}Q${f1(x0)} ${f1(y0)} ${f1(x0 + c)} ${f1(y0)}Z`;
}

// ------------------------------------------------------------------ markers, labels, fog, decorations
function finishScene(scene, allLocs, shown, knowledge, R, seed, style, secretLocs = []) {
  const big = (l) => (style === 'region' ? (l.kind === 'city' ? 22 : l.kind === 'town' ? 19 : l.kind === 'village' ? 16 : 14) : style === 'dungeon' ? 14 : 15);
  const boxes = [];
  const markers = [];
  const visLocs = [...allLocs, ...secretLocs].filter((l) => shown.has(l.id));
  for (const l of visLocs) {
    const r = style === 'region' && (l.kind === 'city' || l.kind === 'town' || l.kind === 'village') ? 0 : 11;
    markers.push({ loc: l, x: l.p[0], y: l.p[1], r, secret: !!l.secret, dm: !!l._dm || !knowledge, current: knowledge && knowledge.current === l.id });
    boxes.push([l.p[0] - 13, l.p[1] - 13, l.p[0] + 13, l.p[1] + 13]);
  }
  // labels with simple collision nudging (8 candidate positions)
  const overlaps = (b) => boxes.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]));
  for (const m of markers) {
    const size = big(m.loc);
    const text = m.loc.name || '';
    const tw = text.length * size * 0.5 + 6, th = size + 4;
    const off = (style === 'region' && !m.r ? 18 : 16) + (style === 'dungeon' && m.loc.room ? m.loc.room.h / 2 - 10 : 0);
    const cands = style === 'dungeon'
      ? [[0, off + th / 2, 'middle'], [0, -off - th / 2 + 4, 'middle'], [off + 6, 0, 'start'], [-off - 6, 0, 'end']]
      : [[off, 0, 'start'], [-off, 0, 'end'], [0, -off - 4, 'middle'], [0, off + th / 2 + 2, 'middle'], [off * 0.8, -off * 0.8, 'start'], [-off * 0.8, -off * 0.8, 'end'], [off * 0.8, off * 0.9, 'start'], [-off * 0.8, off * 0.9, 'end']];
    let chosen = null;
    for (const [dx, dy, anchor] of cands) {
      const x = m.x + dx, y = m.y + dy;
      const x0 = anchor === 'start' ? x : anchor === 'end' ? x - tw : x - tw / 2;
      const b = [x0, y - th / 2, x0 + tw, y + th / 2];
      if (b[0] < M + 4 || b[2] > AW - M - 4 || b[1] < M + 4 || b[3] > AH - M - 4) continue;
      if (!overlaps(b)) {
        chosen = { x, y, anchor, b };
        break;
      }
    }
    if (!chosen) {
      const [dx, dy, anchor] = cands[0];
      const x = m.x + dx, y = m.y + dy;
      chosen = { x, y, anchor, b: [x, y - th / 2, x + tw, y + th / 2] };
    }
    boxes.push(chosen.b);
    m.label = { x: chosen.x, y: chosen.y + size * 0.35, anchor: chosen.anchor, size, text };
  }
  scene.markers = markers;
  // fog for players who don't own the map
  if (knowledge && !knowledge.owned) {
    scene.fog = { holes: visLocs.map((l) => ({ x: l.p[0], y: l.p[1], r: style === 'region' ? 150 : style === 'dungeon' ? 120 : 130 })) };
  }
  // compass + title cartouche, placed in emptier corners
  const corners = [
    [AW - M - 80, AH - M - 80],
    [AW - M - 80, M + 80],
    [M + 80, AH - M - 80],
    [M + 80, M + 80],
  ];
  const crowd = (x, y) => allLocs.filter((l) => Math.hypot(l.p[0] - x, l.p[1] - y) < 190).length;
  const sorted = corners.slice().sort((a, b) => crowd(a[0], a[1]) - crowd(b[0], b[1]));
  scene.compass = { x: sorted[0][0], y: sorted[0][1], r: 54 };
  // title: top edge, choose the side with fewer labels
  const leftCrowd = allLocs.filter((l) => l.p[1] < 220 && l.p[0] < AW / 2).length;
  const rightCrowd = allLocs.filter((l) => l.p[1] < 220 && l.p[0] >= AW / 2).length;
  const tw = Math.max(260, scene.name.length * 21 + 90);
  let tx = leftCrowd <= rightCrowd ? M + 24 + tw / 2 : AW - M - 24 - tw / 2;
  if (Math.abs(tx - scene.compass.x) < tw / 2 + 70 && scene.compass.y < AH / 2) tx = AW - tx;
  scene.title = { x: tx, y: M + 46, w: tw, text: scene.name, sub: scene.description };
  if (scene.legend) {
    const lw = 250, lh = 28 + scene.legend.length * 19;
    const spots = [[AW - M - lw - 14, AH - M - lh - 14], [M + 14, AH - M - lh - 14], [AW - M - lw - 14, M + 90], [M + 14, M + 90]];
    const score = ([x, y]) => scene.rooms.filter((r) => r.x + r.w / 2 > x - 20 && r.x - r.w / 2 < x + lw + 20 && r.y + r.h / 2 > y - 20 && r.y - r.h / 2 < y + lh + 20).length;
    const best = spots.slice().sort((a, b) => score(a) - score(b))[0];
    scene.legendBox = { x: best[0], y: best[1], w: lw, h: lh };
    if (Math.abs(best[0] + lw / 2 - scene.compass.x) < lw && Math.abs(best[1] + lh / 2 - scene.compass.y) < lh) scene.compass = { x: sorted[1][0], y: sorted[1][1], r: 54 };
  }
  // parchment stains
  scene.stains = [];
  for (let i = 0; i < 7; i++) scene.stains.push({ x: R.next() * AW, y: R.next() * AH, r: 40 + R.next() * 120, o: 0.04 + R.next() * 0.06 });
}
