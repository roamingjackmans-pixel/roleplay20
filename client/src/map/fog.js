// Fog of war: per-cell visibility -> two small feathered canvases (F px per cell) that the
// renderer scales up with smoothing every frame:
//   dark  : black/blue-black with alpha by visibility level (drawn over tokens)
//   desat : grey with alpha = how much to desaturate (drawn with 'saturation' blend under tokens)
import { makeCanvas } from './paint.js';

export const FOG_F = 4; // mask pixels per cell

// darkness alpha per state
const A_UNKNOWN = 1, A_EXPLORED = 0.7, A_DV = 0.42, A_DIM = 0.24, A_BRIGHT = 0;

/** level: 0 unknown, 1 explored-not-visible, 2 darkvision, 3 dim, 4 bright */
export function cellLevels(w, h, vis, explored) {
  const n = w * h;
  const lv = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = vis ? vis.charCodeAt(i) - 48 : 3;
    if (v >= 3) lv[i] = 4;
    else if (v === 2) lv[i] = 3;
    else if (v === 1) lv[i] = 2;
    else lv[i] = explored && explored.charCodeAt(i) === 49 ? 1 : 0;
  }
  return lv;
}

function boxBlur(src, W, H, r) {
  // separable box blur, single channel Float32
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  const k = 1 / (2 * r + 1);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc * k;
      const xa = Math.min(W - 1, x + r + 1), xr = Math.max(0, x - r);
      acc += src[y * W + xa] - src[y * W + xr];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc * k;
      const ya = Math.min(H - 1, y + r + 1), yr = Math.max(0, y - r);
      acc += tmp[ya * W + x] - tmp[yr * W + x];
    }
  }
  return out;
}

function erodeMin(src, W, H) {
  // 3x3 min filter: lighter (lower alpha) regions grow by one mask pixel
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m = src[y * W + x];
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          const v = src[yy * W + xx];
          if (v < m) m = v;
        }
      }
      out[y * W + x] = m;
    }
  return out;
}

export function buildFog(w, h, vis, explored) {
  const F = FOG_F;
  // pad by 1 cell so edges of the map feather correctly
  const W = (w + 2) * F, H = (h + 2) * F;
  const lv = cellLevels(w, h, vis, explored);
  const dark = new Float32Array(W * H).fill(A_UNKNOWN);
  const desat = new Float32Array(W * H);
  const cool = new Float32Array(W * H);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const l = lv[y * w + x];
      const a = l === 4 ? A_BRIGHT : l === 3 ? A_DIM : l === 2 ? A_DV : l === 1 ? A_EXPLORED : A_UNKNOWN;
      const ds = l === 1 ? 1 : l === 2 ? 0.85 : 0;
      for (let j = 0; j < F; j++)
        for (let i = 0; i < F; i++) {
          const k = ((y + 1) * F + j) * W + (x + 1) * F + i;
          dark[k] = a;
          desat[k] = ds;
          cool[k] = l === 1 ? 1 : 0;
        }
    }
  // edge padding: copy neighbouring cell values outward (map border isn't "unknown")
  for (let j = 0; j < H; j++)
    for (let i = 0; i < W; i++) {
      const cx = Math.min(w - 1, Math.max(0, Math.floor(i / F) - 1)), cy = Math.min(h - 1, Math.max(0, Math.floor(j / F) - 1));
      const inside = i >= F && j >= F && i < W - F && j < H - F;
      if (inside) continue;
      const src = ((cy + 1) * F + F / 2) * W + (cx + 1) * F + F / 2;
      const k = j * W + i;
      dark[k] = dark[src];
      desat[k] = desat[src];
      cool[k] = cool[src];
    }
  const dB = boxBlur(erodeMin(dark, W, H), W, H, 2);
  const sB = boxBlur(desat, W, H, 2);
  const cB = boxBlur(cool, W, H, 3);
  const darkC = makeCanvas(W, H), desC = makeCanvas(W, H);
  const dctx = darkC.getContext('2d'), sctx = desC.getContext('2d');
  const di = dctx.createImageData(W, H), si = sctx.createImageData(W, H);
  for (let k = 0; k < W * H; k++) {
    const q = k * 4;
    const c = cB[k];
    di.data[q] = 6 * c;
    di.data[q + 1] = 9 * c;
    di.data[q + 2] = 22 * c;
    di.data[q + 3] = Math.round(dB[k] * 255);
    si.data[q] = si.data[q + 1] = si.data[q + 2] = 128;
    si.data[q + 3] = Math.round(sB[k] * 255);
  }
  dctx.putImageData(di, 0, 0);
  sctx.putImageData(si, 0, 0);
  return { dark: darkC, desat: desC, levels: lv, F, pad: 1 };
}

/** Is any cell of a token visible? (vis level >= 1) */
export function tokenVisible(levels, w, h, t) {
  if (!levels) return true;
  const s = Math.max(1, t.size || 1);
  for (let dy = 0; dy < s; dy++)
    for (let dx = 0; dx < s; dx++) {
      const x = t.x + dx, y = t.y + dy;
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (levels[y * w + x] >= 2) return true;
    }
  return false;
}
