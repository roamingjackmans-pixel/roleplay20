// Lighting, line of sight and per-viewer visibility for tactical maps.
// Pure ESM (no Node-only imports) so the browser can use it too.
//
// Line of sight: a ray is cast from the centre of the viewer's cell to sample points of the target cell (its centre,
// the midpoints of its four edges and points just inside its four corners). The target is visible when any ray reaches
// it without passing through the interior of a sight-blocking cell. Rays that pass exactly through a grid corner are
// blocked when both cells beside that corner block sight (diagonal wall seams are sealed). Because edge midpoints are
// sample points, the face of a wall is visible even at grazing angles, and a wall cell itself can be seen.
// All ray maths is done in integers (1 cell = 32 units), so results are exact and deterministic.

const U = 32; // ray units per cell
const H = U >> 1;
// sample points inside a cell (units), most likely first: centre, edge midpoints, inset corners
const SAMPLES = [
  [H, H],
  [H, 0], [H, U], [0, H], [U, H],
  [1, 1], [U - 1, 1], [1, U - 1], [U - 1, U - 1],
];

const LIGHT_LEVEL = { dark: 0, dim: 1, bright: 2 };

// ---------------------------------------------------------------------------------------------------------------
// Blocking grids (cached per map object, invalidated when tiles / doors / objects change)

const gridCache = new WeakMap();

function snapshot(map) {
  const doors = map.doors || [];
  const objs = map.objects || [];
  const snap = new Array(doors.length * 4 + objs.length * 6 + 2);
  let k = 0;
  snap[k++] = doors.length;
  for (const d of doors) {
    snap[k++] = d.x;
    snap[k++] = d.y;
    snap[k++] = (d.open ? 1 : 0) | (d.locked ? 2 : 0) | (d.secret ? 4 : 0);
    snap[k++] = 0;
  }
  snap[k++] = objs.length;
  for (const o of objs) {
    snap[k++] = o.x;
    snap[k++] = o.y;
    snap[k++] = o.w || 1;
    snap[k++] = o.h || 1;
    snap[k++] = (o.blocksMove ? 1 : 0) | (o.blocksSight ? 2 : 0) | (o.difficult ? 4 : 0);
    snap[k++] = 0;
  }
  return snap;
}

function sameSnap(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * getGrids(map) -> { w, h, sight: Uint8Array (1 = blocks sight), cost: Uint8Array (0 = blocked, else feet to enter) }
 * Shared by vision.js and pathing.js. Cached; rebuilt automatically when tiles, doors or objects change.
 */
export function getGrids(map) {
  const snap = snapshot(map);
  const hit = gridCache.get(map);
  if (hit && hit.tiles === map.tiles && hit.w === map.w && hit.h === map.h && sameSnap(hit.snap, snap)) return hit;
  const g = buildGrids(map);
  g.snap = snap;
  g.tiles = map.tiles;
  gridCache.set(map, g);
  return g;
}

function buildGrids(map) {
  const { w, h } = map;
  const n = w * h;
  const tiles = map.tiles || "";
  const sight = new Uint8Array(n);
  const cost = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const c = tiles.charCodeAt(i);
    switch (c) {
      case 35: // '#'
        sight[i] = 1;
        cost[i] = 0;
        break;
      case 119: // 'w' deep water
      case 32: // ' ' void
        cost[i] = 0;
        break;
      case 126: // '~'
      case 37: // '%'
        cost[i] = 10;
        break;
      case 43: // '+' door, default closed (refined below)
        sight[i] = 1;
        cost[i] = 5;
        break;
      default:
        cost[i] = Number.isNaN(c) ? 0 : 5;
    }
  }
  for (const d of map.doors || []) {
    if (!(d.x >= 0 && d.y >= 0 && d.x < w && d.y < h)) continue;
    const i = d.y * w + d.x;
    if (tiles.charCodeAt(i) !== 43) continue; // the tile is the truth: only '+' cells are doors
    if (d.open) {
      sight[i] = 0;
      cost[i] = 5;
    } else {
      sight[i] = 1;
      cost[i] = d.locked || d.secret ? 0 : 5;
    }
  }
  for (const o of map.objects || []) {
    const ow = o.w || 1;
    const oh = o.h || 1;
    if (!o.blocksMove && !o.blocksSight && !o.difficult) continue;
    for (let y = o.y; y < o.y + oh; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = o.x; x < o.x + ow; x++) {
        if (x < 0 || x >= w) continue;
        const i = y * w + x;
        if (o.blocksSight) sight[i] = 1;
        if (o.blocksMove) cost[i] = 0;
        else if (o.difficult && cost[i] === 5) cost[i] = 10;
      }
    }
  }
  return { w, h, sight, cost };
}

// ---------------------------------------------------------------------------------------------------------------
// Basic predicates

export function blocksSight(map, x, y) {
  if (!(x >= 0 && y >= 0 && x < map.w && y < map.h)) return true;
  return getGrids(map).sight[y * map.w + x] === 1;
}

