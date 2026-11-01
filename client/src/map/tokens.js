// Token rendering (screen space, CSS px; ctx transform = dpr scale only).
const TAU = Math.PI * 2;
export const TOKEN_FONT = "'Cinzel', 'Trajan Pro', 'Palatino Linotype', 'Book Antiqua', Palatino, Georgia, serif";
export const UI_FONT = "'Alegreya Sans', 'Segoe UI', system-ui, sans-serif";

export function ringColor(t) {
  if (t.health === 'dead') return '#6b6b6b';
  switch (t.kind) {
    case 'pc':
      return t.isMine ? '#f2c14e' : '#5fa8ee';
    case 'ally':
      return '#4fc46e';
    case 'enemy':
      return '#e2493d';
    default:
      return '#cfc5b0';
  }
}

const DEFAULT_FILL = { pc: '#3e5f8a', ally: '#3d6b46', enemy: '#7a2c26', npc: '#6a5f4e' };

const COND = {
  blinded: ['◐', '#5a5a5a'],
  charmed: ['♥', '#d0508a'],
  deafened: ['D', '#6a6a8a'],
  frightened: ['!', '#7a3ab0'],
  grappled: ['G', '#c07020'],
  incapacitated: ['✕', '#8a6a3a'],
  invisible: ['◌', '#5aa8c8'],
  paralyzed: ['Z', '#c8b020'],
  petrified: ['▲', '#7a7a70'],
  poisoned: ['☣', '#4a9a2a'],
  prone: ['↓', '#8a5a2a'],
  restrained: ['R', '#b04a20'],
  stunned: ['✦', '#d0a020'],
  unconscious: ['z', '#2a3a7a'],
  exhaustion: ['E', '#6a4a3a'],
  concentrating: ['◎', '#2a9ab0'],
  concentration: ['◎', '#2a9ab0'],
  blessed: ['+', '#d0b040'],
  bless: ['+', '#d0b040'],
  hasted: ['»', '#2ab07a'],
  haste: ['»', '#2ab07a'],
  dodging: ['⟲', '#4a7ad0'],
  hidden: ['◍', '#5a5a7a'],
  raging: ['ʘ', '#c02020'],
  burning: ['♨', '#e06010'],
  slowed: ['«', '#6a6ab0'],
};
export function conditionGlyph(name) {
  const k = String(name || '').toLowerCase().replace(/[^a-z]/g, '');
  const c = COND[k];
  if (c) return c;
  return [String(name || '?').slice(0, 1).toUpperCase(), '#5a5a6a'];
}

export function initialsOf(t) {
  if (t.initials) return String(t.initials).slice(0, 3);
  const parts = String(t.name || '?').trim().split(/\s+/);
  return (parts[0][0] + (parts[1] ? parts[1][0] : parts[0][1] || '')).toUpperCase();
}

// ---------- image cache ----------
const IMG = new Map();
export function tokenImage(src, onload) {
  if (!src) return null;
  let e = IMG.get(src);
  if (!e) {
    const img = new Image();
    img.decoding = 'async';
    e = { img, ok: false, err: false, waiters: new Set() };
    img.onload = () => {
      e.ok = true;
      for (const f of e.waiters) f();
      e.waiters.clear();
    };
    img.onerror = () => {
      e.err = true;
      e.waiters.clear();
    };
    if (!/^data:|^blob:/.test(src)) img.crossOrigin = 'anonymous';
    img.src = src;
    IMG.set(src, e);
  }
  if (!e.ok && !e.err && onload) e.waiters.add(onload);
  return e.ok ? e.img : null;
}

function hpColor(f) {
  if (f > 0.6) return '#4ccb5a';
  if (f > 0.3) return '#e0b52e';
  return '#e0453a';
}

/**
 * Draw a token centred at (sx, sy) with radius sr (CSS px).
 * o: { img, time, selected, hovered, targeted, faded, hiddenDM, showName, dragging }
 */
