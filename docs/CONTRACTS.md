# Roleplay20 — shared contracts

This file is the single source of truth for the data formats and module APIs that several people/agents build in parallel. If you need to change a contract, change it here first and keep every module in sync.

Everything is plain JavaScript, ES modules (`"type": "module"`), Node 24 on the server, modern browsers on the client (built with Vite 8 + React 19). No TypeScript. Prefer zero new dependencies; ask before adding one.

## Repo layout and ownership

```
server/                Node game server (Express 5 + Socket.IO 4)
  index.js             bootstrap, HTTP routes, sockets              (main)
  gate.js auth.js ...  privacy gate, accounts, campaigns             (main)
  game/engine.js       per-campaign game state machine, combat flow  (main)
  game/mapgen.js       tactical (battle) map generation + placement  (maps agent)
  game/vision.js       lighting, line of sight, per-viewer visibility (maps agent)
  game/pathing.js      movement cost, A*, reachable cells            (maps agent)
  ai/*                 Claude Dungeon Master (Messages API)          (main)
shared/                pure modules imported by BOTH server and client (no Node-only or DOM-only APIs)
  templates.js         spell area templates -> covered cells          (maps agent)
  dice.js              dice parser + roller                           (rules agent)
  rules.js             5e derived stats, slots, resources, attacks    (rules agent)
  charbuild.js         character creation + level-up helpers          (rules agent)
  srd/*.json           compiled SRD data (built by scripts/build-srd.mjs) (rules agent)
scripts/build-srd.mjs  compiles data-src/srd-raw/*.json -> shared/srd/*.json (rules agent)
client/src/map/        canvas battle-map renderer + SVG area-map renderer (render agent)
client/src/**          everything else in the UI                       (main)
test/*.test.js         node:test tests, one file per module
```

Shared modules must not import JSON files directly (Node and Vite treat JSON imports differently). Functions that need SRD data take it as an argument (`srd` object, see below). The server loads `shared/srd/*.json` with `fs`; the client fetches them from `GET /api/srd/:name`.

## Coordinates and units

- Battle maps are grids of square cells. One cell = 5 feet.
- `x` grows to the right, `y` grows down, origin `(0,0)` is the top-left cell. Cell index = `y * w + x`.
- Distances in game rules are in **feet**. Grid distance uses the 5e default rule: every step, including diagonals, costs 5 ft (Chebyshev distance × 5).
- A creature's position `(x, y)` is its top-left cell; size 1 = Medium/Small (1×1), 2 = Large (2×2), 3 = Huge, 4 = Gargantuan.

## Tactical (battle) map — `TacticalMap`

```js
{
  id: "map_ab12",              // string, unique in the campaign
  kind: "tactical",
  name: "Goblin Ambush - Old Forest Road",
  theme: "forest",             // see themes below
  seed: 123456,                // integer; same spec + seed => same map
  w: 30, h: 22,                // cells
  tiles: "....##..",           // string, length w*h, one terrain char per cell (row-major)
  objects: [ MapObject ],
  doors: [ { x, y, open: false, locked: false, secret: false } ],   // every door cell has tile '+'
  lights: [ { id, x, y, bright: 20, dim: 20, color: "#ffb347", flicker: true } ],  // feet; centred on cell
  ambient: "bright" | "dim" | "dark",
  regions: [ { name: "Main hall", x, y, w, h } ],    // optional labels to help the AI describe the map
  startZones: {                // cells suitable for placing creatures (all walkable)
    party:  [[x,y], ...],      // where the party enters / stands
    enemy:  [[x,y], ...],      // natural enemy positions (opposite side, guarding, etc.)
    hidden: [[x,y], ...],      // good hiding spots (in cover, darkness, undergrowth)
    npc:    [[x,y], ...]       // where non-hostile NPCs naturally stand (behind the bar, by the fire)
  }
}
```

### Terrain chars (`tiles`)

| char | meaning | movement | sight |
|---|---|---|---|
| `#` | wall / solid rock / cliff | blocked | blocked |
| `.` | stone floor (dungeon, cave floor) | normal | clear |
| `,` | dirt / packed earth | normal | clear |
| `"` | grass | normal | clear |
| `=` | wooden floor / planks / deck | normal | clear |
| `_` | road / cobblestones / flagstones | normal | clear |
| `:` | sand / gravel | normal | clear |
| `~` | shallow water / stream | difficult (×2) | clear |
| `w` | deep water | blocked (no walking) | clear |
| `%` | difficult ground: rubble, undergrowth, mud, scree | difficult (×2) | clear |
| `+` | door (state lives in `doors[]`) | closed+unlocked: passable (auto-opens); locked: blocked | closed: blocked; open: clear |
| ` ` (space) | void / outside the playable area | blocked | clear (renders as background) |

