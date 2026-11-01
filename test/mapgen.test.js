import { test } from "node:test";
import assert from "node:assert/strict";
import { generateTacticalMap, placeCreatures, describeMapForAI, resolveTheme, THEMES } from "../server/game/mapgen.js";
import { blocksMove, computeLight } from "../server/game/vision.js";
import { reachableCells } from "../server/game/pathing.js";

const TILE_CHARS = new Set(["#", ".", ",", '"', "=", "_", ":", "~", "w", "%", "+", " "]);

function checkMap(m, tag) {
  assert.equal(m.kind, "tactical", tag);
  assert.equal(typeof m.id, "string");
  assert.ok(m.name && typeof m.name === "string", tag);
  assert.equal(m.tiles.length, m.w * m.h, tag);
  for (const c of m.tiles) assert.ok(TILE_CHARS.has(c), `${tag}: bad tile ${JSON.stringify(c)}`);
  assert.ok(["bright", "dim", "dark"].includes(m.ambient), tag);
  // doors live on '+' tiles, and every '+' has a door entry
  const doorSet = new Set(m.doors.map((d) => `${d.x},${d.y}`));
  for (const d of m.doors) assert.equal(m.tiles[d.y * m.w + d.x], "+", `${tag}: door tile`);
  for (let i = 0; i < m.tiles.length; i++) if (m.tiles[i] === "+") assert.ok(doorSet.has(`${i % m.w},${Math.floor(i / m.w)}`), `${tag}: door entry`);
  // objects are in bounds, never on walls, ids unique
  const ids = new Set();
  for (const o of m.objects) {
    assert.ok(!ids.has(o.id), `${tag}: dup id`);
    ids.add(o.id);
    assert.ok(o.x >= 0 && o.y >= 0 && o.x + o.w <= m.w && o.y + o.h <= m.h, `${tag}: object bounds ${o.kind}`);
    for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) assert.notEqual(m.tiles[y * m.w + x], "#", `${tag}: ${o.kind} on wall`);
    for (const k of ["blocksMove", "blocksSight", "difficult", "hidden"]) assert.equal(typeof o[k], "boolean");
  }
  for (const l of m.lights) {
    assert.ok(l.id && l.x >= 0 && l.y >= 0 && l.x < m.w && l.y < m.h, `${tag}: light`);
    assert.ok(l.bright >= 0 && l.dim >= 0 && typeof l.color === "string");
  }
  // start zones: walkable, plenty of cells, all mutually reachable
  const z = m.startZones;
  for (const k of ["party", "enemy", "hidden", "npc"]) {
    assert.ok(Array.isArray(z[k]), `${tag}: zone ${k}`);
    assert.ok(z[k].length >= 8, `${tag}: zone ${k} has ${z[k].length}`);
    for (const [x, y] of z[k]) assert.ok(!blocksMove(m, x, y), `${tag}: zone ${k} cell ${x},${y} blocked`);
  }
  const [px, py] = z.party[0];
  const reach = reachableCells(m, { x: px, y: py }, Infinity);
  for (const k of ["party", "enemy", "hidden", "npc"]) {
    for (const [x, y] of z[k]) assert.ok(reach.has(`${x},${y}`), `${tag}: ${k} ${x},${y} unreachable from party`);
  }
  // party and enemy zones don't overlap
  const ps = new Set(z.party.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of z.enemy) assert.ok(!ps.has(`${x},${y}`), `${tag}: party/enemy overlap`);
}

test("every theme generates valid, connected maps at every size", () => {
  for (const theme of THEMES) {
    for (const size of ["small", "medium", "large"]) {
      for (const seed of [1, 2]) {
        const m = generateTacticalMap({ theme, size, seed });
        assert.equal(m.theme, theme);
        checkMap(m, `${theme}/${size}/${seed}`);
      }
    }
  }
});

test("sizes and explicit dimensions", () => {
  const s = generateTacticalMap({ theme: "field", size: "small", seed: 1 });
  assert.deepEqual([s.w, s.h], [20, 15]);
  const m = generateTacticalMap({ theme: "field", seed: 1 });
  assert.deepEqual([m.w, m.h], [30, 22]);
  const l = generateTacticalMap({ theme: "field", size: "large", seed: 1 });
  assert.deepEqual([l.w, l.h], [40, 30]);
  const e = generateTacticalMap({ theme: "temple", w: 26, h: 34, seed: 1 }); // tall map, tall theme
  assert.deepEqual([e.w, e.h], [26, 34]);
  const t = generateTacticalMap({ theme: "ship", w: 24, h: 36, seed: 1 }); // wide theme on a tall map
  assert.deepEqual([t.w, t.h], [24, 36]);
  checkMap(t, "ship/tall");
});

