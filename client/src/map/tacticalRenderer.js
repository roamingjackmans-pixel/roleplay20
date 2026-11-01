// TacticalRenderer: canvas battle-map engine (camera, render loop, overlays, interaction).
// Used by TacticalMapView.jsx; framework-free so it can be driven from anywhere.
import { getBase, peekBase, baseKey } from './baseRender.js';
import { buildFog, tokenVisible } from './fog.js';
import { drawToken, drawNameLabel, tokenImage, UI_FONT } from './tokens.js';
import { drawDoor, doorOrientation } from './walls.js';
import { makeCanvas } from './paint.js';
import { hash2 } from './rng.js';
// same template math as the server uses for resolution
import { templateCells, templateLabel } from '../../../shared/templates.js';

const TAU = Math.PI * 2;
const MOVE_MS = 260;
const PING_MS = 2000;
const easeOut = (t) => 1 - Math.pow(1 - t, 3);
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const raf = typeof requestAnimationFrame !== 'undefined' ? requestAnimationFrame : (f) => setTimeout(() => f(performance.now()), 16);
const caf = typeof cancelAnimationFrame !== 'undefined' ? cancelAnimationFrame : clearTimeout;

function rgbaHex(hex, a) {
  let h = String(hex || '#ffffff').replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16) || 0;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function flick(t, seed) {
  return 1 + 0.055 * Math.sin(t * 8.3 + seed) + 0.035 * Math.sin(t * 19.7 + seed * 2.1) + 0.03 * Math.sin(t * 31.1 + seed * 0.7);
}

export class TacticalRenderer {
  constructor(canvas, container) {
    this.canvas = canvas;
    this.container = container || canvas.parentElement;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.p = { mode: 'select', tokens: [], pings: [], showGrid: true };
    this.cam = { s: 32, x: 0, y: 0 };
    this.camAnim = null;
    this.fitS = 32;
    this.vw = 0;
    this.vh = 0;
    this.dpr = 1;
    this.base = null;
    this.baseKey = '';
    this.buildTimer = 0;
    this.fog = null;
    this.fogKey = null;
    this.anim = new Map();
    this.pending = new Map();
    this.pointers = new Map();
    this.gesture = null;
    this.hover = { sx: null, sy: null, mx: 0, my: 0, cx: null, cy: null, token: null, object: null };
    this.ruler = null;
    this.dragTok = null;
    this.pingSeen = new Map();
    this.drawn = [];
    this.fittedFor = null;
    this.moveCache = null;
    this.doorOrient = new Map();
    this.raf = 0;
    this.lastDraw = 0;
    this.force = true;
    this.destroyed = false;
    this.reduceMotion = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.frame = this.frame.bind(this);
    canvas.__rpMap = this; // handy for debugging from devtools
    this._bind();
    if (typeof document !== 'undefined' && document.fonts && document.fonts.load) {
      Promise.all([document.fonts.load("700 20px 'Cinzel'"), document.fonts.load("600 12px 'Alegreya Sans'")]).then(() => this.invalidate(), () => {});
    }
  }

  // ------------------------------------------------------------------ props
  setProps(next) {
    const prev = this.p;
    this.p = { mode: 'select', showGrid: true, ...next, tokens: next.tokens || [], pings: next.pings || [] };
    const p = this.p;
    if (p.map !== prev.map) this._onMap();
    if (p.vis !== prev.vis || p.explored !== prev.explored || p.map !== prev.map) this.fogKey = null;
    if (p.tokens !== prev.tokens) this._onTokens();
    if (p.mode !== prev.mode) {
      this.ruler = null;
      this._updateCursor();
    }
    if (p.movement !== prev.movement) this.moveCache = null;
    this.invalidate();
  }

  _onMap() {
    const map = this.p.map;
    if (!map) {
      this.base = null;
      this.baseKey = '';
      return;
    }
    const key = baseKey(map);
    if (key === this.baseKey && this.base) return;
    this.baseKey = key;
    this.doorOrient.clear();
    const cached = peekBase(map);
    if (cached) {
      this._setBase(cached);
      return;
    }
    clearTimeout(this.buildTimer);
    this.building = true;
    this.invalidate();
    // let the placeholder paint first, then build synchronously
    this.buildTimer = setTimeout(() => {
      if (this.destroyed || baseKey(this.p.map) !== key) return;
      try {
        this._setBase(getBase(this.p.map));
      } catch (e) {
        console.error('[map] base render failed', e);
      }
      this.building = false;
      this.invalidate();
    }, 30);
  }

  _setBase(b) {
    this.base = b;
    this.building = false;
    this.lightMap = null;
    if (this.fittedFor !== (this.p.map && this.p.map.id) && this.vw > 0) {
      this.fit(false);
      this.fittedFor = this.p.map.id;
    }
  }

  _onTokens() {
    const now = performance.now();
    const seen = new Set();
    for (const t of this.p.tokens) {
      seen.add(t.id);
      let a = this.anim.get(t.id);
      if (!a) {
        this.anim.set(t.id, { x: t.x, y: t.y, fx: t.x, fy: t.y, tx: t.x, ty: t.y, t0: 0 });
        continue;
      }
      const pend = this.pending.get(t.id);
      if (pend && pend.x === t.x && pend.y === t.y) {
        // server confirmed the drop: token is already drawn there
        this.pending.delete(t.id);
        Object.assign(a, { fx: t.x, fy: t.y, tx: t.x, ty: t.y, t0: 0 });
        continue;
      }
      if (a.tx !== t.x || a.ty !== t.y) {
        const cur = this._animPos(a, now);
        Object.assign(a, { fx: cur.x, fy: cur.y, tx: t.x, ty: t.y, t0: now });
        if (pend) this.pending.delete(t.id);
      }
    }
    for (const id of [...this.anim.keys()]) if (!seen.has(id)) this.anim.delete(id);
  }

  _animPos(a, now) {
    if (!a.t0) return { x: a.tx, y: a.ty };
    const k = clamp((now - a.t0) / MOVE_MS, 0, 1);
    if (k >= 1) {
      a.t0 = 0;
      return { x: a.tx, y: a.ty };
    }
    const e = easeOut(k);
    return { x: a.fx + (a.tx - a.fx) * e, y: a.fy + (a.ty - a.fy) * e };
  }

  tokenPos(t, now = performance.now()) {
    const pend = this.pending.get(t.id);
    if (pend) {
      if (now - pend.t < 1600) return { x: pend.x, y: pend.y };
      // move was not accepted: glide back
      this.pending.delete(t.id);
      const a = this.anim.get(t.id);
      if (a) Object.assign(a, { fx: pend.x, fy: pend.y, tx: t.x, ty: t.y, t0: now });
    }
    const a = this.anim.get(t.id);
    return a ? this._animPos(a, now) : { x: t.x, y: t.y };
  }

