// Tactical (battle) map generation, creature placement and AI-facing ASCII descriptions.
// Pure ESM with no Node-only imports: the browser demo page imports this module too.
// Deterministic: the same spec + seed always produces the same map (seeded mulberry32 PRNG, no Math.random
// unless no seed is given).

import { computeLight, getGrids } from "./vision.js";

// =================================================================================================================
// Random numbers and noise

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

class Rng {
  constructor(seed) {
    this.f = mulberry32(seed);
  }
  next() {
    return this.f();
  }
  float(a = 0, b = 1) {
    return a + (b - a) * this.f();
  }
  int(a, b) {
    if (b < a) return a;
    return a + Math.floor(this.f() * (b - a + 1));
  }
  chance(p) {
    return this.f() < p;
  }
  pick(arr) {
    return arr[Math.floor(this.f() * arr.length)];
  }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.f() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }
  fork(salt) {
    return new Rng((Math.floor(this.f() * 4294967296) ^ hashString(String(salt))) >>> 0);
  }
}

// Value-noise field, rank-normalised so values are uniformly distributed in [0, 1): thresholds become area fractions.
function noiseField(rng, w, h, scale = 6, octaves = 3) {
  const layers = [];
  let amp = 1;
  let s = scale;
  for (let o = 0; o < octaves; o++) {
    const gw = Math.ceil(w / s) + 2;
    const gh = Math.ceil(h / s) + 2;
    const lat = new Float32Array(gw * gh);
    for (let i = 0; i < lat.length; i++) lat[i] = rng.next();
    layers.push({ s, gw, lat, amp, ox: rng.float(0, s), oy: rng.float(0, s) });
    amp *= 0.5;
    s = Math.max(1.5, s / 2);
  }
  const raw = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let v = 0;
      for (const L of layers) {
        const fx = (x + L.ox) / L.s;
        const fy = (y + L.oy) / L.s;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        const tx = fx - ix;
        const ty = fy - iy;
        const sx = tx * tx * (3 - 2 * tx);
        const sy = ty * ty * (3 - 2 * ty);
        const a = L.lat[iy * L.gw + ix];
        const b = L.lat[iy * L.gw + ix + 1];
        const c = L.lat[(iy + 1) * L.gw + ix];
        const d = L.lat[(iy + 1) * L.gw + ix + 1];
        v += L.amp * (a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy);
      }
      raw[y * w + x] = v;
    }
  }
  const order = Array.from(raw.keys()).sort((i, j) => raw[i] - raw[j]);
  const out = new Float32Array(w * h);
  for (let r = 0; r < order.length; r++) out[order[r]] = r / order.length;
  return out;
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// =================================================================================================================
// Static tables

export const THEMES = [
  "dungeon", "cave", "forest", "tavern", "street", "road", "swamp", "crypt",
  "camp", "ruins", "temple", "mine", "castle", "ship", "village", "field",
];

// alias -> [theme, extra feature hints]
const ALIASES = [
  ["catacomb", "crypt"], ["tomb", "crypt"], ["mausoleum", "crypt"], ["ossuary", "crypt"], ["barrow", "crypt"],
  ["necropolis", "crypt"], ["sepulch", "crypt"], ["vault", "dungeon"],
  ["graveyard", "field", ["graves"]], ["cemetery", "field", ["graves"]], ["churchyard", "field", ["graves"]],
  ["inn", "tavern"], ["pub", "tavern"], ["alehouse", "tavern"], ["taproom", "tavern"], ["saloon", "tavern"],
  ["bar", "tavern"], ["brothel", "tavern"], ["gambling", "tavern"], ["lodge", "tavern"],
  ["wood", "forest"], ["jungle", "forest"], ["grove", "forest"], ["glade", "forest"], ["thicket", "forest"],
  ["copse", "forest"], ["taiga", "forest"], ["weald", "forest"],
  ["market", "street", ["market"]], ["bazaar", "street", ["market"]], ["plaza", "street", ["market"]],
  ["square", "street", ["market"]], ["alley", "street"], ["city", "street"], ["town", "street"], ["docks", "street"],
  ["harbor", "ship", ["docked"]], ["harbour", "ship", ["docked"]], ["pier", "ship", ["docked"]], ["wharf", "ship", ["docked"]],
  ["sewer", "dungeon", ["sewer"]], ["prison", "dungeon", ["prison"]], ["jail", "dungeon", ["prison"]],
  ["dungeon", "dungeon"], ["lair", "dungeon"], ["labyrinth", "dungeon"], ["maze", "dungeon"], ["tower", "dungeon"],
  ["bridge", "road", ["river", "bridge"]], ["river", "road", ["river"]], ["ford", "road", ["stream"]],
  ["crossroad", "road", ["crossroads"]], ["highway", "road"], ["trail", "road"], ["pass", "road"], ["path", "road"],
  ["cavern", "cave"], ["grotto", "cave"], ["underdark", "cave"], ["burrow", "cave"], ["den", "cave"], ["warren", "cave"],
  ["quarry", "mine"], ["tunnel", "mine"], ["dwarven", "mine"],
  ["church", "temple"], ["shrine", "temple"], ["cathedral", "temple"], ["chapel", "temple"], ["monastery", "temple"],
  ["abbey", "temple"], ["sanctum", "temple"], ["cult", "temple"],
  ["keep", "castle"], ["throne", "castle"], ["palace", "castle"], ["fortress", "castle"], ["fort", "castle"],
  ["manor", "castle"], ["hall", "castle"], ["citadel", "castle"], ["mansion", "castle"],
  ["boat", "ship"], ["galleon", "ship"], ["deck", "ship"], ["pirate", "ship"], ["vessel", "ship"],
  ["hamlet", "village"], ["farm", "village"], ["homestead", "village"], ["settlement", "village"],
  ["plain", "field"], ["meadow", "field"], ["grassland", "field"], ["hill", "field"], ["battlefield", "field"],
  ["steppe", "field"], ["prairie", "field"], ["pasture", "field"], ["desert", "field", ["desert"]],
  ["bog", "swamp"], ["marsh", "swamp"], ["fen", "swamp"], ["mire", "swamp"], ["bayou", "swamp"], ["wetland", "swamp"],
  ["encampment", "camp"], ["outpost", "camp"], ["hideout", "camp"], ["bivouac", "camp"], ["war camp", "camp"],
  ["ruin", "ruins"], ["abandoned", "ruins"], ["temple ruins", "ruins"], ["fallen", "ruins"],
];

/** resolveTheme("goblin catacombs") -> { theme: "crypt", hints: [] } */
export function resolveTheme(input) {
  const s = String(input || "").toLowerCase().trim();
  if (THEMES.includes(s)) return { theme: s, hints: [] };
  // exact theme word inside the string ("goblin cave", "old forest road" -> first listed theme word wins by position)
  let best = null;
  for (const t of THEMES) {
    const i = s.indexOf(t);
    if (i >= 0 && (!best || i > best.i || (i === best.i && t.length > best.t.length))) best = { i, t };
  }
  let alias = null;
  for (const [k, t, hints] of ALIASES) {
    const i = s.indexOf(k);
    if (i >= 0 && (!alias || i > alias.i || (i === alias.i && k.length > alias.k.length))) alias = { i, k, t, hints };
  }
  // the last-mentioned noun usually names the place ("forest road" -> road, "temple ruins" -> ruins)
  if (best && (!alias || best.i + best.t.length >= alias.i + alias.k.length)) return { theme: best.t, hints: [] };
  if (alias) return { theme: alias.t, hints: alias.hints || [] };
  return { theme: s ? "dungeon" : "field", hints: [] };
}

// object kind defaults: bm = blocks move, bs = blocks sight, d = difficult, c = cover
const KIND = {
  tree: { bm: 1, bs: 1, c: "three-quarters" },
  bush: { d: 1, c: "half" },
  rock: { bm: 1, c: "half" },
  boulder: { bm: 1, bs: 1, c: "three-quarters" },
  pillar: { bm: 1, bs: 1, c: "three-quarters" },
  statue: { bm: 1, bs: 1, c: "three-quarters" },
  stalagmite: { bm: 1, bs: 1, c: "three-quarters" },
  table: { bm: 1, c: "half" },
  map_table: { bm: 1, c: "half" },
  chair: {},
  stool: {},
  bench: { d: 1 },
  pew: { d: 1, c: "half" },
  barrel: { bm: 1, c: "half" },
  crate: { bm: 1, c: "half" },
  sack: { d: 1 },
  bed: { bm: 1, c: "half" },
  bar: { bm: 1, c: "half" },
  counter: { bm: 1, c: "half" },
  shelf: { bm: 1, bs: 1, c: "three-quarters" },
  bookshelf: { bm: 1, bs: 1, c: "three-quarters" },
  fireplace: { bm: 1 },
  brazier: { bm: 1, c: "half" },
  torch: {},
  campfire: { bm: 1 },
  chest: { bm: 1, c: "half" },
  altar: { bm: 1, c: "half" },
  well: { bm: 1, c: "half" },
  fountain: { bm: 1, c: "half" },
  cart: { bm: 1, c: "half" },
  tent: { bm: 1, bs: 1, c: "three-quarters" },
  bones: {},
  rug: {},
  throne: { bm: 1, c: "half" },
  coffin: { bm: 1, c: "half" },
  sarcophagus: { bm: 1, c: "half" },
  stairs_up: {},
  stairs_down: {},
  lever: {},
  anvil: { bm: 1, c: "half" },
  forge: { bm: 1, c: "half" },
  haybale: { bm: 1, c: "half" },
  fence: { bm: 1, c: "half" },
  log: { d: 1, c: "half" },
  mushroom: {},
  crystal: { bm: 1, c: "half" },
  web: { d: 1 },
  rubble: { d: 1, c: "half" },
  banner: {},
  cage: { bm: 1, c: "half" },
  trapdoor: {},
  mast: { bm: 1, bs: 1, c: "three-quarters" },
  rope: {},
  cauldron: { bm: 1, c: "half" },
  idol: { bm: 1, bs: 1, c: "three-quarters" },
  gravestone: { bm: 1, c: "half" },
  ruin_wall: { bm: 1, c: "half" },
  palisade: { bm: 1, bs: 1 },
  weapon_rack: { bm: 1, c: "half" },
  helm: { bm: 1, c: "half" },
  signpost: { bm: 1 },
  bedroll: {},
};

// single-character glyphs for ASCII renderings (lowercase / punctuation only: uppercase + digits are tokens)
const GLYPH = {
  tree: "t", bush: "v", rock: "o", boulder: "o", pillar: "i", statue: "&", idol: "&", stalagmite: "^",
  table: "n", map_table: "n", chair: "h", stool: "h", bench: "h", pew: "h", barrel: "b", crate: "x", sack: "s",
  bed: "z", bar: "[", counter: "[", shelf: "]", bookshelf: "]", fireplace: "f", brazier: "*", torch: "!",
  campfire: "*", chest: "c", altar: "a", well: "q", fountain: "q", cart: "k", tent: "m", bones: ";", rug: null,
  throne: "y", coffin: "u", sarcophagus: "u", stairs_up: "<", stairs_down: ">", lever: "l", anvil: "r", forge: "r",
  haybale: "p", fence: "-", log: "j", mushroom: "'", crystal: "$", web: "`", rubble: ";", banner: "!",
  cage: "g", trapdoor: "d", mast: "|", rope: null, cauldron: "e", gravestone: "g", ruin_wall: "-", palisade: "|",
  weapon_rack: ")", helm: "@", signpost: "!", bedroll: "z",
};
const TILE_NAMES = {
  "#": "wall/rock", ".": "stone floor", ",": "dirt", '"': "grass", "=": "planks", _: "cobbles/flagstones",
  ":": "sand/gravel", "~": "shallow water (difficult)", w: "deep water (no walking)", "%": "difficult ground",
  "+": "door", "/": "open door", " ": "pit/void (impassable)",
};

const LIGHT = {
  torch: { bright: 20, dim: 20, color: "#ffb347", flicker: true },
  lantern: { bright: 15, dim: 15, color: "#ffd27a", flicker: false },
  lamp: { bright: 15, dim: 15, color: "#ffe2a0", flicker: false },
  brazier: { bright: 15, dim: 15, color: "#ff8c3a", flicker: true },
  campfire: { bright: 20, dim: 20, color: "#ff9a3c", flicker: true },
  fireplace: { bright: 20, dim: 20, color: "#ff8a3d", flicker: true },
  hearth: { bright: 10, dim: 15, color: "#ff8a3d", flicker: true },
  candle: { bright: 5, dim: 5, color: "#ffe0a0", flicker: true },
  crystal: { bright: 5, dim: 10, color: "#7fd4ff", flicker: false },
  fungus: { bright: 0, dim: 10, color: "#9dff8a", flicker: false },
  holy: { bright: 10, dim: 10, color: "#d9c3ff", flicker: false },
  forge: { bright: 10, dim: 15, color: "#ff6a2a", flicker: true },
};

const WALK = new Set([".", ",", '"', "=", "_", ":", "~", "%", "+"]);
const GROUND = new Set([".", ",", '"', "=", "_", ":", "~", "%"]); // walkable, not a door
const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIR8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

const SIZES = { small: [20, 15], medium: [30, 22], large: [40, 30] };

// =================================================================================================================
// Generator state

class Gen {
  constructor(w, h, rng, F, theme) {
    this.w = w;
    this.h = h;
    this.rng = rng;
    this.F = F; // feature helper
    this.theme = theme;
    this.t = new Array(w * h).fill("#");
    this.objs = [];
    this.og = new Int32Array(w * h).fill(-1);
    this.doors = [];
    this.lights = [];
    this.regions = [];
    this.anchors = { party: [], enemy: [], npc: [], hidden: [] };
    this.clear = new Uint8Array(w * h); // keep free of blocking objects (doorways, paths)
    this.floor = ".";
    this.indoor = true;
    this.used = new Set(); // features already handled by the theme
    this.night = false;
    this.lit = true; // whether "only at night" lights should be added
  }
  i(x, y) {
    return y * this.w + x;
  }
  inb(x, y) {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }
  get(x, y) {
    return this.inb(x, y) ? this.t[y * this.w + x] : "#";
  }
  set(x, y, c) {
    if (this.inb(x, y)) this.t[y * this.w + x] = c;
  }
  fill(c) {
    this.t.fill(c);
  }
  rect(x, y, w, h, c, pred) {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) if (this.inb(xx, yy) && (!pred || pred(this.get(xx, yy), xx, yy))) this.set(xx, yy, c);
    }
  }
  frame(x, y, w, h, c) {
    for (let xx = x; xx < x + w; xx++) {
      this.set(xx, y, c);
      this.set(xx, y + h - 1, c);
    }
    for (let yy = y; yy < y + h; yy++) {
      this.set(x, yy, c);
      this.set(x + w - 1, yy, c);
    }
  }
  disc(cx, cy, r, c, pred) {
    const r2 = r * r;
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2 && this.inb(x, y) && (!pred || pred(this.get(x, y), x, y))) this.set(x, y, c);
      }
    }
  }
  // stamp a polyline of points [[x, y], ...] (cell units, continuous) with a given radius
  stroke(points, r, c, pred, mark) {
    for (let k = 0; k < points.length; k++) {
      const [ax, ay] = points[k];
      const [bx, by] = points[Math.min(points.length - 1, k + 1)];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) * 3));
      for (let s = 0; s <= n; s++) {
        const px = ax + ((bx - ax) * s) / n;
        const py = ay + ((by - ay) * s) / n;
        const r2 = r * r;
        for (let y = Math.floor(py - r - 1); y <= Math.ceil(py + r); y++) {
          for (let x = Math.floor(px - r - 1); x <= Math.ceil(px + r); x++) {
            const dx = x + 0.5 - px;
            const dy = y + 0.5 - py;
            if (dx * dx + dy * dy > r2 || !this.inb(x, y)) continue;
            if (pred && !pred(this.get(x, y), x, y)) continue;
            if (c != null) this.set(x, y, c);
            if (mark) mark[this.i(x, y)] = 1;
          }
        }
      }
    }
  }
  // wavy polyline between two points; pinned ends when pin = true
  meander(ax, ay, bx, by, amp, waves = 1.5, pin = false) {
    const len = Math.max(1, Math.hypot(bx - ax, by - ay));
    const n = Math.ceil(len * 1.5);
    const px = -(by - ay) / len;
    const py = (bx - ax) / len;
    const p1 = this.rng.float(0, Math.PI * 2);
    const p2 = this.rng.float(0, Math.PI * 2);
    const f1 = waves * this.rng.float(0.7, 1.3);
    const f2 = waves * this.rng.float(1.8, 2.8);
    const pts = [];
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      const env = pin ? Math.sin(t * Math.PI) : 1;
      const off = amp * env * (0.7 * Math.sin(t * f1 * Math.PI * 2 + p1) + 0.3 * Math.sin(t * f2 * Math.PI * 2 + p2));
      pts.push([ax + (bx - ax) * t + px * off, ay + (by - ay) * t + py * off]);
    }
    return pts;
  }
  isWalk(x, y) {
    return WALK.has(this.get(x, y));
  }
  isGround(x, y) {
    return GROUND.has(this.get(x, y));
  }
  objAt(x, y) {
    if (!this.inb(x, y)) return null;
    const k = this.og[this.i(x, y)];
    return k >= 0 ? this.objs[k] : null;
  }
  // free = ground tile with no object
  free(x, y) {
    return this.inb(x, y) && GROUND.has(this.t[this.i(x, y)]) && this.og[this.i(x, y)] < 0;
  }
  passable(x, y) {
    if (!this.inb(x, y)) return false;
    const c = this.t[this.i(x, y)];
    if (!WALK.has(c)) return false;
    if (c === "+") {
      const d = this.doorAt(x, y);
      if (d && (d.locked || d.secret)) return false;
    }
    const o = this.objAt(x, y);
    return !(o && o.blocksMove);
  }
  doorAt(x, y) {
    return this.doors.find((d) => d.x === x && d.y === y) || null;
  }
  addDoor(x, y, props = {}) {
    if (!this.inb(x, y)) return null;
    this.removeObjAt(x, y);
    this.set(x, y, "+");
    let d = this.doorAt(x, y);
    if (!d) {
      d = { x, y, open: false, locked: false, secret: false };
      this.doors.push(d);
    }
    Object.assign(d, props);
    this.clear[this.i(x, y)] = 1;
    for (const [dx, dy] of DIR4) if (this.inb(x + dx, y + dy)) this.clear[this.i(x + dx, y + dy)] = 1;
    return d;
  }
  removeDoorAt(x, y) {
    this.doors = this.doors.filter((d) => d.x !== x || d.y !== y);
  }
  // add an object; refuses if any cell is off-map, not ground, occupied, or (for blockers) marked clear
  add(kind, x, y, w = 1, h = 1, props = {}) {
    const def = KIND[kind] || { bm: 1, c: "half" };
    const bm = props.blocksMove ?? !!def.bm;
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        if (!this.inb(xx, yy)) return null;
        const i = this.i(xx, yy);
        if (!GROUND.has(this.t[i]) && !(props.onAny && this.t[i] !== "#" && this.t[i] !== "+")) return null;
        if (this.og[i] >= 0) return null;
        if (bm && this.clear[i] && !props.force) return null;
      }
    }
    const o = {
      id: "",
      kind,
      x,
      y,
      w,
      h,
      rot: 0,
      blocksMove: bm,
      blocksSight: !!def.bs,
      difficult: !!def.d,
      cover: def.c || null,
      light: null,
      hidden: false,
      label: null,
    };
    for (const k of Object.keys(props)) if (k !== "force" && k !== "onAny") o[k] = props[k];
    const k = this.objs.length;
    this.objs.push(o);
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.og[this.i(xx, yy)] = k;
    return o;
  }
  reset(rng) {
    if (rng) this.rng = rng;
    this.t.fill("#");
    this.objs = [];
    this.og.fill(-1);
    this.doors = [];
    this.lights = [];
    this.regions = [];
    this.anchors = { party: [], enemy: [], npc: [], hidden: [] };
    this.clear.fill(0);
    this.used = new Set();
  }
  removeObj(o) {
    const k = this.objs.indexOf(o);
    if (k < 0) return;
    this.objs.splice(k, 1);
    this.lights = this.lights.filter((l) => l.obj !== o);
    this.reindex();
  }
  removeObjAt(x, y) {
    const o = this.objAt(x, y);
    if (o) this.removeObj(o);
  }
  reindex() {
    this.og.fill(-1);
    this.objs.forEach((o, k) => {
      for (let yy = o.y; yy < o.y + o.h; yy++) for (let xx = o.x; xx < o.x + o.w; xx++) if (this.inb(xx, yy)) this.og[this.i(xx, yy)] = k;
    });
  }
  light(x, y, preset, obj = null, extra = {}) {
    const p = LIGHT[preset] || LIGHT.torch;
    const l = { id: "", x, y, bright: p.bright, dim: p.dim, color: p.color, flicker: p.flicker, kind: LIGHT[preset] ? preset : "torch", ...extra };
    if (obj) l.obj = obj;
    this.lights.push(l);
    return l;
  }
  region(name, x, y, w, h) {
    const r = { name, x, y, w, h };
    this.regions.push(r);
    return r;
  }
  count(x, y, pred, dirs = DIR8) {
    let n = 0;
    for (const [dx, dy] of dirs) if (pred(this.get(x + dx, y + dy), x + dx, y + dy)) n++;
    return n;
  }
  // cells of a rectangle satisfying pred, shuffled
  cells(x, y, w, h, pred) {
    const out = [];
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) if (this.inb(xx, yy) && (!pred || pred(xx, yy))) out.push([xx, yy]);
    return out;
  }
  scatter(kind, n, cells, props = {}, w = 1, h = 1) {
    const list = this.rng.shuffle(cells.slice());
    const placed = [];
    for (const [x, y] of list) {
      if (placed.length >= n) break;
      const o = this.add(kind, x, y, w, h, typeof props === "function" ? props(x, y) : props);
      if (o) placed.push(o);
    }
    return placed;
  }
  // geometric transform of the whole map (used to vary canonical layouts)
  transform(transpose, flipX, flipY) {
    if (!transpose && !flipX && !flipY) return;
    const W0 = this.w;
    const H0 = this.h;
    const W = transpose ? H0 : W0;
    const H = transpose ? W0 : H0;
    const mapPt = (x, y) => {
      let nx = transpose ? y : x;
      let ny = transpose ? x : y;
      if (flipX) nx = W - 1 - nx;
      if (flipY) ny = H - 1 - ny;
      return [nx, ny];
    };
    const mapRect = (r) => {
      const [ax, ay] = mapPt(r.x, r.y);
      const [bx, by] = mapPt(r.x + r.w - 1, r.y + r.h - 1);
      r.x = Math.min(ax, bx);
      r.y = Math.min(ay, by);
      const nw = Math.abs(bx - ax) + 1;
      const nh = Math.abs(by - ay) + 1;
      r.w = nw;
      r.h = nh;
    };
    const mapRot = (rot) => {
      let r = rot || 0;
      if (transpose) r = 270 - r;
      if (flipX) r = 360 - r;
      if (flipY) r = 180 - r;
      return ((r % 360) + 360) % 360;
    };
    const nt = new Array(W * H);
    const nclear = new Uint8Array(W * H);
    for (let y = 0; y < H0; y++) {
      for (let x = 0; x < W0; x++) {
        const [nx, ny] = mapPt(x, y);
        nt[ny * W + nx] = this.t[y * W0 + x];
        nclear[ny * W + nx] = this.clear[y * W0 + x];
      }
    }
    this.t = nt;
    this.clear = nclear;
    this.w = W;
    this.h = H;
    for (const o of this.objs) {
      mapRect(o);
      o.rot = mapRot(o.rot);
    }
    for (const d of this.doors) [d.x, d.y] = mapPt(d.x, d.y);
    for (const l of this.lights) [l.x, l.y] = mapPt(l.x, l.y);
    for (const r of this.regions) mapRect(r);
    for (const k of Object.keys(this.anchors)) this.anchors[k] = this.anchors[k].map(([x, y]) => mapPt(x, y));
    this.og = new Int32Array(W * H).fill(-1);
    this.reindex();
    if (this.extra && this.extra.transform) this.extra.transform(mapPt);
  }
}

// feature hints helper
function makeFeatures(list) {
  const items = (Array.isArray(list) ? list : list ? [list] : []).map((s) => String(s).toLowerCase());
  const text = " " + items.join(" | ") + " ";
  // match at the start of a word: has("tree") matches "trees" but not "street"
  const has = (...words) => words.some((w) => {
    let i = text.indexOf(w);
    while (i >= 0) {
      if (!/[a-z]/.test(text[i - 1] || " ")) return true;
      i = text.indexOf(w, i + 1);
    }
    return false;
  });
  return { items, text, has };
}

// =================================================================================================================
// Shared building blocks

// interior cells along the walls of a room rect {x,y,w,h} (interior coordinates), with the facing away from the wall
function wallSpots(g, R, pred = (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]) {
  const out = [];
  for (let x = R.x; x < R.x + R.w; x++) {
    if (g.get(x, R.y - 1) === "#" && pred(x, R.y)) out.push([x, R.y, 180, "n"]);
    if (g.get(x, R.y + R.h) === "#" && pred(x, R.y + R.h - 1)) out.push([x, R.y + R.h - 1, 0, "s"]);
  }
  for (let y = R.y; y < R.y + R.h; y++) {
    if (g.get(R.x - 1, y) === "#" && pred(R.x, y)) out.push([R.x, y, 90, "w"]);
    if (g.get(R.x + R.w, y) === "#" && pred(R.x + R.w - 1, y)) out.push([R.x + R.w - 1, y, 270, "e"]);
  }
  return out;
}

// wall torch on a wall-adjacent floor cell near the middle of a wall
function wallTorch(g, R, preset = "torch", label = null) {
  const spots = wallSpots(g, R);
  if (!spots.length) return null;
  const cx = R.x + R.w / 2;
  const cy = R.y + R.h / 2;
  // prefer the middle of the longer walls
  spots.sort((a, b) => {
    const da = a[3] === "n" || a[3] === "s" ? Math.abs(a[0] + 0.5 - cx) : Math.abs(a[1] + 0.5 - cy);
    const db = b[3] === "n" || b[3] === "s" ? Math.abs(b[0] + 0.5 - cx) : Math.abs(b[1] + 0.5 - cy);
    return da - db + (g.rng.next() - 0.5) * 2;
  });
  const [x, y, rot] = spots[0];
  const o = g.add("torch", x, y, 1, 1, { rot, label });
  if (o) g.light(x, y, preset, o);
  return o;
}

// best-candidate (Mitchell) sampling of n well-spread points inside a box
function spreadPoints(rng, n, x0, y0, x1, y1, tries = 14, existing = []) {
  const pts = existing.slice();
  const out = [];
  for (let k = 0; k < n; k++) {
    let best = null;
    let bd = -1;
    for (let t = 0; t < tries; t++) {
      const p = [rng.float(x0, x1), rng.float(y0, y1)];
      let d = Infinity;
      for (const q of pts) d = Math.min(d, Math.hypot(p[0] - q[0], p[1] - q[1]));
      if (d > bd) {
        bd = d;
        best = p;
      }
    }
    pts.push(best);
    out.push(best);
  }
  return out;
}

// outdoor ground: base + noise patches
function paintGround(g, base, patches = []) {
  g.fill(base);
  for (const p of patches) {
    const n = noiseField(g.rng, g.w, g.h, p.scale || 5, 2);
    for (let i = 0; i < g.t.length; i++) if (n[i] > 1 - p.frac && (!p.on || p.on.includes(g.t[i]))) g.t[i] = p.c;
  }
}

// an enclosed rectangular building with walls; interior floor char; returns interior rect
function building(g, x, y, w, h, floorCh = "=") {
  g.rect(x, y, w, h, "#");
  g.rect(x + 1, y + 1, w - 2, h - 2, floorCh);
  return { x: x + 1, y: y + 1, w: w - 2, h: h - 2 };
}

