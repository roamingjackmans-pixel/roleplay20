// Room layouts the Dungeon Master describes: a main room, and rooms, alcoves and corridors that each open off another
// one through a door set in the wall they share. The planner turns that description into rectangles on a grid; mapgen
// builds the walls, doors and furniture from the plan. Pure ESM with no Node-only imports (the browser demo imports
// mapgen). Deterministic: no randomness here at all.
//
// A room: { name, count, w, h, parent, wall, at, door }
//   name    "Alcove", "Back room", "Cell" ... (count > 1 numbers them: "Alcove 1" ... "Alcove 7")
//   w, h    size in feet, east-west by north-south (0 = a usual size for the name)
//   parent  the room it opens off ("" = the main room). For the main room itself, wall/at/door describe the way in.
//   wall    n / s / e / w: which wall of the parent it is on ("any" = wherever it fits, spread around the walls)
//   at      where along that wall: middle, or an end (west / east on a north or south wall, north / south on an east or
//           west wall); "auto" spreads several rooms evenly
//   door    none (an open archway), open, closed, locked or secret

export const DOOR_STATES = ['none', 'open', 'closed', 'locked', 'secret'];
const WALL_WORDS = { n: 'n', north: 'n', top: 'n', s: 's', south: 's', bottom: 's', e: 'e', east: 'e', right: 'e', w: 'w', west: 'w', left: 'w' };
const AT_WORDS = { auto: 'auto', any: 'auto', middle: 'middle', centre: 'middle', center: 'middle', mid: 'middle', north: 'north', n: 'north', south: 'south', s: 'south', east: 'east', e: 'east', west: 'west', w: 'west' };
const DOOR_WORDS = {
  none: 'none', no: 'none', 'no door': 'none', arch: 'none', archway: 'none', opening: 'none', doorway: 'none', open_arch: 'none', gap: 'none',
  open: 'open', ajar: 'open', closed: 'closed', shut: 'closed', door: 'closed', locked: 'locked', barred: 'locked', sealed: 'locked', secret: 'secret', hidden: 'secret',
};
const OPP = { n: 's', s: 'n', e: 'w', w: 'e' };
const WALLS = ['n', 'e', 's', 'w'];
export const MAX_W = 80;
export const MAX_H = 60;
const MAX_ROOMS = 24;

const clampInt = (v, a, b, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(b, Math.max(a, n)) : d;
};
const NUMBER_WORDS = /^(the|some|a|an|\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|several|many|few)\s+/i;

/** "seven alcoves" -> "Alcove", "Cells" -> "Cell", "Back room" stays. */
export function singular(name) {
  let n = String(name || '').replace(/\s+/g, ' ').trim().replace(NUMBER_WORDS, '');
  if (/[^s]s$/i.test(n) && !/(ss|us|is)$/i.test(n)) n = n.slice(0, -1);
  return n.charAt(0).toUpperCase() + n.slice(1);
}

/** Tidy the DM's list (forgiving about spellings): at most 24 rooms in all, 12 of a kind. */
export function normaliseRooms(list) {
  const out = [];
  let total = 0;
  for (const r of Array.isArray(list) ? list : []) {
    const name = String(r?.name || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!name) continue;
    const count = clampInt(r.count, 1, 12, 1);
    if (total + count > MAX_ROOMS) break;
    total += count;
    const feet = (v) => {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? Math.min(30, Math.max(1, Math.round(n / 5))) : 0;
    };
    out.push({
      name,
      count,
      w: feet(r.w),
      h: feet(r.h),
      parent: String(r.parent || '').replace(/\s+/g, ' ').trim(),
      wall: WALL_WORDS[String(r.wall || '').toLowerCase().trim()] || 'any',
      at: AT_WORDS[String(r.at ?? '').toLowerCase().trim()] || 'auto',
      door: DOOR_WORDS[String(r.door || '').toLowerCase().trim().replace(/\s+/g, ' ')] || '',
    });
  }
  return out;
}

// what a room is, from its name: decides its usual size (and, in mapgen, its furniture)
const SMALL = /\b(alcoves?|niches?|nooks?|closets?|cupboards?|privy|privies|booths?|stalls?)\b/i;
const CELL = /\b(cells?|pantry|pantries|larders?|vestibules?|cubicles?)\b/i;
const CORRIDOR = /\b(corridors?|passages?|passageways?|hallways?|tunnels?|galler(y|ies)|walkways?|halls? way)\b/i;
const BIG = /\b(great|grand|throne|nave|ballroom|courtyard|warehouse|barracks|dining|feast|common room|taproom|tap room|cavern|halls?)\b/i;