export function blocksMove(map, x, y) {
  if (!(x >= 0 && y >= 0 && x < map.w && y < map.h)) return true;
  return getGrids(map).cost[y * map.w + x] === 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Ray casting

// Cast a ray (integer units) from (x0, y0) to (x1, y1). Returns true when it reaches the endpoint, or enters cell
// (tx, ty), without passing through a blocking cell. The start cell never blocks.
function castRay(blk, w, h, x0, y0, x1, y1, tx, ty) {
  let cx = (x0 / U) | 0;
  let cy = (y0 / U) | 0;
  if (cx === tx && cy === ty) return true;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const adx = dx < 0 ? -dx : dx;
  const ady = dy < 0 ? -dy : dy;
  // distance (units, along each axis) from the start point to the next cell boundary
  let nx = sx > 0 ? (cx + 1) * U - x0 : x0 - cx * U;
  let ny = sy > 0 ? (cy + 1) * U - y0 : y0 - cy * U;
  for (;;) {
    let cmp;
    if (sx === 0) cmp = 1;
    else if (sy === 0) cmp = -1;
    else cmp = nx * ady - ny * adx; // < 0: x boundary first
    if (cmp < 0) {
      if (nx >= adx) return true;
      cx += sx;
      nx += U;
    } else if (cmp > 0) {
      if (ny >= ady) return true;
      cy += sy;
      ny += U;
    } else {
      // exactly through a grid corner
      if (nx >= adx) return true;
      const ax = cx + sx;
      const ay = cy + sy;
      const sideA = ax >= 0 && ax < w ? blk[cy * w + ax] : 1;
      const sideB = ay >= 0 && ay < h ? blk[ay * w + cx] : 1;
      if (sideA && sideB) return false;
      cx = ax;
      cy = ay;
      nx += U;
      ny += U;
    }
    if (cx === tx && cy === ty) return true;
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) return false;
    if (blk[cy * w + cx]) return false;
  }
}

// Line of sight from the centre of cell (ax, ay) to any sample point of cell (bx, by).
function losCells(blk, w, h, ax, ay, bx, by) {
  if (ax === bx && ay === by) return true;
  const x0 = ax * U + H;
  const y0 = ay * U + H;
  const ox = bx * U;
  const oy = by * U;
  for (let s = 0; s < SAMPLES.length; s++) {
    const p = SAMPLES[s];
    if (castRay(blk, w, h, x0, y0, ox + p[0], oy + p[1], bx, by)) return true;
  }
  return false;
}

/** hasLineOfSight(map, ax, ay, bx, by): cell to cell. A wall cell itself can be seen (you see its face). */
export function hasLineOfSight(map, ax, ay, bx, by) {
  const { w, h } = map;
  if (!(ax >= 0 && ay >= 0 && ax < w && ay < h && bx >= 0 && by >= 0 && bx < w && by < h)) return false;
  const g = getGrids(map);
  return losCells(g.sight, w, h, ax, ay, bx, by);
}

// ---------------------------------------------------------------------------------------------------------------
// Lighting

function collectLights(map, extraLights) {
  const out = [];
  const add = (x, y, bright, dim) => {
    const b = Math.max(0, Number(bright) || 0);
    const d = Math.max(0, Number(dim) || 0);
    if (b + d <= 0) return;
    if (!(x >= 0 && y >= 0 && x < map.w && y < map.h)) return;
    out.push({ x: x | 0, y: y | 0, bright: b, dim: d });
  };
  for (const l of map.lights || []) if (l && l.on !== false) add(l.x, l.y, l.bright, l.dim);
  for (const o of map.objects || []) {
    if (o && o.light) add(o.x + (((o.w || 1) - 1) >> 1), o.y + (((o.h || 1) - 1) >> 1), o.light.bright, o.light.dim);
  }
  for (const l of extraLights || []) {
    if (!l) continue;
    const s = l.size || 1;
    add(l.x + ((s - 1) >> 1), l.y + ((s - 1) >> 1), l.bright, l.dim);
  }
  return out;
}

/**
 * computeLight(map, extraLights = []) -> Uint8Array per cell: 0 dark, 1 dim, 2 bright.
 * Ambient sets the baseline; each light raises the cells it has line of sight to (Euclidean feet between cell centres).
 */
