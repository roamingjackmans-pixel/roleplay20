import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blocksSight, blocksMove, hasLineOfSight, computeLight, computeVisibility, encodeCells, decodeCells,
} from "../server/game/vision.js";
import { generateTacticalMap } from "../server/game/mapgen.js";

function mk(rows, extra = {}) {
  const h = rows.length;
  const w = rows[0].length;
  return { id: "t", kind: "tactical", w, h, tiles: rows.join(""), objects: [], doors: [], lights: [], ambient: "bright", ...extra };
}
const at = (map, arr, x, y) => arr[y * map.w + x];

test("blocksSight / blocksMove basics", () => {
  const m = mk([
    "#####",
    "#.w~#",
    "#+ %#",
    "#####",
  ], { doors: [{ x: 1, y: 2, open: false, locked: false, secret: false }] });
  assert.equal(blocksSight(m, 0, 0), true);
  assert.equal(blocksSight(m, 1, 1), false);
  assert.equal(blocksSight(m, 2, 1), false); // deep water: clear sight
  assert.equal(blocksMove(m, 2, 1), true); // ... but no walking
  assert.equal(blocksMove(m, 3, 1), false); // shallow water: difficult, passable
  assert.equal(blocksSight(m, 2, 2), false); // void is see-through
  assert.equal(blocksMove(m, 2, 2), true);
  assert.equal(blocksSight(m, 1, 2), true); // closed door
  assert.equal(blocksMove(m, 1, 2), false); // closed unlocked door: passable
  m.doors[0].locked = true;
  assert.equal(blocksMove(m, 1, 2), true);
  m.doors[0].open = true;
  m.doors[0].locked = false;
  assert.equal(blocksSight(m, 1, 2), false);
  assert.equal(blocksSight(m, -1, 0), true);
  assert.equal(blocksMove(m, 9, 9), true);
});

test("objects block according to their flags", () => {
  const m = mk(["....", "....", "...."], {
    objects: [
      { id: "o1", kind: "pillar", x: 1, y: 1, w: 1, h: 1, blocksMove: true, blocksSight: true },
      { id: "o2", kind: "table", x: 2, y: 0, w: 2, h: 1, blocksMove: true, blocksSight: false },
    ],
  });
  assert.equal(blocksSight(m, 1, 1), true);
  assert.equal(blocksMove(m, 3, 0), true);
  assert.equal(blocksSight(m, 3, 0), false);
  // cache invalidates when an object moves
  m.objects[0].x = 0;
  assert.equal(blocksSight(m, 1, 1), false);
  assert.equal(blocksSight(m, 0, 1), true);
});

test("line of sight: walls block, wall faces are visible, diagonal seams are sealed", () => {
  const m = mk([
    "##########",
    "#........#",
    "#...#....#",
    "#........#",
    "##########",
  ]);
  assert.equal(hasLineOfSight(m, 1, 2, 8, 2), false); // pillar of wall in the way (4,2)
  assert.equal(hasLineOfSight(m, 1, 1, 8, 1), true);
  assert.equal(hasLineOfSight(m, 1, 2, 4, 2), true); // you see the wall face itself
  assert.equal(hasLineOfSight(m, 1, 1, 8, 0), true); // top wall seen at a grazing angle
  assert.equal(hasLineOfSight(m, 1, 3, 8, 3), true);
  // symmetric for floor cells
  assert.equal(hasLineOfSight(m, 8, 2, 1, 2), false);
  const seam = mk([
    ".#..",
    "#...",
    "....",
  ]);
  assert.equal(hasLineOfSight(seam, 0, 0, 1, 1), false);
  assert.equal(hasLineOfSight(seam, 1, 1, 0, 0), false);
  assert.equal(hasLineOfSight(seam, 0, 0, 3, 2), false);
});

test("line of sight around a corner (peeking) and through a doorway", () => {
  const m = mk([
    "#######",
    "#..#..#",
    "#..+..#",
    "#..#..#",
    "#######",
  ], { doors: [{ x: 3, y: 2, open: false, locked: false, secret: false }] });
  assert.equal(hasLineOfSight(m, 1, 2, 5, 2), false);
  assert.equal(hasLineOfSight(m, 1, 2, 3, 2), true); // the closed door itself is visible
  m.doors[0].open = true;
  assert.equal(hasLineOfSight(m, 1, 2, 5, 2), true);
  assert.equal(hasLineOfSight(m, 2, 2, 5, 1), true);
  assert.equal(hasLineOfSight(m, 1, 1, 5, 3), true); // a shallow diagonal through the doorway
  assert.equal(hasLineOfSight(m, 2, 1, 5, 3), false); // too steep for a 1-wide door
});