test("deterministic: same spec + seed => identical map; different seeds differ", () => {
  for (const theme of THEMES) {
    const a = generateTacticalMap({ theme, seed: 99, features: ["stream"], timeOfDay: "night" });
    const b = generateTacticalMap({ theme, seed: 99, features: ["stream"], timeOfDay: "night" });
    assert.deepEqual(a, b, theme);
    const c = generateTacticalMap({ theme, seed: 100, features: ["stream"], timeOfDay: "night" });
    assert.notEqual(a.tiles, c.tiles, theme);
  }
  // string seeds work too
  assert.deepEqual(generateTacticalMap({ theme: "cave", seed: "goblins" }), generateTacticalMap({ theme: "cave", seed: "goblins" }));
});

test("theme aliases", () => {
  const cases = {
    catacombs: "crypt", inn: "tavern", woods: "forest", market: "street", sewer: "dungeon", bridge: "road",
    "goblin cave": "cave", "old forest road": "road", "temple ruins": "ruins", "pirate ship": "ship",
    graveyard: "field", "throne room": "castle", marsh: "swamp", "bandit hideout": "camp", hamlet: "village",
    "abandoned mine": "mine", cathedral: "temple", "dwarven tomb": "crypt", plains: "field", "": "field",
  };
  for (const [input, want] of Object.entries(cases)) assert.equal(resolveTheme(input).theme, want, input);
  assert.equal(generateTacticalMap({ theme: "catacombs", seed: 3 }).theme, "crypt");
  assert.equal(generateTacticalMap({ theme: "something weird", seed: 3 }).theme, "dungeon");
  const g = generateTacticalMap({ theme: "graveyard", seed: 3 });
  assert.ok(g.objects.some((o) => o.kind === "gravestone"));
  const sewer = generateTacticalMap({ theme: "sewer", seed: 3 });
  assert.ok(sewer.tiles.includes("~"));
});

test("ambient defaults follow theme and time of day", () => {
  assert.equal(generateTacticalMap({ theme: "forest", seed: 1 }).ambient, "bright");
  assert.equal(generateTacticalMap({ theme: "forest", seed: 1, timeOfDay: "dusk" }).ambient, "dim");
  assert.equal(generateTacticalMap({ theme: "forest", seed: 1, timeOfDay: "night" }).ambient, "dark");
  for (const t of ["cave", "mine", "crypt", "dungeon"]) assert.equal(generateTacticalMap({ theme: t, seed: 1 }).ambient, "dark", t);
  for (const t of ["tavern", "temple", "castle"]) {
    const m = generateTacticalMap({ theme: t, seed: 1 });
    assert.equal(m.ambient, "dim", t);
    assert.ok(m.lights.length >= 3, `${t} has light sources`);
  }
  assert.equal(generateTacticalMap({ theme: "cave", seed: 1, ambient: "bright" }).ambient, "bright");
  // night camps and streets still have fire / lantern light
  for (const t of ["camp", "street"]) {
    const m = generateTacticalMap({ theme: t, seed: 2, timeOfDay: "night" });
    assert.ok(m.lights.length >= 1, t);
    const L = computeLight(m);
    assert.ok(L.some((v) => v > 0), `${t} has lit cells at night`);
  }
});

