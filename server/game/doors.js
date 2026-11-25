// Doors on battle maps, and the parts of a map still shut away behind them.
// Pure ESM (no imports): the server and the browser both use it.
//
// A door: { x, y, open, locked, secret, to? } on a '+' tile set in a wall. Closed doors block sight (vision.js) and
// movement (a character opens one by walking into it or clicking it). What lies behind a closed door nobody has opened
// yet - even how big it is - is not sent to the players: map.revealed marks every cell they know the shape of, and
// grows from where the party stands through open floor and open doors. Maps made before that (no `revealed`) show
// everything, as they always did.

const DIR4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function doorAt(map, x, y) {
  return (map?.doors || []).find((d) => d.x === x && d.y === y) || null;
}

/** The state a player sees: "open", "closed", "locked" (a secret door is "secret"). */
export function doorState(d) {
  return d.secret ? 'secret' : d.open ? 'open' : d.locked ? 'locked' : 'closed';
}

const openViews = new WeakMap();
/**
 * The map as it would be with every door that can simply be opened standing open (and, with `locked`, locked ones
 * too; secret doors stay shut). For routes that open doors on the way: an enemy shouldering through, the DM moving
 * someone, "walk up to that door". Cached per map and door state.
 */
export function withDoorsOpen(map, { locked = false } = {}) {
  if (!map) return map;
  const key = (map.doors || []).map((d) => `${d.x},${d.y}${d.open ? 'o' : ''}${d.locked ? 'l' : ''}${d.secret ? 's' : ''}`).join(';');
  let per = openViews.get(map);
  if (!per) openViews.set(map, (per = {}));
  const slot = locked ? 'L' : 'U';
  const hit = per[slot];
  if (hit && hit.key === key && hit.tiles === map.tiles && hit.objects === map.objects && hit.w === map.w) return hit.view;
  const view = { ...map, doors: (map.doors || []).map((d) => (d.secret || (d.locked && !locked) || d.open ? d : { ...d, open: true, locked: false })) };
  per[slot] = { key, tiles: map.tiles, objects: map.objects, w: map.w, view };
  return view;
}

function closedCells(map) {
  const s = new Set();
  for (const d of map.doors || []) if (!d.open || d.secret) s.add(d.y * map.w + d.x);
  return s;
}

/** A fresh `revealed` string: nothing known yet. */
export function blankRevealed(map) {
  return '0'.repeat(map.w * map.h);
}

/**
 * Grow what the players know of the map (map.revealed, "0"/"1" per cell) from `seeds` ([[x, y], ...]: where the party
 * stands) and from everything already known, through every cell that isn't a wall or a closed door. A closed door
 * itself becomes known (you see the door), what is behind it doesn't. Known stays known when a door closes again.
 * Returns true when anything new was revealed.
 */
export function revealFrom(map, seeds = []) {
  if (!map || typeof map.revealed !== 'string') return false;
  const { w, h } = map;
  const n = w * h;
  const tiles = map.tiles || '';
  const rev = new Uint8Array(n);
  const src = map.revealed;
  for (let i = 0; i < n; i++) rev[i] = src.charCodeAt(i) === 49 ? 1 : 0;
  const closed = closedCells(map);
  const q = [];
  let changed = src.length !== n;
  for (let i = 0; i < n; i++) if (rev[i] && tiles[i] !== '#' && !closed.has(i)) q.push(i);
  for (const [x, y] of seeds || []) {
    if (!(x >= 0 && y >= 0 && x < w && y < h)) continue;
    const i = y * w + x;
    if (tiles[i] === '#') continue;
    if (!rev[i]) {
      rev[i] = 1;
      changed = true;
    }
    if (!closed.has(i)) q.push(i);
  }
  for (let k = 0; k < q.length; k++) {
    const i = q[k];
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of DIR4) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (rev[j] || tiles[j] === '#') continue;
      rev[j] = 1;
      changed = true;
      if (!closed.has(j)) q.push(j);
    }
  }
  if (changed) {
    let s = '';
    for (let i = 0; i < n; i++) s += rev[i] ? '1' : '0';
    map.revealed = s;
  }
  return changed;
}