// a table with chairs around it; returns true if placed
function tableSet(g, x, y, tw, th, chairs = true, props = {}) {
  // check that table + chair ring fits
  for (let yy = y - 1; yy <= y + th; yy++) {
    for (let xx = x - 1; xx <= x + tw; xx++) {
      if (!g.free(xx, yy) || g.clear[g.i(xx, yy)]) return false;
    }
  }
  const t = g.add(props.kind || "table", x, y, tw, th, { label: props.label || null });
  if (!t) return false;
  if (!chairs) return true;
  const spots = [];
  if (tw >= th) {
    for (let xx = x; xx < x + tw; xx++) {
      spots.push([xx, y - 1, 180]);
      spots.push([xx, y + th, 0]);
    }
    if (tw <= 2) {
      spots.push([x - 1, y, 90]);
      spots.push([x + tw, y, 270]);
    }
  } else {
    for (let yy = y; yy < y + th; yy++) {
      spots.push([x - 1, yy, 90]);
      spots.push([x + tw, yy, 270]);
    }
  }
  const p = props.chairChance ?? 0.75;
  let n = 0;
  for (const [cx, cy, rot] of spots) if (g.rng.chance(p) && g.add(props.chair || "chair", cx, cy, 1, 1, { rot })) n++;
  if (!n && spots.length) g.add(props.chair || "chair", spots[0][0], spots[0][1], 1, 1, { rot: spots[0][2] });
  return true;
}

// =================================================================================================================
// Theme: dungeon / crypt / sewer (BSP rooms + corridors)

function bspSplit(rng, node, minW, minH, depth, out) {
  const { w, h } = node;
  const canV = w >= minW * 2;
  const canH = h >= minH * 2;
  const small = w <= minW * 1.7 && h <= minH * 1.7;
  if ((!canV && !canH) || depth > 6 || (small && rng.chance(0.5)) || (depth > 1 && rng.chance(0.08))) {
    out.push(node);
    return node;
  }
  let vertical;
  if (canV && !canH) vertical = true;
  else if (canH && !canV) vertical = false;
  else vertical = w / h > 1.15 ? true : h / w > 1.15 ? false : rng.chance(0.5);
  if (vertical) {
    const s = rng.int(minW, w - minW);
    node.a = bspSplit(rng, { x: node.x, y: node.y, w: s, h }, minW, minH, depth + 1, out);
    node.b = bspSplit(rng, { x: node.x + s, y: node.y, w: w - s, h }, minW, minH, depth + 1, out);
  } else {
    const s = rng.int(minH, h - minH);
    node.a = bspSplit(rng, { x: node.x, y: node.y, w, h: s }, minW, minH, depth + 1, out);
    node.b = bspSplit(rng, { x: node.x, y: node.y + s, w, h: h - s }, minW, minH, depth + 1, out);
  }
  node.vertical = vertical;
  return node;
}

function roomsOf(node) {
  if (!node.a) return node.room ? [node.room] : [];
  return roomsOf(node.a).concat(roomsOf(node.b));
}

function carveCorridor(g, pts, mark) {
  for (let k = 0; k + 1 < pts.length; k++) {
    let [x, y] = pts[k];
    const [bx, by] = pts[k + 1];
    const sx = Math.sign(bx - x);
    const sy = Math.sign(by - y);
    for (;;) {
      if (g.get(x, y) === "#") {
        g.set(x, y, g.floor);
        mark[g.i(x, y)] = 1;
      }
      if (x === bx && y === by) break;
      x += sx;
      y += sy;
    }
  }
}

// corridor between room A (left/top) and room B (right/bottom)
function connectPair(g, A, B, vertical, mark) {
  const rng = g.rng;
  if (vertical) {
    const lo = Math.max(A.y, B.y);
    const hi = Math.min(A.y + A.h - 1, B.y + B.h - 1);
    const xa = A.x + A.w;
    const xb = B.x - 1;
    if (hi - lo >= 0) {
      const y = rng.int(lo, hi);
      carveCorridor(g, [[xa, y], [xb, y]], mark);
    } else {
      const ya = rng.int(A.y, A.y + A.h - 1);
      const yb = rng.int(B.y, B.y + B.h - 1);
      const xm = xa + 1 <= xb - 1 ? rng.int(xa + 1, xb - 1) : Math.round((xa + xb) / 2);
      carveCorridor(g, [[xa, ya], [xm, ya], [xm, yb], [xb, yb]], mark);
    }
  } else {
    const lo = Math.max(A.x, B.x);
    const hi = Math.min(A.x + A.w - 1, B.x + B.w - 1);
    const ya = A.y + A.h;
    const yb = B.y - 1;
    if (hi - lo >= 0) {
      const x = rng.int(lo, hi);
      carveCorridor(g, [[x, ya], [x, yb]], mark);
    } else {
      const xa = rng.int(A.x, A.x + A.w - 1);
      const xb = rng.int(B.x, B.x + B.w - 1);
      const ym = ya + 1 <= yb - 1 ? rng.int(ya + 1, yb - 1) : Math.round((ya + yb) / 2);
      carveCorridor(g, [[xa, ya], [xa, ym], [xb, ym], [xb, yb]], mark);
    }
  }
}

function connectTree(g, node, mark) {
  if (!node.a) return;
  connectTree(g, node.a, mark);
  connectTree(g, node.b, mark);
  const ra = roomsOf(node.a);
  const rb = roomsOf(node.b);
  let best = null;
  let bd = Infinity;
  for (const A of ra) {
    for (const B of rb) {
      const d = Math.abs(A.cx - B.cx) + Math.abs(A.cy - B.cy) + g.rng.float(0, 3);
      if (d < bd) {
        bd = d;
        best = [A, B];
      }
    }
  }
  if (best) {
    connectPair(g, best[0], best[1], node.vertical, mark);
    best[0].links.add(best[1]);
    best[1].links.add(best[0]);
  }
}

// openings of a room: ring cells that are floor
function roomOpenings(g, R) {
  const out = [];
  for (let x = R.x; x < R.x + R.w; x++) {
    if (g.isWalk(x, R.y - 1)) out.push([x, R.y - 1, "n"]);
    if (g.isWalk(x, R.y + R.h)) out.push([x, R.y + R.h, "s"]);
  }
  for (let y = R.y; y < R.y + R.h; y++) {
    if (g.isWalk(R.x - 1, y)) out.push([R.x - 1, y, "w"]);
    if (g.isWalk(R.x + R.w, y)) out.push([R.x + R.w, y, "e"]);
  }
  return out;
}

function isDoorway(g, x, y, side) {
  if (side === "n" || side === "s") return g.get(x - 1, y) === "#" && g.get(x + 1, y) === "#" && g.isWalk(x, y - 1) && g.isWalk(x, y + 1);
  return g.get(x, y - 1) === "#" && g.get(x, y + 1) === "#" && g.isWalk(x - 1, y) && g.isWalk(x + 1, y);
}

const DUNGEON_ROLES = ["guard", "barracks", "storage", "shrine", "library", "prison", "collapsed", "pillared", "well", "flooded", "armory", "kitchen", "empty", "storage", "guard"];
const CRYPT_ROLES = ["burial", "ossuary", "burial", "shrine", "pillared", "collapsed", "webbed", "burial", "ossuary"];
const SEWER_ROLES = ["cistern", "storage", "flooded", "collapsed", "lair", "empty"];
const ROLE_NAMES = {
  entry: "Entry hall", guard: "Guard room", barracks: "Barracks", storage: "Storeroom", shrine: "Shrine",
  library: "Library", prison: "Prison cells", collapsed: "Collapsed chamber", pillared: "Pillared hall",
  well: "Well room", flooded: "Flooded chamber", armory: "Armoury", kitchen: "Kitchen", empty: "Empty chamber",
  boss: "Inner sanctum", burial: "Burial chamber", ossuary: "Ossuary", webbed: "Web-choked chamber",
  tomb: "Tomb of the Ancient", cistern: "Cistern", lair: "Refuse heap", vault: "Hidden vault",
};

function decorateRoom(g, R, role, variant) {
  const rng = g.rng;
  const inner = (pred) => g.cells(R.x, R.y, R.w, R.h, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)] && (!pred || pred(x, y)));
  const notEdge = (x, y) => x > R.x && x < R.x + R.w - 1 && y > R.y && y < R.y + R.h - 1;
  const along = wallSpots(g, R);
  const big = R.w * R.h >= 30;
  switch (role) {
    case "entry": {
      const spots = wallSpots(g, R);
      const s = spots.find(([x, y]) => g.free(x, y)) || [R.x, R.y];
      g.add("stairs_up", s[0], s[1], 1, 1, { rot: s[2], label: "Stairs up (entrance)" });
      g.anchors.party.push([s[0], s[1]]);
      g.scatter("barrel", rng.int(0, 2), along.map(([x, y]) => [x, y]));
      break;
    }
    case "guard": {
      const tx = R.x + Math.floor(R.w / 2) - 1;
      const ty = R.y + Math.floor(R.h / 2);
      tableSet(g, tx, ty, R.w >= 6 ? 2 : 1, 1, true) || tableSet(g, tx, ty - 1, 1, 1, true);
      g.scatter("weapon_rack", 1, along.map(([x, y]) => [x, y]), (x, y) => ({ rot: (along.find((a) => a[0] === x && a[1] === y) || [0, 0, 0])[2] }));
      g.scatter("barrel", rng.int(1, 2), along.map(([x, y]) => [x, y]));
      break;
    }
    case "barracks": {
      const beds = along.filter(([, , , s]) => s === "n" || s === "s");
      let n = 0;
      for (const [x, y, rot, s] of beds) {
        if ((x - R.x) % 2 === 0 && g.add("bed", x, s === "n" ? y : y - 1, 1, 2, { rot })) n++;
        if (n >= 6) break;
      }
      g.scatter("chest", rng.int(1, 2), along.map(([x, y]) => [x, y]));
      break;
    }
    case "storage": {
      const spots = along.map(([x, y]) => [x, y]);
      g.scatter("crate", rng.int(3, 6), spots);
      g.scatter("barrel", rng.int(2, 4), spots);
      g.scatter("sack", rng.int(1, 3), inner());
      break;
    }
    case "shrine": {
      const top = along.filter((a) => a[3] === "n");
      const s = top[Math.floor(top.length / 2)] || along[0];
      if (s) {
        const alt = g.add("altar", s[0], s[1], 1, 1, { rot: 180, label: variant === "crypt" ? "Altar of the dead" : "Defiled altar" });
        if (alt) {
          g.anchors.npc.push([s[0], s[1] + 1]);
          for (const dx of [-2, 2]) {
            const b = g.add("brazier", s[0] + dx, s[1] + 1, 1, 1);
            if (b) g.light(b.x, b.y, "brazier", b);
          }
        }
      }
      g.scatter("statue", R.w > 5 ? 2 : 0, along.filter((a) => a[3] === "w" || a[3] === "e").map(([x, y]) => [x, y]));
      break;
    }
    case "library": {
      for (const [x, y, rot, s] of along) if ((s === "n" || s === "w" || s === "e") && rng.chance(0.75)) g.add("bookshelf", x, y, 1, 1, { rot });
      tableSet(g, R.x + Math.floor(R.w / 2), R.y + Math.floor(R.h / 2), 1, 1, true, { chairChance: 0.5 });
      break;
    }
    case "prison": {
      // a row of cages / bones and chains
      g.scatter("cage", Math.min(3, Math.floor(R.w / 2)), along.filter((a) => a[3] === "n").map(([x, y]) => [x, y]));
      g.scatter("bones", rng.int(2, 4), inner());
      for (const c of g.objs.filter((o) => o.kind === "cage" && o.x >= R.x && o.x < R.x + R.w && o.y >= R.y && o.y < R.y + R.h)) g.anchors.npc.push([c.x, c.y + 1]);
      break;
    }
    case "collapsed": {
      const n = noiseField(rng, R.w, R.h, 3, 2);
      for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) if (n[y * R.w + x] > 0.55 && !g.clear[g.i(R.x + x, R.y + y)]) g.set(R.x + x, R.y + y, "%");
      g.scatter("rubble", rng.int(2, 4), inner());
      g.scatter("boulder", rng.int(0, 2), inner(notEdge));
      break;
    }
    case "pillared": {
      if (R.w >= 5 && R.h >= 5) {
        const sx = R.w >= 9 ? 3 : 2;
        const sy = R.h >= 9 ? 3 : 2;
        for (let y = R.y + 1; y < R.y + R.h - 1; y += sy) for (let x = R.x + 1; x < R.x + R.w - 1; x += sx) g.add("pillar", x, y);
      }
      break;
    }
    case "well": {
      const cx = R.x + Math.floor(R.w / 2);
      const cy = R.y + Math.floor(R.h / 2);
      g.add("well", cx, cy, 1, 1, { label: "Old well" });
      g.scatter("bones", 1, inner());
      break;
    }
    case "flooded": {
      const n = noiseField(rng, R.w, R.h, 3, 2);
      for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) if (n[y * R.w + x] > 0.35) g.set(R.x + x, R.y + y, n[y * R.w + x] > 0.88 && big ? "w" : "~");
      break;
    }
    case "armory": {
      for (const [x, y, rot] of along) if (rng.chance(0.4)) g.add("weapon_rack", x, y, 1, 1, { rot });
      g.scatter("chest", 1, inner());
      g.add("anvil", R.x + Math.floor(R.w / 2), R.y + Math.floor(R.h / 2));
      break;
    }
    case "kitchen": {
      const spots = along.filter((a) => a[3] === "n");
      if (spots.length >= 2) {
        const f = g.add("fireplace", spots[0][0], spots[0][1], 1, 1, { rot: 180, label: "Cooking hearth" });
        if (f) g.light(f.x, f.y, "hearth", f);
      }
      g.add("cauldron", R.x + Math.floor(R.w / 2), R.y + Math.floor(R.h / 2));
      g.scatter("barrel", 2, along.map(([x, y]) => [x, y]));
      g.scatter("sack", 2, inner());
      break;
    }
    case "boss": {
      const top = along.filter((a) => a[3] === "n");
      const s = top[Math.floor(top.length / 2)] || along[0];
      if (s) {
        const kind = variant === "dungeon" && rng.chance(0.5) ? "throne" : "altar";
        const o = g.add(kind, s[0], s[1], 1, 1, { rot: 180, label: kind === "throne" ? "Crude throne" : "Blood-stained altar" });
        if (o) {
          g.anchors.enemy.push([s[0], Math.min(R.y + R.h - 1, s[1] + 2)]);
          for (const dx of [-1, 1]) {
            const b = g.add("brazier", s[0] + dx * 2, s[1], 1, 1);
            if (b) g.light(b.x, b.y, "brazier", b);
          }
        }
      }
      g.scatter("chest", 1, along.map(([x, y]) => [x, y]));
      g.scatter("bones", rng.int(1, 3), inner());
      if (R.w >= 7 && R.h >= 6) {
        g.add("pillar", R.x + 1, R.y + R.h - 2);
        g.add("pillar", R.x + R.w - 2, R.y + R.h - 2);
      }
      break;
    }
    case "burial": {
      // rows of sarcophagi
      const horiz = R.w >= R.h;
      if (horiz) {
        for (let x = R.x + 1; x + 1 < R.x + R.w; x += 3) {
          for (let y = R.y + 1; y + 1 < R.y + R.h; y += 3) g.add("sarcophagus", x, y, 1, 2, { rot: 0 });
        }
      } else {
        for (let y = R.y + 1; y + 1 < R.y + R.h; y += 3) {
          for (let x = R.x + 1; x + 1 < R.x + R.w; x += 3) g.add("sarcophagus", x, y, 2, 1, { rot: 90 });
        }
      }
      g.scatter("bones", rng.int(0, 2), inner());
      break;
    }
    case "ossuary": {
      for (const [x, y, rot] of along) if (rng.chance(0.45)) g.add(rng.chance(0.6) ? "coffin" : "bones", x, y, 1, 1, { rot });
      g.scatter("bones", rng.int(2, 5), inner());
      break;
    }
    case "tomb": {
      const cx = R.x + Math.floor(R.w / 2);
      const cy = R.y + Math.floor(R.h / 2) - 1;
      const s = g.add("sarcophagus", cx, cy, 1, 2, { label: "Sarcophagus of the Ancient", rot: 0 });
      if (s) g.anchors.enemy.push([cx, cy + 2]);
      for (const [dx, dy] of [[-2, -1], [2, -1], [-2, 2], [2, 2]]) {
        const b = g.add(Math.abs(dy) === 1 ? "brazier" : "statue", cx + dx, cy + dy);
        if (b && b.kind === "brazier") g.light(b.x, b.y, "brazier", b);
      }
      g.scatter("chest", 1, along.map(([x, y]) => [x, y]));
      break;
    }
    case "webbed": {
      g.scatter("web", rng.int(4, 8), inner());
      g.scatter("bones", rng.int(1, 3), inner());
      break;
    }
    case "cistern": {
      const cx = R.x + R.w / 2;
      const cy = R.y + R.h / 2;
      g.disc(cx, cy, Math.min(R.w, R.h) / 2 - 0.6, "~", (c) => c === g.floor);
      g.disc(cx, cy, Math.min(R.w, R.h) / 2 - 1.8, "w", (c) => c === "~");
      break;
    }
    case "lair": {
      g.scatter("bones", rng.int(3, 6), inner());
      g.scatter("sack", rng.int(1, 3), inner());
      g.scatter("crate", 1, along.map(([x, y]) => [x, y]));
      break;
    }
    case "vault": {
      g.scatter("chest", rng.int(1, 3), along.map(([x, y]) => [x, y]));
      g.scatter("statue", 1, along.map(([x, y]) => [x, y]));
      break;
    }
    default:
      g.scatter("bones", rng.int(0, 2), inner());
  }
}

function genRooms(g, variant) {
  const rng = g.rng;
  const { F } = g;
  g.fill("#");
  g.floor = ".";
  const minW = g.w >= 36 ? 8 : 7;
  const minH = g.h >= 26 ? 7 : 6;
  const leaves = [];
  const root = bspSplit(rng, { x: 0, y: 0, w: g.w, h: g.h }, minW, minH, 0, leaves);
  const rooms = [];
  for (const L of leaves) {
    const maxW = L.w - 2;
    const maxH = L.h - 2;
    const rw = rng.int(Math.max(3, Math.min(maxW, Math.floor(L.w * 0.62))), maxW);
    const rh = rng.int(Math.max(3, Math.min(maxH, Math.floor(L.h * 0.62))), maxH);
    const rx = L.x + 1 + rng.int(0, maxW - rw);
    const ry = L.y + 1 + rng.int(0, maxH - rh);
    const R = { x: rx, y: ry, w: rw, h: rh, cx: rx + rw / 2, cy: ry + rh / 2, links: new Set(), role: null };
    L.room = R;
    rooms.push(R);
    const floorCh = variant === "crypt" && rw * rh >= 35 ? "_" : g.floor;
    g.rect(rx, ry, rw, rh, floorCh);
  }
  const mark = new Uint8Array(g.w * g.h);
  connectTree(g, root, mark);
  // a couple of extra loops for tactical flanking
  const extra = rooms.length >= 5 ? rng.int(1, 2) : rooms.length >= 3 ? 1 : 0;
  for (let k = 0; k < extra; k++) {
    const A = rng.pick(rooms);
    const cands = rooms.filter((B) => B !== A && !A.links.has(B)).sort((p, q) => Math.hypot(p.cx - A.cx, p.cy - A.cy) - Math.hypot(q.cx - A.cx, q.cy - A.cy));
    const B = cands[0];
    if (!B) continue;
    const dx = Math.max(0, B.x - (A.x + A.w), A.x - (B.x + B.w));
    const dy = Math.max(0, B.y - (A.y + A.h), A.y - (B.y + B.h));
    if (dx >= dy) {
      if (A.x < B.x) connectPair(g, A, B, true, mark);
      else connectPair(g, B, A, true, mark);
    } else if (A.y < B.y) connectPair(g, A, B, false, mark);
    else connectPair(g, B, A, false, mark);
    A.links.add(B);
    B.links.add(A);
  }

  // sewer: water channel down the corridors
  if (variant === "sewer") {
    for (let i = 0; i < mark.length; i++) if (mark[i] && rng.chance(0.85)) g.t[i] = "~";
  }

  // doors
  const doorP = variant === "crypt" ? 0.7 : variant === "sewer" ? 0.25 : 0.65;
  for (const R of rooms) {
    for (const [x, y, side] of roomOpenings(g, R)) {
      if (g.get(x, y) === "+") continue;
      const nearDoor = DIR8.some(([dx, dy]) => g.get(x + dx, y + dy) === "+");
      if (isDoorway(g, x, y, side) && !nearDoor && rng.chance(doorP)) g.addDoor(x, y, { open: rng.chance(0.2) });
      // keep the floor just inside openings clear
      const ix = side === "w" ? x + 1 : side === "e" ? x - 1 : x;
      const iy = side === "n" ? y + 1 : side === "s" ? y - 1 : y;
      if (g.inb(ix, iy)) g.clear[g.i(ix, iy)] = 1;
      g.clear[g.i(x, y)] = 1;
    }
  }
  for (let i = 0; i < mark.length; i++) if (mark[i]) g.clear[i] = 1;

  // roles: entry = west-most room, boss = farthest from it
  const entry = rooms.slice().sort((a, b) => a.cx - b.cx + (a.cy - b.cy) * 0.15)[0];
  entry.role = "entry";
  const dist = bfsTiles(g, [[Math.floor(entry.cx), Math.floor(entry.cy)]]);
  let boss = null;
  let bd = -1;
  for (const R of rooms) {
    if (R === entry) continue;
    const d = dist[g.i(Math.floor(R.cx), Math.floor(R.cy))];
    const score = (d < 0 ? 0 : d) + R.w * R.h * 0.15;
    if (score > bd) {
      bd = score;
      boss = R;
    }
  }
  if (boss) boss.role = variant === "crypt" ? "tomb" : variant === "sewer" ? "lair" : "boss";
  const roles = rng.shuffle((variant === "crypt" ? CRYPT_ROLES : variant === "sewer" ? SEWER_ROLES : DUNGEON_ROLES).slice());
  if (F.has("prison", "cell", "jail")) roles.unshift("prison");
  if (F.has("library", "book")) roles.unshift("library");
  if (F.has("shrine", "altar")) {
    roles.unshift("shrine");
    g.used.add("altar");
  }
  if (F.has("well")) {
    roles.unshift("well");
    g.used.add("well");
  }
  let ri = 0;
  for (const R of rooms) if (!R.role) R.role = roles[ri++ % roles.length];
  // big rooms are more fun with pillars
  for (const R of rooms) if (!["entry", "boss", "tomb", "shrine", "well", "prison", "library"].includes(R.role) && R.w * R.h >= 48 && rng.chance(0.5)) R.role = variant === "crypt" ? "burial" : "pillared";

  // secret vault: a dead-end room with a single doorway
  const wantSecret = F.has("secret") || rng.chance(variant === "crypt" ? 0.5 : 0.3);
  if (wantSecret) {
    const cand = rooms.filter((R) => R !== entry && R !== boss && R.w * R.h <= 30 && roomOpenings(g, R).length === 1);
    const V = cand[0];
    if (V) {
      const [x, y, side] = roomOpenings(g, V)[0];
      if (isDoorway(g, x, y, side)) {
        g.addDoor(x, y, { secret: true, open: false });
        V.role = "vault";
        g.used.add("secret");
      }
    }
  }

  for (const R of rooms) {
    decorateRoom(g, R, R.role, variant);
    // general clutter so big rooms never feel empty
    if (R.role !== "vault" && R.w * R.h >= 24) {
      const clutter = variant === "crypt" ? ["bones", "rubble", "coffin", "web"] : variant === "sewer" ? ["rubble", "bones", "crate", "barrel"] : ["crate", "barrel", "bones", "rubble", "sack", "chest"];
      const spots = g.cells(R.x, R.y, R.w, R.h, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
      const nearWall = spots.filter(([x, y]) => g.count(x, y, (c) => c === "#", DIR4) >= 1);
      const n = Math.min(4, Math.floor((R.w * R.h) / 24) + rng.int(0, 1));
      for (let k = 0; k < n; k++) g.scatter(rng.pick(clutter), 1, rng.chance(0.7) ? nearWall : spots);
      if (variant !== "crypt" && R.w * R.h >= 40 && rng.chance(0.35)) {
        const nz = noiseField(rng, R.w, R.h, 2.5, 1);
        for (let y = 0; y < R.h; y++) for (let x = 0; x < R.w; x++) if (nz[y * R.w + x] > 0.88 && g.free(R.x + x, R.y + y) && g.get(R.x + x, R.y + y) === g.floor) g.set(R.x + x, R.y + y, "%");
      }
    }
    g.region(ROLE_NAMES[R.role] || "Chamber", R.x, R.y, R.w, R.h);
    const torchP = variant === "crypt" ? 0.35 : variant === "sewer" ? 0.3 : 0.75;
    if (R.role !== "vault" && (R.role === "entry" || R.role === "boss" || rng.chance(torchP))) {
      wallTorch(g, R);
      if (R.w * R.h >= 40 && rng.chance(0.6)) wallTorch(g, R);
    }
  }
  // occasional corridor torches / clutter
  const corr = [];
  for (let i = 0; i < mark.length; i++) if (mark[i] && g.t[i] !== "+") corr.push([i % g.w, Math.floor(i / g.w)]);
  if (variant === "dungeon") {
    for (const [x, y] of rng.shuffle(corr).slice(0, Math.floor(corr.length / 25))) {
      const o = g.add("torch", x, y, 1, 1, {});
      if (o) g.light(x, y, "torch", o);
    }
  }
  if (variant !== "sewer") g.scatter("bones", rng.int(1, 3), corr);
  else g.scatter("rubble", rng.int(1, 3), corr.filter(([x, y]) => g.get(x, y) !== "~"));
  if (variant === "crypt") g.scatter("web", rng.int(2, 5), corr);

  if (boss) g.anchors.enemy.push([Math.floor(boss.cx), Math.floor(boss.cy)]);
  g.anchors.party.push([Math.floor(entry.cx), Math.floor(entry.cy)]);
  if (!g.anchors.npc.length) {
    const mid = rooms.filter((R) => R !== entry && R !== boss).sort((a, b) => Math.hypot(a.cx - g.w / 2, a.cy - g.h / 2) - Math.hypot(b.cx - g.w / 2, b.cy - g.h / 2))[0];
    if (mid) g.anchors.npc.push([Math.floor(mid.cx), Math.floor(mid.cy)]);
  }
  g.rooms = rooms;
}

// BFS over walkable tiles (ignores objects), returns Int32Array distances (-1 unreachable)
function bfsTiles(g, starts) {
  const dist = new Int32Array(g.w * g.h).fill(-1);
  const q = [];
  for (const [x, y] of starts) {
    if (!g.inb(x, y)) continue;
    dist[g.i(x, y)] = 0;
    q.push(g.i(x, y));
  }
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    const x = i % g.w;
    const y = (i - x) / g.w;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!g.inb(nx, ny)) continue;
      const j = g.i(nx, ny);
      if (dist[j] >= 0 || !WALK.has(g.t[j])) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  return dist;
}

// =================================================================================================================
// Theme: cave

function genCave(g) {
  // retry (deterministically) when the caverns came out too small for a fight
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) g.reset(g.rng.fork("cave" + attempt));
    genCaveOnce(g);
    let open = 0;
    for (const c of g.t) if (c !== "#") open++;
    if (open >= g.t.length * 0.34) return;
  }
}

