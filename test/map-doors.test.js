// Battle maps that match the place the DM describes (rooms, alcoves, corridors, every door set in a wall), and doors you
// have to open: a closed door stops you and hides what's behind it (even how big it is) until it opens; a locked one
// needs a key, a check or the DM. Key objects are drawn without text; their labels show when you point at (or tap) one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-doors-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const K = await import('../server/game/combat.js');
const { buildView } = await import('../server/game/views.js');
const { generateTacticalMap, describeMapForAI, THEMES } = await import('../server/game/mapgen.js');
const { findPath, reachableCells, cellCost } = await import('../server/game/pathing.js');
const { withDoorsOpen, hiddenCells, areaHidden, findDoor } = await import('../server/game/doors.js');
const { planLayout } = await import('../server/game/layout.js');
const { TURN_SCHEMA } = await import('../server/ai/schemas.js');
const { DM_CORE } = await import('../server/ai/prompts.js');
const { TacticalRenderer, doorTip } = await import('../client/src/map/tacticalRenderer.js');

const SEVEN = [{ name: 'Chamber', w: 40, h: 40, wall: 's', door: 'none' }, { name: 'Alcove', count: 7, parent: 'Chamber', wall: 'any', door: 'closed' }];
const TAVERN = [{ name: 'Common room', w: 50, h: 35, wall: 's', door: 'none' }, { name: 'Back room', parent: 'Common room', wall: 'n', door: 'closed' }, { name: 'Kitchen', parent: 'Common room', wall: 'e', door: 'none' }];
const CELLS = [{ name: 'Corridor', w: 60, h: 10, wall: 'w', door: 'closed' }, { name: 'Cell', count: 4, parent: 'Corridor', wall: 'n', door: 'locked' }, { name: 'Cell', count: 4, parent: 'Corridor', wall: 's', door: 'locked' }, { name: 'Guard room', parent: 'Corridor', wall: 'e', door: 'closed' }];
const HOUSE = [{ name: 'Hall', w: 20, h: 30, wall: 's', door: 'locked' }, { name: 'Kitchen', parent: 'Hall', wall: 'w' }, { name: 'Parlour', parent: 'Hall', wall: 'e' }, { name: 'Bedroom', parent: 'Hall', wall: 'n' }, { name: 'Pantry', parent: 'Kitchen', wall: 'n' }, { name: 'Study', parent: 'Parlour', wall: 'n', door: 'locked' }];

const tile = (m, x, y) => (x < 0 || y < 0 || x >= m.w || y >= m.h ? null : m.tiles[y * m.w + x]);
const inside = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
const region = (m, name) => m.regions.find((r) => r.name === name);
/** The rooms on either side of a door. */
const sides = (m, d) => [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => m.regions.find((r) => inside(r, d.x + dx, d.y + dy))?.name).filter(Boolean).sort();
/** Set in a wall: wall (or another door) on two opposite sides, open on the other two (off the map counts as open). */
function inWall(m, d) {
  const wallish = (x, y) => tile(m, x, y) === '#' || tile(m, x, y) === '+';
  const L = wallish(d.x - 1, d.y), R = wallish(d.x + 1, d.y), U = wallish(d.x, d.y - 1), D = wallish(d.x, d.y + 1);
  return (L && R && !U && !D) || (U && D && !L && !R);
}
const cellsOf = (r) => { const out = []; for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) out.push([x, y]); return out; };

// ---------------------------------------------------------------- the generator follows the description