/** Per cell: 1 = still hidden from the players (behind a door nobody has opened). null when the map hides nothing. */
export function hiddenCells(map) {
  if (!map || typeof map.revealed !== 'string') return null;
  const n = map.w * map.h;
  const out = new Uint8Array(n);
  let any = false;
  for (let i = 0; i < n; i++) {
    if (map.revealed.charCodeAt(i) !== 49 && map.tiles[i] !== '#') {
      out[i] = 1;
      any = true;
    }
  }
  return any ? out : null;
}

/** True when every open cell of the rectangle is still hidden (an area nobody has seen into yet). */
export function areaHidden(map, hide, r) {
  if (!hide) return false;
  let open = 0;
  for (let y = r.y; y < r.y + r.h; y++) {
    for (let x = r.x; x < r.x + r.w; x++) {
      if (x < 0 || y < 0 || x >= map.w || y >= map.h) continue;
      const i = y * map.w + x;
      if (map.tiles[i] === '#') continue;
      open++;
      if (!hide[i]) return false;
    }
  }
  return open > 0;
}

const norm = (s) => String(s || '').toLowerCase().replace(/^\s*(the|a|an)\s+/, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** The named areas (regions) a name means: "Alcove 3" -> that one; "alcoves" / "alcove" -> every numbered alcove. */
export function regionsNamed(map, name) {
  const want = norm(name);
  if (!want) return [];
  const regs = map?.regions || [];
  const exact = regs.filter((r) => norm(r.name) === want);
  if (exact.length) return exact;
  const one = want.replace(/(?<=[^s])s$/, '');
  const num = (r) => Number(/\s(\d+)$/.exec(r.name)?.[1] || 0);
  const group = regs.filter((r) => norm(r.name).replace(/\s+\d+$/, '') === one || norm(r.name).replace(/\s+\d+$/, '') === want).sort((a, b) => num(a) - num(b));
  if (group.length) return group;
  return regs.filter((r) => norm(r.name).startsWith(want) || norm(r.name).includes(want));
}

const inRect = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;

/** The areas on either side of a door, e.g. ["Chamber", "Alcove 3"] (the room it leads into is d.to when known). */
export function doorSides(map, d) {
  const out = [];
  for (const [dx, dy] of DIR4) {
    const r = (map.regions || []).find((rr) => inRect(rr, d.x + dx, d.y + dy));
    if (r && !out.includes(r.name)) out.push(r.name);
  }
  return out;
}

/**
 * The door the DM means: "x,y", or the room it leads into ("Alcove 3", "the back room", "door to the cellar").
 * Returns null when nothing fits.
 */
export function findDoor(map, text) {
  if (!map) return null;
  const s = String(text || '').trim();
  const m = /^\(?\s*(-?\d+)\s*,\s*(-?\d+)\s*\)?$/.exec(s);
  if (m) return doorAt(map, Number(m[1]), Number(m[2]));
  const name = s.replace(/^(the\s+)?(door|doors|gate|way)\s+(to|into|of|for|in)\s+/i, '').replace(/\s+(door|doors|gate)$/i, '');
  const want = norm(name);
  if (!want) return null;
  const doors = map.doors || [];
  const byTo = doors.find((d) => d.to && norm(d.to) === want);
  if (byTo) return byTo;
  const regs = regionsNamed(map, name);
  if (regs.length !== 1) return null;
  const r = regs[0];
  // a door in the ring of wall around that area, preferring one that is shut (the one worth opening)
  const ring = doors.filter((d) => d.x >= r.x - 1 && d.x <= r.x + r.w && d.y >= r.y - 1 && d.y <= r.y + r.h && !inRect(r, d.x, d.y));
  return ring.find((d) => !d.open) || ring[0] || null;
}

/** Chebyshev distance from a creature's footprint (x, y, size) to a cell. */
export function reachToCell(tok, x, y) {
  const s = Math.max(1, tok.size || 1);
  const gx = Math.max(0, x - (tok.x + s - 1), tok.x - x);
  const gy = Math.max(0, y - (tok.y + s - 1), tok.y - y);
  return Math.max(gx, gy);
}