  // ------------------------------------------------------------------ camera
  resize(cssW, cssH) {
    const dpr = Math.min(3, (typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1);
    if (cssW === this.vw && cssH === this.vh && dpr === this.dpr) return;
    const had = this.vw > 0;
    const cx = (this.vw / 2 - this.cam.x) / this.cam.s, cy = (this.vh / 2 - this.cam.y) / this.cam.s;
    this.vw = cssW;
    this.vh = cssH;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(cssW * dpr));
    this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    if (this.base && this.fittedFor !== this.p.map?.id) {
      this.fit(false);
      this.fittedFor = this.p.map.id;
    } else if (had) {
      this.cam.x = cssW / 2 - cx * this.cam.s;
      this.cam.y = cssH / 2 - cy * this.cam.s;
      this._computeFitS();
    }
    this.invalidate();
  }

  _computeFitS() {
    const m = this.p.map;
    if (!m || !this.vw) return;
    this.fitS = Math.max(4, Math.min(this.vw / m.w, this.vh / m.h) * 0.96);
  }
  get minS() {
    return Math.max(3, this.fitS * 0.55);
  }
  get maxS() {
    return Math.max(180, this.fitS * 3);
  }

  fit(animate = true) {
    const m = this.p.map;
    if (!m || !this.vw) return;
    this._computeFitS();
    const s = this.fitS;
    const target = { s, x: (this.vw - m.w * s) / 2, y: (this.vh - m.h * s) / 2 };
    if (animate) this._animateCam(target);
    else {
      this.cam = target;
      this.invalidate();
    }
  }

  centerOn(tokenId, { zoom } = {}) {
    const t = this.p.tokens.find((k) => k.id === tokenId);
    if (!t || !this.vw) return false;
    const pos = this.tokenPos(t);
    const size = t.size || 1;
    const s = zoom ? clamp(zoom, this.minS, this.maxS) : Math.max(this.cam.s, Math.min(this.fitS * 1.6, 64));
    this._animateCam({ s, x: this.vw / 2 - (pos.x + size / 2) * s, y: this.vh / 2 - (pos.y + size / 2) * s });
    return true;
  }

  centerOnCell(x, y) {
    const s = this.cam.s;
    this._animateCam({ s, x: this.vw / 2 - (x + 0.5) * s, y: this.vh / 2 - (y + 0.5) * s });
  }

  zoomBy(f, sx = this.vw / 2, sy = this.vh / 2) {
    this._zoomAt(sx, sy, f);
  }

  _animateCam(to) {
    this.camAnim = { from: { ...this.cam }, to, t0: performance.now(), dur: 380 };
    this.invalidate();
  }

  _zoomAt(sx, sy, f) {
    this.camAnim = null;
    const s1 = clamp(this.cam.s * f, this.minS, this.maxS);
    const mx = (sx - this.cam.x) / this.cam.s, my = (sy - this.cam.y) / this.cam.s;
    this.cam.x = sx - mx * s1;
    this.cam.y = sy - my * s1;
    this.cam.s = s1;
    this._clampCam();
    this.invalidate();
  }

  _clampCam() {
    const m = this.p.map;
    if (!m) return;
    const mw = m.w * this.cam.s, mh = m.h * this.cam.s;
    const mx = Math.min(this.vw * 0.6, mw * 0.6), my = Math.min(this.vh * 0.6, mh * 0.6);
    this.cam.x = clamp(this.cam.x, mx - mw, this.vw - mx);
    this.cam.y = clamp(this.cam.y, my - mh, this.vh - my);
  }

  toMap(sx, sy) {
    return [(sx - this.cam.x) / this.cam.s, (sy - this.cam.y) / this.cam.s];
  }

  // ------------------------------------------------------------------ loop
  invalidate() {
    this.force = true;
    if (!this.raf && !this.destroyed) this.raf = raf(this.frame);
  }

  _ambient() {
    const b = this.base;
    if (this.reduceMotion || !b) return false;
    if (b.fires.length || b.water.length || b.lights.some((l) => l.flicker)) return true;
    const p = this.p;
    if (p.selectedId || p.activeId) return true;
    if (p.mode === 'target') return true;
    return p.tokens.some((t) => t.isTurn || t.health === 'critical');
  }

  _active(now) {
    if (this.camAnim || this.gesture) return true;
    for (const a of this.anim.values()) if (a.t0 && now - a.t0 < MOVE_MS) return true;
    if (this.pending.size) return true;
    for (const pg of this.p.pings) {
      const st = this._pingStart(pg, now);
      if (now - st < PING_MS) return true;
    }
    return false;
  }

  frame() {
    this.raf = 0;
    if (this.destroyed) return;
    const now = performance.now();
    const active = this._active(now);
    const ambient = this._ambient();
    if (!this.force && !active && ambient && now - this.lastDraw < 30) {
      this.raf = raf(this.frame);
      return;
    }
    this.force = false;
    this.lastDraw = now;
    if (this.camAnim) {
      const a = this.camAnim;
      const k = clamp((now - a.t0) / a.dur, 0, 1);
      const e = easeInOut(k);
      this.cam = { s: a.from.s + (a.to.s - a.from.s) * e, x: a.from.x + (a.to.x - a.from.x) * e, y: a.from.y + (a.to.y - a.from.y) * e };
      if (k >= 1) this.camAnim = null;
    }
    try {
      this.draw(now);
    } catch (e) {
      console.error('[map] draw failed', e);
    }
    if (active || ambient || this.camAnim) this.raf = raf(this.frame);
  }