test("computeLight: ambient baseline and lights limited by walls", () => {
  const m = mk([
    "###########",
    "#....#....#",
    "#....#....#",
    "#.........#",
    "###########",
  ], { ambient: "dark", lights: [{ id: "l1", x: 2, y: 1, bright: 10, dim: 10, color: "#fff", flicker: false }] });
  const L = computeLight(m);
  assert.equal(at(m, L, 2, 1), 2);
  assert.equal(at(m, L, 4, 1), 2); // 10 ft
  assert.equal(at(m, L, 5, 3), 1); // dim ring (Euclid ~14 ft... within 20)
  assert.equal(at(m, L, 6, 1), 0); // behind the wall
  assert.equal(at(m, L, 9, 3), 0); // too far
  assert.equal(at(m, L, 5, 1), 1); // the wall face is lit (dim at 15 ft)
  const bright = computeLight({ ...m, ambient: "bright" });
  assert.ok(bright.every((v) => v === 2));
  const dim = computeLight({ ...m, ambient: "dim", lights: [] });
  assert.ok(dim.every((v) => v === 1));
  // extra light carried by a token
  const L2 = computeLight(m, [{ x: 8, y: 2, bright: 5, dim: 5 }]);
  assert.equal(at(m, L2, 8, 2), 2);
  assert.equal(at(m, L2, 8, 1), 2);
  assert.equal(at(m, L2, 6, 2), 1);
  // object lights count too
  const m3 = { ...m, lights: [], objects: [{ id: "o", kind: "brazier", x: 7, y: 2, w: 1, h: 1, blocksMove: true, blocksSight: false, light: { bright: 5, dim: 0 } }] };
  assert.equal(at(m3, computeLight(m3), 7, 1), 2);
});

test("computeVisibility: light levels, darkvision, own and adjacent cells", () => {
  const m = mk([
    "############",
    "#..........#",
    "#..........#",
    "#####.######",
    "#..........#",
    "############",
  ], { ambient: "dark", lights: [{ id: "l1", x: 9, y: 1, bright: 10, dim: 10 }] });
  const L = computeLight(m);
  const human = computeVisibility(m, { x: 1, y: 1 }, L);
  assert.equal(at(m, human, 1, 1), 1); // own cell, dark
  assert.equal(at(m, human, 2, 2), 1); // adjacent: always seen
  assert.equal(at(m, human, 4, 1), 0); // dark, no darkvision
  assert.equal(at(m, human, 9, 1), 3); // lit by the torch
  assert.equal(at(m, human, 6, 2), 2); // dim ring
  assert.equal(at(m, human, 3, 4), 0); // other room
  const elf = computeVisibility(m, { x: 1, y: 1, darkvision: 60 }, L);
  assert.equal(at(m, elf, 4, 1), 1); // darkvision
  assert.equal(at(m, elf, 9, 1), 3);
  assert.equal(at(m, elf, 0, 0), 1); // wall corner seen in darkvision
  assert.equal(at(m, elf, 3, 4), 0); // still blocked by walls
  const blind = computeVisibility(m, { x: 9, y: 1, blind: true }, L);
  assert.equal(blind.reduce((a, b) => a + (b ? 1 : 0), 0), 1);
  // a Large viewer sees from all of its cells
  const big = computeVisibility({ ...m, ambient: "bright" }, { x: 4, y: 1, size: 2 });
  assert.equal(at(m, big, 5, 4), 3); // through the gap below its right half
});

test("encode / decode round trip", () => {
  const a = new Uint8Array([0, 1, 2, 3, 0, 2]);
  const s = encodeCells(a);
  assert.equal(s, "012302");
  assert.deepEqual([...decodeCells(s)], [...a]);
  const big = new Uint8Array(5000).map((_, i) => i % 4);
  assert.deepEqual(decodeCells(encodeCells(big)), big);
});

test("performance: 40x30 map, 10 lights, 6 viewers", () => {
  const map = generateTacticalMap({ theme: "dungeon", size: "large", seed: 7, w: 40, h: 30 });
  map.ambient = "dark";
  // make sure there are exactly 10 lights spread over walkable cells
  const walk = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (!blocksMove(map, x, y)) walk.push([x, y]);
  map.lights = [];
  for (let i = 0; i < 10; i++) {
    const [x, y] = walk[Math.floor((i + 0.5) * walk.length / 10)];
    map.lights.push({ id: "l" + i, x, y, bright: 20, dim: 20, color: "#ffb347", flicker: true });
  }
  map.objects = map.objects.map((o) => ({ ...o, light: null }));
  const viewers = [];
  for (let i = 0; i < 6; i++) {
    const [x, y] = walk[Math.floor((i + 0.3) * walk.length / 6)];
    viewers.push({ x, y, darkvision: i % 2 ? 60 : 0 });
  }
  const run = () => {
    const L = computeLight(map);
    for (const v of viewers) computeVisibility(map, v, L);
  };
  for (let i = 0; i < 5; i++) run(); // warm up
  const N = 20;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) run();
  const ms = (performance.now() - t0) / N;
  // and the worst case: bright outdoor forest, every cell is a candidate
  const forest = generateTacticalMap({ theme: "forest", w: 40, h: 30, seed: 3, timeOfDay: "day" });
  const fv = viewers.map((v, i) => {
    const pts = forest.startZones.party.concat(forest.startZones.enemy);
    const [x, y] = pts[i % pts.length];
    return { x, y };
  });
  const runF = () => {
    const L = computeLight(forest);
    for (const v of fv) computeVisibility(forest, v, L);
  };
  for (let i = 0; i < 3; i++) runF();
  const t1 = performance.now();
  for (let i = 0; i < N; i++) runF();
  const msF = (performance.now() - t1) / N;
  console.log(`# vision benchmark: dungeon 40x30 dark, 10 lights + 6 viewers: ${ms.toFixed(2)} ms; forest 40x30 bright, 6 viewers: ${msF.toFixed(2)} ms`);
  assert.ok(ms < 50, `too slow: ${ms} ms`);
  assert.ok(msF < 50, `too slow: ${msF} ms`);
});