export function computeLight(map, extraLights = []) {
  const { w, h } = map;
  const n = w * h;
  const base = LIGHT_LEVEL[map.ambient] ?? 1;
  const light = new Uint8Array(n).fill(base);
  if (base >= 2) return light;
  const g = getGrids(map);
  const blk = g.sight;
  for (const L of collectLights(map, extraLights)) {
    const rb = L.bright / 5;
    const rt = (L.bright + L.dim) / 5;
    const rb2 = rb * rb + 1e-6;
    const rt2 = rt * rt + 1e-6;
    const ri = Math.floor(rt + 1e-6);
    const x0 = Math.max(0, L.x - ri);
    const x1 = Math.min(w - 1, L.x + ri);
    const y0 = Math.max(0, L.y - ri);
    const y1 = Math.min(h - 1, L.y + ri);
    for (let y = y0; y <= y1; y++) {
      const dy = y - L.y;
      for (let x = x0; x <= x1; x++) {
        const dx = x - L.x;
        const d2 = dx * dx + dy * dy;
        if (d2 > rt2) continue;
        const want = d2 <= rb2 ? 2 : 1;
        const i = y * w + x;
        if (light[i] >= want) continue;
        if (losCells(blk, w, h, L.x, L.y, x, y)) light[i] = want;
      }
    }
  }
  return light;
}

// ---------------------------------------------------------------------------------------------------------------
// Visibility

/**
 * computeVisibility(map, viewer, light) -> Uint8Array per cell:
 * 0 not visible, 1 visible only through darkvision (cell is dark), 2 visible & dim, 3 visible & bright.
 * viewer: { x, y, size = 1, darkvision = 0 (feet), blind = false }
 */
export function computeVisibility(map, viewer, light) {
  const { w, h } = map;
  const n = w * h;
  const vis = new Uint8Array(n);
  if (!viewer) return vis;
  if (!light || light.length !== n) light = computeLight(map);
  const size = Math.max(1, viewer.size | 0 || 1);
  const vx0 = viewer.x | 0;
  const vy0 = viewer.y | 0;
  const vx1 = vx0 + size - 1;
  const vy1 = vy0 + size - 1;
  const lit = (i) => (light[i] >= 2 ? 3 : light[i] === 1 ? 2 : 1);

  // the viewer's own cells
  for (let y = vy0; y <= vy1; y++) {
    for (let x = vx0; x <= vx1; x++) if (x >= 0 && y >= 0 && x < w && y < h) vis[y * w + x] = lit(y * w + x);
  }
  if (viewer.blind) return vis;

  const g = getGrids(map);
  const blk = g.sight;
  const dv = Math.max(0, Number(viewer.darkvision) || 0) / 5;
  const dv2 = dv * dv + 1e-6;
  // viewer cells used as eye points: for big creatures only the outer ring matters
  const eyes = [];
  for (let y = vy0; y <= vy1; y++) {
    for (let x = vx0; x <= vx1; x++) {
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      if (size > 2 && x > vx0 && x < vx1 && y > vy0 && y < vy1) continue;
      eyes.push(x, y);
    }
  }
  if (!eyes.length) return vis;

  for (let y = 0; y < h; y++) {
    // vertical gap between this row and the viewer's footprint
    const gy = y < vy0 ? vy0 - y : y > vy1 ? y - vy1 : 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (vis[i]) continue;
      const gx = x < vx0 ? vx0 - x : x > vx1 ? x - vx1 : 0;
      const adjacent = gx <= 1 && gy <= 1;
      const lv = light[i];
      const inDark = gx * gx + gy * gy <= dv2;
      if (lv === 0 && !inDark && !adjacent) continue;
      let seen = false;
      for (let e = 0; e < eyes.length && !seen; e += 2) seen = losCells(blk, w, h, eyes[e], eyes[e + 1], x, y);
      if (!seen) continue;
      if (lv >= 2) vis[i] = 3;
      else if (lv === 1) vis[i] = 2;
      else vis[i] = 1; // dark: darkvision (greyscale) or touch range
    }
  }
  // Inner corners: a blocking cell whose two orthogonal neighbours toward a visible open cell are both visible
  // blocking cells is shown too (otherwise room corners render as notches in the fog).
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (vis[i] || !blk[i]) continue;
      for (let dy = -1; dy <= 1; dy += 2) {
        for (let dx = -1; dx <= 1; dx += 2) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const d = ny * w + nx;
          const a = y * w + nx;
          const b = ny * w + x;
          if (vis[d] && !blk[d] && vis[a] && blk[a] && vis[b] && blk[b]) vis[i] = Math.min(vis[a], vis[b]);
        }
      }
    }
  }
  return vis;
}

// ---------------------------------------------------------------------------------------------------------------
// Encoding

/** encodeCells(uint8array) -> string of "0".."9", row-major */
export function encodeCells(cells) {
  if (!cells) return "";
  let out = "";
  const CH = 4096;
  for (let i = 0; i < cells.length; i += CH) {
    const end = Math.min(cells.length, i + CH);
    const codes = new Array(end - i);
    for (let j = i; j < end; j++) {
      const v = cells[j];
      codes[j - i] = 48 + (v > 9 ? 9 : v);
    }
    out += String.fromCharCode.apply(null, codes);
  }
  return out;
}

/** decodeCells(string) -> Uint8Array */
export function decodeCells(str) {
  const s = String(str || "");
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const v = s.charCodeAt(i) - 48;
    out[i] = v >= 0 && v <= 9 ? v : 0;
  }
  return out;
}
