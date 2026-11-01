// Procedural terrain textures for the battle map base layer.
import { makeRand, fbm } from './rng.js';
import { makeCanvas, shade, mix, rgba, vary, noiseCanvas, speckleCanvas, noiseOverlay, blob, irregularPoly, angularPoly, Batch } from './paint.js';
import { buildField, fieldMask, bandMask, drawMaskScaled, cellsPath } from './masks.js';

const WALKABLE_FLOOR = new Set(['.', ',', '"', '=', '_', ':', '~', 'w', '%']);

/** Pre-digest a TacticalMap into lookup tables used by every painter. */
export function analyzeMap(map) {
  const w = map.w | 0, h = map.h | 0;
  const raw = String(map.tiles || '');
  const tiles = new Array(w * h);
  for (let i = 0; i < w * h; i++) tiles[i] = raw[i] ?? ' ';
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? ' ' : tiles[y * w + x]);
  const isWall = (x, y) => at(x, y) === '#';
  // resolve door cells to the floor type around them
  const floor = tiles.slice();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (tiles[y * w + x] !== '+') continue;
      const cnt = {};
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const t = at(x + dx, y + dy);
        if (WALKABLE_FLOOR.has(t) && t !== 'w' && t !== '~') cnt[t] = (cnt[t] || 0) + (dx && dy ? 1 : 2);
      }
      let best = '.', bn = -1;
      for (const k in cnt) if (cnt[k] > bn) (best = k), (bn = cnt[k]);
      floor[y * w + x] = best;
    }
  const counts = {};
  for (const t of floor) counts[t] = (counts[t] || 0) + 1;
  const doorAt = new Map();
  for (const d of map.doors || []) doorAt.set(`${d.x},${d.y}`, d);
  const floorAt = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? ' ' : floor[y * w + x]);
  // distance (Chebyshev, capped) from each wall cell to the nearest non-wall, non-void cell
  const wallDist = new Uint8Array(w * h);
  const INF = 255;
  for (let i = 0; i < w * h; i++) wallDist[i] = tiles[i] === '#' ? INF : 0;
  for (let pass = 0; pass < 2; pass++) {
    // two-pass chamfer (forward/backward), Chebyshev metric
    const ys = pass === 0 ? [...Array(h).keys()] : [...Array(h).keys()].reverse();
    const xs = pass === 0 ? [...Array(w).keys()] : [...Array(w).keys()].reverse();
    const s = pass === 0 ? -1 : 1;
    for (const y of ys)
      for (const x of xs) {
        const i = y * w + x;
        if (tiles[i] !== '#') continue;
        let m = wallDist[i];
        for (const [dx, dy] of [[s, 0], [0, s], [s, s], [-s, s]]) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const t = tiles[ny * w + nx];
          const v = t === ' ' ? INF - 1 : wallDist[ny * w + nx];
          if (v + 1 < m) m = v + 1;
        }
        wallDist[i] = m;
      }
  }
  return { w, h, tiles, at, isWall, floor, floorAt, counts, doorAt, wallDist, map };
}

// --------------------------------------------------------------------------------------------
// individual painters: paint(ctx, cells, ctxInfo) — must fully cover every cell in `cells`
// --------------------------------------------------------------------------------------------

function fillCells(ctx, cells, S, color) {
  ctx.fillStyle = color;
  for (const [x, y] of cells) ctx.fillRect(x * S, y * S, S, S);
}

function bboxOf(cells) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of cells) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x + 1 > x1) x1 = x + 1;
    if (y + 1 > y1) y1 = y + 1;
  }
  return { x0, y0, x1, y1 };
}

function overlays(ctx, cells, S, seed, coarse = 0.55, fine = 0.35) {
  const b = bboxOf(cells);
  const X = b.x0 * S, Y = b.y0 * S, W = (b.x1 - b.x0) * S, H = (b.y1 - b.y0) * S;
  noiseOverlay(ctx, X, Y, W, H, noiseCanvas(256, 5, seed % 997, 4), S * 7, coarse, 'soft-light');
  noiseOverlay(ctx, X, Y, W, H, noiseCanvas(128, 10, (seed + 3) % 997, 3), S * 1.6, fine, 'soft-light');
}

function paintGrass(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  const g = pal.grass;
  fillCells(ctx, cells, S, g.base);
  for (const [x, y] of cells) {
    for (let k = 0; k < 2; k++) {
      const c = [g.light, g.dark, g.warm, g.light][(R.next() * 4) | 0];
      blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * (0.7 + R.next() * 1.3), c, 0.12 + R.next() * 0.2);
    }
  }
  overlays(ctx, cells, S, seed, 0.6, 0.4);
  // tufts of grass blades
  const dark = new Path2D(), mid = new Path2D(), light = new Path2D();
  for (const [x, y] of cells) {
    const n = 9 + ((R.next() * 6) | 0);
    for (let t = 0; t < n; t++) {
      const bx = (x + R.next()) * S, by = (y + R.next()) * S;
      const blades = 3 + ((R.next() * 3) | 0);
      const p = R.next() < 0.55 ? dark : R.next() < 0.6 ? mid : light;
      for (let b = 0; b < blades; b++) {
        const a = -Math.PI / 2 + (R.next() - 0.5) * 1.7;
        const len = S * (0.05 + R.next() * 0.08);
        const bend = (R.next() - 0.5) * len * 0.6;
        p.moveTo(bx, by);
        p.quadraticCurveTo(bx + Math.cos(a) * len * 0.5 + bend, by + Math.sin(a) * len * 0.5, bx + Math.cos(a) * len, by + Math.sin(a) * len);
      }
    }
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = S * 0.018;
  ctx.strokeStyle = rgba(shade(g.dark, -0.25), 0.55);
  ctx.stroke(dark);
  ctx.strokeStyle = rgba(g.dark, 0.5);
  ctx.stroke(mid);
  ctx.lineWidth = S * 0.014;
  ctx.strokeStyle = rgba(shade(g.light, 0.15), 0.55);
  ctx.stroke(light);
  // flowers & clover
  const fl = new Batch();
  for (const [x, y] of cells) {
    if (R.next() < 0.1) {
      const col = g.flowers[(R.next() * g.flowers.length) | 0];
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S;
      const k = 3 + ((R.next() * 5) | 0);
      for (let i = 0; i < k; i++) {
        const p = fl.path(rgba(col, 0.85));
        const fx = cx + (R.next() - 0.5) * S * 0.35, fy = cy + (R.next() - 0.5) * S * 0.35;
        p.moveTo(fx + S * 0.018, fy);
        p.arc(fx, fy, S * 0.018, 0, Math.PI * 2);
      }
    }
    if (R.next() < 0.05) {
      // pebble
      const p = fl.path(rgba('#8a857a', 0.9));
      irregularPoly(p, (x + R.next()) * S, (y + R.next()) * S, S * 0.05, S * 0.04, R.next() * 3, R.next, 6, 0.3);
    }
  }
  fl.fill(ctx);
}