/** Usual size in cells: [along the wall it opens off, away from it] (for the main room: [east-west, north-south]). */
function usualSize(name, main) {
  if (CORRIDOR.test(name)) return main ? [12, 2] : [2, 6];
  if (SMALL.test(name)) return [2, 2];
  if (CELL.test(name)) return [2, 3];
  if (BIG.test(name)) return main ? [10, 8] : [7, 6];
  return main ? [8, 6] : [5, 4];
}

function expand(groups) {
  const totals = new Map();
  for (const g of groups) totals.set(singular(g.name).toLowerCase(), (totals.get(singular(g.name).toLowerCase()) || 0) + g.count);
  const seen = new Map();
  const rooms = [];
  groups.forEach((g, gi) => {
    const key = singular(g.name).toLowerCase();
    for (let i = 0; i < g.count; i++) {
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      rooms.push({ ...g, name: totals.get(key) > 1 ? `${singular(g.name)} ${n}` : g.name, base: singular(g.name), group: gi });
    }
  });
  return rooms;
}

// along/depth <-> east-west/north-south for a room on a given wall of its parent
const dimsOn = (wall, along, depth) => (wall === 'n' || wall === 's' ? [along, depth] : [depth, along]);
const alongOf = (r) => (r.wall === 'n' || r.wall === 's' ? r.w : r.h);
const wallLen = (r, wall) => (wall === 'n' || wall === 's' ? r.w : r.h);

/** Rectangles overlap (interiors), with `pad` cells of clearance around a. */
const hits = (a, b, pad = 1) => a.x - pad < b.x + b.w && b.x < a.x + a.w + pad && a.y - pad < b.y + b.h && b.y < a.y + a.h + pad;

/**
 * planLayout(rooms, { indoor }) -> plan | null
 * plan: { w, h, indoor, rooms: [{ name, base, x, y, w, h, parent, wall, door: { x, y, state, width, horizontal } | null }],
 *         entrance: { x, y, wall, state, width }, out: [[x, y], ...] cells from the way in to the map's edge, dropped: [names] }
 * Room rectangles are interiors; walls are the ring of cells around them (shared between neighbours).
 */
export function planLayout(list, opts = {}) {
  const groups = normaliseRooms(list);
  if (!groups.length) return null;
  let scale = 1;
  let plan = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    plan = tryPlan(groups, { ...opts, scale });
    if (plan.w <= MAX_W && plan.h <= MAX_H) return plan;
    scale *= 0.75; // too big for a battle map: shrink every room and try again
  }
  return cropPlan(plan);
}

