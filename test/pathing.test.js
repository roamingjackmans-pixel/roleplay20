import { test } from "node:test";
import assert from "node:assert/strict";
import { cellCost, findPath, reachableCells, distanceFeet } from "../server/game/pathing.js";

function mk(rows, extra = {}) {
  const h = rows.length;
  const w = rows[0].length;
  return { id: "t", kind: "tactical", w, h, tiles: rows.join(""), objects: [], doors: [], lights: [], ambient: "bright", ...extra };
}

test("cellCost", () => {
  const m = mk(["#.~%w +"], { doors: [{ x: 6, y: 0, open: false, locked: false, secret: false }] });
  assert.equal(cellCost(m, 0, 0), Infinity);
  assert.equal(cellCost(m, 1, 0), 5);
  assert.equal(cellCost(m, 2, 0), 10);
  assert.equal(cellCost(m, 3, 0), 10);
  assert.equal(cellCost(m, 4, 0), Infinity);
  assert.equal(cellCost(m, 5, 0), Infinity);
  assert.equal(cellCost(m, 6, 0), 5); // closed, unlocked door
  m.doors[0].locked = true;
  assert.equal(cellCost(m, 6, 0), Infinity);
  assert.equal(cellCost(m, -1, 0), Infinity);
  const o = mk(["...."], { objects: [{ id: "o", kind: "web", x: 1, y: 0, w: 2, h: 1, blocksMove: false, blocksSight: false, difficult: true }] });
  assert.equal(cellCost(o, 2, 0), 10);
});

test("distanceFeet: Chebyshev, size-aware edge to edge", () => {
  assert.equal(distanceFeet({ x: 0, y: 0 }, { x: 3, y: 2 }), 15);
  assert.equal(distanceFeet({ x: 0, y: 0 }, { x: 1, y: 1 }), 5);
  assert.equal(distanceFeet({ x: 0, y: 0, size: 2 }, { x: 2, y: 0 }), 5); // Large, adjacent
  assert.equal(distanceFeet({ x: 5, y: 5 }, { x: 0, y: 0, size: 3 }), 15);
  assert.equal(distanceFeet({ x: 2, y: 2 }, { x: 2, y: 2 }), 0);
});

test("findPath: straight, diagonal (5 ft each), difficult terrain doubles", () => {
  const m = mk([
    "..........",
    "..........",
    "..........",
  ]);
  const p = findPath(m, { x: 0, y: 0 }, { x: 5, y: 2 });
  assert.equal(p.feet, 25);
  assert.deepEqual(p.path[0], { x: 0, y: 0 });
  assert.deepEqual(p.path.at(-1), { x: 5, y: 2 });
  assert.equal(p.path.length, 6);
  const d = mk([
    "..%%%..",
    "..%%%..",
    "..%%%..",
  ]);
  assert.equal(findPath(d, { x: 0, y: 1 }, { x: 6, y: 1 }).feet, 45); // 3 difficult cells
  assert.equal(findPath(d, { x: 0, y: 0 }, { x: 0, y: 0 }).feet, 0);
});

test("findPath: walls, no corner cutting, doors", () => {
  const m = mk([
    "#######",
    "#..#..#",
    "#..+..#",
    "#..#..#",
    "#######",
  ], { doors: [{ x: 3, y: 2, open: false, locked: false, secret: false }] });
  const p = findPath(m, { x: 1, y: 1 }, { x: 5, y: 1 });
  assert.ok(p);
  assert.ok(p.path.some((c) => c.x === 3 && c.y === 2), "goes through the door");
  // (2,1)->(3,2) would cut the wall corner at (3,1): not allowed, so the path must step to (2,2) first
  for (let i = 1; i < p.path.length; i++) {
    const a = p.path[i - 1];
    const b = p.path[i];
    if (a.x !== b.x && a.y !== b.y) {
      assert.ok(cellCost(m, b.x, a.y) < Infinity && cellCost(m, a.x, b.y) < Infinity, "corner cut");
    }
  }
  assert.equal(p.feet, 20); // (1,1)>(2,2)>(3,2)>(4,2)>(5,1)
  m.doors[0].locked = true;
  assert.equal(findPath(m, { x: 1, y: 1 }, { x: 5, y: 1 }), null);
});

test("findPath: isBlocked, maxFeet, isOccupied", () => {
  const m = mk([
    ".....",
    ".....",
    ".....",
  ]);
  const blocked = new Set(["2,0", "2,1"]);
  const p = findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 }, { isBlocked: (x, y) => blocked.has(`${x},${y}`) });
  assert.ok(p.path.some((c) => c.x === 2 && c.y === 2));
  assert.equal(findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 }, { maxFeet: 15 }), null);
  assert.equal(findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 }, { maxFeet: 20 }).feet, 20);
  assert.equal(findPath(m, { x: 0, y: 0 }, { x: 2, y: 0 }, { isBlocked: (x, y) => x === 2 && y === 0 }), null);
  assert.equal(findPath(m, { x: 0, y: 0 }, { x: 2, y: 0 }, { isOccupied: (x, y) => x === 2 && y === 0 }), null);
  assert.ok(findPath(m, { x: 0, y: 0 }, { x: 4, y: 0 }, { isOccupied: (x, y) => x === 2 }));
});

test("findPath: Large creatures need a 2x2 gap", () => {
  const m = mk([
    "########",
    "#......#",
    "#......#",
    "###.####",
    "#......#",
    "#......#",
    "########",
  ]);
  assert.ok(findPath(m, { x: 1, y: 1 }, { x: 1, y: 4 }));
  assert.equal(findPath(m, { x: 1, y: 1 }, { x: 1, y: 4 }, { size: 2 }), null);
  const wide = mk([
    "########",
    "#......#",
    "#......#",
    "###..###",
    "#......#",
    "#......#",
    "########",
  ]);
  const p = findPath(wide, { x: 1, y: 1 }, { x: 1, y: 4 }, { size: 2 });
  assert.ok(p);
  assert.ok(p.path.some((c) => c.x === 3 && c.y === 3));
  assert.equal(findPath(wide, { x: 1, y: 1 }, { x: 6, y: 4 }, { size: 2 }), null); // footprint off the map
});

test("reachableCells: budget, difficult terrain, blockers", () => {
  const m = mk([
    "...........",
    "...........",
    ".....%.....",
    "...........",
    "...........",
  ]);
  const r = reachableCells(m, { x: 0, y: 2 }, 15);
  assert.equal(r.get("0,2"), 0);
  assert.equal(r.get("3,2"), 15);
  assert.equal(r.get("3,0"), 15);
  assert.equal(r.has("4,2"), false);
  const r2 = reachableCells(m, { x: 3, y: 2 }, 10);
  assert.equal(r2.get("5,2"), 15 > 10 ? undefined : 15);
  assert.equal(r2.has("5,2"), false); // 5 + 10 (difficult) = 15 > 10
  assert.equal(r2.get("4,2"), 5);
  const r3 = reachableCells(m, { x: 0, y: 2 }, 30, { isOccupied: (x, y) => x === 1 && y === 2 });
  assert.equal(r3.has("1,2"), false);
  assert.equal(r3.get("2,2"), 10);
  const walled = mk(["..#..", "..#..", "..#.."]);
  const r4 = reachableCells(walled, { x: 0, y: 0 }, 100);
  assert.equal(r4.size, 6);
});
