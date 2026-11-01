// Low-level canvas painting helpers: canvases, colours, noise patterns, batched shapes.
import { fbmTile, hash2, clamp, mulberry32 } from './rng.js';

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(w));
  c.height = Math.max(1, Math.ceil(h));
  return c;
}

// ---------- colour ----------
const rgbCache = new Map();
export function hexToRgb(hex) {
  let v = rgbCache.get(hex);
  if (v) return v;
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  rgbCache.set(hex, v);
  return v;
}
const to2 = (n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');
export function rgbToHex(r, g, b) {
  return '#' + to2(r) + to2(g) + to2(b);
}
/** Lighten (amt>0) / darken (amt<0) a hex colour; amt in -1..1. */
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  if (amt >= 0) return rgbToHex(r + (255 - r) * amt, g + (255 - g) * amt, b + (255 - b) * amt);
  return rgbToHex(r * (1 + amt), g * (1 + amt), b * (1 + amt));
}
export function mix(a, b, t) {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t);
}
export function rgba(hex, a) {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
/** Random variation of a colour: lightness +-amt, slight hue drift toward warm/cool. */
export function vary(hex, r, amt = 0.08, warm = 0.03) {
  const l = (r() * 2 - 1) * amt;
  let c = shade(hex, l);
  const w = (r() * 2 - 1) * warm;
  if (w > 0) c = mix(c, '#c08040', w);
  else if (w < 0) c = mix(c, '#506080', -w);
  return c;
}

// ---------- noise textures (cached, tileable) ----------
const noiseCache = new Map();
/**
 * Grey tileable fbm noise canvas (values around mid grey) for overlay / soft-light blending.
 * period = lattice cells across the tile (bigger = finer detail).
 */
export function noiseCanvas(size = 256, period = 8, seed = 1, octaves = 4, contrast = 1) {
  const key = `${size}|${period}|${seed}|${octaves}|${contrast}`;
  let c = noiseCache.get(key);
  if (c) return c;
  c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = fbmTile(x, y, size, period, seed, octaves);
      const v = clamp(128 + (n - 0.5) * 255 * 1.6 * contrast, 0, 255);
      const i = (y * size + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  noiseCache.set(key, c);
  return c;
}

/** Fine speckle (per-pixel white noise) tile. */
export function speckleCanvas(size = 128, seed = 3) {
  const key = `speckle|${size}|${seed}`;
  let c = noiseCache.get(key);
  if (c) return c;
  c = makeCanvas(size, size);
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const d = img.data;
  const r = mulberry32(seed);
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (r() - 0.5) * 120;
    d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
    d[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  noiseCache.set(key, c);
  return c;
}

/**
 * Blend a noise pattern over a region. `scale` = how many px one tile spans.
 * mode: 'soft-light' | 'overlay' | 'multiply' ...
 */
export function noiseOverlay(ctx, x, y, w, h, tile, scale, alpha = 0.5, mode = 'soft-light', offset = 0) {
  const pat = ctx.createPattern(tile, 'repeat');
  if (!pat) return;
  const k = scale / tile.width;
  if (pat.setTransform) pat.setTransform(new DOMMatrix([k, 0, 0, k, offset, offset * 0.7]));
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pat;
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Soft radial blob. */
export function blob(ctx, x, y, r, color, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Irregular blob polygon path (adds to current path). */
export function irregularPoly(ctx, cx, cy, rx, ry, rot, r, n = 7, jag = 0.25) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 - jag / 2 + r() * jag;
    const px = Math.cos(a) * rx * k, py = Math.sin(a) * ry * k;
    pts.push([cx + px * Math.cos(rot) - py * Math.sin(rot), cy + px * Math.sin(rot) + py * Math.cos(rot)]);
  }
  // smooth closed curve through midpoints
  const m = (i) => pts[(i + n) % n];
  const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let s = mid(m(0), m(1));
  ctx.moveTo(s[0], s[1]);
  for (let i = 1; i <= n; i++) {
    const p = m(i), q = mid(m(i), m(i + 1));
    ctx.quadraticCurveTo(p[0], p[1], q[0], q[1]);
  }
  ctx.closePath();
  return pts;
}

/** Angular polygon (rocks, rubble). */
export function angularPoly(ctx, cx, cy, rad, r, n = 6, jag = 0.4, rot = 0) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = rot + (i / n) * Math.PI * 2 + (r() - 0.5) * (Math.PI / n);
    const k = 1 - jag / 2 + r() * jag;
    pts.push([cx + Math.cos(a) * rad * k, cy + Math.sin(a) * rad * k]);
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  return pts;
}

export function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** Group fills by colour so thousands of small shapes cost a handful of fill() calls. */
export class Batch {
  constructor() {
    this.map = new Map();
  }
  path(key) {
    let p = this.map.get(key);
    if (!p) {
      p = new Path2D();
      this.map.set(key, p);
    }
    return p;
  }
  fill(ctx) {
    for (const [k, p] of this.map) {
      ctx.fillStyle = k;
      ctx.fill(p);
    }
  }
  stroke(ctx, width) {
    for (const [k, p] of this.map) {
      ctx.strokeStyle = k;
      ctx.lineWidth = width;
      ctx.stroke(p);
    }
  }
}

/** Path2D variants of the shape helpers. */
export function pathIrregular(p, cx, cy, rx, ry, rot, r, n = 7, jag = 0.25) {
  return irregularPoly(p, cx, cy, rx, ry, rot, r, n, jag);
}

export { hash2 };