function paintDirt(ctx, cells, I, palKey = 'dirt') {
  const { S, R, pal, seed } = I;
  const d = pal[palKey];
  fillCells(ctx, cells, S, d.base);
  for (const [x, y] of cells) {
    for (let k = 0; k < 2; k++) {
      const c = R.next() < 0.5 ? d.light : d.dark;
      blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * (0.5 + R.next() * 1.2), c, 0.15 + R.next() * 0.25);
    }
  }
  overlays(ctx, cells, S, seed + 11, 0.7, 0.5);
  noiseOverlay(ctx, bboxOf(cells).x0 * S, bboxOf(cells).y0 * S, (bboxOf(cells).x1 - bboxOf(cells).x0) * S, (bboxOf(cells).y1 - bboxOf(cells).y0) * S, speckleCanvas(128, seed % 31), S * 1.2, 0.18, 'soft-light');
  // pebbles + scuffs
  const sh = new Path2D(), pb = new Batch(), hi = new Path2D(), sc = new Path2D();
  const pcols = [d.pebble || '#8b8478', shade(d.base, 0.2), shade(d.base, -0.2), '#7c7468'];
  for (const [x, y] of cells) {
    const n = 2 + ((R.next() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S, r = S * (0.018 + R.next() * 0.04);
      irregularPoly(sh, cx + r * 0.35, cy + r * 0.45, r, r * 0.8, 0, R.next, 6, 0.3);
      irregularPoly(pb.path(pcols[(R.next() * pcols.length) | 0]), cx, cy, r, r * 0.8, R.next() * 3, R.next, 6, 0.3);
      hi.moveTo(cx - r * 0.3 + r * 0.25, cy - r * 0.3);
      hi.arc(cx - r * 0.3, cy - r * 0.3, r * 0.25, 0, Math.PI * 2);
    }
    if (R.next() < 0.35) {
      const sx = (x + R.next()) * S, sy = (y + R.next()) * S, a = R.next() * Math.PI;
      const L = S * (0.15 + R.next() * 0.25);
      sc.moveTo(sx, sy);
      sc.quadraticCurveTo(sx + Math.cos(a) * L * 0.5 + (R.next() - 0.5) * S * 0.1, sy + Math.sin(a) * L * 0.5, sx + Math.cos(a) * L, sy + Math.sin(a) * L);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill(sh);
  pb.fill(ctx);
  ctx.fillStyle = 'rgba(255,255,255,0.18)';
  ctx.fill(hi);
  ctx.strokeStyle = rgba(d.dark, 0.35);
  ctx.lineWidth = S * 0.012;
  ctx.lineCap = 'round';
  ctx.stroke(sc);
}

function crackPath(p, x, y, dir, len, R, S, depth = 0) {
  let cx = x, cy = y;
  p.moveTo(cx, cy);
  const segs = 3 + ((R.next() * 3) | 0);
  for (let i = 0; i < segs; i++) {
    dir += (R.next() - 0.5) * 1.1;
    const l = len / segs;
    cx += Math.cos(dir) * l;
    cy += Math.sin(dir) * l;
    p.lineTo(cx, cy);
    if (depth < 1 && R.next() < 0.3) {
      crackPath(p, cx, cy, dir + R.sign() * (0.6 + R.next() * 0.6), len * 0.4, R, S, depth + 1);
      p.moveTo(cx, cy);
    }
  }
}

function paintFlags(ctx, cells, I) {
  const { S, R, pal, seed, info } = I;
  const st = pal.stone;
  const marble = st.style === 'marble';
  fillCells(ctx, cells, S, st.grout);
  const inSet = new Set(cells.map(([x, y]) => `${x},${y}`));
  const used = new Set();
  const slabs = [];
  const sorted = cells.slice().sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  for (const [x, y] of sorted) {
    const k = `${x},${y}`;
    if (used.has(k)) continue;
    used.add(k);
    const free = (xx, yy) => inSet.has(`${xx},${yy}`) && !used.has(`${xx},${yy}`);
    const r = R.next();
    if (r < 0.14 && free(x + 1, y)) {
      used.add(`${x + 1},${y}`);
      slabs.push([x, y, 2, 1]);
      continue;
    }
    if (r < 0.24 && free(x, y + 1)) {
      used.add(`${x},${y + 1}`);
      slabs.push([x, y, 1, 2]);
      continue;
    }
    const q = R.next();
    if (q < 0.5) slabs.push([x, y, 1, 1]);
    else if (q < 0.7) {
      const s = 0.4 + R.next() * 0.2;
      slabs.push([x, y, s, 1], [x + s, y, 1 - s, 1]);
    } else if (q < 0.88) {
      const s = 0.4 + R.next() * 0.2;
      slabs.push([x, y, 1, s], [x, y + s, 1, 1 - s]);
    } else {
      slabs.push([x, y, 0.5, 0.5], [x + 0.5, y, 0.5, 0.5], [x, y + 0.5, 0.5, 0.5], [x + 0.5, y + 0.5, 0.5, 0.5]);
    }
  }
  const g = S * 0.028;
  const j = S * 0.012;
  const hiP = new Path2D(), loP = new Path2D(), crackP = new Path2D(), crackHi = new Path2D();
  for (const [sx, sy, sw, sh] of slabs) {
    const x0 = sx * S + g, y0 = sy * S + g, x1 = (sx + sw) * S - g, y1 = (sy + sh) * S - g;
    const p = [
      [x0 + (R.next() - 0.5) * j, y0 + (R.next() - 0.5) * j],
      [x1 + (R.next() - 0.5) * j, y0 + (R.next() - 0.5) * j],
      [x1 + (R.next() - 0.5) * j, y1 + (R.next() - 0.5) * j],
      [x0 + (R.next() - 0.5) * j, y1 + (R.next() - 0.5) * j],
    ];
    ctx.beginPath();
    ctx.moveTo(p[0][0], p[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(p[i][0], p[i][1]);
    ctx.closePath();
    const col = vary(st.base, R.next, marble ? 0.05 : 0.1, 0.04);
    const grd = ctx.createLinearGradient(x0, y0, x1, y1);
    grd.addColorStop(0, shade(col, 0.06));
    grd.addColorStop(1, shade(col, -0.07));
    ctx.fillStyle = grd;
    ctx.fill();
    // bevel
    hiP.moveTo(p[3][0], p[3][1]);
    hiP.lineTo(p[0][0], p[0][1]);
    hiP.lineTo(p[1][0], p[1][1]);
    loP.moveTo(p[1][0], p[1][1]);
    loP.lineTo(p[2][0], p[2][1]);
    loP.lineTo(p[3][0], p[3][1]);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (R.next() < 0.14) {
      ctx.save();
      ctx.clip();
      blob(ctx, cx + (R.next() - 0.5) * (x1 - x0), cy + (R.next() - 0.5) * (y1 - y0), S * (0.2 + R.next() * 0.35), R.next() < 0.75 ? '#2a241d' : '#4d5a33', 0.08 + R.next() * 0.1);
      ctx.restore();
    }
    if (marble && R.next() < 0.6) {
      // veins
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = rgba(shade(st.dark, -0.2), 0.25);
      ctx.lineWidth = S * 0.008;
      ctx.beginPath();
      let vx = x0, vy = y0 + R.next() * (y1 - y0);
      ctx.moveTo(vx, vy);
      while (vx < x1) {
        vx += S * 0.08;
        vy += (R.next() - 0.5) * S * 0.12;
        ctx.lineTo(vx, vy);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (R.next() < (marble ? 0.05 : 0.14)) {
      const side = (R.next() * 4) | 0;
      const ex = side === 0 ? x0 + R.next() * (x1 - x0) : side === 1 ? x1 : side === 2 ? x0 + R.next() * (x1 - x0) : x0;
      const ey = side === 0 ? y0 : side === 1 ? y0 + R.next() * (y1 - y0) : side === 2 ? y1 : y0 + R.next() * (y1 - y0);
      const dir = Math.atan2(cy - ey, cx - ex) + (R.next() - 0.5) * 0.8;
      const L = Math.min(x1 - x0, y1 - y0) * (0.4 + R.next() * 0.6);
      crackPath(crackP, ex, ey, dir, L, R, S);
    }
    if (R.next() < 0.08) {
      // chipped corner
      const c = p[(R.next() * 4) | 0];
      const s = S * (0.05 + R.next() * 0.06);
      const dx = c[0] < cx ? 1 : -1, dy = c[1] < cy ? 1 : -1;
      ctx.fillStyle = rgba(st.grout, 0.9);
      ctx.beginPath();
      ctx.moveTo(c[0], c[1]);
      ctx.lineTo(c[0] + dx * s, c[1]);
      ctx.lineTo(c[0] + dx * s * 0.3, c[1] + dy * s * 0.4);
      ctx.lineTo(c[0], c[1] + dy * s);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = S * 0.02;
  ctx.strokeStyle = 'rgba(255,255,255,0.11)';
  ctx.stroke(hiP);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.stroke(loP);
  ctx.lineWidth = S * 0.012;
  ctx.strokeStyle = 'rgba(25,20,15,0.6)';
  ctx.stroke(crackP);
  ctx.save();
  ctx.translate(S * 0.01, S * 0.012);
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.stroke(crackP);
  ctx.restore();
  overlays(ctx, cells, S, seed + 23, marble ? 0.25 : 0.35, marble ? 0.15 : 0.35);
  // moss / grime near walls
  if (!marble) {
    for (const [x, y] of cells) {
      let nearWall = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (info.isWall(x + dx, y + dy)) nearWall++;
      if (nearWall && R.next() < 0.35) blob(ctx, (x + 0.5 + (R.next() - 0.5)) * S, (y + 0.5 + (R.next() - 0.5)) * S, S * (0.35 + R.next() * 0.4), R.next() < 0.5 ? '#3f4a2a' : '#2a241c', 0.18);
    }
  }
}

function paintCaveFloor(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  const st = pal.stone;
  fillCells(ctx, cells, S, st.base);
  for (const [x, y] of cells) {
    for (let k = 0; k < 2; k++) {
      const c = R.next() < 0.5 ? st.light : st.dark;
      blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * (0.6 + R.next() * 1.4), c, 0.15 + R.next() * 0.2);
    }
  }
  overlays(ctx, cells, S, seed + 41, 0.5, 0.3);
  const flat = new Batch(), sh = new Path2D(), pb = new Batch(), cr = new Path2D(), hi = new Path2D();
  for (const [x, y] of cells) {
    if (R.next() < 0.22) {
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S;
      irregularPoly(flat.path(rgba(R.next() < 0.6 ? st.light : st.dark, 0.35)), cx, cy, S * (0.25 + R.next() * 0.3), S * (0.2 + R.next() * 0.25), R.next() * 3, R.next, 7, 0.4);
    }
    const n = 1 + ((R.next() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S, r = S * (0.02 + R.next() * 0.05);
      angularPoly(sh, cx + r * 0.3, cy + r * 0.4, r, R.next, 6, 0.4);
      angularPoly(pb.path(vary(st.light, R.next, 0.12)), cx, cy, r, R.next, 6, 0.4);
      hi.moveTo(cx - r * 0.2, cy - r * 0.5);
      hi.lineTo(cx + r * 0.3, cy - r * 0.45);
    }
    if (R.next() < 0.12) crackPath(cr, (x + R.next()) * S, (y + R.next()) * S, R.next() * Math.PI * 2, S * (0.4 + R.next() * 0.6), R, S);
  }
  flat.fill(ctx);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fill(sh);
  pb.fill(ctx);
  ctx.strokeStyle = 'rgba(255,255,255,0.18)';
  ctx.lineWidth = S * 0.01;
  ctx.stroke(hi);
  ctx.strokeStyle = 'rgba(20,16,12,0.55)';
  ctx.lineWidth = S * 0.012;
  ctx.lineCap = 'round';
  ctx.stroke(cr);
}

function paintWood(ctx, cells, I, vertical = false) {
  const { S, R, pal, seed } = I;
  const wd = pal.wood;
  const b = bboxOf(cells);
  ctx.save();
  let X0 = b.x0 * S, Y0 = b.y0 * S, X1 = b.x1 * S, Y1 = b.y1 * S;
  if (vertical) {
    ctx.transform(0, 1, 1, 0, 0, 0); // swap axes
    [X0, Y0, X1, Y1] = [Y0, X0, Y1, X1];
  }
  ctx.fillStyle = wd.gap;
  ctx.fillRect(X0, Y0, X1 - X0, Y1 - Y0);
  const ph = S / 4;
  const grain = new Path2D(), gaps = new Path2D(), hi = new Path2D(), nails = new Path2D(), knots = new Path2D();
  for (let y = Y0; y < Y1; y += ph) {
    let x = X0 - R.next() * S * 2;
    while (x < X1) {
      const L = S * (1.3 + R.next() * 2.2);
      const col = vary(wd.base, R.next, 0.11, 0.05);
      const grd = ctx.createLinearGradient(0, y, 0, y + ph);
      grd.addColorStop(0, shade(col, 0.08));
      grd.addColorStop(0.5, col);
      grd.addColorStop(1, shade(col, -0.12));
      ctx.fillStyle = grd;
      ctx.fillRect(x, y, L, ph);
      // grain lines
      const lines = 2 + ((R.next() * 3) | 0);
      for (let i = 0; i < lines; i++) {
        const gy = y + ph * (0.15 + R.next() * 0.7);
        const amp = ph * (0.04 + R.next() * 0.08), fq = 0.5 + R.next() * 2, ph0 = R.next() * 6;
        grain.moveTo(x, gy);
        for (let t = 0; t <= 1.0001; t += 0.1) grain.lineTo(x + L * t, gy + Math.sin(ph0 + t * fq * 6) * amp);
      }
      if (R.next() < 0.18) {
        const kx = x + L * (0.2 + R.next() * 0.6), ky = y + ph * (0.3 + R.next() * 0.4);
        knots.moveTo(kx + ph * 0.18, ky);
        knots.ellipse(kx, ky, ph * 0.18, ph * 0.11, 0, 0, Math.PI * 2);
        knots.moveTo(kx + ph * 0.3, ky);
        knots.ellipse(kx, ky, ph * 0.3, ph * 0.17, 0, 0, Math.PI * 2);
      }
      gaps.rect(x + L - S * 0.012, y, S * 0.024, ph);
      gaps.rect(x, y + ph - S * 0.012, L, S * 0.02);
      hi.rect(x, y + S * 0.006, L, S * 0.01);
      for (const nx of [x + S * 0.06, x + L - S * 0.07]) {
        for (const ny of [y + ph * 0.3, y + ph * 0.7]) {
          nails.moveTo(nx + S * 0.009, ny);
          nails.arc(nx, ny, S * 0.009, 0, Math.PI * 2);
        }
      }
      x += L;
    }
  }
  ctx.strokeStyle = rgba(wd.dark, 0.38);
  ctx.lineWidth = S * 0.007;
  ctx.stroke(grain);
  ctx.strokeStyle = rgba(wd.dark, 0.55);
  ctx.lineWidth = S * 0.008;
  ctx.stroke(knots);
  ctx.fillStyle = 'rgba(255,230,190,0.08)';
  ctx.fill(hi);
  ctx.fillStyle = rgba(wd.gap, 0.85);
  ctx.fill(gaps);
  ctx.fillStyle = 'rgba(30,20,12,0.6)';
  ctx.fill(nails);
  ctx.restore();
  overlays(ctx, cells, S, seed + 59, 0.45, 0.25);
  // wear: darker in the middle of traffic, lighter scuffs
  for (const [x, y] of cells) if (R.next() < 0.1) blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * (0.4 + R.next() * 0.6), '#1d120a', 0.08);
}

function paintCobbles(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  const cb = pal.cobble;
  const rural = !!cb.rural;
  fillCells(ctx, cells, S, rural ? pal.dirt.dark : cb.grout);
  if (rural) for (const [x, y] of cells) blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * 0.9, pal.dirt.base, 0.4);
  const n = 4, sp = S / n;
  const pals = [cb.base, shade(cb.base, 0.1), shade(cb.base, -0.1), mix(cb.base, '#9a7a5a', 0.3), mix(cb.base, '#6a7a8a', 0.2), shade(cb.base, 0.18), shade(cb.base, -0.18)];
  const sh = new Path2D(), stones = new Batch(), hi = new Path2D(), lo = new Path2D(), tuft = new Path2D();
  for (const [x, y] of cells) {
    for (let j = 0; j < n; j++) {
      const off = j % 2 ? sp * 0.5 : 0;
      for (let i = 0; i < n + (off ? 1 : 0); i++) {
        if (rural && R.next() < 0.2) continue;
        const cx = x * S + i * sp + (off ? 0 : sp * 0.5) + (R.next() - 0.5) * sp * 0.2;
        const cy = y * S + (j + 0.5) * sp + (R.next() - 0.5) * sp * 0.2;
        if (cx < x * S - sp * 0.1 || cx > (x + 1) * S + sp * 0.1) continue;
        const rx = sp * (0.4 + R.next() * 0.1) * (rural ? 0.9 : 1), ry = sp * (0.36 + R.next() * 0.1) * (rural ? 0.9 : 1);
        const rot = (R.next() - 0.5) * 0.6;
        irregularPoly(sh, cx + sp * 0.06, cy + sp * 0.09, rx, ry, rot, R.next, 7, 0.18);
        irregularPoly(stones.path(pals[(R.next() * pals.length) | 0]), cx, cy, rx, ry, rot, R.next, 7, 0.18);
        hi.moveTo(cx - rx * 0.75, cy - ry * 0.05);
        hi.quadraticCurveTo(cx - rx * 0.6, cy - ry * 0.75, cx + rx * 0.1, cy - ry * 0.8);
        lo.moveTo(cx + rx * 0.75, cy + ry * 0.05);
        lo.quadraticCurveTo(cx + rx * 0.6, cy + ry * 0.75, cx - rx * 0.1, cy + ry * 0.8);
      }
    }
    if (rural && R.next() < 0.6) {
      for (let t = 0; t < 4; t++) {
        const bx = (x + R.next()) * S, by = (y + R.next()) * S;
        for (let b = 0; b < 3; b++) {
          const a = -Math.PI / 2 + (R.next() - 0.5) * 1.5;
          tuft.moveTo(bx, by);
          tuft.lineTo(bx + Math.cos(a) * S * 0.07, by + Math.sin(a) * S * 0.07);
        }
      }
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill(sh);
  stones.fill(ctx);
  ctx.lineCap = 'round';
  ctx.lineWidth = sp * 0.1;
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke(hi);
  ctx.strokeStyle = 'rgba(0,0,0,0.22)';
  ctx.stroke(lo);
  if (rural) {
    ctx.lineWidth = S * 0.014;
    ctx.strokeStyle = rgba(pal.grass.base, 0.8);
    ctx.stroke(tuft);
  }
  overlays(ctx, cells, S, seed + 71, 0.5, 0.3);
}

function paintSand(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  const sd = pal.sand;
  fillCells(ctx, cells, S, sd.base);
  for (const [x, y] of cells) blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * (0.6 + R.next()), R.next() < 0.5 ? sd.light : sd.dark, 0.25);
  const b = bboxOf(cells);
  const rl = new Path2D(), rd = new Path2D();
  for (let y = b.y0 * S; y < b.y1 * S; y += S * 0.22) {
    const p = R.next() < 0.5 ? rl : rd;
    const ph = R.next() * 10;
    p.moveTo(b.x0 * S, y);
    for (let x = b.x0 * S; x <= b.x1 * S; x += S * 0.2) p.lineTo(x, y + Math.sin(ph + x / (S * 0.7)) * S * 0.06 + Math.sin(x / (S * 2.3)) * S * 0.1);
  }
  ctx.lineWidth = S * 0.03;
  ctx.strokeStyle = rgba(sd.light, 0.25);
  ctx.stroke(rl);
  ctx.strokeStyle = rgba(sd.dark, 0.18);
  ctx.stroke(rd);
  overlays(ctx, cells, S, seed + 83, 0.4, 0.3);
  noiseOverlay(ctx, b.x0 * S, b.y0 * S, (b.x1 - b.x0) * S, (b.y1 - b.y0) * S, speckleCanvas(128, (seed + 5) % 31), S * 0.8, 0.35, 'soft-light');
  const pb = new Batch();
  for (const [x, y] of cells) {
    if (R.next() < 0.5) {
      const r = S * (0.015 + R.next() * 0.03);
      irregularPoly(pb.path(vary('#8f8270', R.next, 0.2)), (x + R.next()) * S, (y + R.next()) * S, r, r * 0.8, 0, R.next, 6, 0.3);
    }
  }
  pb.fill(ctx);
}

function paintWaterBed(ctx, cells, I, deep) {
  const { S, R, pal, seed } = I;
  const wt = pal.water;
  const col = deep ? wt.deep : wt.shallow;
  fillCells(ctx, cells, S, col);
  for (const [x, y] of cells) {
    blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * (0.6 + R.next() * 1.2), R.next() < 0.5 ? shade(col, 0.12) : shade(col, -0.2), 0.3);
  }
  if (!deep) {
    // riverbed pebbles seen through water
    const pb = new Batch();
    for (const [x, y] of cells) {
      const n = (R.next() * 4) | 0;
      for (let i = 0; i < n; i++) {
        const r = S * (0.03 + R.next() * 0.06);
        irregularPoly(pb.path(rgba(R.next() < 0.5 ? shade(col, -0.3) : shade(col, 0.18), 0.35)), (x + R.next()) * S, (y + R.next()) * S, r, r * 0.8, R.next() * 3, R.next, 6, 0.3);
      }
    }
    pb.fill(ctx);
  }
  overlays(ctx, cells, S, seed + (deep ? 97 : 89), 0.45, 0.25);
  // gentle wave strokes
  const wv = new Path2D();
  for (const [x, y] of cells) {
    if (R.next() < (deep ? 0.7 : 0.4)) {
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S, L = S * (0.18 + R.next() * 0.25);
      wv.moveTo(cx - L / 2, cy);
      wv.quadraticCurveTo(cx, cy - S * 0.05, cx + L / 2, cy);
    }
  }
  ctx.lineCap = 'round';
  ctx.lineWidth = S * 0.018;
  ctx.strokeStyle = rgba(shade(col, 0.35), deep ? 0.35 : 0.3);
  ctx.stroke(wv);
}

function paintRubble(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  const df = pal.diff;
  const baseCol = pal.stone.style === 'cave' ? pal.stone.base : df.base;
  fillCells(ctx, cells, S, shade(baseCol, -0.05));
  for (const [x, y] of cells) blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * 0.8, R.next() < 0.5 ? '#4a443d' : '#8a8378', 0.25);
  overlays(ctx, cells, S, seed + 101, 0.7, 0.5);
  const sh = new Path2D(), st = new Batch(), hi = new Path2D();
  const cols = df.stones || ['#7d776e', '#6a655d', '#8d877c', '#5b5650'];
  for (const [x, y] of cells) {
    const n = 7 + ((R.next() * 7) | 0);
    for (let i = 0; i < n; i++) {
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S;
      const r = S * (R.next() < 0.2 ? 0.1 + R.next() * 0.08 : 0.03 + R.next() * 0.06);
      const rot = R.next() * 6;
      const pts = angularPoly(st.path(vary(cols[(R.next() * cols.length) | 0], R.next, 0.1)), cx, cy, r, R.next, 5 + ((R.next() * 3) | 0), 0.5, rot);
      // shadow: same poly offset
      sh.moveTo(pts[0][0] + r * 0.35, pts[0][1] + r * 0.5);
      for (let k = 1; k < pts.length; k++) sh.lineTo(pts[k][0] + r * 0.35, pts[k][1] + r * 0.5);
      sh.closePath();
      hi.moveTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      hi.lineTo(pts[0][0], pts[0][1]);
      hi.lineTo(pts[1][0], pts[1][1]);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill(sh);
  st.fill(ctx);
  ctx.lineWidth = S * 0.012;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.stroke(hi);
}

function paintUndergrowth(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  const g = pal.grass;
  fillCells(ctx, cells, S, shade(g.dark, -0.15));
  overlays(ctx, cells, S, seed + 113, 0.6, 0.4);
  const sh = new Path2D(), leaves = new Batch(), thorns = new Path2D();
  const cols = [g.dark, shade(g.dark, 0.12), g.base, shade(g.base, 0.12), mix(g.dark, '#2f4a3a', 0.4), mix(g.base, g.warm, 0.4)];
  for (const [x, y] of cells) {
    const clumps = 4 + ((R.next() * 3) | 0);
    for (let c = 0; c < clumps; c++) {
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S;
      const n = 6 + ((R.next() * 6) | 0);
      for (let i = 0; i < n; i++) {
        const a = R.next() * Math.PI * 2, d = R.next() * S * 0.16;
        const lx = cx + Math.cos(a) * d, ly = cy + Math.sin(a) * d;
        const L = S * (0.05 + R.next() * 0.05), ang = a + (R.next() - 0.5);
        sh.moveTo(lx + S * 0.03 + L, ly + S * 0.04);
        sh.ellipse(lx + S * 0.03, ly + S * 0.04, L, L * 0.45, ang, 0, Math.PI * 2);
        const p = leaves.path(cols[(R.next() * cols.length) | 0]);
        p.moveTo(lx + L * Math.cos(ang), ly + L * Math.sin(ang));
        p.ellipse(lx, ly, L, L * 0.45, ang, 0, Math.PI * 2);
      }
    }
    if (R.next() < 0.5) {
      const sx = (x + R.next()) * S, sy = (y + R.next()) * S;
      thorns.moveTo(sx, sy);
      thorns.bezierCurveTo(sx + S * 0.2, sy - S * 0.2, sx + S * 0.3, sy + S * 0.1, sx + S * 0.45, sy - S * 0.05);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.fill(sh);
  leaves.fill(ctx);
  ctx.strokeStyle = rgba('#3b2a18', 0.6);
  ctx.lineWidth = S * 0.012;
  ctx.stroke(thorns);
  // leaf highlights
  noiseOverlay(ctx, bboxOf(cells).x0 * S, bboxOf(cells).y0 * S, (bboxOf(cells).x1 - bboxOf(cells).x0) * S, (bboxOf(cells).y1 - bboxOf(cells).y0) * S, noiseCanvas(128, 14, 9, 2), S * 0.9, 0.35, 'soft-light');
}

function paintMud(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  const d = pal.dirt;
  const base = shade(d.dark, -0.15);
  fillCells(ctx, cells, S, base);
  for (const [x, y] of cells) blob(ctx, (x + R.next()) * S, (y + R.next()) * S, S * (0.5 + R.next()), R.next() < 0.5 ? d.base : '#2a2014', 0.35);
  overlays(ctx, cells, S, seed + 127, 0.6, 0.4);
  const st = new Path2D(), pud = new Batch(), gl = new Path2D();
  for (const [x, y] of cells) {
    for (let i = 0; i < 3; i++) {
      const sx = (x + R.next()) * S, sy = (y + R.next()) * S, L = S * (0.2 + R.next() * 0.3), a = R.next() * Math.PI;
      st.moveTo(sx, sy);
      st.quadraticCurveTo(sx + Math.cos(a) * L * 0.5, sy + Math.sin(a) * L * 0.5 + S * 0.05, sx + Math.cos(a) * L, sy + Math.sin(a) * L);
    }
    if (R.next() < 0.45) {
      const cx = (x + R.next()) * S, cy = (y + R.next()) * S, rx = S * (0.1 + R.next() * 0.18);
      irregularPoly(pud.path(rgba(pal.water.shallow, 0.55)), cx, cy, rx, rx * 0.6, R.next() * 3, R.next, 7, 0.3);
      gl.moveTo(cx - rx * 0.5, cy - rx * 0.15);
      gl.quadraticCurveTo(cx - rx * 0.1, cy - rx * 0.35, cx + rx * 0.3, cy - rx * 0.2);
    }
  }
  ctx.strokeStyle = 'rgba(15,10,5,0.4)';
  ctx.lineWidth = S * 0.02;
  ctx.lineCap = 'round';
  ctx.stroke(st);
  pud.fill(ctx);
  ctx.strokeStyle = 'rgba(230,240,220,0.35)';
  ctx.lineWidth = S * 0.015;
  ctx.stroke(gl);
}

function paintVoidCells(ctx, cells, I) {
  const { S, R, pal, seed } = I;
  if (pal.seaVoid) {
    fillCells(ctx, cells, S, pal.voidColor);
    overlays(ctx, cells, S, seed + 131, 0.6, 0.3);
    const wv = new Path2D();
    for (const [x, y] of cells) {
      for (let i = 0; i < 2; i++) {
        const cx = (x + R.next()) * S, cy = (y + R.next()) * S, L = S * (0.3 + R.next() * 0.4);
        wv.moveTo(cx - L / 2, cy);
        wv.quadraticCurveTo(cx - L / 4, cy - S * 0.08, cx, cy);
        wv.quadraticCurveTo(cx + L / 4, cy - S * 0.08, cx + L / 2, cy);
      }
    }
    ctx.strokeStyle = 'rgba(160,200,220,0.25)';
    ctx.lineWidth = S * 0.02;
    ctx.stroke(wv);
    return;
  }
  fillCells(ctx, cells, S, pal.voidColor);
}

// --------------------------------------------------------------------------------------------
// orchestration
// --------------------------------------------------------------------------------------------

// terrain char -> { paint, organic, amp }
function terrainDefs(pal) {
  const cave = pal.stone.style === 'cave';
  return {
    '.': { paint: cave ? paintCaveFloor : paintFlags, organic: cave, ampA: 0.6, ampB: 0.2 },
    ',': { paint: paintDirt, organic: true, ampA: 0.7, ampB: 0.25 },
    '"': { paint: paintGrass, organic: true, ampA: 0.75, ampB: 0.25 },
    '=': { paint: paintWood, organic: false },
    '_': { paint: paintCobbles, organic: !!pal.cobble.rural, ampA: 0.45, ampB: 0.3 },
    ':': { paint: paintSand, organic: true, ampA: 0.7, ampB: 0.2 },
    '%': {
      paint: pal.diff.style === 'undergrowth' ? paintUndergrowth : pal.diff.style === 'mud' ? paintMud : paintRubble,
      organic: true,
      ampA: 0.8,
      ampB: 0.35,
    },
    // shallow + deep water are one layer: '~' paints both, deep water darkens smoothly inside it
    '~': { paint: (c, cells, I) => paintWaterBed(c, cells, I, false), organic: true, ampA: 0.8, ampB: 0.18, water: true },
    w: { paint: (c, cells, I) => paintWaterBed(c, cells, I, true), organic: true, ampA: 0.8, ampB: 0.18, water: true },
  };
}

// drawing order (bottom -> top) for non-base layers
const ORDER = ['=', '.', '_', ',', '"', ':', '%', '~'];

function dilate(info, pred) {
  const { w, h } = info;
  const out = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let hit = false;
      for (let dy = -1; dy <= 1 && !hit; dy++) for (let dx = -1; dx <= 1 && !hit; dx++) if (pred(x + dx, y + dy)) hit = true;
      if (hit) out.push([x, y]);
    }
  return out;
}

/** Choose plank orientation: along the longer axis of the bounding box of '=' cells. */
function woodVertical(info) {
  let x0 = Infinity, x1 = -1, y0 = Infinity, y1 = -1;
  for (let y = 0; y < info.h; y++)
    for (let x = 0; x < info.w; x++)
      if (info.floorAt(x, y) === '=') {
        x0 = Math.min(x0, x);
        x1 = Math.max(x1, x);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
  return y1 - y0 > (x1 - x0) * 1.25;
}

/**
 * Paint every terrain layer onto ctx (size w*S x h*S).
 * scratch: a reusable canvas of the same size.
 */
export function paintTerrain(ctx, scratch, info, pal, S, seed, nf) {
  const { w, h } = info;
  const R = makeRand(seed ^ 0x51ed);
  const defs = terrainDefs(pal);
  const I = { S, R, pal, seed, info, vertical: woodVertical(info) };
  const isFloorT = (t) => t !== '#' && t !== ' ';
  // base type = most common floor type
  let baseT = '.', bn = -1;
  for (const k in info.counts) if (isFloorT(k) && defs[k] && !defs[k].water && info.counts[k] > bn) (baseT = k), (bn = info.counts[k]);
  if (bn < 0) baseT = pal.outdoor ? '"' : '.';

  // void background
  ctx.fillStyle = pal.voidColor;
  ctx.fillRect(0, 0, w * S, h * S);

  // base layer covers every non-void cell (walls included so organic rock edges reveal floor)
  const baseCells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (info.at(x, y) !== ' ') baseCells.push([x, y]);
  if (baseCells.length) {
    const d = defs[baseT];
    if (baseT === '=') paintWood(ctx, baseCells, I, I.vertical);
    else d.paint(ctx, baseCells, I);
  }

  const sctx = scratch.getContext('2d');
  for (const t of ORDER) {
    const isWaterPass = t === '~';
    if (t === baseT || (!info.counts[t] && !(isWaterPass && info.counts.w))) continue;
    const d = defs[t];
    const member = isWaterPass ? (x, y) => info.floorAt(x, y) === '~' || info.floorAt(x, y) === 'w' : (x, y) => info.floorAt(x, y) === t;
    if (!d.organic) {
      const cells = [];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (member(x, y)) cells.push([x, y]);
      const bb = bboxOf(cells);
      sctx.save();
      sctx.clearRect(bb.x0 * S, bb.y0 * S, (bb.x1 - bb.x0) * S, (bb.y1 - bb.y0) * S);
      if (t === '=') paintWood(sctx, cells, I, I.vertical);
      else d.paint(sctx, cells, I);
      sctx.globalCompositeOperation = 'destination-in';
      sctx.fillStyle = '#fff';
      sctx.fill(cellsPath(w, h, member, S));
      sctx.restore();
      // soft contact shadow where a crisp floor meets other ground
      ctx.drawImage(scratch, bb.x0 * S, bb.y0 * S, (bb.x1 - bb.x0) * S, (bb.y1 - bb.y0) * S, bb.x0 * S, bb.y0 * S, (bb.x1 - bb.x0) * S, (bb.y1 - bb.y0) * S);
      continue;
    }
    const cells = dilate(info, member);
    const bb = bboxOf(cells);
    const field = buildField(nf, (x, y) => (member(x, y) ? 1 : 0), d.ampA, d.ampB);
    if (d.water) {
      // wet bank: darken ground just outside the water's edge
      const bank = fieldMask(nf, field, 0.36, 0.1, [40, 30, 18]);
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.globalCompositeOperation = 'multiply';
      drawMaskScaled(ctx, bank, nf, S, bb);
      ctx.restore();
    }
    const mask = fieldMask(nf, field, 0.5, 0.05);
    sctx.save();
    sctx.clearRect(bb.x0 * S, bb.y0 * S, (bb.x1 - bb.x0) * S, (bb.y1 - bb.y0) * S);
    d.paint(sctx, cells, I);
    if (d.water) {
      // smooth depth: deep cells fade to the deep colour, plus a soft darkening away from the shore
      if (info.counts.w) {
        const deepF = buildField(nf, (x, y) => (info.floorAt(x, y) === 'w' ? 1 : 0), 0.5, 0.1);
        const deep = fieldMask(nf, deepF, 0.45, 0.28, hexRgb(pal.water.deep));
        sctx.globalAlpha = 0.92;
        drawMaskScaled(sctx, deep, nf, S, bb);
      }
      const inner = fieldMask(nf, field, 0.95, 0.35, [0, 12, 28]);
      sctx.globalAlpha = 0.28;
      drawMaskScaled(sctx, inner, nf, S, bb);
      // lighter shallow shelf and a thin foam line at the shore
      sctx.globalAlpha = 0.38;
      const shelf = bandMask(nf, field, 0.5, 0.64, 0.05, hexRgb(shade(pal.water.shallow, 0.38)));
      drawMaskScaled(sctx, shelf, nf, S, bb);
      sctx.globalAlpha = 0.55;
      const foam = bandMask(nf, field, 0.5, 0.53, 0.012, hexRgb(pal.water.foam));
      drawMaskScaled(sctx, foam, nf, S, bb);
      sctx.globalAlpha = 1;
    }
    sctx.globalCompositeOperation = 'destination-in';
    drawMaskScaled(sctx, mask, nf, S, bb);
    sctx.restore();
    ctx.drawImage(scratch, bb.x0 * S, bb.y0 * S, (bb.x1 - bb.x0) * S, (bb.y1 - bb.y0) * S, bb.x0 * S, bb.y0 * S, (bb.x1 - bb.x0) * S, (bb.y1 - bb.y0) * S);
  }

  // void cells on top (crisp)
  const voids = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (info.at(x, y) === ' ') voids.push([x, y]);
  if (voids.length) paintVoidCells(ctx, voids, I);

  // painterly large-scale light variation
  const lv = makeCanvas(w * 2, h * 2);
  const lctx = lv.getContext('2d');
  const img = lctx.createImageData(w * 2, h * 2);
  for (let j = 0; j < h * 2; j++)
    for (let i = 0; i < w * 2; i++) {
      const n = fbm(i * 0.09, j * 0.09, seed + 999, 3);
      const v = 128 + (n - 0.5) * 120;
      const k = (j * w * 2 + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = v;
      img.data[k + 3] = 255;
    }
  lctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.globalAlpha = 0.35;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lv, 0, 0, w * S, h * S);
  ctx.restore();
  return { baseT };
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