function tryPlan(groups, { indoor = true, scale = 1 }) {
  const rooms = expand(groups);
  const sc = (n) => (n ? Math.max(1, Math.round(n * scale)) : 0);
  // the main room: the first one that opens off nothing (or simply the first)
  const rootIdx = Math.max(0, rooms.findIndex((r) => !r.parent));
  const root = rooms[rootIdx];
  if (rootIdx > 0) {
    rooms.splice(rootIdx, 1);
    rooms.unshift(root);
  }
  root.parentIdx = -1;
  root.entranceWall = root.wall === 'any' ? 's' : root.wall;
  root.entranceAt = root.at;
  root.door = root.door || 'none';
  const byName = (name) => {
    const n = name.toLowerCase();
    let i = rooms.findIndex((r) => r.name.toLowerCase() === n);
    if (i < 0) i = rooms.findIndex((r) => r.base.toLowerCase() === singular(name).toLowerCase());
    return i;
  };
  for (let i = 1; i < rooms.length; i++) {
    const r = rooms[i];
    let p = r.parent ? byName(r.parent) : 0;
    if (p < 0 || p === i) p = 0;
    r.parentIdx = p;
    r.door = r.door || 'closed';
  }
  // no loops: a room whose chain of parents never reaches the main room opens off the main room instead
  for (let i = 1; i < rooms.length; i++) {
    const seen = new Set([i]);
    let p = rooms[i].parentIdx;
    while (p > 0 && !seen.has(p)) {
      seen.add(p);
      p = rooms[p].parentIdx;
    }
    if (p !== 0) rooms[i].parentIdx = 0;
  }
  const kids = rooms.map(() => []);
  for (let i = 1; i < rooms.length; i++) kids[rooms[i].parentIdx].push(i);
  // breadth-first order from the main room
  const order = [0];
  for (let k = 0; k < order.length; k++) for (const j of kids[order[k]]) order.push(j);

  // A: sizes, and which wall each room is on
  {
    const [rw, rh] = usualSize(root.name, true);
    root.w = sc(root.w) || rw;
    root.h = sc(root.h) || rh;
  }
  for (const i of order) {
    const P = rooms[i];
    // the wall P shares with its own parent can't take another room
    const shut = P.parentIdx >= 0 ? OPP[P.wall] : null;
    const load = { n: 0, e: 0, s: 0, w: 0 };
    if (i === 0) load[root.entranceWall] += 3;
    const sizeOn = (K, wall) => {
      const [ua, ud] = usualSize(K.name, false);
      if (K.w0 || K.h0) {
        const [w, h] = [sc(K.w0) || dimsOn(wall, ua, ud)[0], sc(K.h0) || dimsOn(wall, ua, ud)[1]];
        return [w, h];
      }
      return dimsOn(wall, ua, ud);
    };
    for (const j of kids[i]) {
      const K = rooms[j];
      K.w0 = K.w;
      K.h0 = K.h;
      if (K.wall === shut) K.wall = 'any';
      if (K.wall !== 'any') {
        [K.w, K.h] = sizeOn(K, K.wall);
        load[K.wall] += alongOf(K) + 1;
      }
    }
    // rooms that can go anywhere: the least crowded wall, the far wall before the sides, the way in last
    const pref = i === 0 ? [OPP[root.entranceWall], ...WALLS.filter((w) => w !== root.entranceWall && w !== OPP[root.entranceWall]), root.entranceWall] : WALLS.filter((w) => w !== shut);
    for (const j of kids[i]) {
      const K = rooms[j];
      if (K.wall !== 'any') continue;
      let best = null;
      pref.forEach((w, rank) => {
        if (w === shut) return;
        const [kw, kh] = sizeOn(K, w);
        const along = w === 'n' || w === 's' ? kw : kh;
        const score = (load[w] + along + 1) / Math.max(1, wallLen(P, w)) + rank * 0.01;
        if (!best || score < best.score) best = { w, score, kw, kh, along };
      });
      K.wall = best.w;
      K.w = best.kw;
      K.h = best.kh;
      load[best.w] += best.along + 1;
    }
  }
  // B: grow each room (deepest first) so the rooms on any one wall fit side by side with a wall between them
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const P = rooms[i];
    const need = { n: 0, e: 0, s: 0, w: 0 };
    const cnt = { n: 0, e: 0, s: 0, w: 0 };
    for (const j of kids[i]) {
      need[rooms[j].wall] += alongOf(rooms[j]);
      cnt[rooms[j].wall]++;
    }
    if (i === 0) {
      need[root.entranceWall] += 1;
      cnt[root.entranceWall]++;
    }
    for (const w of WALLS) need[w] = cnt[w] >= 2 ? need[w] + cnt[w] - 1 : 0;
    P.w = Math.max(P.w, need.n, need.s);
    P.h = Math.max(P.h, need.e, need.w);
  }
  // C: place them, the main room first
  root.x = 0;
  root.y = 0;
  const placed = [root];
  const out = [];
  const wallItems = (i, w) => kids[i].filter((j) => rooms[j].wall === w).map((j) => ({ j, size: alongOf(rooms[j]), at: rooms[j].at }));
  // the main room's walls first: the way in (a door in its wall) takes its place among the rooms on that wall, and a
  // lane from it to the edge of the map is kept clear of everything else
  const rootSlots = {};
  for (const w of WALLS) {
    const items = wallItems(0, w);
    if (w === root.entranceWall) items.push({ entrance: true, size: 1, at: root.entranceAt });
    rootSlots[w] = items.length ? slotsOnWall(root, w, items) : [];
  }
  const ent = rootSlots[root.entranceWall].find((s) => s.entrance);
  const entrance = { ...doorCell(root, root.entranceWall, ent.start, 1), wall: root.entranceWall, state: root.door, width: 1 };
  const lane = laneRect(entrance, 1);
  const dropped = [];
  for (const i of order) {
    const P = rooms[i];
    if (P.dropped) continue;
    for (const w of WALLS) {
      const slots = i === 0 ? rootSlots[w] : wallItems(i, w).length ? slotsOnWall(P, w, wallItems(i, w)) : [];
      for (const s of slots) {
        if (s.entrance) continue;
        const K = rooms[s.j];
        if (!placeRoom(P, K, w, s.start, placed, lane)) {
          K.dropped = true;
          dropped.push(K.name);
          // everything opening off a room that didn't fit goes too
          const stack = [...kids[s.j]];
          while (stack.length) {
            const q = stack.pop();
            rooms[q].dropped = true;
            dropped.push(rooms[q].name);
            stack.push(...kids[q]);
          }
        } else placed.push(K);
      }
    }
  }
  // D: the map: everything, a margin around it, and the way in reaching the edge
  const margin = indoor ? 1 : 3;
  const front = indoor ? 3 : 5;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of placed) {
    x0 = Math.min(x0, r.x - 1);
    y0 = Math.min(y0, r.y - 1);
    x1 = Math.max(x1, r.x + r.w);
    y1 = Math.max(y1, r.y + r.h);
  }
  const ew = root.entranceWall;
  const m = { n: margin, s: margin, e: margin, w: margin };
  m[ew] = front;
  let W = x1 - x0 + 1 + m.w + m.e;
  let H = y1 - y0 + 1 + m.n + m.s;
  // small layouts sit in the middle of a map of at least 12 x 10
  const padX = Math.max(0, 12 - W);
  const padY = Math.max(0, 10 - H);
  const ox = -x0 + m.w + Math.floor(padX / 2);
  const oy = -y0 + m.n + Math.floor(padY / 2);
  W += padX;
  H += padY;
  const shift = (o) => {
    o.x += ox;
    o.y += oy;
  };
  const planRooms = [];
  const index = new Map();
  for (const r of placed) {
    index.set(r, planRooms.length);
    planRooms.push({ name: r.name, base: r.base, x: r.x + ox, y: r.y + oy, w: r.w, h: r.h, wall: r === root ? null : r.wall, door: r.doorCell ? { ...r.doorCell, state: r.door } : null });
  }
  planRooms.forEach((pr, k) => {
    const r = placed[k];
    pr.parent = r === root ? -1 : index.get(rooms[r.parentIdx]);
    if (pr.door) shift(pr.door);
  });
  shift(entrance);
  // the cells from the way in out to the map's edge
  const [dx, dy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[ew];
  for (let x = entrance.x + dx, y = entrance.y + dy; x >= 0 && y >= 0 && x < W && y < H; x += dx, y += dy) out.push([x, y]);
  // underground, a landing where the passage meets the map's edge, room for a party to arrive (beyond every room)
  const landing = [];
  if (indoor) {
    const inMargin = (x, y) => (ew === 's' ? y > y1 + oy : ew === 'n' ? y < y0 + oy : ew === 'e' ? x > x1 + ox : x < x0 + ox);
    for (const [lx, ly] of out) {
      if (!inMargin(lx, ly)) continue;
      for (let k = -2; k <= 2; k++) {
        const x = dx ? lx : lx + k;
        const y = dx ? ly + k : ly;
        if (x >= 1 && y >= 1 && x < W - 1 && y < H - 1 && inMargin(x, y)) landing.push([x, y]);
      }
    }
  }
  return { w: W, h: H, indoor, rooms: planRooms, entrance, out, landing, dropped };
}