### `MapObject`

```js
{ id: "o12", kind: "tree", x, y, w: 1, h: 1, rot: 0,      // rot in degrees, for rendering only
  blocksMove: true, blocksSight: true, difficult: false,
  cover: "half" | "three-quarters" | null,
  light: { bright: 20, dim: 20, color: "#ff9a3c", flicker: true } | null,  // optional light emitted by the object
  hidden: false,               // secret object (trap, hidden lever): server strips it from player views
  label: "Altar of Ash" | null }
```

Known `kind`s (renderer must draw all of these; unknown kinds draw as a labelled generic prop):
`tree, bush, rock, boulder, pillar, statue, table, chair, bench, barrel, crate, bed, bar, shelf, bookshelf, fireplace, brazier, torch, campfire, chest, altar, well, cart, tent, stalagmite, bones, rug, throne, coffin, sarcophagus, stairs_up, stairs_down, lever, fountain, anvil, forge, haybale, fence, log, mushroom, crystal, web, rubble, banner, cage, trapdoor, pew, counter, stool, mast, rope, cauldron, idol, gravestone, ruin_wall, palisade, sack, weapon_rack, map_table`

Defaults by kind (generator decides, renderer only draws): trees/pillars/boulders/statues/stalagmites block move and sight; tables/barrels/crates/carts block move but not sight (half cover); rugs/bones/web/mushroom/rubble are decorative (rubble/web/bush are `difficult`).

### Themes

`dungeon, cave, forest, tavern, street, road, swamp, crypt, camp, ruins, temple, mine, castle, ship, village, field`.
Unknown theme strings map to the closest theme (e.g. "catacombs" -> crypt, "inn" -> tavern, "woods" -> forest, "market" -> street).

## Battle-map generation — `server/game/mapgen.js`

```js
generateTacticalMap(spec) -> TacticalMap
// spec: {
//   theme: "forest",
//   name?: "Whispering Glade",
//   seed?: 1234,                  // default: random
//   size?: "small" | "medium" | "large",   // ~20x15, ~30x22, ~40x30 (generator may vary a little)
//   w?, h?,                       // explicit size overrides `size`
//   ambient?: "bright"|"dim"|"dark",   // default from theme + timeOfDay (indoors with torches = dim, caves = dark)
//   timeOfDay?: "day"|"dusk"|"night",
//   features?: ["stream", "campfire", "overturned cart", "altar", "pit", "bridge", ...]  // free-text hints, best effort
// }

placeCreatures(map, groups, { occupied = new Set(), seed } = {}) -> { [groupKey]: [[x,y], ...] }
// groups: [{ key: "party", count: 4, size: 1, zone: "party" },
//          { key: "goblins", count: 3, size: 1, zone: "far" | "near" | "flank" | "surround" | "hidden" | "center" | "npc" | [x,y] }]
// "near" = 3-6 cells from the party zone, "far" = the enemy zone / opposite side, "flank" = left/right of the party,
// "surround" = ring around the party, "hidden" = startZones.hidden, "npc" = startZones.npc.
// Never places on blocked cells or on top of each other (respects size), never inside `occupied` ("x,y" strings).

describeMapForAI(map, tokens) -> string
// Compact ASCII rendering for the Dungeon Master prompt: one row per line, tokens drawn as letters/digits,
// plus a legend: coordinates of tokens, doors (open/closed/locked), light sources, regions, notable objects.
```

## Lighting and vision — `server/game/vision.js`

