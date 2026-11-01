// Walls (masonry / timber / hull / organic rock), roofs and door leaves.
import { makeRand } from './rng.js';
import { makeCanvas, shade, mix, rgba, vary, noiseCanvas, noiseOverlay, blob, angularPoly, irregularPoly, roundRect, Batch } from './paint.js';
import { buildField, fieldMask, bandMask, drawMaskScaled, cellsPath } from './masks.js';

export function paintWalls(ctx, scratch, info, pal, S, seed, nf) {
  let any = false;
  for (const t of info.tiles) if (t === '#') { any = true; break; }
  if (!any) return;
  if (pal.wall.style === 'rock') paintRockWalls(ctx, scratch, info, pal, S, seed, nf);
  else paintBuiltWalls(ctx, scratch, info, pal, S, seed, nf);
}

// ---------------------------------------------------------------------------------------------
// built walls: masonry band (half-cell blocks) facing open cells, hatched bedrock / roofs beyond
// ---------------------------------------------------------------------------------------------
function paintBuiltWalls(ctx, scratch, info, pal, S, seed, nf) {
  const { w, h } = info;
  const st = pal.wall;
  const R = makeRand(seed ^ 0xa11);
  const isWall = (x, y) => info.at(x, y) === '#';
  const open = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return !!pal.seaVoid;
    const t = info.at(x, y);
    return t !== '#' && (t !== ' ' || !!pal.seaVoid);
  };
  const wallPath = cellsPath(w, h, isWall, S);

  // 1. drop shadow + contact occlusion on the floor
  ctx.save();
  ctx.fillStyle = st.bedrock;
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = S * 0.55;
  ctx.shadowOffsetX = S * 0.12;
  ctx.shadowOffsetY = S * 0.18;
  ctx.fill(wallPath);
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = S * 0.2;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  ctx.fill(wallPath);
  ctx.restore();

  // 2. bedrock / building core
  ctx.save();
  ctx.clip(wallPath);
  ctx.fillStyle = st.bedrock;
  ctx.fillRect(0, 0, w * S, h * S);
  noiseOverlay(ctx, 0, 0, w * S, h * S, noiseCanvas(256, 6, 17, 4), S * 5, 0.22, 'soft-light');
  const hatch = new Path2D();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isWall(x, y)) continue;
      const d = info.wallDist[y * w + x];
      if (d > 3) continue;
      const groups = d <= 1 ? 3 : d === 2 ? 2 : 1;
      for (let g = 0; g < groups; g++) {
        const cx = (x + R.next()) * S, cy = (y + R.next()) * S, a = R.next() * Math.PI;
        const n = 3 + ((R.next() * 2) | 0), L = S * (0.22 + R.next() * 0.14), sp = S * 0.07;
        const ca = Math.cos(a), sa = Math.sin(a);
        for (let i = 0; i < n; i++) {
          const o = (i - (n - 1) / 2) * sp;
          const ox = cx - sa * o, oy = cy + ca * o;
          hatch.moveTo(ox - (ca * L) / 2, oy - (sa * L) / 2);
          hatch.lineTo(ox + (ca * L) / 2, oy + (sa * L) / 2);
        }
      }
    }
  ctx.strokeStyle = st.hatch;
  ctx.lineWidth = S * 0.022;
  ctx.lineCap = 'round';
  ctx.stroke(hatch);
  ctx.restore();

  if (pal.outdoor) paintRoofs(ctx, info, pal, S, R);

  // 3. band quadrants (half-cell blocks) next to open cells
  const QW = w * 2, QH = h * 2;
  const band = new Uint8Array(QW * QH); // 0 none, 1 horizontal run, 2 vertical run, 3 corner
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isWall(x, y)) continue;
      for (let qy = 0; qy < 2; qy++)
        for (let qx = 0; qx < 2; qx++) {
          const dx = qx ? 1 : -1, dy = qy ? 1 : -1;
          const ov = open(x, y + dy), oh = open(x + dx, y), od = open(x + dx, y + dy);
          let k = 0;
          if (ov && oh) k = 3;
          else if (ov) k = 1;
          else if (oh) k = 2;
          else if (od) k = 3;
          band[(y * 2 + qy) * QW + x * 2 + qx] = k;
        }
    }
  const q = S / 2, g = S * 0.028;
  const blocks = [];
  const usedQ = new Uint8Array(QW * QH);
  for (let j = 0; j < QH; j++)
    for (let i = 0; i < QW; i++) {
      const k = band[j * QW + i];
      if (!k || usedQ[j * QW + i]) continue;
      usedQ[j * QW + i] = 1;
      // merge along the run with the neighbouring quadrant inside the same cell sometimes
      if (k === 1 && i % 2 === 0 && band[j * QW + i + 1] === 1 && R.next() < 0.55) {
        usedQ[j * QW + i + 1] = 1;
        blocks.push([i, j, 2, 1, k]);
      } else if (k === 2 && j % 2 === 0 && band[(j + 1) * QW + i] === 2 && R.next() < 0.55) {
        usedQ[(j + 1) * QW + i] = 1;
        blocks.push([i, j, 1, 2, k]);
      } else blocks.push([i, j, 1, 1, k]);
    }
  const style = st.style;
  if (style === 'stone') drawStoneBlocks(ctx, blocks, q, g, st, R, S);
  else drawTimberBand(ctx, blocks, band, QW, q, st, R, S, style === 'hull');

  // 4. outlines: wall face edge (ink + rim light) and band/bedrock seam
  const edge = new Path2D(), seam = new Path2D();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isWall(x, y)) continue;
      if (open(x, y - 1)) (edge.moveTo(x * S, y * S), edge.lineTo((x + 1) * S, y * S));
      if (open(x, y + 1)) (edge.moveTo(x * S, (y + 1) * S), edge.lineTo((x + 1) * S, (y + 1) * S));
      if (open(x - 1, y)) (edge.moveTo(x * S, y * S), edge.lineTo(x * S, (y + 1) * S));
      if (open(x + 1, y)) (edge.moveTo((x + 1) * S, y * S), edge.lineTo((x + 1) * S, (y + 1) * S));
    }
  for (let j = 0; j < QH; j++)
    for (let i = 0; i < QW; i++) {
      if (!band[j * QW + i]) continue;
      const cellWall = (ii, jj) => ii >= 0 && jj >= 0 && ii < QW && jj < QH && isWall(ii >> 1, jj >> 1);
      const nb = (ii, jj) => cellWall(ii, jj) && !band[jj * QW + ii];
      if (nb(i, j - 1)) (seam.moveTo(i * q, j * q), seam.lineTo((i + 1) * q, j * q));
      if (nb(i, j + 1)) (seam.moveTo(i * q, (j + 1) * q), seam.lineTo((i + 1) * q, (j + 1) * q));
      if (nb(i - 1, j)) (seam.moveTo(i * q, j * q), seam.lineTo(i * q, (j + 1) * q));
      if (nb(i + 1, j)) (seam.moveTo((i + 1) * q, j * q), seam.lineTo((i + 1) * q, (j + 1) * q));
    }
  ctx.save();
  ctx.lineCap = 'square';
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = S * 0.05;
  ctx.stroke(seam);
  ctx.strokeStyle = 'rgba(10,8,6,0.85)';
  ctx.lineWidth = S * 0.045;
  ctx.stroke(edge);
  ctx.clip(wallPath);
  ctx.strokeStyle = rgba(st.rim, 0.35);
  ctx.lineWidth = S * 0.06;
  ctx.stroke(edge);
  ctx.restore();
}