/** Starting offsets along wall `w` of room P for the items, in order, each `size` long with a wall between them. */
function slotsOnWall(P, w, items) {
  const len = wallLen(P, w);
  const autos = items.filter((it) => !it.entrance && (it.at === 'auto' || !it.at));
  let ai = 0;
  const pref = items.map((it) => {
    if (it.fixed != null) return it.fixed;
    const end = (it.at === 'west' || it.at === 'north') && ((w === 'n' || w === 's') === (it.at === 'west')) ? 'lo'
      : (it.at === 'east' || it.at === 'south') && ((w === 'n' || w === 's') === (it.at === 'east')) ? 'hi' : null;
    if (end === 'lo') return it.entrance ? Math.min(1, len - 1) : 0;
    if (end === 'hi') return it.entrance ? Math.max(0, len - 2) : len - it.size;
    if (it.at === 'auto' && !it.entrance && autos.length > 1) return Math.round(((ai++ + 0.5) * len) / autos.length - it.size / 2);
    return Math.round((len - it.size) / 2);
  });
  // in order along the wall; the way in keeps its place when a room wants the same spot
  const order = items.map((it, k) => ({ ...it, start: pref[k] })).sort((a, b) => {
    const d = a.start + a.size / 2 - (b.start + b.size / 2);
    if (a.entrance !== b.entrance && Math.abs(d) <= 1.5) return a.entrance ? -1 : 1;
    return d;
  });
  if (order.length === 1) return order;
  // push apart: left to right, then back from the far end, then clamp to the start
  for (let k = 1; k < order.length; k++) order[k].start = Math.max(order[k].start, order[k - 1].start + order[k - 1].size + 1);
  const last = order[order.length - 1];
  if (last.start + last.size > len) last.start = len - last.size;
  for (let k = order.length - 2; k >= 0; k--) order[k].start = Math.min(order[k].start, order[k + 1].start - 1 - order[k].size);
  if (order[0].start < 0) {
    order[0].start = 0;
    for (let k = 1; k < order.length; k++) order[k].start = Math.max(order[k].start, order[k - 1].start + order[k - 1].size + 1);
  }
  return order;
}