function genCaveOnce(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.fill("#");
  g.floor = ".";
  const nCh = clamp(Math.round((w * h) / 105) + rng.int(-1, 1), 3, 11);
  const pts = spreadPoints(rng, nCh, 4, 3.5, w - 4, h - 3.5);
  // the mouth chamber hugs the west side
  pts.sort((a, b) => a[0] - b[0]);
  pts[0][0] = Math.min(pts[0][0], rng.float(4, 6));
  const base = Math.min(w, h);
  const chambers = pts.map(([cx, cy], k) => ({
    cx,
    cy,
    rx: clamp(rng.float(base * 0.11, base * 0.19), 2.6, 5.6),
    ry: clamp(rng.float(base * 0.09, base * 0.16), 2.2, 4.6),
    k,
  }));
  const nz = noiseField(rng, w, h, 3, 2);
  for (const C of chambers) {
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const dx = (x + 0.5 - C.cx) / C.rx;
        const dy = (y + 0.5 - C.cy) / C.ry;
        if (dx * dx + dy * dy < 0.75 + nz[y * w + x] * 0.55) g.set(x, y, ".");
      }
    }
  }
  // minimum spanning tree of chambers + an extra loop
  const inTree = [0];
  const edges = [];
  while (inTree.length < chambers.length) {
    let best = null;
    for (const a of inTree) {
      for (let b = 0; b < chambers.length; b++) {
        if (inTree.includes(b)) continue;
        const d = Math.hypot(chambers[a].cx - chambers[b].cx, chambers[a].cy - chambers[b].cy);
        if (!best || d < best[2]) best = [a, b, d];
      }
    }
    inTree.push(best[1]);
    edges.push(best);
  }
  if (chambers.length >= 4) {
    const a = rng.int(0, chambers.length - 1);
    let b = (a + 2 + rng.int(0, chambers.length - 3)) % chambers.length;
    if (b !== a) edges.push([a, b, 0]);
  }
  const tunnelMark = new Uint8Array(w * h);
  for (const [a, b] of edges) {
    const A = chambers[a];
    const B = chambers[b];
    const pts2 = g.meander(A.cx, A.cy, B.cx, B.cy, rng.float(1, 2.5), 1, true);
    g.stroke(pts2, rng.float(0.7, 1.15), ".", (c, x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1, tunnelMark);
  }
  // the cave mouth: a tunnel to the west edge
  const M = chambers[0];
  const my = clamp(Math.round(M.cy + rng.float(-2, 2)), 2, h - 3);
  g.stroke(g.meander(0, my, M.cx, M.cy, 1, 1, true), 1.25, ".", null, tunnelMark);
  // cellular automata smoothing (borders stay rock except the mouth)
  for (let it = 0; it < 2; it++) {
    const nt = g.t.slice();
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const walls = g.count(x, y, (c) => c === "#");
        const i = g.i(x, y);
        if (g.t[i] === "#" && walls <= 2) nt[i] = ".";
        else if (g.t[i] !== "#" && walls >= 6 && !tunnelMark[i]) nt[i] = "#";
      }
    }
    g.t = nt;
  }
  for (let y = 0; y < h; y++) {
    for (const x of [0, w - 1]) if (!(x === 0 && Math.abs(y - my) <= 1)) g.set(x, y, "#");
  }
  for (let x = 0; x < w; x++) {
    g.set(x, 0, "#");
    g.set(x, h - 1, "#");
  }
  for (const dy of [-1, 0, 1]) g.set(0, my + dy, ".");
  for (const dy of [-1, 0, 1]) g.set(1, my + dy, ".");
  g.anchors.party.push([0, my], [1, my]);

  // ground variety: scree near walls, gravel patches
  const n2 = noiseField(rng, w, h, 4, 2);
  const n3 = noiseField(rng, w, h, 5, 2);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = g.i(x, y);
      if (g.t[i] !== ".") continue;
      const walls = g.count(x, y, (c) => c === "#");
      if (walls >= 2 && n2[i] > 0.66 && !tunnelMark[i]) g.t[i] = "%";
      else if (n3[i] > 0.96) g.t[i] = ":";
    }
  }
  for (let i = 0; i < tunnelMark.length; i++) if (tunnelMark[i] && g.t[i] !== "#") g.clear[i] = 1;

  // chamber roles
  const dist = bfsTiles(g, [[1, my]]);
  const order = chambers.slice(1).sort((a, b) => dist[g.i(Math.floor(b.cx), Math.floor(b.cy))] - dist[g.i(Math.floor(a.cx), Math.floor(a.cy))]);
  const lair = order[0] || M;
  const rest = order.slice(1);
  const roles = new Map();
  roles.set(M, "mouth");
  roles.set(lair, "lair");
  const biggest = rest.slice().sort((a, b) => b.rx * b.ry - a.rx * a.ry)[0];
  const wantPool = F.has("pool", "pond", "lake", "water") || rng.chance(0.55);
  if (biggest && wantPool) roles.set(biggest, "pool");
  const pool2 = rest.filter((C) => !roles.has(C));
  rng.shuffle(pool2);
  const extraRoles = rng.shuffle(["mushroom", "crystal", "bones", "plain", "plain", "rubble"]);
  if (F.has("crystal")) extraRoles.unshift("crystal");
  if (F.has("mushroom", "fung")) extraRoles.unshift("mushroom");
  pool2.forEach((C, k) => roles.set(C, extraRoles[k % extraRoles.length]));

  const chamberCells = (C, pred) => g.cells(Math.floor(C.cx - C.rx), Math.floor(C.cy - C.ry), Math.ceil(C.rx * 2) + 1, Math.ceil(C.ry * 2) + 1, (x, y) => {
    const dx = (x + 0.5 - C.cx) / C.rx;
    const dy = (y + 0.5 - C.cy) / C.ry;
    return dx * dx + dy * dy < 1 && g.free(x, y) && !g.clear[g.i(x, y)] && (!pred || pred(x, y));
  });
  const open8 = (x, y) => g.count(x, y, (c) => c !== "#") === 8;

  for (const C of chambers) {
    const role = roles.get(C) || "plain";
    const label = { mouth: "Cave mouth", lair: "Bone-strewn lair", pool: "Pool cavern", mushroom: "Mushroom grotto", crystal: "Crystal grotto", bones: "Ossuary cave", rubble: "Collapsed cavern" }[role];
    g.region(label || "{dir} cavern", Math.round(C.cx - C.rx), Math.round(C.cy - C.ry), Math.round(C.rx * 2), Math.round(C.ry * 2));
    if (role === "pool") {
      const r = Math.min(C.rx, C.ry) * 0.62;
      g.disc(C.cx, C.cy, r + 1, "~", (c) => c !== "#");
      g.disc(C.cx, C.cy, r, "w", (c) => c !== "#");
      g.disc(C.cx, C.cy, r + 1.8, ":", (c) => c === "." || c === "%");
      g.used.add("pond");
      g.used.add("pool");
      g.anchors.npc.push([Math.floor(C.cx + r + 1.5), Math.floor(C.cy)]);
    } else if (role === "mushroom") {
      const ms = g.scatter("mushroom", rng.int(5, 9), chamberCells(C));
      for (const m of ms.slice(0, 2)) g.light(m.x, m.y, "fungus", m);
    } else if (role === "crystal") {
      const cs = g.scatter("crystal", rng.int(2, 4), chamberCells(C, (x, y) => g.count(x, y, (c) => c === "#") >= 2));
      for (const c of cs) {
        c.label = "Glowing crystal";
        g.light(c.x, c.y, "crystal", c);
      }
    } else if (role === "lair") {
      g.scatter("bones", rng.int(3, 6), chamberCells(C));
      g.scatter("sack", rng.int(1, 3), chamberCells(C));
      g.scatter("chest", 1, chamberCells(C, (x, y) => g.count(x, y, (c) => c === "#") >= 2));
      if (F.has("campfire", "fire") || rng.chance(0.5)) {
        const spot = chamberCells(C, open8).sort((a, b) => Math.hypot(a[0] - C.cx, a[1] - C.cy) - Math.hypot(b[0] - C.cx, b[1] - C.cy))[0];
        if (spot) {
          const f = g.add("campfire", spot[0], spot[1]);
          if (f) {
            g.light(f.x, f.y, "campfire", f);
            g.used.add("campfire");
          }
        }
      }
      g.anchors.enemy.push([Math.floor(C.cx), Math.floor(C.cy)]);
    } else if (role === "bones") {
      g.scatter("bones", rng.int(4, 7), chamberCells(C));
    } else if (role === "rubble") {
      g.scatter("rubble", rng.int(2, 4), chamberCells(C));
      g.scatter("boulder", rng.int(1, 3), chamberCells(C, open8));
    }
    // stalagmites in open floor
    g.scatter("stalagmite", Math.round((C.rx * C.ry) / 9) + rng.int(0, 1), chamberCells(C, open8));
  }
  if (F.has("web", "spider")) {
    g.scatter("web", rng.int(5, 9), g.cells(1, 1, w - 2, h - 2, (x, y) => g.free(x, y) && g.count(x, y, (c) => c === "#") >= 3));
    g.used.add("webs");
  }
  if (F.has("stream", "river", "waterfall")) {
    const x0 = rng.int(Math.floor(w * 0.35), Math.floor(w * 0.65));
    g.stroke(g.meander(x0, 0, x0 + rng.int(-4, 4), h - 1, 2.5, 1.2), F.has("river") ? 1.4 : 0.9, "~", (c, x, y) => y > 0 && y < h - 1 && x > 0 && x < w - 1);
    g.used.add("stream");
    g.used.add("river");
    if (F.has("waterfall")) {
      g.region("Underground waterfall", x0 - 2, 1, 5, 3);
      g.disc(x0 + 0.5, 2, 1.6, "w", (c) => c === "~");
      g.used.add("waterfall");
    }
  }
}

// =================================================================================================================
// Theme: forest

function genForest(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.floor = '"';
  paintGround(g, '"', [{ c: ",", frac: 0.04, scale: 2 }]);
  const protect = new Uint8Array(w * h);
  const dens = noiseField(rng, w, h, Math.max(5, Math.min(w, h) / 3.5), 3);
  const under = noiseField(rng, w, h, 3.5, 2);

  // clearings
  const clearings = [];
  const nClear = w * h > 900 ? 2 : 1 + (rng.chance(0.4) ? 1 : 0);
  for (let k = 0; k < nClear; k++) {
    const cx = k === 0 ? rng.float(w * 0.38, w * 0.62) : rng.chance(0.5) ? rng.float(w * 0.15, w * 0.3) : rng.float(w * 0.7, w * 0.85);
    const cy = rng.float(h * 0.3, h * 0.7);
    clearings.push({ cx, cy, r: rng.float(2.8, 4.5) * (Math.min(w, h) / 22) + 1 });
  }
  // path west -> east
  const ya = rng.float(h * 0.3, h * 0.7);
  const yb = rng.float(h * 0.3, h * 0.7);
  const pathPts = g.meander(-1, ya, w, yb, h * rng.float(0.08, 0.16), rng.float(0.6, 1.2));
  const pathMark = new Uint8Array(w * h);
  g.stroke(pathPts, 1.05, ",", null, pathMark);
  const nearPath = new Uint8Array(w * h);
  g.stroke(pathPts, 2.2, null, null, nearPath);
  for (let i = 0; i < w * h; i++) if (pathMark[i]) protect[i] = 1;
  g.region("Forest path", 0, Math.floor(Math.min(ya, yb)) - 1, w, Math.ceil(Math.abs(yb - ya)) + 3);

  // water
  const wantStream = F.has("stream", "river", "creek", "brook", "bridge", "ford", "waterfall") || rng.chance(0.35);
  let waterMark = new Uint8Array(w * h);
  if (wantStream) {
    const river = F.has("river");
    const xs = rng.float(w * 0.3, w * 0.7);
    const streamPts = g.meander(xs, -1, xs + rng.float(-w * 0.15, w * 0.15), h, w * 0.06, 1.2);
    g.stroke(streamPts, river ? 2.1 : 1.0, "~", null, waterMark);
    if (river) g.stroke(streamPts, 1.1, "w");
    // crossing: bridge (river or asked) or a gravel ford
    const bridge = river || F.has("bridge") || rng.chance(0.4);
    for (let i = 0; i < w * h; i++) {
      if (!waterMark[i]) continue;
      if (pathMark[i] || (bridge && nearPath[i] && pathMark[i])) g.t[i] = bridge ? "=" : ":";
    }
    if (bridge) {
      // widen the bridge deck over the whole channel along the path
      for (let i = 0; i < w * h; i++) if (waterMark[i] && pathMark[i]) g.t[i] = "=";
      g.used.add("bridge");
    }
    // stream banks
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (g.get(x, y) === '"' && g.count(x, y, (c) => c === "~" || c === "w", DIR4) && rng.chance(0.5)) g.set(x, y, ":");
    for (let i = 0; i < w * h; i++) if (waterMark[i]) protect[i] = 1;
    const mid = streamPts[Math.floor(streamPts.length / 2)];
    g.region(river ? "River" : "Stream", Math.round(mid[0]) - 2, 0, 5, h);
    g.used.add("stream");
    g.used.add("river");
    if (F.has("waterfall")) {
      const top = streamPts.find((p) => p[1] >= 0) || streamPts[0];
      const tx = Math.round(top[0]);
      for (let x = tx - 4; x <= tx + 4; x++) for (let y = 0; y <= 1; y++) if (g.get(x, y) !== "~" && g.get(x, y) !== "w") g.set(x, y, "#");
      g.disc(tx + 0.5, 2.5, 2, "w");
      g.region("Waterfall", tx - 3, 0, 7, 4);
      g.used.add("waterfall");
    }
  }
  if (F.has("pond", "lake", "pool") || rng.chance(0.2)) {
    const C = clearings[clearings.length - 1];
    const px = clamp(C.cx + rng.float(-2, 2), 4, w - 5);
    const py = clamp(C.cy + (C.cy < h / 2 ? C.r * 0.6 : -C.r * 0.6), 4, h - 5);
    const r = rng.float(1.6, 2.6);
    g.disc(px, py, r + 1.1, "~", (c, x, y) => !pathMark[g.i(x, y)]);
    g.disc(px, py, r, "w", (c, x, y) => !pathMark[g.i(x, y)]);
    g.region("Pond", Math.round(px - r - 1), Math.round(py - r - 1), Math.round(r * 2 + 2), Math.round(r * 2 + 2));
    for (let i = 0; i < w * h; i++) if (g.t[i] === "w" || g.t[i] === "~") protect[i] = 1;
    g.used.add("pond");
  }
  for (const C of clearings) g.region("Glade", Math.round(C.cx - C.r), Math.round(C.cy - C.r), Math.round(C.r * 2), Math.round(C.r * 2));

  // tree density
  const clearAt = (x, y) => {
    let v = 0;
    for (const C of clearings) v = Math.max(v, 1 - smooth(C.r * 0.75, C.r * 1.35, Math.hypot(x + 0.5 - C.cx, y + 0.5 - C.cy)));
    return v;
  };
  // undergrowth
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = g.i(x, y);
      if (protect[i] || nearPath[i] || g.t[i] === "~" || g.t[i] === "w") continue;
      if (dens[i] > 0.58 && under[i] > 0.42 && clearAt(x, y) < 0.3) g.t[i] = "%";
    }
  }
  const treeP = (x, y) => {
    const i = g.i(x, y);
    if (protect[i] || nearPath[i]) return 0;
    const edge = Math.min(y, h - 1 - y);
    let p = smooth(0.42, 0.78, dens[i]) * 0.6 + 0.04 + (edge <= 1 ? 0.25 : edge <= 2 ? 0.1 : 0);
    p *= 1 - clearAt(x, y);
    return p;
  };
  const cells = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && g.get(x, y) !== "~");
  rng.shuffle(cells);
  for (const [x, y] of cells) {
    if (!rng.chance(treeP(x, y))) continue;
    const orth = g.count(x, y, (c, xx, yy) => {
      const o = g.objAt(xx, yy);
      return o && o.kind === "tree";
    }, DIR4);
    if (orth >= 2) continue;
    // occasionally an ancient 2x2 tree in dense spots
    if (dens[g.i(x, y)] > 0.8 && rng.chance(0.12) && g.add("tree", x, y, 2, 2, { label: "Ancient oak" })) continue;
    g.add("tree", x, y);
  }
  // make sure it reads as a forest: top up the densest woods until ~18% of the map is trees
  const isTree = (xx, yy) => {
    const o = g.objAt(xx, yy);
    return !!o && o.kind === "tree";
  };
  let trees = 0;
  for (const o of g.objs) if (o.kind === "tree") trees += o.w * o.h;
  const target = Math.round(w * h * 0.18);
  if (trees < target) {
    const extra = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && g.get(x, y) !== "~" && treeP(x, y) > 0.02 && clearAt(x, y) < 0.2)
      .map(([x, y]) => [x, y, dens[g.i(x, y)] + rng.float(0, 0.25)])
      .sort((a, b) => b[2] - a[2]);
    for (const [x, y] of extra) {
      if (trees >= target) break;
      if (g.count(x, y, (c, xx, yy) => isTree(xx, yy), DIR4) >= 2) continue;
      if (g.add("tree", x, y)) {
        trees++;
        if (rng.chance(0.3) && g.get(x, y + 1) === '"') g.set(x, y + 1, "%");
      }
    }
  }
  // bushes along the edges of the woods and beside the path (ambush cover)
  const bushCells = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && !pathMark[g.i(x, y)] && g.get(x, y) !== "~" && g.count(x, y, (c, xx, yy) => !!g.objAt(xx, yy)) >= 1);
  g.scatter("bush", Math.round((w * h) / 45), bushCells);
  const besidePath = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && nearPath[g.i(x, y)] && !pathMark[g.i(x, y)] && g.get(x, y) !== "~");
  const ambush = g.scatter("bush", Math.round(w / 6), besidePath.filter(([x]) => x > w * 0.3 && x < w * 0.75));
  for (const b of ambush) g.anchors.hidden.push([b.x, b.y]);
  // logs and rocks
  const open = g.cells(1, 1, w - 2, h - 2, (x, y) => g.free(x, y) && !pathMark[g.i(x, y)] && g.get(x, y) !== "~");
  const nLogs = rng.int(1, 3);
  for (let k = 0, tries = 0; k < nLogs && tries < 40; tries++) {
    const [x, y] = rng.pick(open);
    if (rng.chance(0.5) ? g.add("log", x, y, 2, 1, { label: "Fallen log" }) : g.add("log", x, y, 1, 2, { label: "Fallen log", rot: 90 })) k++;
  }
  g.scatter(rng.chance(0.5) ? "boulder" : "rock", rng.int(1, 3), open);
  g.scatter("rock", rng.int(1, 3), open);
  if (F.has("mushroom", "fairy", "fey")) g.scatter("mushroom", rng.int(6, 10), open);

  // campfire in the main glade
  const C0 = clearings[0];
  if (F.has("campfire", "camp", "fire")) {
    placeCampfire(g, Math.floor(C0.cx), Math.floor(C0.cy));
    g.used.add("campfire");
  }
  g.anchors.npc.push([Math.floor(C0.cx), Math.floor(C0.cy)]);
  // party on the west end of the path, enemies at the east end / far glade
  const pw = pathPts.filter((p) => p[0] >= 0 && p[0] < 2);
  const pe = pathPts.filter((p) => p[0] > w - 3 && p[0] < w);
  if (pw.length) g.anchors.party.push([0, clamp(Math.round(pw[0][1]), 0, h - 1)]);
  if (pe.length) g.anchors.enemy.push([w - 1, clamp(Math.round(pe[pe.length - 1][1]), 0, h - 1)]);
  g.pathMark = pathMark;
}

function placeCampfire(g, cx, cy) {
  let spot = null;
  for (let r = 0; r < 6 && !spot; r++) {
    for (let dy = -r; dy <= r && !spot; dy++) {
      for (let dx = -r; dx <= r && !spot; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        let ok = true;
        for (let yy = y - 1; yy <= y + 1 && ok; yy++) for (let xx = x - 1; xx <= x + 1 && ok; xx++) ok = g.free(xx, yy) && g.get(xx, yy) !== "~";
        if (ok) spot = [x, y];
      }
    }
  }
  if (!spot) return null;
  const f = g.add("campfire", spot[0], spot[1], 1, 1, { label: "Campfire", force: true });
  if (!f) return null;
  g.light(f.x, f.y, "campfire", f);
  // log seats
  const seats = [[spot[0] - 2, spot[1], 1, 2, 90], [spot[0] + 2, spot[1] - 1, 1, 2, 90], [spot[0] - 1, spot[1] + 2, 2, 1, 0], [spot[0], spot[1] - 2, 2, 1, 0]];
  let n = 0;
  for (const [x, y, ww, hh, rot] of g.rng.shuffle(seats)) {
    if (n >= 3) break;
    if (g.add("log", x, y, ww, hh, { rot, label: "Log seat" })) n++;
  }
  return f;
}

// =================================================================================================================
// Theme: tavern

const TAVERN_ADJ = ["Gilded", "Drunken", "Rusty", "Sleeping", "Laughing", "Crooked", "Copper", "Salty", "Wandering", "Silver", "Prancing", "Jolly", "Broken", "Black", "Red", "Merry", "Thirsty", "Golden", "Howling", "Leaky"];
const TAVERN_NOUN = ["Flagon", "Dragon", "Goose", "Stag", "Barrel", "Griffin", "Lantern", "Boar", "Mermaid", "Anchor", "Tankard", "Wyvern", "Badger", "Horn", "Kettle", "Owl", "Hound", "Crown", "Rat", "Mare"];

function genTavern(g) {
  const rng = g.rng;
  const { w, h } = g;
  g.floor = "=";
  // exterior: street along the south, alleys around
  g.fill(",");
  const sd = h >= 20 ? 3 : 2;
  g.rect(0, h - sd, w, sd, "_");
  const mx0 = rng.int(0, w >= 30 ? 2 : 1);
  const mx1 = rng.int(0, w >= 30 ? 2 : 1);
  const bx0 = mx0;
  const bx1 = w - 1 - mx1;
  const by0 = rng.int(0, 1);
  const by1 = h - sd - 1;
  const R = building(g, bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1, "=");
  // back rooms strip
  const bd = clamp(Math.round(R.h * 0.3), 3, 6);
  const sepY = R.y + bd; // wall row
  g.rect(R.x, sepY, R.w, 1, "#");
  const common = { x: R.x, y: sepY + 1, w: R.w, h: R.y + R.h - sepY - 1 };
  // split the back strip: kitchen | storeroom | snug
  const kw = clamp(Math.round(R.w * rng.float(0.36, 0.46)), 4, 12);
  const sw = clamp(Math.round(R.w * rng.float(0.2, 0.28)), 3, 8);
  const kitchenLeft = rng.chance(0.5);
  const kx = kitchenLeft ? R.x : R.x + R.w - kw;
  const kitchen = { x: kx, y: R.y, w: kw, h: bd };
  let store;
  let snug;
  if (kitchenLeft) {
    g.rect(kx + kw, R.y, 1, bd, "#");
    store = { x: kx + kw + 1, y: R.y, w: sw, h: bd };
    g.rect(store.x + sw, R.y, 1, bd, "#");
    snug = { x: store.x + sw + 1, y: R.y, w: R.x + R.w - (store.x + sw + 1), h: bd };
  } else {
    g.rect(kx - 1, R.y, 1, bd, "#");
    store = { x: kx - 1 - sw, y: R.y, w: sw, h: bd };
    g.rect(store.x - 1, R.y, 1, bd, "#");
    snug = { x: R.x, y: R.y, w: store.x - 1 - R.x, h: bd };
  }
  // stone floors in the kitchen and storeroom
  g.rect(kitchen.x, kitchen.y, kitchen.w, kitchen.h, ".");
  g.rect(store.x, store.y, store.w, store.h, ".");

  // bar: counter in front of the kitchen, barkeep lane behind it
  const barY = sepY + 2 < common.y + common.h - 4 ? sepY + 3 : sepY + 2;
  const barX0 = kitchenLeft ? R.x : kx + 1;
  const barX1 = kitchenLeft ? kx + kw - 2 : R.x + R.w - 1;
  // counter flap: the end towards the room centre stays open
  const flapX = kitchenLeft ? barX1 : barX0;
  const counterX = kitchenLeft ? barX0 : barX0 + 1;
  const counterW = Math.max(3, barX1 - barX0);
  const bar = g.add("bar", counterX, barY, counterW, 1, { label: "Bar counter", force: true });
  // L-shaped return to the separator wall when the counter has an inner end at a wall
  for (let y = sepY + 1; y < barY; y++) g.clear[g.i(flapX, y)] = 1;
  g.clear[g.i(flapX, barY)] = 1;
  // door from the bar into the kitchen
  const kdx = kitchenLeft ? clamp(barX1 - 1, kitchen.x + 1, kitchen.x + kitchen.w - 1) : clamp(barX0 + 1, kitchen.x, kitchen.x + kitchen.w - 2);
  g.addDoor(kdx, sepY, { open: rng.chance(0.5) });
  // shelves and kegs behind the bar
  for (let x = barX0; x <= barX1; x++) {
    if (x === kdx || g.clear[g.i(x, sepY + 1)]) continue;
    if (barY - sepY >= 3) {
      if (rng.chance(0.55)) g.add("shelf", x, sepY + 1, 1, 1, { rot: 180 });
      else if (rng.chance(0.6)) g.add("barrel", x, sepY + 1, 1, 1, { label: "Keg" });
    }
  }
  for (let x = counterX; x < counterX + counterW; x += 2) g.add("stool", x, barY + 1, 1, 1, { rot: 0 });
  for (let x = barX0; x <= barX1; x++) g.anchors.npc.push([x, barY - 1]);
  g.region("Bar", barX0, sepY + 1, barX1 - barX0 + 1, barY - sepY + 1);
  if (bar) bar.rot = 0;

  // front door on the street side
  const fdx = rng.int(common.x + Math.floor(common.w * 0.3), common.x + Math.floor(common.w * 0.7));
  const dbl = common.w >= 18 && rng.chance(0.5);
  g.addDoor(fdx, by1, { open: rng.chance(0.3) });
  if (dbl) g.addDoor(fdx + 1, by1, { open: g.doorAt(fdx, by1).open });
  g.anchors.party.push([fdx, by1 + 1], [fdx, by1 + 2 < h ? by1 + 2 : by1 + 1]);
  // keep a lane from the door to the bar clear
  for (let y = barY + 1; y < by1; y++) for (let x = fdx - 1; x <= fdx + (dbl ? 2 : 1); x++) if (g.inb(x, y)) g.clear[g.i(x, y)] = 1;
  for (let x = common.x; x < common.x + common.w; x++) g.clear[g.i(x, barY + 1)] = 1;

  // fireplace on the side wall away from the bar
  const fireLeft = !kitchenLeft;
  const fy = clamp(Math.round(common.y + common.h * 0.55), common.y + 1, common.y + common.h - 3);
  const fxx = fireLeft ? common.x : common.x + common.w - 1;
  const fire = g.add("fireplace", fxx, fy, 1, 2, { rot: fireLeft ? 90 : 270, label: "Fireplace", force: true });
  if (fire) {
    g.light(fxx, fy, "fireplace", fire);
    const rx = fireLeft ? fxx + 1 : fxx - 2;
    g.add("rug", rx, fy, 2, 2, { label: "Bearskin rug" });
    for (const dy of [-1, 2]) g.add("chair", fireLeft ? fxx + 1 : fxx - 1, fy + dy, 1, 1, { rot: fireLeft ? 270 : 90, label: "Armchair" });
    g.anchors.npc.push([rx, fy], [rx + 1, fy + 1]);
    for (let y = fy - 1; y <= fy + 2; y++) for (let x = rx; x < rx + 2; x++) if (g.inb(x, y)) g.clear[g.i(x, y)] = 1;
  }
  // stairs up in the corner near the snug side
  const stx = fireLeft ? common.x + common.w - 1 : common.x;
  const sty = common.y + common.h - 2;
  g.add("stairs_up", stx, sty - 1, 1, 2, { rot: 0, label: "Stairs to the rooms", force: true });

  // support posts in very large common rooms
  if (common.w * common.h > 300) {
    for (let y = common.y + 4; y < common.y + common.h - 3; y += 6) {
      for (let x = common.x + 6; x < common.x + common.w - 5; x += 8) if (g.free(x, y) && !g.clear[g.i(x, y)]) g.add("pillar", x, y, 1, 1, { label: "Support post" });
    }
  }
  // tables: jittered grid over the common room
  const tables = [];
  const kinds = [[1, 1], [2, 1], [2, 1], [1, 1], [3, 1], [1, 2]];
  for (let y = common.y + 1; y < common.y + common.h - 1; y++) {
    for (let x = common.x + 1; x < common.x + common.w - 1; x++) {
      if (!rng.chance(0.55)) continue;
      const [tw, th] = rng.pick(kinds);
      // keep one free cell between table groups
      let ok = true;
      for (let yy = y - 2; yy <= y + th + 1 && ok; yy++) for (let xx = x - 2; xx <= x + tw + 1 && ok; xx++) {
        const o = g.objAt(xx, yy);
        if (o && (o.kind === "table" || o.kind === "chair")) ok = false;
      }
      if (!ok) continue;
      if (tableSet(g, x, y, tw, th, true)) tables.push([x, y]);
    }
  }
  // candles on a few tables
  for (const [x, y] of rng.shuffle(tables).slice(0, 3)) g.light(x, y, "candle");
  // lanterns on the common room walls
  wallTorch(g, common, "lantern", "Lantern");
  if (common.w >= 16) wallTorch(g, common, "lantern", "Lantern");

  // kitchen: hearth on the back wall, counters, barrels
  const kspots = wallSpots(g, kitchen);
  const hearthSpot = kspots.find((s) => s[3] === "n") || kspots[0];
  if (hearthSpot) {
    const hh = g.add("fireplace", hearthSpot[0], hearthSpot[1], 1, 1, { rot: 180, label: "Kitchen hearth" });
    if (hh) g.light(hh.x, hh.y, "hearth", hh);
    g.add("cauldron", hearthSpot[0], hearthSpot[1] + 1 < kitchen.y + kitchen.h ? hearthSpot[1] + 1 : hearthSpot[1]);
  }
  for (const [x, y, rot] of wallSpots(g, kitchen)) if (rng.chance(0.3)) g.add(rng.chance(0.5) ? "counter" : "barrel", x, y, 1, 1, { rot });
  if (kitchen.w >= 5 && kitchen.h >= 4) g.add("table", kitchen.x + Math.floor(kitchen.w / 2), kitchen.y + Math.floor(kitchen.h / 2), 1, 1, { label: "Chopping block" });
  // back door from the kitchen
  if (by0 > 0 || true) {
    const bdx = rng.int(kitchen.x + 1, kitchen.x + kitchen.w - 2);
    if (by0 > 0) g.addDoor(bdx, by0, {});
    else g.addDoor(kitchenLeft ? bx0 : bx1, rng.int(kitchen.y, kitchen.y + kitchen.h - 1), {});
  }
  // storeroom
  const sspots = wallSpots(g, store).map(([x, y]) => [x, y]);
  g.scatter("crate", rng.int(2, 4), sspots);
  g.scatter("barrel", rng.int(2, 4), sspots);
  g.scatter("sack", rng.int(1, 2), g.cells(store.x, store.y, store.w, store.h, (x, y) => g.free(x, y)));
  const tdx = store.x + Math.floor(store.w / 2);
  const tdy = store.y + Math.floor(store.h / 2);
  if (!g.objAt(tdx, tdy)) g.add("trapdoor", tdx, tdy, 1, 1, { label: "Cellar trapdoor" });
  // door storeroom <-> kitchen or common room
  g.addDoor(clamp(store.x + Math.floor(store.w / 2), store.x, store.x + store.w - 1), sepY, { locked: rng.chance(0.25) });
  // snug: private room off the common room
  if (snug.w >= 3) {
    g.addDoor(clamp(snug.x + Math.floor(snug.w / 2), snug.x, snug.x + snug.w - 1), sepY, {});
    tableSet(g, snug.x + Math.floor(snug.w / 2) - (snug.w >= 5 ? 1 : 0), snug.y + Math.floor(snug.h / 2), snug.w >= 5 ? 2 : 1, 1, true, { chairChance: 0.9 });
    const sl = wallTorch(g, snug, "candle", "Candle");
    if (!sl) g.light(snug.x, snug.y, "candle");
    g.anchors.hidden.push([snug.x + 1, snug.y + 1]);
    g.region("Private snug", snug.x, snug.y, snug.w, snug.h);
  }
  // outside: lamp by the door, barrels, a cart on the street
  const lamp = g.add("torch", Math.min(w - 1, fdx + (dbl ? 2 : 1) + 1), by1 + 1, 1, 1, { label: "Door lamp", rot: 180 });
  if (lamp && g.night) g.light(lamp.x, lamp.y, "lantern", lamp);
  g.scatter("barrel", rng.int(1, 3), g.cells(0, by1 + 1, w, 1, (x, y) => g.free(x, y) && Math.abs(x - fdx) > 3));
  if (w >= 26 && rng.chance(0.6)) {
    const cx = rng.chance(0.5) ? rng.int(1, Math.max(1, fdx - 6)) : rng.int(Math.min(w - 4, fdx + 4), w - 4);
    g.add("cart", cx, h - 2, 2, 1, { label: "Hitched cart" });
  }

  g.region("Common room", common.x, common.y, common.w, common.h);
  g.region("Kitchen", kitchen.x, kitchen.y, kitchen.w, kitchen.h);
  g.region("Storeroom", store.x, store.y, store.w, store.h);
  g.region("Street", 0, h - sd, w, sd);
  // enemies: the far corner of the common room from the door
  const far = [fdx < common.x + common.w / 2 ? common.x + common.w - 2 : common.x + 1, common.y + Math.floor(common.h * 0.3)];
  g.anchors.enemy.push(far);
  g.anchors.hidden.push([store.x + 1, store.y + 1]);
  g.name = `The ${rng.pick(TAVERN_ADJ)} ${rng.pick(TAVERN_NOUN)}`;
}