function drawStoneBlocks(ctx, blocks, q, g, st, R, S) {
  ctx.save();
  // mortar under band
  ctx.fillStyle = st.mortar;
  for (const [i, j, bw, bh] of blocks) ctx.fillRect(i * q, j * q, bw * q, bh * q);
  const hi = new Path2D(), lo = new Path2D(), cracks = new Path2D(), moss = [];
  for (const [i, j, bw, bh] of blocks) {
    if (st.ruined && R.next() < 0.12) {
      // missing block -> rubble
      for (let k = 0; k < 4; k++) {
        ctx.fillStyle = vary(st.block, R.next, 0.2);
        ctx.beginPath();
        angularPoly(ctx, (i + R.next() * bw) * q, (j + R.next() * bh) * q, q * (0.12 + R.next() * 0.15), R.next, 5, 0.5);
        ctx.fill();
      }
      continue;
    }
    const x0 = i * q + g / 2, y0 = j * q + g / 2, bwp = bw * q - g, bhp = bh * q - g;
    const col = vary(st.block, R.next, 0.1, 0.04);
    const grd = ctx.createLinearGradient(x0, y0, x0 + bwp, y0 + bhp);
    grd.addColorStop(0, shade(col, 0.1));
    grd.addColorStop(1, shade(col, -0.12));
    ctx.fillStyle = grd;
    ctx.beginPath();
    roundRect(ctx, x0, y0, bwp, bhp, S * 0.03);
    ctx.fill();
    hi.moveTo(x0 + S * 0.02, y0 + bhp - S * 0.02);
    hi.lineTo(x0 + S * 0.02, y0 + S * 0.02);
    hi.lineTo(x0 + bwp - S * 0.02, y0 + S * 0.02);
    lo.moveTo(x0 + bwp - S * 0.015, y0 + S * 0.03);
    lo.lineTo(x0 + bwp - S * 0.015, y0 + bhp - S * 0.015);
    lo.lineTo(x0 + S * 0.03, y0 + bhp - S * 0.015);
    if (R.next() < 0.12) {
      let cx = x0 + R.next() * bwp, cy = y0;
      cracks.moveTo(cx, cy);
      for (let k = 0; k < 3; k++) {
        cx += (R.next() - 0.5) * bwp * 0.4;
        cy += bhp / 3;
        cracks.lineTo(cx, cy);
      }
    }
    if ((st.ruined && R.next() < 0.3) || R.next() < 0.04) moss.push([x0 + R.next() * bwp, y0 + R.next() * bhp]);
  }
  ctx.lineWidth = S * 0.022;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.16)';
  ctx.stroke(hi);
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.stroke(lo);
  ctx.lineWidth = S * 0.012;
  ctx.strokeStyle = 'rgba(20,16,12,0.6)';
  ctx.stroke(cracks);
  for (const [mx, my] of moss) blob(ctx, mx, my, S * (0.12 + R.next() * 0.15), '#4f6a2a', 0.45);
  ctx.restore();
  // texture over the blocks
  const clip = new Path2D();
  for (const [i, j, bw, bh] of blocks) clip.rect(i * q, j * q, bw * q, bh * q);
  ctx.save();
  ctx.clip(clip);
  const b = blocks.reduce((a, [i, j, bw, bh]) => [Math.min(a[0], i), Math.min(a[1], j), Math.max(a[2], i + bw), Math.max(a[3], j + bh)], [1e9, 1e9, -1, -1]);
  noiseOverlay(ctx, b[0] * q, b[1] * q, (b[2] - b[0]) * q, (b[3] - b[1]) * q, noiseCanvas(128, 10, 29, 3), S * 1.4, 0.45, 'soft-light');
  ctx.restore();
}