/** The cell in P's wall `w` at offset `start` (+ half of `size`), where a door to a room there goes. */
function doorCell(P, w, start, size) {
  const len = wallLen(P, w);
  const off = Math.min(len - 1, Math.max(0, start + Math.floor((size - 1) / 2)));
  if (w === 'n') return { x: P.x + off, y: P.y - 1, horizontal: true };
  if (w === 's') return { x: P.x + off, y: P.y + P.h, horizontal: true };
  if (w === 'w') return { x: P.x - 1, y: P.y + off, horizontal: false };
  return { x: P.x + P.w, y: P.y + off, horizontal: false };
}

function laneRect(d, width) {
  const half = Math.floor(width / 2);
  const far = 999;
  if (d.wall === 'n') return { x: d.x - half, y: d.y - far, w: width, h: far };
  if (d.wall === 's') return { x: d.x - half, y: d.y + 1, w: width, h: far };
  if (d.wall === 'w') return { x: d.x - far, y: d.y - half, w: far, h: width };
  return { x: d.x + 1, y: d.y - half, w: far, h: width };
}

/** Put K on wall w of P at `start` (sliding along the wall, then making it shallower, if something is in the way). */
function placeRoom(P, K, w, start, placed, lane) {
  const len = wallLen(P, w);
  const along = alongOf(K);
  const depth0 = w === 'n' || w === 's' ? K.h : K.w;
  const tries = [0];
  for (let d = 1; d <= len + along; d++) tries.push(d, -d);
  for (let depth = depth0; depth >= 1; depth--) {
    for (const d of tries) {
      const s = start + d;
      // the door must open into P: the room has to share at least one cell of wall with it
      const lo = Math.max(0, s);
      const hi = Math.min(len - 1, s + along - 1);
      if (lo > hi) continue;
      const r = w === 'n' ? { x: P.x + s, y: P.y - 1 - depth, w: along, h: depth }
        : w === 's' ? { x: P.x + s, y: P.y + P.h + 1, w: along, h: depth }
          : w === 'w' ? { x: P.x - 1 - depth, y: P.y + s, w: depth, h: along }
            : { x: P.x + P.w + 1, y: P.y + s, w: depth, h: along };
      if (placed.some((o) => hits(r, o)) || hits(r, lane, 1)) continue;
      Object.assign(K, r);
      // the door: in the middle of the stretch of wall the two rooms share
      const mid = Math.floor((lo + hi) / 2);
      const dc = doorCell(P, w, mid, 1);
      const shared = hi - lo + 1;
      K.doorCell = { x: dc.x, y: dc.y, horizontal: dc.horizontal, width: K.door === 'none' ? Math.max(1, Math.min(3, Math.floor(shared / 2))) : 1 };
      return true;
    }
  }
  return false;
}

/** A plan still too big after shrinking: keep what fits in the largest map (and whatever it opens off is kept). */
function cropPlan(plan) {
  const fits = plan.rooms.map((r) => r.x + r.w < MAX_W && r.y + r.h < MAX_H);
  // a room is kept only if every room on its way back to the main room is kept too
  const keepAt = plan.rooms.map((r, k) => {
    for (let i = k; i >= 0; i = plan.rooms[i].parent) if (!fits[i]) return false;
    return true;
  });
  const newIndex = [];
  const rooms = [];
  plan.rooms.forEach((r, k) => {
    if (!keepAt[k]) return;
    newIndex[k] = rooms.length;
    rooms.push({ ...r });
  });
  for (const r of rooms) r.parent = r.parent >= 0 ? newIndex[r.parent] : -1;
  const gone = plan.rooms.filter((r, k) => !keepAt[k]).map((r) => r.name);
  return { ...plan, w: Math.min(plan.w, MAX_W), h: Math.min(plan.h, MAX_H), rooms, out: plan.out.filter(([x, y]) => x < MAX_W && y < MAX_H), dropped: [...plan.dropped, ...gone] };
}
