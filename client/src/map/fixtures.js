// Demo fixtures: hand-built showcase battle maps, sample tokens, and area maps.
import { makeRand, fbm } from './rng.js';
import { OBJECT_KINDS } from './objects.js';

// ------------------------------------------------------------------ tiny grid builder
function Grid(w, h, fill) {
  const t = new Array(w * h).fill(fill);
  const g = {
    w,
    h,
    t,
    objects: [],
    doors: [],
    lights: [],
    regions: [],
    inb: (x, y) => x >= 0 && y >= 0 && x < w && y < h,
    get: (x, y) => (g.inb(x, y) ? t[y * w + x] : ' '),
    set: (x, y, c) => g.inb(x, y) && (t[y * w + x] = c),
    rect(x, y, rw, rh, c) {
      for (let j = y; j < y + rh; j++) for (let i = x; i < x + rw; i++) g.set(i, j, c);
    },
    building(x, y, bw, bh, floor = '=', doors = [], name) {
      g.rect(x, y, bw, bh, '#');
      g.rect(x + 1, y + 1, bw - 2, bh - 2, floor);
      for (const [dx, dy, extra = {}] of doors) {
        g.set(x + dx, y + dy, '+');
        g.doors.push({ x: x + dx, y: y + dy, open: false, locked: false, secret: false, ...extra });
      }
      if (name) g.regions.push({ name, x, y, w: bw, h: bh });
    },
    blob(cx, cy, r, c, seed = 1, only) {
      for (let j = Math.floor(cy - r - 2); j <= cy + r + 2; j++)
        for (let i = Math.floor(cx - r - 2); i <= cx + r + 2; i++) {
          const d = Math.hypot(i - cx, j - cy) / r + (fbm(i * 0.35, j * 0.35, seed) - 0.5) * 0.9;
          if (d < 1 && (!only || only.includes(g.get(i, j)))) g.set(i, j, c);
        }
    },
    path(pts, c, width = 1, only) {
      for (let k = 0; k < pts.length - 1; k++) {
        const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
        const n = Math.ceil(Math.hypot(bx - ax, by - ay) * 2);
        for (let s = 0; s <= n; s++) {
          const x = ax + ((bx - ax) * s) / n, y = ay + ((by - ay) * s) / n;
          for (let dy = -Math.floor((width - 1) / 2); dy <= Math.ceil((width - 1) / 2); dy++)
            for (let dx = -Math.floor((width - 1) / 2); dx <= Math.ceil((width - 1) / 2); dx++) {
              const xx = Math.round(x) + dx, yy = Math.round(y) + dy;
              if (!only || only.includes(g.get(xx, yy))) g.set(xx, yy, c);
            }
        }
      }
    },
    add(kind, x, y, extra = {}) {
      const o = { id: `o${g.objects.length + 1}`, kind, x, y, w: 1, h: 1, rot: 0, blocksMove: false, blocksSight: false, difficult: false, cover: null, light: null, hidden: false, label: null, ...extra };
      g.objects.push(o);
      return o;
    },
    light(x, y, bright = 20, dim = 20, color = '#ffb347', flicker = true) {
      g.lights.push({ id: `l${g.lights.length + 1}`, x, y, bright, dim, color, flicker });
    },
    done(meta) {
      return {
        kind: 'tactical',
        w,
        h,
        tiles: t.join(''),
        objects: g.objects,
        doors: g.doors,
        lights: g.lights,
        regions: g.regions,
        startZones: meta.startZones || { party: [], enemy: [], hidden: [], npc: [] },
        ...meta,
      };
    },
  };
  return g;
}

const free = (g, x, y) => {
  const c = g.get(x, y);
  return c !== '#' && c !== ' ' && c !== 'w' && c !== '+' && !g.objects.some((o) => x >= o.x && y >= o.y && x < o.x + (o.w || 1) && y < o.y + (o.h || 1));
};
function scatter(g, R, kind, n, pred, extra = {}) {
  let tries = 0, placed = 0;
  while (placed < n && tries++ < n * 40) {
    const x = R.int(0, g.w - 1), y = R.int(0, g.h - 1);
    if (!free(g, x, y) || (pred && !pred(x, y))) continue;
    g.add(kind, x, y, typeof extra === 'function' ? extra(x, y) : extra);
    placed++;
  }
}