function drawTimberBand(ctx, blocks, band, QW, q, st, R, S, hull) {
  ctx.save();
  const grain = new Path2D(), posts = [];
  for (const [i, j, bw, bh, k] of blocks) {
    const x0 = i * q, y0 = j * q, W = bw * q, H = bh * q;
    const col = vary(st.block, R.next, 0.07, 0.03);
    const horiz = k === 1 || (k === 3 && bw >= bh && R.next() < 0.5);
    const grd = horiz ? ctx.createLinearGradient(0, y0, 0, y0 + H) : ctx.createLinearGradient(x0, 0, x0 + W, 0);
    grd.addColorStop(0, shade(col, 0.12));
    grd.addColorStop(0.5, col);
    grd.addColorStop(1, shade(col, -0.18));
    ctx.fillStyle = grd;
    ctx.fillRect(x0, y0, W, H);
    const n = 3;
    for (let t = 0; t < n; t++) {
      if (horiz) {
        const gy = y0 + H * ((t + 0.5) / n) + (R.next() - 0.5) * H * 0.1;
        grain.moveTo(x0, gy);
        for (let s = 0; s <= 1.001; s += 0.2) grain.lineTo(x0 + W * s, gy + Math.sin(s * 5 + R.next()) * H * 0.03);
      } else {
        const gx = x0 + W * ((t + 0.5) / n) + (R.next() - 0.5) * W * 0.1;
        grain.moveTo(gx, y0);
        for (let s = 0; s <= 1.001; s += 0.2) grain.lineTo(gx + Math.sin(s * 5 + R.next()) * W * 0.03, y0 + H * s);
      }
    }
    // posts at cell corners of the run
    if (i % 2 === 0 && j % 2 === 0) posts.push([x0, y0]);
  }
  ctx.strokeStyle = rgba(shade(st.block, -0.45), 0.5);
  ctx.lineWidth = S * 0.01;
  ctx.stroke(grain);
  // posts: darker squares straddling cell corners
  const ps = hull ? S * 0.16 : S * 0.24;
  for (const [x0, y0] of posts) {
    const col = shade(st.top, hull ? 0.25 : -0.1);
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(x0 - ps / 2 + S * 0.03, y0 - ps / 2 + S * 0.04, ps, ps);
    const grd = ctx.createLinearGradient(x0 - ps / 2, y0 - ps / 2, x0 + ps / 2, y0 + ps / 2);
    grd.addColorStop(0, shade(col, 0.2));
    grd.addColorStop(1, shade(col, -0.2));
    ctx.fillStyle = grd;
    ctx.beginPath();
    if (hull) ctx.arc(x0, y0, ps / 2, 0, Math.PI * 2);
    else roundRect(ctx, x0 - ps / 2, y0 - ps / 2, ps, ps, S * 0.03);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = S * 0.012;
    ctx.stroke();
  }
  // plank seams between blocks
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = S * 0.012;
  for (const [i, j, bw, bh] of blocks) ctx.strokeRect(i * q, j * q, bw * q, bh * q);
  ctx.restore();
}