test('a chamber with an alcove in every wall: seven closed doors, each set in the wall between the chamber and its alcove', () => {
  const m = generateTacticalMap({ theme: 'temple', name: 'The Seven Doors', seed: 5, rooms: SEVEN });
  assert.equal(m.layout, true);
  assert.deepEqual(m.regions.map((r) => r.name).sort(), ['Alcove 1', 'Alcove 2', 'Alcove 3', 'Alcove 4', 'Alcove 5', 'Alcove 6', 'Alcove 7', 'Chamber']);
  assert.equal(m.doors.length, 7);
  const chamber = region(m, 'Chamber');
  assert.deepEqual([chamber.w, chamber.h], [8, 8], '40 by 40 feet');
  const walls = new Set();
  for (const d of m.doors) {
    assert.ok(!d.open && !d.locked, 'closed, not locked');
    assert.ok(inWall(m, d), `door ${d.x},${d.y} sits in a wall`);
    const [a, b] = sides(m, d);
    assert.equal(a.startsWith('Alcove') ? b : a, 'Chamber', 'one side is the chamber');
    assert.equal(d.to, (a.startsWith('Alcove') ? a : b), 'the other is the alcove it opens');
    walls.add(d.y === chamber.y - 1 ? 'n' : d.y === chamber.y + chamber.h ? 's' : d.x === chamber.x - 1 ? 'w' : 'e');
  }
  assert.equal(walls.size, 4, 'spread around all four walls');
  for (let k = 1; k <= 7; k++) assert.deepEqual([region(m, `Alcove ${k}`).w, region(m, `Alcove ${k}`).h], [2, 2], 'a 10-foot alcove');
  // the way in: an open archway in the south wall, reaching the map's edge without opening anything
  const reach = reachableCells(m, { x: chamber.x + 3, y: chamber.y + 3 }, Infinity);
  assert.ok([...reach.keys()].some((k) => Number(k.split(',')[1]) === m.h - 1), 'walk straight out to the edge');
  // the players see the chamber; every alcove is hidden until its door opens, and the DM is told so
  const hide = hiddenCells(m);
  assert.ok(!areaHidden(m, hide, chamber));
  for (let k = 1; k <= 7; k++) assert.ok(areaHidden(m, hide, region(m, `Alcove ${k}`)), `Alcove ${k} unseen`);
  const text = describeMapForAI(m, []);
  assert.match(text, /Alcove 3 \(\d+,\d+ 2x2\) \[unseen\]/);
  assert.match(text, /Doors: \d+,\d+ closed \((Alcove \d|Chamber) \/ (Alcove \d|Chamber)\)/);
});

test('every door is set in a wall, in every theme, size and seed (never standing in the open)', () => {
  for (const theme of THEMES) for (const size of ['small', 'medium', 'large']) for (const seed of [1, 2, 3, 4]) {
    const m = generateTacticalMap({ theme, size, seed });
    for (const d of m.doors) assert.ok(inWall(m, d), `${theme}/${size}/${seed}: door ${d.x},${d.y}`);
  }
});

test('doors the DM listed as key objects become doors in the walls, each with a room behind it', () => {
  const m = generateTacticalMap({ theme: 'dungeon', seed: 9, keyObjects: [{ name: 'Door', count: 7, placement: 'focal' }, { name: 'Idol', count: 1, placement: 'focal' }] });
  assert.equal(m.doors.length, 7);
  for (const d of m.doors) assert.ok(inWall(m, d));
  assert.ok(!m.objects.some((o) => /door/i.test(o.label || '')), 'no door lying on the floor');
  assert.equal(m.objects.filter((o) => o.key).map((o) => o.label).join(), 'Idol');
  assert.equal(m.regions.filter((r) => /^Side room \d$/.test(r.name)).length, 7);
});

