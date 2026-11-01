// Top-down drawings for every MapObject kind. Each drawer works in local cell units:
// the object's (possibly rotated) box is [0,W] x [0,H] where 1 unit = 1 cell.
import { makeRand, hashStr } from './rng.js';
import { shade, mix, rgba, vary, roundRect, angularPoly, irregularPoly } from './paint.js';

const TAU = Math.PI * 2;

// ---------- helpers ----------
function shadow(c, k, blur = 0.1, ox = 0.05, oy = 0.08, a = 0.5) {
  c.shadowColor = `rgba(0,0,0,${a})`;
  c.shadowBlur = k.S * blur;
  c.shadowOffsetX = k.S * ox;
  c.shadowOffsetY = k.S * oy;
}
function noShadow(c) {
  c.shadowColor = 'rgba(0,0,0,0)';
  c.shadowBlur = 0;
  c.shadowOffsetX = 0;
  c.shadowOffsetY = 0;
}
function lin(c, x0, y0, x1, y1, stops) {
  const g = c.createLinearGradient(x0, y0, x1, y1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
function rad(c, x, y, r0, r1, stops, fx = x, fy = y) {
  const g = c.createRadialGradient(fx, fy, r0, x, y, r1);
  for (const [o, col] of stops) g.addColorStop(o, col);
  return g;
}
function circle(c, x, y, r) {
  c.beginPath();
  c.arc(x, y, Math.max(0.0001, r), 0, TAU);
}
function rrect(c, x, y, w, h, r) {
  c.beginPath();
  roundRect(c, x, y, w, h, r);
}
function stroke(c, col, lw) {
  c.strokeStyle = col;
  c.lineWidth = lw;
  c.stroke();
}
function fill(c, f) {
  c.fillStyle = f;
  c.fill();
}
function line(c, x0, y0, x1, y1, col, lw) {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  stroke(c, col, lw);
}
function woodPanel(c, x, y, w, h, col, n = 3, alongX = w >= h, r = 0.03) {
  rrect(c, x, y, w, h, r);
  fill(c, alongX ? lin(c, 0, y, 0, y + h, [[0, shade(col, 0.15)], [1, shade(col, -0.18)]]) : lin(c, x, 0, x + w, 0, [[0, shade(col, 0.15)], [1, shade(col, -0.18)]]));
  c.save();
  c.clip();
  c.strokeStyle = rgba(shade(col, -0.55), 0.55);
  c.lineWidth = 0.012;
  c.beginPath();
  for (let i = 1; i < n; i++) {
    if (alongX) {
      c.moveTo(x, y + (h * i) / n);
      c.lineTo(x + w, y + (h * i) / n);
    } else {
      c.moveTo(x + (w * i) / n, y);
      c.lineTo(x + (w * i) / n, y + h);
    }
  }
  c.stroke();
  // grain
  c.strokeStyle = rgba(shade(col, -0.4), 0.25);
  c.lineWidth = 0.006;
  c.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const t = (i + 0.5) / (n * 2);
    if (alongX) {
      c.moveTo(x, y + h * t);
      c.bezierCurveTo(x + w * 0.3, y + h * t + 0.01, x + w * 0.6, y + h * t - 0.01, x + w, y + h * t);
    } else {
      c.moveTo(x + w * t, y);
      c.bezierCurveTo(x + w * t + 0.01, y + h * 0.3, x + w * t - 0.01, y + h * 0.6, x + w * t, y + h);
    }
  }
  c.stroke();
  c.restore();
  rrect(c, x, y, w, h, r);
  stroke(c, rgba(shade(col, -0.6), 0.8), 0.018);
}
function flameCore(c, x, y, r) {
  circle(c, x, y, r);
  fill(c, rad(c, x, y, 0, r, [[0, 'rgba(255,240,170,1)'], [0.35, 'rgba(255,170,50,0.95)'], [0.75, 'rgba(200,60,10,0.6)'], [1, 'rgba(120,20,0,0)']]));
}
function coals(c, x, y, r, R) {
  circle(c, x, y, r);
  fill(c, rad(c, x, y, 0, r, [[0, '#ffcf6a'], [0.4, '#f07a22'], [0.8, '#7a2a10'], [1, '#2a1208']]));
  for (let i = 0; i < 9; i++) {
    const a = R() * TAU, d = R() * r * 0.8;
    circle(c, x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.08 + R() * 0.1));
    fill(c, R() < 0.5 ? '#3a1a0c' : '#ffb347');
  }
}
function stoneRing(c, x, y, r, n, size, R, col = '#8a847a') {
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + R() * 0.2;
    c.beginPath();
    angularPoly(c, x + Math.cos(a) * r, y + Math.sin(a) * r, size * (0.8 + R() * 0.4), R, 6, 0.35);
    fill(c, lin(c, x - r, y - r, x + r, y + r, [[0, shade(col, 0.15)], [1, shade(col, -0.2)]]));
    stroke(c, 'rgba(0,0,0,0.45)', 0.012);
  }
}
function canopyLobes(c, cx, cy, rr, lobes, R, jitter = 0.18) {
  c.beginPath();
  c.moveTo(cx + rr * 0.55, cy);
  c.arc(cx, cy, rr * 0.55, 0, TAU);
  for (let i = 0; i < lobes; i++) {
    const a = (i / lobes) * TAU + R() * 0.4;
    const d = rr * (0.48 + R() * jitter);
    const lr = rr * (0.38 + R() * 0.16);
    const lx = cx + Math.cos(a) * d, ly = cy + Math.sin(a) * d;
    c.moveTo(lx + lr, ly);
    c.arc(lx, ly, lr, 0, TAU);
  }
}
function label(c, text, x, y, size, col = '#f3e6c4') {
  c.save();
  c.font = `600 ${size}px Georgia, serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.lineWidth = size * 0.25;
  c.strokeStyle = 'rgba(0,0,0,0.7)';
  c.strokeText(text, x, y);
  c.fillStyle = col;
  c.fillText(text, x, y);
  c.restore();
}

// ---------- tree palettes ----------
const TREE = {
  oak: ['#24401a', '#355c24', '#4c7a2e', '#6b9a3c'],
  oak2: ['#2a4a1e', '#3e6a2a', '#588c34', '#7fae48'],
  autumn: ['#5a2e12', '#8a4a1a', '#b86a24', '#dc9a3a'],
  gold: ['#4a4214', '#7a6a1e', '#a89030', '#d0b84a'],
  pine: ['#14301f', '#1f4430', '#2d5a3d', '#3f7450'],
  willow: ['#2e3a1c', '#46532a', '#5f6c38', '#7d8a4a'],
  dead: ['#3a2e22', '#54432f', '#6e5a40', '#8a7458'],
};

function treeType(k) {
  const h = k.R();
  switch (k.theme) {
    case 'swamp':
      return h < 0.5 ? 'willow' : h < 0.75 ? 'dead' : 'oak';
    case 'crypt':
    case 'ruins':
      return h < 0.35 ? 'dead' : h < 0.7 ? 'oak' : 'pine';
    case 'forest':
      return h < 0.42 ? 'oak' : h < 0.58 ? 'oak2' : h < 0.94 ? 'pine' : h < 0.975 ? 'autumn' : 'gold';
    case 'cave':
    case 'mine':
      return 'dead';
    default:
      return h < 0.55 ? 'oak2' : h < 0.82 ? 'oak' : h < 0.96 ? 'pine' : 'autumn';
  }
}

// ---------- drawers ----------
const D = {};

D.tree = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2;
  const type = o.variant || treeType(k);
  const rr = Math.max(W, H) * (0.68 + R() * 0.22);
  const cols = TREE[type] || TREE.oak;
  // ground shadow
  c.save();
  c.translate(cx + rr * 0.28, cy + rr * 0.36);
  c.scale(1, 0.85);
  circle(c, 0, 0, rr * 1.02);
  fill(c, rad(c, 0, 0, rr * 0.2, rr * 1.05, [[0, 'rgba(0,0,0,0.5)'], [1, 'rgba(0,0,0,0)']]));
  c.restore();
  if (type === 'dead') {
    // bare branches
    circle(c, cx, cy, 0.14 * Math.max(W, H));
    fill(c, '#3a2c1e');
    c.lineCap = 'round';
    const br = (x, y, a, len, wdt, depth) => {
      const x2 = x + Math.cos(a) * len, y2 = y + Math.sin(a) * len;
      line(c, x, y, x2, y2, depth ? '#4e3d2a' : '#3a2c1e', wdt);
      if (depth < 3) for (let i = 0; i < 2; i++) br(x2, y2, a + (R() - 0.5) * 1.3, len * (0.55 + R() * 0.2), wdt * 0.6, depth + 1);
    };
    const n = 5 + ((R() * 3) | 0);
    for (let i = 0; i < n; i++) br(cx, cy, (i / n) * TAU + R() * 0.5, rr * 0.45, 0.07, 0);
    return;
  }
  if (type === 'pine') {
    const layers = 4;
    for (let l = 0; l < layers; l++) {
      const r = rr * (1 - l * 0.2);
      const spikes = 11 + ((R() * 4) | 0);
      const rot = R() * TAU;
      c.beginPath();
      for (let i = 0; i <= spikes * 2; i++) {
        const a = rot + (i / (spikes * 2)) * TAU;
        const d = i % 2 === 0 ? r : r * (0.62 + R() * 0.08);
        const px = cx + Math.cos(a) * d - l * 0.015, py = cy + Math.sin(a) * d - l * 0.02;
        if (i === 0) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      if (l === 0) shadow(c, k, 0.12, 0.03, 0.05, 0.5);
      fill(c, rad(c, cx - r * 0.2, cy - r * 0.25, 0, r, [[0, shade(cols[Math.min(3, l + 1)], 0.05)], [1, cols[l]]]));
      noShadow(c);
      // needle strokes
      c.strokeStyle = rgba(shade(cols[l], -0.35), 0.5);
      c.lineWidth = 0.01;
      c.beginPath();
      for (let i = 0; i < spikes; i++) {
        const a = rot + (i / spikes) * TAU;
        c.moveTo(cx + Math.cos(a) * r * 0.15, cy + Math.sin(a) * r * 0.15);
        c.lineTo(cx + Math.cos(a) * r * 0.85, cy + Math.sin(a) * r * 0.85);
      }
      c.stroke();
    }
    circle(c, cx - 0.04, cy - 0.05, rr * 0.08);
    fill(c, shade(cols[3], 0.2));
    return;
  }
  if (type === 'willow') {
    canopyLobes(c, cx, cy, rr, 9, R, 0.12);
    shadow(c, k, 0.15, 0.04, 0.06, 0.5);
    fill(c, cols[0]);
    noShadow(c);
    c.save();
    c.clip();
    c.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      const a = R() * TAU, d0 = R() * rr * 0.3, d1 = rr * (0.7 + R() * 0.35);
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * d0, cy + Math.sin(a) * d0);
      c.quadraticCurveTo(cx + Math.cos(a + 0.2) * d1 * 0.6, cy + Math.sin(a + 0.2) * d1 * 0.6, cx + Math.cos(a) * d1, cy + Math.sin(a) * d1);
      stroke(c, rgba(cols[1 + ((R() * 3) | 0)], 0.75), 0.025);
    }
    c.restore();
    return;
  }
  // broadleaf: 3 layered lobed canopies, lit from top-left
  canopyLobes(c, cx, cy, rr, 8 + ((R() * 3) | 0), R);
  shadow(c, k, 0.18, 0.04, 0.07, 0.55);
  fill(c, cols[0]);
  noShadow(c);
  c.save();
  c.clip();
  canopyLobes(c, cx - rr * 0.07, cy - rr * 0.09, rr * 0.86, 7 + ((R() * 3) | 0), R);
  fill(c, cols[1]);
  canopyLobes(c, cx - rr * 0.17, cy - rr * 0.2, rr * 0.6, 6, R, 0.25);
  fill(c, rgba(cols[2], 0.95));
  for (let i = 0; i < 5; i++) {
    const a = -2.3 + (R() - 0.5) * 1.6, d = rr * (0.25 + R() * 0.45);
    circle(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * (0.12 + R() * 0.1));
    fill(c, rgba(cols[3], 0.75));
  }
  // leaf texture
  for (let i = 0; i < 90; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * rr;
    const lx = cx + Math.cos(a) * d, ly = cy + Math.sin(a) * d;
    const lit = (lx - cx) + (ly - cy) < 0;
    c.beginPath();
    c.arc(lx, ly, rr * (0.05 + R() * 0.05), 0.4 + R(), 2.6 + R());
    stroke(c, lit ? rgba(cols[3], 0.5) : rgba(shade(cols[0], -0.3), 0.5), 0.014);
  }
  // inner shade on the lower-right
  circle(c, cx, cy, rr * 1.05);
  fill(c, rad(c, cx - rr * 0.35, cy - rr * 0.4, rr * 0.3, rr * 1.5, [[0, 'rgba(0,0,0,0)'], [1, 'rgba(0,10,0,0.45)']]));
  c.restore();
  if (type === 'autumn' || type === 'gold') {
    for (let i = 0; i < 12; i++) {
      const a = R() * TAU, d = rr * (1 + R() * 0.4);
      circle(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.025);
      fill(c, rgba(cols[2 + ((R() * 2) | 0)], 0.85));
    }
  }
};

D.bush = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2;
  const rr = Math.min(W, H) * (0.36 + R() * 0.1);
  const cols = k.theme === 'swamp' ? TREE.willow : R() < 0.5 ? TREE.oak2 : TREE.oak;
  canopyLobes(c, cx, cy, rr, 6, R, 0.2);
  shadow(c, k, 0.1, 0.04, 0.06, 0.55);
  fill(c, cols[0]);
  noShadow(c);
  c.save();
  c.clip();
  canopyLobes(c, cx - rr * 0.12, cy - rr * 0.14, rr * 0.75, 5, R);
  fill(c, cols[1]);
  for (let i = 0; i < 30; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * rr;
    c.beginPath();
    c.ellipse(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rr * 0.12, rr * 0.06, R() * 3, 0, TAU);
    fill(c, rgba(cols[2 + ((R() * 2) | 0)], 0.6));
  }
  c.restore();
  if (R() < 0.35) {
    const bc = R() < 0.5 ? '#b0283a' : '#5a3a8a';
    for (let i = 0; i < 7; i++) {
      const a = R() * TAU, d = R() * rr * 0.8;
      circle(c, cx + Math.cos(a) * d, cy + Math.sin(a) * d, 0.022);
      fill(c, bc);
    }
  }
};

function rockShape(c, o, k, big) {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2;
  const r = (big ? Math.max(W, H) * 0.46 : Math.min(W, H) * 0.34) * (0.85 + R() * 0.25);
  const n = big ? 8 + ((R() * 3) | 0) : 6 + ((R() * 2) | 0);
  const base = k.pal?.wall?.rim ? mix(k.pal.wall.rim, '#8a857c', 0.5) : '#8a857c';
  c.beginPath();
  const pts = angularPoly(c, cx, cy, r, R, n, 0.32, R() * TAU);
  shadow(c, k, 0.16, 0.07, 0.11, 0.6);
  fill(c, lin(c, cx - r, cy - r, cx + r, cy + r, [[0, shade(base, 0.2)], [0.55, base], [1, shade(base, -0.35)]]));
  noShadow(c);
  // facets: connect a few vertices to an off-centre apex
  const ax = cx - r * 0.18, ay = cy - r * 0.2;
  c.save();
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) c.lineTo(p[0], p[1]);
  c.closePath();
  c.clip();
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const lit = (p[0] + q[0]) / 2 - cx + ((p[1] + q[1]) / 2 - cy) < 0;
    c.beginPath();
    c.moveTo(ax, ay);
    c.lineTo(p[0], p[1]);
    c.lineTo(q[0], q[1]);
    c.closePath();
    fill(c, lit ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.16)');
    line(c, ax, ay, p[0], p[1], 'rgba(0,0,0,0.25)', 0.01);
  }
  if (big) {
    for (let i = 0; i < 6; i++) {
      circle(c, cx + (R() - 0.5) * r * 1.2, cy + (R() - 0.5) * r * 1.2, r * (0.06 + R() * 0.1));
      fill(c, rgba(R() < 0.5 ? '#9aa85a' : '#c8c49a', 0.45));
    }
  }
  c.restore();
  c.beginPath();
  c.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) c.lineTo(p[0], p[1]);
  c.closePath();
  stroke(c, 'rgba(15,12,10,0.75)', 0.02);
}
D.rock = (c, o, k) => rockShape(c, o, k, false);
D.boulder = (c, o, k) => rockShape(c, o, k, true);

D.pillar = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  const col = k.theme === 'temple' ? '#d8d0c0' : k.theme === 'crypt' ? '#8a8c8e' : '#9a948a';
  rrect(c, cx - s * 0.44, cy - s * 0.44, s * 0.88, s * 0.88, 0.04);
  shadow(c, k, 0.25, 0.14, 0.2, 0.65);
  fill(c, lin(c, cx - s * 0.44, cy - s * 0.44, cx + s * 0.44, cy + s * 0.44, [[0, shade(col, 0.05)], [1, shade(col, -0.3)]]));
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.6)', 0.02);
  circle(c, cx, cy, s * 0.34);
  fill(c, rad(c, cx, cy, 0, s * 0.34, [[0, shade(col, 0.3)], [0.7, col], [1, shade(col, -0.25)]], cx - s * 0.12, cy - s * 0.12));
  stroke(c, 'rgba(0,0,0,0.55)', 0.02);
  c.strokeStyle = 'rgba(0,0,0,0.18)';
  c.lineWidth = 0.012;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * TAU;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * s * 0.26, cy + Math.sin(a) * s * 0.26);
    c.lineTo(cx + Math.cos(a) * s * 0.33, cy + Math.sin(a) * s * 0.33);
    c.stroke();
  }
  if (k.theme !== 'temple' && R() < 0.4) {
    circle(c, cx + s * 0.1, cy - s * 0.15, s * 0.08);
    fill(c, 'rgba(70,90,40,0.4)');
  }
};

D.statue = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  const col = k.theme === 'temple' ? '#d6cfc0' : '#9c978e';
  rrect(c, cx - s * 0.45, cy - s * 0.45, s * 0.9, s * 0.9, 0.03);
  shadow(c, k, 0.2, 0.12, 0.16, 0.6);
  fill(c, lin(c, 0, 0, W, H, [[0, shade(col, -0.05)], [1, shade(col, -0.35)]]));
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.6)', 0.02);
  // figure: shoulders, arms, head, a sword/staff
  shadow(c, k, 0.12, 0.08, 0.12, 0.5);
  c.beginPath();
  c.ellipse(cx, cy + s * 0.05, s * 0.3, s * 0.15, 0, 0, TAU);
  fill(c, lin(c, cx - s * 0.3, cy, cx + s * 0.3, cy + s * 0.2, [[0, shade(col, 0.25)], [1, shade(col, -0.2)]]));
  noShadow(c);
  c.beginPath();
  c.ellipse(cx - s * 0.27, cy + s * 0.12, s * 0.07, s * 0.14, 0.3, 0, TAU);
  fill(c, shade(col, 0.1));
  c.beginPath();
  c.ellipse(cx + s * 0.27, cy - s * 0.02, s * 0.07, s * 0.14, -0.6, 0, TAU);
  fill(c, shade(col, 0.05));
  line(c, cx + s * 0.32, cy - s * 0.12, cx + s * 0.32, cy - s * 0.42, shade(col, -0.2), 0.04);
  circle(c, cx, cy - s * 0.02, s * 0.12);
  fill(c, rad(c, cx, cy - s * 0.02, 0, s * 0.12, [[0, shade(col, 0.35)], [1, shade(col, -0.1)]], cx - s * 0.04, cy - s * 0.06));
  stroke(c, 'rgba(0,0,0,0.4)', 0.012);
  if (R() < 0.5) {
    circle(c, cx - s * 0.1, cy + s * 0.15, s * 0.06);
    fill(c, 'rgba(80,100,50,0.35)');
  }
};

function tableItems(c, x, y, w, h, R, theme) {
  const n = Math.round((w * h) * (1.5 + R() * 2));
  for (let i = 0; i < n; i++) {
    const ix = x + 0.12 + R() * (w - 0.24), iy = y + 0.12 + R() * (h - 0.24);
    const t = R();
    if (t < 0.35) {
      // mug
      circle(c, ix, iy, 0.06);
      fill(c, R() < 0.5 ? '#8a6a44' : '#9a9a9a');
      stroke(c, 'rgba(0,0,0,0.5)', 0.01);
      circle(c, ix, iy, 0.04);
      fill(c, R() < 0.6 ? '#c99a3a' : '#3a2010');
      line(c, ix + 0.06, iy, ix + 0.09, iy, '#6a5034', 0.02);
    } else if (t < 0.6) {
      // plate with food
      circle(c, ix, iy, 0.09);
      fill(c, '#d8d0c0');
      stroke(c, 'rgba(0,0,0,0.35)', 0.01);
      circle(c, ix + 0.01, iy, 0.05);
      fill(c, R() < 0.5 ? '#a0522d' : '#c9a35a');
    } else if (t < 0.75) {
      // candle
      circle(c, ix, iy, 0.035);
      fill(c, '#efe6cf');
      circle(c, ix, iy, 0.015);
      fill(c, '#ffcc55');
    } else if (t < 0.85 && theme !== 'temple') {
      // bottle
      circle(c, ix, iy, 0.045);
      fill(c, R() < 0.5 ? '#2f5a2a' : '#5a3418');
      circle(c, ix - 0.012, iy - 0.012, 0.015);
      fill(c, 'rgba(255,255,255,0.4)');
    } else {
      // book / papers
      c.save();
      c.translate(ix, iy);
      c.rotate(R() * 1.5);
      c.fillStyle = R() < 0.5 ? '#6a2a2a' : '#e8dcc0';
      c.fillRect(-0.08, -0.06, 0.16, 0.12);
      c.strokeStyle = 'rgba(0,0,0,0.4)';
      c.lineWidth = 0.008;
      c.strokeRect(-0.08, -0.06, 0.16, 0.12);
      c.restore();
    }
  }
}

function chairAt(c, x, y, ang, col) {
  c.save();
  c.translate(x, y);
  c.rotate(ang);
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(-0.15, -0.13, 0.34, 0.34);
  woodPanel(c, -0.17, -0.17, 0.34, 0.32, col, 2, true, 0.03);
  // backrest on the far side
  rrect(c, -0.19, 0.12, 0.38, 0.08, 0.02);
  fill(c, shade(col, -0.2));
  stroke(c, 'rgba(0,0,0,0.6)', 0.012);
  c.restore();
}

D.table = (c, o, k) => {
  const { W, H, R } = k;
  const col = k.woodCol || '#7a4b26';
  const round = W === H && W === 1 && R() < 0.4;
  // chairs around (into free neighbour cells; drawn first so the table overlaps them)
  if (k.chairs !== false) {
    for (const side of k.freeSides || []) {
      if (R() < 0.25) continue;
      const { lx, ly, ang } = side;
      chairAt(c, lx, ly, ang, shade(col, 0.08));
    }
  }
  if (round) {
    circle(c, W / 2, H / 2, 0.42);
    shadow(c, k, 0.15, 0.06, 0.1, 0.55);
    fill(c, rad(c, W / 2, H / 2, 0, 0.42, [[0, shade(col, 0.15)], [1, shade(col, -0.15)]], W / 2 - 0.1, H / 2 - 0.1));
    noShadow(c);
    stroke(c, rgba(shade(col, -0.6), 0.9), 0.02);
    circle(c, W / 2, H / 2, 0.34);
    stroke(c, rgba(shade(col, -0.4), 0.4), 0.01);
    tableItems(c, W / 2 - 0.3, H / 2 - 0.3, 0.6, 0.6, R, k.theme);
    return;
  }
  const inset = 0.08;
  c.save();
  shadow(c, k, 0.15, 0.06, 0.1, 0.55);
  rrect(c, inset, inset, W - inset * 2, H - inset * 2, 0.05);
  fill(c, col);
  c.restore();
  woodPanel(c, inset, inset, W - inset * 2, H - inset * 2, col, Math.max(3, Math.round(Math.min(W, H) * 4)), W >= H, 0.05);
  rrect(c, inset + 0.04, inset + 0.04, W - inset * 2 - 0.08, H - inset * 2 - 0.08, 0.03);
  stroke(c, 'rgba(255,220,170,0.12)', 0.012);
  if (!k.noItems) tableItems(c, inset, inset, W - inset * 2, H - inset * 2, R, k.theme);
};

D.map_table = (c, o, k) => {
  D.table(c, o, { ...k, noItems: true });
  const { W, H, R } = k;
  c.save();
  c.translate(W / 2, H / 2);
  c.rotate((R() - 0.5) * 0.2);
  const mw = W * 0.7, mh = H * 0.62;
  c.fillStyle = 'rgba(0,0,0,0.3)';
  c.fillRect(-mw / 2 + 0.02, -mh / 2 + 0.03, mw, mh);
  c.fillStyle = '#e6d3a6';
  c.fillRect(-mw / 2, -mh / 2, mw, mh);
  c.strokeStyle = 'rgba(90,60,30,0.7)';
  c.lineWidth = 0.01;
  c.strokeRect(-mw / 2, -mh / 2, mw, mh);
  c.beginPath();
  for (let i = 0; i < 5; i++) {
    c.moveTo(-mw / 2 + R() * mw, -mh / 2 + R() * mh);
    c.bezierCurveTo(R() * mw - mw / 2, R() * mh - mh / 2, R() * mw - mw / 2, R() * mh - mh / 2, R() * mw - mw / 2, R() * mh - mh / 2);
  }
  c.stroke();
  for (let i = 0; i < 4; i++) {
    circle(c, (R() - 0.5) * mw * 0.8, (R() - 0.5) * mh * 0.8, 0.035);
    fill(c, ['#b02a2a', '#2a5ab0', '#e0c040', '#2a8a3a'][i]);
    stroke(c, 'rgba(0,0,0,0.6)', 0.008);
  }
  c.restore();
};

D.chair = (c, o, k) => chairAt(c, k.W / 2, k.H / 2, 0, k.woodCol || '#7a4b26');
D.stool = (c, o, k) => {
  const col = k.woodCol || '#7a4b26';
  circle(c, k.W / 2, k.H / 2, 0.18);
  shadow(c, k, 0.08, 0.04, 0.06, 0.5);
  fill(c, rad(c, k.W / 2, k.H / 2, 0, 0.18, [[0, shade(col, 0.2)], [1, shade(col, -0.2)]], k.W / 2 - 0.05, k.H / 2 - 0.05));
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.6)', 0.014);
  circle(c, k.W / 2, k.H / 2, 0.11);
  stroke(c, rgba(shade(col, -0.4), 0.5), 0.008);
};
D.bench = (c, o, k) => {
  const { W, H } = k;
  const col = k.woodCol || '#7a4b26';
  const along = W >= H;
  const t = 0.3;
  c.save();
  shadow(c, k, 0.1, 0.04, 0.07, 0.5);
  if (along) woodPanel(c, 0.06, H / 2 - t / 2, W - 0.12, t, col, 2, true, 0.03);
  else woodPanel(c, W / 2 - t / 2, 0.06, t, H - 0.12, col, 2, false, 0.03);
  c.restore();
};
D.pew = (c, o, k) => {
  const { W, H } = k;
  const col = shade(k.woodCol || '#6a3e1e', -0.1);
  const along = W >= H;
  c.save();
  shadow(c, k, 0.12, 0.05, 0.08, 0.5);
  if (along) {
    woodPanel(c, 0.04, H * 0.3, W - 0.08, 0.34, col, 2, true, 0.03);
    rrect(c, 0.04, H * 0.62, W - 0.08, 0.09, 0.02);
    fill(c, shade(col, -0.25));
    for (const ex of [0.02, W - 0.1]) {
      rrect(c, ex, H * 0.24, 0.08, 0.52, 0.03);
      fill(c, shade(col, -0.15));
    }
  } else {
    woodPanel(c, W * 0.3, 0.04, 0.34, H - 0.08, col, 2, false, 0.03);
    rrect(c, W * 0.62, 0.04, 0.09, H - 0.08, 0.02);
    fill(c, shade(col, -0.25));
  }
  c.restore();
};

D.barrel = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) * 0.38;
  const col = vary('#8a5a30', R, 0.08);
  circle(c, cx, cy, r);
  shadow(c, k, 0.12, 0.05, 0.08, 0.55);
  fill(c, col);
  noShadow(c);
  // staves (lid planks)
  c.save();
  circle(c, cx, cy, r);
  c.clip();
  const n = 5;
  for (let i = 0; i < n; i++) {
    c.fillStyle = vary(col, R, 0.08);
    c.fillRect(cx - r + (i * 2 * r) / n, cy - r, (2 * r) / n, 2 * r);
  }
  c.strokeStyle = 'rgba(30,15,5,0.5)';
  c.lineWidth = 0.01;
  c.beginPath();
  for (let i = 1; i < n; i++) {
    c.moveTo(cx - r + (i * 2 * r) / n, cy - r);
    c.lineTo(cx - r + (i * 2 * r) / n, cy + r);
  }
  c.stroke();
  circle(c, cx, cy, r);
  fill(c, rad(c, cx, cy, r * 0.2, r, [[0, 'rgba(255,220,170,0.1)'], [1, 'rgba(0,0,0,0.35)']], cx - r * 0.3, cy - r * 0.3));
  c.restore();
  circle(c, cx, cy, r * 0.96);
  stroke(c, '#3e3f42', r * 0.12);
  circle(c, cx, cy, r * 0.96);
  stroke(c, 'rgba(200,200,210,0.25)', r * 0.03);
  circle(c, cx, cy, r);
  stroke(c, 'rgba(0,0,0,0.7)', 0.015);
  circle(c, cx + r * 0.35, cy + r * 0.1, r * 0.09);
  fill(c, '#3a2412');
};

D.crate = (c, o, k) => {
  const { W, H, R } = k;
  const s = Math.min(W, H) * 0.8;
  const x = (W - s) / 2, y = (H - s) / 2;
  const col = vary('#9a7040', R, 0.08);
  c.save();
  c.translate(W / 2, H / 2);
  c.rotate((R() - 0.5) * 0.25);
  c.translate(-W / 2, -H / 2);
  rrect(c, x, y, s, s, 0.02);
  shadow(c, k, 0.12, 0.05, 0.08, 0.55);
  fill(c, col);
  noShadow(c);
  woodPanel(c, x, y, s, s, col, 4, true, 0.02);
  const f = s * 0.13;
  c.fillStyle = shade(col, -0.18);
  c.fillRect(x, y, s, f);
  c.fillRect(x, y + s - f, s, f);
  c.fillRect(x, y, f, s);
  c.fillRect(x + s - f, y, f, s);
  c.strokeStyle = rgba(shade(col, -0.55), 0.7);
  c.lineWidth = 0.012;
  c.strokeRect(x + f, y + f, s - 2 * f, s - 2 * f);
  c.beginPath();
  c.moveTo(x + f, y + f);
  c.lineTo(x + s - f, y + s - f);
  c.lineWidth = f * 0.8;
  c.strokeStyle = shade(col, -0.12);
  c.stroke();
  c.lineWidth = 0.01;
  c.strokeStyle = rgba(shade(col, -0.55), 0.7);
  c.stroke();
  for (const [nx, ny] of [[x + f / 2, y + f / 2], [x + s - f / 2, y + f / 2], [x + f / 2, y + s - f / 2], [x + s - f / 2, y + s - f / 2]]) {
    circle(c, nx, ny, 0.012);
    fill(c, '#2a2a2a');
  }
  rrect(c, x, y, s, s, 0.02);
  stroke(c, 'rgba(0,0,0,0.7)', 0.016);
  c.restore();
};

D.bed = (c, o, k) => {
  const { W, H, R } = k;
  const long = H >= W; // head at top
  c.save();
  if (!long) {
    c.translate(W, 0);
    c.rotate(Math.PI / 2);
  }
  const bw = long ? W : H, bh = long ? H : W;
  const col = k.woodCol || '#6a4020';
  rrect(c, 0.06, 0.04, bw - 0.12, bh - 0.08, 0.04);
  shadow(c, k, 0.12, 0.05, 0.08, 0.55);
  fill(c, col);
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.7)', 0.016);
  // mattress
  rrect(c, 0.12, 0.1, bw - 0.24, bh - 0.18, 0.05);
  fill(c, '#d9ccb0');
  // blanket
  const bc = vary(['#7a2a2a', '#2a4a7a', '#3a6a3a', '#6a4a7a', '#8a6a3a'][(R() * 5) | 0], R, 0.05);
  rrect(c, 0.1, bh * 0.36, bw - 0.2, bh * 0.6 - 0.06, 0.05);
  fill(c, lin(c, 0, bh * 0.36, bw, bh, [[0, shade(bc, 0.12)], [1, shade(bc, -0.2)]]));
  c.strokeStyle = rgba(shade(bc, -0.4), 0.6);
  c.lineWidth = 0.01;
  c.beginPath();
  c.moveTo(0.12, bh * 0.44);
  c.lineTo(bw - 0.12, bh * 0.44);
  c.stroke();
  c.strokeStyle = rgba(shade(bc, 0.3), 0.4);
  c.beginPath();
  for (let i = 0; i < 3; i++) {
    c.moveTo(0.12 + R() * 0.2, bh * (0.55 + i * 0.12));
    c.quadraticCurveTo(bw / 2, bh * (0.55 + i * 0.12) + 0.04, bw - 0.12 - R() * 0.2, bh * (0.55 + i * 0.12));
  }
  c.stroke();
  // pillow
  rrect(c, 0.18, 0.13, bw - 0.36, bh * 0.17, 0.05);
  fill(c, '#f2ecdc');
  stroke(c, 'rgba(0,0,0,0.25)', 0.01);
  // headboard
  rrect(c, 0.04, 0.02, bw - 0.08, 0.07, 0.02);
  fill(c, shade(col, -0.2));
  c.restore();
};

function counter(c, o, k, items) {
  const { W, H, R } = k;
  const col = k.woodCol || '#6a3e1e';
  const along = W >= H;
  const t = along ? Math.min(H, 0.7) : Math.min(W, 0.7);
  const x = along ? 0.02 : (W - t) / 2, y = along ? (H - t) / 2 : 0.02;
  const w = along ? W - 0.04 : t, h = along ? t : H - 0.04;
  c.save();
  shadow(c, k, 0.14, 0.06, 0.1, 0.55);
  rrect(c, x, y, w, h, 0.05);
  fill(c, col);
  c.restore();
  woodPanel(c, x, y, w, h, col, 3, along, 0.05);
  rrect(c, x + 0.05, y + 0.05, w - 0.1, h - 0.1, 0.03);
  stroke(c, 'rgba(255,220,170,0.14)', 0.014);
  if (items) tableItems(c, x, y, w, h, R, k.theme);
}
D.bar = (c, o, k) => counter(c, o, k, true);
D.counter = (c, o, k) => counter(c, o, { ...k, woodCol: '#8a6038' }, true);

function shelfBase(c, o, k) {
  const { W, H } = k;
  const along = W >= H;
  const t = 0.36;
  const x = along ? 0.02 : (W - t) / 2, y = along ? (H - t) / 2 : 0.02;
  const w = along ? W - 0.04 : t, h = along ? t : H - 0.04;
  rrect(c, x, y, w, h, 0.02);
  shadow(c, k, 0.12, 0.05, 0.09, 0.55);
  fill(c, '#4a2c16');
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.7)', 0.016);
  return { x, y, w, h, along };
}
D.bookshelf = (c, o, k) => {
  const { R } = k;
  const { x, y, w, h, along } = shelfBase(c, o, k);
  const L = along ? w : h;
  let p = 0.04;
  const cols = ['#7a2020', '#204a7a', '#2a6a30', '#7a6020', '#5a2a6a', '#3a3a3a', '#8a4a20', '#c0a060'];
  while (p < L - 0.04) {
    const bw = 0.03 + R() * 0.04;
    if (p + bw > L - 0.04) break;
    const depth = 0.18 + R() * 0.12;
    const col = cols[(R() * cols.length) | 0];
    c.fillStyle = col;
    if (along) c.fillRect(x + p, y + 0.04, bw, depth);
    else c.fillRect(x + 0.04, y + p, depth, bw);
    c.fillStyle = 'rgba(255,230,150,0.35)';
    if (along) c.fillRect(x + p, y + 0.04 + depth * 0.2, bw, 0.012);
    else c.fillRect(x + 0.04 + depth * 0.2, y + p, 0.012, bw);
    p += bw + (R() < 0.08 ? 0.06 : 0.004);
  }
};
D.shelf = (c, o, k) => {
  const { R } = k;
  const { x, y, w, h, along } = shelfBase(c, o, k);
  const L = along ? w : h;
  for (let p = 0.08; p < L - 0.06; p += 0.12 + R() * 0.1) {
    const px = along ? x + p : x + w / 2, py = along ? y + h / 2 : y + p;
    const t = R();
    if (t < 0.5) {
      circle(c, px, py, 0.05 + R() * 0.03);
      fill(c, R() < 0.5 ? '#8a6a4a' : '#5a7a6a');
      stroke(c, 'rgba(0,0,0,0.5)', 0.008);
    } else if (t < 0.8) {
      c.fillStyle = R() < 0.5 ? '#a08050' : '#706050';
      c.fillRect(px - 0.06, py - 0.06, 0.12, 0.12);
    } else {
      circle(c, px, py, 0.035);
      fill(c, '#2f5a2a');
    }
  }
};

D.fireplace = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  const stone = '#7a736a';
  rrect(c, cx - W * 0.48, cy - H * 0.46, W * 0.96, H * 0.92, 0.06);
  shadow(c, k, 0.18, 0.06, 0.1, 0.6);
  fill(c, stone);
  noShadow(c);
  // stone blocks
  c.save();
  c.clip();
  for (let i = 0; i < 18; i++) {
    c.beginPath();
    angularPoly(c, cx + (R() - 0.5) * W, cy + (R() - 0.5) * H, s * (0.1 + R() * 0.08), R, 5, 0.3);
    fill(c, vary(stone, R, 0.15));
    stroke(c, 'rgba(0,0,0,0.4)', 0.012);
  }
  c.restore();
  rrect(c, cx - W * 0.48, cy - H * 0.46, W * 0.96, H * 0.92, 0.06);
  stroke(c, 'rgba(0,0,0,0.7)', 0.02);
  // firebox
  rrect(c, cx - W * 0.32, cy - H * 0.28, W * 0.64, H * 0.56, 0.08);
  fill(c, '#1a1210');
  coals(c, cx, cy, s * 0.22, R);
  c.lineCap = 'round';
  line(c, cx - s * 0.2, cy + s * 0.05, cx + s * 0.18, cy - s * 0.08, '#3a2414', 0.07);
  line(c, cx - s * 0.15, cy - s * 0.1, cx + s * 0.2, cy + s * 0.08, '#4a2e18', 0.07);
};

D.brazier = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.5;
    line(c, cx, cy, cx + Math.cos(a) * s * 0.42, cy + Math.sin(a) * s * 0.42, '#2a2a2c', 0.045);
  }
  circle(c, cx, cy, s * 0.3);
  shadow(c, k, 0.14, 0.08, 0.12, 0.6);
  fill(c, '#2e2e31');
  noShadow(c);
  circle(c, cx, cy, s * 0.3);
  stroke(c, '#5a5a60', 0.03);
  coals(c, cx, cy, s * 0.24, R);
};

D.torch = (c, o, k) => {
  const { W, H } = k;
  const cx = W / 2, cy = H / 2;
  // wall sconce: bracket toward the nearest wall, torch head
  const [wx, wy] = k.wallDir || [0, -1];
  line(c, cx + wx * 0.42, cy + wy * 0.42, cx + wx * 0.1, cy + wy * 0.1, '#2a2a2c', 0.05);
  circle(c, cx + wx * 0.42, cy + wy * 0.42, 0.05);
  fill(c, '#3a3a3e');
  circle(c, cx, cy, 0.09);
  shadow(c, k, 0.08, 0.04, 0.06, 0.6);
  fill(c, '#3a2410');
  noShadow(c);
  flameCore(c, cx, cy, 0.09);
};

D.campfire = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  circle(c, cx, cy, s * 0.4);
  fill(c, rad(c, cx, cy, 0, s * 0.42, [[0, 'rgba(30,25,20,0.9)'], [0.7, 'rgba(60,55,50,0.6)'], [1, 'rgba(60,55,50,0)']]));
  stoneRing(c, cx, cy, s * 0.33, 9, s * 0.075, R);
  coals(c, cx, cy, s * 0.2, R);
  c.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + R() * 0.4;
    line(c, cx - Math.cos(a) * s * 0.22, cy - Math.sin(a) * s * 0.22, cx + Math.cos(a) * s * 0.22, cy + Math.sin(a) * s * 0.22, i % 2 ? '#3e2814' : '#2e1c0e', 0.06);
  }
};

D.chest = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  c.save();
  c.translate(W / 2, H / 2);
  if (!along) c.rotate(Math.PI / 2);
  c.rotate((R() - 0.5) * 0.15);
  const cw = Math.max(W, H) * 0.72, ch = Math.min(W, H) * 0.5;
  rrect(c, -cw / 2, -ch / 2, cw, ch, 0.04);
  shadow(c, k, 0.12, 0.05, 0.08, 0.6);
  fill(c, '#7a4a22');
  noShadow(c);
  woodPanel(c, -cw / 2, -ch / 2, cw, ch, '#7a4a22', 3, true, 0.04);
  c.fillStyle = '#c9a03a';
  for (const f of [-0.32, 0.32]) c.fillRect(f * cw - 0.025, -ch / 2, 0.05, ch);
  c.strokeStyle = '#5a4210';
  c.lineWidth = 0.01;
  for (const f of [-0.32, 0.32]) c.strokeRect(f * cw - 0.025, -ch / 2, 0.05, ch);
  rrect(c, -0.05, ch / 2 - 0.1, 0.1, 0.1, 0.015);
  fill(c, '#d8b040');
  stroke(c, '#4a3408', 0.01);
  circle(c, 0, ch / 2 - 0.055, 0.014);
  fill(c, '#2a1a04');
  rrect(c, -cw / 2, -ch / 2, cw, ch, 0.04);
  stroke(c, 'rgba(0,0,0,0.75)', 0.016);
  c.restore();
};

D.altar = (c, o, k) => {
  const { W, H, R } = k;
  const col = k.theme === 'temple' ? '#cfc6b4' : '#6e6a64';
  rrect(c, 0.06, 0.06, W - 0.12, H - 0.12, 0.04);
  shadow(c, k, 0.2, 0.08, 0.12, 0.6);
  fill(c, lin(c, 0, 0, W, H, [[0, shade(col, 0.12)], [1, shade(col, -0.25)]]));
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.7)', 0.02);
  rrect(c, 0.12, 0.12, W - 0.24, H - 0.24, 0.03);
  stroke(c, 'rgba(255,255,255,0.15)', 0.015);
  const along = W >= H;
  const cloth = k.theme === 'crypt' ? '#3a2a4a' : '#7a1c22';
  c.fillStyle = cloth;
  if (along) c.fillRect(0.06, H / 2 - H * 0.22, W - 0.12, H * 0.44);
  else c.fillRect(W / 2 - W * 0.22, 0.06, W * 0.44, H - 0.12);
  c.strokeStyle = '#c9a03a';
  c.lineWidth = 0.02;
  if (along) c.strokeRect(0.06, H / 2 - H * 0.22, W - 0.12, H * 0.44);
  else c.strokeRect(W / 2 - W * 0.22, 0.06, W * 0.44, H - 0.12);
  // bowl/skull/book in the middle
  circle(c, W / 2, H / 2, 0.12);
  fill(c, k.theme === 'crypt' ? '#d8d0bc' : '#b8962e');
  stroke(c, 'rgba(0,0,0,0.6)', 0.012);
  circle(c, W / 2, H / 2, 0.07);
  fill(c, k.theme === 'crypt' ? '#2a2420' : '#6a1010');
  for (const [px, py] of [[0.16, 0.16], [W - 0.16, 0.16], [0.16, H - 0.16], [W - 0.16, H - 0.16]]) {
    circle(c, px, py, 0.045);
    fill(c, '#efe8d4');
    stroke(c, 'rgba(0,0,0,0.4)', 0.008);
    circle(c, px, py, 0.02);
    fill(c, '#ffcf55');
  }
  if (R() < 0.3) {
    circle(c, W * 0.3, H * 0.7, 0.07);
    fill(c, 'rgba(110,10,10,0.5)');
  }
};

D.well = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  circle(c, cx, cy, s * 0.46);
  shadow(c, k, 0.18, 0.07, 0.12, 0.6);
  fill(c, '#7a746a');
  noShadow(c);
  for (let i = 0; i < 14; i++) {
    const a0 = (i / 14) * TAU, a1 = ((i + 1) / 14) * TAU;
    c.beginPath();
    c.arc(cx, cy, s * 0.45, a0 + 0.02, a1 - 0.02);
    c.arc(cx, cy, s * 0.31, a1 - 0.02, a0 + 0.02, true);
    c.closePath();
    fill(c, vary('#8c867c', R, 0.12));
    stroke(c, 'rgba(0,0,0,0.45)', 0.01);
  }
  circle(c, cx, cy, s * 0.3);
  fill(c, rad(c, cx, cy, 0, s * 0.3, [[0, '#0a1a24'], [0.8, '#163648'], [1, '#05080a']]));
  c.beginPath();
  c.arc(cx - s * 0.08, cy - s * 0.08, s * 0.12, 3.6, 4.6);
  stroke(c, 'rgba(180,220,240,0.35)', 0.015);
  // roof beam & posts
  c.save();
  c.translate(cx, cy);
  c.rotate(-0.3 + R() * 0.6);
  for (const px of [-s * 0.42, s * 0.42]) {
    rrect(c, px - 0.05, -0.05, 0.1, 0.1, 0.01);
    fill(c, '#5a3a1e');
    stroke(c, 'rgba(0,0,0,0.6)', 0.01);
  }
  rrect(c, -s * 0.45, -0.035, s * 0.9, 0.07, 0.015);
  fill(c, '#6e4826');
  stroke(c, 'rgba(0,0,0,0.6)', 0.01);
  circle(c, 0.08, 0.1, 0.07);
  fill(c, '#7a5030');
  stroke(c, '#333', 0.015);
  c.restore();
};

D.cart = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  c.save();
  if (!along) {
    c.translate(W, 0);
    c.rotate(Math.PI / 2);
  }
  const L = along ? W : H, T = along ? H : W;
  const bw = L * 0.68, bh = T * 0.62, bx = L * 0.05, by = (T - bh) / 2;
  // wheels (dark iron-rimmed discs seen edge-on) sticking out on both sides
  const wl = Math.min(0.62, bw * 0.42), wt = 0.11;
  for (const wy of [by - wt * 0.75, by + bh - wt * 0.25]) {
    rrect(c, bx + bw * 0.5 - wl / 2, wy, wl, wt, 0.03);
    shadow(c, k, 0.08, 0.04, 0.06, 0.55);
    fill(c, '#4a3018');
    noShadow(c);
    stroke(c, '#1a1008', 0.018);
    c.strokeStyle = 'rgba(200,200,210,0.35)';
    c.lineWidth = 0.012;
    c.beginPath();
    for (let s = 1; s < 5; s++) {
      c.moveTo(bx + bw * 0.5 - wl / 2 + (wl * s) / 5, wy + 0.015);
      c.lineTo(bx + bw * 0.5 - wl / 2 + (wl * s) / 5, wy + wt - 0.015);
    }
    c.stroke();
  }
  // shafts + yoke
  c.lineCap = 'round';
  line(c, bx + bw - 0.02, by + bh * 0.22, L - 0.06, T / 2 - 0.08, '#5a3a1e', 0.055);
  line(c, bx + bw - 0.02, by + bh * 0.78, L - 0.06, T / 2 + 0.08, '#5a3a1e', 0.055);
  line(c, L - 0.08, T / 2 - 0.16, L - 0.08, T / 2 + 0.16, '#4a2e16', 0.05);
  c.save();
  shadow(c, k, 0.14, 0.06, 0.1, 0.55);
  rrect(c, bx, by, bw, bh, 0.03);
  fill(c, '#7a5232');
  c.restore();
  woodPanel(c, bx, by, bw, bh, '#8a6038', Math.max(4, Math.round(bh * 8)), true, 0.03);
  // side boards
  c.fillStyle = '#4e321a';
  c.fillRect(bx, by, bw, 0.06);
  c.fillRect(bx, by + bh - 0.06, bw, 0.06);
  c.fillRect(bx, by, 0.06, bh);
  rrect(c, bx, by, bw, bh, 0.03);
  stroke(c, '#2a180a', 0.025);
  // cargo
  const n = (R() * 4) | 0;
  for (let i = 0; i < n; i++) {
    const px = bx + 0.15 + R() * (bw - 0.3), py = by + 0.15 + R() * (bh - 0.3);
    if (R() < 0.5) {
      c.beginPath();
      irregularPoly(c, px, py, 0.14, 0.11, R() * 3, R, 7, 0.2);
      fill(c, '#b09a6a');
      stroke(c, 'rgba(0,0,0,0.5)', 0.01);
    } else {
      rrect(c, px - 0.12, py - 0.12, 0.24, 0.24, 0.02);
      fill(c, '#9a7040');
      stroke(c, 'rgba(0,0,0,0.6)', 0.012);
    }
  }
  c.restore();
};

D.tent = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  c.save();
  if (!along) {
    c.translate(W, 0);
    c.rotate(Math.PI / 2);
  }
  const L = along ? W : H, T = along ? H : W;
  const cols = [['#d8c49a', '#8f7a52'], ['#b2493a', '#6a2418'], ['#7a8a50', '#3e4a26'], ['#cfc6ae', '#7f7864']];
  const [lc, dc] = cols[(R() * cols.length) | 0];
  const striped = R() < 0.3;
  const x0 = 0.14, x1 = L - 0.12, y0 = 0.12, y1 = T - 0.12, ym = T / 2;
  const sag = (y1 - y0) * 0.06; // canvas sags between the poles
  // guy ropes & pegs
  c.strokeStyle = 'rgba(225,215,185,0.75)';
  c.lineWidth = 0.012;
  c.beginPath();
  const pegs = [[x0, y0, -0.1, -0.1], [x1, y0, 0.1, -0.1], [x0, y1, -0.1, 0.1], [x1, y1, 0.1, 0.1], [(x0 + x1) / 2, y0 + sag, 0, -0.12], [(x0 + x1) / 2, y1 - sag, 0, 0.12], [x0, ym, -0.12, 0], [x1, ym, 0.12, 0]];
  for (const [px, py, dx, dy] of pegs) {
    c.moveTo(px, py);
    c.lineTo(px + dx, py + dy);
  }
  c.stroke();
  for (const [px, py, dx, dy] of pegs) {
    circle(c, px + dx, py + dy, 0.018);
    fill(c, '#3a2a1a');
  }
  const half = (top) => {
    c.beginPath();
    c.moveTo(x0, ym);
    c.lineTo(x0, top ? y0 : y1);
    c.quadraticCurveTo((x0 + x1) / 2, top ? y0 + sag * 2 : y1 - sag * 2, x1, top ? y0 : y1);
    c.lineTo(x1, ym);
    c.closePath();
  };
  c.save();
  half(true);
  c.rect(x0, ym, x1 - x0, y1 - ym);
  shadow(c, k, 0.22, 0.1, 0.16, 0.6);
  fill(c, dc);
  c.restore();
  half(true);
  fill(c, lin(c, 0, y0, 0, ym, [[0, shade(lc, -0.08)], [1, shade(lc, 0.18)]]));
  half(false);
  fill(c, lin(c, 0, ym, 0, y1, [[0, shade(dc, 0.05)], [1, shade(dc, -0.25)]]));
  if (striped) {
    c.save();
    half(true);
    half(false);
    c.clip();
    c.fillStyle = 'rgba(255,250,235,0.28)';
    for (let sx = x0 + 0.05; sx < x1; sx += 0.24) c.fillRect(sx, y0, 0.1, y1 - y0);
    c.restore();
  }
  // seams & ridge
  c.strokeStyle = 'rgba(0,0,0,0.18)';
  c.lineWidth = 0.01;
  c.beginPath();
  for (let sx = x0 + 0.3; sx < x1 - 0.1; sx += 0.3) {
    c.moveTo(sx, y0 + sag);
    c.lineTo(sx, y1 - sag);
  }
  c.stroke();
  line(c, x0 - 0.03, ym, x1 + 0.03, ym, shade(dc, -0.45), 0.035);
  line(c, x0, ym - 0.012, x1, ym - 0.012, 'rgba(255,245,220,0.35)', 0.012);
  for (const px of [x0 - 0.03, x1 + 0.03]) {
    circle(c, px, ym, 0.03);
    fill(c, '#3a2a1a');
  }
  // open door flap at the front end
  c.beginPath();
  c.moveTo(x1, ym - (ym - y0) * 0.55);
  c.lineTo(x1 - 0.2, ym);
  c.lineTo(x1, ym + (y1 - ym) * 0.55);
  c.closePath();
  fill(c, '#17110b');
  c.beginPath();
  c.moveTo(x1, ym - (ym - y0) * 0.55);
  c.lineTo(x1 + 0.08, ym - (ym - y0) * 0.75);
  c.lineTo(x1 - 0.06, ym - 0.04);
  c.closePath();
  fill(c, shade(lc, 0.1));
  half(true);
  half(false);
  stroke(c, 'rgba(30,20,10,0.6)', 0.016);
  c.restore();
};

D.stalagmite = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  const col = k.pal?.wall?.rim || '#857a6c';
  // stepped, jagged cone seen from above: wide dark base -> pale wet tip (off-centre toward the light)
  const layers = [
    [0.44, -0.3, 0, 9],
    [0.32, -0.12, 0.04, 8],
    [0.21, 0.08, 0.08, 7],
    [0.11, 0.3, 0.11, 6],
  ];
  layers.forEach(([r, lv, off, n], i) => {
    c.beginPath();
    angularPoly(c, cx - s * off, cy - s * off * 1.2, s * r, R, n, 0.35, R() * 3);
    if (i === 0) shadow(c, k, 0.22, 0.12, 0.18, 0.65);
    fill(c, lin(c, cx - s * r, cy - s * r, cx + s * r, cy + s * r, [[0, shade(col, lv + 0.12)], [1, shade(col, lv - 0.2)]]));
    noShadow(c);
    stroke(c, 'rgba(0,0,0,0.45)', 0.012);
  });
  circle(c, cx - s * 0.13, cy - s * 0.15, s * 0.035);
  fill(c, 'rgba(255,255,255,0.55)');
};

function bone(c, x0, y0, x1, y1, w, col) {
  c.lineCap = 'round';
  line(c, x0, y0, x1, y1, col, w);
  for (const [x, y] of [[x0, y0], [x1, y1]]) {
    const a = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
    circle(c, x + Math.cos(a) * w * 0.5, y + Math.sin(a) * w * 0.5, w * 0.6);
    fill(c, col);
    circle(c, x - Math.cos(a) * w * 0.5, y - Math.sin(a) * w * 0.5, w * 0.6);
    fill(c, col);
  }
}
function skull(c, x, y, s, rot) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.beginPath();
  c.ellipse(0, 0, s, s * 0.85, 0, 0, TAU);
  fill(c, '#e0d6bc');
  stroke(c, 'rgba(60,50,30,0.6)', s * 0.08);
  circle(c, -s * 0.35, s * 0.05, s * 0.22);
  fill(c, '#2a2218');
  circle(c, s * 0.35, s * 0.05, s * 0.22);
  fill(c, '#2a2218');
  c.beginPath();
  c.moveTo(0, s * 0.35);
  c.lineTo(-s * 0.1, s * 0.55);
  c.lineTo(s * 0.1, s * 0.55);
  c.closePath();
  fill(c, '#2a2218');
  c.restore();
}
D.bones = (c, o, k) => {
  const { W, H, R } = k;
  const n = 3 + ((R() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const x = 0.15 + R() * (W - 0.3), y = 0.15 + R() * (H - 0.3), a = R() * TAU, L = 0.12 + R() * 0.14;
    bone(c, x - Math.cos(a) * L, y - Math.sin(a) * L, x + Math.cos(a) * L, y + Math.sin(a) * L, 0.035, R() < 0.5 ? '#d8cfb6' : '#c8bc9e');
  }
  // ribs
  if (R() < 0.6) {
    const rx = 0.3 + R() * (W - 0.6), ry = 0.3 + R() * (H - 0.6);
    for (let i = 0; i < 4; i++) {
      c.beginPath();
      c.arc(rx, ry + i * 0.06, 0.12, Math.PI * 1.1, Math.PI * 1.9);
      stroke(c, '#d2c8ae', 0.022);
    }
  }
  skull(c, 0.2 + R() * (W - 0.4), 0.2 + R() * (H - 0.4), 0.09, R() * TAU);
};

D.rug = (c, o, k) => {
  const { W, H, R } = k;
  const pals = [['#7a1c22', '#c9a03a', '#2a1a4a'], ['#1e3a6a', '#d0b060', '#6a1c1c'], ['#2e5a3a', '#d8c080', '#5a2a1a'], ['#6a3a1a', '#e0c890', '#1a3a4a']];
  const [fieldC, borderC, accent] = pals[(R() * pals.length) | 0];
  const x = 0.08, y = 0.08, w = W - 0.16, h = H - 0.16;
  c.fillStyle = 'rgba(0,0,0,0.25)';
  c.fillRect(x + 0.02, y + 0.03, w, h);
  // fringe
  c.strokeStyle = '#e8dcc0';
  c.lineWidth = 0.008;
  c.beginPath();
  const along = W >= H;
  if (along) {
    for (let yy = y; yy <= y + h; yy += 0.03) {
      c.moveTo(x, yy);
      c.lineTo(x - 0.05, yy);
      c.moveTo(x + w, yy);
      c.lineTo(x + w + 0.05, yy);
    }
  } else {
    for (let xx = x; xx <= x + w; xx += 0.03) {
      c.moveTo(xx, y);
      c.lineTo(xx, y - 0.05);
      c.moveTo(xx, y + h);
      c.lineTo(xx, y + h + 0.05);
    }
  }
  c.stroke();
  c.fillStyle = borderC;
  c.fillRect(x, y, w, h);
  c.fillStyle = fieldC;
  const b = Math.min(w, h) * 0.12;
  c.fillRect(x + b, y + b, w - 2 * b, h - 2 * b);
  c.strokeStyle = accent;
  c.lineWidth = 0.02;
  c.strokeRect(x + b * 0.5, y + b * 0.5, w - b, h - b);
  // medallion
  const cx = W / 2, cy = H / 2, mr = Math.min(w, h) * 0.3;
  c.beginPath();
  c.moveTo(cx, cy - mr);
  c.lineTo(cx + mr * 1.3, cy);
  c.lineTo(cx, cy + mr);
  c.lineTo(cx - mr * 1.3, cy);
  c.closePath();
  fill(c, borderC);
  c.beginPath();
  c.moveTo(cx, cy - mr * 0.6);
  c.lineTo(cx + mr * 0.8, cy);
  c.lineTo(cx, cy + mr * 0.6);
  c.lineTo(cx - mr * 0.8, cy);
  c.closePath();
  fill(c, accent);
  circle(c, cx, cy, mr * 0.22);
  fill(c, borderC);
  // corner motifs
  for (const [px, py] of [[x + b * 2, y + b * 2], [x + w - b * 2, y + b * 2], [x + b * 2, y + h - b * 2], [x + w - b * 2, y + h - b * 2]]) {
    circle(c, px, py, b * 0.5);
    fill(c, borderC);
  }
  // wear texture
  c.save();
  c.globalAlpha = 0.18;
  for (let i = 0; i < 40; i++) {
    c.fillStyle = R() < 0.5 ? '#000' : '#fff';
    c.fillRect(x + R() * w, y + R() * h, 0.02, 0.02);
  }
  c.restore();
};

D.throne = (c, o, k) => {
  const { W, H } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  // dais
  rrect(c, cx - W * 0.48, cy - H * 0.48, W * 0.96, H * 0.96, 0.04);
  shadow(c, k, 0.18, 0.06, 0.1, 0.5);
  fill(c, '#5a5650');
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.6)', 0.015);
  rrect(c, cx - W * 0.4, cy - H * 0.4, W * 0.8, H * 0.8, 0.03);
  fill(c, '#6e6a63');
  // throne back (top), seat, arms
  c.save();
  shadow(c, k, 0.14, 0.06, 0.1, 0.6);
  c.beginPath();
  c.moveTo(cx - s * 0.32, cy - s * 0.12);
  c.lineTo(cx - s * 0.32, cy - s * 0.3);
  c.quadraticCurveTo(cx, cy - s * 0.52, cx + s * 0.32, cy - s * 0.3);
  c.lineTo(cx + s * 0.32, cy - s * 0.12);
  c.closePath();
  fill(c, lin(c, 0, cy - s * 0.5, 0, cy, [[0, '#e0b84a'], [1, '#8a6a1a']]));
  c.restore();
  stroke(c, '#4a3608', 0.015);
  rrect(c, cx - s * 0.3, cy - s * 0.14, s * 0.6, s * 0.44, 0.04);
  fill(c, '#b8902e');
  stroke(c, '#4a3608', 0.015);
  rrect(c, cx - s * 0.22, cy - s * 0.1, s * 0.44, s * 0.36, 0.05);
  fill(c, lin(c, 0, cy - s * 0.1, 0, cy + s * 0.26, [[0, '#a82a2a'], [1, '#5a1010']]));
  for (const ax of [cx - s * 0.32, cx + s * 0.24]) {
    rrect(c, ax, cy - s * 0.14, s * 0.08, s * 0.44, 0.02);
    fill(c, '#d0a840');
    stroke(c, '#4a3608', 0.01);
  }
  circle(c, cx, cy - s * 0.32, s * 0.05);
  fill(c, '#3a7ad0');
  stroke(c, '#d8e8ff', 0.008);
};

D.coffin = (c, o, k) => {
  const { W, H, R } = k;
  const along = H >= W;
  c.save();
  c.translate(W / 2, H / 2);
  if (!along) c.rotate(Math.PI / 2);
  const L = Math.max(W, H) * 0.86, T = Math.min(W, H) * 0.62;
  c.beginPath();
  c.moveTo(-T * 0.3, -L / 2);
  c.lineTo(T * 0.3, -L / 2);
  c.lineTo(T / 2, -L * 0.22);
  c.lineTo(T * 0.32, L / 2);
  c.lineTo(-T * 0.32, L / 2);
  c.lineTo(-T / 2, -L * 0.22);
  c.closePath();
  shadow(c, k, 0.14, 0.06, 0.1, 0.6);
  fill(c, lin(c, -T / 2, 0, T / 2, 0, [[0, '#5a3a22'], [0.5, '#6e4a2c'], [1, '#3e2614']]));
  noShadow(c);
  stroke(c, '#1e1208', 0.02);
  c.beginPath();
  c.moveTo(-T * 0.22, -L * 0.42);
  c.lineTo(T * 0.22, -L * 0.42);
  c.lineTo(T * 0.36, -L * 0.2);
  c.lineTo(T * 0.22, L * 0.42);
  c.lineTo(-T * 0.22, L * 0.42);
  c.lineTo(-T * 0.36, -L * 0.2);
  c.closePath();
  stroke(c, 'rgba(255,220,170,0.15)', 0.012);
  line(c, 0, -L * 0.28, 0, L * 0.05, '#a89060', 0.035);
  line(c, -T * 0.13, -L * 0.17, T * 0.13, -L * 0.17, '#a89060', 0.035);
  if (R() < 0.3) {
    // lid ajar
    c.translate(T * 0.08, 0);
    c.rotate(0.08);
    c.strokeStyle = 'rgba(0,0,0,0.6)';
    c.lineWidth = 0.02;
    c.stroke();
  }
  c.restore();
};

D.sarcophagus = (c, o, k) => {
  const { W, H, R } = k;
  const along = H >= W;
  c.save();
  c.translate(W / 2, H / 2);
  if (!along) c.rotate(Math.PI / 2);
  const L = Math.max(W, H) * 0.9, T = Math.min(W, H) * 0.8;
  const col = '#8a8680';
  rrect(c, -T / 2, -L / 2, T, L, 0.05);
  shadow(c, k, 0.2, 0.08, 0.13, 0.6);
  fill(c, lin(c, -T / 2, -L / 2, T / 2, L / 2, [[0, shade(col, 0.12)], [1, shade(col, -0.3)]]));
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.7)', 0.02);
  rrect(c, -T / 2 + 0.07, -L / 2 + 0.07, T - 0.14, L - 0.14, 0.04);
  stroke(c, 'rgba(255,255,255,0.15)', 0.014);
  // carved effigy
  const fc = shade(col, 0.15);
  circle(c, 0, -L * 0.3, T * 0.15);
  fill(c, fc);
  stroke(c, 'rgba(0,0,0,0.35)', 0.01);
  c.beginPath();
  c.moveTo(-T * 0.25, -L * 0.18);
  c.lineTo(T * 0.25, -L * 0.18);
  c.lineTo(T * 0.15, L * 0.38);
  c.lineTo(-T * 0.15, L * 0.38);
  c.closePath();
  fill(c, fc);
  stroke(c, 'rgba(0,0,0,0.35)', 0.01);
  line(c, -T * 0.18, -L * 0.02, T * 0.18, L * 0.06, 'rgba(0,0,0,0.3)', 0.03);
  line(c, T * 0.18, -L * 0.02, -T * 0.18, L * 0.06, 'rgba(0,0,0,0.3)', 0.03);
  line(c, 0, -L * 0.1, 0, L * 0.3, 'rgba(60,60,60,0.5)', 0.02);
  if (R() < 0.5) {
    circle(c, T * 0.2, L * 0.3, 0.06);
    fill(c, 'rgba(80,100,50,0.4)');
  }
  c.restore();
};

function stairs(c, o, k, down) {
  const { W, H } = k;
  // direction: steps run along the longer axis; "up/down" toward local -y
  const vertical = H >= W;
  c.save();
  if (!vertical) {
    c.translate(0, H);
    c.rotate(-Math.PI / 2);
  }
  const w = vertical ? W : H, h = vertical ? H : W;
  const n = Math.max(4, Math.round(h * 5));
  const col = k.theme === 'tavern' || k.theme === 'ship' || k.theme === 'village' ? '#7a5030' : '#7a756c';
  // cheeks
  c.fillStyle = 'rgba(0,0,0,0.45)';
  c.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const y = (i / n) * h;
    const lv = down ? -0.55 * (1 - t) : 0.25 * (1 - t) - 0.15;
    rrect(c, 0.08, y + 0.01, w - 0.16, h / n - 0.02, 0.015);
    fill(c, shade(col, lv));
    line(c, 0.08, y + h / n - 0.012, w - 0.08, y + h / n - 0.012, 'rgba(0,0,0,0.5)', 0.015);
    line(c, 0.1, y + 0.02, w - 0.1, y + 0.02, 'rgba(255,255,255,0.12)', 0.01);
  }
  c.fillStyle = shade(col, -0.35);
  c.fillRect(0, 0, 0.08, h);
  c.fillRect(w - 0.08, 0, 0.08, h);
  if (down) {
    c.fillStyle = lin(c, 0, 0, 0, h * 0.6, [[0, 'rgba(0,0,0,0.75)'], [1, 'rgba(0,0,0,0)']]);
    c.fillRect(0, 0, w, h * 0.6);
  }
  // arrow chevron
  c.strokeStyle = 'rgba(255,240,200,0.35)';
  c.lineWidth = 0.035;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(w / 2 - 0.12, h * 0.42);
  c.lineTo(w / 2, h * 0.3);
  c.lineTo(w / 2 + 0.12, h * 0.42);
  c.stroke();
  c.restore();
}
D.stairs_up = (c, o, k) => stairs(c, o, k, false);
D.stairs_down = (c, o, k) => stairs(c, o, k, true);

D.lever = (c, o, k) => {
  const { W, H } = k;
  const cx = W / 2, cy = H / 2;
  rrect(c, cx - 0.14, cy - 0.1, 0.28, 0.2, 0.03);
  shadow(c, k, 0.08, 0.03, 0.05, 0.6);
  fill(c, '#3a3a3e');
  noShadow(c);
  stroke(c, '#151515', 0.012);
  c.lineCap = 'round';
  line(c, cx, cy, cx + 0.16, cy - 0.22, '#6a6a70', 0.04);
  circle(c, cx + 0.16, cy - 0.22, 0.05);
  fill(c, '#a02020');
  stroke(c, '#300', 0.01);
};

D.fountain = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  circle(c, cx, cy, s * 0.47);
  shadow(c, k, 0.18, 0.06, 0.1, 0.55);
  fill(c, '#9a948a');
  noShadow(c);
  stroke(c, 'rgba(0,0,0,0.6)', 0.015);
  circle(c, cx, cy, s * 0.4);
  fill(c, rad(c, cx, cy, 0, s * 0.4, [[0, '#4a9ab0'], [0.8, '#2a6a8a'], [1, '#1a4a60']]));
  for (let i = 1; i <= 3; i++) {
    circle(c, cx, cy, s * (0.12 + i * 0.07));
    stroke(c, 'rgba(220,240,255,0.25)', 0.01);
  }
  circle(c, cx, cy, s * 0.12);
  fill(c, '#a8a296');
  stroke(c, 'rgba(0,0,0,0.5)', 0.012);
  circle(c, cx - s * 0.03, cy - s * 0.03, s * 0.05);
  fill(c, '#c8c2b6');
  c.beginPath();
  c.arc(cx - s * 0.12, cy - s * 0.12, s * 0.2, 3.5, 4.4);
  stroke(c, 'rgba(255,255,255,0.4)', 0.012);
  if (R() < 0.5) {
    circle(c, cx + s * 0.2, cy + s * 0.15, 0.025);
    fill(c, '#d8a030');
  }
};

D.anvil = (c, o, k) => {
  const { W, H } = k;
  const cx = W / 2, cy = H / 2;
  circle(c, cx, cy, 0.36);
  shadow(c, k, 0.1, 0.04, 0.06, 0.5);
  fill(c, '#6a4a2a');
  noShadow(c);
  circle(c, cx, cy, 0.3);
  stroke(c, 'rgba(0,0,0,0.3)', 0.01);
  c.beginPath();
  c.moveTo(cx - 0.24, cy - 0.1);
  c.lineTo(cx + 0.1, cy - 0.1);
  c.quadraticCurveTo(cx + 0.32, cy - 0.05, cx + 0.4, cy);
  c.quadraticCurveTo(cx + 0.32, cy + 0.05, cx + 0.1, cy + 0.1);
  c.lineTo(cx - 0.24, cy + 0.1);
  c.closePath();
  shadow(c, k, 0.1, 0.05, 0.08, 0.6);
  fill(c, lin(c, 0, cy - 0.1, 0, cy + 0.1, [[0, '#7a7c82'], [1, '#2e3034']]));
  noShadow(c);
  stroke(c, '#111', 0.012);
  c.fillStyle = 'rgba(255,255,255,0.25)';
  c.fillRect(cx - 0.2, cy - 0.08, 0.28, 0.02);
};

D.forge = (c, o, k) => {
  const { W, H, R } = k;
  rrect(c, 0.05, 0.05, W - 0.1, H - 0.1, 0.05);
  shadow(c, k, 0.18, 0.07, 0.12, 0.6);
  fill(c, '#6a645c');
  noShadow(c);
  c.save();
  c.clip();
  for (let i = 0; i < 14; i++) {
    c.beginPath();
    angularPoly(c, R() * W, R() * H, 0.12 + R() * 0.08, R, 5, 0.3);
    fill(c, vary('#6a645c', R, 0.15));
    stroke(c, 'rgba(0,0,0,0.35)', 0.01);
  }
  c.restore();
  rrect(c, 0.05, 0.05, W - 0.1, H - 0.1, 0.05);
  stroke(c, 'rgba(0,0,0,0.7)', 0.02);
  const pr = Math.min(W, H) * 0.28;
  rrect(c, W / 2 - pr, H / 2 - pr, pr * 2, pr * 2, 0.06);
  fill(c, '#1a1210');
  coals(c, W / 2, H / 2, pr * 0.85, R);
  // bellows
  c.beginPath();
  c.moveTo(W - 0.05, H / 2 - 0.15);
  c.lineTo(W + 0.3, H / 2 - 0.22);
  c.lineTo(W + 0.3, H / 2 + 0.22);
  c.lineTo(W - 0.05, H / 2 + 0.15);
  c.closePath();
  fill(c, '#5a3a22');
  stroke(c, '#1e1208', 0.012);
};

D.haybale = (c, o, k) => {
  const { W, H, R } = k;
  rrect(c, 0.08, 0.12, W - 0.16, H - 0.24, 0.08);
  shadow(c, k, 0.12, 0.05, 0.08, 0.5);
  fill(c, '#c9a84a');
  noShadow(c);
  c.save();
  c.clip();
  for (let i = 0; i < 120 * W * H; i++) {
    const x = R() * W, y = R() * H, a = (R() - 0.5) * 0.8;
    line(c, x, y, x + Math.cos(a) * 0.1, y + Math.sin(a) * 0.1, R() < 0.5 ? '#a0822e' : '#e8cc6a', 0.01);
  }
  c.restore();
  for (const f of [0.33, 0.66]) line(c, W * f, 0.12, W * f, H - 0.12, '#7a5a22', 0.02);
  rrect(c, 0.08, 0.12, W - 0.16, H - 0.24, 0.08);
  stroke(c, 'rgba(60,40,10,0.6)', 0.015);
};

D.fence = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  const L = along ? W : H;
  const col = '#7a5634';
  c.save();
  if (!along) {
    c.translate(W / 2, 0);
    c.rotate(Math.PI / 2);
    c.translate(0, -W / 2);
  } else c.translate(0, H / 2);
  shadow(c, k, 0.06, 0.03, 0.05, 0.5);
  for (const off of [-0.06, 0.06]) {
    rrect(c, 0, off - 0.025, L, 0.05, 0.01);
    fill(c, shade(col, R() * 0.1));
  }
  noShadow(c);
  for (let p = 0.1; p < L; p += 0.5) {
    rrect(c, p - 0.06, -0.06, 0.12, 0.12, 0.02);
    shadow(c, k, 0.06, 0.03, 0.05, 0.5);
    fill(c, shade(col, -0.15));
    noShadow(c);
    stroke(c, 'rgba(0,0,0,0.6)', 0.01);
  }
  c.restore();
};

D.log = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  c.save();
  c.translate(W / 2, H / 2);
  if (!along) c.rotate(Math.PI / 2);
  c.rotate((R() - 0.5) * 0.3);
  const L = Math.max(W, H) * 0.9, T = Math.min(W, H) * 0.42;
  rrect(c, -L / 2, -T / 2, L, T, T / 2);
  shadow(c, k, 0.14, 0.06, 0.1, 0.55);
  fill(c, lin(c, 0, -T / 2, 0, T / 2, [[0, '#7a5a3a'], [0.4, '#5a3e24'], [1, '#2e1e10']]));
  noShadow(c);
  c.save();
  c.clip();
  for (let i = 0; i < 12; i++) {
    const y = -T / 2 + R() * T, x = -L / 2 + R() * L * 0.8;
    line(c, x, y, x + L * (0.1 + R() * 0.2), y + (R() - 0.5) * 0.02, 'rgba(20,10,5,0.5)', 0.012);
  }
  for (let i = 0; i < 3; i++) {
    circle(c, -L / 2 + R() * L, -T / 2 + R() * T * 0.5, T * 0.2);
    fill(c, 'rgba(80,110,40,0.45)');
  }
  c.restore();
  // cut end with rings
  c.beginPath();
  c.ellipse(L / 2 - T * 0.15, 0, T * 0.22, T / 2 - 0.01, 0, 0, TAU);
  fill(c, '#b08a5a');
  for (let r = 1; r <= 3; r++) {
    c.beginPath();
    c.ellipse(L / 2 - T * 0.15, 0, (T * 0.22 * r) / 4, ((T / 2) * r) / 4, 0, 0, TAU);
    stroke(c, 'rgba(90,60,30,0.6)', 0.008);
  }
  c.restore();
};

D.mushroom = (c, o, k) => {
  const { W, H, R } = k;
  const glow = k.theme === 'cave' || k.theme === 'mine' ? R() < 0.7 : R() < 0.15;
  const n = 3 + ((R() * 5) | 0);
  const types = glow ? [['#3ab0c8', '#bff4ff'], ['#7a5ad0', '#e0d0ff']] : [['#b02a22', '#f2e8d8'], ['#a07a4a', '#e8d8b0'], ['#c8a060', '#fff0c0']];
  const [cap, spot] = types[(R() * types.length) | 0];
  for (let i = 0; i < n; i++) {
    const x = 0.2 + R() * (W - 0.4), y = 0.2 + R() * (H - 0.4), r = 0.05 + R() * 0.09;
    if (glow) {
      circle(c, x, y, r * 2.4);
      fill(c, rad(c, x, y, 0, r * 2.4, [[0, rgba(cap, 0.4)], [1, rgba(cap, 0)]]));
    }
    circle(c, x, y, r);
    shadow(c, k, 0.05, 0.02, 0.04, 0.5);
    fill(c, rad(c, x, y, 0, r, [[0, shade(cap, 0.3)], [1, shade(cap, -0.2)]], x - r * 0.3, y - r * 0.3));
    noShadow(c);
    stroke(c, 'rgba(0,0,0,0.45)', 0.008);
    for (let s = 0; s < 3; s++) {
      circle(c, x + (R() - 0.5) * r, y + (R() - 0.5) * r, r * 0.15);
      fill(c, spot);
    }
  }
};

D.crystal = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2;
  const hue = (o.light && o.light.color) || (R() < 0.5 ? '#6ad8ff' : '#c08aff');
  circle(c, cx, cy, Math.min(W, H) * 0.6);
  fill(c, rad(c, cx, cy, 0, Math.min(W, H) * 0.6, [[0, rgba(hue, 0.35)], [1, rgba(hue, 0)]]));
  // a fan of prisms growing out of one base, longest in the middle
  const n = 4 + ((R() * 3) | 0);
  const dir = R() * TAU;
  const prisms = [];
  for (let i = 0; i < n; i++) {
    const t = n > 1 ? i / (n - 1) - 0.5 : 0;
    prisms.push({ a: dir + t * 2.2 + (R() - 0.5) * 0.25, L: Math.min(W, H) * (0.46 - Math.abs(t) * 0.28 + R() * 0.06), T: 0.06 + R() * 0.035 });
  }
  prisms.sort((p, q) => q.L - p.L).reverse();
  const bx = cx - Math.cos(dir) * Math.min(W, H) * 0.18, by = cy - Math.sin(dir) * Math.min(W, H) * 0.18;
  c.beginPath();
  c.ellipse(bx, by, 0.12, 0.09, dir, 0, TAU);
  fill(c, '#4a4440');
  for (const { a, L, T } of prisms) {
    c.save();
    c.translate(bx, by);
    c.rotate(a);
    c.beginPath();
    c.moveTo(0, -T);
    c.lineTo(L * 0.8, -T);
    c.lineTo(L, 0);
    c.lineTo(L * 0.8, T);
    c.lineTo(0, T);
    c.closePath();
    shadow(c, k, 0.08, 0.04, 0.06, 0.5);
    fill(c, shade(hue, -0.3));
    noShadow(c);
    c.beginPath();
    c.moveTo(0, -T);
    c.lineTo(L * 0.8, -T);
    c.lineTo(L, 0);
    c.lineTo(0, 0);
    c.closePath();
    fill(c, shade(hue, 0.25));
    c.beginPath();
    c.moveTo(0, -T);
    c.lineTo(L * 0.8, -T);
    c.lineTo(L, 0);
    c.lineTo(L * 0.8, T);
    c.lineTo(0, T);
    c.closePath();
    stroke(c, rgba(shade(hue, -0.6), 0.8), 0.01);
    line(c, L * 0.15, -T * 0.55, L * 0.7, -T * 0.55, 'rgba(255,255,255,0.45)', 0.01);
    c.restore();
  }
};

D.web = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W * (0.3 + R() * 0.4), cy = H * (0.3 + R() * 0.4);
  const n = 9 + ((R() * 4) | 0);
  const rr = Math.max(W, H) * 0.75;
  const spokes = [];
  c.strokeStyle = 'rgba(235,235,230,0.55)';
  c.lineWidth = 0.008;
  c.beginPath();
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (R() - 0.5) * 0.3;
    spokes.push(a);
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  c.stroke();
  c.beginPath();
  for (let r = 0.08; r < rr; r += 0.07 + R() * 0.03) {
    for (let i = 0; i <= n; i++) {
      const a = spokes[i % n];
      const px = cx + Math.cos(a) * r, py = cy + Math.sin(a) * r;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    }
  }
  c.strokeStyle = 'rgba(235,235,230,0.4)';
  c.stroke();
};

D.rubble = (c, o, k) => {
  const { W, H, R } = k;
  const n = Math.round(14 * W * H);
  const base = k.pal?.wall?.block || '#8a847a';
  for (let i = 0; i < n; i++) {
    const a = R() * TAU, d = Math.sqrt(R()) * Math.min(W, H) * 0.45;
    const x = W / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d, r = 0.04 + R() * 0.1 * (1 - d);
    c.beginPath();
    angularPoly(c, x, y, Math.max(0.03, r), R, 5, 0.5, R() * TAU);
    shadow(c, k, 0.04, 0.02, 0.04, 0.6);
    fill(c, vary(base, R, 0.15));
    noShadow(c);
    stroke(c, 'rgba(0,0,0,0.35)', 0.008);
  }
};

D.banner = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2;
  const col = ['#8a1c22', '#1c3a8a', '#2a6a2a', '#5a2a7a', '#1a1a1a'][(R() * 5) | 0];
  c.save();
  shadow(c, k, 0.1, 0.05, 0.08, 0.5);
  c.beginPath();
  c.moveTo(cx - 0.25, cy - 0.3);
  c.lineTo(cx + 0.25, cy - 0.3);
  c.lineTo(cx + 0.25, cy + 0.25);
  c.lineTo(cx, cy + 0.38);
  c.lineTo(cx - 0.25, cy + 0.25);
  c.closePath();
  fill(c, lin(c, cx - 0.25, 0, cx + 0.25, 0, [[0, shade(col, 0.15)], [1, shade(col, -0.2)]]));
  c.restore();
  stroke(c, '#c9a03a', 0.02);
  // emblem
  c.beginPath();
  c.moveTo(cx - 0.1, cy - 0.12);
  c.lineTo(cx + 0.1, cy - 0.12);
  c.lineTo(cx + 0.1, cy + 0.02);
  c.quadraticCurveTo(cx, cy + 0.14, cx - 0.1, cy + 0.02);
  c.closePath();
  fill(c, '#d8b040');
  c.lineCap = 'round';
  line(c, cx - 0.32, cy - 0.3, cx + 0.32, cy - 0.3, '#4a3018', 0.05);
  for (const px of [cx - 0.32, cx + 0.32]) {
    circle(c, px, cy - 0.3, 0.035);
    fill(c, '#c9a03a');
  }
};

D.cage = (c, o, k) => {
  const { W, H } = k;
  const x = 0.08, y = 0.08, w = W - 0.16, h = H - 0.16;
  c.fillStyle = 'rgba(0,0,0,0.35)';
  c.fillRect(x, y, w, h);
  c.save();
  shadow(c, k, 0.1, 0.06, 0.1, 0.6);
  c.strokeStyle = '#3a3a3e';
  c.lineWidth = 0.05;
  c.strokeRect(x, y, w, h);
  c.restore();
  c.strokeStyle = '#55565c';
  c.lineWidth = 0.02;
  c.beginPath();
  for (let xx = x + 0.12; xx < x + w; xx += 0.12) {
    c.moveTo(xx, y);
    c.lineTo(xx, y + h);
  }
  c.stroke();
  line(c, x, y + h / 2, x + w, y + h / 2, '#3a3a3e', 0.03);
  for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
    circle(c, px, py, 0.04);
    fill(c, '#2a2a2e');
  }
  c.strokeStyle = 'rgba(200,200,210,0.25)';
  c.lineWidth = 0.008;
  c.strokeRect(x + 0.01, y + 0.01, w - 0.02, h - 0.02);
};

D.trapdoor = (c, o, k) => {
  const { W, H } = k;
  const x = 0.12, y = 0.12, w = W - 0.24, h = H - 0.24;
  c.fillStyle = '#140e08';
  c.fillRect(x - 0.03, y - 0.03, w + 0.06, h + 0.06);
  woodPanel(c, x, y, w, h, '#6a4626', 4, false, 0.01);
  c.fillStyle = '#3a3a3e';
  for (const f of [0.25, 0.75]) c.fillRect(x, y + h * f - 0.03, w * 0.3, 0.06);
  circle(c, x + w * 0.78, y + h / 2, 0.07);
  stroke(c, '#77787e', 0.022);
};

D.mast = (c, o, k) => {
  const { W, H } = k;
  const cx = W / 2, cy = H / 2;
  c.strokeStyle = 'rgba(200,180,140,0.55)';
  c.lineWidth = 0.012;
  c.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU + 0.3;
    c.moveTo(cx, cy);
    c.lineTo(cx + Math.cos(a) * Math.max(W, H) * 0.9, cy + Math.sin(a) * Math.max(W, H) * 0.9);
  }
  c.stroke();
  rrect(c, cx - Math.max(W, H) * 0.5, cy - 0.06, Math.max(W, H), 0.12, 0.05);
  shadow(c, k, 0.12, 0.06, 0.1, 0.55);
  fill(c, '#6a4424');
  noShadow(c);
  stroke(c, '#2a1a0a', 0.012);
  circle(c, cx, cy, 0.24);
  shadow(c, k, 0.16, 0.08, 0.12, 0.6);
  fill(c, rad(c, cx, cy, 0, 0.24, [[0, '#a07040'], [1, '#5a3a1e']], cx - 0.07, cy - 0.07));
  noShadow(c);
  circle(c, cx, cy, 0.24);
  stroke(c, '#3a3a3e', 0.03);
  circle(c, cx, cy, 0.12);
  stroke(c, 'rgba(60,30,10,0.5)', 0.01);
};

D.rope = (c, o, k) => {
  const { W, H } = k;
  const cx = W / 2, cy = H / 2;
  c.beginPath();
  for (let t = 0; t < 5.5 * TAU; t += 0.15) {
    const r = 0.04 + (t / TAU) * 0.055;
    const px = cx + Math.cos(t) * r, py = cy + Math.sin(t) * r;
    if (t === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  shadow(c, k, 0.06, 0.03, 0.05, 0.5);
  stroke(c, '#b8985a', 0.05);
  noShadow(c);
  c.stroke();
  c.strokeStyle = 'rgba(80,60,20,0.6)';
  c.lineWidth = 0.008;
  c.setLineDash([0.02, 0.03]);
  c.stroke();
  c.setLineDash([]);
};

D.cauldron = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + 0.6;
    circle(c, cx + Math.cos(a) * s * 0.36, cy + Math.sin(a) * s * 0.36, 0.04);
    fill(c, '#1a1a1c');
  }
  circle(c, cx, cy, s * 0.38);
  shadow(c, k, 0.14, 0.06, 0.1, 0.6);
  fill(c, '#1e1e22');
  noShadow(c);
  circle(c, cx, cy, s * 0.38);
  stroke(c, '#45464c', 0.03);
  const brew = R() < 0.6 ? '#4ab84a' : R() < 0.5 ? '#9a4ad0' : '#d06a2a';
  circle(c, cx, cy, s * 0.3);
  fill(c, rad(c, cx, cy, 0, s * 0.3, [[0, shade(brew, 0.4)], [1, shade(brew, -0.4)]]));
  for (let i = 0; i < 6; i++) {
    circle(c, cx + (R() - 0.5) * s * 0.4, cy + (R() - 0.5) * s * 0.4, 0.02 + R() * 0.03);
    stroke(c, rgba(shade(brew, 0.6), 0.8), 0.008);
  }
};

D.idol = (c, o, k) => {
  const { W, H } = k;
  const cx = W / 2, cy = H / 2, s = Math.min(W, H);
  rrect(c, cx - s * 0.4, cy - s * 0.4, s * 0.8, s * 0.8, 0.04);
  shadow(c, k, 0.18, 0.07, 0.12, 0.6);
  fill(c, '#4a4640');
  noShadow(c);
  stroke(c, '#151310', 0.015);
  c.beginPath();
  c.ellipse(cx, cy + s * 0.06, s * 0.24, s * 0.16, 0, 0, TAU);
  fill(c, lin(c, cx - 0.2, cy - 0.1, cx + 0.2, cy + 0.2, [[0, '#f0d060'], [1, '#8a6a10']]));
  stroke(c, '#4a3608', 0.01);
  circle(c, cx, cy - s * 0.1, s * 0.14);
  fill(c, rad(c, cx, cy - s * 0.1, 0, s * 0.14, [[0, '#ffe890'], [1, '#a07a18']], cx - 0.04, cy - s * 0.14));
  stroke(c, '#4a3608', 0.01);
  for (const ex of [-0.045, 0.045]) {
    circle(c, cx + ex, cy - s * 0.11, 0.02);
    fill(c, '#e02020');
  }
};

D.gravestone = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2;
  // grave mound
  c.beginPath();
  c.ellipse(cx, H * 0.62, W * 0.26, H * 0.3, 0, 0, TAU);
  fill(c, rgba('#3e3020', 0.55));
  const col = vary('#8a8780', R, 0.1);
  c.save();
  shadow(c, k, 0.12, 0.08, 0.14, 0.6);
  if (R() < 0.3) {
    rrect(c, cx - 0.04, H * 0.12, 0.08, 0.36, 0.01);
    fill(c, col);
    rrect(c, cx - 0.14, H * 0.2, 0.28, 0.07, 0.01);
    fill(c, col);
  } else {
    c.beginPath();
    c.moveTo(cx - 0.22, H * 0.3);
    c.lineTo(cx - 0.22, H * 0.18);
    c.quadraticCurveTo(cx, H * 0.06, cx + 0.22, H * 0.18);
    c.lineTo(cx + 0.22, H * 0.3);
    c.closePath();
    fill(c, lin(c, 0, H * 0.06, 0, H * 0.3, [[0, shade(col, 0.15)], [1, shade(col, -0.2)]]));
  }
  c.restore();
  if (R() < 0.4) {
    circle(c, cx + 0.12, H * 0.22, 0.04);
    fill(c, 'rgba(80,100,50,0.5)');
  }
};

D.ruin_wall = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  const L = along ? W : H;
  const base = k.pal?.wall?.block || '#8a847a';
  c.save();
  if (!along) {
    c.translate(W, 0);
    c.rotate(Math.PI / 2);
  }
  const T = Math.min(W, H) * 0.55, y0 = ((along ? H : W) - T) / 2;
  let x = 0.02;
  const end = L * (0.75 + R() * 0.25);
  while (x < end) {
    const bw = 0.25 + R() * 0.25;
    for (const row of [0, 1]) {
      if (x + bw > end && row === 1) continue;
      rrect(c, x + 0.015, y0 + (row * T) / 2 + 0.015, Math.min(bw, end - x) - 0.03, T / 2 - 0.03, 0.02);
      shadow(c, k, 0.1, 0.05, 0.08, 0.55);
      fill(c, vary(base, R, 0.12));
      noShadow(c);
      stroke(c, 'rgba(0,0,0,0.5)', 0.012);
    }
    x += bw;
  }
  for (let i = 0; i < 6; i++) {
    c.beginPath();
    angularPoly(c, end + R() * 0.3, y0 + R() * T, 0.04 + R() * 0.06, R, 5, 0.5);
    fill(c, vary(base, R, 0.15));
  }
  c.restore();
};

D.palisade = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  const L = along ? W : H;
  c.save();
  if (!along) {
    c.translate(W, 0);
    c.rotate(Math.PI / 2);
  }
  const T = along ? H : W;
  for (let x = 0.12; x < L; x += 0.2) {
    const r = 0.1 + R() * 0.02;
    circle(c, x, T / 2 + (R() - 0.5) * 0.03, r);
    shadow(c, k, 0.1, 0.06, 0.1, 0.6);
    fill(c, rad(c, x, T / 2, 0, r, [[0, '#b08a5a'], [0.6, '#8a6438'], [1, '#4a3018']], x - 0.03, T / 2 - 0.03));
    noShadow(c);
    stroke(c, '#2e1e0e', 0.012);
    circle(c, x, T / 2, r * 0.25);
    fill(c, '#5a3e22');
  }
  c.restore();
};

D.sack = (c, o, k) => {
  const { W, H, R } = k;
  const cx = W / 2, cy = H / 2;
  const n = 1 + ((R() * 3) | 0);
  for (let i = 0; i < n; i++) {
    const x = cx + (R() - 0.5) * 0.4 * (n > 1), y = cy + (R() - 0.5) * 0.4 * (n > 1);
    c.beginPath();
    irregularPoly(c, x, y, 0.22, 0.17, R() * 3, R, 7, 0.2);
    shadow(c, k, 0.1, 0.05, 0.08, 0.55);
    fill(c, rad(c, x, y, 0, 0.24, [[0, '#cbb488'], [1, '#8a7650']], x - 0.07, y - 0.07));
    noShadow(c);
    stroke(c, 'rgba(60,45,20,0.7)', 0.012);
    circle(c, x + 0.12, y - 0.08, 0.04);
    fill(c, '#7a6440');
  }
  if (R() < 0.4) {
    for (let i = 0; i < 12; i++) {
      circle(c, cx + 0.2 + R() * 0.2, cy + R() * 0.2, 0.012);
      fill(c, '#d8c070');
    }
  }
};

D.weapon_rack = (c, o, k) => {
  const { W, H, R } = k;
  const along = W >= H;
  c.save();
  if (!along) {
    c.translate(W, 0);
    c.rotate(Math.PI / 2);
  }
  const L = along ? W : H, T = along ? H : W;
  rrect(c, 0.05, T / 2 - 0.12, L - 0.1, 0.24, 0.02);
  shadow(c, k, 0.1, 0.05, 0.08, 0.55);
  fill(c, '#5a3a1e');
  noShadow(c);
  stroke(c, '#1e1208', 0.012);
  c.lineCap = 'round';
  for (let x = 0.18; x < L - 0.1; x += 0.18) {
    const t = R();
    if (t < 0.4) {
      line(c, x, T / 2 - 0.35, x, T / 2 + 0.2, '#c8ccd2', 0.03);
      line(c, x - 0.07, T / 2 + 0.12, x + 0.07, T / 2 + 0.12, '#8a6a2a', 0.025);
    } else if (t < 0.75) {
      line(c, x, T / 2 - 0.42, x, T / 2 + 0.3, '#6a4a2a', 0.022);
      c.beginPath();
      c.moveTo(x, T / 2 - 0.5);
      c.lineTo(x - 0.03, T / 2 - 0.4);
      c.lineTo(x + 0.03, T / 2 - 0.4);
      c.closePath();
      fill(c, '#c8ccd2');
    } else {
      line(c, x, T / 2 - 0.25, x, T / 2 + 0.25, '#6a4a2a', 0.025);
      c.beginPath();
      c.arc(x + 0.02, T / 2 - 0.2, 0.08, -1.2, 1.2);
      fill(c, '#a8acb2');
    }
  }
  c.restore();
};

D.generic = (c, o, k) => {
  const { W, H } = k;
  const s = Math.min(W, H) * 0.7;
  const x = (W - s) / 2, y = (H - s) / 2;
  rrect(c, x, y, s, s, 0.05);
  shadow(c, k, 0.12, 0.05, 0.08, 0.55);
  fill(c, '#8a7a5a');
  noShadow(c);
  woodPanel(c, x, y, s, s, '#8a7a5a', 3, true, 0.05);
  const txt = String(o.label || o.kind || '?').slice(0, 14);
  label(c, txt, W / 2, H / 2, Math.min(0.2, (s * 1.6) / Math.max(4, txt.length)));
};

// kinds drawn first (flat on the floor) and last (canopies)
const FLAT = new Set(['rug', 'bones', 'trapdoor', 'stairs_up', 'stairs_down', 'rubble', 'mushroom', 'rope']);
const TOP = new Set(['tree', 'bush', 'web', 'mast']);
const FIRE_KINDS = new Set(['fireplace', 'brazier', 'torch', 'campfire', 'forge']);
const WOOD_BY_THEME = { tavern: '#7a4520', ship: '#7a5030', village: '#7a5232', castle: '#5a3418', temple: '#6a3e1e' };

export function objectLayer(o) {
  return FLAT.has(o.kind) ? 0 : TOP.has(o.kind) ? 2 : 1;
}
export function isFireObject(o) {
  return FIRE_KINDS.has(o.kind) && o.light !== null;
}
export function hasDrawer(kind) {
  return !!D[kind];
}

/**
 * Draw all objects onto the base canvas (px space, S px per cell).
 * opts: { theme, pal, info, dm }
 */
export function paintObjects(ctx, objects, S, opts) {
  const { theme, pal, info } = opts;
  const occ = new Set();
  for (const o of objects) for (let dy = 0; dy < (o.h || 1); dy++) for (let dx = 0; dx < (o.w || 1); dx++) occ.add(`${o.x + dx},${o.y + dy}`);
  const free = (x, y) => {
    const t = info.at(x, y);
    return t !== '#' && t !== ' ' && t !== '+' && t !== 'w' && !occ.has(`${x},${y}`);
  };
  // generators that place their own chairs get no automatic ones around tables
  const autoChairs = !objects.some((o) => o.kind === 'chair' || o.kind === 'stool' || o.kind === 'bench');
  const sorted = objects.slice().sort((a, b) => objectLayer(a) - objectLayer(b) || a.y - b.y || a.x - b.x);
  for (const o of sorted) {
    if (o.hidden && !opts.dm) continue;
    drawObject(ctx, o, S, { theme, pal, info, free: autoChairs ? free : null });
  }
}

export function drawObject(ctx, o, S, env) {
  const w = o.w || 1, h = o.h || 1;
  const rot = (((o.rot || 0) % 360) + 360) % 360;
  const quarter = Math.round(rot / 90) % 2 === 1 && Math.abs(rot - Math.round(rot / 90) * 90) < 1;
  const W = quarter ? h : w, H = quarter ? w : h;
  const R = makeRand(hashStr(`${o.id}|${o.kind}|${o.x},${o.y}`));
  const k = { S, W, H, R: R.next, theme: env.theme, pal: env.pal, woodCol: WOOD_BY_THEME[env.theme] };
  if (o.kind === 'table' || o.kind === 'map_table') {
    // chairs on free neighbouring cells (only for unrotated tables, coordinates in local units)
    const sides = [];
    if (!rot && env.free) {
      for (let dx = 0; dx < w; dx++) {
        if (env.free(o.x + dx, o.y - 1)) sides.push({ lx: dx + 0.5, ly: -0.12, ang: Math.PI });
        if (env.free(o.x + dx, o.y + h)) sides.push({ lx: dx + 0.5, ly: h + 0.12, ang: 0 });
      }
      for (let dy = 0; dy < h; dy++) {
        if (env.free(o.x - 1, o.y + dy)) sides.push({ lx: -0.12, ly: dy + 0.5, ang: Math.PI / 2 });
        if (env.free(o.x + w, o.y + dy)) sides.push({ lx: w + 0.12, ly: dy + 0.5, ang: -Math.PI / 2 });
      }
    }
    k.freeSides = sides;
  }
  if (o.kind === 'torch' && env.info) {
    // bracket points to the adjacent wall
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) if (env.info.at(o.x + dx, o.y + dy) === '#') (k.wallDir = [dx, dy]);
  }
  const fn = D[o.kind] || D.generic;
  ctx.save();
  ctx.translate((o.x + w / 2) * S, (o.y + h / 2) * S);
  if (rot) ctx.rotate((rot * Math.PI) / 180);
  ctx.scale(S, S);
  ctx.translate(-W / 2, -H / 2);
  ctx.lineJoin = 'round';
  try {
    fn(ctx, o, k);
  } catch (e) {
    // a broken drawer must never break the whole map
    console.warn('[map] object draw failed', o.kind, e);
  }
  ctx.restore();
}

export const OBJECT_KINDS = Object.keys(D).filter((k) => k !== 'generic');