/** Outdoor themes: thick wall masses (2+ cells from any open cell) are building roofs. */
function paintRoofs(ctx, info, pal, S, R) {
  const { w, h } = info;
  const deep = (x, y) => x >= 0 && y >= 0 && x < w && y < h && info.at(x, y) === '#' && info.wallDist[y * w + x] >= 2;
  const seen = new Uint8Array(w * h);
  const roofCols = pal.wall.style === 'timber' ? ['#8a6a3a', '#7d5f33', '#96764a'] : ['#8c4a32', '#7a4434', '#5d6470', '#6b5a4a'];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!deep(x, y) || seen[y * w + x]) continue;
      const comp = [];
      const stack = [[x, y]];
      seen[y * w + x] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (deep(nx, ny) && !seen[ny * w + nx]) {
            seen[ny * w + nx] = 1;
            stack.push([nx, ny]);
          }
        }
      }
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (const [cx, cy] of comp) (x0 = Math.min(x0, cx)), (y0 = Math.min(y0, cy)), (x1 = Math.max(x1, cx + 1)), (y1 = Math.max(y1, cy + 1));
      // roof covers the component grown by half a cell (over the inner half of the band cells)
      const clip = new Path2D();
      for (const [cx, cy] of comp) clip.rect(cx * S - S * 0.5, cy * S - S * 0.5, S * 2, S * 2);
      const X0 = x0 * S - S * 0.5, Y0 = y0 * S - S * 0.5, X1 = x1 * S + S * 0.5, Y1 = y1 * S + S * 0.5;
      const horiz = X1 - X0 >= Y1 - Y0;
      const base = roofCols[(R.next() * roofCols.length) | 0];
      ctx.save();
      ctx.clip(clip);
      // two slopes
      const mid = horiz ? (Y0 + Y1) / 2 : (X0 + X1) / 2;
      ctx.fillStyle = shade(base, 0.1);
      if (horiz) ctx.fillRect(X0, Y0, X1 - X0, mid - Y0);
      else ctx.fillRect(X0, Y0, mid - X0, Y1 - Y0);
      ctx.fillStyle = shade(base, -0.22);
      if (horiz) ctx.fillRect(X0, mid, X1 - X0, Y1 - mid);
      else ctx.fillRect(mid, Y0, X1 - mid, Y1 - Y0);
      // tile rows
      const rows = new Path2D(), tiles = new Path2D();
      const rs = S * 0.18;
      if (horiz) {
        for (let yy = Y0; yy < Y1; yy += rs) (rows.moveTo(X0, yy), rows.lineTo(X1, yy));
        let r = 0;
        for (let yy = Y0; yy < Y1; yy += rs, r++) for (let xx = X0 + (r % 2) * rs * 0.6; xx < X1; xx += rs * 1.2) (tiles.moveTo(xx, yy), tiles.lineTo(xx, yy + rs));
      } else {
        for (let xx = X0; xx < X1; xx += rs) (rows.moveTo(xx, Y0), rows.lineTo(xx, Y1));
        let r = 0;
        for (let xx = X0; xx < X1; xx += rs, r++) for (let yy = Y0 + (r % 2) * rs * 0.6; yy < Y1; yy += rs * 1.2) (tiles.moveTo(xx, yy), tiles.lineTo(xx + rs, yy));
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = S * 0.02;
      ctx.stroke(rows);
      ctx.lineWidth = S * 0.012;
      ctx.stroke(tiles);
      noiseOverlay(ctx, X0, Y0, X1 - X0, Y1 - Y0, noiseCanvas(128, 8, 41, 3), S * 2, 0.5, 'soft-light');
      // ridge
      ctx.strokeStyle = shade(base, -0.45);
      ctx.lineWidth = S * 0.09;
      ctx.beginPath();
      if (horiz) (ctx.moveTo(X0, mid), ctx.lineTo(X1, mid));
      else (ctx.moveTo(mid, Y0), ctx.lineTo(mid, Y1));
      ctx.stroke();
      ctx.strokeStyle = rgba(shade(base, 0.35), 0.6);
      ctx.lineWidth = S * 0.025;
      ctx.stroke();
      // chimney sometimes
      if (R.next() < 0.6 && comp.length > 3) {
        const [cx, cy] = comp[(R.next() * comp.length) | 0];
        ctx.fillStyle = 'rgba(0,0,0,0.4)';
        ctx.fillRect(cx * S + S * 0.38, cy * S + S * 0.42, S * 0.3, S * 0.3);
        ctx.fillStyle = '#6a625a';
        ctx.fillRect(cx * S + S * 0.32, cy * S + S * 0.32, S * 0.3, S * 0.3);
        ctx.fillStyle = '#1d1a18';
        ctx.fillRect(cx * S + S * 0.38, cy * S + S * 0.38, S * 0.18, S * 0.18);
      }
      ctx.restore();
    }
}