test('a tavern with a back room: walk straight in from the street; the back room is behind a door, the kitchen through an arch', () => {
  const m = generateTacticalMap({ theme: 'tavern', name: 'An inn', seed: 3, rooms: TAVERN });
  const common = region(m, 'Common room');
  const back = region(m, 'Back room');
  const kitchen = region(m, 'Kitchen');
  assert.ok(back.y + back.h < common.y, 'the back room is to the north');
  assert.ok(kitchen.x > common.x + common.w, 'the kitchen to the east');
  // from the street (the map's south edge) into the common room and the kitchen with no door to open
  const street = { x: common.x + Math.floor(common.w / 2), y: m.h - 1 };
  let start = null;
  for (let x = 0; x < m.w && !start; x++) if (Number.isFinite(cellCost(m, x, m.h - 1))) start = { x, y: m.h - 1 };
  assert.ok(start, street);
  const reach = reachableCells(m, start, Infinity);
  assert.ok(cellsOf(common).some(([x, y]) => reach.has(`${x},${y}`)), 'the common room');
  assert.ok(cellsOf(kitchen).some(([x, y]) => reach.has(`${x},${y}`)), 'the kitchen');
  assert.ok(!cellsOf(back).some(([x, y]) => reach.has(`${x},${y}`)), 'not the back room: its door is shut');
  assert.equal(m.doors.length, 1);
  assert.deepEqual(sides(m, m.doors[0]), ['Back room', 'Common room']);
  assert.ok(m.objects.some((o) => o.kind === 'bar' && inside(common, o.x, o.y)), 'a bar in the common room');
  const hide = hiddenCells(m);
  assert.ok(areaHidden(m, hide, back) && !areaHidden(m, hide, kitchen) && !areaHidden(m, hide, common));
});

test('a corridor with cells down both sides: every cell locked and opening off the corridor, a guard room at the end', () => {
  const m = generateTacticalMap({ theme: 'dungeon', seed: 3, rooms: CELLS });
  const corridor = region(m, 'Corridor');
  assert.deepEqual([corridor.w, corridor.h], [12, 2], '60 by 10 feet');
  const cells = m.regions.filter((r) => /^Cell \d$/.test(r.name));
  assert.equal(cells.length, 8);
  assert.equal(cells.filter((r) => r.y + r.h < corridor.y).length, 4, 'four to the north');
  assert.equal(cells.filter((r) => r.y > corridor.y + corridor.h).length, 4, 'four to the south');
  for (const cell of cells) {
    const d = m.doors.find((dd) => dd.to === cell.name);
    assert.ok(d && d.locked && inWall(m, d), `${cell.name}: a locked door in the wall`);
    assert.deepEqual(sides(m, d), [cell.name, 'Corridor'].sort());
  }
  const guard = region(m, 'Guard room');
  assert.ok(guard.x > corridor.x + corridor.w - 1, 'the guard room is at the east end');
  // the way in is a closed door at the west end; the party starts outside it and sees none of the inside
  const entry = m.doors.find((d) => d.to === 'Corridor');
  assert.ok(entry && !entry.open && !entry.locked && entry.x === corridor.x - 1);
  assert.ok(areaHidden(m, hiddenCells(m), corridor), 'the corridor is behind the closed door');
  for (const [x, y] of m.startZones.party) assert.ok(x < corridor.x - 1, 'the party arrives outside');
});

test('a house with several rooms: a locked front door, and each room opens off the one the DM said', () => {
  const m = generateTacticalMap({ theme: 'village', seed: 3, rooms: HOUSE });
  const door = (name) => m.doors.find((d) => d.to === name);
  assert.ok(door('Hall').locked, 'locked front door');
  for (const [room, parent] of [['Kitchen', 'Hall'], ['Parlour', 'Hall'], ['Bedroom', 'Hall'], ['Pantry', 'Kitchen'], ['Study', 'Parlour']]) {
    const d = door(room);
    assert.ok(d && inWall(m, d), room);
    assert.deepEqual(sides(m, d), [room, parent].sort(), `${room} opens off the ${parent}`);
  }
  assert.ok(door('Study').locked && !door('Pantry').locked);
  // from outside, nothing of the inside is known
  const hide = hiddenCells(m);
  for (const r of m.regions) assert.ok(areaHidden(m, hide, r), `${r.name} unseen from outside`);
  // and the planner kept every room (nothing dropped)
  assert.equal(planLayout(HOUSE, { indoor: false }).dropped.length, 0);
});