```js
blocksSight(map, x, y) -> boolean      // walls, closed doors, objects with blocksSight. Out of bounds => true
blocksMove(map, x, y)  -> boolean      // walls, deep water, void, locked doors, objects with blocksMove. Out of bounds => true
hasLineOfSight(map, ax, ay, bx, by) -> boolean   // cell to cell; a wall cell itself can be seen (you see the wall face)

computeLight(map, extraLights = []) -> Uint8Array   // per cell: 0 dark, 1 dim, 2 bright
// extraLights: [{ x, y, bright, dim }] lights carried by tokens (torches, Light cantrip).
// Ambient sets the baseline (bright => 2 everywhere, dim => 1, dark => 0). Each light raises cells it has line of
// sight to: distance <= bright => 2, <= bright + dim => at least 1. Distances in feet from cell centre (Chebyshev*5 is fine).

computeVisibility(map, viewer, light) -> Uint8Array
// viewer: { x, y, size = 1, darkvision = 0 (feet), blind = false }
// per cell: 0 not visible, 1 visible only through darkvision (cell is dark), 2 visible & dim, 3 visible & bright.
// A cell is visible when there is line of sight from any cell the viewer occupies AND (light >= 1, or distance <= darkvision).
// Darkvision also upgrades dark->dim inside its range for visibility purposes (still returned as 1 so the client can render
// it greyscale). The viewer always sees its own cells and adjacent cells it has line of sight to.

encodeCells(uint8array) -> string      // one char per cell ("0".."9"), row-major. decodeCells(string) -> Uint8Array
```

Token visibility rule (implemented in the engine, using the functions above): a player sees a token when the cell is visible to
that player's character AND the token is not hidden, or it is hidden but has been revealed to that player.

## Movement — `server/game/pathing.js`

```js
cellCost(map, x, y) -> number | Infinity      // feet to ENTER the cell: 5 normal, 10 difficult, Infinity blocked
findPath(map, from, to, { size = 1, isBlocked = () => false, maxFeet = Infinity } = {}) -> { path: [{x,y}, ...], feet } | null
// 8-directional A*; path includes `from` and `to`; no diagonal corner-cutting through blocked cells;
// isBlocked(x, y) adds extra blockers (e.g. cells of hostile creatures). Large creatures need every covered cell free.
reachableCells(map, from, maxFeet, opts) -> Map<"x,y", feet>   // Dijkstra flood within budget (for the movement overlay)
distanceFeet(a, b) -> number                  // Chebyshev * 5, accounts for size if a.size/b.size are given (edge to edge)
```

## Spell area templates — `shared/templates.js` (used by client preview AND server resolution)

```js
templateCells(grid, tpl) -> [[x, y], ...]     // grid: { w, h }; returns in-bounds cells
// tpl: { shape: "sphere" | "cylinder" | "circle" | "cube" | "cone" | "line",
//        size: feet,           // radius for sphere/cylinder/circle, side for cube, length for cone/line
//        width?: feet,         // line width, default 5
//        origin: { x, y },     // caster's cell (cone/line start here; ignored for sphere/cube except range checks)
//        target: { x, y } }    // centre for sphere/cylinder/circle/cube; aim point for cone/line
// Sphere/cylinder/circle: cells whose centre is within `size` feet of the target cell centre (Euclidean, in feet).
// Cone: 5e cone (width at distance d equals d), starting at the origin cell edge toward target; origin cell excluded.
// Line: cells whose centre is within width/2 of the segment from origin toward target, length `size`; origin excluded.
// Cube: size x size feet square centred on target (rounded to cells).
templateLabel(tpl) -> "20-ft-radius sphere"
```

## Area maps (towns, regions, dungeon overviews) — `AreaMap`

These are the "you can buy a map of the town" maps: a parchment overview, not a grid.

```js
{
  id: "area_ab12", kind: "area",
  style: "town" | "city" | "village" | "region" | "dungeon",
  name: "Millbrook", seed: 777,
  description: "A mill town on the Wend river",
  features: { river: "ns" | "ew" | null, coast: "n"|"s"|"e"|"w"|null, walls: false, forest: 0.4, hills: 0.2,
              roads: ["n", "e"] },          // roads leaving the map edge
  locations: [
    { id: "loc_inn", name: "The Drowned Rat", kind: "tavern", x: 0.52, y: 0.47,   // 0..1 map coordinates
      description: "Low-beamed inn by the bridge", secret: false }
  ],
  connections: [["loc_inn", "loc_mill"]]     // roads / corridors between locations (renderer adds more for towns)
}
```

Location kinds: `tavern, inn, temple, shrine, shop, market, smithy, guild, manor, castle, keep, gate, dock, well, square, tower, ruins, cave, camp, farm, mill, graveyard, stable, library, barracks, jail, house, landmark, dungeon, room, town, city, village, forest, mountain, lake, bridge, crossroads, mine, portal`.