// ------------------------------------------------------------------ showcase maps
export function villageMap(seed = 7) {
  const R = makeRand(seed);
  const g = Grid(34, 24, '"');
  g.path([[0, 12], [10, 11], [17, 12], [24, 10], [33, 11]], ',', 2);
  g.path([[16, 0], [17, 6], [17, 12], [15, 18], [14, 23]], ',', 2);
  g.rect(14, 9, 6, 5, '_');
  g.building(3, 3, 8, 6, '=', [[7, 4]], 'Miller’s house');
  g.building(22, 2, 7, 6, '=', [[3, 5]], 'The Pickled Toad');
  g.building(24, 15, 7, 6, '=', [[0, 2]], 'Smithy');
  g.building(4, 15, 6, 5, '=', [[3, 0, { open: true }]], 'Cottage');
  g.blob(9, 21, 2.2, '~', seed);
  g.blob(28, 22, 2.5, '%', seed + 4, ['"']);
  g.add('well', 16, 10, { blocksMove: true, label: 'Village well' });
  g.add('cart', 19, 13, { w: 2, h: 1, blocksMove: true, cover: 'half' });
  g.add('haybale', 12, 15);
  g.add('haybale', 12, 16);
  g.add('fence', 1, 13, { w: 3, h: 1 });
  g.add('fence', 11, 18, { w: 1, h: 3 });
  g.add('table', 23, 3, { w: 2, h: 1 });
  g.add('bar', 23, 6, { w: 3, h: 1 });
  g.add('fireplace', 27, 3, { light: { bright: 10, dim: 10, color: '#ff9a3c', flicker: true } });
  g.add('barrel', 27, 6);
  g.add('bed', 4, 4, { w: 1, h: 2 });
  g.add('table', 6, 6, { w: 2, h: 1 });
  g.add('chest', 9, 4);
  g.add('anvil', 27, 17, { blocksMove: true });
  g.add('forge', 28, 18, { w: 2, h: 1, light: { bright: 10, dim: 10, color: '#ff8a2a', flicker: true } });
  g.add('weapon_rack', 25, 19, { w: 2, h: 1 });
  g.add('bed', 5, 17, { w: 1, h: 2 });
  g.add('rug', 6, 16, { w: 2, h: 2 });
  for (const [x, y] of [[1, 1], [12, 2], [31, 1], [1, 20], [20, 20], [32, 7], [21, 15], [13, 6]]) g.add('tree', x, y, { blocksMove: true, blocksSight: true });
  scatter(g, R, 'bush', 9, (x, y) => g.get(x, y) === '"');
  scatter(g, R, 'rock', 3, (x, y) => g.get(x, y) === '"');
  g.add('sack', 20, 9);
  g.add('crate', 21, 9);
  g.light(17, 11, 20, 20, '#ffcf7a', true);
  return g.done({ id: 'fx_village', name: 'Thornbury Green', theme: 'village', seed, ambient: 'bright', startZones: { party: [[1, 11], [1, 12], [2, 11], [2, 12]], enemy: [[30, 10], [31, 11], [30, 12]], hidden: [[29, 22]], npc: [[17, 9]] } });
}

export function swampMap(seed = 11) {
  const R = makeRand(seed);
  const g = Grid(34, 24, '"');
  g.blob(17, 12, 9, '%', seed, ['"']);
  g.blob(10, 8, 4, '~', seed + 1);
  g.blob(23, 15, 5, '~', seed + 2);
  g.blob(24, 15, 2.6, 'w', seed + 3);
  g.blob(6, 18, 3, '~', seed + 4);
  g.path([[0, 4], [8, 7], [14, 12], [22, 13], [33, 20]], '~', 1);
  g.blob(17, 6, 2.2, ',', seed + 5);
  g.building(26, 3, 6, 5, '=', [[2, 4]], 'Witch’s hut');
  g.add('cauldron', 28, 5, { light: { bright: 5, dim: 10, color: '#7fe07a', flicker: true } });
  g.add('shelf', 27, 4, { w: 2, h: 1 });
  g.add('bones', 14, 15);
  g.add('bones', 20, 9);
  g.add('log', 12, 3, { w: 2, h: 1 });
  scatter(g, R, 'tree', 16, (x, y) => g.get(x, y) === '"' || g.get(x, y) === '%', { blocksMove: true, blocksSight: true });
  scatter(g, R, 'mushroom', 6, (x, y) => g.get(x, y) !== '~');
  scatter(g, R, 'bush', 8, (x, y) => g.get(x, y) === '"');
  g.add('campfire', 17, 6);
  return g.done({ id: 'fx_swamp', name: 'Mirewater Fen', theme: 'swamp', seed, ambient: 'dim', startZones: { party: [[1, 1], [2, 1], [1, 2], [2, 2]], enemy: [[30, 18], [31, 19], [29, 20]], hidden: [[18, 14]], npc: [[28, 6]] } });
}