// =================================================================================================================
// Theme: street (town street between building blocks)

const SHOP_NAMES = ["Smithy", "Bakery", "Warehouse", "Apothecary", "Townhouse", "Chandlery", "Cobbler", "Tailor", "Butcher", "Pawnshop", "Moneylender", "Cooper", "Fletcher", "Tannery"];

function decorateShop(g, R, name) {
  const rng = g.rng;
  const spots = wallSpots(g, R);
  const inner = g.cells(R.x, R.y, R.w, R.h, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
  if (name === "Smithy") {
    const f = g.scatter("forge", 1, spots.map(([x, y]) => [x, y]), { label: "Forge" });
    for (const o of f) g.light(o.x, o.y, "forge", o);
    g.scatter("anvil", 1, inner);
    g.scatter("weapon_rack", 1, spots.map(([x, y]) => [x, y]));
  } else if (name === "Warehouse") {
    g.scatter("crate", Math.round(inner.length * 0.35), inner);
    g.scatter("barrel", 2, inner);
  } else if (name === "Townhouse" || name === "Moneylender") {
    tableSet(g, R.x + Math.floor(R.w / 2) - 1, R.y + Math.floor(R.h / 2), 2, 1, true) || g.scatter("table", 1, inner);
    g.scatter(rng.chance(0.5) ? "bookshelf" : "shelf", 2, spots.map(([x, y]) => [x, y]));
    g.scatter("chest", 1, spots.map(([x, y]) => [x, y]));
  } else {
    // shop: counter across the room, shelves on the back wall
    const back = spots.filter((s) => s[3] === "n" || s[3] === "s");
    for (const [x, y, rot] of back) if (rng.chance(0.6)) g.add("shelf", x, y, 1, 1, { rot });
    g.scatter("counter", 1, inner, { label: "Shop counter" }, Math.max(1, Math.min(3, R.w - 2)), 1);
    g.scatter(rng.chance(0.5) ? "barrel" : "crate", rng.int(1, 2), inner);
  }
}

function genStreet(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.indoorFloor = true;
  g.floor = "_";
  g.fill(",");
  const sw = clamp(Math.round(h * 0.24), 3, 6);
  const sy0 = clamp(Math.round(h / 2 - sw / 2) + rng.int(-1, 1), 3, h - sw - 3);
  const sy1 = sy0 + sw - 1;
  g.rect(0, sy0, w, sw, "_");
  for (let x = 0; x < w; x++) for (let y = sy0; y <= sy1; y++) g.clear[g.i(x, y)] = y === sy0 || y === sy1 ? 0 : 1;
  g.region("Main street", 0, sy0, w, sw);
  // side street
  let cross = null;
  if (F.has("crossroad", "intersection", "corner") || rng.chance(0.45)) {
    const cw = rng.int(2, 3);
    const cx = rng.int(Math.floor(w * 0.25), Math.floor(w * 0.7) - cw);
    const north = rng.chance(0.6);
    const south = !north || rng.chance(0.4);
    if (north) g.rect(cx, 0, cw, sy0, "_");
    if (south) g.rect(cx, sy1 + 1, cw, h - sy1 - 1, "_");
    cross = { x: cx, w: cw, north, south };
    g.region("Side street", cx, north ? 0 : sy1 + 1, cw, north && south ? h : north ? sy0 : h - sy1 - 1);
  }
  // plaza
  const market = F.has("market", "bazaar", "stall", "fair", "square", "plaza");
  let plaza = null;
  if (market || rng.chance(0.45)) {
    const pw = clamp(Math.round(w * 0.3), 6, 14);
    const ph = clamp(rng.int(2, 4), 2, Math.min(sy0, h - sy1 - 1) - 1);
    let px = rng.int(Math.floor(w * 0.25), Math.max(Math.floor(w * 0.25), Math.floor(w * 0.72) - pw));
    if (cross && px < cross.x + cross.w + 1 && px + pw > cross.x - 1) px = cross.x + cross.w + 1 + pw < w - 2 ? cross.x + cross.w + 1 : Math.max(1, cross.x - pw - 1);
    const top = rng.chance(0.5);
    const py = top ? sy0 - ph : sy1 + 1;
    g.rect(px, py, pw, ph, "_");
    plaza = { x: px, w: pw, top, y0: top ? py : sy0, y1: top ? sy1 : py + ph - 1 };
    g.region(market ? "Market square" : "Plaza", px, plaza.y0, pw, plaza.y1 - plaza.y0 + 1);
  }
  const blocked = (x, top) => {
    if (cross && x >= cross.x - 1 && x <= cross.x + cross.w && (top ? cross.north : cross.south)) return true;
    return false;
  };
  const names = rng.shuffle(SHOP_NAMES.slice());
  let ni = 0;
  const doorsOut = [];
  for (const top of [true, false]) {
    let x = rng.int(0, 1);
    while (x < w - 3) {
      if (blocked(x, top)) {
        x++;
        continue;
      }
      let lw = rng.int(5, 9);
      lw = Math.min(lw, w - x);
      // don't run into the side street
      for (let k = 0; k < lw; k++) if (blocked(x + k, top)) {
        lw = k;
        break;
      }
      if (lw < 4) {
        x += Math.max(1, lw + 1);
        continue;
      }
      // depth: from the street front to near the map edge, shortened behind a plaza
      const inPlaza = plaza && plaza.top === top && x < plaza.x + plaza.w && x + lw > plaza.x;
      const frontY = top ? (inPlaza ? plaza.y0 - 1 : sy0 - 1) : inPlaza ? plaza.y1 + 1 : sy1 + 1;
      const back = rng.chance(0.4) ? rng.int(1, 2) : 0;
      const by0 = top ? back : frontY;
      const by1 = top ? frontY : h - 1 - back;
      const bh = by1 - by0 + 1;
      if (bh < 3) {
        x += lw + 1;
        continue;
      }
      const R = building(g, x, by0, lw, bh, rng.chance(0.3) ? "." : "=");
      const name = names[ni++ % names.length];
      if (R.w >= 2 && R.h >= 1 && rng.chance(0.75)) {
        const dx = rng.int(x + 1, x + lw - 2);
        g.addDoor(dx, frontY, { locked: rng.chance(0.2) });
        doorsOut.push([dx, top ? frontY + 1 : frontY - 1]);
        decorateShop(g, R, name);
        g.region(name, R.x, R.y, R.w, R.h);
      } else {
        g.rect(R.x, R.y, R.w, R.h, "#"); // closed-up building: solid block
      }
      const gap = rng.chance(0.35) ? rng.int(1, 2) : 0;
      x += lw + gap;
    }
  }
  // alleys: dirt gaps between buildings
  for (let x = 0; x < w; x++) {
    for (const top of [true, false]) {
      const y = top ? sy0 - 1 : sy1 + 1;
      if (g.get(x, y) === ",") g.anchors.hidden.push([x, top ? y - 1 : y + 1]);
    }
  }
  // street clutter against the building fronts
  const fronts = g.cells(0, 0, w, h, (x, y) => g.get(x, y) === "_" && g.free(x, y) && !g.clear[g.i(x, y)] && g.count(x, y, (c) => c === "#", DIR4) >= 1);
  g.scatter("crate", rng.int(3, 6), fronts);
  g.scatter("barrel", rng.int(3, 5), fronts);
  g.scatter("sack", rng.int(0, 2), fronts);
  {
    const cs = fronts.filter(([x, y]) => g.free(x + 1, y) && !g.clear[g.i(Math.min(w - 1, x + 1), y)]);
    const c = rng.pick(cs);
    if (c) {
      const over = F.has("overturn", "wreck");
      g.add("cart", c[0], c[1], 2, 1, { label: over ? "Overturned cart" : "Hand cart", blocksSight: over });
      g.used.add("cart");
    }
  }
  // plaza: well / fountain / market stalls
  if (plaza) {
    const pcx = plaza.x + Math.floor(plaza.w / 2);
    const pcy = Math.floor((plaza.y0 + plaza.y1) / 2);
    const kind = F.has("fountain") ? "fountain" : F.has("well") ? "well" : rng.chance(0.5) ? "well" : "fountain";
    g.add(kind, pcx, pcy, 1, 1, { label: kind === "well" ? "Town well" : "Fountain", force: true });
    g.used.add(kind);
    g.anchors.npc.push([pcx, pcy + 1], [pcx, pcy - 1]);
    if (market) {
      const rowY = plaza.top ? plaza.y0 : plaza.y1;
      for (let x = plaza.x + 1; x + 1 < plaza.x + plaza.w - 1; x += 3) {
        if (g.add("table", x, rowY, 2, 1, { label: "Market stall" })) {
          g.anchors.npc.push([x, rowY + (plaza.top ? 1 : -1)]);
          g.scatter(rng.chance(0.5) ? "crate" : "sack", 1, [[x + 2, rowY]]);
        }
      }
      g.used.add("market");
    }
  } else if (F.has("well", "fountain")) {
    const kind = F.has("fountain") ? "fountain" : "well";
    g.add(kind, Math.floor(w / 2), sy0 + Math.floor(sw / 2), 1, 1, { label: kind === "well" ? "Town well" : "Fountain", force: true });
    g.used.add(kind);
  }
  // street lamps
  for (const top of [true, false]) {
    const y = top ? sy0 : sy1;
    for (let x = rng.int(2, 5); x < w - 1; x += rng.int(6, 9)) {
      if (!g.free(x, y)) continue;
      const o = g.add("torch", x, y, 1, 1, { label: "Street lamp", rot: top ? 180 : 0 });
      if (o && g.night) g.light(x, y, "lamp", o);
    }
  }
  if (!g.anchors.npc.length && doorsOut.length) g.anchors.npc.push(rng.pick(doorsOut));
  const mid = sy0 + Math.floor(sw / 2);
  g.anchors.party.push([0, mid], [0, mid + 1]);
  g.anchors.enemy.push([w - 1, mid]);
}

// =================================================================================================================
// Theme: road (wilderness road)

function genRoad(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.floor = '"';
  paintGround(g, '"', [{ c: ",", frac: 0.07, scale: 4 }, { c: "%", frac: 0.035, scale: 3 }]);
  const ya = rng.float(h * 0.35, h * 0.65);
  const yb = rng.float(h * 0.35, h * 0.65);
  const pts = g.meander(-1, ya, w, yb, h * 0.09, rng.float(0.5, 1));
  const road = new Uint8Array(w * h);
  const near = new Uint8Array(w * h);
  g.stroke(pts, 1.5, ",", null, road);
  g.stroke(pts, 3.2, null, null, near);
  for (let i = 0; i < w * h; i++) if (road[i]) {
    g.clear[i] = 1;
    if (rng.chance(0.1)) g.t[i] = ":";
  }
  g.region("Road", 0, Math.floor(Math.min(ya, yb)) - 1, w, Math.ceil(Math.abs(yb - ya)) + 3);
  const roadY = (x) => {
    let best = null;
    for (const p of pts) if (!best || Math.abs(p[0] - x) < Math.abs(best[0] - x)) best = p;
    return best ? best[1] : h / 2;
  };
  if (F.has("crossroad", "junction", "fork") || rng.chance(0.2)) {
    const xm = rng.float(w * 0.4, w * 0.6);
    const up = rng.chance(0.5);
    const p2 = g.meander(xm, roadY(xm), xm + rng.float(-4, 4), up ? -1 : h, 2, 0.8);
    g.stroke(p2, 1.1, ",", null, road);
    for (let i = 0; i < w * h; i++) if (road[i]) g.clear[i] = 1;
    g.add("signpost", Math.round(xm) + 2, Math.round(roadY(xm)) + (up ? 2 : -2), 1, 1, { label: "Signpost", blocksMove: true, blocksSight: false, cover: null });
    g.region("Crossroads", Math.round(xm) - 3, Math.round(roadY(xm)) - 3, 7, 7);
    g.used.add("crossroads");
  }
  const side = rng.chance(0.5) ? -1 : 1;
  // rocky outcrop on one side of the road
  const ox = rng.float(w * 0.4, w * 0.65);
  const oy = clamp(roadY(ox) + side * rng.float(5, 7), 2, h - 3);
  const nz = noiseField(rng, w, h, 2.5, 2);
  const orad = rng.float(1.8, 2.8) * Math.min(1.3, Math.min(w, h) / 22);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot((x + 0.5 - ox) / 1.4, y + 0.5 - oy);
      const i = g.i(x, y);
      if (near[i]) continue;
      if (d < orad * (0.75 + nz[i] * 0.5)) g.t[i] = "#";
      else if (d < orad + 1.6 && nz[i] > 0.4) g.t[i] = "%";
    }
  }
  const aroundRock = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && !near[g.i(x, y)] && Math.hypot(x - ox, y - oy) < orad + 3.5);
  g.scatter("boulder", rng.int(2, 4), aroundRock);
  g.region("Rocky outcrop", Math.round(ox - orad * 1.4) - 1, Math.round(oy - orad) - 1, Math.round(orad * 2.8) + 2, Math.round(orad * 2) + 2);
  // copse of trees on the other side
  const tx = rng.float(w * 0.25, w * 0.75);
  const ty = clamp(roadY(tx) - side * rng.float(5, 7), 2, h - 3);
  const trad = rng.float(2.5, 4);
  const copse = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && !near[g.i(x, y)] && Math.hypot(x - tx, (y - ty) * 1.2) < trad);
  for (const [x, y] of rng.shuffle(copse)) {
    if (rng.chance(0.45) && g.count(x, y, (c, xx, yy) => !!g.objAt(xx, yy) && g.objAt(xx, yy).kind === "tree", DIR4) < 2) g.add("tree", x, y);
    else if (rng.chance(0.25)) g.set(x, y, "%");
  }
  g.region("Copse", Math.round(tx - trad), Math.round(ty - trad), Math.round(trad * 2), Math.round(trad * 2));
  // roadside bushes (ambush cover), lone trees, rocks
  const roadside = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && near[g.i(x, y)] && !road[g.i(x, y)] && x > w * 0.3 && x < w * 0.8);
  for (const b of g.scatter("bush", rng.int(4, 8), roadside)) g.anchors.hidden.push([b.x, b.y]);
  const open = g.cells(1, 1, w - 2, h - 2, (x, y) => g.free(x, y) && !near[g.i(x, y)]);
  g.scatter("tree", rng.int(3, 6), open);
  g.scatter("bush", rng.int(3, 6), open);
  g.scatter("rock", rng.int(2, 4), open);
  const mx = Math.round(w * rng.float(0.15, 0.3));
  g.add("rock", mx, Math.round(roadY(mx)) + (side > 0 ? -2 : 2), 1, 1, { label: "Milestone" });
  // overturned cart
  if (F.has("cart", "wagon", "caravan", "overturn", "merchant") || rng.chance(0.45)) {
    const cx = Math.round(w * rng.float(0.45, 0.6));
    const cy = Math.round(roadY(cx));
    const over = F.has("overturn", "wreck", "ambush") || !F.has("cart", "wagon") || rng.chance(0.6);
    const c = g.add("cart", cx, cy, 2, 1, { label: over ? "Overturned cart" : "Merchant wagon", rot: over ? 90 : 0, blocksSight: over, cover: over ? "three-quarters" : "half", force: true });
    if (c) {
      const around = g.cells(cx - 2, cy - 2, 6, 5, (x, y) => g.free(x, y));
      g.scatter("crate", rng.int(1, 3), around);
      g.scatter("sack", rng.int(1, 2), around);
      g.scatter("barrel", 1, around);
      if (over) g.scatter("bones", 1, around, { label: "Dead horse" });
      g.anchors.npc.push([cx, cy + 1], [cx + 1, cy - 1]);
      g.region(over ? "Wrecked cart" : "Wagon", cx - 2, cy - 2, 6, 5);
      g.used.add("cart");
    }
  }
  g.anchors.party.push([0, Math.round(ya)]);
  g.anchors.enemy.push([w - 1, Math.round(yb)], [Math.round(ox), Math.round(oy)]);
  if (!g.anchors.npc.length) g.anchors.npc.push([Math.round(w / 2), Math.round(roadY(w / 2))]);
}

// =================================================================================================================
// Theme: swamp

function genSwamp(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.floor = "%";
  const n = noiseField(rng, w, h, Math.max(4, Math.min(w, h) / 4), 3);
  const n2 = noiseField(rng, w, h, 3, 2);
  for (let i = 0; i < w * h; i++) {
    const v = n[i];
    g.t[i] = v < 0.2 ? "w" : v < 0.38 ? "~" : v < 0.69 ? "%" : n2[i] > 0.62 ? "," : '"';
  }
  // the witch's hut on the driest ground in the east half
  let best = null;
  for (let y = 3; y < h - 7; y++) {
    for (let x = Math.floor(w * 0.55); x < w - 7; x++) {
      let s = 0;
      for (let yy = y; yy < y + 5; yy++) for (let xx = x; xx < x + 6; xx++) s += n[g.i(xx, yy)];
      if (!best || s > best[2]) best = [x, y, s];
    }
  }
  let hutDoor = null;
  if (best) {
    const [hx, hy] = best;
    g.rect(hx - 1, hy - 1, 8, 7, ",");
    const R = building(g, hx, hy, 6, 5, "=");
    const dy = hy + 2;
    g.addDoor(hx, dy, {});
    hutDoor = [hx - 1, dy];
    const cauldron = g.add("cauldron", R.x + Math.floor(R.w / 2), R.y + 1, 1, 1, { label: "Bubbling cauldron" });
    if (cauldron) g.light(cauldron.x, cauldron.y, "hearth", cauldron);
    g.scatter("shelf", 2, wallSpots(g, R).map(([x, y]) => [x, y]));
    g.scatter("bed", 1, wallSpots(g, R).map(([x, y]) => [x, y]));
    g.region(rng.chance(0.5) ? "Witch's hut" : "Stilt shack", hx, hy, 6, 5);
    g.anchors.enemy.push([hx - 1, dy]);
    g.anchors.npc.push([R.x + 1, R.y + R.h - 1]);
  }
  // boardwalk: west edge -> hut (or east edge)
  const ya = rng.float(h * 0.3, h * 0.7);
  const target = hutDoor || [w, rng.float(h * 0.3, h * 0.7)];
  const pts = g.meander(-1, ya, target[0] + 0.5, target[1] + 0.5, h * 0.12, 1, !!hutDoor);
  const walk = new Uint8Array(w * h);
  g.stroke(pts, 0.62, "=", (c) => c !== "#" && c !== "+", walk);
  for (let i = 0; i < w * h; i++) if (walk[i]) g.clear[i] = 1;
  // a second walkway branch to the far edge
  if (hutDoor) {
    const k = Math.floor(pts.length * rng.float(0.45, 0.7));
    const [bx, by] = pts[k];
    const p2 = g.meander(bx, by, w, rng.float(h * 0.2, h * 0.8), 2, 1);
    g.stroke(p2, 0.55, "=", (c) => c !== "#" && c !== "+", walk);
  }
  g.region("Boardwalk", 0, Math.round(ya) - 1, Math.round(w * 0.5), 3);
  // dead trees, reeds, logs, mushrooms
  const land = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && !walk[g.i(x, y)] && ['"', ",", "%"].includes(g.get(x, y)));
  const dead = g.scatter("tree", Math.round(land.length * 0.05), land, { label: "Dead tree" });
  for (const t of dead) t.variant = "dead";
  g.scatter("tree", Math.round(land.length * 0.02), land.filter(([x, y]) => g.get(x, y) !== "%"));
  const shallows = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && g.get(x, y) === "~" && g.count(x, y, (c) => c === "%" || c === '"' || c === ",") >= 2);
  for (const r of g.scatter("bush", Math.round(shallows.length * 0.18), shallows, { label: "Reeds" })) if (r.x > w * 0.3 && r.x < w * 0.75) g.anchors.hidden.push([r.x, r.y]);
  g.scatter("log", rng.int(2, 3), land, { label: "Rotting log" });
  g.scatter("mushroom", rng.int(3, 6), land);
  if (F.has("statue", "idol", "shrine")) {
    g.scatter(F.has("idol") ? "idol" : "statue", 1, land.filter(([x]) => Math.abs(x - w / 2) < w * 0.2), { label: "Sunken idol" });
    g.used.add("statue");
  }
  // name the deepest water
  let deep = null;
  for (let i = 0; i < w * h; i++) if (g.t[i] === "w" && (!deep || n[i] < n[deep])) deep = i;
  if (deep !== null) g.region("Black water", (deep % w) - 2, Math.floor(deep / w) - 2, 5, 5);
  g.anchors.party.push([0, Math.round(ya)]);
  if (!hutDoor) g.anchors.enemy.push([w - 1, Math.round(target[1])]);
  g.used.add("pond");
}

// =================================================================================================================
// Theme: camp (bandit camp)