Player knowledge of an area map (per player): `{ owned: boolean, discovered: [locationId], current: locationId | null }`.
A player who doesn't own the map still sees the parchment with only the locations they've discovered (and the area around
them); owning the map reveals every non-secret location. Secret locations are never sent to players until discovered.

## Client renderers — `client/src/map/`

```jsx
<TacticalMapView
  map={TacticalMap}          // as sent to this player (secret doors already turned into '#', hidden objects removed)
  vis={string|null}          // encodeCells(computeVisibility(...)) for this player's character; null = show everything (DM view)
  explored={string|null}     // "0"/"1" per cell: cells this player has seen before (render dimmed, no tokens)
  tokens={[ClientToken]}
  selectedId activeId        // selected token; token whose turn it is (glow)
  mode="select" | "measure" | "template" | "target" | "ping"
  template={{shape,size,width}}   // in template mode; origin = selected token, target follows the mouse
  movement={{ tokenId, cells: Map<"x,y", feet> } | null}   // movement overlay while dragging/selecting own token
  pings={[{ x, y, color, at }]}
  onMoveToken={(tokenId, x, y) => {}}
  onSelectToken={(tokenId|null) => {}}
  onTarget={(tokenId) => {}}                       // in target mode
  onTemplate={({ origin, target, cells }) => {}}  // in template mode, on click
  onPing={(x, y) => {}}
  onCellClick={(x, y) => {}}
/>

ClientToken = { id, name, kind: "pc" | "npc" | "enemy" | "ally", x, y, size, color, img: string|null, initials,
                health: "unhurt" | "hurt" | "bloodied" | "critical" | "down" | "dead" | null,
                hp: { cur, max, temp } | null,      // only for the player's own token and party members
                conditions: ["prone", ...], isMine, isTurn, hidden /* DM view only: semi-transparent */,
                outOfSight /* ally you can't currently see: draw faded at last known position */ }

<AreaMapView map={AreaMap} knowledge={{ owned, discovered, current }} onLocationClick={(loc) => {}} />
```

Rendering is the "wow" layer: textured terrain, soft fog of war (unknown = black, explored = dark and desaturated, darkvision =
greyscale), warm flickering light sources, smooth pan/zoom (wheel + drag, pinch on touch), token portraits with coloured rings,
HP rings for party tokens, condition badges, turn glow, animated token movement, template previews with highlighted cells,
measuring ruler in feet. Must stay smooth (60 fps) on a 40×30 map on a laptop.

## SRD data — `shared/srd/*.json` (compiled by `scripts/build-srd.mjs`)

Source: `data-src/srd-raw/5e-SRD-*.json` (5e-bits/5e-database, SRD 5.1, CC-BY-4.0). The compiled files are compact and
denormalised so the app never has to chase references. The `srd` argument passed to shared functions is
`{ classes, races, backgrounds, spells, equipment, features, conditions, skills, magicItems, monsters? }` where each is the parsed
file (arrays keyed by `index`; helper `byIndex(list)` builds lookup maps). Exact shapes are documented at the top of
`scripts/build-srd.mjs` and in `shared/srd/README.md` by the rules agent.

Ability keys everywhere: `str, dex, con, int, wis, cha`. Skill keys: camelCase of the SRD skill name
(`acrobatics, animalHandling, arcana, athletics, deception, history, insight, intimidation, investigation, medicine, nature,
perception, performance, persuasion, religion, sleightOfHand, stealth, survival`).

## Character model (stored on the server, edited from the sheet)