export function shipMap(seed = 5) {
  const g = Grid(36, 18, ' ');
  // hull: an elongated hexagon
  for (let y = 2; y < 16; y++) {
    const d = Math.abs(y - 8.5);
    const x0 = 3 + Math.round(d * 0.5), x1 = 30 - Math.round(d * 0.25);
    const tip = 34 - Math.round(d * 1.15);
    for (let x = x0; x <= Math.max(x1, tip); x++) g.set(x, y, '=');
  }
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++) {
      if (g.get(x, y) !== '=') continue;
      const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => g.get(x + dx, y + dy) === ' ');
      if (edge) g.set(x, y, '#');
    }
  g.building(5, 5, 6, 8, '=', [[5, 3]], 'Captain’s cabin');
  g.add('mast', 15, 8, { w: 1, h: 1, blocksMove: true });
  g.add('mast', 24, 8, { blocksMove: true });
  g.add('barrel', 19, 4);
  g.add('barrel', 20, 4);
  g.add('barrel', 19, 13);
  g.add('crate', 21, 13);
  g.add('rope', 13, 4);
  g.add('rope', 27, 12);
  g.add('trapdoor', 18, 8);
  g.add('stairs_down', 12, 11, { w: 1, h: 2 });
  g.add('cannon', 16, 3, { label: 'Cannon' });
  g.add('cannon', 16, 14, { label: 'Cannon' });
  g.add('map_table', 7, 7, { w: 2, h: 1 });
  g.add('bed', 6, 10, { w: 1, h: 2 });
  g.add('chest', 9, 11);
  g.add('torch', 6, 6, { light: { bright: 10, dim: 10, color: '#ffb347', flicker: true } });
  g.light(30, 8, 15, 15, '#ffd08a', true);
  return g.done({ id: 'fx_ship', name: 'The Gull’s Revenge', theme: 'ship', seed, ambient: 'dim', startZones: { party: [[14, 6], [14, 10], [15, 6], [16, 10]], enemy: [[28, 7], [29, 9], [27, 10]], hidden: [[20, 5]], npc: [[8, 9]] } });
}

export function streetMap(seed = 3) {
  const R = makeRand(seed);
  const g = Grid(36, 24, '_');
  g.rect(0, 0, 9, 7, '#');
  g.rect(12, 0, 10, 6, '#');
  g.rect(25, 0, 11, 7, '#');
  g.rect(0, 16, 8, 8, '#');
  g.building(10, 16, 9, 8, '.', [[4, 0]], 'Apothecary');
  g.rect(22, 15, 14, 9, '#');
  g.add('fountain', 16, 10, { w: 2, h: 2, blocksMove: true, label: 'Fountain of the Twin Sisters' });
  g.add('tent', 4, 9, { w: 2, h: 2 });
  g.add('counter', 4, 12, { w: 2, h: 1 });
  g.add('tent', 27, 9, { w: 2, h: 2 });
  g.add('counter', 26, 12, { w: 3, h: 1 });
  g.add('cart', 22, 7, { w: 2, h: 1 });
  g.add('barrel', 9, 7);
  g.add('barrel', 10, 7);
  g.add('crate', 24, 7);
  g.add('sack', 7, 12);
  g.add('banner', 21, 9);
  g.add('shelf', 11, 17, { w: 3, h: 1 });
  g.add('table', 15, 19, { w: 2, h: 1 });
  g.add('bookshelf', 17, 17, { w: 1, h: 3 });
  g.add('rug', 12, 20, { w: 3, h: 2 });
  scatter(g, R, 'crate', 3, (x, y) => g.get(x, y) === '_' && (y < 8 || y > 13));
  g.light(16, 9, 20, 20, '#ffc872', true);
  g.light(4, 8, 10, 10, '#ffc872', true);
  g.light(29, 8, 10, 10, '#ffc872', true);
  return g.done({ id: 'fx_street', name: 'Lantern Market', theme: 'street', seed, ambient: 'dim', startZones: { party: [[0, 9], [0, 10], [1, 9], [1, 10]], enemy: [[34, 10], [34, 12], [33, 11]], hidden: [[21, 13]], npc: [[5, 13]] } });
}