function genCamp(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.floor = ",";
  paintGround(g, '"', [{ c: ",", frac: 0.08, scale: 4 }]);
  const cx = w * rng.float(0.52, 0.6);
  const cy = h * rng.float(0.45, 0.55);
  const rx = clamp(w * 0.3, 5.5, 13);
  const ry = clamp(h * 0.33, 4.5, 10);
  const dE = (x, y) => ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
  const nz = noiseField(rng, w, h, 3, 2);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dE(x, y) < 1) g.set(x, y, nz[g.i(x, y)] > 0.8 ? '"' : ",");
  // approach path from the west edge to the gate
  const gateY = Math.round(cy);
  const gateX = Math.floor(cx - rx);
  const approach = g.meander(-1, clamp(gateY + rng.int(-3, 3), 1, h - 2), gateX + 1, gateY + 0.5, 1.5, 0.8, true);
  const pathMark = new Uint8Array(w * h);
  g.stroke(approach, 0.9, ",", null, pathMark);
  for (let i = 0; i < w * h; i++) if (pathMark[i]) g.clear[i] = 1;
  const palisade = F.has("palisade", "stockade", "fort", "wall") || rng.chance(0.65);
  const ring = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (dE(x, y) < 1) continue;
      if (DIR4.some(([dx, dy]) => g.inb(x + dx, y + dy) && dE(x + dx, y + dy) < 1)) ring.push([x, y]);
    }
  }
  const backGate = rng.chance(0.4);
  for (const [x, y] of ring) {
    const isGate = x < cx && Math.abs(y - gateY) <= 1 && x <= gateX + 1;
    const isBack = backGate && x > cx && Math.abs(y + 0.5 - cy) <= 1;
    if (isGate || isBack) {
      g.clear[g.i(x, y)] = 1;
      continue;
    }
    if (palisade) g.add("palisade", x, y, 1, 1, { label: null });
    else if (rng.chance(0.3)) g.add("fence", x, y);
  }
  // gate torches
  for (const dy of [-2, 2]) {
    const gx = ring.filter(([x, y]) => y === gateY + dy && x < cx).sort((a, b) => a[0] - b[0])[0];
    if (gx) {
      const ix = gx[0] + 1;
      const t = g.add("torch", ix, gx[1], 1, 1, { label: "Gate torch", rot: 270 });
      if (t && (g.night || palisade)) g.light(ix, gx[1], "torch", t);
    }
  }
  // camp interior
  const fire = placeCampfire(g, Math.round(cx), Math.round(cy));
  g.used.add("campfire");
  if (fire) g.anchors.enemy.push([fire.x + 1, fire.y + 1], [fire.x - 1, fire.y - 1]);
  const nt = clamp(Math.round((rx * ry) / 10), 3, 7);
  const tents = [];
  for (let k = 0; k < nt; k++) {
    // spread around the fire, leaving the gate side (west) open
    const a = -Math.PI * 0.62 + (k / Math.max(1, nt - 1)) * Math.PI * 1.24 + rng.float(-0.15, 0.15);
    const big = k === Math.floor(nt / 2);
    const tw = big ? 3 : 2;
    const th = 2;
    const tx0 = Math.round(cx + Math.cos(a) * rx * 0.62 - tw / 2);
    const ty0 = Math.round(cy + Math.sin(a) * ry * 0.62 - th / 2);
    for (const [ox, oy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const t = g.add("tent", tx0 + ox, ty0 + oy, tw, th, { label: big ? "Leader's tent" : "Tent", rot: Math.round(((a * 180) / Math.PI + 270) % 360) });
      if (t) {
        tents.push(t);
        if (big) {
          g.region("Leader's tent", t.x, t.y, tw, th);
          g.scatter("chest", 1, g.cells(t.x - 1, t.y - 1, tw + 2, th + 2, (x, y) => g.free(x, y)));
          g.anchors.enemy.push([t.x, t.y + th]);
        }
        break;
      }
    }
  }
  const inside = (pred) => g.cells(0, 0, w, h, (x, y) => dE(x, y) < 0.85 && g.free(x, y) && !g.clear[g.i(x, y)] && (!pred || pred(x, y)));
  const pileC = inside((x, y) => dE(x, y) > 0.45);
  const pile = rng.pick(pileC);
  if (pile) {
    const near = g.cells(pile[0] - 2, pile[1] - 2, 5, 5, (x, y) => g.free(x, y) && dE(x, y) < 0.9);
    g.scatter("crate", rng.int(2, 4), near);
    g.scatter("barrel", rng.int(1, 3), near);
    g.scatter("sack", rng.int(1, 3), near);
    g.region("Supply pile", pile[0] - 2, pile[1] - 2, 5, 5);
  }
  g.scatter("weapon_rack", 1, inside((x, y) => dE(x, y) < 0.4));
  if (fire) g.scatter("cauldron", 1, g.cells(fire.x - 2, fire.y - 2, 5, 5, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]), { label: "Stew pot" });
  if (F.has("cage", "prisoner", "captive", "slave", "hostage") || rng.chance(0.5)) {
    const c = g.scatter("cage", 1, inside((x, y) => dE(x, y) > 0.35 && dE(x, y) < 0.75), { label: "Prisoner cage" });
    if (c[0]) {
      g.anchors.npc.push([c[0].x, c[0].y + 1], [c[0].x + 1, c[0].y]);
      g.used.add("cage");
    }
  }
  g.scatter("bedroll", rng.int(1, 3), inside(), { label: "Bedroll", blocksMove: false, cover: null });
  g.region(palisade ? "Palisade camp" : "Camp", Math.round(cx - rx), Math.round(cy - ry), Math.round(rx * 2), Math.round(ry * 2));
  g.region("Gate", gateX - 1, gateY - 2, 3, 5);
  // woods around the camp
  const dens = noiseField(rng, w, h, 4, 2);
  const outside = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && dE(x, y) > 1.35 && !pathMark[g.i(x, y)]);
  for (const [x, y] of rng.shuffle(outside)) {
    const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
    const p = smooth(0.35, 0.85, dens[g.i(x, y)]) * 0.45 + (edge <= 1 ? 0.2 : 0);
    if (rng.chance(p) && g.count(x, y, (c, xx, yy) => !!g.objAt(xx, yy) && g.objAt(xx, yy).kind === "tree", DIR4) < 2) g.add("tree", x, y);
    else if (rng.chance(0.06)) g.add("bush", x, y);
    else if (dens[g.i(x, y)] > 0.7 && rng.chance(0.3)) g.set(x, y, "%");
  }
  g.anchors.party.push([0, Math.round(approach[0][1])]);
  // ambushers lurk outside the walls on the flanks
  g.anchors.hidden.push([Math.round(cx), Math.max(0, Math.round(cy - ry - 2))], [Math.round(cx), Math.min(h - 1, Math.round(cy + ry + 2))]);
  if (!g.anchors.npc.length && fire) g.anchors.npc.push([fire.x, fire.y + 2]);
}

// =================================================================================================================
// Theme: ruins

function genRuins(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.floor = "_";
  paintGround(g, '"', [{ c: ",", frac: 0.1, scale: 4 }, { c: "%", frac: 0.05, scale: 3 }]);
  const n = clamp(Math.round((w * h) / 170), 2, 6);
  const ruins = [];
  for (let tries = 0; ruins.length < n && tries < 200; tries++) {
    const big = ruins.length === 0;
    const rw = rng.int(big ? Math.round(w * 0.3) : 5, big ? Math.round(w * 0.42) : Math.max(6, Math.round(w * 0.25)));
    const rh = rng.int(big ? Math.round(h * 0.38) : 4, big ? Math.round(h * 0.5) : Math.max(5, Math.round(h * 0.32)));
    const x = big ? rng.int(Math.round(w * 0.45), w - rw - 2) : rng.int(2, w - rw - 2);
    const y = rng.int(2, h - rh - 2);
    if (ruins.some((R) => x < R.x + R.w + 2 && x + rw + 2 > R.x && y < R.y + R.h + 2 && y + rh + 2 > R.y)) continue;
    ruins.push({ x, y, w: rw, h: rh, big });
  }
  const nz = noiseField(rng, w, h, 2.5, 2);
  ruins.forEach((R, k) => {
    // floor
    for (let y = R.y + 1; y < R.y + R.h - 1; y++) {
      for (let x = R.x + 1; x < R.x + R.w - 1; x++) {
        const v = nz[g.i(x, y)];
        g.set(x, y, v > 0.82 ? "%" : v > 0.62 ? '"' : "_");
      }
    }
    // walls with collapsed runs
    const per = [];
    for (let x = R.x; x < R.x + R.w; x++) per.push([x, R.y]);
    for (let y = R.y + 1; y < R.y + R.h; y++) per.push([R.x + R.w - 1, y]);
    for (let x = R.x + R.w - 2; x >= R.x; x--) per.push([x, R.y + R.h - 1]);
    for (let y = R.y + R.h - 2; y > R.y; y--) per.push([R.x, y]);
    let i = rng.int(0, per.length - 1);
    let standing = true;
    let left = rng.int(2, 6);
    let gaps = 0;
    for (let k2 = 0; k2 < per.length; k2++, i = (i + 1) % per.length) {
      const [x, y] = per[i];
      if (standing) g.set(x, y, "#");
      else {
        gaps++;
        const r = rng.next();
        if (r < 0.35) g.set(x, y, "%");
        else if (r < 0.7) {
          g.set(x, y, '"');
          g.add("ruin_wall", x, y, 1, 1, { label: null });
        } else g.set(x, y, rng.chance(0.5) ? '"' : ",");
      }
      if (--left <= 0) {
        standing = !standing;
        left = standing ? rng.int(2, 6) : rng.int(1, 3);
      }
    }
    if (!gaps) {
      const [x, y] = per[Math.floor(per.length / 2)];
      g.set(x, y, "%");
    }
    const inner = { x: R.x + 1, y: R.y + 1, w: R.w - 2, h: R.h - 2 };
    if (R.big) {
      // colonnade: two rows of pillars, some fallen
      if (inner.h >= 5 && inner.w >= 5) {
        for (let x = inner.x + 1; x < inner.x + inner.w - 1; x += 2) {
          for (const y of [inner.y + 1, inner.y + inner.h - 2]) {
            if (rng.chance(0.7)) g.add("pillar", x, y, 1, 1, { label: null });
            else g.add("rubble", x, y, 1, 1, { label: "Fallen pillar" });
          }
        }
      }
      const kind = F.has("altar") ? "altar" : rng.chance(0.5) ? "statue" : "altar";
      const s = g.add(kind, inner.x + Math.floor(inner.w / 2), inner.y + Math.floor(inner.h / 2), 1, 1, { label: kind === "altar" ? "Cracked altar" : "Headless statue" });
      if (s) {
        g.anchors.npc.push([s.x, s.y + 1]);
        g.used.add(kind);
      }
      g.region("Ruined hall", R.x, R.y, R.w, R.h);
      g.anchors.enemy.push([inner.x + Math.floor(inner.w / 2), inner.y + Math.floor(inner.h / 2) + 1]);
      if (F.has("stairs", "crypt", "cellar", "below")) g.scatter("stairs_down", 1, g.cells(inner.x, inner.y, inner.w, inner.h, (x, y) => g.free(x, y)), { label: "Steps into darkness" });
    } else {
      g.region(rng.pick(["Collapsed house", "Old chapel", "Broken tower", "Roofless barracks", "Fallen shrine"]), R.x, R.y, R.w, R.h);
      g.scatter("rubble", rng.int(1, 3), g.cells(inner.x, inner.y, inner.w, inner.h, (x, y) => g.free(x, y)));
      if (rng.chance(0.4)) g.scatter("chest", 1, g.cells(inner.x, inner.y, inner.w, inner.h, (x, y) => g.free(x, y)), { label: "Rotted chest" });
    }
  });
  // free-standing colonnade remnant
  if (w >= 24) {
    const y = rng.int(3, h - 4);
    const x0 = rng.int(2, Math.round(w * 0.35));
    for (let x = x0; x < x0 + rng.int(6, 10); x += 2) if (g.free(x, y)) g.add(rng.chance(0.75) ? "pillar" : "rubble", x, y);
  }
  const open = g.cells(1, 1, w - 2, h - 2, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
  g.scatter("tree", rng.int(4, Math.round((w * h) / 70)), open);
  g.scatter("bush", rng.int(5, Math.round((w * h) / 55)), open);
  g.scatter("rubble", rng.int(3, 6), open);
  g.scatter("boulder", rng.int(1, 3), open);
  if (F.has("statue") && !g.used.has("statue")) {
    g.scatter("statue", 1, open.filter(([x, y]) => Math.hypot(x - w / 2, y - h / 2) < 5), { label: "Weathered statue" });
    g.used.add("statue");
  }
  g.anchors.party.push([0, Math.floor(h / 2)]);
}

// =================================================================================================================
// Theme: temple (canonical: tall, entrance at the bottom, altar at the top)

function genTemple(g) {
  const rng = g.rng;
  const { F } = g;
  const W = g.w;
  const H = g.h;
  g.floor = ".";
  paintGround(g, '"', [{ c: ",", frac: 0.06, scale: 3 }]);
  const sd = H >= 26 ? 3 : 2;
  const bx0 = W >= 20 ? 1 : 0;
  const bx1 = W - 1 - bx0;
  const by0 = H >= 26 ? 1 : 0;
  const by1 = H - 1 - sd;
  const R = building(g, bx0, by0, bx1 - bx0 + 1, by1 - by0 + 1, ".");
  const cxm = R.x + R.w / 2; // centre line
  const aisleW = R.w % 2 === 0 ? 2 : 3;
  const ax0 = Math.round(cxm - aisleW / 2);
  const ax1 = ax0 + aisleW - 1;
  // steps / courtyard outside
  g.rect(ax0 - 1, by1 + 1, aisleW + 2, sd, "_");
  g.rect(0, H - 1, W, 1, "_");
  // narthex
  const nd = R.h >= 22 ? 3 : 2;
  const narY = by1 - nd - 1; // wall row between narthex and nave
  g.rect(R.x, narY, R.w, 1, "#");
  for (let x = ax0; x <= ax1; x++) g.set(x, narY, ".");
  const narthex = { x: R.x, y: narY + 1, w: R.w, h: nd };
  if (R.w >= 13) {
    g.addDoor(R.x + 2, narY, {});
    g.addDoor(R.x + R.w - 3, narY, {});
  }
  // front doors
  for (let x = ax0; x <= ax1; x++) if (x - ax0 < 2 || aisleW === 2) g.addDoor(x, by1, { open: rng.chance(0.3) });
  if (aisleW === 3) g.set(ax1, by1, "#");
  // sanctuary + side rooms
  const sdp = clamp(Math.round(R.h * 0.24), 4, 7);
  const sr = R.w >= 15 ? clamp(Math.round(R.w * 0.22), 3, 6) : 0;
  const sanct = { x: R.x + (sr ? sr + 1 : 0), y: R.y, w: R.w - (sr ? 2 * (sr + 1) : 0), h: sdp };
  g.rect(sanct.x, sanct.y, sanct.w, sanct.h, "_");
  let vestry = null;
  let sacristy = null;
  if (sr) {
    g.rect(R.x + sr, R.y, 1, sdp + 1, "#");
    g.rect(R.x, R.y + sdp, sr + 1, 1, "#");
    g.rect(R.x + R.w - sr - 1, R.y, 1, sdp + 1, "#");
    g.rect(R.x + R.w - sr - 1, R.y + sdp, sr + 1, 1, "#");
    vestry = { x: R.x, y: R.y, w: sr, h: sdp };
    sacristy = { x: R.x + R.w - sr, y: R.y, w: sr, h: sdp };
    g.addDoor(R.x + Math.floor(sr / 2), R.y + sdp, {});
    g.addDoor(R.x + R.w - 1 - Math.floor(sr / 2), R.y + sdp, { locked: rng.chance(0.3) });
    g.addDoor(R.x + sr, R.y + Math.floor(sdp / 2) + 1, {});
  }
  // altar on the dais
  const altX = Math.round(cxm) - 1;
  const altY = R.y + 1;
  const altar = g.add("altar", altX, altY, 2, 1, { rot: 180, label: "High altar", force: true });
  const statue = g.add(F.has("idol", "cult", "dark") ? "idol" : "statue", Math.round(cxm) - 1 + (rng.chance(0.5) ? 0 : 1), R.y, 1, 1, { label: "Statue of the god", force: true });
  if (!statue) g.add("banner", altX, R.y, 1, 1, {});
  for (const dx of [-2, 3]) {
    const b = g.add("brazier", altX + dx, altY, 1, 1, { force: true });
    if (b) g.light(b.x, b.y, "brazier", b);
  }
  g.light(altX, altY, "candle");
  g.light(altX + 1, altY, "holy");
  if (altar) {
    g.anchors.npc.push([altX, altY + 1], [altX + 1, altY + 1]);
    g.used.add("altar");
  }
  g.anchors.enemy.push([altX, altY + 3]);
  // nave: pillars + pews
  const naveTop = R.y + sdp + 1;
  const naveBot = narY - 1;
  const pc = R.w >= 11 ? clamp(Math.round(R.w * 0.17), 1, 4) : 0; // side aisle width
  const pL = R.x + pc;
  const pR = R.x + R.w - 1 - pc;
  if (pc) {
    for (let y = naveTop + 1; y <= naveBot - 1; y += 3) {
      g.add("pillar", pL, y);
      g.add("pillar", pR, y);
    }
  }
  for (let y = R.y + 1; y <= naveBot; y++) for (let x = ax0; x <= ax1; x++) g.clear[g.i(x, y)] = 1;
  for (let y = naveTop + 2; y <= naveBot - 1; y += 2) {
    const lx0 = pc ? pL + 1 : R.x + 1;
    const lx1 = ax0 - 1;
    const rx0 = ax1 + 1;
    const rx1 = pc ? pR - 1 : R.x + R.w - 2;
    if (lx1 - lx0 + 1 >= 2) g.add("pew", lx0, y, lx1 - lx0 + 1, 1, { rot: 0 });
    if (rx1 - rx0 + 1 >= 2) g.add("pew", rx0, y, rx1 - rx0 + 1, 1, { rot: 0 });
  }
  for (let y = naveTop; y <= naveBot; y++) for (let x = ax0; x <= ax1; x++) g.set(x, y, "_");
  g.add("rug", ax0, naveTop, aisleW, naveBot - naveTop + 1, { label: "Processional carpet" });
  // wall sconces along the nave
  const nave = { x: R.x, y: naveTop, w: R.w, h: naveBot - naveTop + 1 };
  wallTorch(g, { x: R.x, y: naveTop, w: 1, h: nave.h });
  wallTorch(g, { x: R.x + R.w - 1, y: naveTop, w: 1, h: nave.h });
  // narthex: font + braziers
  g.add("fountain", R.x + 1 < ax0 - 1 ? ax0 - 2 : R.x + 1, narthex.y, 1, 1, { label: "Holy water font" });
  const nb = g.add("brazier", R.x + R.w - 2, narthex.y + narthex.h - 1);
  if (nb) g.light(nb.x, nb.y, "brazier", nb);
  // side rooms
  if (vestry) {
    g.scatter("shelf", 2, wallSpots(g, vestry).map(([x, y]) => [x, y]));
    g.scatter("chest", 1, wallSpots(g, vestry).map(([x, y]) => [x, y]), { label: "Vestment chest" });
    wallTorch(g, vestry, "candle", "Candle");
    g.region("Vestry", vestry.x, vestry.y, vestry.w, vestry.h);
  }
  if (sacristy) {
    g.scatter("bookshelf", 2, wallSpots(g, sacristy).map(([x, y]) => [x, y]));
    g.scatter("stairs_down", 1, wallSpots(g, sacristy).map(([x, y]) => [x, y]), { label: "Stairs to the crypt" });
    g.scatter("chest", 1, wallSpots(g, sacristy).map(([x, y]) => [x, y]), { label: "Reliquary" });
    g.region("Sacristy", sacristy.x, sacristy.y, sacristy.w, sacristy.h);
    g.anchors.hidden.push([sacristy.x + 1, sacristy.y + 1]);
  }
  // grounds
  const yard = g.cells(0, 0, W, H, (x, y) => g.free(x, y) && g.get(x, y) === '"' && !g.clear[g.i(x, y)]);
  if (F.has("grave", "cemetery", "graveyard")) g.scatter("gravestone", rng.int(4, 10), yard);
  g.scatter("bush", rng.int(1, 4), yard);
  g.region("Sanctuary", sanct.x, sanct.y, sanct.w, sanct.h);
  g.region("Nave", nave.x, nave.y, nave.w, nave.h);
  g.region("Narthex", narthex.x, narthex.y, narthex.w, narthex.h);
  g.region("Temple steps", ax0 - 1, by1 + 1, aisleW + 2, sd);
  g.anchors.party.push([ax0, H - 1], [ax0 + 1, H - 1]);
}

// =================================================================================================================
// Theme: mine (canonical: wide, entrance on the west edge)

function genMine(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.fill("#");
  g.floor = ".";
  const y0 = rng.int(Math.round(h * 0.35), Math.round(h * 0.65));
  const y1 = rng.int(Math.round(h * 0.3), Math.round(h * 0.7));
  const endX = w - rng.int(6, 8);
  const main = g.meander(-1, y0 + 0.5, endX, y1 + 0.5, 1.8, 1);
  const tun = new Uint8Array(w * h);
  g.stroke(main, 1.05, ".", (c, x, y) => y > 0 && y < h - 1 && x < w - 1, tun);
  const rails = new Uint8Array(w * h);
  g.stroke(main, 0.42, "_", (c, x, y) => y > 0 && y < h - 1, rails);
  for (let i = 0; i < w * h; i++) if (tun[i]) g.clear[i] = 1;
  g.region("Main tunnel", 0, Math.min(y0, y1) - 1, endX, Math.abs(y1 - y0) + 3);
  const chamberAt = (cx, cy, cw, ch, name) => {
    const x = clamp(Math.round(cx - cw / 2), 1, w - cw - 1);
    const y = clamp(Math.round(cy - ch / 2), 1, h - ch - 1);
    g.rect(x, y, cw, ch, ".");
    // rough corners
    for (const [px, py] of [[x, y], [x + cw - 1, y], [x, y + ch - 1], [x + cw - 1, y + ch - 1]]) if (rng.chance(0.7)) g.set(px, py, "#");
    for (let k = 0; k < cw + ch; k++) {
      const ex = rng.chance(0.5) ? (rng.chance(0.5) ? x - 1 : x + cw) : rng.int(x, x + cw - 1);
      const ey = ex === x - 1 || ex === x + cw ? rng.int(y, y + ch - 1) : rng.chance(0.5) ? y - 1 : y + ch;
      if (ex > 0 && ey > 0 && ex < w - 1 && ey < h - 1 && rng.chance(0.35)) g.set(ex, ey, ".");
    }
    const R = { x, y, w: cw, h: ch };
    if (name) g.region(name, x, y, cw, ch);
    return R;
  };
  // deep chamber at the end of the main tunnel
  const deep = chamberAt(endX + 1, y1 + 0.5, clamp(Math.round(w * 0.22), 5, 9), clamp(Math.round(h * 0.32), 4, 8), "Deep chamber");
  const deepCells = g.cells(deep.x, deep.y, deep.w, deep.h, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
  const veins = g.scatter("crystal", rng.int(2, 4), deepCells.filter(([x, y]) => g.count(x, y, (c) => c === "#") >= 2), { label: "Ore vein" });
  for (const v of veins.slice(0, 2)) g.light(v.x, v.y, "crystal", v);
  g.scatter("crate", rng.int(1, 2), deepCells);
  g.anchors.enemy.push([deep.x + Math.floor(deep.w / 2), deep.y + Math.floor(deep.h / 2)]);
  // branches
  const nb = clamp(Math.round(w / 9), 2, 5);
  const roles = rng.shuffle(["storage", "ore", "shaft", "collapsed", "office", "ore", "storage"]);
  let up = rng.chance(0.5);
  for (let k = 0; k < nb; k++) {
    const t = 0.18 + ((k + 0.5) / nb) * 0.62 + rng.float(-0.04, 0.04);
    const [px, py] = main[Math.floor(t * (main.length - 1))];
    const len = rng.int(Math.round(h * 0.26), Math.round(h * 0.42));
    const ty = clamp(py + (up ? -len : len), 3, h - 4);
    const tx = clamp(px + rng.int(-4, 4), 3, w - 4);
    const bpts = g.meander(px, py, tx, ty, 1.2, 1, true);
    g.stroke(bpts, rng.float(0.7, 0.95), ".", (c, x, y) => x > 0 && y > 0 && x < w - 1 && y < h - 1, tun);
    const role = roles[k % roles.length];
    if (k === nb - 1 && nb >= 3 && rng.chance(0.5)) {
      // a dead-end ore face
      const end = g.cells(tx - 1, ty - 1, 3, 3, (x, y) => g.free(x, y) && g.count(x, y, (c) => c === "#") >= 3);
      g.scatter("crystal", 2, end, { label: "Ore vein" });
      g.region("Ore face", tx - 1, ty - 1, 3, 3);
    } else {
      const R = chamberAt(tx, ty, rng.int(5, 8), rng.int(4, 5), { storage: "Storage gallery", ore: "Ore face", shaft: "Shaft chamber", collapsed: "Collapsed gallery", office: "Foreman's office" }[role]);
      const cells = g.cells(R.x, R.y, R.w, R.h, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
      const wallish = cells.filter(([x, y]) => g.count(x, y, (c) => c === "#") >= 2);
      if (role === "storage") {
        g.scatter("crate", rng.int(3, 5), wallish);
        g.scatter("barrel", rng.int(2, 3), wallish);
        g.scatter("sack", rng.int(1, 3), cells);
        g.anchors.hidden.push([R.x + 1, R.y + 1]);
      } else if (role === "ore") {
        g.scatter("crystal", rng.int(2, 3), wallish, { label: "Ore vein" });
        g.scatter("weapon_rack", 1, wallish, { label: "Pick rack" });
        g.scatter("rubble", rng.int(1, 2), cells);
      } else if (role === "shaft") {
        const sx = R.x + Math.floor(R.w / 2) - 1;
        const sy = R.y + Math.floor(R.h / 2) - 1;
        g.rect(sx, sy, 2, 2, " ");
        g.add("rope", sx + 2 < R.x + R.w ? sx + 2 : sx - 1, sy, 1, 1, { label: "Winch and rope" });
      } else if (role === "collapsed") {
        for (const [x, y] of cells) if (rng.chance(0.4)) g.set(x, y, "%");
        g.scatter("boulder", rng.int(1, 2), cells);
        g.scatter("rubble", rng.int(1, 2), cells);
      } else if (role === "office") {
        tableSet(g, R.x + Math.floor(R.w / 2) - 1, R.y + Math.floor(R.h / 2), 2, 1, true) || g.scatter("table", 1, cells);
        g.scatter("chest", 1, wallish, { label: "Payroll chest" });
        g.scatter("bed", 1, wallish);
        const l = wallTorch(g, R, "lantern", "Lantern");
        if (!l) g.light(R.x + 1, R.y + 1, "candle");
        g.anchors.npc.push([R.x + Math.floor(R.w / 2), R.y + Math.floor(R.h / 2) + 1]);
      }
    }
    // rails into the first branch
    if (k === 0) g.stroke(bpts, 0.42, "_", (c) => c === ".", rails);
    up = !up;
  }
  // lanterns along the main tunnel
  const tunnelWall = [];
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (tun[i] && g.free(x, y) && g.get(x, y) !== "_" && g.count(x, y, (c) => c === "#", DIR4) >= 1) tunnelWall.push([x, y]);
  }
  tunnelWall.sort((a, b) => a[0] - b[0]);
  let lastX = -10;
  for (const [x, y] of tunnelWall) {
    if (x - lastX < rng.int(6, 9)) continue;
    const o = g.add("torch", x, y, 1, 1, { label: "Lantern" });
    if (o) {
      lastX = x;
      if (rng.chance(0.75)) g.light(x, y, "lantern", o);
    }
  }
  // mine carts on the rails, clutter along the walls
  const railCells = g.cells(0, 0, w, h, (x, y) => g.get(x, y) === "_" && g.free(x, y) && x > 3);
  for (const c of g.scatter("cart", rng.int(1, 3), railCells, { label: "Mine cart", force: true })) c.cover = "half";
  g.scatter("crate", rng.int(2, 4), tunnelWall);
  g.scatter("barrel", rng.int(1, 3), tunnelWall);
  const nz = noiseField(rng, w, h, 3, 2);
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (g.t[i] === "." && nz[i] > 0.82 && g.count(x, y, (c) => c === "#") >= 3 && !g.objAt(x, y)) g.t[i] = "%";
  }
  // entrance
  g.set(0, y0, "_");
  g.region("Mine entrance", 0, y0 - 2, 4, 5);
  const ent = g.add("torch", 1, y0 - 1 >= 1 && g.free(1, y0 - 1) ? y0 - 1 : y0 + 1, 1, 1, { label: "Entrance lantern" });
  if (ent) g.light(ent.x, ent.y, "lantern", ent);
  g.anchors.party.push([0, y0], [1, y0]);
  if (!g.anchors.npc.length) g.anchors.npc.push([Math.round(w / 2), Math.round((y0 + y1) / 2)]);
}

// =================================================================================================================
// Theme: castle (canonical: tall, gate at the bottom, throne at the top)

const CASTLE_ROLES = ["guard", "armory", "kitchen", "chapel", "library", "barracks", "treasury", "solar", "stairs"];
const CASTLE_NAMES = { guard: "Guard room", armory: "Armoury", kitchen: "Kitchen", chapel: "Chapel", library: "Library", barracks: "Barracks", treasury: "Treasury", solar: "Lord's solar", stairs: "Tower stair" };

function genCastle(g) {
  const rng = g.rng;
  const W = g.w;
  const H = g.h;
  g.fill("#");
  g.floor = ".";
  const cyd = H >= 26 ? 3 : 2; // courtyard rows
  const iy0 = 1;
  const iy1 = H - 2 - cyd; // interior bottom row
  const ix0 = 1;
  const ix1 = W - 2;
  const Win = ix1 - ix0 + 1;
  let hw = clamp(Math.round(Win * 0.56), 7, 20);
  if ((Win - hw) % 2) hw++;
  if (hw > Win || (Win - hw) / 2 - 1 < 3) hw = Win; // too narrow for side wings: the hall fills the keep
  const hx0 = ix0 + Math.floor((Win - hw) / 2);
  const hx1 = hx0 + hw - 1;
  const eh = clamp(Math.round((iy1 - iy0) * 0.16), 2, 4); // entrance hall depth
  const hy0 = iy0;
  const hy1 = iy1 - eh - 1;
  const hall = { x: hx0, y: hy0, w: hw, h: hy1 - hy0 + 1 };
  g.rect(hall.x, hall.y, hall.w, hall.h, "_");
  const ent = { x: hx0, y: hy1 + 2, w: hw, h: eh };
  g.rect(ent.x, ent.y, ent.w, ent.h, ".");
  // courtyard and gate
  g.rect(0, H - cyd, W, cyd, "_");
  const midX = hx0 + Math.floor(hw / 2) - 1;
  g.addDoor(midX, H - cyd - 1, { open: rng.chance(0.4) });
  g.addDoor(midX + 1, H - cyd - 1, { open: g.doorAt(midX, H - cyd - 1).open });
  g.addDoor(midX, hy1 + 1, {});
  g.addDoor(midX + 1, hy1 + 1, {});
  g.region("Courtyard", 0, H - cyd, W, cyd);
  g.region("Entrance hall", ent.x, ent.y, ent.w, ent.h);
  // wings
  const roles = rng.shuffle(CASTLE_ROLES.slice());
  let ri = 0;
  const wingRooms = [];
  for (const left of [true, false]) {
    const wx0 = left ? ix0 : hx1 + 2;
    const wx1 = left ? hx0 - 2 : ix1;
    const ww = wx1 - wx0 + 1;
    if (ww < 3) continue;
    let y = iy0;
    while (y <= iy1) {
      let rh = rng.int(4, 7);
      if (iy1 - (y + rh) < 4) rh = iy1 - y + 1;
      const R = { x: wx0, y, w: ww, h: rh };
      g.rect(R.x, R.y, R.w, R.h, ".");
      wingRooms.push(R);
      // door into the hall or entrance hall
      const doorX = left ? wx1 + 1 : wx0 - 1;
      const cands = [];
      for (let yy = R.y + 1; yy < R.y + R.h - 1; yy++) if (g.isWalk(left ? doorX + 1 : doorX - 1, yy)) cands.push(yy);
      if (cands.length) g.addDoor(doorX, rng.pick(cands), {});
      R.role = roles[ri++ % roles.length];
      y += rh + 1;
    }
  }
  // connect stacked wing rooms with inner doors (gives a flanking route)
  for (let k = 0; k + 1 < wingRooms.length; k++) {
    const A = wingRooms[k];
    const B = wingRooms[k + 1];
    if (A.x === B.x && B.y === A.y + A.h + 1 && rng.chance(0.7)) g.addDoor(A.x + rng.int(0, A.w - 1), A.y + A.h, {});
  }
  for (const R of wingRooms) {
    decorateCastleRoom(g, R);
    g.region(CASTLE_NAMES[R.role] || "Chamber", R.x, R.y, R.w, R.h);
    if (R.role !== "treasury") wallTorch(g, R);
  }
  // throne dais
  const tx = hx0 + Math.floor(hw / 2) - (hw % 2 === 0 ? 1 : 0);
  const throne = g.add("throne", tx, hy0, 1, 1, { rot: 180, label: "Throne", force: true });
  if (throne) g.anchors.npc.push([tx, hy0 + 1], [tx + 1, hy0 + 1]);
  for (const dx of [-2, 2]) {
    const b = g.add("brazier", tx + dx, hy0 + 1, 1, 1, { force: true });
    if (b) g.light(b.x, b.y, "brazier", b);
  }
  for (const bxp of [hx0, hx1]) g.add("banner", bxp, hy0, 1, 1, { rot: 180, label: "Banner" });
  g.region("Throne dais", tx - 2, hy0, 5, 2);
  g.anchors.enemy.push([tx, hy0 + 3]);
  // rug down the middle
  const rugW = hw % 2 === 0 ? 2 : 1;
  const rugX = hw % 2 === 0 ? hx0 + hw / 2 - 1 : hx0 + Math.floor(hw / 2);
  for (let y = hy0 + 2; y <= hy1; y++) for (let x = rugX - 1; x <= rugX + rugW; x++) g.clear[g.i(x, y)] = 1;
  g.add("rug", rugX, hy0 + 2, rugW, hy1 - hy0 - 1, { label: "Red carpet" });
  // pillars
  const pinset = hw >= 11 ? 2 : 1;
  for (let y = hy0 + 3; y < hy1; y += 3) {
    g.add("pillar", hx0 + pinset, y);
    g.add("pillar", hx1 - pinset, y);
  }
  // feast tables between pillars and carpet
  if (hw >= 13) {
    for (const left of [true, false]) {
      const x = left ? hx0 + pinset + 2 : hx1 - pinset - 2;
      const len = Math.max(3, Math.round(hall.h * 0.45));
      const y = hy0 + Math.round(hall.h * 0.32);
      if (g.add("table", x, y, 1, len, { label: "Feast table" })) {
        g.add("bench", x - 1, y, 1, len, { rot: 90 });
        g.add("bench", x + 1, y, 1, len, { rot: 270 });
      }
    }
  }
  // banners along the hall walls, fireplaces in the side walls
  for (let y = hy0 + 2; y < hy1; y += 4) {
    for (const x of [hx0, hx1]) if (g.free(x, y) && !g.clear[g.i(x, y)]) g.add("banner", x, y, 1, 1, { rot: x === hx0 ? 90 : 270, label: "Banner" });
  }
  const fy = hy0 + Math.round(hall.h * 0.55);
  for (const x of [hx0, hx1]) {
    if (!g.free(x, fy) || !g.free(x, fy + 1)) continue;
    const f = g.add("fireplace", x, fy, 1, 2, { rot: x === hx0 ? 90 : 270, label: "Great hearth" });
    if (f) g.light(x, fy, "fireplace", f);
  }
  wallTorch(g, ent);
  // courtyard clutter
  const yard = g.cells(0, H - cyd, W, cyd, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
  g.scatter("crate", rng.int(1, 3), yard);
  g.scatter("barrel", rng.int(1, 3), yard);
  g.scatter("cart", 1, yard, { label: "Supply cart" }, 2, 1);
  g.region("Great hall", hall.x, hall.y, hall.w, hall.h);
  g.anchors.party.push([midX, H - 1], [midX + 1, H - 1]);
  g.anchors.hidden.push([hx0 + pinset, hy0 + 4], [hx1 - pinset, hy0 + 4]);
}

function decorateCastleRoom(g, R) {
  const rng = g.rng;
  const spots = wallSpots(g, R);
  const at = spots.map(([x, y]) => [x, y]);
  const inner = g.cells(R.x, R.y, R.w, R.h, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
  switch (R.role) {
    case "guard":
      tableSet(g, R.x + Math.floor(R.w / 2) - 1, R.y + Math.floor(R.h / 2), 2, 1, true) || g.scatter("table", 1, inner);
      g.scatter("weapon_rack", 2, at);
      break;
    case "armory":
      for (const [x, y, rot] of spots) if (rng.chance(0.45)) g.add("weapon_rack", x, y, 1, 1, { rot });
      g.scatter("chest", 1, at);
      break;
    case "kitchen": {
      const f = g.scatter("fireplace", 1, at, { label: "Kitchen hearth" });
      for (const o of f) g.light(o.x, o.y, "hearth", o);
      g.scatter("table", 1, inner, { label: "Work table" }, 2, 1);
      g.scatter("barrel", 2, at);
      g.scatter("sack", 2, inner);
      g.anchors.npc.push([R.x + 1, R.y + 1]);
      break;
    }
    case "chapel": {
      const a = g.scatter("altar", 1, spots.filter((s) => s[3] === "n" || s[3] === "s").map(([x, y]) => [x, y]), { label: "Chapel altar" });
      for (const o of a) g.light(o.x, o.y, "candle");
      g.scatter("pew", 2, inner, { rot: 0 }, Math.max(1, Math.min(3, R.w - 2)), 1);
      break;
    }
    case "library":
      for (const [x, y, rot] of spots) if (rng.chance(0.55)) g.add("bookshelf", x, y, 1, 1, { rot });
      g.scatter("table", 1, inner);
      break;
    case "barracks":
      for (const [x, y, rot, s] of spots) if ((s === "w" || s === "e") && (y - R.y) % 2 === 0) g.add("bed", x, y, 1, 1, { rot });
      g.scatter("chest", 1, at);
      break;
    case "treasury": {
      g.scatter("chest", rng.int(2, 4), at);
      g.scatter("statue", 1, at);
      // lock the door(s) of the treasury
      for (const d of g.doors) if (d.x >= R.x - 1 && d.x <= R.x + R.w && d.y >= R.y - 1 && d.y <= R.y + R.h) d.locked = true;
      break;
    }
    case "solar":
      g.scatter("bed", 1, at, { label: "Canopy bed" }, 1, 2);
      g.scatter("rug", 1, inner, {}, 2, 2);
      g.scatter("chest", 1, at);
      g.scatter("bookshelf", 1, at);
      break;
    case "stairs":
      g.scatter("stairs_up", 1, at, { label: "Tower stairs" });
      g.scatter("crate", 1, at);
      break;
    default:
      break;
  }
}

// =================================================================================================================
// Theme: ship (canonical: wide, bow to the east)

function genShip(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.floor = "=";
  g.fill("w");
  const docked = F.has("dock", "harbo", "pier", "wharf", "port", "docked", "quay") || (!F.has("sea", "ocean", "storm", "boarding", "sail") && rng.chance(0.55));
  const pd = docked ? (h >= 20 ? 3 : 2) : 0;
  if (docked) {
    g.rect(0, h - pd, w, pd, "=");
    g.region("Pier", 0, h - pd, w, pd);
  }
  const sx0 = 2;
  const sx1 = w - 3;
  const L = sx1 - sx0;
  const avail = h - pd - (docked ? 3 : 2);
  const HB = clamp(Math.floor(avail / 2), 3, 7);
  // docked ships lie alongside the pier (one or two rows of water between); at sea they sit mid-map
  const cy = docked ? Math.max(HB + 1, h - pd - 2 - HB - (h - pd > 2 * HB + 6 ? 1 : 0)) : Math.floor(h / 2);
  const hbAt = (x) => {
    const t = (x - sx0) / L;
    if (t < 0.06) return HB - 1;
    if (t > 0.62) return HB * Math.sqrt(Math.max(0, (1 - t) / 0.38));
    return HB;
  };
  const deck = new Uint8Array(w * h);
  for (let x = sx0; x <= sx1; x++) {
    const hb = hbAt(x);
    for (let y = 0; y < h; y++) if (Math.abs(y - cy) <= hb + 0.01 && y < h - pd - 1) {
      g.set(x, y, "=");
      deck[g.i(x, y)] = 1;
    }
  }
  // captain's cabin at the stern
  const cl = clamp(Math.round(L * 0.17), 4, 7);
  const cabX1 = sx0 + cl;
  for (let x = sx0; x <= cabX1; x++) {
    for (let y = 0; y < h; y++) {
      if (!deck[g.i(x, y)]) continue;
      const edge = x === sx0 || x === cabX1 || !deck[g.i(x, y - 1)] || !deck[g.i(x, y + 1)];
      if (edge) g.set(x, y, "#");
    }
  }
  g.addDoor(cabX1, cy, {});
  const cabin = { x: sx0 + 1, y: cy - (HB - 2), w: cl - 1, h: 2 * (HB - 2) + 1 };
  g.region("Captain's cabin", cabin.x, cabin.y, cabin.w, cabin.h);
  const cspots = wallSpots(g, cabin);
  g.scatter("map_table", 1, g.cells(cabin.x + 1, cabin.y + 1, Math.max(1, cabin.w - 2), Math.max(1, cabin.h - 2), (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]), { label: "Chart table" });
  g.scatter("chest", 1, cspots.map(([x, y]) => [x, y]), { label: "Captain's sea chest" });
  g.scatter("bed", 1, cspots.map(([x, y]) => [x, y]), { label: "Hammock" });
  g.light(cabin.x + 1, cy, "lantern");
  // rails: fence objects on the deck edge (low: block movement, not sight; half cover)
  for (let x = cabX1 + 1; x <= sx1; x++) {
    for (let y = 0; y < h; y++) {
      if (!deck[g.i(x, y)]) continue;
      const edge = DIR4.some(([dx, dy]) => !deck[g.i(Math.min(w - 1, Math.max(0, x + dx)), Math.min(h - 1, Math.max(0, y + dy)))] || !g.inb(x + dx, y + dy));
      if (edge) g.add("fence", x, y, 1, 1, { label: "Rail" });
    }
  }
  // gangplank to the pier
  let plankX = -1;
  if (docked) {
    plankX = Math.round(sx0 + L * rng.float(0.4, 0.55));
    let y = cy;
    while (y < h - pd && deck[g.i(plankX, y)]) y++;
    for (let yy = y - 1; yy < h - pd; yy++) {
      for (const x of [plankX, plankX + 1]) {
        g.removeObjAt(x, yy);
        g.set(x, yy, "=");
        g.clear[g.i(x, yy)] = 1;
      }
    }
    g.region("Gangplank", plankX, y - 1, 2, h - pd - y + 1);
    g.anchors.party.push([plankX, h - 1], [plankX + 1, h - 1]);
  }
  // masts, hatch, helm
  const masts = L >= 28 ? [0.36, 0.56, 0.76] : [0.4, 0.66];
  for (const t of masts) {
    const mx = Math.round(sx0 + L * t);
    g.add("mast", mx, cy, 1, 1, { label: "Mast" });
    for (const [dx, dy] of [[-1, -1], [1, 1]]) g.add("rope", mx + dx, cy + dy, 1, 1, { label: null });
  }
  const hx = Math.round(sx0 + L * ((masts[0] + masts[1]) / 2)) - 1;
  g.add("trapdoor", hx, cy - 1, 2, 2, { label: "Cargo hatch" });
  for (let x = cabX1 + 1; x <= cabX1 + 2; x++) g.clear[g.i(x, cy)] = 1;
  g.add("helm", cabX1 + 2, cy - 1 >= 0 && HB >= 3 ? cy - 2 : cy, 1, 1, { label: "Ship's wheel", force: true });
  const bowX = Math.round(sx0 + L * 0.84);
  g.add("stairs_down", bowX, cy, 1, 1, { label: "Ladder to the hold" });
  // cargo along the rails
  const byRail = g.cells(cabX1 + 2, 0, sx1 - cabX1 - 2, h, (x, y) => g.free(x, y) && deck[g.i(x, y)] && !g.clear[g.i(x, y)] && g.count(x, y, (c, xx, yy) => !!g.objAt(xx, yy) && g.objAt(xx, yy).kind === "fence", DIR4) >= 1);
  g.scatter("crate", rng.int(3, 6), byRail);
  g.scatter("barrel", rng.int(3, 5), byRail);
  g.scatter("rope", rng.int(1, 3), byRail);
  if (docked) {
    const pier = g.cells(0, h - pd, w, pd, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)] && (x < plankX - 2 || x > plankX + 3));
    g.scatter("crate", rng.int(2, 4), pier);
    g.scatter("barrel", rng.int(1, 3), pier);
    g.scatter("sack", rng.int(1, 2), pier);
    for (let x = 1; x < w; x += rng.int(5, 8)) if (g.free(x, h - pd)) g.add("pillar", x, h - pd, 1, 1, { label: "Mooring post", blocksSight: false, cover: "half" });
  }
  // lanterns at night
  if (g.night) {
    for (const [x, y] of [[cabX1 + 1, cy - 1], [bowX - 1, cy], [Math.round(sx0 + L * masts[0]) + 1, cy]]) {
      const o = g.add("torch", x, y, 1, 1, { label: "Ship's lantern" });
      if (o) g.light(x, y, "lantern", o);
    }
    if (docked) for (let x = 3; x < w; x += 10) {
      const o = g.add("torch", x, h - 1, 1, 1, { label: "Dock lamp" });
      if (o) g.light(x, h - 1, "lamp", o);
    }
  }
  g.region("Forecastle", Math.round(sx0 + L * 0.75), cy - HB, Math.round(L * 0.25) + 1, 2 * HB + 1);
  g.region("Quarterdeck", cabX1 + 1, cy - HB, Math.round(L * 0.18), 2 * HB + 1);
  g.region("Main deck", Math.round(sx0 + L * 0.3), cy - HB, Math.round(L * 0.45), 2 * HB + 1);
  if (!docked) g.anchors.party.push([Math.round(sx0 + L * 0.85), cy], [Math.round(sx0 + L * 0.8), cy + 1]);
  g.anchors.enemy.push([cabX1 + 3, cy + 1]);
  g.anchors.npc.push([cabX1 + 2, cy - 1]);
  g.ship = { cy, docked };
}

// =================================================================================================================
// Theme: village

const COTTAGE_NAMES = ["Miller's cottage", "Smith's house", "Widow's cottage", "Weaver's house", "Shepherd's cottage", "Elder's house", "Herbalist's cottage", "Woodcutter's house", "Fisher's hut", "Reeve's house"];

function genVillage(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  g.indoorFloor = true;
  g.floor = '"';
  paintGround(g, '"', [{ c: ",", frac: 0.06, scale: 3 }]);
  const road = new Uint8Array(w * h);
  const ya = rng.float(h * 0.38, h * 0.62);
  const yb = rng.float(h * 0.38, h * 0.62);
  const main = g.meander(-1, ya, w, yb, h * 0.06, 0.8);
  g.stroke(main, 1.05, ",", null, road);
  const jx = rng.float(w * 0.38, w * 0.6);
  const jy = main.reduce((b, p) => (Math.abs(p[0] - jx) < Math.abs(b[0] - jx) ? p : b))[1];
  const north = rng.chance(0.5);
  g.stroke(g.meander(jx, jy, jx + rng.float(-5, 5), north ? -1 : h, 2, 0.8), 0.85, ",", null, road);
  if (w * h > 800) g.stroke(g.meander(jx, jy, jx + rng.float(-5, 5), north ? h : -1, 2, 0.8), 0.75, ",", null, road);
  for (let i = 0; i < w * h; i++) if (road[i]) g.clear[i] = 1;
  g.region("Main road", 0, Math.round(Math.min(ya, yb)) - 1, w, Math.round(Math.abs(ya - yb)) + 3);
  // village green with the well
  const gx = Math.round(jx + (rng.chance(0.5) ? 3 : -3));
  const gy = Math.round(jy + (north ? 3 : -3));
  const reserved = new Uint8Array(w * h);
  const gr = w * h < 500 ? 2 : 3;
  for (let y = gy - gr; y <= gy + gr; y++) for (let x = gx - gr; x <= gx + gr; x++) if (g.inb(x, y)) reserved[g.i(x, y)] = 1;
  const well = g.add("well", gx, gy, 1, 1, { label: "Village well", force: true });
  if (well) {
    g.anchors.npc.push([gx + 1, gy], [gx - 1, gy]);
    g.used.add("well");
  }
  g.region("Village green", gx - 3, gy - 3, 7, 7);
  // cottages along the roads
  const want = clamp(Math.round((w * h) / 105), 3, 10);
  const roadCells = [];
  for (let i = 0; i < w * h; i++) if (road[i]) roadCells.push(i);
  const names = rng.shuffle(COTTAGE_NAMES.slice());
  let built = 0;
  let barn = false;
  for (let tries = 0; built < want && tries < 1500; tries++) {
    const ri = rng.pick(roadCells);
    const rx = ri % w;
    const ry = (ri - rx) / w;
    const isBarn = !barn && built >= 2;
    const small = w * h < 500;
    const bw = isBarn ? rng.int(small ? 6 : 7, small ? 7 : 9) : rng.int(small ? 4 : 5, small ? 6 : 7);
    const bh = isBarn ? rng.int(5, 6) : rng.int(4, 5);
    // put the house beside the road (above / below / left / right), door facing it
    const side = rng.int(0, 3);
    const off = tries < 600 ? rng.int(2, 4) : rng.int(2, 7);
    const slide = rng.int(-Math.floor(bw / 2), Math.floor(bw / 2));
    let x;
    let y;
    if (side === 0) {
      x = rx - Math.floor(bw / 2) + slide;
      y = ry - bh - off;
    } else if (side === 1) {
      x = rx - Math.floor(bw / 2) + slide;
      y = ry + off;
    } else if (side === 2) {
      x = rx - bw - off;
      y = ry - Math.floor(bh / 2);
    } else {
      x = rx + off;
      y = ry - Math.floor(bh / 2);
    }
    if (x < 0 || y < 0 || x + bw > w || y + bh > h) continue;
    let ok = true;
    for (let yy = y - 1; yy <= y + bh && ok; yy++) for (let xx = x - 1; xx <= x + bw && ok; xx++) {
      if (!g.inb(xx, yy)) continue;
      const i = g.i(xx, yy);
      if (road[i] || reserved[i] || g.t[i] === "#" || g.og[i] >= 0) ok = false;
    }
    if (!ok) continue;
    const R = building(g, x, y, bw, bh, "=");
    let dx;
    let dy;
    if (side === 0) {
      dx = rx;
      dy = y + bh - 1;
    } else if (side === 1) {
      dx = rx;
      dy = y;
    } else if (side === 2) {
      dx = x + bw - 1;
      dy = ry;
    } else {
      dx = x;
      dy = ry;
    }
    dx = clamp(dx, x + 1, x + bw - 2);
    dy = clamp(dy, y + 1, y + bh - 2);
    if (side <= 1) dy = side === 0 ? y + bh - 1 : y;
    else dx = side === 2 ? x + bw - 1 : x;
    g.addDoor(dx, dy, { locked: rng.chance(0.15) });
    if (isBarn && (side <= 1) && g.get(dx + 1, dy) === "#" && dx + 1 < x + bw - 1) g.addDoor(dx + 1, dy, {});
    // path from the door to the road
    const ox = side === 2 ? dx + 1 : side === 3 ? dx - 1 : dx;
    const oy = side === 0 ? dy + 1 : side === 1 ? dy - 1 : dy;
    g.stroke([[ox + 0.5, oy + 0.5], [rx + 0.5, ry + 0.5]], 0.5, ",", (c) => c !== "#" && c !== "+");
    const label = isBarn ? "Barn" : names[built % names.length];
    g.region(label, R.x, R.y, R.w, R.h);
    const spots = wallSpots(g, R);
    const inner = g.cells(R.x, R.y, R.w, R.h, (xx, yy) => g.free(xx, yy) && !g.clear[g.i(xx, yy)]);
    if (isBarn) {
      g.scatter("haybale", rng.int(3, 6), inner);
      g.scatter("cart", 1, inner, { label: "Hay cart" }, 2, 1);
      const out = g.cells(x - 3, y - 3, bw + 6, bh + 6, (xx, yy) => g.free(xx, yy) && !g.clear[g.i(xx, yy)] && !road[g.i(xx, yy)]);
      g.scatter("haybale", rng.int(2, 4), out);
      barn = true;
    } else {
      const hearth = g.scatter("fireplace", 1, spots.map(([a, b]) => [a, b]), { label: "Hearth" });
      for (const o of hearth) if (g.night) g.light(o.x, o.y, "hearth", o);
      g.scatter("bed", 1, spots.map(([a, b]) => [a, b]));
      g.scatter("table", 1, inner);
      g.scatter("chair", 1, inner);
      g.scatter(rng.chance(0.5) ? "chest" : "barrel", 1, spots.map(([a, b]) => [a, b]));
      // a fenced garden beside some cottages
      if (rng.chance(0.45)) fencedGarden(g, R, road, reserved);
    }
    if (g.night) {
      const lamp = g.add("torch", ox, oy, 1, 1, { label: "Door lantern" });
      if (lamp) {
        g.light(ox, oy, "lantern", lamp);
        lamp.blocksMove = false;
      }
    }
    built++;
  }
  // trees, orchard, haybales, carts
  const open = g.cells(1, 1, w - 2, h - 2, (x, y) => g.free(x, y) && !road[g.i(x, y)] && !reserved[g.i(x, y)] && !g.clear[g.i(x, y)] && g.get(x, y) !== "#");
  g.scatter("tree", rng.int(5, Math.round((w * h) / 60)), open);
  g.scatter("bush", rng.int(3, 7), open);
  g.scatter("log", 1, open, { label: "Woodpile" }, 2, 1);
  const side = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && !road[g.i(x, y)] && !g.clear[g.i(x, y)] && g.count(x, y, (c) => c === ",", DIR4) >= 1);
  g.scatter("cart", 1, side, { label: "Farm cart" }, 2, 1);
  g.scatter("barrel", rng.int(1, 3), side);
  g.scatter("crate", rng.int(1, 2), side);
  if (F.has("pond", "duck", "lake")) {
    g.used.delete("pond");
  } else if (rng.chance(0.25)) {
    const s = rng.pick(open);
    if (s && Math.hypot(s[0] - gx, s[1] - gy) > 5) {
      g.disc(s[0] + 0.5, s[1] + 0.5, 2.2, "~", (c, x, y) => c === '"' && !g.objAt(x, y) && !road[g.i(x, y)]);
      g.disc(s[0] + 0.5, s[1] + 0.5, 1.2, "w", (c) => c === "~");
      g.region("Duck pond", s[0] - 2, s[1] - 2, 5, 5);
    }
  }
  g.anchors.party.push([0, Math.round(ya)]);
  g.anchors.enemy.push([w - 1, Math.round(yb)]);
}