test('key objects can be put in a named room: a name several rooms share puts one in each', () => {
  const m = generateTacticalMap({ theme: 'temple', seed: 5, rooms: SEVEN, keyObjects: [{ name: 'Sealed urns', count: 7, placement: 'focal', room: 'Alcove' }, { name: 'Lectern', count: 1, placement: 'focal', room: 'Chamber' }] });
  const urns = m.objects.filter((o) => o.key && /^Sealed urn \d$/.test(o.label));
  assert.equal(urns.length, 7);
  for (let k = 1; k <= 7; k++) assert.equal(urns.filter((o) => inside(region(m, `Alcove ${k}`), o.x, o.y)).length, 1, `one urn in Alcove ${k}`);
  const lectern = m.objects.find((o) => o.label === 'Lectern');
  assert.ok(lectern && inside(region(m, 'Chamber'), lectern.x, lectern.y));
});

test('the turn schema has a compact rooms list, and the DM is told how rooms and doors work (no campaign names)', () => {
  const sm = TURN_SCHEMA.properties.sceneMap.items;
  assert.deepEqual(Object.keys(sm.properties.rooms.items.properties), ['name', 'count', 'w', 'h', 'parent', 'wall', 'at', 'door']);
  assert.deepEqual(sm.properties.rooms.items.properties.door.enum, ['none', 'open', 'closed', 'locked', 'secret']);
  assert.ok('room' in sm.properties.keyObjects.items.properties);
  assert.ok(JSON.stringify(TURN_SCHEMA).length < 8200, 'still small enough to send every turn');
  assert.match(DM_CORE, /lay it out in "rooms"/);
  assert.match(DM_CORE, /A locked door needs a key, a successful check .* or your say-so/);
  assert.match(DM_CORE, /Never make a door a key object/);
  assert.doesNotMatch(DM_CORE, /\begg|seven doors|seven alcoves/i);
});

// ---------------------------------------------------------------- doors at the table