export function templeMap(seed = 9) {
  const g = Grid(26, 22, ' ');
  g.building(1, 1, 24, 20, '.', [[11, 19], [12, 19]], 'Nave');
  g.rect(8, 1, 10, 1, '#');
  g.building(19, 3, 5, 6, '.', [[0, 3, { locked: true }]], 'Vestry');
  for (let y = 4; y <= 16; y += 4) {
    g.add('pillar', 6, y, { blocksMove: true, blocksSight: true });
    g.add('pillar', 17, y, { blocksMove: true, blocksSight: true });
  }
  for (let y = 9; y <= 16; y += 2) {
    g.add('pew', 8, y, { w: 3, h: 1 });
    g.add('pew', 13, y, { w: 3, h: 1 });
  }
  g.add('rug', 11, 5, { w: 2, h: 14 });
  g.add('altar', 10, 3, { w: 4, h: 1, label: 'Altar of the Dawnfather' });
  g.add('statue', 4, 2, { blocksMove: true });
  g.add('statue', 15, 2, { blocksMove: true });
  g.add('brazier', 9, 2, { light: { bright: 15, dim: 15, color: '#ffb05a', flicker: true } });
  g.add('brazier', 14, 2, { light: { bright: 15, dim: 15, color: '#ffb05a', flicker: true } });
  g.add('banner', 3, 9);
  g.add('banner', 3, 14);
  g.add('chest', 21, 4, { label: 'Offering chest' });
  g.add('bookshelf', 22, 6, { w: 1, h: 2 });
  g.add('idol', 2, 18, { label: 'Forgotten idol', hidden: true });
  return g.done({ id: 'fx_temple', name: 'Chapel of First Light', theme: 'temple', seed, ambient: 'dim', startZones: { party: [[11, 18], [12, 18], [11, 17], [12, 17]], enemy: [[10, 4], [13, 4], [11, 5]], hidden: [[3, 18]], npc: [[12, 4]] } });
}

export function campMap(seed = 13) {
  const R = makeRand(seed);
  const g = Grid(30, 22, '"');
  g.blob(15, 11, 6, ',', seed, ['"']);
  g.path([[0, 18], [8, 14], [15, 11], [24, 6], [29, 4]], ',', 2);
  g.blob(25, 18, 3, ':', seed + 2);
  g.blob(25, 18, 1.6, '~', seed + 3);
  g.add('campfire', 15, 11);
  g.add('log', 12, 10, { w: 1, h: 2, rot: 90 });
  g.add('log', 17, 12, { w: 1, h: 2, rot: 90 });
  g.add('log', 14, 13, { w: 2, h: 1 });
  g.add('tent', 10, 6, { w: 2, h: 2 });
  g.add('tent', 18, 6, { w: 2, h: 2 });
  g.add('tent', 9, 14, { w: 2, h: 3 });
  g.add('weapon_rack', 20, 10, { w: 2, h: 1 });
  g.add('cart', 21, 13, { w: 2, h: 2 });
  g.add('barrel', 13, 7);
  g.add('sack', 14, 7);
  g.add('palisade', 4, 3, { w: 6, h: 1 });
  g.add('palisade', 3, 4, { w: 1, h: 6 });
  scatter(g, R, 'tree', 18, (x, y) => g.get(x, y) === '"' && (Math.hypot(x - 15, y - 11) > 8), { blocksMove: true, blocksSight: true });
  scatter(g, R, 'bush', 10, (x, y) => g.get(x, y) === '"');
  scatter(g, R, 'rock', 4, (x, y) => g.get(x, y) === '"');
  return g.done({ id: 'fx_camp', name: 'Bandit Camp at Wolfhollow', theme: 'camp', seed, ambient: 'dark', startZones: { party: [[0, 17], [1, 17], [0, 18], [1, 18]], enemy: [[15, 9], [16, 10], [12, 12], [18, 9]], hidden: [[22, 4]], npc: [[15, 13]] } });
}

/** Every terrain char next to each other, for checking transitions. */
export function terrainSampler(theme = 'forest', seed = 21) {
  const outdoor = !['dungeon', 'crypt', 'cave', 'mine', 'castle', 'temple', 'tavern'].includes(theme);
  const g = Grid(34, 24, outdoor ? '"' : '.');
  if (!outdoor) {
    g.rect(0, 0, 34, 1, '#');
    g.rect(0, 23, 34, 1, '#');
    g.rect(0, 0, 1, 24, '#');
    g.rect(33, 0, 1, 24, '#');
  }
  g.blob(6, 6, 3.5, ',', seed);
  g.blob(13, 5, 3, ':', seed + 1);
  g.blob(22, 6, 3.5, '%', seed + 2);
  g.path([[2, 13], [10, 12], [18, 15], [26, 13], [32, 15]], '~', 2);
  g.blob(18, 15, 2.2, 'w', seed + 3);
  g.rect(3, 17, 9, 2, '_');
  g.blob(28, 4, 3, '#', seed + 4);
  g.building(20, 17, 9, 6, '=', [[0, 2], [4, 0, { open: true }], [8, 3, { locked: true }]], 'Lodge');
  g.add('table', 23, 19, { w: 2, h: 1 });
  g.add('fireplace', 27, 18);
  g.add('torch', 21, 18, { light: { bright: 10, dim: 10, color: '#ffb347', flicker: true } });
  if (outdoor) for (const [x, y] of [[2, 2], [9, 20], [31, 10], [15, 21]]) g.add('tree', x, y, { blocksMove: true });
  else for (const [x, y] of [[4, 4], [9, 9], [24, 10], [15, 20]]) g.add('pillar', x, y, { blocksMove: true });
  g.light(10, 10, 20, 20, '#ffb347', true);
  return g.done({ id: `fx_terrain_${theme}`, name: `Terrain sampler (${theme})`, theme, seed, ambient: outdoor ? 'bright' : 'dim', startZones: { party: [[2, 9], [3, 9], [2, 10], [3, 10]], enemy: [[30, 18], [31, 19]], hidden: [[24, 6]], npc: [[24, 20]] } });
}