// ---------------------------------------------------------------------------------------------
// organic rock walls (caves, mines, cliffs, outcrops)
// ---------------------------------------------------------------------------------------------
function shifted(mask, dx, dy, cut) {
  const c = makeCanvas(mask.width, mask.height);
  const x = c.getContext('2d');
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(cut || mask, dx, dy);
  return c;
}

function paintRockWalls(ctx, scratch, info, pal, S, seed, nf) {
  const { w, h } = info;
  const st = pal.wall;
  const R = makeRand(seed ^ 0xb0c);
  const isWall = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? true : info.at(x, y) === '#');
  const field = buildField(nf, (x, y) => (isWall(x, y) ? 1 : 0), 0.95, 0.35);
  const outer = fieldMask(nf, field, 0.5, 0.035);
  const black = fieldMask(nf, field, 0.5, 0.035, [0, 0, 0]);
  const W = w * S, H = h * S;

  // drop shadow + occlusion
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = S * 0.6;
  ctx.shadowOffsetX = S * 0.12;
  ctx.shadowOffsetY = S * 0.18;
  drawMaskScaled(ctx, black, nf, S);
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = S * 0.25;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  drawMaskScaled(ctx, black, nf, S);
  ctx.restore();

  // loose stones along the foot of the rock
  const sh = new Path2D(), pb = new Batch();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (isWall(x, y)) continue;
      let n = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isWall(x + dx, y + dy)) n++;
      if (!n) continue;
      const k = (R.next() * 3) | 0;
      for (let i = 0; i < k; i++) {
        const cx = (x + R.next()) * S, cy = (y + R.next()) * S, r = S * (0.03 + R.next() * 0.07);
        angularPoly(sh, cx + r * 0.3, cy + r * 0.45, r, R.next, 6, 0.4);
        angularPoly(pb.path(vary(st.rim, R.next, 0.15)), cx, cy, r, R.next, 6, 0.4);
      }
    }
  ctx.fillStyle = 'rgba(0,0,0,0.4)';
  ctx.fill(sh);
  pb.fill(ctx);

  // rock body on scratch
  const s = scratch.getContext('2d');
  s.save();
  s.clearRect(0, 0, W, H);
  s.fillStyle = st.rim;
  s.fillRect(0, 0, W, H);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) if (isWall(x, y)) blob(s, (x + R.next()) * S, (y + R.next()) * S, S * (0.4 + R.next() * 0.6), R.next() < 0.5 ? shade(st.rim, 0.15) : st.top, 0.22);
  noiseOverlay(s, 0, 0, W, H, noiseCanvas(256, 6, (seed % 50) + 3, 5), S * 4, 0.6, 'soft-light');
  noiseOverlay(s, 0, 0, W, H, noiseCanvas(128, 12, (seed % 50) + 4, 3), S * 1.2, 0.5, 'soft-light');
  // depth: a light rocky rim along the face, dark rock mass behind it
  const deep1 = fieldMask(nf, field, 0.74, 0.07, hexRgb(shade(st.bedrock, 0.12)));
  const deepCells = buildField(nf, (x, y) => (isWall(x, y) && (x < 0 || y < 0 || x >= w || y >= h || info.wallDist[y * w + x] >= 2) ? 1 : 0), 0.8, 0.3);
  const deep2 = fieldMask(nf, deepCells, 0.55, 0.2, hexRgb(st.bedrock));
  s.globalAlpha = 0.88;
  drawMaskScaled(s, deep1, nf, S);
  s.globalAlpha = 0.9;
  drawMaskScaled(s, deep2, nf, S);
  s.globalAlpha = 1;
  noiseOverlay(s, 0, 0, W, H, noiseCanvas(128, 20, (seed % 50) + 7, 3), S * 1.6, 0.5, 'soft-light');
  // angular facets & cracks over the whole mass (light edge + dark crease)
  const fac = new Path2D(), facHi = new Path2D();
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!isWall(x, y)) continue;
      const n = 2 + ((R.next() * 2) | 0);
      for (let i = 0; i < n; i++) {
        let cx = (x + R.next()) * S, cy = (y + R.next()) * S;
        let a = R.next() * Math.PI * 2;
        fac.moveTo(cx, cy);
        facHi.moveTo(cx + S * 0.018, cy + S * 0.024);
        for (let k = 0; k < 3; k++) {
          a += (R.next() - 0.5) * 1.6;
          cx += Math.cos(a) * S * 0.2;
          cy += Math.sin(a) * S * 0.2;
          fac.lineTo(cx, cy);
          facHi.lineTo(cx + S * 0.018, cy + S * 0.024);
        }
      }
    }
  s.lineCap = 'round';
  s.lineJoin = 'round';
  s.strokeStyle = rgba(st.rim, 0.32);
  s.lineWidth = S * 0.022;
  s.stroke(facHi);
  s.strokeStyle = 'rgba(0,0,0,0.6)';
  s.lineWidth = S * 0.02;
  s.stroke(fac);
  // inner ledge line where the rim meets the dark mass
  const ledge = bandMask(nf, field, 0.72, 0.75, 0.02, [0, 0, 0]);
  s.globalAlpha = 0.45;
  drawMaskScaled(s, ledge, nf, S);
  // lit rim (top-left) and shaded rim (bottom-right)
  const d = Math.max(1, nf.mr * 0.14);
  const rimHi = shifted(outer, d, d);
  const rimLo = shifted(outer, -d, -d);
  s.globalAlpha = 0.5;
  tint(s, rimHi, nf, S, shade(st.rim, 0.35));
  s.globalAlpha = 0.55;
  tint(s, rimLo, nf, S, '#000000');
  s.globalAlpha = 1;
  // ink edge
  const ink = bandMask(nf, field, 0.5, 0.545, 0.012, [12, 10, 8]);
  s.globalAlpha = 0.85;
  drawMaskScaled(s, ink, nf, S);
  s.globalAlpha = 1;
  s.globalCompositeOperation = 'destination-in';
  drawMaskScaled(s, outer, nf, S);
  s.restore();
  ctx.drawImage(scratch, 0, 0);
}