function fencedGarden(g, R, road, reserved) {
  const rng = g.rng;
  const gw = rng.int(4, 6);
  const gh = Math.max(3, R.h);
  const left = rng.chance(0.5);
  const x = left ? R.x - 1 - gw - 1 : R.x + R.w + 1;
  const y = R.y - 1;
  for (let yy = y; yy < y + gh + 2; yy++) for (let xx = x; xx < x + gw + 1; xx++) {
    if (!g.inb(xx, yy) || road[g.i(xx, yy)] || reserved[g.i(xx, yy)] || !g.free(xx, yy) || g.clear[g.i(xx, yy)]) return;
  }
  const gate = [x + Math.floor(gw / 2), y + gh + 1];
  for (let yy = y; yy < y + gh + 2; yy++) {
    for (let xx = x; xx < x + gw + 1; xx++) {
      const edge = yy === y || yy === y + gh + 1 || xx === x || xx === x + gw;
      if (edge) {
        if (xx === gate[0] && yy === gate[1]) continue;
        g.add("fence", xx, yy);
      } else {
        g.set(xx, yy, (yy - y) % 2 ? "," : "%");
        g.clear[g.i(xx, yy)] = 1;
      }
    }
  }
  g.region("Vegetable garden", x, y, gw + 1, gh + 2);
}

// =================================================================================================================
// Theme: field (open ground; "graves" hint makes a graveyard)

function genField(g) {
  const rng = g.rng;
  const { F } = g;
  const { w, h } = g;
  g.indoor = false;
  const desert = F.has("desert", "dune", "sand", "waste");
  g.floor = desert ? ":" : '"';
  paintGround(g, desert ? ":" : '"', desert ? [{ c: ",", frac: 0.12, scale: 4 }, { c: "%", frac: 0.04, scale: 3 }] : [{ c: ",", frac: 0.07, scale: 4 }, { c: "%", frac: 0.035, scale: 3 }]);
  if (F.has("grave", "cemetery", "graveyard", "churchyard", "barrow")) {
    genGraveyard(g);
    return;
  }
  // farm track
  if (rng.chance(0.55) || F.has("track", "path", "road")) {
    const vertical = rng.chance(0.4);
    const pts = vertical ? g.meander(rng.float(w * 0.25, w * 0.75), -1, rng.float(w * 0.25, w * 0.75), h, 2, 0.8) : g.meander(-1, rng.float(h * 0.3, h * 0.7), w, rng.float(h * 0.3, h * 0.7), 2.5, 0.8);
    const m = new Uint8Array(w * h);
    g.stroke(pts, 0.85, ",", null, m);
    for (let i = 0; i < w * h; i++) if (m[i]) g.clear[i] = 1;
  }
  // hedgerow or low stone wall across the middle, with gaps
  if (rng.chance(0.85) || F.has("hedge", "wall")) {
    const stone = F.has("wall") || (!F.has("hedge") && rng.chance(0.45));
    const x0 = rng.float(w * 0.42, w * 0.58);
    const pts = g.meander(x0, -1, x0 + rng.float(-3, 3), h, 1.5, 0.7);
    const line = new Uint8Array(w * h);
    g.stroke(pts, 0.5, null, null, line);
    const gaps = [rng.int(2, Math.round(h * 0.35)), rng.int(Math.round(h * 0.55), h - 3)];
    for (let i = 0; i < w * h; i++) {
      if (!line[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (gaps.some((gy) => y >= gy && y <= gy + 1)) continue;
      if (stone) g.add("ruin_wall", x, y, 1, 1, { label: null });
      else if (g.add("bush", x, y, 1, 1, { label: "Hedge" })) g.objs[g.objs.length - 1].blocksSight = true;
    }
    g.region(stone ? "Stone wall" : "Hedgerow", Math.round(x0) - 2, 0, 5, h);
  }
  // copse, lone trees, rocks
  if (!desert) {
    const tx = rng.chance(0.5) ? rng.float(w * 0.15, w * 0.35) : rng.float(w * 0.65, w * 0.85);
    const ty = rng.float(h * 0.2, h * 0.8);
    const copse = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)] && Math.hypot(x - tx, y - ty) < 3.2);
    for (const [x, y] of rng.shuffle(copse)) if (rng.chance(0.42)) g.add("tree", x, y);
    g.scatter("bush", rng.int(2, 4), copse);
    g.region("Copse", Math.round(tx) - 3, Math.round(ty) - 3, 7, 7);
  }
  const open = g.cells(1, 1, w - 2, h - 2, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
  if (!desert) g.scatter("tree", rng.int(1, 3), open);
  g.scatter("rock", rng.int(2, 4), open);
  g.scatter("boulder", rng.int(1, 3), open);
  g.scatter("bush", rng.int(2, 5), open);
  if (!desert && (F.has("farm", "hay", "harvest", "scarecrow") || rng.chance(0.35))) {
    g.scatter("haybale", rng.int(3, 6), open);
    g.scatter("statue", 1, open.filter(([x, y]) => Math.hypot(x - w / 2, y - h / 2) < 6), { label: "Scarecrow", blocksSight: false, cover: "half" });
  }
  g.anchors.party.push([0, Math.floor(h / 2)]);
  g.anchors.enemy.push([w - 1, Math.floor(h / 2)]);
}