/** Every known object kind laid out on a stone floor (labels = kind names). */
export function objectGallery() {
  const kinds = [...OBJECT_KINDS, 'cannon'];
  const big = { table: [2, 1], bed: [1, 2], cart: [2, 2], tent: [2, 2], bar: [3, 1], counter: [2, 1], bookshelf: [2, 1], shelf: [2, 1], fence: [3, 1], palisade: [3, 1], ruin_wall: [3, 1], log: [2, 1], rug: [2, 2], throne: [2, 2], coffin: [1, 2], sarcophagus: [1, 2], pew: [3, 1], bench: [2, 1], altar: [2, 1], forge: [2, 1], weapon_rack: [2, 1], map_table: [2, 2], stairs_up: [1, 2], stairs_down: [1, 2], tree: [2, 2], boulder: [2, 2], fountain: [2, 2], well: [1, 1], cage: [2, 2], haybale: [2, 1] };
  const cols = 8, slot = 4;
  const rows = Math.ceil(kinds.length / cols);
  const g = Grid(cols * slot + 1, rows * slot + 1, '.');
  kinds.forEach((k, i) => {
    const cx = (i % cols) * slot + 1, cy = Math.floor(i / cols) * slot + 1;
    const [w, h] = big[k] || [1, 1];
    const extra = { w, h, label: k };
    if (['brazier', 'torch', 'campfire', 'fireplace', 'forge', 'crystal', 'cauldron'].includes(k)) extra.light = { bright: 5, dim: 5, color: k === 'crystal' ? '#7fd8ff' : k === 'cauldron' ? '#7fe07a' : '#ff9a3c', flicker: k !== 'crystal' };
    g.add(k, cx + Math.floor((3 - w) / 2), cy + Math.floor((3 - h) / 2), extra);
  });
  return g.done({ id: 'fx_gallery', name: 'Object gallery', theme: 'dungeon', seed: 99, ambient: 'bright', startZones: { party: [[0, 0]], enemy: [], hidden: [], npc: [] } });
}

export const FIXTURE_MAPS = {
  'fixture: village': () => villageMap(),
  'fixture: swamp': () => swampMap(),
  'fixture: ship': () => shipMap(),
  'fixture: street': () => streetMap(),
  'fixture: temple': () => templeMap(),
  'fixture: camp': () => campMap(),
  'fixture: terrain (forest)': () => terrainSampler('forest'),
  'fixture: terrain (cave)': () => terrainSampler('cave'),
  'fixture: terrain (crypt)': () => terrainSampler('crypt'),
  'fixture: object gallery': () => objectGallery(),
};

// ------------------------------------------------------------------ tokens
const PARTY = [
  { id: 'pc_mira', name: 'Mira Thistledown', initials: 'MT', color: '#3e6a9a', hp: { cur: 23, max: 31, temp: 5 }, conditions: ['concentrating'], isMine: true },
  { id: 'pc_bram', name: 'Bram Ironfist', initials: 'BI', color: '#8a5a2a', hp: { cur: 9, max: 38, temp: 0 }, conditions: ['poisoned', 'prone'] },
  { id: 'pc_syl', name: 'Sylvara', initials: 'Sy', color: '#4a7a4a', hp: { cur: 27, max: 27, temp: 0 }, conditions: [] },
  { id: 'pc_osk', name: 'Brother Oskar', initials: 'BO', color: '#7a6a3a', hp: { cur: 0, max: 30, temp: 0 }, conditions: ['unconscious'], health: 'down' },
];

