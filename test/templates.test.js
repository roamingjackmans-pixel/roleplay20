import { test } from "node:test";
import assert from "node:assert/strict";
import { templateCells, templateLabel } from "../shared/templates.js";

const grid = { w: 40, h: 30 };
const has = (cells, x, y) => cells.some(([cx, cy]) => cx === x && cy === y);

test("sphere: 20-ft radius covers a 49-cell disc centred on the target", () => {
  const cells = templateCells(grid, { shape: "sphere", size: 20, origin: { x: 2, y: 2 }, target: { x: 20, y: 15 } });
  assert.equal(cells.length, 49);
  assert.ok(has(cells, 20, 15));
  assert.ok(has(cells, 24, 15)); // 20 ft east
  assert.ok(has(cells, 20, 11)); // 20 ft north
  assert.ok(!has(cells, 25, 15));
  assert.ok(!has(cells, 23, 18)); // corner of the bounding box is outside (3,3 -> 21 ft)
  // symmetric
  for (const [x, y] of cells) assert.ok(has(cells, 40 - x, 30 - y));
});

test("sphere sizes and cylinder/circle aliases", () => {
  const t = { origin: { x: 0, y: 0 }, target: { x: 10, y: 10 } };
  assert.equal(templateCells(grid, { ...t, shape: "sphere", size: 5 }).length, 5);
  assert.equal(templateCells(grid, { ...t, shape: "sphere", size: 10 }).length, 13);
  assert.equal(templateCells(grid, { ...t, shape: "cylinder", size: 20 }).length, 49);
  assert.equal(templateCells(grid, { ...t, shape: "circle", size: 20 }).length, 49);
});

test("sphere is clipped to the grid", () => {
  const cells = templateCells(grid, { shape: "sphere", size: 20, target: { x: 0, y: 0 } });
  assert.ok(cells.length < 49 && cells.length > 10);
  for (const [x, y] of cells) assert.ok(x >= 0 && y >= 0 && x < 40 && y < 30);
});

test("cube: n x n cells centred on the target", () => {
  const c15 = templateCells(grid, { shape: "cube", size: 15, target: { x: 10, y: 10 } });
  assert.equal(c15.length, 9);
  assert.ok(has(c15, 9, 9) && has(c15, 11, 11));
  const c10 = templateCells(grid, { shape: "cube", size: 10, target: { x: 10, y: 10 } });
  assert.equal(c10.length, 4);
  assert.ok(has(c10, 10, 10) && has(c10, 11, 11));
  assert.equal(templateCells(grid, { shape: "cube", size: 5, target: { x: 3, y: 3 } }).length, 1);
});

test("cone: 15-ft cone straight ahead covers 7 cells (1-3-3) and excludes the caster", () => {
  const cells = templateCells(grid, { shape: "cone", size: 15, origin: { x: 10, y: 10 }, target: { x: 20, y: 10 } });
  assert.equal(cells.length, 7);
  assert.ok(!has(cells, 10, 10));
  assert.ok(has(cells, 11, 10));
  assert.ok(!has(cells, 11, 9));
  assert.ok(has(cells, 12, 9) && has(cells, 12, 11));
  assert.ok(has(cells, 13, 9) && has(cells, 13, 10) && has(cells, 13, 11));
  assert.ok(!has(cells, 14, 10));
  for (const [x] of cells) assert.ok(x > 10);
});

test("cone: 15-ft diagonal cone is the classic 3x3 block", () => {
  const cells = templateCells(grid, { shape: "cone", size: 15, origin: { x: 10, y: 10 }, target: { x: 15, y: 15 } });
  assert.equal(cells.length, 9);
  for (let y = 11; y <= 13; y++) for (let x = 11; x <= 13; x++) assert.ok(has(cells, x, y), `${x},${y}`);
});

test("cone: width grows with distance, 30-ft cone", () => {
  const cells = templateCells(grid, { shape: "cone", size: 30, origin: { x: 5, y: 15 }, target: { x: 6, y: 15 } });
  const cols = new Map();
  for (const [x] of cells) cols.set(x, (cols.get(x) || 0) + 1);
  assert.deepEqual([...cols.keys()].sort((a, b) => a - b), [6, 7, 8, 9, 10, 11]);
  assert.equal(cols.get(6), 1);
  assert.equal(cols.get(11), 7); // 30 ft wide at 30 ft
  assert.ok(cells.length >= 20 && cells.length <= 26);
});

test("cone pointing north / west works the same", () => {
  const n = templateCells(grid, { shape: "cone", size: 15, origin: { x: 10, y: 10 }, target: { x: 10, y: 0 } });
  const w = templateCells(grid, { shape: "cone", size: 15, origin: { x: 10, y: 10 }, target: { x: 0, y: 10 } });
  assert.equal(n.length, 7);
  assert.equal(w.length, 7);
  for (const [, y] of n) assert.ok(y < 10);
  for (const [x] of w) assert.ok(x < 10);
});

test("line: 30-ft line of width 5 covers 6 cells", () => {
  const e = templateCells(grid, { shape: "line", size: 30, origin: { x: 5, y: 5 }, target: { x: 30, y: 5 } });
  assert.equal(e.length, 6);
  assert.deepEqual(e.map(([x]) => x), [6, 7, 8, 9, 10, 11]);
  const d = templateCells(grid, { shape: "line", size: 30, origin: { x: 5, y: 5 }, target: { x: 25, y: 25 } });
  assert.equal(d.length, 6);
  const wide = templateCells(grid, { shape: "line", size: 30, width: 15, origin: { x: 5, y: 10 }, target: { x: 30, y: 10 } });
  assert.equal(wide.length, 18);
  const shallow = templateCells(grid, { shape: "line", size: 60, origin: { x: 2, y: 2 }, target: { x: 22, y: 12 } });
  assert.ok(shallow.length >= 12 && shallow.length <= 20, String(shallow.length));
  for (let x = 3; x <= 14; x++) assert.ok(shallow.some(([cx]) => cx === x), `column ${x}`);
  assert.ok(!has(shallow, 2, 2));
});

test("labels", () => {
  assert.equal(templateLabel({ shape: "sphere", size: 20 }), "20-ft-radius sphere");
  assert.equal(templateLabel({ shape: "cylinder", size: 10 }), "10-ft-radius cylinder");
  assert.equal(templateLabel({ shape: "cube", size: 15 }), "15-ft cube");
  assert.equal(templateLabel({ shape: "cone", size: 15 }), "15-ft cone");
  assert.equal(templateLabel({ shape: "line", size: 100 }), "100-ft line");
  assert.equal(templateLabel({ shape: "line", size: 60, width: 10 }), "60-ft line (10 ft wide)");
});