function genGraveyard(g) {
  const rng = g.rng;
  const { w, h } = g;
  const fx0 = rng.int(3, 5);
  const fx1 = w - 1 - rng.int(2, 4);
  const fy0 = rng.int(1, 3);
  const fy1 = h - 1 - rng.int(1, 3);
  // iron fence with a gate on the west side
  const gateY = Math.floor((fy0 + fy1) / 2);
  for (let x = fx0; x <= fx1; x++) for (const y of [fy0, fy1]) g.add("fence", x, y, 1, 1, { label: null });
  for (let y = fy0 + 1; y < fy1; y++) {
    if (Math.abs(y - gateY) > 1) g.add("fence", fx0, y);
    if (Math.abs(y - gateY) > 0 || rng.chance(0.5)) g.add("fence", fx1, y);
  }
  for (let y = gateY - 1; y <= gateY + 1; y++) g.clear[g.i(fx0, y)] = 1;
  // central path
  for (let x = 0; x <= fx1 - 1; x++) for (const y of [gateY]) {
    g.set(x, y, "_");
    g.clear[g.i(x, y)] = 1;
  }
  // mausoleum at the far end
  const mw = 5;
  const mh = 5;
  const mx = fx1 - mw - 1;
  const my = clamp(gateY - 2, fy0 + 1, fy1 - mh);
  const R = building(g, mx, my, mw, mh, ".");
  g.addDoor(mx, gateY, { locked: rng.chance(0.4) });
  g.add("sarcophagus", R.x + 1, R.y, 1, 2, { label: "Sarcophagus" });
  g.region("Mausoleum", mx, my, mw, mh);
  g.anchors.enemy.push([mx - 1, gateY]);
  // rows of gravestones
  for (let y = fy0 + 2; y < fy1 - 1; y += 2) {
    for (let x = fx0 + 2; x < mx - 1; x += 2) {
      if (Math.abs(y - gateY) <= 1) continue;
      if (rng.chance(0.72)) g.add("gravestone", x, y, 1, 1, { rot: 270 });
      else if (rng.chance(0.15)) {
        g.set(x, y, " ");
        g.region("Open grave", x, y, 1, 1);
      }
    }
  }
  const inside = g.cells(fx0 + 1, fy0 + 1, fx1 - fx0 - 1, fy1 - fy0 - 1, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]);
  const dead = g.scatter("tree", rng.int(2, 4), inside, { label: "Dead tree" });
  for (const t of dead) t.variant = "dead";
  g.scatter("statue", 1, inside, { label: "Weeping angel statue" });
  const out = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && (x < fx0 || x > fx1 || y < fy0 || y > fy1));
  g.scatter("tree", rng.int(2, 5), out);
  g.scatter("bush", rng.int(2, 4), out);
  const lamp = g.add("torch", fx0 - 1, gateY - 2, 1, 1, { label: "Gate lantern" });
  if (lamp && g.night) g.light(lamp.x, lamp.y, "lantern", lamp);
  g.region("Graveyard", fx0, fy0, fx1 - fx0 + 1, fy1 - fy0 + 1);
  g.anchors.party.push([0, gateY]);
  g.anchors.npc.push([fx0 + 2, gateY + 1]);
  g.used.add("graves");
}


// =================================================================================================================
// Theme registry

const GENERATORS = {
  dungeon: { gen: (g) => genRooms(g, g.F.has("sewer") ? "sewer" : "dungeon"), prefer: "any", indoor: true, ambient: "dark" },
  crypt: { gen: (g) => genRooms(g, "crypt"), prefer: "any", indoor: true, ambient: "dark" },
  cave: { gen: genCave, prefer: "any", indoor: true, ambient: "dark" },
  forest: { gen: genForest, prefer: "wide", indoor: false },
  tavern: { gen: genTavern, prefer: "wide", indoor: true, ambient: "dim" },
  street: { gen: genStreet, prefer: "wide", indoor: false },
  road: { gen: genRoad, prefer: "wide", indoor: false },
  swamp: { gen: genSwamp, prefer: "any", indoor: false },
  camp: { gen: genCamp, prefer: "wide", indoor: false },
  ruins: { gen: genRuins, prefer: "any", indoor: false },
  temple: { gen: genTemple, prefer: "tall", indoor: true, ambient: "dim" },
  mine: { gen: genMine, prefer: "wide", indoor: true, ambient: "dark" },
  castle: { gen: genCastle, prefer: "tall", indoor: true, ambient: "dim" },
  ship: { gen: genShip, prefer: "wide", indoor: false },
  village: { gen: genVillage, prefer: "any", indoor: false },
  field: { gen: genField, prefer: "wide", indoor: false },
};

// =================================================================================================================
// Generic features (applied when the theme didn't handle them)

function applyFeatures(g) {
  const { F, rng } = g;
  const { w, h } = g;
  const openSpot = (pred, near = [w / 2, h / 2], r = 1) => {
    const cands = g.cells(r, r, w - 2 * r, h - 2 * r, (x, y) => {
      for (let yy = y - r; yy <= y + r; yy++) for (let xx = x - r; xx <= x + r; xx++) if (!g.free(xx, yy) || g.clear[g.i(xx, yy)]) return false;
      return !pred || pred(x, y);
    });
    cands.sort((a, b) => Math.hypot(a[0] - near[0], a[1] - near[1]) - Math.hypot(b[0] - near[0], b[1] - near[1]) + rng.float(-1.5, 1.5));
    return cands[0] || null;
  };
  const centre = [w / 2, h / 2];
  const enemySide = g.anchors.enemy[0] || [w * 0.75, h / 2];
  if (F.has("chasm", "ravine", "crevasse", "abyss", "gorge") && !g.used.has("chasm")) {
    const x0 = rng.float(w * 0.4, w * 0.6);
    const pts = g.meander(x0, -1, x0 + rng.float(-3, 3), h, 2, 1);
    g.stroke(pts, 1.3, " ", (c) => c !== "+" && (c !== "#" || !g.indoor));
    for (const o of g.objs.slice()) if (g.get(o.x, o.y) === " ") g.removeObj(o);
    // a rope bridge across
    const by = Math.floor(h / 2) + rng.int(-2, 2);
    for (let x = 0; x < w; x++) if (g.get(x, by) === " ") g.set(x, by, "=");
    g.region("Chasm", Math.round(x0) - 2, 0, 5, h);
    g.used.add("chasm");
    g.used.add("bridge");
  }
  if (F.has("pit", "sinkhole", "hole") && !g.used.has("pit")) {
    const s = openSpot(null, centre, 2) || openSpot(null, centre, 1);
    if (s) {
      g.rect(s[0] - 1, s[1] - 1, 2, 2, " ");
      g.region("Pit", s[0] - 1, s[1] - 1, 2, 2);
      g.used.add("pit");
    }
  }
  if (F.has("stream", "river", "creek", "brook", "bridge") && !g.used.has("stream") && !g.indoor) {
    const river = F.has("river", "bridge");
    const x0 = rng.float(w * 0.35, w * 0.65);
    const pts = g.meander(x0, -1, x0 + rng.float(-w * 0.1, w * 0.1), h, w * 0.05, 1);
    const mark = new Uint8Array(w * h);
    // only open ground: walls, doors and building floors are left alone
    g.stroke(pts, river ? 2 : 1, null, (c) => c !== "#" && c !== "+" && (c !== "=" && c !== "." ? true : !g.indoorFloor), mark);
    for (let i = 0; i < w * h; i++) {
      if (!mark[i]) continue;
      const x = i % w;
      const y = (i - x) / w;
      const o = g.objAt(x, y);
      if (o && o.kind !== "bridge") g.removeObj(o);
      if (g.t[i] === "_" || g.t[i] === "=" || (g.t[i] === "," && g.clear[i])) g.t[i] = river ? "=" : ":"; // roads cross by bridge / ford
      else g.t[i] = "~";
    }
    if (river) g.stroke(pts, 1, "w", (c) => c === "~");
    g.region(river ? "River" : "Stream", Math.round(x0) - 2, 0, 5, h);
    g.used.add("stream");
    g.used.add("bridge");
  }
  if (F.has("pond", "lake", "pool") && !g.used.has("pond") && !g.indoor) {
    const s = openSpot(null, [rng.float(w * 0.25, w * 0.75), rng.float(h * 0.25, h * 0.75)], 2);
    if (s) {
      g.disc(s[0] + 0.5, s[1] + 0.5, 2.6, "~", (c, x, y) => GROUND.has(c) && !g.objAt(x, y) && !g.clear[g.i(x, y)]);
      g.disc(s[0] + 0.5, s[1] + 0.5, 1.6, "w", (c) => c === "~");
      g.region("Pond", s[0] - 2, s[1] - 2, 5, 5);
      g.used.add("pond");
    }
  }
  const present = (kind) => g.objs.some((o) => o.kind === kind);
  if (F.has("campfire", "bonfire", "fire") && !present("campfire")) {
    const s = openSpot(null, centre, 2);
    if (s) placeCampfire(g, s[0], s[1]);
    g.used.add("campfire");
  }
  if (F.has("altar") && !present("altar")) {
    const s = openSpot(null, enemySide, 1);
    if (s) {
      const a = g.add("altar", s[0], s[1], 1, 1, { label: "Altar" });
      if (a) {
        for (const dx of [-1, 1]) {
          const c = g.add("brazier", s[0] + dx, s[1]);
          if (c) g.light(c.x, c.y, "brazier", c);
        }
        g.anchors.npc.unshift([s[0], s[1] + 1]);
      }
    }
  }
  if (F.has("statue", "idol", "monument", "obelisk") && !present("statue") && !present("idol")) {
    const s = openSpot(null, centre, 1);
    if (s) g.add(F.has("idol") ? "idol" : "statue", s[0], s[1], 1, 1, { label: F.has("idol") ? "Idol" : "Statue" });
  }
  if (F.has("cart", "wagon", "caravan") && !g.used.has("cart")) {
    const s = openSpot(null, centre, 1);
    if (s) {
      const over = F.has("overturn", "wreck", "broken");
      g.add("cart", s[0], s[1], 2, 1, { label: over ? "Overturned cart" : "Cart", rot: over ? 90 : 0, blocksSight: over });
      g.scatter("crate", 2, g.cells(s[0] - 2, s[1] - 2, 5, 5, (x, y) => g.free(x, y)));
      g.scatter("sack", 1, g.cells(s[0] - 2, s[1] - 2, 5, 5, (x, y) => g.free(x, y)));
      g.anchors.npc.push([s[0], s[1] + 1]);
    }
  }
  if (F.has("well") && !present("well")) {
    const s = openSpot(null, centre, 1);
    if (s) g.add("well", s[0], s[1], 1, 1, { label: "Well" });
  }
  if (F.has("fountain") && !present("fountain")) {
    const s = openSpot(null, centre, 1);
    if (s) g.add("fountain", s[0], s[1], 1, 1, { label: "Fountain" });
  }
  if (F.has("web", "spider") && !g.used.has("webs")) {
    g.scatter("web", rng.int(4, 8), g.cells(0, 0, w, h, (x, y) => g.free(x, y) && g.count(x, y, (c, xx, yy) => c === "#" || !!g.objAt(xx, yy)) >= 2));
  }
  if (F.has("bones", "corpse", "skeleton", "body", "bodies")) g.scatter("bones", rng.int(3, 6), g.cells(0, 0, w, h, (x, y) => g.free(x, y)));
  if (F.has("trap")) {
    const cands = g.cells(0, 0, w, h, (x, y) => g.free(x, y) && g.clear[g.i(x, y)] && g.get(x, y) !== "+");
    for (const t of g.scatter("trapdoor", rng.int(2, 3), cands, { hidden: true, label: "Pit trap" })) t.blocksMove = false;
  }
  if (F.has("cage", "prisoner", "captive") && !present("cage")) {
    const s = openSpot(null, enemySide, 1);
    if (s) {
      g.add("cage", s[0], s[1], 1, 1, { label: "Prisoner cage" });
      g.anchors.npc.unshift([s[0], s[1] + 1]);
    }
  }
  if (F.has("throne") && !present("throne")) {
    const s = openSpot(null, enemySide, 1);
    if (s) g.add("throne", s[0], s[1], 1, 1, { label: "Throne" });
  }
  if (F.has("tent") && !g.used.has("tent") && !g.indoor) {
    for (let k = 0; k < 2; k++) {
      const s = openSpot(null, [rng.float(w * 0.3, w * 0.7), rng.float(h * 0.3, h * 0.7)], 2);
      if (s) g.add("tent", s[0], s[1], 2, 2, { label: "Tent" });
    }
  }
  if (F.has("crate", "barrel", "supplies", "cargo")) {
    const s = openSpot(null, centre, 1);
    if (s) {
      const near = g.cells(s[0] - 2, s[1] - 2, 5, 5, (x, y) => g.free(x, y));
      g.scatter("crate", 3, near);
      g.scatter("barrel", 2, near);
    }
  }
  if (F.has("tree") && !g.indoor && g.theme !== "forest") {
    g.scatter("tree", rng.int(4, 8), g.cells(1, 1, w - 2, h - 2, (x, y) => g.free(x, y) && !g.clear[g.i(x, y)]));
  }
}

// =================================================================================================================
// Connectivity

function passMask(g) {
  const m = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) for (let x = 0; x < g.w; x++) if (g.passable(x, y)) m[g.i(x, y)] = 1;
  return m;
}

function components(g, pass) {
  const comp = new Int32Array(g.w * g.h).fill(-1);
  const sizes = [];
  const q = [];
  for (let s = 0; s < pass.length; s++) {
    if (!pass[s] || comp[s] >= 0) continue;
    const id = sizes.length;
    let n = 0;
    q.length = 0;
    q.push(s);
    comp[s] = id;
    for (let k = 0; k < q.length; k++) {
      const i = q[k];
      n++;
      const x = i % g.w;
      const y = (i - x) / g.w;
      for (const [dx, dy] of DIR4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!g.inb(nx, ny)) continue;
        const j = g.i(nx, ny);
        if (pass[j] && comp[j] < 0) {
          comp[j] = id;
          q.push(j);
        }
      }
    }
    sizes.push(n);
  }
  return { comp, sizes };
}

function mainComponent(g, comp, sizes) {
  for (const [x, y] of g.anchors.party) {
    if (g.inb(x, y) && comp[g.i(x, y)] >= 0) {
      const id = comp[g.i(x, y)];
      // only trust the anchor if its component is reasonably big
      if (sizes[id] >= Math.max(...sizes) * 0.25) return id;
    }
  }
  let best = -1;
  for (let k = 0; k < sizes.length; k++) if (best < 0 || sizes[k] > sizes[best]) best = k;
  return best;
}

function carveFloorFor(g, x, y) {
  const counts = {};
  for (const [dx, dy] of DIR8) {
    const c = g.get(x + dx, y + dy);
    if (GROUND.has(c) && c !== "~" && c !== "%") counts[c] = (counts[c] || 0) + 1;
  }
  let best = g.floor;
  let bn = 0;
  for (const [c, n] of Object.entries(counts)) if (n > bn) {
    best = c;
    bn = n;
  }
  return best;
}

// Furniture must never wall off part of a room: inside every terrain-connected area (walls/doors only), link up the
// object-separated pockets by removing the cheapest props in the way.
function fixFurniturePockets(g) {
  const terr = new Uint8Array(g.w * g.h);
  for (let y = 0; y < g.h; y++) {
    for (let x = 0; x < g.w; x++) {
      const c = g.get(x, y);
      if (!WALK.has(c)) continue;
      if (c === "+") {
        const d = g.doorAt(x, y);
        if (d && (d.locked || d.secret)) continue;
      }
      terr[g.i(x, y)] = 1;
    }
  }
  const T = components(g, terr);
  for (let iter = 0; iter < 200; iter++) {
    const C = components(g, passMask(g));
    // group object-aware components by terrain component
    const byT = new Map();
    for (let i = 0; i < C.comp.length; i++) {
      const c = C.comp[i];
      if (c < 0) continue;
      const t = T.comp[i];
      if (!byT.has(t)) byT.set(t, new Set());
      byT.get(t).add(c);
    }
    let fixed = false;
    for (const [t, set] of byT) {
      if (set.size < 2) continue;
      const list = [...set].sort((a, b) => C.sizes[b] - C.sizes[a]);
      const main = list[0];
      const victim = list[list.length - 1];
      const cells = [];
      for (let i = 0; i < C.comp.length; i++) if (C.comp[i] === victim) cells.push(i);
      const restrict = new Uint8Array(g.w * g.h);
      for (let i = 0; i < T.comp.length; i++) if (T.comp[i] === t) restrict[i] = 1;
      if (carveLink(g, cells, C.comp, main, restrict)) {
        fixed = true;
        break;
      }
    }
    if (!fixed) return;
  }
}

// door entries <-> '+' tiles must agree
function sanitizeDoors(g) {
  g.doors = g.doors.filter((d) => g.get(d.x, d.y) === "+");
  const seen = new Set(g.doors.map((d) => g.i(d.x, d.y)));
  for (let i = 0; i < g.t.length; i++) if (g.t[i] === "+" && !seen.has(i)) g.doors.push({ x: i % g.w, y: Math.floor(i / g.w), open: false, locked: false, secret: false });
}

function ensureConnected(g) {
  fixFurniturePockets(g);
  for (let iter = 0; iter < 40; iter++) {
    const pass = passMask(g);
    const { comp, sizes } = components(g, pass);
    if (sizes.length <= 1) return;
    const main = mainComponent(g, comp, sizes);
    // find a component to fix (largest first)
    const order = sizes.map((s, k) => [s, k]).filter(([, k]) => k !== main).sort((a, b) => b[0] - a[0]);
    let changed = false;
    for (const [size, id] of order) {
      const cells = [];
      for (let i = 0; i < comp.length; i++) if (comp[i] === id) cells.push(i);
      // intentionally sealed (behind a locked or secret door)?
      const sealed = cells.some((i) => {
        const x = i % g.w;
        const y = (i - x) / g.w;
        return DIR4.some(([dx, dy]) => {
          const d = g.get(x + dx, y + dy) === "+" ? g.doorAt(x + dx, y + dy) : null;
          return d && (d.locked || d.secret);
        });
      });
      if (sealed) continue;
      if (g.indoor && size < 6) {
        // tiny pocket: fill it in
        for (const i of cells) {
          const x = i % g.w;
          const y = (i - x) / g.w;
          g.removeObjAt(x, y);
          if (g.t[i] === "+") g.removeDoorAt(x, y);
          g.t[i] = "#";
        }
        changed = true;
        continue;
      }
      if (carveLink(g, cells, comp, main)) changed = true;
      break; // recompute components after each carve
    }
    if (!changed) return;
  }
}

// cheapest carve from a set of cells to the main component
function carveLink(g, cells, comp, main, restrict = null) {
  const { w, h } = g;
  const n = w * h;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const heap = [];
  const push = (d, i) => {
    heap.push([d, i]);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= heap.length) break;
        if (c + 1 < heap.length && heap[c + 1][0] < heap[c][0]) c++;
        if (heap[c][0] >= heap[k][0]) break;
        [heap[c], heap[k]] = [heap[k], heap[c]];
        k = c;
      }
    }
    return top;
  };
  for (const i of cells) {
    dist[i] = 0;
    push(0, i);
  }
  const stepCost = (x, y) => {
    const i = g.i(x, y);
    const c = g.t[i];
    const border = x === 0 || y === 0 || x === w - 1 || y === h - 1;
    let cost;
    if (g.passable(x, y)) cost = 1;
    else if (c === "+") cost = 2; // locked door: unlock it
    else if (WALK.has(c)) {
      const o = g.objAt(x, y);
      cost = 2 + (o ? Math.min(12, o.w * o.h * 2) : 0) + (o && (o.kind === "tree" || o.kind === "bush") ? -1 : 0);
    } else if (c === "#") cost = g.indoor ? 6 : 9;
    else if (c === "w") cost = 4;
    else cost = 8; // void
    return cost + (border && g.indoor ? 30 : 0);
  };
  let goal = -1;
  while (heap.length) {
    const [d, i] = pop();
    if (d > dist[i]) continue;
    if (comp[i] === main) {
      goal = i;
      break;
    }
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (!g.inb(nx, ny)) continue;
      const j = g.i(nx, ny);
      if (restrict && !restrict[j]) continue;
      const nd = d + stepCost(nx, ny);
      if (nd < dist[j]) {
        dist[j] = nd;
        prev[j] = i;
        push(nd, j);
      }
    }
  }
  if (goal < 0) return false;
  for (let i = goal; i >= 0 && dist[i] > 0; i = prev[i]) {
    const x = i % w;
    const y = (i - x) / w;
    if (g.passable(x, y)) continue;
    const c = g.t[i];
    if (c === "+") {
      const d = g.doorAt(x, y);
      if (d) {
        d.locked = false;
        d.secret = false;
      }
    } else if (WALK.has(c)) {
      g.removeObjAt(x, y);
    } else if (c === "#") {
      g.t[i] = carveFloorFor(g, x, y);
    } else if (c === "w") {
      g.t[i] = g.theme === "ship" || g.theme === "swamp" ? "=" : "~";
    } else {
      g.t[i] = "=";
    }
  }
  return true;
}

// =================================================================================================================
// Start zones

function bfsPass(g, pass, starts) {
  const dist = new Int32Array(g.w * g.h).fill(-1);
  const q = [];
  for (const i of starts) {
    if (i < 0 || dist[i] >= 0) continue;
    dist[i] = 0;
    q.push(i);
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = i % g.w;
    const y = (i - x) / g.w;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!g.inb(nx, ny)) continue;
      const j = g.i(nx, ny);
      if (dist[j] >= 0 || !pass[j]) continue;
      if (dx && dy && (!pass[g.i(x + dx, y)] || !pass[g.i(x, y + dy)])) continue;
      dist[j] = dist[i] + 1;
      q.push(j);
    }
  }
  return dist;
}

function snapToMain(g, pts, inMain) {
  const out = [];
  for (const [x0, y0] of pts) {
    let best = -1;
    let bd = Infinity;
    for (let r = 0; r <= Math.max(g.w, g.h) && best < 0; r++) {
      for (let y = y0 - r; y <= y0 + r; y++) {
        for (let x = x0 - r; x <= x0 + r; x++) {
          if (Math.max(Math.abs(x - x0), Math.abs(y - y0)) !== r || !g.inb(x, y)) continue;
          const i = g.i(x, y);
          if (!inMain[i]) continue;
          const d = Math.hypot(x - x0, y - y0);
          if (d < bd) {
            bd = d;
            best = i;
          }
        }
      }
    }
    if (best >= 0) out.push(best);
  }
  return out;
}

function computeZones(g, light) {
  const { w, h, rng } = g;
  const pass = passMask(g);
  const { comp, sizes } = components(g, pass);
  const main = mainComponent(g, comp, sizes);
  const inMain = new Uint8Array(w * h);
  for (let i = 0; i < comp.length; i++) if (comp[i] === main) inMain[i] = 1;
  const mainCount = sizes[main] || 0;
  // standable: in main, not a door
  const stand = (i) => inMain[i] && g.t[i] !== "+";
  const N = clamp(Math.round(mainCount * 0.035), 10, 24);
  const jitter = new Float32Array(w * h).map(() => rng.next() * 0.9);

  const pStarts = snapToMain(g, g.anchors.party.length ? g.anchors.party : [[0, Math.floor(h / 2)]], inMain);
  const dP = bfsPass(g, pass, pStarts);
  let maxP = 0;
  for (let i = 0; i < dP.length; i++) if (inMain[i] && dP[i] > maxP) maxP = dP[i];
  const all = [];
  for (let i = 0; i < w * h; i++) if (stand(i) && dP[i] >= 0) all.push(i);
  const pref = (i) => {
    // prefer cells without objects or difficult ground
    const o = g.og[i] >= 0 ? g.objs[g.og[i]] : null;
    return (o ? 1.5 : 0) + (g.t[i] === "%" || g.t[i] === "~" ? 1 : 0);
  };
  const party = all.slice().sort((a, b) => dP[a] + pref(a) + jitter[a] - (dP[b] + pref(b) + jitter[b])).slice(0, N);
  const inParty = new Set(party);

  let eStarts = snapToMain(g, g.anchors.enemy, inMain);
  // enemy anchors too close to the party are ignored
  eStarts = eStarts.filter((i) => dP[i] >= Math.max(5, maxP * 0.25));
  if (!eStarts.length) {
    let far = -1;
    for (const i of all) if (far < 0 || dP[i] > dP[far]) far = i;
    if (far >= 0) eStarts = [far];
  }
  const dE = bfsPass(g, pass, eStarts);
  let anchorD = Infinity;
  for (const i of eStarts) anchorD = Math.min(anchorD, dP[i]);
  const minFar = Math.max(4, Math.min(maxP * 0.45, anchorD * 0.6));
  let enemyC = all.filter((i) => !inParty.has(i) && dP[i] >= minFar && dE[i] >= 0);
  if (enemyC.length < N) enemyC = all.filter((i) => !inParty.has(i) && dE[i] >= 0);
  const enemy = enemyC.sort((a, b) => dE[a] + pref(a) + jitter[a] - (dE[b] + pref(b) + jitter[b])).slice(0, N);
  const inEnemy = new Set(enemy);

  // npc spots
  let nStarts = snapToMain(g, g.anchors.npc, inMain);
  let npc = [];
  if (nStarts.length) {
    const dN = bfsPass(g, pass, nStarts);
    const cands = all.filter((i) => dN[i] >= 0 && !inParty.has(i)).sort((a, b) => dN[a] + pref(a) + jitter[a] - (dN[b] + pref(b) + jitter[b]));
    npc = cands.filter((i) => dN[i] <= 3);
    if (npc.length < 8) npc = cands.slice(0, 8);
    npc = npc.slice(0, Math.max(8, Math.min(N, npc.length)));
  } else {
    npc = all.filter((i) => !inParty.has(i) && !inEnemy.has(i)).sort((a, b) => {
      const ax = a % w;
      const bx = b % w;
      return Math.hypot(ax - w / 2, (a - ax) / w - h / 2) + jitter[a] - (Math.hypot(bx - w / 2, (b - bx) / w - h / 2) + jitter[b]);
    }).slice(0, 10);
  }

  // hidden spots: cover, undergrowth, darkness, near the middle, not right next to the party
  const sight = getGrids(toPublicMapShallow(g)).sight;
  const hiddenBonus = new Set(g.anchors.hidden.flatMap(([x, y]) => {
    const out = [];
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (g.inb(xx, yy)) out.push(g.i(xx, yy));
    return out;
  }));
  const scored = [];
  const maxDim = Math.max(w, h);
  for (const i of all) {
    if (inParty.has(i) || dP[i] < 4) continue;
    const x = i % w;
    const y = (i - x) / w;
    let cover = 0;
    for (const [dx, dy] of DIR8) {
      const nx = x + dx;
      const ny = y + dy;
      if (!g.inb(nx, ny)) continue;
      const j = g.i(nx, ny);
      if (sight[j]) cover += dx && dy ? 0.5 : 1;
      else if (g.og[j] >= 0 && g.objs[g.og[j]].cover) cover += 0.4;
    }
    const o = g.og[i] >= 0 ? g.objs[g.og[i]] : null;
    const brush = g.t[i] === "%" || (o && (o.kind === "bush" || o.difficult));
    const dark = light[i] === 0 ? 1 : 0;
    if (cover < 1 && !brush && !dark && !hiddenBonus.has(i)) continue;
    let s = Math.min(3, cover) * 1.2 + (brush ? 2 : 0) + dark * 2 + (hiddenBonus.has(i) ? 3 : 0);
    s -= (Math.hypot(x + 0.5 - w / 2, y + 0.5 - h / 2) / maxDim) * 4;
    if (inEnemy.has(i)) s -= 1;
    s += jitter[i];
    scored.push([s, i]);
  }
  scored.sort((a, b) => b[0] - a[0]);
  const hidden = scored.slice(0, clamp(Math.round(N * 0.8), 8, 18)).map(([, i]) => i);

  const toXY = (i) => [i % w, Math.floor(i / w)];
  return {
    party: party.map(toXY),
    enemy: enemy.map(toXY),
    hidden: hidden.map(toXY),
    npc: npc.map(toXY),
  };
}

