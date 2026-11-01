// Spell area templates -> covered grid cells.
// Pure ESM, no Node/DOM APIs: imported by the client (template preview) and the server (resolution).
//
// Conventions (1 cell = 5 ft, cell (x, y) spans [x, x+1) x [y, y+1), its centre is (x+.5, y+.5)):
//  - sphere / cylinder / circle: cells whose centre is within `size` ft of the target cell centre (Euclidean).
//      e.g. 20-ft radius => 49 cells (a 9x9 "rounded diamond"), 10-ft => 13, 5-ft => 5.
//  - cube: an n x n block (n = round(size / 5), min 1) centred on the target cell. Even sizes extend right/down.
//  - cone: 5e cone (width at distance d equals d, half-angle atan(1/2) ~ 26.6 deg) whose apex is the centre of the
//      origin cell and whose axis points at the target. A cell is covered when its centre lies inside the cone and its
//      grid (5-ft-diagonal) distance from the origin is <= size. The origin cell is excluded.
//      e.g. 15-ft cone: 7 cells straight (1-3-3), 9 cells diagonally (the classic 3x3); 30-ft cone: 24 straight.
//  - line: cells whose centre is within width/2 of the ray from the origin centre toward the target, ahead of the
//      origin and within `size` ft (grid distance). Origin excluded. e.g. 30-ft line: 6 cells straight or diagonal.

const EPS = 1e-9;

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function cellOf(p, fallback) {
  if (p && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y))) {
    return { x: Math.floor(Number(p.x)), y: Math.floor(Number(p.y)) };
  }
  return fallback;
}

function inGrid(grid, x, y) {
  return x >= 0 && y >= 0 && x < grid.w && y < grid.h;
}

/**
 * templateCells(grid, tpl) -> [[x, y], ...]   (row-major order, in-bounds only)
 * grid: { w, h }
 * tpl: { shape, size (ft), width? (ft, lines), origin: {x,y}, target: {x,y} }
 */
export function templateCells(grid, tpl) {
  if (!grid || !tpl) return [];
  const shape = String(tpl.shape || "sphere").toLowerCase();
  const size = Math.max(0, num(tpl.size, 0));
  const origin = cellOf(tpl.origin, null);
  const target = cellOf(tpl.target, origin);
  if (!target) return [];
  const out = [];
  const push = (x, y) => {
    if (inGrid(grid, x, y)) out.push([x, y]);
  };

  if (shape === "sphere" || shape === "cylinder" || shape === "circle" || shape === "radius" || shape === "emanation") {
    const r = size / 5;
    const ri = Math.floor(r + EPS);
    const r2 = r * r + EPS;
    for (let dy = -ri; dy <= ri; dy++) {
      for (let dx = -ri; dx <= ri; dx++) {
        if (dx * dx + dy * dy <= r2) push(target.x + dx, target.y + dy);
      }
    }
    return sortCells(out);
  }

  if (shape === "cube" || shape === "square") {
    const n = Math.max(1, Math.round(size / 5));
    const x0 = target.x - Math.floor((n - 1) / 2);
    const y0 = target.y - Math.floor((n - 1) / 2);
    for (let y = y0; y < y0 + n; y++) for (let x = x0; x < x0 + n; x++) push(x, y);
    return out;
  }

  if (shape === "cone" || shape === "line") {
    const o = origin || target;
    let ux = target.x - o.x;
    let uy = target.y - o.y;
    if (ux === 0 && uy === 0) {
      // no direction given: default to facing east (right)
      ux = 1;
      uy = 0;
    }
    const len = Math.hypot(ux, uy);
    ux /= len;
    uy /= len;
    const L = size / 5; // grid distance in cells
    const Li = Math.ceil(L - EPS);
    const halfW = shape === "line" ? Math.max(0.5, num(tpl.width, 5) / 5) / 2 : 0;
    for (let dy = -Li; dy <= Li; dy++) {
      for (let dx = -Li; dx <= Li; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > L + EPS) continue;
        const along = dx * ux + dy * uy;
        if (along <= EPS) continue;
        const perp = Math.abs(dx * uy - dy * ux);
        if (shape === "cone") {
          if (perp <= along / 2 + 1e-6) push(o.x + dx, o.y + dy);
        } else if (perp <= halfW + 1e-6) {
          push(o.x + dx, o.y + dy);
        }
      }
    }
    return sortCells(out);
  }

  // unknown shape: just the target cell
  push(target.x, target.y);
  return out;
}

function sortCells(cells) {
  return cells.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
}

/** templateLabel(tpl) -> "20-ft-radius sphere" */
export function templateLabel(tpl) {
  if (!tpl) return "";
  const shape = String(tpl.shape || "sphere").toLowerCase();
  const size = Math.round(num(tpl.size, 0));
  switch (shape) {
    case "sphere":
    case "cylinder":
    case "circle":
      return `${size}-ft-radius ${shape}`;
    case "radius":
    case "emanation":
      return `${size}-ft-radius ${shape === "radius" ? "circle" : "emanation"}`;
    case "cube":
    case "square":
      return `${size}-ft ${shape}`;
    case "cone":
      return `${size}-ft cone`;
    case "line": {
      const width = Math.round(num(tpl.width, 5));
      return width === 5 ? `${size}-ft line` : `${size}-ft line (${width} ft wide)`;
    }
    default:
      return `${size}-ft ${shape}`;
  }
}