/** Build demo tokens for a map, using startZones when present and a free-cell search otherwise. */
export function sampleTokens(map) {
  const blocked = new Set();
  const isFree = (x, y, size = 1) => {
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= map.w || yy >= map.h) return false;
        const c = map.tiles[yy * map.w + xx];
        if ('#w +'.includes(c) && c !== '+') return false;
        if (c === '+') return false;
        if (blocked.has(`${xx},${yy}`)) return false;
        if ((map.objects || []).some((o) => o.blocksMove !== false && ['tree', 'pillar', 'boulder', 'statue', 'well', 'mast', 'fountain', 'table', 'bar', 'counter', 'cart', 'tent', 'bed', 'barrel', 'crate', 'altar', 'stalagmite', 'throne', 'sarcophagus', 'coffin', 'bookshelf', 'shelf', 'fireplace', 'forge', 'anvil', 'cage', 'weapon_rack', 'pew'].includes(o.kind) && xx >= o.x && yy >= o.y && xx < o.x + (o.w || 1) && yy < o.y + (o.h || 1))) return false;
      }
    return true;
  };
  const near = (pts, size = 1) => {
    const seeds = pts && pts.length ? pts : [[Math.floor(map.w / 2), Math.floor(map.h / 2)]];
    for (const [sx, sy] of seeds) {
      for (let r = 0; r < 12; r++)
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            const x = sx + dx, y = sy + dy;
            if (isFree(x, y, size)) {
              for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) blocked.add(`${x + i},${y + j}`);
              return [x, y];
            }
          }
    }
    return [0, 0];
  };
  const z = map.startZones || {};
  const out = [];
  for (const p of PARTY) {
    const [x, y] = near(z.party);
    out.push({ kind: 'pc', size: 1, img: null, health: p.health || (p.hp.cur / p.hp.max < 0.5 ? 'bloodied' : p.hp.cur < p.hp.max ? 'hurt' : 'unhurt'), isTurn: false, hidden: false, outOfSight: false, ...p, x, y });
  }
  out[0].isTurn = true;
  const ally = { id: 'ally_pip', name: 'Pip the Hound', initials: 'Pip', kind: 'ally', color: '#6a5a3a', size: 1, img: null, health: 'unhurt', hp: { cur: 11, max: 11, temp: 0 }, conditions: [], outOfSight: true };
  const [ax, ay] = near(z.hidden && z.hidden.length ? [[z.hidden[0][0] - 2, z.hidden[0][1]]] : null);
  out.push({ ...ally, x: ax, y: ay });
  const foes = [
    { id: 'en_g1', name: 'Goblin Cutthroat', initials: 'G1', health: 'unhurt', conditions: [] },
    { id: 'en_g2', name: 'Goblin Archer', initials: 'G2', health: 'bloodied', conditions: ['frightened'] },
    { id: 'en_g3', name: 'Goblin Shaman', initials: 'G3', health: 'critical', conditions: ['restrained'] },
    { id: 'en_g4', name: 'Goblin (slain)', initials: 'G4', health: 'dead', conditions: [] },
  ];
  for (const f of foes) {
    const [x, y] = near(z.enemy);
    out.push({ kind: 'enemy', color: '#6a2a22', size: 1, img: null, hp: null, isMine: false, isTurn: false, hidden: false, outOfSight: false, ...f, x, y });
  }
  const [ox, oy] = near(z.enemy, 2);
  out.push({ id: 'en_ogre', name: 'Grukk the Ogre', initials: 'OG', kind: 'enemy', color: '#4a5a2a', size: 2, x: ox, y: oy, img: null, health: 'hurt', hp: null, conditions: [], hidden: false });
  const [hx, hy] = near(z.hidden);
  out.push({ id: 'en_lurker', name: 'Lurking Assassin', initials: 'As', kind: 'enemy', color: '#2a2a3a', size: 1, x: hx, y: hy, img: null, health: 'unhurt', hp: null, conditions: ['invisible'], hidden: true });
  const [nx, ny] = near(z.npc);
  out.push({ id: 'npc_ada', name: 'Old Ada', initials: 'Ad', kind: 'npc', color: '#7a6a5a', size: 1, x: nx, y: ny, img: null, health: null, hp: null, conditions: [] });
  return out;
}