let n = 0;
/** Two players in the seven-alcove chamber: A (the host) next to Alcove 1's door, B across the room. */
function table() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Doors ${++n}` });
  const map = generateTacticalMap({ theme: 'temple', name: 'The Seven Doors', seed: 5, rooms: SEVEN, keyObjects: [{ name: 'Sealed urns', count: 7, placement: 'focal', room: 'Alcove' }] });
  c.maps.tactical[map.id] = map;
  c.scene.tacticalMapId = map.id;
  const a = `ch_da${n}`, b = `ch_db${n}`;
  c.members[0].characterId = a;
  c.members.push({ userId: 'u_b', role: 'player', joinedAt: Date.now(), characterId: b });
  C.storeNewCharacter({ id: a, ownerId: 'u_a', name: 'Alfa', hp: { max: 10, current: 10, temp: 0 }, speed: 30, conditions: [] });
  C.storeNewCharacter({ id: b, ownerId: 'u_b', name: 'Bravo', hp: { max: 10, current: 10, temp: 0 }, speed: 30, conditions: [] });
  const door1 = map.doors.find((d) => d.to === 'Alcove 1');
  const chamber = region(map, 'Chamber');
  const front = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: door1.x + dx, y: door1.y + dy })).find((p) => inside(chamber, p.x, p.y));
  const behind = { x: 2 * door1.x - front.x, y: 2 * door1.y - front.y };
  const tA = E.addToken(c, { kind: 'pc', characterId: a, name: 'Alfa', x: front.x, y: front.y });
  const tB = E.addToken(c, { kind: 'pc', characterId: b, name: 'Bravo', x: chamber.x + 4, y: chamber.y + chamber.h - 1 });
  E.revealForParty(c);
  return { c, map, door1, front, behind, tA, tB, a, b };
}
const shownTile = (c, user, x, y) => { const m = buildView(c, user).tactical.map; return m.tiles[y * m.w + x]; };

test('a closed door stops you; walking into it opens it, and only then does everyone see the alcove behind it', () => {
  const { c, map, door1, behind, tA } = table();
  const alcove = region(map, 'Alcove 1');
  // before: to the other player the alcove is solid rock - no floor, no urn, no name, no size
  const before = buildView(c, 'u_b').tactical.map;
  for (const [x, y] of cellsOf(alcove)) assert.equal(before.tiles[y * before.w + x], '#');
  assert.ok(!before.objects.some((o) => inside(alcove, o.x, o.y)), 'the urn inside is not sent');
  assert.ok(!before.regions.some((r) => r.name === 'Alcove 1'));
  assert.ok(before.doors.some((d) => d.x === door1.x && d.y === door1.y && !d.open), 'the door itself is seen');
  assert.equal(findPath(map, tA, behind), null, 'no walking through a closed door');
  // Alfa walks into it: it opens, and Alfa stops in front of it
  const r = K.moveOutOfCombat(c, tA, behind.x, behind.y);
  assert.ok(r.ok && r.opened, JSON.stringify(r));
  assert.ok(door1.open);
  assert.ok(!(tA.x === behind.x && tA.y === behind.y), 'stops at the door: what is beyond is only now in view');
  assert.match(c.log.at(-1).text, /Alfa opens the door to Alcove 1/);
  // now Bravo's screen has the alcove (its floor and the urn); the other six stay hidden
  const after = buildView(c, 'u_b').tactical.map;
  for (const [x, y] of cellsOf(alcove)) assert.notEqual(after.tiles[y * after.w + x], '#');
  assert.ok(after.objects.some((o) => o.key && inside(alcove, o.x, o.y)));
  assert.ok(after.regions.some((r2) => r2.name === 'Alcove 1') && !after.regions.some((r2) => r2.name === 'Alcove 2'));
  const a2 = region(map, 'Alcove 2');
  assert.equal(shownTile(c, 'u_b', a2.x, a2.y), '#');
  // and in Alfa goes
  assert.ok(K.moveOutOfCombat(c, tA, behind.x, behind.y).ok);
  assert.deepEqual([tA.x, tA.y], [behind.x, behind.y]);
  // shutting it again doesn't make them forget what they saw
  K.moveOutOfCombat(c, tA, 2 * door1.x - behind.x, 2 * door1.y - behind.y);
  const shut = K.useDoor(c, 'u_a', door1.x, door1.y);
  assert.ok(shut.closed && !door1.open, JSON.stringify(shut));
  assert.notEqual(shownTile(c, 'u_b', behind.x, behind.y), '#');
});

test('clicking a door from across the room walks you over to it and opens it', () => {
  const { c, map, tB } = table();
  const d = map.doors.find((dd) => dd.to === 'Alcove 6');
  const r = K.useDoor(c, 'u_b', d.x, d.y);
  assert.ok(r.ok && r.opened, JSON.stringify(r));
  assert.ok(d.open);
  assert.equal(Math.abs(tB.x - d.x) + Math.abs(tB.y - d.y), 1, 'Bravo now stands right in front of the door (not off to one side), so they see in');
});

test('a locked door stays shut: you are told it takes a key, a check or the DM; the DM opens it', () => {
  const { c, map, behind, tA, door1 } = table();
  door1.locked = true;
  assert.equal(buildView(c, 'u_b').tactical.map.doors.find((d) => d.x === door1.x && d.y === door1.y).locked, false, 'nobody knows it is locked yet');
  const r = K.moveOutOfCombat(c, tA, behind.x, behind.y);
  assert.ok(r.locked && /key, picking the lock or forcing it/.test(r.message));
  assert.ok(!door1.open && door1.locked);
  assert.equal(shownTile(c, 'u_b', behind.x, behind.y), '#', 'still hidden');
  assert.equal(buildView(c, 'u_b').tactical.map.doors.find((d) => d.x === door1.x && d.y === door1.y).locked, true, 'now everyone knows');
  assert.ok(K.useDoor(c, 'u_a', door1.x, door1.y).locked, 'clicking it does no better');
  // the DM's say-so (a key, a picked lock): door effects by room name
  assert.equal(findDoor(map, 'the door to Alcove 1'), door1);
  E.applyEffects(c, [{ type: 'door_unlock', text: 'Alcove 1' }, { type: 'door_open', text: 'Alcove 1' }]);
  assert.ok(door1.open && !door1.locked);
  E.pushViews(c);
  assert.notEqual(shownTile(c, 'u_b', behind.x, behind.y), '#');
});

test('the host in DM view sees inside every room, and can open any door on their say-so', () => {
  const { c, map } = table();
  c.settings.dmView = true;
  const a3 = region(map, 'Alcove 3');
  assert.notEqual(shownTile(c, 'u_a', a3.x, a3.y), '#', 'the DM sees it');
  assert.equal(shownTile(c, 'u_b', a3.x, a3.y), '#', 'the player does not');
  const d = map.doors.find((dd) => dd.to === 'Alcove 3');
  d.locked = true;
  assert.ok(K.useDoor(c, 'u_a', d.x, d.y).opened);
  assert.ok(d.open && !d.locked);
  assert.notEqual(shownTile(c, 'u_b', a3.x, a3.y), '#');
});

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('in a fight: opening a door is the free object interaction; a second asks before it takes the action', async () => {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Doors fight ${++n}` });
  const id = `ch_df${n}`;
  C.storeNewCharacter({ id, ownerId: 'u_a', name: 'Bram', race: 'human', class: 'fighter', level: 1, classes: [{ class: 'fighter', subclass: null, level: 1 }], hp: { max: 12, current: 12, temp: 0 }, speed: 30, conditions: [], abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10 } });
  c.members[0].characterId = id;
  E.setSceneMap(c, { theme: 'temple', name: 'The Seven Doors', rooms: SEVEN, partyPlacement: 'center' });
  E.setOnline(c, 'u_a', `s_df${n}`, true);
  assert.ok(E.startSession(c).ok);
  await tick();
  E.openActions(c);
  E.applyTurnResult(c, { narration: [], combatStart: [{ enemies: [{ monster: 'goblin', count: 1 }], useCurrentMap: true }] });
  const k = c.combat;
  for (const req of k.rollRequests.filter((r) => r.purpose === 'initiative')) E.respondRoll(c, req.userId, req.id, { mode: 'manual', natural: 20 });
  await tick(80); // (the goblin may have had its turn first)
  const bram = Object.values(k.combatants).find((x) => x.characterId === id);
  k.turnIndex = k.order.indexOf(bram.id);
  k.state = 'turn';
  const map = c.maps.tactical[k.mapId];
  const tok = c.tokens[bram.tokenId];
  const chamber = region(map, 'Chamber');
  const gob = Object.values(c.tokens).find((t) => t.kind === 'enemy');
  gob.x = chamber.x; gob.y = chamber.y + chamber.h - 1;
  const eco = k.economy[bram.id];
  Object.assign(eco, { moved: 0, action: false, interact: false });
  // Bram stands at a door (the cell in front of it, inside the chamber)
  const standAt = (d) => {
    const p = [[0, 1], [0, -1], [1, 0], [-1, 0]].map(([dx, dy]) => ({ x: d.x + dx, y: d.y + dy })).find((q) => inside(chamber, q.x, q.y));
    tok.x = p.x; tok.y = p.y;
  };
  const [d1, d2] = map.doors.filter((d) => !d.open && !(d.x === gob.x && d.y === gob.y));
  standAt(d1);
  const r1 = K.useDoor(c, 'u_a', d1.x, d1.y);
  assert.ok(r1.opened, JSON.stringify(r1));
  assert.ok(eco.interact && !eco.action, 'the free object interaction');
  assert.ok(eco.done.some((x) => /open the door \(free object interaction\)/.test(x)));
  standAt(d2);
  const r2 = K.useDoor(c, 'u_a', d2.x, d2.y);
  assert.ok(r2.confirm && /takes your action/.test(r2.confirm), JSON.stringify(r2));
  assert.ok(!d2.open && !eco.action, 'nothing spent until they say yes');
  const r3 = K.useDoor(c, 'u_a', d2.x, d2.y, { useAction: true });
  assert.ok(r3.opened && d2.open && eco.action, JSON.stringify(r3));
  standAt(d1);
  const r4 = K.useDoor(c, 'u_a', d1.x, d1.y);
  assert.match(r4.error, /object interaction and your action/);
  // and not on someone else's turn
  k.turnIndex = k.order.indexOf(Object.values(k.combatants).find((x) => x.kind === 'enemy').id);
  assert.match(K.useDoor(c, 'u_a', d1.x, d1.y).error, /on your turn/);
});