export function drawToken(ctx, t, sx, sy, sr, o = {}) {
  const time = o.time || 0;
  const dead = t.health === 'dead';
  const down = t.health === 'down';
  ctx.save();
  if (o.faded) ctx.globalAlpha = 0.5;
  if (o.hiddenDM) ctx.globalAlpha = 0.55;
  if (o.dragging) ctx.globalAlpha = 0.85;
  const ring = ringColor(t);
  const rw = Math.max(2, sr * 0.13);

  // turn glow
  if (t.isTurn && !dead) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    const gr = sr * (1.55 + pulse * 0.22);
    const g = ctx.createRadialGradient(sx, sy, sr * 0.8, sx, sy, gr);
    g.addColorStop(0, `rgba(255,214,110,${0.55 + pulse * 0.25})`);
    g.addColorStop(1, 'rgba(255,214,110,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, gr, 0, TAU);
    ctx.fill();
  }
  // selection glow
  if (o.selected) {
    const g = ctx.createRadialGradient(sx, sy, sr, sx, sy, sr * 1.45);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(sx, sy, sr * 1.45, 0, TAU);
    ctx.fill();
  }

  // shadow + base disc
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.6)';
  ctx.shadowBlur = sr * 0.35;
  ctx.shadowOffsetX = sr * 0.08;
  ctx.shadowOffsetY = sr * 0.14;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, TAU);
  ctx.fillStyle = '#111';
  ctx.fill();
  ctx.restore();

  const inner = sr - rw * 0.5;
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, inner, 0, TAU);
  ctx.clip();
  const img = o.img;
  if (img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = (inner * 2) / Math.min(iw, ih);
    ctx.drawImage(img, sx - (iw * s) / 2, sy - (ih * s) / 2, iw * s, ih * s);
  } else {
    const base = t.color || DEFAULT_FILL[t.kind] || '#5a5a5a';
    const g = ctx.createRadialGradient(sx - inner * 0.35, sy - inner * 0.4, inner * 0.1, sx, sy, inner * 1.05);
    g.addColorStop(0, lighten(base, 0.35));
    g.addColorStop(0.65, base);
    g.addColorStop(1, darken(base, 0.45));
    ctx.fillStyle = g;
    ctx.fillRect(sx - inner, sy - inner, inner * 2, inner * 2);
    // subtle emboss rim
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, inner * 0.06);
    ctx.beginPath();
    ctx.arc(sx, sy, inner * 0.86, Math.PI * 0.95, Math.PI * 1.75);
    ctx.stroke();
    const txt = initialsOf(t);
    const fs = inner * (txt.length > 2 ? 0.72 : 0.9);
    ctx.font = `700 ${fs}px ${TOKEN_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(1.5, fs * 0.14);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.strokeText(txt, sx, sy + fs * 0.05);
    ctx.fillStyle = '#f6ecd6';
    ctx.fillText(txt, sx, sy + fs * 0.05);
  }
  // gloss
  const gl = ctx.createLinearGradient(sx, sy - inner, sx, sy + inner);
  gl.addColorStop(0, 'rgba(255,255,255,0.16)');
  gl.addColorStop(0.45, 'rgba(255,255,255,0)');
  gl.addColorStop(1, 'rgba(0,0,0,0.25)');
  ctx.fillStyle = gl;
  ctx.fillRect(sx - inner, sy - inner, inner * 2, inner * 2);
  // health tint
  if (t.health === 'bloodied' || t.health === 'critical') {
    const crit = t.health === 'critical';
    const a = crit ? 0.38 + 0.12 * Math.sin(time * 5) : 0.22;
    const g = ctx.createRadialGradient(sx, sy, inner * 0.2, sx, sy, inner);
    g.addColorStop(0, `rgba(170,0,0,${a * 0.4})`);
    g.addColorStop(1, `rgba(170,0,0,${a + 0.2})`);
    ctx.fillStyle = g;
    ctx.fillRect(sx - inner, sy - inner, inner * 2, inner * 2);
  }
  if (dead || down || o.faded) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = dead ? 'rgba(128,128,128,1)' : 'rgba(128,128,128,0.75)';
    ctx.fillRect(sx - inner, sy - inner, inner * 2, inner * 2);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = dead ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.25)';
    ctx.fillRect(sx - inner, sy - inner, inner * 2, inner * 2);
  }
  ctx.restore();

  // ring
  ctx.beginPath();
  ctx.arc(sx, sy, sr - rw / 2, 0, TAU);
  ctx.lineWidth = rw;
  ctx.strokeStyle = ring;
  if (o.hiddenDM) ctx.setLineDash([rw * 1.4, rw * 1.1]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1, rw * 0.22);
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, TAU);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx, sy, sr - rw, 0, TAU);
  ctx.stroke();
  // ring highlight
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.lineWidth = Math.max(1, rw * 0.25);
  ctx.beginPath();
  ctx.arc(sx, sy, sr - rw / 2, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();

  if (o.hiddenDM) {
    ctx.save();
    ctx.globalAlpha = 1;
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(200,160,255,0.95)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, sr + 4, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  // dead: X
  if (dead) {
    ctx.save();
    ctx.lineCap = 'round';
    const d = inner * 0.55;
    ctx.lineWidth = Math.max(2.5, sr * 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.moveTo(sx - d, sy - d);
    ctx.lineTo(sx + d, sy + d);
    ctx.moveTo(sx + d, sy - d);
    ctx.lineTo(sx - d, sy + d);
    ctx.stroke();
    ctx.lineWidth = Math.max(1.5, sr * 0.09);
    ctx.strokeStyle = '#b02a22';
    ctx.stroke();
    ctx.restore();
  }

  // HP ring (party tokens)
  if (t.hp && t.hp.max > 0 && !dead) {
    const f = Math.max(0, Math.min(1, t.hp.cur / t.hp.max));
    const r2 = sr + Math.max(2.5, sr * 0.12);
    const hw = Math.max(2.5, sr * 0.11);
    ctx.lineCap = 'butt';
    ctx.lineWidth = hw + 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath();
    ctx.arc(sx, sy, r2, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = hw;
    ctx.strokeStyle = 'rgba(60,60,60,0.7)';
    ctx.stroke();
    if (f > 0) {
      ctx.strokeStyle = hpColor(f);
      ctx.beginPath();
      ctx.arc(sx, sy, r2, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      ctx.stroke();
    }
    if (t.hp.temp > 0) {
      const tf = Math.min(1, t.hp.temp / t.hp.max);
      ctx.strokeStyle = '#7fd0ff';
      ctx.lineWidth = hw * 0.6;
      ctx.beginPath();
      ctx.arc(sx, sy, r2 + hw * 0.9, -Math.PI / 2, -Math.PI / 2 + TAU * tf);
      ctx.stroke();
    }
  } else if (t.kind === 'enemy' && (t.health === 'bloodied' || t.health === 'critical')) {
    // blood-drop badge
    const crit = t.health === 'critical';
    const bx = sx + sr * 0.72, by = sy + sr * 0.68, br = Math.max(5, sr * 0.28);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(bx, by - br * 1.25);
    ctx.bezierCurveTo(bx + br * 1.0, by - br * 0.2, bx + br * 0.8, by + br * 0.9, bx, by + br * 0.9);
    ctx.bezierCurveTo(bx - br * 0.8, by + br * 0.9, bx - br * 1.0, by - br * 0.2, bx, by - br * 1.25);
    ctx.fillStyle = crit ? '#7a0606' : '#c41a1a';
    ctx.strokeStyle = '#1a0202';
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    if (crit) {
      ctx.fillStyle = '#ffd0c0';
      ctx.font = `700 ${br * 1.1}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('!', bx, by + br * 0.05);
    }
    ctx.restore();
  }

  // condition badges around the rim (top-right, clockwise)
  const conds = (t.conditions || []).filter(Boolean);
  if (conds.length) {
    const br = Math.max(6.5, sr * 0.26);
    const rr = sr + br * 0.25;
    const step = Math.min(0.62, (Math.PI * 1.2) / Math.max(1, conds.length - 1 || 1));
    conds.slice(0, 6).forEach((cn, i) => {
      const a = -Math.PI / 2 + 0.55 + i * step;
      const bx = sx + Math.cos(a) * rr, by = sy + Math.sin(a) * rr;
      const [glyph, col] = conditionGlyph(cn);
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#f3e8cf';
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `700 ${br * 1.15}px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(glyph, bx, by + br * 0.06);
    });
    if (conds.length > 6) {
      const a = -Math.PI / 2 + 0.55 + 6 * step;
      ctx.fillStyle = '#f3e8cf';
      ctx.font = `700 ${br}px ${UI_FONT}`;
      ctx.fillText(`+${conds.length - 6}`, sx + Math.cos(a) * rr, sy + Math.sin(a) * rr);
    }
  }

  // targeting reticle
  if (o.targeted) {
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    const rr = sr * (1.25 + pulse * 0.08);
    ctx.strokeStyle = '#ff4a3a';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(sx, sy, rr, 0, TAU);
    ctx.stroke();
    ctx.lineCap = 'round';
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2 + Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(sx + Math.cos(a) * rr * 0.8, sy + Math.sin(a) * rr * 0.8);
      ctx.lineTo(sx + Math.cos(a) * rr * 1.25, sy + Math.sin(a) * rr * 1.25);
      ctx.stroke();
    }
  } else if (o.selected) {
    ctx.strokeStyle = '#fff6d8';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -time * 12;
    ctx.beginPath();
    ctx.arc(sx, sy, sr + (t.hp ? sr * 0.32 + 4 : 5), 0, TAU);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (o.hovered) {
    ctx.strokeStyle = 'rgba(255,246,216,0.7)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, sr + (t.hp ? sr * 0.3 + 3 : 3), 0, TAU);
    ctx.stroke();
  }
  ctx.restore();

  if (o.showName) drawNameLabel(ctx, t.name || '', sx, sy + sr + (t.hp ? sr * 0.35 + 6 : 6), ring);
}

export function drawNameLabel(ctx, name, x, y, accent = '#d8c9a0') {
  if (!name) return;
  ctx.save();
  ctx.font = `600 12px ${UI_FONT}`;
  const w = ctx.measureText(name).width + 14;
  const h = 19;
  ctx.fillStyle = 'rgba(18,14,10,0.86)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x - w / 2, y, w, h, 9);
  else ctx.rect(x - w / 2, y, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f3e8cf';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, x, y + h / 2 + 0.5);
  ctx.restore();
}

function parse(hex) {
  let h = String(hex).replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [90, 90, 90];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function lighten(hex, a) {
  const [r, g, b] = parse(hex);
  return `rgb(${r + (255 - r) * a | 0},${g + (255 - g) * a | 0},${b + (255 - b) * a | 0})`;
}
function darken(hex, a) {
  const [r, g, b] = parse(hex);
  return `rgb(${r * (1 - a) | 0},${g * (1 - a) | 0},${b * (1 - a) | 0})`;
}