  // ------------------------------------------------------------------ drawing
  draw(now) {
    const { ctx, dpr } = this;
    const W = this.canvas.width, H = this.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#0c0a08';
    ctx.fillRect(0, 0, W, H);
    const map = this.p.map, base = this.base;
    if (!map || !base) {
      this._placeholder(map ? 'Painting the battle map…' : 'No map');
      return;
    }
    const t = now / 1000;
    const s = this.cam.s;
    const k = s * dpr;
    const mapT = () => ctx.setTransform(k, 0, 0, k, this.cam.x * dpr, this.cam.y * dpr);
    const scrT = () => ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const view = { x0: -this.cam.x / s, y0: -this.cam.y / s, x1: (this.vw - this.cam.x) / s, y1: (this.vh - this.cam.y) / s };
    const dm = this.p.vis == null;

    mapT();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = k < base.S * 0.75 ? 'high' : 'medium';
    // soft outer frame glow
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.8)';
    ctx.shadowBlur = 24 * dpr;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, base.w, base.h);
    ctx.restore();
    ctx.drawImage(base.canvas, 0, 0, base.w, base.h);
    // everything map-space below stays inside the map rectangle
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, base.w, base.h);
    ctx.clip();

    this._drawLighting(ctx, t, view, dm);
    this._drawWater(ctx, t, view);
    this._drawFires(ctx, t, view);
    this._drawDoors(ctx, dm);

    this._ensureFog();
    const fog = this.fog;
    if (fog) {
      ctx.save();
      ctx.globalCompositeOperation = 'saturation';
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(fog.desat, -fog.pad, -fog.pad, base.w + fog.pad * 2, base.h + fog.pad * 2);
      ctx.restore();
    }
    if (this.p.showGrid !== false) this._drawGrid(ctx, s);
    if (dm) this._drawHiddenObjects(ctx, s);
    this._drawHoverCell(ctx, s);
    this._drawMovement(ctx, s);
    const tpl = this._drawTemplate(ctx, s, t);
    ctx.restore();

    // tokens
    const { normal, faded } = this._tokenLists(now);
    scrT();
    const hovered = this.hover.token;
    const targetMode = this.p.mode === 'target';
    const tplIds = tpl ? tpl.ids : null;
    const tokenOpts = (tk, extra = {}) => ({
      time: t,
      img: tokenImage(tk.img, () => this.invalidate()),
      selected: tk.id === this.p.selectedId,
      hovered: hovered === tk.id,
      targeted: (targetMode && hovered === tk.id) || (tplIds && tplIds.has(tk.id)),
      hiddenDM: dm && tk.hidden,
      showName: hovered === tk.id || tk.id === this.p.selectedId,
      ...extra,
    });
    this.drawn = [];
    for (const { tk, pos } of normal) {
      if (this.dragTok && this.dragTok.id === tk.id) continue;
      const [sx, sy, sr] = this._tokScreen(tk, pos);
      if (sx + sr * 2 < 0 || sy + sr * 2 < 0 || sx - sr * 2 > this.vw || sy - sr * 2 > this.vh) {
        this.drawn.push({ tk, pos });
        continue;
      }
      drawToken(ctx, { ...tk, isTurn: tk.isTurn || tk.id === this.p.activeId }, sx, sy, sr, tokenOpts(tk));
      this.drawn.push({ tk, pos });
    }

    // fog darkness over everything drawn so far
    if (fog) {
      mapT();
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(fog.dark, -fog.pad, -fog.pad, base.w + fog.pad * 2, base.h + fog.pad * 2);
      scrT();
      for (const { tk, pos } of faded) {
        const [sx, sy, sr] = this._tokScreen(tk, pos);
        drawToken(ctx, tk, sx, sy, sr, tokenOpts(tk, { faded: true, showName: hovered === tk.id }));
        this.drawn.push({ tk, pos });
      }
    }
    scrT();
    if (this.p.debugLabels) {
      ctx.font = `600 11px ${UI_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      for (const o of map.objects || []) {
        const x = this.cam.x + (o.x + (o.w || 1) / 2) * s, y = this.cam.y + (o.y + (o.h || 1)) * s + 4;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.strokeText(o.kind, x, y);
        ctx.fillStyle = '#ffe9b8';
        ctx.fillText(o.kind, x, y);
      }
    }
    this._drawRuler(ctx);
    this._drawDrag(ctx, now);
    this._drawPings(ctx, now);
    if (tpl) this._drawTemplateLabel(ctx, tpl);
    this._drawObjectTooltip(ctx);
  }

  _placeholder(text) {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(232,214,170,0.75)';
    ctx.font = `italic 600 16px 'Cinzel', Georgia, serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, this.vw / 2, this.vh / 2);
  }

  _tokScreen(tk, pos) {
    const size = Math.max(1, tk.size || 1);
    const s = this.cam.s;
    return [this.cam.x + (pos.x + size / 2) * s, this.cam.y + (pos.y + size / 2) * s, Math.max(5, s * size * 0.5 * 0.84)];
  }

  _tokenLists(now) {
    const dm = this.p.vis == null;
    const lv = this.fog ? this.fog.levels : null;
    const m = this.p.map;
    const normal = [], faded = [];
    for (const tk of this.p.tokens) {
      const pos = this.tokenPos(tk, now);
      const vis = dm || tokenVisible(lv, m.w, m.h, { x: Math.round(pos.x), y: Math.round(pos.y), size: tk.size });
      if (!dm && tk.outOfSight) faded.push({ tk, pos });
      else if (vis || tk.isMine) normal.push({ tk, pos });
      else if (tk.kind === 'pc' || tk.kind === 'ally') faded.push({ tk, pos });
    }
    const rank = (tk) => (tk.health === 'dead' ? 0 : tk.health === 'down' ? 1 : tk.id === this.p.selectedId ? 4 : tk.isMine ? 3 : 2);
    normal.sort((a, b) => rank(a.tk) - rank(b.tk) || (b.tk.size || 1) - (a.tk.size || 1));
    return { normal, faded };
  }

  _ensureFog() {
    const p = this.p, m = p.map;
    if (p.vis == null) {
      this.fog = null;
      return;
    }
    const key = `${m.id}|${m.w}x${m.h}|${p.vis}|${p.explored || ''}`;
    if (key === this.fogKey && this.fog) return;
    this.fogKey = key;
    this.fog = buildFog(m.w, m.h, p.vis, p.explored);
  }

  _ambientLevel() {
    const a = this.p.map.ambient || 'bright';
    return a === 'dark' ? 1 : a === 'dim' ? 0.7 : 0.3;
  }

  _buildLightMap() {
    const b = this.base, m = this.p.map;
    const F = 4;
    const c = makeCanvas(b.w * F, b.h * F);
    const x = c.getContext('2d');
    const amb = m.ambient === 'dark' ? 0.5 : m.ambient === 'dim' ? 0.26 : 0;
    if (!amb) return null;
    x.fillStyle = `rgba(4,6,18,${amb})`;
    x.fillRect(0, 0, c.width, c.height);
    x.globalCompositeOperation = 'destination-out';
    for (const l of b.lights) {
      const R = (l.bright + l.dim) * F;
      if (R <= 0) continue;
      const g = x.createRadialGradient(l.x * F, l.y * F, 0, l.x * F, l.y * F, R);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(clamp(l.bright / (l.bright + l.dim || 1), 0, 0.99), 'rgba(0,0,0,0.92)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g;
      x.fillRect(l.x * F - R, l.y * F - R, R * 2, R * 2);
    }
    return c;
  }

  _drawLighting(ctx, t, view, dm) {
    const b = this.base;
    if (dm) {
      if (this.lightMap === null || this.lightMapFor !== this.p.map) {
        this.lightMap = this._buildLightMap() || false;
        this.lightMapFor = this.p.map;
      }
      if (this.lightMap) ctx.drawImage(this.lightMap, 0, 0, b.w, b.h);
    }
    if (!b.lights.length) return;
    const amb = this._ambientLevel();
    ctx.save();
    ctx.clip(b.litPath);
    ctx.globalCompositeOperation = 'lighter';
    for (const l of b.lights) {
      const R0 = l.bright + l.dim;
      if (R0 <= 0) continue;
      if (l.x + R0 < view.x0 || l.y + R0 < view.y0 || l.x - R0 > view.x1 || l.y - R0 > view.y1) continue;
      const f = l.flicker && !this.reduceMotion ? flick(t, (l.x * 13.1 + l.y * 7.7) % 100) : 1;
      const R = R0 * (0.97 + (f - 1) * 0.6);
      const a = (l.soft ? 0.2 : 0.22) * amb * f;
      const kb = clamp(l.bright / R0, 0.3, 0.95);
      const g = ctx.createRadialGradient(l.x, l.y, 0, l.x, l.y, R);
      g.addColorStop(0, rgbaHex(l.color, a));
      g.addColorStop(Math.min(0.2, kb * 0.5), rgbaHex(l.color, a * 0.6));
      g.addColorStop(kb, rgbaHex(l.color, a * 0.22));
      g.addColorStop(1, rgbaHex(l.color, 0));
      ctx.fillStyle = g;
      ctx.fillRect(l.x - R, l.y - R, R * 2, R * 2);
    }
    ctx.restore();
  }

  _drawWater(ctx, t, view) {
    const b = this.base;
    if (!b.water.length || this.reduceMotion) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#eaf8ff';
    ctx.lineWidth = 0.025;
    for (const wv of b.water) {
      if (wv.x < view.x0 - 1 || wv.y < view.y0 - 1 || wv.x > view.x1 + 1 || wv.y > view.y1 + 1) continue;
      const ph = t * wv.s + wv.p;
      const a = Math.pow(Math.max(0, Math.sin(ph)), 6) * (wv.deep ? 0.35 : 0.5);
      if (a < 0.02) continue;
      const dx = Math.sin(ph * 0.3) * 0.06;
      ctx.globalAlpha = a;
      ctx.beginPath();
      ctx.moveTo(wv.x - 0.09 + dx, wv.y);
      ctx.quadraticCurveTo(wv.x + dx, wv.y - 0.035, wv.x + 0.09 + dx, wv.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawFires(ctx, t, view) {
    const b = this.base;
    if (!b.fires.length) return;
    const still = this.reduceMotion;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const f of b.fires) {
      if (f.x < view.x0 - 1 || f.y < view.y0 - 1 || f.x > view.x1 + 1 || f.y > view.y1 + 1) continue;
      const tt = still ? 0 : t;
      const fl = flick(tt * 1.3, f.seed);
      const r = f.r * fl;
      let g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 2.6);
      g.addColorStop(0, 'rgba(255,140,40,0.42)');
      g.addColorStop(1, 'rgba(255,90,20,0)');
      ctx.fillStyle = g;
      ctx.fillRect(f.x - r * 2.6, f.y - r * 2.6, r * 5.2, r * 5.2);
      const n = f.kind === 'torch' ? 4 : 7;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * TAU + tt * 0.35 + Math.sin(tt * 2.1 + i * 1.7 + f.seed) * 0.35;
        const L = r * (0.9 + 0.45 * Math.sin(tt * 7.3 + i * 2.3 + f.seed) + 0.2 * Math.sin(tt * 13.1 + i));
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate(a);
        g = ctx.createLinearGradient(0, 0, L, 0);
        g.addColorStop(0, 'rgba(255,220,120,0.55)');
        g.addColorStop(0.5, 'rgba(255,130,30,0.35)');
        g.addColorStop(1, 'rgba(200,40,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.moveTo(0, -r * 0.28);
        ctx.quadraticCurveTo(L * 0.6, -r * 0.3, L, 0);
        ctx.quadraticCurveTo(L * 0.6, r * 0.3, 0, r * 0.28);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      g = ctx.createRadialGradient(f.x, f.y, 0, f.x, f.y, r * 0.65);
      g.addColorStop(0, 'rgba(255,250,215,0.85)');
      g.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(f.x, f.y, r * 0.65, 0, TAU);
      ctx.fill();
      if (!still) {
        // embers drifting outward
        ctx.fillStyle = '#ffb347';
        for (let i = 0; i < 6; i++) {
          const ph = (tt * 0.45 + i / 6 + hash2(i, f.seed, 3)) % 1;
          const ang = hash2(i, f.seed, Math.floor(tt * 0.45 + i / 6 + hash2(i, f.seed, 3))) * TAU;
          const d = r * (0.4 + ph * 2.8);
          ctx.globalAlpha = (1 - ph) * 0.9;
          ctx.beginPath();
          ctx.arc(f.x + Math.cos(ang) * d, f.y + Math.sin(ang) * d, 0.018 + (1 - ph) * 0.012, 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.restore();
  }

  _drawDoors(ctx, dm) {
    const doors = this.p.map.doors || [];
    if (!doors.length) return;
    const style = this.base.pal.wall.style;
    for (const d of doors) {
      if (d.secret && !dm) continue;
      const key = `${d.x},${d.y}`;
      let o = this.doorOrient.get(key);
      if (!o) {
        o = doorOrientation(this.base.info, d.x, d.y);
        this.doorOrient.set(key, o);
      }
      drawDoor(ctx, d, o, style, { dm });
    }
  }

  _drawGrid(ctx, s) {
    if (s < 9) return;
    const b = this.base;
    const lw = 1 / s;
    const alpha = clamp((s - 9) / 20, 0, 1);
    ctx.save();
    ctx.clip(b.floorPath);
    ctx.beginPath();
    for (let x = 0; x <= b.w; x++) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, b.h);
    }
    for (let y = 0; y <= b.h; y++) {
      ctx.moveTo(0, y);
      ctx.lineTo(b.w, y);
    }
    ctx.lineWidth = lw * 1.1;
    ctx.strokeStyle = `rgba(0,0,0,${0.2 * alpha})`;
    ctx.stroke();
    ctx.translate(lw, lw);
    ctx.lineWidth = lw;
    ctx.strokeStyle = `rgba(255,240,210,${0.05 * alpha})`;
    ctx.stroke();
    ctx.restore();
  }

  _drawHiddenObjects(ctx, s) {
    const objs = (this.p.map.objects || []).filter((o) => o.hidden);
    if (!objs.length) return;
    ctx.save();
    ctx.setLineDash([4 / s, 3 / s]);
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = 'rgba(200,150,255,0.95)';
    ctx.fillStyle = 'rgba(150,90,230,0.14)';
    for (const o of objs) {
      ctx.fillRect(o.x + 0.06, o.y + 0.06, (o.w || 1) - 0.12, (o.h || 1) - 0.12);
      ctx.strokeRect(o.x + 0.06, o.y + 0.06, (o.w || 1) - 0.12, (o.h || 1) - 0.12);
    }
    ctx.restore();
  }

  _drawHoverCell(ctx, s) {
    const h = this.hover;
    if (h.cx == null || this.gesture?.type === 'pan' || this.gesture?.type === 'pinch') return;
    const mode = this.p.mode;
    if (mode === 'template') return;
    const m = this.p.map;
    if (h.cx < 0 || h.cy < 0 || h.cx >= m.w || h.cy >= m.h) return;
    ctx.save();
    ctx.lineWidth = 1.5 / s;
    ctx.strokeStyle = mode === 'ping' ? 'rgba(255,220,120,0.8)' : 'rgba(255,248,225,0.45)';
    ctx.strokeRect(h.cx + 0.03, h.cy + 0.03, 0.94, 0.94);
    ctx.restore();
  }

  _drawMovement(ctx, s) {
    const mv = this.p.movement;
    if (!mv || !mv.cells || !mv.cells.size) return;
    if (!this.moveCache || this.moveCache.src !== mv.cells) {
      const set = new Set(mv.cells.keys());
      const fill = new Path2D(), edge = new Path2D();
      for (const key of set) {
        const [x, y] = key.split(',').map(Number);
        fill.rect(x, y, 1, 1);
        if (!set.has(`${x},${y - 1}`)) (edge.moveTo(x, y), edge.lineTo(x + 1, y));
        if (!set.has(`${x},${y + 1}`)) (edge.moveTo(x, y + 1), edge.lineTo(x + 1, y + 1));
        if (!set.has(`${x - 1},${y}`)) (edge.moveTo(x, y), edge.lineTo(x, y + 1));
        if (!set.has(`${x + 1},${y}`)) (edge.moveTo(x + 1, y), edge.lineTo(x + 1, y + 1));
      }
      this.moveCache = { src: mv.cells, fill, edge };
    }
    ctx.save();
    ctx.fillStyle = 'rgba(80,165,255,0.16)';
    ctx.fill(this.moveCache.fill);
    ctx.lineWidth = 2 / s;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(130,200,255,0.85)';
    ctx.stroke(this.moveCache.edge);
    ctx.restore();
  }

  _templateNow(cx = this.hover.cx, cy = this.hover.cy) {
    const p = this.p;
    if (p.mode !== 'template' || !p.template || cx == null) return null;
    const m = p.map;
    if (cx < 0 || cy < 0 || cx >= m.w || cy >= m.h) return null;
    const sel = p.tokens.find((t) => t.id === p.selectedId);
    const target = { x: cx, y: cy };
    const origin = sel ? { x: sel.x + Math.floor(((sel.size || 1) - 1) / 2), y: sel.y + Math.floor(((sel.size || 1) - 1) / 2) } : { ...target };
    const tpl = { ...p.template, origin, target };
    let cells;
    try {
      cells = templateCells({ w: m.w, h: m.h }, tpl);
    } catch (e) {
      cells = [];
    }
    return { origin, target, cells, tpl };
  }

  _drawTemplate(ctx, s, t) {
    const tp = this._templateNow();
    if (!tp) return null;
    const set = new Set(tp.cells.map(([x, y]) => `${x},${y}`));
    const ids = new Set();
    for (const tk of this.p.tokens) {
      const sz = tk.size || 1;
      outer: for (let dy = 0; dy < sz; dy++) for (let dx = 0; dx < sz; dx++) if (set.has(`${tk.x + dx},${tk.y + dy}`)) { ids.add(tk.id); break outer; }
    }
    const pulse = 0.85 + 0.15 * Math.sin(t * 4);
    ctx.save();
    ctx.fillStyle = `rgba(255,120,40,${0.3 * pulse})`;
    const edge = new Path2D();
    for (const [x, y] of tp.cells) {
      ctx.fillRect(x, y, 1, 1);
      if (!set.has(`${x},${y - 1}`)) (edge.moveTo(x, y), edge.lineTo(x + 1, y));
      if (!set.has(`${x},${y + 1}`)) (edge.moveTo(x, y + 1), edge.lineTo(x + 1, y + 1));
      if (!set.has(`${x - 1},${y}`)) (edge.moveTo(x, y), edge.lineTo(x, y + 1));
      if (!set.has(`${x + 1},${y}`)) (edge.moveTo(x + 1, y), edge.lineTo(x + 1, y + 1));
    }
    ctx.lineWidth = 2 / s;
    ctx.strokeStyle = 'rgba(255,170,80,0.95)';
    ctx.stroke(edge);
    // true geometric outline
    const shape = String(tp.tpl.shape || '').toLowerCase();
    const size = (tp.tpl.size || 0) / 5;
    const ox = tp.origin.x + 0.5, oy = tp.origin.y + 0.5, tx = tp.target.x + 0.5, ty = tp.target.y + 0.5;
    ctx.setLineDash([6 / s, 4 / s]);
    ctx.strokeStyle = 'rgba(255,235,190,0.9)';
    ctx.lineWidth = 1.5 / s;
    ctx.beginPath();
    if (shape === 'sphere' || shape === 'cylinder' || shape === 'circle') ctx.arc(tx, ty, size, 0, TAU);
    else if (shape === 'cube') {
      const n = Math.max(1, Math.round(size));
      const x0 = tp.target.x - Math.floor((n - 1) / 2), y0 = tp.target.y - Math.floor((n - 1) / 2);
      ctx.rect(x0, y0, n, n);
    } else {
      let dx = tx - ox, dy = ty - oy;
      if (!dx && !dy) dx = 1;
      const L = Math.hypot(dx, dy);
      const ux = dx / L, uy = dy / L;
      if (shape === 'cone') {
        const ax = ox, ay = oy; // shared/templates.js: apex at the origin cell centre
        const ex = ax + ux * size, ey = ay + uy * size;
        ctx.moveTo(ax, ay);
        ctx.lineTo(ex - uy * size * 0.5, ey + ux * size * 0.5);
        ctx.lineTo(ex + uy * size * 0.5, ey - ux * size * 0.5);
        ctx.closePath();
      } else {
        const hw = (tp.tpl.width || 5) / 10;
        const ex = ox + ux * size, ey = oy + uy * size;
        ctx.moveTo(ox - uy * hw, oy + ux * hw);
        ctx.lineTo(ex - uy * hw, ey + ux * hw);
        ctx.lineTo(ex + uy * hw, ey - ux * hw);
        ctx.lineTo(ox + uy * hw, oy - ux * hw);
        ctx.closePath();
      }
    }
    ctx.stroke();
    ctx.restore();
    return { ...tp, ids };
  }

  _drawTemplateLabel(ctx, tpl) {
    const h = this.hover;
    if (h.sx == null) return;
    let text = templateLabel(tpl.tpl);
    if (tpl.ids.size) text += ` · ${tpl.ids.size} in area`;
    pill(ctx, text, h.sx + 16, h.sy + 18, '#ffb070');
  }

  _drawRuler(ctx) {
    const r = this.ruler;
    if (!r) return;
    const s = this.cam.s;
    const sc = (c) => [this.cam.x + (c.x + 0.5) * s, this.cam.y + (c.y + 0.5) * s];
    const [ax, ay] = sc(r.a), [bx, by] = sc(r.b);
    const cells = Math.max(Math.abs(r.b.x - r.a.x), Math.abs(r.b.y - r.a.y));
    const feet = cells * 5;
    ctx.save();
    // cells along the line
    ctx.fillStyle = 'rgba(255,230,140,0.13)';
    const n = Math.max(1, cells);
    for (let i = 0; i <= n; i++) {
      const x = Math.round(r.a.x + ((r.b.x - r.a.x) * i) / n), y = Math.round(r.a.y + ((r.b.y - r.a.y) * i) / n);
      ctx.fillRect(this.cam.x + x * s, this.cam.y + y * s, s, s);
    }
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = '#ffe08a';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([10, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    for (const [x, y] of [[ax, ay], [bx, by]]) {
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, TAU);
      ctx.fillStyle = '#ffe08a';
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    pill(ctx, `${feet} ft`, bx + 14, by - 14, '#ffe08a', 15);
    ctx.restore();
  }

  _drawDrag(ctx, now) {
    const d = this.dragTok;
    if (!d) return;
    const tk = this.p.tokens.find((t) => t.id === d.id);
    if (!tk) return;
    const s = this.cam.s;
    const size = tk.size || 1;
    const mv = this.p.movement;
    const key = `${d.cx},${d.cy}`;
    const hasCells = mv && mv.tokenId === tk.id && mv.cells && mv.cells.size;
    const cost = hasCells ? mv.cells.get(key) : undefined;
    const reachable = !hasCells || cost !== undefined;
    const m = this.p.map;
    const inb = d.cx >= 0 && d.cy >= 0 && d.cx + size <= m.w && d.cy + size <= m.h;
    const ok = reachable && inb;
    // path line from origin
    const ox = this.cam.x + (tk.x + size / 2) * s, oy = this.cam.y + (tk.y + size / 2) * s;
    const tx = this.cam.x + (d.cx + size / 2) * s, ty = this.cam.y + (d.cy + size / 2) * s;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.strokeStyle = ok ? '#9fd4ff' : '#ff6a5a';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 6]);
    ctx.stroke();
    ctx.setLineDash([]);
    // destination cell
    ctx.fillStyle = ok ? 'rgba(120,200,255,0.25)' : 'rgba(255,70,60,0.3)';
    ctx.strokeStyle = ok ? 'rgba(160,215,255,0.95)' : 'rgba(255,90,80,0.95)';
    ctx.lineWidth = 2;
    ctx.fillRect(this.cam.x + d.cx * s, this.cam.y + d.cy * s, s * size, s * size);
    ctx.strokeRect(this.cam.x + d.cx * s + 1, this.cam.y + d.cy * s + 1, s * size - 2, s * size - 2);
    if (!ok) {
      const r = Math.min(10, s * 0.25);
      ctx.strokeStyle = '#ff5a4a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(tx - r, ty - r);
      ctx.lineTo(tx + r, ty + r);
      ctx.moveTo(tx + r, ty - r);
      ctx.lineTo(tx - r, ty + r);
      ctx.stroke();
    }
    ctx.restore();
    // the token itself follows the pointer
    const sr = Math.max(5, s * size * 0.5 * 0.84);
    const px = this.cam.x + (d.mx - d.gx + size / 2) * s, py = this.cam.y + (d.my - d.gy + size / 2) * s;
    drawToken(ctx, tk, px, py, sr, { time: now / 1000, img: tokenImage(tk.img), dragging: true, selected: true });
    const feet = cost !== undefined ? cost : Math.max(Math.abs(d.cx - tk.x), Math.abs(d.cy - tk.y)) * 5;
    const label = !inb ? 'off map' : reachable ? `${feet} ft` : 'out of reach';
    pill(ctx, label, tx + s * size * 0.5 + 8, ty - s * size * 0.5 - 6, ok ? '#9fd4ff' : '#ff6a5a', 14);
  }

  _pingStart(pg, now) {
    const key = `${pg.x},${pg.y},${pg.at},${pg.color}`;
    let st = this.pingSeen.get(key);
    if (st == null) {
      const age = Date.now() - (pg.at || Date.now());
      st = age >= 0 && age < PING_MS ? now - age : now;
      this.pingSeen.set(key, st);
      if (this.pingSeen.size > 200) this.pingSeen.delete(this.pingSeen.keys().next().value);
    }
    return st;
  }

  _drawPings(ctx, now) {
    const s = this.cam.s;
    for (const pg of this.p.pings) {
      const age = now - this._pingStart(pg, now);
      if (age < 0 || age > PING_MS) continue;
      const k = age / PING_MS;
      const x = this.cam.x + (pg.x + 0.5) * s, y = this.cam.y + (pg.y + 0.5) * s;
      const col = pg.color || '#ffd166';
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const kk = (k * 1.6 - i * 0.25);
        if (kk <= 0 || kk >= 1) continue;
        const r = Math.max(10, s * 0.4) + kk * Math.max(60, s * 2.2);
        ctx.globalAlpha = (1 - kk) * 0.9;
        ctx.strokeStyle = col;
        ctx.lineWidth = 3 * (1 - kk) + 1;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1 - k;
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }
  }

  _drawObjectTooltip(ctx) {
    const h = this.hover;
    if (!h.object || h.token || this.gesture) return;
    pill(ctx, h.object.label, h.sx + 14, h.sy + 16, '#d8c9a0', 12);
  }

  // ------------------------------------------------------------------ hit testing
  tokenAt(mx, my) {
    if (!this.p.map || !this.base) return null;
    this._ensureFog();
    const { normal, faded } = this._tokenLists(performance.now());
    const list = normal.concat(faded);
    for (let i = list.length - 1; i >= 0; i--) {
      const { tk, pos } = list[i];
      const size = tk.size || 1;
      const cx = pos.x + size / 2, cy = pos.y + size / 2;
      if (Math.hypot(mx - cx, my - cy) <= size * 0.5) return tk;
    }
    return null;
  }

  objectAt(mx, my) {
    const objs = this.p.map?.objects || [];
    for (let i = objs.length - 1; i >= 0; i--) {
      const o = objs[i];
      if (!o.label) continue;
      if (mx >= o.x && my >= o.y && mx < o.x + (o.w || 1) && my < o.y + (o.h || 1)) {
        if (this.fog) {
          const lv = this.fog.levels[Math.floor(my) * this.p.map.w + Math.floor(mx)];
          if (!lv) return null;
        }
        return o;
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ input
  _bind() {
    const c = this.canvas;
    this._h = {
      down: (e) => this._down(e),
      move: (e) => this._move(e),
      up: (e) => this._up(e),
      cancel: (e) => this._cancel(e),
      leave: () => this._leave(),
      wheel: (e) => this._wheel(e),
      ctx: (e) => e.preventDefault(),
      key: (e) => this._key(e),
    };
    c.addEventListener('pointerdown', this._h.down);
    c.addEventListener('pointermove', this._h.move);
    c.addEventListener('pointerup', this._h.up);
    c.addEventListener('pointercancel', this._h.cancel);
    c.addEventListener('pointerleave', this._h.leave);
    c.addEventListener('wheel', this._h.wheel, { passive: false });
    c.addEventListener('contextmenu', this._h.ctx);
    c.addEventListener('keydown', this._h.key);
    if (typeof ResizeObserver !== 'undefined' && this.container) {
      this.ro = new ResizeObserver((entries) => {
        const r = entries[0].contentRect;
        this.resize(Math.round(r.width), Math.round(r.height));
      });
      this.ro.observe(this.container);
    }
    if (this.container) {
      const r = this.container.getBoundingClientRect();
      if (r.width && r.height) this.resize(Math.round(r.width), Math.round(r.height));
    }
    this._dprMq = null;
    this._onDpr = () => {
      const r = this.container?.getBoundingClientRect();
      if (r) {
        this.vw = 0;
        this.resize(Math.round(r.width), Math.round(r.height));
      }
    };
    if (typeof matchMedia !== 'undefined') {
      this._dprMq = matchMedia(`(resolution: ${(typeof devicePixelRatio !== 'undefined' && devicePixelRatio) || 1}dppx)`);
      this._dprMq.addEventListener?.('change', this._onDpr);
    }
  }

  destroy() {
    this.destroyed = true;
    caf(this.raf);
    clearTimeout(this.buildTimer);
    const c = this.canvas;
    c.removeEventListener('pointerdown', this._h.down);
    c.removeEventListener('pointermove', this._h.move);
    c.removeEventListener('pointerup', this._h.up);
    c.removeEventListener('pointercancel', this._h.cancel);
    c.removeEventListener('pointerleave', this._h.leave);
    c.removeEventListener('wheel', this._h.wheel);
    c.removeEventListener('contextmenu', this._h.ctx);
    c.removeEventListener('keydown', this._h.key);
    this.ro?.disconnect();
    this._dprMq?.removeEventListener?.('change', this._onDpr);
  }

  _local(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  _updateHover(sx, sy) {
    const h = this.hover;
    const [mx, my] = this.toMap(sx, sy);
    const cx = Math.floor(mx), cy = Math.floor(my);
    const tk = this.tokenAt(mx, my);
    const obj = tk ? null : this.objectAt(mx, my);
    const changed = cx !== h.cx || cy !== h.cy || (tk?.id ?? null) !== h.token || obj !== h.object;
    Object.assign(h, { sx, sy, mx, my, cx, cy, token: tk ? tk.id : null, object: obj });
    if (changed || this.p.mode === 'template' || h.object) {
      this._updateCursor();
      this.invalidate();
    }
  }

  _updateCursor() {
    const mode = this.p.mode;
    const g = this.gesture;
    let cur = 'default';
    if (g && (g.type === 'pan' || g.type === 'pinch')) cur = 'grabbing';
    else if (g && g.type === 'token') cur = 'grabbing';
    else if (mode === 'measure' || mode === 'template' || mode === 'ping') cur = 'crosshair';
    else if (mode === 'target') cur = this.hover.token ? 'pointer' : 'crosshair';
    else if (this.hover.token) {
      const tk = this.p.tokens.find((t) => t.id === this.hover.token);
      cur = tk && tk.isMine && this.p.onMoveToken ? 'grab' : 'pointer';
    }
    if (this.canvas.style.cursor !== cur) this.canvas.style.cursor = cur;
  }

  _down(e) {
    if (!this.base) return;
    if (this.canvas.focus) this.canvas.focus({ preventScroll: true });
    const [sx, sy] = this._local(e);
    this.pointers.set(e.pointerId, { sx, sy, type: e.pointerType });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {}
    this.camAnim = null;
    if (this.pointers.size === 2) {
      // pinch: abort single-pointer gestures
      if (this.gesture?.type === 'ruler' && this.ruler) this.ruler = null;
      this.dragTok = null;
      const [a, b] = [...this.pointers.values()];
      const mid = [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2];
      this.gesture = { type: 'pinch', d0: Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1, s0: this.cam.s, m: this.toMap(mid[0], mid[1]) };
      this._updateCursor();
      return;
    }
    if (this.pointers.size > 2) return;
    const [mx, my] = this.toMap(sx, sy);
    this._updateHover(sx, sy);
    const tok = this.tokenAt(mx, my);
    const mode = this.p.mode || 'select';
    const base = { sx, sy, camx: this.cam.x, camy: this.cam.y, tok, touch: e.pointerType === 'touch' };
    if (e.button === 1 || e.button === 2) {
      this.gesture = { ...base, type: 'pan' };
    } else if (e.altKey || mode === 'ping') {
      this.gesture = { ...base, type: 'maybe-ping' };
    } else if (mode === 'measure') {
      const c = { x: Math.floor(mx), y: Math.floor(my) };
      this.gesture = { ...base, type: 'ruler' };
      this.ruler = { a: c, b: c, live: true };
    } else if (mode === 'select' && tok && tok.isMine && this.p.onMoveToken) {
      const pos = this.tokenPos(tok);
      this.gesture = { ...base, type: 'maybe-token', gx: mx - pos.x, gy: my - pos.y };
    } else {
      this.gesture = { ...base, type: 'maybe-click' };
    }
    this._updateCursor();
    this.invalidate();
  }

  _move(e) {
    const [sx, sy] = this._local(e);
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.sx = sx;
      p.sy = sy;
    }
    const g = this.gesture;
    if (!g) {
      if (e.pointerType !== 'touch') this._updateHover(sx, sy);
      return;
    }
    if (g.type === 'pinch') {
      if (this.pointers.size < 2) return;
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.sx - b.sx, a.sy - b.sy) || 1;
      const mid = [(a.sx + b.sx) / 2, (a.sy + b.sy) / 2];
      const s1 = clamp(g.s0 * (d / g.d0), this.minS, this.maxS);
      this.cam.s = s1;
      this.cam.x = mid[0] - g.m[0] * s1;
      this.cam.y = mid[1] - g.m[1] * s1;
      this._clampCam();
      this.invalidate();
      return;
    }
    const thr = g.touch ? 10 : 5;
    const moved = Math.hypot(sx - g.sx, sy - g.sy) > thr;
    if ((g.type === 'maybe-click' || g.type === 'maybe-ping') && moved) g.type = 'pan';
    if (g.type === 'maybe-token' && moved) {
      g.type = 'token';
      this.dragTok = { id: g.tok.id, gx: g.gx, gy: g.gy, mx: 0, my: 0, cx: g.tok.x, cy: g.tok.y };
    }
    if (g.type === 'pan') {
      this.cam.x = g.camx + (sx - g.sx);
      this.cam.y = g.camy + (sy - g.sy);
      this._clampCam();
    } else if (g.type === 'token') {
      const [mx, my] = this.toMap(sx, sy);
      const d = this.dragTok;
      d.mx = mx;
      d.my = my;
      d.cx = Math.round(mx - d.gx);
      d.cy = Math.round(my - d.gy);
      this._autoScroll(sx, sy);
    } else if (g.type === 'ruler') {
      const [mx, my] = this.toMap(sx, sy);
      this.ruler.b = { x: Math.floor(mx), y: Math.floor(my) };
    }
    this._updateHover(sx, sy);
    this._updateCursor();
    this.invalidate();
  }

  _autoScroll(sx, sy) {
    const edge = 28, sp = 8;
    if (sx < edge) this.cam.x += sp;
    else if (sx > this.vw - edge) this.cam.x -= sp;
    if (sy < edge) this.cam.y += sp;
    else if (sy > this.vh - edge) this.cam.y -= sp;
  }

  _up(e) {
    const had = this.pointers.has(e.pointerId);
    this.pointers.delete(e.pointerId);
    try {
      this.canvas.releasePointerCapture(e.pointerId);
    } catch {}
    const g = this.gesture;
    if (!g || !had) return;
    if (g.type === 'pinch') {
      if (this.pointers.size === 1) {
        const [q] = [...this.pointers.values()];
        this.gesture = { type: 'pan', sx: q.sx, sy: q.sy, camx: this.cam.x, camy: this.cam.y, touch: true };
      } else this.gesture = null;
      this._updateCursor();
      return;
    }
    const [sx, sy] = this._local(e);
    const [mx, my] = this.toMap(sx, sy);
    const cx = Math.floor(mx), cy = Math.floor(my);
    const m = this.p.map;
    const inb = m && cx >= 0 && cy >= 0 && cx < m.w && cy < m.h;
    const p = this.p;
    switch (g.type) {
      case 'maybe-click':
        this._click(g, cx, cy, inb);
        break;
      case 'maybe-token':
        p.onSelectToken?.(g.tok.id);
        break;
      case 'maybe-ping':
        if (inb) p.onPing?.(cx, cy);
        break;
      case 'token': {
        const d = this.dragTok;
        const tk = p.tokens.find((t) => t.id === d.id);
        const size = tk?.size || 1;
        if (tk && (d.cx !== tk.x || d.cy !== tk.y) && d.cx >= 0 && d.cy >= 0 && d.cx + size <= m.w && d.cy + size <= m.h) {
          this.pending.set(tk.id, { x: d.cx, y: d.cy, t: performance.now() });
          const a = this.anim.get(tk.id);
          if (a) Object.assign(a, { fx: d.cx, fy: d.cy, tx: tk.x, ty: tk.y, t0: 0 });
          p.onMoveToken?.(tk.id, d.cx, d.cy);
        } else if (tk) {
          // snap back with a little glide from where it was dropped
          const a = this.anim.get(tk.id);
          if (a) Object.assign(a, { fx: d.mx - d.gx, fy: d.my - d.gy, tx: tk.x, ty: tk.y, t0: performance.now() });
        }
        this.dragTok = null;
        break;
      }
      case 'ruler':
        if (this.ruler) {
          this.ruler.live = false;
          if (this.ruler.a.x === this.ruler.b.x && this.ruler.a.y === this.ruler.b.y) this.ruler = null;
        }
        break;
      default:
        break;
    }
    this.gesture = null;
    this._updateHover(sx, sy);
    this._updateCursor();
    this.invalidate();
  }

  _click(g, cx, cy, inb) {
    const p = this.p;
    const mode = p.mode || 'select';
    if (mode === 'template') {
      const tp = this._templateNow(cx, cy);
      if (tp) p.onTemplate?.({ origin: tp.origin, target: tp.target, cells: tp.cells });
      return;
    }
    if (mode === 'target') {
      if (g.tok) p.onTarget?.(g.tok.id);
      else if (inb) p.onCellClick?.(cx, cy);
      return;
    }
    if (g.tok) p.onSelectToken?.(g.tok.id);
    else {
      p.onSelectToken?.(null);
      if (inb) p.onCellClick?.(cx, cy);
    }
  }

  _cancel(e) {
    this.pointers.delete(e.pointerId);
    if (this.gesture?.type === 'token') this.dragTok = null;
    if (!this.pointers.size) this.gesture = null;
    this._updateCursor();
    this.invalidate();
  }

  _leave() {
    if (this.gesture) return;
    const h = this.hover;
    if (h.cx != null || h.token) {
      Object.assign(h, { sx: null, sy: null, cx: null, cy: null, token: null, object: null });
      this.invalidate();
    }
  }

  _wheel(e) {
    e.preventDefault();
    if (!this.base) return;
    const [sx, sy] = this._local(e);
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 33;
    else if (e.deltaMode === 2) dy *= 400;
    dy = clamp(dy, -250, 250);
    this._zoomAt(sx, sy, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    this._updateHover(sx, sy);
  }

  _key(e) {
    if (e.key === 'Escape') {
      this.ruler = null;
      if (this.gesture?.type === 'token') this.dragTok = null;
      this.gesture = null;
      this.invalidate();
    } else if (e.key === '+' || e.key === '=') this.zoomBy(1.2);
    else if (e.key === '-' || e.key === '_') this.zoomBy(1 / 1.2);
    else if (e.key === '0') this.fit(true);
  }
}

function pill(ctx, text, x, y, accent = '#d8c9a0', size = 13) {
  ctx.save();
  ctx.font = `700 ${size}px ${UI_FONT}`;
  const w = ctx.measureText(text).width + 16;
  const h = size + 10;
  ctx.fillStyle = 'rgba(16,12,9,0.88)';
  ctx.strokeStyle = accent;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y - h / 2, w, h, h / 2);
  else ctx.rect(x, y - h / 2, w, h);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#f6ecd6';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 8, y + 0.5);
  ctx.restore();
}

export { drawNameLabel };