// ------------------------------------------------------------------ area maps
export const AREA_FIXTURES = {
  town: {
    id: 'area_millbrook',
    kind: 'area',
    style: 'town',
    name: 'Millbrook',
    seed: 777,
    description: 'A mill town on the Wend river',
    features: { river: 'ns', coast: null, walls: false, forest: 0.45, hills: 0.2, roads: ['w', 'e', 's'] },
    locations: [
      { id: 'loc_square', name: 'Market Square', kind: 'square', x: 0.48, y: 0.5, description: 'Cobbled square with a weathered statue', secret: false },
      { id: 'loc_inn', name: 'The Drowned Rat', kind: 'tavern', x: 0.56, y: 0.44, description: 'Low-beamed inn by the bridge', secret: false },
      { id: 'loc_mill', name: 'Old Mill', kind: 'mill', x: 0.62, y: 0.3, description: 'The waterwheel still turns', secret: false },
      { id: 'loc_bridge', name: 'Wend Bridge', kind: 'bridge', x: 0.6, y: 0.52, description: 'Three stone arches', secret: false },
      { id: 'loc_temple', name: 'Shrine of Chauntea', kind: 'temple', x: 0.38, y: 0.38, description: 'Harvest goddess shrine', secret: false },
      { id: 'loc_smith', name: 'Hob’s Smithy', kind: 'smithy', x: 0.4, y: 0.6, description: '', secret: false },
      { id: 'loc_manor', name: 'Vellan Manor', kind: 'manor', x: 0.27, y: 0.25, description: 'The reeve’s house on the hill', secret: false },
      { id: 'loc_grave', name: 'Hollow Hill Graves', kind: 'graveyard', x: 0.22, y: 0.7, description: '', secret: false },
      { id: 'loc_farm', name: 'Tuck’s Farm', kind: 'farm', x: 0.8, y: 0.74, description: '', secret: false },
      { id: 'loc_shop', name: 'Pell & Daughters', kind: 'shop', x: 0.5, y: 0.62, description: 'General goods', secret: false },
      { id: 'loc_cellar', name: 'Smugglers’ Cellar', kind: 'dungeon', x: 0.66, y: 0.6, description: 'Under the warehouse', secret: true },
    ],
    connections: [['loc_square', 'loc_inn'], ['loc_inn', 'loc_bridge'], ['loc_square', 'loc_temple'], ['loc_square', 'loc_smith'], ['loc_temple', 'loc_manor'], ['loc_smith', 'loc_grave'], ['loc_bridge', 'loc_farm'], ['loc_inn', 'loc_mill'], ['loc_square', 'loc_shop']],
  },
  city: {
    id: 'area_saltmere',
    kind: 'area',
    style: 'city',
    name: 'Saltmere',
    seed: 4242,
    description: 'A walled port city',
    features: { river: 'ew', coast: 's', walls: true, forest: 0.1, hills: 0.1, roads: ['n', 'w', 'e'] },
    locations: [
      { id: 'c_castle', name: 'Saltmere Keep', kind: 'castle', x: 0.5, y: 0.22, description: '', secret: false },
      { id: 'c_market', name: 'Grand Market', kind: 'market', x: 0.47, y: 0.47, description: '', secret: false },
      { id: 'c_docks', name: 'The Docks', kind: 'dock', x: 0.55, y: 0.78, description: '', secret: false },
      { id: 'c_guild', name: 'Mages’ Guild', kind: 'guild', x: 0.66, y: 0.35, description: '', secret: false },
      { id: 'c_temple', name: 'Cathedral of Light', kind: 'temple', x: 0.33, y: 0.36, description: '', secret: false },
      { id: 'c_gateN', name: 'North Gate', kind: 'gate', x: 0.47, y: 0.08, description: '', secret: false },
      { id: 'c_library', name: 'Archive', kind: 'library', x: 0.7, y: 0.55, description: '', secret: false },
      { id: 'c_jail', name: 'The Stocks', kind: 'jail', x: 0.3, y: 0.58, description: '', secret: false },
      { id: 'c_tavern', name: 'The Salty Hag', kind: 'tavern', x: 0.42, y: 0.66, description: '', secret: false },
      { id: 'c_barracks', name: 'Barracks', kind: 'barracks', x: 0.62, y: 0.18, description: '', secret: false },
      { id: 'c_tower', name: 'Lighthouse', kind: 'tower', x: 0.82, y: 0.82, description: '', secret: false },
    ],
    connections: [['c_gateN', 'c_castle'], ['c_castle', 'c_market'], ['c_market', 'c_docks'], ['c_market', 'c_guild'], ['c_market', 'c_temple'], ['c_market', 'c_tavern'], ['c_market', 'c_library'], ['c_temple', 'c_jail'], ['c_castle', 'c_barracks'], ['c_docks', 'c_tower']],
  },
  village: {
    id: 'area_thornbury',
    kind: 'area',
    style: 'village',
    name: 'Thornbury',
    seed: 99,
    description: 'Sleepy hamlet at the forest edge',
    features: { river: null, coast: null, walls: false, forest: 0.7, hills: 0.3, roads: ['n', 's'] },
    locations: [
      { id: 'v_green', name: 'The Green', kind: 'square', x: 0.5, y: 0.5, description: '', secret: false },
      { id: 'v_inn', name: 'The Pickled Toad', kind: 'inn', x: 0.58, y: 0.42, description: '', secret: false },
      { id: 'v_shrine', name: 'Wayside Shrine', kind: 'shrine', x: 0.4, y: 0.58, description: '', secret: false },
      { id: 'v_well', name: 'Old Well', kind: 'well', x: 0.5, y: 0.56, description: '', secret: false },
      { id: 'v_farm', name: 'Barrow Farm', kind: 'farm', x: 0.72, y: 0.7, description: '', secret: false },
      { id: 'v_stable', name: 'Stables', kind: 'stable', x: 0.36, y: 0.42, description: '', secret: false },
    ],
    connections: [['v_green', 'v_inn'], ['v_green', 'v_shrine'], ['v_green', 'v_farm'], ['v_green', 'v_stable']],
  },
  region: {
    id: 'area_wendmarch',
    kind: 'area',
    style: 'region',
    name: 'The Wendmarch',
    seed: 31337,
    description: 'Borderland between the Greywood and the sea',
    features: { river: 'ns', coast: 'e', walls: false, forest: 0.55, hills: 0.5, roads: ['w', 's'] },
    locations: [
      { id: 'r_mill', name: 'Millbrook', kind: 'town', x: 0.45, y: 0.55, description: 'Mill town on the Wend', secret: false },
      { id: 'r_salt', name: 'Saltmere', kind: 'city', x: 0.78, y: 0.42, description: 'Walled port city', secret: false },
      { id: 'r_thorn', name: 'Thornbury', kind: 'village', x: 0.3, y: 0.3, description: '', secret: false },
      { id: 'r_tower', name: 'Wizard’s Spire', kind: 'tower', x: 0.62, y: 0.2, description: '', secret: false },
      { id: 'r_barrow', name: 'Barrow of the Ash King', kind: 'dungeon', x: 0.2, y: 0.72, description: 'Ancient tomb', secret: false },
      { id: 'r_cave', name: 'Wyrmhole', kind: 'cave', x: 0.15, y: 0.18, description: '', secret: true },
      { id: 'r_cross', name: 'Gallows Cross', kind: 'crossroads', x: 0.4, y: 0.82, description: '', secret: false },
      { id: 'r_ruins', name: 'Ruins of Kael', kind: 'ruins', x: 0.6, y: 0.75, description: '', secret: false },
      { id: 'r_lake', name: 'Mirrormere', kind: 'lake', x: 0.27, y: 0.48, description: '', secret: false },
      { id: 'r_mtn', name: 'Greyfang Peaks', kind: 'mountain', x: 0.12, y: 0.38, description: '', secret: false },
      { id: 'r_camp', name: 'Ranger Camp', kind: 'camp', x: 0.52, y: 0.36, description: '', secret: false },
    ],
    connections: [['r_mill', 'r_salt'], ['r_mill', 'r_thorn'], ['r_mill', 'r_cross'], ['r_cross', 'r_barrow'], ['r_salt', 'r_tower'], ['r_mill', 'r_ruins'], ['r_thorn', 'r_camp'], ['r_camp', 'r_tower']],
  },
  dungeon: {
    id: 'area_barrow',
    kind: 'area',
    style: 'dungeon',
    name: 'Barrow of the Ash King',
    seed: 666,
    description: 'Three-level tomb complex',
    features: { river: null, coast: null, walls: false, forest: 0, hills: 0, roads: ['s'] },
    locations: [
      { id: 'd_entry', name: 'Collapsed Entry', kind: 'room', x: 0.5, y: 0.85, description: '', secret: false },
      { id: 'd_hall', name: 'Hall of Urns', kind: 'room', x: 0.5, y: 0.62, description: '', secret: false },
      { id: 'd_guard', name: 'Guard Post', kind: 'room', x: 0.25, y: 0.66, description: '', secret: false },
      { id: 'd_well', name: 'Bone Well', kind: 'well', x: 0.76, y: 0.68, description: '', secret: false },
      { id: 'd_chapel', name: 'Ash Chapel', kind: 'temple', x: 0.5, y: 0.38, description: '', secret: false },
      { id: 'd_crypt', name: 'Royal Crypt', kind: 'graveyard', x: 0.5, y: 0.14, description: 'The Ash King sleeps', secret: false },
      { id: 'd_vault', name: 'Hidden Vault', kind: 'room', x: 0.8, y: 0.3, description: '', secret: true },
      { id: 'd_cells', name: 'Prison Cells', kind: 'jail', x: 0.2, y: 0.36, description: '', secret: false },
      { id: 'd_portal', name: 'Black Mirror', kind: 'portal', x: 0.22, y: 0.14, description: '', secret: false },
    ],
    connections: [['d_entry', 'd_hall'], ['d_hall', 'd_guard'], ['d_hall', 'd_well'], ['d_hall', 'd_chapel'], ['d_chapel', 'd_crypt'], ['d_chapel', 'd_vault'], ['d_chapel', 'd_cells'], ['d_cells', 'd_portal']],
  },
};
