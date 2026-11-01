// Organic region masks: cell mask -> bilinear upsample at `mr` px/cell + fbm noise -> threshold -> alpha canvas.
// The small mask canvas is later drawn scaled up (with smoothing) onto the full-resolution base,
// which gives soft, natural-looking edges for terrain transitions, cave rock, shorelines, etc.
import { fbm, vnoise, smoothstep } from './rng.js';
import { makeCanvas } from './paint.js';

export function makeNoiseFields(w, h, mr, seed) {
  const W = w * mr, H = h * mr;
  const nA = new Float32Array(W * H), nB = new Float32Array(W * H);
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / mr;
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / mr;
      const k = j * W + i;
      nA[k] = fbm(u * 0.85, v * 0.85, seed, 4) - 0.5;
      nB[k] = vnoise(u * 3.1, v * 3.1, seed + 77) - 0.5;
    }
  }
  return { w, h, mr, W, H, nA, nB };
}

/** pred(x, y) -> 0..1 cell membership. Returns a Float32Array field at mask resolution. */
export function buildField(nf, pred, ampA = 0.55, ampB = 0.18, invertNoise = false) {
  const { w, h, mr, W, H, nA, nB } = nf;
  const cm = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cm[y * w + x] = pred(x, y);
  const f = new Float32Array(W * H);
  const sgn = invertNoise ? -1 : 1;
  for (let j = 0; j < H; j++) {
    const v = (j + 0.5) / mr - 0.5;
    let y0 = Math.floor(v);
    const fy = v - y0;
    const ya = y0 < 0 ? 0 : y0 >= h ? h - 1 : y0;
    const yb = y0 + 1 >= h ? h - 1 : y0 + 1 < 0 ? 0 : y0 + 1;
    for (let i = 0; i < W; i++) {
      const u = (i + 0.5) / mr - 0.5;
      const x0 = Math.floor(u);
      const fx = u - x0;
      const xa = x0 < 0 ? 0 : x0 >= w ? w - 1 : x0;
      const xb = x0 + 1 >= w ? w - 1 : x0 + 1 < 0 ? 0 : x0 + 1;
      const a = cm[ya * w + xa], b = cm[ya * w + xb], c = cm[yb * w + xa], d = cm[yb * w + xb];
      const top = a + (b - a) * fx, bot = c + (d - c) * fx;
      const base = top + (bot - top) * fy;
      const k = j * W + i;
      // only perturb near edges so interiors stay solid
      const edge = base > 0.001 && base < 0.999 ? 1 : 0.35;
      f[k] = base + sgn * edge * (nA[k] * ampA + nB[k] * ampB);
    }
  }
  return f;
}

/** Threshold a field into an alpha mask canvas (W x H). */
export function fieldMask(nf, field, thr = 0.5, soft = 0.06, color = [255, 255, 255]) {
  const { W, H } = nf;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const lo = thr - soft, hi = thr + soft;
  for (let k = 0; k < W * H; k++) {
    const a = smoothstep(lo, hi, field[k]);
    const i = k * 4;
    d[i] = color[0];
    d[i + 1] = color[1];
    d[i + 2] = color[2];
    d[i + 3] = a * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Mask = field between two thresholds (a band): smoothstep(t0) - smoothstep(t1). */
export function bandMask(nf, field, t0, t1, soft = 0.05, color = [255, 255, 255]) {
  const { W, H } = nf;
  const c = makeCanvas(W, H);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(W, H);
  const d = img.data;
  for (let k = 0; k < W * H; k++) {
    const v = field[k];
    const a = smoothstep(t0 - soft, t0 + soft, v) - smoothstep(t1 - soft, t1 + soft, v);
    const i = k * 4;
    d[i] = color[0];
    d[i + 1] = color[1];
    d[i + 2] = color[2];
    d[i + 3] = Math.max(0, a) * 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** Draw a mask canvas scaled to base resolution (S px per cell). */
export function drawMaskScaled(ctx, mask, nf, S, bbox) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  if (bbox) {
    const { x0, y0, x1, y1 } = bbox;
    ctx.drawImage(mask, x0 * nf.mr, y0 * nf.mr, (x1 - x0) * nf.mr, (y1 - y0) * nf.mr, x0 * S, y0 * S, (x1 - x0) * S, (y1 - y0) * S);
  } else {
    ctx.drawImage(mask, 0, 0, nf.W, nf.H, 0, 0, nf.w * S, nf.h * S);
  }
}

/** Path2D of a set of cells (merged horizontal runs), in px at S per cell. */
export function cellsPath(w, h, pred, S, pad = 0) {
  const p = new Path2D();
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (!pred(x, y)) {
        x++;
        continue;
      }
      const sx = x;
      while (x < w && pred(x, y)) x++;
      p.rect(sx * S - pad, y * S - pad, (x - sx) * S + pad * 2, S + pad * 2);
    }
  }
  return p;
}