function tint(ctx, mask, nf, S, color) {
  const c = makeCanvas(mask.width, mask.height);
  const x = c.getContext('2d');
  x.drawImage(mask, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, c.width, c.height);
  drawMaskScaled(ctx, c, nf, S);
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// ---------------------------------------------------------------------------------------------
// doors (drawn per frame in cell units so open/close never needs a base re-render)
// ---------------------------------------------------------------------------------------------
export function doorOrientation(info, x, y) {
  const solid = (xx, yy) => {
    const t = info.at(xx, yy);
    return t === '#' || t === ' ' || t === '+';
  };
  const hz = (solid(x - 1, y) ? 1 : 0) + (solid(x + 1, y) ? 1 : 0);
  const vt = (solid(x, y - 1) ? 1 : 0) + (solid(x, y + 1) ? 1 : 0);
  return vt > hz ? 'v' : 'h';
}

/** Draw one door in map cell units (ctx already transformed: 1 unit = 1 cell). */
export function drawDoor(ctx, door, orient, wallStyle, opts = {}) {
  const { dm = false } = opts;
  ctx.save();
  ctx.translate(door.x + 0.5, door.y + 0.5);
  if (orient === 'v') ctx.rotate(Math.PI / 2);
  const wood = wallStyle === 'stone' || wallStyle === 'rock' ? '#7a4f2b' : '#8b5e34';
  const dark = '#2a1709';
  if (door.secret && dm) {
    ctx.setLineDash([0.08, 0.06]);
    ctx.strokeStyle = 'rgba(190,120,255,0.95)';
    ctx.lineWidth = 0.04;
    ctx.strokeRect(-0.45, -0.18, 0.9, 0.36);
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(190,120,255,0.95)';
    ctx.font = 'bold 0.3px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', 0, 0.01);
    ctx.restore();
    return;
  }
  // threshold sill
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(-0.5, -0.16, 1, 0.32);
  if (door.open) {
    // leaf swung 90deg about the left hinge, lying against the wall on the -y side
    ctx.save();
    ctx.translate(-0.46, -0.08);
    ctx.strokeStyle = 'rgba(255,240,210,0.18)';
    ctx.lineWidth = 0.015;
    ctx.setLineDash([0.05, 0.05]);
    ctx.beginPath();
    ctx.arc(0, 0, 0.88, -Math.PI / 2, 0);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.rotate(-Math.PI / 2);
    leaf(ctx, 0, -0.0, 0.9, 0.14, wood, dark, door.locked);
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.fillRect(-0.45, -0.07, 0.94, 0.22);
    leaf(ctx, -0.47, -0.1, 0.94, 0.2, wood, dark, door.locked);
  }
  if (door.locked) {
    // padlock
    const lx = door.open ? -0.3 : 0, ly = door.open ? -0.5 : 0;
    ctx.save();
    ctx.translate(lx, ly);
    if (orient === 'v') ctx.rotate(-Math.PI / 2);
    ctx.strokeStyle = '#9aa0a6';
    ctx.lineWidth = 0.035;
    ctx.beginPath();
    ctx.arc(0, -0.05, 0.055, Math.PI, 0);
    ctx.stroke();
    ctx.fillStyle = '#d6aa3c';
    ctx.strokeStyle = '#3a2a08';
    ctx.lineWidth = 0.015;
    ctx.beginPath();
    roundRect(ctx, -0.08, -0.06, 0.16, 0.13, 0.025);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#2a1d05';
    ctx.beginPath();
    ctx.arc(0, -0.01, 0.018, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(-0.007, -0.01, 0.014, 0.045);
    ctx.restore();
  }
  ctx.restore();
}

function leaf(ctx, x, y, L, T, wood, dark, locked) {
  const g = ctx.createLinearGradient(0, y, 0, y + T);
  g.addColorStop(0, shade(wood, 0.18));
  g.addColorStop(0.5, wood);
  g.addColorStop(1, shade(wood, -0.25));
  ctx.fillStyle = g;
  ctx.beginPath();
  roundRect(ctx, x, y, L, T, 0.025);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 0.025;
  ctx.stroke();
  // board seams
  ctx.strokeStyle = 'rgba(30,15,5,0.55)';
  ctx.lineWidth = 0.01;
  ctx.beginPath();
  for (let k = 1; k < 3; k++) {
    ctx.moveTo(x + 0.02, y + (T * k) / 3);
    ctx.lineTo(x + L - 0.02, y + (T * k) / 3);
  }
  ctx.stroke();
  // iron bands
  ctx.fillStyle = locked ? '#55585c' : '#3b3d40';
  const bw = locked ? 0.07 : 0.045;
  for (const f of [0.2, 0.8]) ctx.fillRect(x + L * f - bw / 2, y - 0.005, bw, T + 0.01);
  if (locked) {
    ctx.fillStyle = '#8d9196';
    for (const f of [0.08, 0.35, 0.65, 0.92]) {
      ctx.beginPath();
      ctx.arc(x + L * f, y + T / 2, 0.014, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    ctx.fillStyle = '#c9a54a';
    ctx.beginPath();
    ctx.arc(x + L * 0.62, y + T / 2, 0.022, 0, Math.PI * 2);
    ctx.fill();
  }
}

export { mix, irregularPoly };