// lightweight TacticalMap view of the generator state (for vision helpers)
function toPublicMapShallow(g) {
  if (!g._pub || g._pub.tiles !== g.t.join("")) {
    g._pub = { w: g.w, h: g.h, tiles: g.t.join(""), objects: g.objs, doors: g.doors, lights: g.lights, ambient: g.ambient };
  }
  return g._pub;
}

// =================================================================================================================
// Names

const NAME_BITS = {
  person: ["Aldric", "Morwen", "Thane", "Velka", "Orrin", "Sable", "Hadrik", "Ysolde", "Corvin", "Brannoc", "Elspeth", "Garrow", "Isolde", "Kael", "Merrin", "Torvald"],
  adj: ["Whispering", "Sunken", "Hollow", "Ashen", "Black", "Grey", "Silent", "Broken", "Withered", "Gloaming", "Cold", "Forgotten", "Crimson", "Mossy", "Old", "Shattered"],
  god: ["Pelor", "the Morning Lord", "the Silver Flame", "Kord", "the Raven Queen", "Moradin", "the Drowned God", "Selûne", "Bahamut", "the Forgotten One"],
  noun: ["Thorn", "Raven", "Wolf", "Stone", "Ember", "Briar", "Crow", "Mire", "Fang", "Oak"],
};

function themeName(g) {
  const r = g.rng;
  const P = () => r.pick(NAME_BITS.person);
  const A = () => r.pick(NAME_BITS.adj);
  const N = () => r.pick(NAME_BITS.noun);
  switch (g.theme) {
    case "dungeon":
      return g.F.has("sewer") ? `${A()} Sewers` : r.pick([`The ${A()} Halls`, `Dungeons of ${P()}`, `${N()}hold Depths`, `The ${A()} Vaults`]);
    case "crypt":
      return r.pick([`Crypt of ${P()}`, `The ${A()} Catacombs`, `Tomb of ${P()} the ${r.pick(["Pale", "Damned", "Wise", "Cruel"])}`]);
    case "cave":
      return r.pick([`${A()} Caverns`, `${P()}'s Hollow`, `The ${N()} Grotto`]);
    case "forest":
      return r.pick([`${A()} Wood`, `The ${N()}wood Trail`, `${A()} Glade`]);
    case "street":
      return r.pick([`${P()} Street`, `${N()} Lane`, `Market Row`, `Tanners' Way`]);
    case "road":
      return r.pick([`The ${A()} Road`, `King's Road`, `${N()} Pass Road`]);
    case "swamp":
      return r.pick([`${A()} Fen`, `${N()} Marsh`, `The ${A()} Mire`]);
    case "camp":
      return r.pick([`Bandit Camp`, `${P()}'s Camp`, `The ${N()} Encampment`]);
    case "ruins":
      return r.pick([`Ruins of ${P()}`, `The ${A()} Ruins`, `Fallen ${N()} Keep`]);
    case "temple":
      return r.pick([`Temple of ${r.pick(NAME_BITS.god)}`, `Shrine of ${r.pick(NAME_BITS.god)}`]);
    case "mine":
      return r.pick([`${P()}'s Mine`, `The ${A()} Mine`, `${N()} Deep Mine`]);
    case "castle":
      return r.pick([`${N()} Keep`, `Castle ${P()}`, `Hall of ${P()}`]);
    case "ship":
      return `The ${r.pick(["Sea", "Salt", "Storm", "Black", "Gilded", "Merry"])} ${r.pick(["Maiden", "Serpent", "Wolf", "Gull", "Wench", "Kraken"])}`;
    case "village":
      return r.pick([`${N()}ford`, `${N()}by`, `${P()}'s Rest`, `Little ${N()}`]);
    case "field":
      return g.F.has("graves") ? `${A()} Graveyard` : r.pick([`${A()} Fields`, `${N()} Hill`, `The ${A()} Meadow`]);
    default:
      return "Battlefield";
  }
}

// =================================================================================================================
// Public API

/**
 * generateTacticalMap(spec) -> TacticalMap
 * spec: { theme, name?, seed?, size?: "small"|"medium"|"large", w?, h?, ambient?, timeOfDay?: "day"|"dusk"|"night", features?: [] }
 */
export function generateTacticalMap(spec = {}) {
  const rawSeed = spec.seed ?? Math.floor(Math.random() * 2147483647);
  const seed = typeof rawSeed === "number" && Number.isFinite(rawSeed) ? Math.floor(rawSeed) : hashString(String(rawSeed));
  const { theme, hints } = resolveTheme(spec.theme);
  const def = GENERATORS[theme] || GENERATORS.dungeon;
  const realTheme = GENERATORS[theme] ? theme : "dungeon";
  const F = makeFeatures([...(Array.isArray(spec.features) ? spec.features : spec.features ? [spec.features] : []), ...hints, String(spec.theme || "")]);
  const [sw, sh] = SIZES[spec.size] || SIZES.medium;
  const W = clamp(Math.round(spec.w || sw), 12, 80);
  const H = clamp(Math.round(spec.h || sh), 10, 60);
  const rng = new Rng((seed ^ hashString(realTheme)) >>> 0);
  const tod = ["day", "dusk", "night"].includes(spec.timeOfDay) ? spec.timeOfDay : "day";

  // canonical orientation: transpose when the theme's preferred aspect doesn't match the map
  const prefer = def.prefer || "any";
  let transpose = false;
  if (prefer === "wide" && H > W) transpose = true;
  else if (prefer === "tall" && W > H) transpose = true;
  else if (prefer === "any" && W !== H && rng.chance(0.25) && Math.max(W, H) / Math.min(W, H) < 1.5) transpose = false;
  const gw = transpose ? H : W;
  const gh = transpose ? W : H;
  const g = new Gen(gw, gh, rng, F, realTheme);
  g.indoor = def.indoor;
  g.night = tod === "night" || tod === "dusk";
  g.tod = tod;
  def.gen(g);
  g.indoor = def.indoor; // themes may toggle this while generating
  const flipX = rng.chance(0.5);
  const flipY = rng.chance(0.5);
  g.transform(transpose, flipX, flipY);

  // ambient
  let ambient = spec.ambient;
  if (!["bright", "dim", "dark"].includes(ambient)) {
    if (def.ambient) ambient = def.ambient;
    else ambient = tod === "night" ? "dark" : tod === "dusk" ? "dim" : "bright";
  }
  g.ambient = ambient;

  applyFeatures(g);
  sanitizeDoors(g);
  ensureConnected(g);
  sanitizeDoors(g);
  // drop lights that ended up on blocked cells and objects on walls after carving
  g.objs = g.objs.filter((o) => {
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) if (!g.inb(x, y) || g.get(x, y) === "#") return false;
    return true;
  });
  g.reindex();
  const objSet = new Set(g.objs);
  g.lights = g.lights.filter((l) => g.inb(l.x, l.y) && g.get(l.x, l.y) !== "#" && (!l.obj || objSet.has(l.obj)));

  // ids
  const idBase = (seed >>> 0).toString(36);
  g.objs.forEach((o, k) => (o.id = `o${k + 1}`));
  g.lights.forEach((l, k) => (l.id = `l${k + 1}`));

  const pub = toPublicMapShallow(g);
  const lightGrid = computeLight({ ...pub, lights: g.lights.map(stripLight) });
  const zones = computeZones(g, lightGrid);

  // resolve compass placeholders in region names, clip regions
  const compass = (r) => {
    const cx = (r.x + r.w / 2) / g.w;
    const cy = (r.y + r.h / 2) / g.h;
    const ns = cy < 0.36 ? "North" : cy > 0.64 ? "South" : "";
    const ew = cx < 0.36 ? "west" : cx > 0.64 ? "east" : "";
    if (ns && ew) return ns + ew;
    if (ns) return ns;
    if (ew) return ew[0].toUpperCase() + ew.slice(1);
    return "Central";
  };
  const regions = [];
  const seenNames = new Map();
  for (const r of g.regions) {
    const x0 = clamp(r.x, 0, g.w - 1);
    const y0 = clamp(r.y, 0, g.h - 1);
    const x1 = clamp(r.x + r.w - 1, 0, g.w - 1);
    const y1 = clamp(r.y + r.h - 1, 0, g.h - 1);
    let name = r.name.replace("{dir}", compass(r));
    const n = (seenNames.get(name) || 0) + 1;
    seenNames.set(name, n);
    if (n > 1) name = `${name} ${["", "", "II", "III", "IV", "V", "VI"][n] || n}`;
    regions.push({ name, x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
  }

  const map = {
    id: `map_${idBase}${realTheme.slice(0, 2)}`,
    kind: "tactical",
    name: spec.name || g.name || themeName(g),
    theme: realTheme,
    seed,
    w: g.w,
    h: g.h,
    tiles: g.t.join(""),
    objects: g.objs.map((o) => ({
      id: o.id, kind: o.kind, x: o.x, y: o.y, w: o.w, h: o.h, rot: o.rot || 0,
      blocksMove: !!o.blocksMove, blocksSight: !!o.blocksSight, difficult: !!o.difficult,
      cover: o.cover || null, light: o.light || null, hidden: !!o.hidden, label: o.label || null,
      ...(o.variant ? { variant: o.variant } : {}),
    })),
    doors: g.doors.map((d) => ({ x: d.x, y: d.y, open: !!d.open, locked: !!d.locked, secret: !!d.secret })),
    lights: g.lights.map(stripLight),
    ambient,
    timeOfDay: tod,
    regions,
    startZones: zones,
  };
  return map;
}

function stripLight(l) {
  const out = { id: l.id, x: l.x, y: l.y, bright: l.bright, dim: l.dim, color: l.color, flicker: !!l.flicker };
  if (l.kind) out.kind = l.kind;
  if (l.obj && l.obj.id) out.objectId = l.obj.id;
  return out;
}

// =================================================================================================================
// placeCreatures

function mapPass(map) {
  const g = getGrids(map);
  return g.cost;
}

/**
 * placeCreatures(map, groups, { occupied = new Set(), seed } = {}) -> { [groupKey]: [[x, y], ...] }
 * groups: [{ key, count, size = 1, zone: "party"|"far"|"near"|"flank"|"surround"|"hidden"|"center"|"npc"|[x, y] }]
 */
export function placeCreatures(map, groups, { occupied = new Set(), seed } = {}) {
  const { w, h } = map;
  const rng = new Rng(((seed ?? map.seed ?? 1) ^ 0x9e3779b9) >>> 0);
  const cost = mapPass(map);
  const occ = new Set();
  for (const k of occupied || []) occ.add(String(k));
  const zones = map.startZones || {};
  const idx = (x, y) => y * w + x;
  const passAt = (x, y) => x >= 0 && y >= 0 && x < w && y < h && cost[idx(x, y)] > 0;

  // reachability: component containing the party zone (8-dir BFS without corner cutting)
  const reach = new Uint8Array(w * h);
  {
    const seeds = (zones.party || []).filter(([x, y]) => passAt(x, y));
    if (!seeds.length) {
      // fall back to the largest passable component
      let best = null;
      const seen = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) {
        if (seen[i] || !cost[i]) continue;
        const comp = [];
        const q = [i];
        seen[i] = 1;
        for (let k = 0; k < q.length; k++) {
          const c = q[k];
          comp.push(c);
          const x = c % w;
          const y = (c - x) / w;
          for (const [dx, dy] of DIR4) {
            const nx = x + dx;
            const ny = y + dy;
            if (passAt(nx, ny) && !seen[idx(nx, ny)]) {
              seen[idx(nx, ny)] = 1;
              q.push(idx(nx, ny));
            }
          }
        }
        if (!best || comp.length > best.length) best = comp;
      }
      for (const i of best || []) reach[i] = 1;
    } else {
      const q = seeds.map(([x, y]) => idx(x, y));
      for (const i of q) reach[i] = 1;
      for (let k = 0; k < q.length; k++) {
        const c = q[k];
        const x = c % w;
        const y = (c - x) / w;
        for (const [dx, dy] of DIR4) {
          const nx = x + dx;
          const ny = y + dy;
          if (passAt(nx, ny) && !reach[idx(nx, ny)]) {
            reach[idx(nx, ny)] = 1;
            q.push(idx(nx, ny));
          }
        }
      }
    }
  }
  const tiles = map.tiles || "";
  const fits = (x, y, s) => {
    for (let yy = y; yy < y + s; yy++) {
      for (let xx = x; xx < x + s; xx++) {
        if (!passAt(xx, yy) || !reach[idx(xx, yy)] || occ.has(`${xx},${yy}`)) return false;
        if (tiles[idx(xx, yy)] === "+") return false;
      }
    }
    return true;
  };
  const steps = (starts) => {
    const d = new Int32Array(w * h).fill(-1);
    const q = [];
    for (const [x, y] of starts) {
      if (!passAt(x, y)) continue;
      const i = idx(x, y);
      if (d[i] >= 0) continue;
      d[i] = 0;
      q.push(i);
    }
    for (let k = 0; k < q.length; k++) {
      const c = q[k];
      const x = c % w;
      const y = (c - x) / w;
      for (const [dx, dy] of DIR8) {
        const nx = x + dx;
        const ny = y + dy;
        if (!passAt(nx, ny)) continue;
        if (dx && dy && (!passAt(x + dx, y) || !passAt(x, y + dy))) continue;
        const j = idx(nx, ny);
        if (d[j] >= 0) continue;
        d[j] = d[c] + 1;
        q.push(j);
      }
    }
    return d;
  };
  const centroid = (pts) => {
    if (!pts.length) return [w / 2, h / 2];
    let sx = 0;
    let sy = 0;
    for (const [x, y] of pts) {
      sx += x;
      sy += y;
    }
    return [sx / pts.length, sy / pts.length];
  };
  const byDistTo = (pts, c) => pts.slice().sort((a, b) => Math.hypot(a[0] - c[0], a[1] - c[1]) - Math.hypot(b[0] - c[0], b[1] - c[1]));
  const allCells = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (reach[idx(x, y)]) allCells.push([x, y]);

  const result = {};
  let partyRef = null;
  let flankSide = 0;

  const candidatesFor = (zone, count) => {
    const partyPts = partyRef && partyRef.length ? partyRef : zones.party || [];
    if (Array.isArray(zone) && zone.length === 2 && typeof zone[0] === "number") {
      const d = steps([[zone[0] | 0, zone[1] | 0]]);
      let cells = allCells.filter(([x, y]) => d[idx(x, y)] >= 0);
      if (!cells.length) cells = byDistTo(allCells, zone);
      return cells.sort((a, b) => d[idx(a[0], a[1])] - d[idx(b[0], b[1])]);
    }
    switch (zone) {
      case "party":
        return byDistTo(zones.party || [], centroid(zones.party || []));
      case "hidden":
        return (zones.hidden && zones.hidden.length ? zones.hidden : zones.enemy || []).slice();
      case "npc":
        return (zones.npc && zones.npc.length ? zones.npc : byDistTo(allCells, [w / 2, h / 2]).slice(0, 20)).slice();
      case "center":
      case "centre":
      case "middle": {
        const c = centroid(allCells);
        return byDistTo(allCells, c).slice(0, 80);
      }
      case "near": {
        const d = steps(partyPts);
        return rng.shuffle(allCells.filter(([x, y]) => {
          const v = d[idx(x, y)];
          return v >= 3 && v <= 6;
        })).sort((a, b) => d[idx(a[0], a[1])] - d[idx(b[0], b[1])]);
      }
      case "flank": {
        const d = steps(partyPts);
        const P = centroid(partyPts);
        const E = centroid(zones.enemy && zones.enemy.length ? zones.enemy : [[w - 1 - P[0], h - 1 - P[1]]]);
        let ax = E[0] - P[0];
        let ay = E[1] - P[1];
        const L = Math.hypot(ax, ay) || 1;
        ax /= L;
        ay /= L;
        const sides = [[], []];
        for (const [x, y] of allCells) {
          const v = d[idx(x, y)];
          if (v < 3 || v > 10) continue;
          const vx = x - P[0];
          const vy = y - P[1];
          const along = vx * ax + vy * ay;
          const cross = vx * ay - vy * ax;
          if (Math.abs(cross) < 2.5 || Math.abs(along) > Math.abs(cross) * 1.2) continue;
          sides[cross > 0 ? 0 : 1].push([x, y]);
        }
        let s = flankSide;
        if (flankSide === 0 && sides[1].length > sides[0].length * 1.5) s = 1;
        flankSide = 1 - s;
        const pick = sides[s].length >= count ? sides[s] : sides[s].concat(sides[1 - s]);
        return pick.sort((a, b) => Math.abs(d[idx(a[0], a[1])] - 5) - Math.abs(d[idx(b[0], b[1])] - 5));
      }
      case "surround": {
        const d = steps(partyPts);
        const P = centroid(partyPts);
        return allCells.filter(([x, y]) => {
          const v = d[idx(x, y)];
          return v >= 3 && v <= 7;
        }).map(([x, y]) => [x, y, Math.atan2(y - P[1], x - P[0])]);
      }
      case "far":
      case "enemy":
      default:
        return byDistTo(zones.enemy || [], centroid(zones.enemy || []));
    }
  };

  for (const grp of groups || []) {
    const key = grp.key ?? `group${Object.keys(result).length + 1}`;
    const count = Math.max(0, grp.count ?? 1);
    const size = Math.max(1, grp.size | 0 || 1);
    const zone = grp.zone ?? (key === "party" ? "party" : "far");
    let cands = candidatesFor(zone, count);
    const out = [];
    const claim = (x, y) => {
      out.push([x, y]);
      for (let yy = y; yy < y + size; yy++) for (let xx = x; xx < x + size; xx++) occ.add(`${xx},${yy}`);
    };
    if (zone === "surround" && cands.length) {
      const P = centroid(partyRef && partyRef.length ? partyRef : zones.party || []);
      const a0 = rng.float(0, Math.PI * 2);
      for (let k = 0; k < count; k++) {
        const target = a0 + (k * Math.PI * 2) / count;
        let best = null;
        let bs = Infinity;
        for (const [x, y, a] of cands) {
          if (!fits(x, y, size)) continue;
          let da = Math.abs(a - target) % (Math.PI * 2);
          if (da > Math.PI) da = Math.PI * 2 - da;
          const s = da * 4 + Math.abs(Math.hypot(x - P[0], y - P[1]) - 5) * 0.3;
          if (s < bs) {
            bs = s;
            best = [x, y];
          }
        }
        if (best) claim(best[0], best[1]);
      }
      cands = cands.map(([x, y]) => [x, y]);
    } else {
      for (let k = 0; k < count; k++) {
        let best = null;
        if (!out.length) {
          best = cands.find(([x, y]) => fits(x, y, size)) || null;
        } else {
          // stay close to the rest of the group, but respect the zone order
          let bs = Infinity;
          for (let r = 0; r < cands.length; r++) {
            const [x, y] = cands[r];
            if (!fits(x, y, size)) continue;
            let dm = Infinity;
            for (const [px, py] of out) dm = Math.min(dm, Math.max(Math.abs(px - x), Math.abs(py - y)));
            const s = Math.max(0, dm - size) * 3 + r * 0.08;
            if (s < bs) {
              bs = s;
              best = [x, y];
            }
          }
        }
        if (best) claim(best[0], best[1]);
      }
    }
    // fallback: expand outward from the zone (or the map centre) to any reachable cell
    if (out.length < count) {
      const seedPts = cands.length ? cands.slice(0, 10).map(([x, y]) => [x, y]) : (zones.party && zones.party.length ? zones.party : byDistTo(allCells, [w / 2, h / 2]).slice(0, 1));
      const d = steps(seedPts);
      const rest = allCells.filter(([x, y]) => d[idx(x, y)] >= 0).sort((a, b) => d[idx(a[0], a[1])] - d[idx(b[0], b[1])]);
      for (const [x, y] of rest) {
        if (out.length >= count) break;
        if (fits(x, y, size)) claim(x, y);
      }
    }
    result[key] = out;
    if (zone === "party" || key === "party") partyRef = (partyRef || []).concat(out);
  }
  return result;
}

// =================================================================================================================
// ASCII rendering + AI description

function asciiGrid(map, tokens = [], overlay = null) {
  const { w, h } = map;
  const grid = [];
  for (let y = 0; y < h; y++) grid.push(map.tiles.slice(y * w, (y + 1) * w).split(""));
  for (const d of map.doors || []) if (grid[d.y] && grid[d.y][d.x] === "+" && d.open) grid[d.y][d.x] = "/";
  for (const o of map.objects || []) {
    const gch = Object.prototype.hasOwnProperty.call(GLYPH, o.kind) ? GLYPH[o.kind] : "?";
    if (!gch) continue;
    for (let y = o.y; y < o.y + (o.h || 1); y++) for (let x = o.x; x < o.x + (o.w || 1); x++) if (grid[y] && grid[y][x] !== undefined) grid[y][x] = gch;
  }
  if (overlay) {
    for (const [ch, cells] of overlay) for (const [x, y] of cells) if (grid[y] && grid[y][x] !== undefined) grid[y][x] = ch;
  }
  const letters = [];
  tokens.forEach((t, k) => {
    const ch = k < 26 ? String.fromCharCode(65 + k) : k < 35 ? String(k - 25) : "#";
    letters.push(ch);
    const s = t.size || 1;
    for (let y = t.y; y < t.y + s; y++) for (let x = t.x; x < t.x + s; x++) if (grid[y] && grid[y][x] !== undefined) grid[y][x] = ch;
  });
  const pad = String(h - 1).length;
  let header = " ".repeat(pad + 1);
  for (let x = 0; x < w; x += 5) header += String(x).padEnd(5, " ");
  const lines = [header.trimEnd()];
  for (let y = 0; y < h; y++) lines.push(String(y).padStart(pad, " ") + " " + grid[y].join(""));
  return { text: lines.join("\n"), letters, grid };
}

/**
 * mapToAscii(map, { tokens, zones: true, light: Uint8Array }) -> string   (debug / preview helper)
 */
export function mapToAscii(map, opts = {}) {
  const overlay = [];
  if (opts.zones && map.startZones) {
    overlay.push(["H", map.startZones.hidden || []], ["N", map.startZones.npc || []], ["E", map.startZones.enemy || []], ["P", map.startZones.party || []]);
  }
  if (opts.light) {
    const cells = [[], [], []];
    for (let i = 0; i < opts.light.length; i++) {
      const x = i % map.w;
      const y = (i - x) / map.w;
      if (map.tiles[i] !== "#") cells[opts.light[i]].push([x, y]);
    }
    overlay.push([" ", cells[0]], ["-", cells[1]], ["O", cells[2]]);
  }
  return asciiGrid(map, opts.tokens || [], overlay.length ? overlay : null).text;
}

/**
 * describeMapForAI(map, tokens) -> string
 * tokens: [{ name, kind, x, y, size?, hidden? }]
 */
export function describeMapForAI(map, tokens = []) {
  const toks = (tokens || []).filter((t) => t && Number.isFinite(t.x) && Number.isFinite(t.y));
  const { text, letters, grid } = asciiGrid(map, toks);
  const out = [];
  out.push(`MAP "${map.name}" (${map.theme}) ${map.w}x${map.h} cells, 1 cell = 5 ft, x right / y down, light: ${map.ambient}${map.timeOfDay ? `, ${map.timeOfDay}` : ""}.`);
  out.push(text);
  // legend of what's on the grid
  const present = new Set();
  for (const row of grid) for (const c of row) present.add(c);
  const tileKeys = Object.keys(TILE_NAMES).filter((c) => present.has(c));
  out.push("Key: " + tileKeys.map((c) => `${c === " " ? "(blank)" : c} ${TILE_NAMES[c]}`).join(", "));
  const glyphs = [...new Set((map.objects || []).map((o) => (Object.prototype.hasOwnProperty.call(GLYPH, o.kind) ? GLYPH[o.kind] : "?")).filter(Boolean))];
  if (glyphs.length) {
    const kindsBy = {};
    for (const o of map.objects) {
      const gch = Object.prototype.hasOwnProperty.call(GLYPH, o.kind) ? GLYPH[o.kind] : "?";
      if (!gch) continue;
      (kindsBy[gch] = kindsBy[gch] || new Set()).add(o.kind.replace(/_/g, " "));
    }
    out.push("Props: " + glyphs.map((gch) => `${gch} ${[...kindsBy[gch]].join("/")}`).join(", ") + ". Trees, pillars, statues, tents and stalagmites block sight; tables, crates, barrels and low walls give half cover.");
  }
  if (toks.length) {
    out.push("Tokens:");
    toks.forEach((t, k) => {
      const s = t.size || 1;
      const sz = s > 1 ? ` [${["", "", "Large 2x2", "Huge 3x3", "Gargantuan 4x4"][s] || `${s}x${s}`}]` : "";
      out.push(`${letters[k]} = ${t.name || t.id || "?"} (${t.kind || "creature"}) at ${t.x},${t.y}${sz}${t.hidden ? " (hidden)" : ""}`);
    });
  }
  const doors = map.doors || [];
  if (doors.length) {
    out.push("Doors: " + doors.map((d) => `${d.x},${d.y} ${d.secret ? "secret" : d.locked ? "locked" : d.open ? "open" : "closed"}`).join("; "));
  }
  // lights grouped by source
  const objById = new Map((map.objects || []).map((o) => [o.id, o]));
  const lightGroups = new Map();
  for (const l of map.lights || []) {
    const o = l.objectId ? objById.get(l.objectId) : null;
    const name = o ? (o.label || o.kind).toLowerCase() : l.kind || "light";
    if (!lightGroups.has(name)) lightGroups.set(name, []);
    lightGroups.get(name).push(`${l.x},${l.y}`);
  }
  for (const o of map.objects || []) {
    if (!o.light) continue;
    const name = (o.label || o.kind).toLowerCase();
    if (!lightGroups.has(name)) lightGroups.set(name, []);
    lightGroups.get(name).push(`${o.x},${o.y}`);
  }
  if (lightGroups.size) out.push("Lights: " + [...lightGroups].map(([n, ps]) => `${n} ${ps.slice(0, 8).join(" ")}${ps.length > 8 ? " ..." : ""}`).join("; "));
  if ((map.regions || []).length) out.push("Areas: " + map.regions.map((r) => `${r.name} (${r.x},${r.y} ${r.w}x${r.h})`).join("; "));
  // notable objects: labelled or rare kinds
  const NOTABLE = new Set(["altar", "throne", "well", "fountain", "chest", "statue", "idol", "stairs_up", "stairs_down", "lever", "cage", "trapdoor", "sarcophagus", "cart", "campfire", "fireplace", "forge", "map_table", "helm", "bar"]);
  const notes = [];
  const seenLabel = new Map();
  for (const o of map.objects || []) {
    if (o.kind === "torch" || o.kind === "brazier") continue;
    if (!(NOTABLE.has(o.kind) || (o.label && !/^(log seat|keg|lantern|candle|armchair|street lamp)$/i.test(o.label)))) continue;
    const name = o.label || o.kind.replace(/_/g, " ");
    const k = name.toLowerCase();
    if (!seenLabel.has(k)) {
      seenLabel.set(k, []);
      notes.push(k);
    }
    seenLabel.get(k).push(`${o.x},${o.y}${o.hidden ? " (hidden)" : ""}`);
  }
  if (notes.length) {
    out.push("Notable: " + notes.slice(0, 24).map((k) => {
      const ps = seenLabel.get(k);
      return `${k} ${ps.slice(0, 4).join(" ")}${ps.length > 4 ? ` (+${ps.length - 4})` : ""}`;
    }).join("; "));
  }
  return out.join("\n");
}