test('in a fight, moving into a closed door stops you in front of it and opens it', async () => {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Doors move ${++n}` });
  const id = `ch_dm${n}`;
  C.storeNewCharacter({ id, ownerId: 'u_a', name: 'Bram', race: 'human', class: 'fighter', level: 1, classes: [{ class: 'fighter', subclass: null, level: 1 }], hp: { max: 12, current: 12, temp: 0 }, speed: 30, conditions: [], abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10 } });
  c.members[0].characterId = id;
  E.setSceneMap(c, { theme: 'temple', rooms: SEVEN, partyPlacement: 'center' });
  E.setOnline(c, 'u_a', `s_dm${n}`, true);
  assert.ok(E.startSession(c).ok);
  await tick();
  E.openActions(c);
  E.applyTurnResult(c, { narration: [], combatStart: [{ enemies: [{ monster: 'goblin', count: 1 }], useCurrentMap: true }] });
  const k = c.combat;
  for (const req of k.rollRequests.filter((r) => r.purpose === 'initiative')) E.respondRoll(c, req.userId, req.id, { mode: 'manual', natural: 20 });
  await tick(80); // (the goblin may have had its turn first)
  const bram = Object.values(k.combatants).find((x) => x.characterId === id);
  k.turnIndex = k.order.indexOf(bram.id);
  k.state = 'turn';
  const map = c.maps.tactical[k.mapId];
  const tok = c.tokens[bram.tokenId];
  const chamber = region(map, 'Chamber');
  const gob = Object.values(c.tokens).find((t) => t.kind === 'enemy');
  gob.x = chamber.x; gob.y = chamber.y + chamber.h - 1;
  const eco = k.economy[bram.id];
  Object.assign(eco, { moved: 0, action: false, interact: false });
  const d = map.doors.find((dd) => dd.to === 'Alcove 1');
  // two steps back from the door, straight out into the chamber
  const out = [[0, 1], [0, -1], [1, 0], [-1, 0]].find(([dx, dy]) => inside(chamber, d.x + dx, d.y + dy));
  tok.x = d.x + out[0] * 3; tok.y = d.y + out[1] * 3;
  const target = cellsOf(region(map, 'Alcove 1'))[0];
  const r = K.moveInCombat(c, 'u_a', tok, target[0], target[1]);
  assert.ok(r.ok && r.opened, JSON.stringify(r));
  assert.ok(d.open && eco.interact);
  assert.equal(Math.max(Math.abs(tok.x - d.x), Math.abs(tok.y - d.y)), 1, 'stopped in front of the door');
  assert.ok(r.left < 30 && r.left >= 0);
});

// ---------------------------------------------------------------- key objects: drawn, labelled only on hover / tap

function fakeRenderer(map, levels = null) {
  const r = Object.create(TacticalRenderer.prototype);
  Object.assign(r, { p: { map, tokens: [], vis: levels ? '' : null }, fog: levels ? { levels } : null, hover: { token: null, object: null, door: null }, gesture: null, invalidate() {}, toMap: (sx, sy) => [sx / 10, sy / 10] });
  return r;
}
function fakeCtx() {
  const texts = [];
  const ctx = new Proxy({}, { get: (t, k) => (k === 'fillText' ? (s) => texts.push(s) : k === 'measureText' ? (s) => ({ width: String(s).length * 6 }) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
  return { ctx, texts };
}

test('key objects carry no text on the map: their label shows on hover, or for a few seconds after a tap', () => {
  const map = { id: 'm', w: 6, h: 4, tiles: '.'.repeat(24), objects: [{ id: 'o1', kind: 'egg', x: 2, y: 1, w: 1, h: 1, key: true, label: 'Egg 1' }], doors: [{ x: 5, y: 0, open: false, locked: false }] };
  const r = fakeRenderer(map);
  // pointing at it
  const egg = r.objectAt(2.5, 1.5);
  assert.equal(egg?.label, 'Egg 1');
  r.hover = { ...r.hover, object: egg, sx: 25, sy: 15 };
  const a = fakeCtx();
  r._drawObjectTooltip(a.ctx);
  assert.deepEqual(a.texts, ['Egg 1']);
  // nothing when pointing at bare floor
  r.hover = { token: null, object: null, door: null, sx: 5, sy: 5 };
  const b = fakeCtx();
  r._drawObjectTooltip(b.ctx);
  assert.deepEqual(b.texts, []);
  // a tap (touch screen): the label stays up for a moment without any hover
  r._click({ sx: 25, sy: 15, tok: null, touch: true }, 2, 1, true);
  const c = fakeCtx();
  r._drawObjectTooltip(c.ctx);
  assert.deepEqual(c.texts, ['Egg 1']);
  // still in the fog: no label, not even its existence
  const fogged = fakeRenderer(map, new Uint8Array(24));
  assert.equal(fogged.objectAt(2.5, 1.5), null);
  // the map itself prints no key-object labels (the old "Egg 1" pill under each one is gone)
  const src = fs.readFileSync(new URL('../client/src/map/tacticalRenderer.js', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf("the scene's key objects"), src.indexOf('this._drawRuler(ctx)'));
  assert.ok(block.length > 100 && !/pill\(|fillText/.test(block), 'no text drawn on key objects');
});

test('pointing at a door says what it is; clicking it asks the table to open it', () => {
  const map = { id: 'm', w: 6, h: 4, tiles: '.....+' + '.'.repeat(18), objects: [], doors: [{ x: 5, y: 0, open: false, locked: false }] };
  const r = fakeRenderer(map);
  const clicks = [];
  r.p.onDoorClick = (x, y) => clicks.push([x, y]);
  assert.equal(r.doorAt(5, 0), map.doors[0]);
  r.hover = { token: null, object: null, door: map.doors[0], sx: 50, sy: 0 };
  const a = fakeCtx();
  r._drawObjectTooltip(a.ctx);
  assert.deepEqual(a.texts, ['Closed door · click to open']);
  r._click({ sx: 55, sy: 5, tok: null }, 5, 0, true);
  assert.deepEqual(clicks, [[5, 0]]);
  assert.equal(doorTip({ open: true }, true), 'Open door · click to close');
  assert.equal(doorTip({ locked: true }, true), 'Locked door');
});

test('placement still reaches through doors that can be opened, but never through locked ones', () => {
  const m = generateTacticalMap({ theme: 'dungeon', seed: 3, rooms: CELLS });
  const corridor = region(m, 'Corridor');
  const open = withDoorsOpen(m);
  const start = m.startZones.party[0];
  const reach = reachableCells(open, { x: start[0], y: start[1] }, Infinity);
  assert.ok(reach.has(`${corridor.x},${corridor.y}`), 'through the closed (unlocked) front door');
  const cell = region(m, 'Cell 1');
  assert.ok(!reach.has(`${cell.x},${cell.y}`), 'not into a locked cell');
});