test("themes contain their signature features", () => {
  const has = (m, kind) => m.objects.some((o) => o.kind === kind);
  const tav = generateTacticalMap({ theme: "tavern", seed: 5 });
  assert.ok(has(tav, "bar") && has(tav, "table") && has(tav, "chair") && has(tav, "fireplace"));
  assert.ok(tav.tiles.includes("="));
  assert.ok(tav.regions.some((r) => r.name === "Common room") && tav.regions.some((r) => r.name === "Kitchen"));
  const dun = generateTacticalMap({ theme: "dungeon", seed: 5 });
  assert.ok(dun.doors.length >= 2 && has(dun, "torch"));
  const temple = generateTacticalMap({ theme: "temple", seed: 5 });
  assert.ok(has(temple, "altar") && has(temple, "pew") && has(temple, "pillar") && has(temple, "brazier"));
  const castle = generateTacticalMap({ theme: "castle", seed: 5 });
  assert.ok(has(castle, "throne") && has(castle, "banner"));
  const ship = generateTacticalMap({ theme: "ship", seed: 5 });
  assert.ok(has(ship, "mast") && ship.tiles.includes("w") && ship.tiles.includes("="));
  const mine = generateTacticalMap({ theme: "mine", seed: 5 });
  assert.ok(mine.tiles.includes("_") && has(mine, "cart"));
  const camp = generateTacticalMap({ theme: "camp", seed: 5 });
  assert.ok(has(camp, "tent") && has(camp, "campfire"));
  const swamp = generateTacticalMap({ theme: "swamp", seed: 5 });
  assert.ok(swamp.tiles.includes("w") && swamp.tiles.includes("~") && swamp.tiles.includes("%") && swamp.tiles.includes("="));
  const forest = generateTacticalMap({ theme: "forest", seed: 5 });
  assert.ok(forest.objects.filter((o) => o.kind === "tree").length > 30 && forest.tiles.includes("%"));
  const cave = generateTacticalMap({ theme: "cave", seed: 5 });
  assert.ok(has(cave, "stalagmite"));
  const street = generateTacticalMap({ theme: "street", seed: 5 });
  assert.ok(street.tiles.includes("_") && street.doors.length >= 1);
  const village = generateTacticalMap({ theme: "village", seed: 5 });
  assert.ok(has(village, "well") && village.doors.length >= 2);
  const crypt = generateTacticalMap({ theme: "crypt", seed: 5 });
  assert.ok(has(crypt, "sarcophagus") || has(crypt, "coffin"));
  const ruins = generateTacticalMap({ theme: "ruins", seed: 5 });
  assert.ok(has(ruins, "ruin_wall") || has(ruins, "rubble"));
});

test("feature hints are honoured", () => {
  const f = generateTacticalMap({ theme: "forest", seed: 8, features: ["river", "campfire"] });
  assert.ok(f.tiles.includes("w") && f.tiles.includes("=")); // river + bridge
  assert.ok(f.objects.some((o) => o.kind === "campfire"));
  const r = generateTacticalMap({ theme: "road", seed: 8, features: ["overturned cart"] });
  assert.ok(r.objects.some((o) => o.kind === "cart" && /overturned/i.test(o.label)));
  const d = generateTacticalMap({ theme: "dungeon", seed: 8, features: ["pit", "altar"] });
  assert.ok(d.tiles.includes(" ") && d.objects.some((o) => o.kind === "altar"));
  const c = generateTacticalMap({ theme: "field", seed: 8, features: ["chasm"] });
  assert.ok(c.tiles.includes(" ") && c.tiles.includes("="));
  checkMap(c, "field+chasm");
  const s = generateTacticalMap({ theme: "street", seed: 8, features: ["well"] });
  assert.ok(s.objects.some((o) => o.kind === "well"));
  const p = generateTacticalMap({ theme: "village", seed: 8, features: ["pond", "statue"] });
  assert.ok(p.tiles.includes("w") && p.objects.some((o) => o.kind === "statue"));
  // "street" must not trigger the "tree" feature
  const st = generateTacticalMap({ theme: "street", seed: 8 });
  assert.ok(!st.objects.some((o) => o.kind === "tree"));
});

test("features never break connectivity", () => {
  const feats = [["river"], ["chasm"], ["pit", "pond"], ["stream", "bridge"], ["waterfall"], ["webs", "traps"], ["cage", "throne", "tents"]];
  for (const theme of ["forest", "road", "field", "cave", "dungeon", "village", "ruins", "street"]) {
    for (const fl of feats) checkMap(generateTacticalMap({ theme, seed: 21, features: fl }), `${theme}+${fl.join(",")}`);
  }
});