```js
{
  id, ownerId, campaignId, name, playerName,
  race: "elf", subrace: "high-elf" | null, class: "wizard", subclass: "evocation" | null, level: 1, xp: 0,
  classes: [{ class: "wizard", subclass: "evocation", level: 1 }],   // multiclass-ready; `class/level` mirror classes[0]/total
  background: "sage", alignment: "Neutral Good",
  abilities: { str, dex, con, int, wis, cha },     // FINAL scores (racial bonuses already applied)
  abilityMethod: "standard" | "pointbuy" | "roll" | "manual",
  skillProfs: { arcana: 1, history: 1, stealth: 2 },   // 1 proficient, 2 expertise
  saveProfs: ["int", "wis"],
  otherProfs: { armor: [], weapons: [], tools: [], languages: [] },
  hp: { max, current, temp }, hitDice: { die: 6, total: 1, used: 0 }, deathSaves: { success: 0, fail: 0 },
  acOverride: null, speed: 30, darkvision: 60,
  equipment: [{ id, name, index: "longsword" | null, qty, equipped: false, attuned: false, notes }],
  currency: { cp, sp, ep, gp, pp },
  spellcasting: { ability: "int", cantrips: ["fire-bolt"], known: ["magic-missile"], prepared: ["magic-missile"],
                  slotsUsed: [0,0,0,0,0,0,0,0,0], pactUsed: 0 } | null,
  resources: { rage: { used: 0 }, secondWind: { used: 0 } },   // max comes from rules.classResources()
  features: [{ name, source, level, desc }],    // class/race/background features (copied at creation/level-up)
  conditions: [], exhaustion: 0, inspiration: false, concentration: null /* spell index */,
  personality: { traits, ideals, bonds, flaws }, appearance, backstory, portrait: dataURL | null, color: "#7aa2f7",
  light: { bright: 0, dim: 0 }   // carried light (torch: 20/20)
}
```

## Rules API — `shared/rules.js`, `shared/dice.js`, `shared/charbuild.js`

```js
// dice.js  (rng is a function returning [0,1); default uses crypto.getRandomValues)
parseDice("2d6+1d4+3") -> { terms: [{ count, sides, keep?: "h"|"l", keepCount? } | { mod }], valid }
rollDice(expr, { rng, advantage: "none"|"adv"|"dis", crit: false }) ->
  { expr, total, terms: [{ sides, rolls: [..], kept: [..] } | { mod }], natural /* first d20 kept */, isCrit, isFumble, text }
// "4d6kh3" keep-highest; advantage applies to the first d20 term only; crit doubles dice count.
rollD20(mod, { advantage, rng }) -> same result shape for 1d20+mod
manualD20(natural, mod) -> result shape built from a player-entered natural roll

// rules.js
abilityMod(score), profBonus(totalLevel), SKILLS /* key -> ability */, SKILL_NAMES, ABILITIES, CONDITIONS
deriveCharacter(char, srd) -> {
  mods, prof, saves: { str: +x }, skills: { arcana: +x }, passive: { perception, investigation, insight },
  initiative, ac, speed, hitDie,
  spellcasting: { ability, dc, attack, slots: [..9 max], pact: { level, slots } | null, cantripsKnown, spellsKnown | null,
                  preparedMax | null, mode: "prepared"|"known"|"spellbook"|"pact" } | null,
  attacks: [{ id, name, kind: "melee"|"ranged", bonus, damage: "1d8+3", damageType, versatile?: "1d10+3",
              rangeFt: { normal, long } | null, reachFt, properties: [], itemId }],
  resources: [{ key, name, max, recharge: "short"|"long"|"dawn", used, desc }],
  features
}
classResources(classKey, classLevel, char) -> [{ key, name, max, recharge, desc }]  // rage, ki, sorcery points, channel divinity, ...
spellSlots(classes, srd) -> { slots: [..9], pact: { level, slots } | null }       // multiclass caster table
spellDamage(spell, { slotLevel, casterLevel }) -> { dice: "8d6", type: "fire" } | null
spellHealing(spell, { slotLevel }) -> "1d8" | null
monsterSaveBonus(monster, ability), monsterSkillBonus(monster, skill), monsterInitiative(monster)
xpForLevel(level), levelForXp(xp)

// charbuild.js
STANDARD_ARRAY, POINT_BUY_COSTS, pointBuyCost(scores)
racialBonuses(race, subrace, choices) -> { dex: 2, ... }
buildCharacter(choices, srd) -> character          // choices: { name, race, subrace, class, subclass, background, alignment,
                                                    //   baseAbilities, bonusChoices, skills: [..], expertise: [..], equipment: [...],
                                                    //   cantrips, spells, level (1-5), hpMethod: "average"|"max", personality, ... }
startingEquipmentOptions(classKey, srd) -> [{ desc, choose, options: [{ label, items: [{ index, name, qty }] }] }]  // categories expanded
spellOptions(classKey, level, srd) -> { cantripsToPick, spellsToPick, cantrips: [spell], spells: [spell] }
levelUpPlan(char, srd) -> { newLevel, hpDie, features: [...], asi: boolean, subclassChoice: boolean, spellsToPick, cantripsToPick }
applyLevelUp(char, choices, srd) -> character
```
