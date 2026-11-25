#!/usr/bin/env node
// Print generated battle maps as ASCII for eyeballing.
//   node scripts/map-preview.mjs forest medium 42
//   node scripts/map-preview.mjs tavern large 7 --night --zones --features "campfire,stream"
//   node scripts/map-preview.mjs all small 3          (every theme)
// Flags: --zones (overlay P/E/H/N start zones), --light (overlay light: O bright, - dim, blank dark),
//        --ai (print describeMapForAI output with sample tokens), --dusk / --night, --features "a,b"

import { generateTacticalMap, describeMapForAI, mapToAscii, placeCreatures, THEMES } from "../server/game/mapgen.js";
import { computeLight } from "../server/game/vision.js";

// --layout <name>: a described layout (the DM's "rooms") instead of the theme's own
//   node scripts/map-preview.mjs dungeon medium 3 --layout alcoves
const LAYOUTS = {
  // a chamber with a closed door to an alcove in every wall
  alcoves: [{ name: "Chamber", w: 40, h: 40, wall: "s", door: "none" }, { name: "Alcove", count: 7, parent: "Chamber", wall: "any", door: "closed" }],
  // a public common room (open doorway), a back room behind a door, a kitchen through an archway
  tavern: [{ name: "Common room", w: 50, h: 35, wall: "s", door: "none" }, { name: "Back room", parent: "Common room", wall: "n", door: "closed" }, { name: "Kitchen", parent: "Common room", wall: "e", door: "none" }],
  // a corridor with locked cells down both sides and a guard room at the end
  cells: [{ name: "Corridor", w: 60, h: 10, wall: "w", door: "closed" }, { name: "Cell", count: 4, parent: "Corridor", wall: "n", door: "locked" }, { name: "Cell", count: 4, parent: "Corridor", wall: "s", door: "locked" }, { name: "Guard room", parent: "Corridor", wall: "e", door: "closed" }],
  // a private house (locked front door) with several rooms
  house: [{ name: "Hall", w: 20, h: 30, wall: "s", door: "locked" }, { name: "Kitchen", parent: "Hall", wall: "w" }, { name: "Parlour", parent: "Hall", wall: "e" }, { name: "Bedroom", parent: "Hall", wall: "n" }, { name: "Pantry", parent: "Kitchen", wall: "n" }, { name: "Study", parent: "Parlour", wall: "n", door: "locked" }],
};

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const pos = args.filter((a, i) => !a.startsWith("--") && !["--features", "--layout"].includes(args[i - 1]));
const featIdx = args.indexOf("--features");
const features = featIdx >= 0 && args[featIdx + 1] ? args[featIdx + 1].split(",").map((s) => s.trim()) : [];
const layoutIdx = args.indexOf("--layout");
const rooms = layoutIdx >= 0 ? LAYOUTS[args[layoutIdx + 1]] || [] : [];
const theme = pos[0] || "dungeon";
const size = pos[1] || "medium";
const seed = pos[2] !== undefined ? (Number.isFinite(Number(pos[2])) ? Number(pos[2]) : pos[2]) : 1;
const timeOfDay = flags.has("--night") ? "night" : flags.has("--dusk") ? "dusk" : "day";

const themes = theme === "all" ? THEMES : [theme];
for (const t of themes) {
  const t0 = performance.now();
  const map = generateTacticalMap({ theme: t, size, seed, timeOfDay, features, rooms });
  const ms = performance.now() - t0;
  const counts = {};
  for (const o of map.objects) counts[o.kind] = (counts[o.kind] || 0) + 1;
  console.log(`\n=== ${t} -> ${map.theme} | "${map.name}" | ${map.w}x${map.h} seed ${map.seed} | ambient ${map.ambient} | ${ms.toFixed(1)} ms`);
  if (flags.has("--ai")) {
    const placed = placeCreatures(map, [
      { key: "party", count: 4, zone: "party" },
      { key: "foes", count: 4, zone: "far" },
      { key: "ambush", count: 2, zone: "hidden" },
      { key: "npc", count: 1, zone: "npc" },
    ], { seed: 1 });
    const names = { party: ["Thorin", "Lyra", "Pip", "Mara"], foes: ["Goblin 1", "Goblin 2", "Goblin 3", "Hobgoblin"], ambush: ["Goblin archer", "Goblin archer 2"], npc: ["Barkeep"] };
    const kinds = { party: "pc", foes: "enemy", ambush: "enemy", npc: "npc" };
    const tokens = [];
    for (const [k, list] of Object.entries(placed)) list.forEach(([x, y], i) => tokens.push({ name: names[k][i] || k, kind: kinds[k], x, y, size: 1 }));
    const text = describeMapForAI(map, tokens);
    console.log(text);
    console.log(`(${text.length} chars)`);
  } else {
    const light = flags.has("--light") ? computeLight(map) : null;
    console.log(mapToAscii(map, { zones: flags.has("--zones"), light }));
    console.log("objects:", Object.entries(counts).map(([k, n]) => `${k}:${n}`).join(" "));
    console.log("lights:", map.lights.length, "doors:", map.doors.map((d) => `${d.x},${d.y} ${d.secret ? "secret" : d.locked ? "locked" : d.open ? "open" : "closed"}${d.to ? ` -> ${d.to}` : ""}`).join("; "));
    console.log("regions:", map.regions.map((r) => r.name).join(", "));
    if (map.revealed) {
      // what the players are shown before any door opens: '?' marks floor still hidden behind a closed door
      const rows = [];
      for (let y = 0; y < map.h; y++) {
        let row = "";
        for (let x = 0; x < map.w; x++) {
          const i = y * map.w + x;
          row += map.tiles[i] === "#" ? "#" : map.revealed[i] === "1" ? (map.tiles[i] === "+" ? "+" : ".") : "?";
        }
        rows.push(row);
      }
      if (flags.has("--hidden")) console.log("hidden from the players at first ('?'):\n" + rows.join("\n"));
    }
    const z = map.startZones;
    console.log(`zones: party ${z.party.length}, enemy ${z.enemy.length}, hidden ${z.hidden.length}, npc ${z.npc.length}`);
  }
}