test("placeCreatures: zones, sizes, no overlaps, respects occupied", () => {
  const m = generateTacticalMap({ theme: "forest", size: "medium", seed: 12 });
  const occupied = new Set([`${m.startZones.party[0][0]},${m.startZones.party[0][1]}`]);
  const out = placeCreatures(m, [
    { key: "party", count: 4, size: 1, zone: "party" },
    { key: "ogre", count: 1, size: 2, zone: "far" },
    { key: "goblins", count: 4, zone: "near" },
    { key: "wolves", count: 3, zone: "flank" },
    { key: "bandits", count: 6, zone: "surround" },
    { key: "archers", count: 2, zone: "hidden" },
    { key: "druid", count: 1, zone: "npc" },
    { key: "boss", count: 1, zone: "center" },
    { key: "spot", count: 2, zone: [15, 11] },
  ], { occupied, seed: 4 });
  const sizes = { ogre: 2 };
  const used = new Set(occupied);
  for (const [k, list] of Object.entries(out)) {
    for (const [x, y] of list) {
      const s = sizes[k] || 1;
      for (let yy = y; yy < y + s; yy++) {
        for (let xx = x; xx < x + s; xx++) {
          assert.ok(!blocksMove(m, xx, yy), `${k} on blocked cell`);
          assert.ok(!used.has(`${xx},${yy}`), `${k} overlaps at ${xx},${yy}`);
          used.add(`${xx},${yy}`);
        }
      }
    }
  }
  assert.equal(out.party.length, 4);
  assert.equal(out.ogre.length, 1);
  assert.equal(out.goblins.length, 4);
  assert.equal(out.wolves.length, 3);
  assert.equal(out.bandits.length, 6);
  assert.equal(out.archers.length, 2);
  // party members come from the party zone
  const pz = new Set(m.startZones.party.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of out.party) assert.ok(pz.has(`${x},${y}`));
  // "near" goblins are 3-6 steps from the party
  const cheb = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]));
  for (const g of out.goblins) {
    const d = Math.min(...out.party.map((p) => cheb(p, g)));
    assert.ok(d >= 2 && d <= 7, `near goblin at distance ${d}`);
  }
  // "far" ogre is far away
  const dOgre = Math.min(...out.party.map((p) => cheb(p, out.ogre[0])));
  assert.ok(dOgre >= 8, `ogre too close: ${dOgre}`);
  // the surround ring spreads around the party
  const P = out.party.reduce((a, [x, y]) => [a[0] + x / 4, a[1] + y / 4], [0, 0]);
  const angles = out.bandits.map(([x, y]) => Math.atan2(y - P[1], x - P[0]));
  const spread = Math.max(...angles) - Math.min(...angles);
  assert.ok(spread > Math.PI * 0.8, `surround spread ${spread}`);
  // deterministic
  assert.deepEqual(placeCreatures(m, [{ key: "a", count: 5, zone: "far" }], { seed: 9 }), placeCreatures(m, [{ key: "a", count: 5, zone: "far" }], { seed: 9 }));
});

test("placeCreatures packs Large creatures into tight dungeons", () => {
  const m = generateTacticalMap({ theme: "mine", size: "small", seed: 3 });
  const out = placeCreatures(m, [{ key: "party", count: 4, zone: "party" }, { key: "trolls", count: 2, size: 2, zone: "far" }], { seed: 1 });
  assert.equal(out.party.length, 4);
  for (const [x, y] of out.trolls) for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) assert.ok(!blocksMove(m, x + dx, y + dy));
});

test("describeMapForAI: compact grid, header, token legend, under budget", () => {
  const m = generateTacticalMap({ theme: "tavern", w: 40, h: 30, seed: 2, timeOfDay: "night" });
  const placed = placeCreatures(m, [{ key: "party", count: 4, zone: "party" }, { key: "thugs", count: 5, zone: "far" }, { key: "keep", count: 1, zone: "npc" }], { seed: 1 });
  const tokens = [
    ...placed.party.map(([x, y], i) => ({ name: ["Thorin", "Lyra", "Pip", "Mara"][i], kind: "pc", x, y })),
    ...placed.thugs.map(([x, y], i) => ({ name: `Thug ${i + 1}`, kind: "enemy", x, y })),
    ...placed.keep.map(([x, y]) => ({ name: "Barkeep", kind: "npc", x, y })),
    { name: "Ogre bouncer", kind: "enemy", x: placed.thugs[0][0], y: placed.thugs[0][1], size: 1 },
  ].slice(0, 10);
  const text = describeMapForAI(m, tokens);
  const lines = text.split("\n");
  assert.match(lines[0], /40x30/);
  assert.match(lines[1], /^\s+0\s+5\s+10\s+15/);
  // one grid line per row, each exactly w wide after the row label
  for (let y = 0; y < 30; y++) {
    const row = lines[2 + y];
    assert.match(row, new RegExp(`^\\s*${y} `));
    assert.equal(row.slice(3).length, 40);
  }
  assert.ok(text.includes(`A = Thorin (pc) at ${placed.party[0][0]},${placed.party[0][1]}`));
  assert.ok(/Doors: /.test(text) && /Lights: /.test(text) && /Areas: .*Common room/.test(text));
  assert.ok(lines[2 + placed.party[0][1]].slice(3)[placed.party[0][0]] === "A");
  assert.ok(text.length < 3500, `too long: ${text.length}`);
  for (const theme of THEMES) {
    const big = generateTacticalMap({ theme, w: 40, h: 30, seed: 5, features: ["campfire", "altar"] });
    const t = describeMapForAI(big, tokens.map((tk, i) => ({ ...tk, x: big.startZones.party[i % big.startZones.party.length][0], y: big.startZones.party[i % big.startZones.party.length][1] })));
    assert.ok(t.length < 3500, `${theme}: ${t.length} chars`);
  }
});
