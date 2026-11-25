// On the road between two places, the party's pin sits that far along the way (one day into a three-day journey = a
// third of the way), not on some place nearby. And once after the map maker improves, every played campaign's current
// maps are redrawn by the DM for where the party is now (the battle map, and the pin).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-travel-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { buildView } = await import('../server/game/views.js');
const { sceneBlock } = await import('../server/game/context.js');
const { buildArea, alongPath } = await import('../client/src/map/areaRenderer.js');
const { travelTip } = await import('../client/src/map/areaRenderer.js');
const MR = await import('../server/game/maprefresh.js');
const { TURN_SCHEMA, MAP_REFRESH_SCHEMA } = await import('../server/ai/schemas.js');
const { DM_CORE, MAP_REFRESH_TASK } = await import('../server/ai/prompts.js');

let n = 0;
/** A region with three places: a road from Northgate (left) to Southmere (right), and a hamlet off on its own. */
function world() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Travel ${++n}` });
  const id = `ch_tr${n}`;
  C.storeNewCharacter({ id, ownerId: 'u_a', name: 'Alfa', hp: { max: 10, current: 10, temp: 0 }, conditions: [] });
  c.members[0].characterId = id;
  c.maps.area.region = {
    id: 'region', style: 'region', name: 'The Reach', description: '', seed: 7,
    locations: [
      { id: 'north', name: 'Northgate', kind: 'town', x: 0.15, y: 0.5, description: '' },
      { id: 'south', name: 'Southmere', kind: 'city', x: 0.85, y: 0.5, description: '' },
      { id: 'hamlet', name: 'Low Hamlet', kind: 'village', x: 0.5, y: 0.15, description: '' },
    ],
    connections: [['north', 'south']], ownedBy: [], price: '',
  };
  c.knowledge.u_a = { region: { owned: true, discovered: ['north', 'south', 'hamlet'] } };
  c.scene.areaMapId = 'region';
  c.scene.areaLocationId = 'north';
  return { c, id };
}
const turn = (c, scene) => E.applyTurnResult(c, { narration: [], scene: { location: '', timeOfDay: '', weather: '', mood: '', areaMapId: '', areaLocationId: '', headingTo: '', progress: 0, clearBattleMap: false, ...scene }, summary: 'On the road.' });
const knowledgeOf = (c) => buildView(c, 'u_a').areaMaps.find((a) => a.map.id === 'region').knowledge;

test('one day into a three-day journey: the pin is a third of the way along the road, not on a place', () => {
  const { c } = world();
  turn(c, { areaMapId: 'region', areaLocationId: 'north', headingTo: 'south', progress: 0.33 });
  assert.deepEqual(c.scene.travel, { mapId: 'region', from: 'north', to: 'south', progress: 0.33 });
  const k = knowledgeOf(c);
  assert.equal(k.current, null, 'not "at" any place');
  assert.deepEqual(k.travel, { from: 'north', to: 'south', progress: 0.33 });
  // the drawing puts the pin on the road the map draws between the two towns, a third of its length along
  const scene = buildArea(c.maps.area.region, k);
  const pin = scene.travelPin;
  assert.ok(pin && pin.onRoad, 'on the road');
  const road = scene.roads.find((r) => r.ends && r.ends.includes('north') && r.ends.includes('south'));
  const pts = road.ends[0] === 'north' ? road.pts : road.pts.slice().reverse();
  const at = alongPath(pts, 0.33);
  assert.ok(Math.hypot(pin.x - at[0], pin.y - at[1]) < 0.01);
  const north = scene.markers.find((m) => m.loc.id === 'north');
  const south = scene.markers.find((m) => m.loc.id === 'south');
  assert.ok(pin.x > north.x && pin.x < south.x);
  assert.ok(Math.abs((pin.x - north.x) / (south.x - north.x) - 0.33) < 0.08, 'about a third of the way across');
  assert.ok(!scene.markers.some((m) => m.current), 'no place is marked "you are here"');
  assert.match(travelTip(pin).loc.description, /About 33% of the way from Northgate/);
  // the DM sees it too
  assert.match(sceneBlock(c), /north: Northgate .*<- PARTY SET OUT FROM HERE, now 33% of the way to south/);
  assert.match(sceneBlock(c), /south: Southmere .*<- PARTY IS HEADING HERE/);
});

test('the pin moves on as the journey goes on, stays put when nothing is said, and lands on arrival', () => {
  const { c } = world();
  turn(c, { areaMapId: 'region', areaLocationId: 'north', headingTo: 'south', progress: 0.33 });
  turn(c, {}); // a turn about something else
  assert.equal(c.scene.travel.progress, 0.33, 'still on the road');
  turn(c, { headingTo: 'south', progress: 0 }); // "0" is no news, not back at the start
  assert.equal(c.scene.travel.progress, 0.33);
  turn(c, { headingTo: 'south', progress: 66 }); // a percentage
  assert.equal(c.scene.travel.progress, 0.66);
  turn(c, { headingTo: 'south', progress: 1 });
  assert.equal(c.scene.travel, undefined, 'arrived');
  assert.equal(c.scene.areaLocationId, 'south');
  assert.equal(knowledgeOf(c).current, 'south');
  // a new journey, then the DM simply says they're somewhere else: off the road
  turn(c, { areaLocationId: 'south', headingTo: 'hamlet', progress: 0.5 });
  assert.equal(c.scene.travel.to, 'hamlet');
  turn(c, { areaLocationId: 'hamlet' });
  assert.equal(c.scene.travel, undefined);
  assert.equal(c.scene.areaLocationId, 'hamlet');
});

test('with no road between the two places, the pin goes straight across', () => {
  const { c } = world();
  turn(c, { areaMapId: 'region', areaLocationId: 'north', headingTo: 'hamlet', progress: 0.5 });
  const scene = buildArea(c.maps.area.region, knowledgeOf(c));
  const a = scene.markers.find((m) => m.loc.id === 'north');
  const b = scene.markers.find((m) => m.loc.id === 'hamlet');
  assert.ok(!scene.travelPin.onRoad);
  assert.ok(Math.hypot(scene.travelPin.x - (a.x + b.x) / 2, scene.travelPin.y - (a.y + b.y) / 2) < 0.01, 'halfway, as the crow flies');
});

test('the DM is told how to report a journey (and the turn schema stays compact)', () => {
  assert.ok('headingTo' in TURN_SCHEMA.properties.scene.properties && 'progress' in TURN_SCHEMA.properties.scene.properties);
  assert.match(DM_CORE, /headingTo to where they are going .* progress to how far along they are, 0 to 1 \(one day into a three-day journey = 0\.33/);
  assert.ok(JSON.stringify(TURN_SCHEMA).length < 8200);
});

// ---------------------------------------------------------------- redrawing the maps once after the upgrade

const SEVEN = [{ name: 'Chamber', count: 1, w: 40, h: 40, parent: '', wall: 's', at: 'middle', door: 'none' }, { name: 'Alcove', count: 7, w: 10, h: 10, parent: 'Chamber', wall: 'any', at: 'auto', door: 'closed' }];
const reply = (extra = {}) => ({ data: { sceneMap: [{ theme: 'temple', name: 'The Seven Doors', size: 'medium', ambient: 'dim', timeOfDay: 'night', features: [], partyPlacement: 'center', npcsPresent: [], shape: 'auto', keyObjects: [], rooms: SEVEN }], position: { areaMapId: 'region', areaLocationId: 'north', headingTo: '', progress: 0 }, ...extra }, usage: {} });

/** A campaign that has been played, standing on an old-style battle map. */
function played() {
  const w = world();
  w.c.mapsVersion = 0;
  E.setSceneMap(w.c, { theme: 'temple', name: 'Old map', size: 'medium' });
  const old = w.c.maps.tactical[w.c.scene.tacticalMapId];
  delete old.revealed; // laid out before the upgrade
  w.c.chronicle.turns.push({ n: 1, summary: 'The party enters a chamber ringed with doors.' });
  return w;
}

test('a redraw lays the current spot out again with the new map maker and puts the party on it', async () => {
  const { c } = played();
  const oldId = c.scene.tacticalMapId;
  const prompts = [];
  const r = await MR.refreshMaps(c, { ask: async (req) => { prompts.push(req); return reply(); } });
  assert.ok(r.ok && r.battleMap, JSON.stringify(r));
  assert.equal(prompts[0].task, 'map_refresh');
  assert.equal(prompts[0].schema, MAP_REFRESH_SCHEMA);
  assert.ok(prompts[0].prompt.some((p) => p.text?.includes(MAP_REFRESH_TASK)), 'the DM is asked with the whole story in front of it');
  const map = c.maps.tactical[c.scene.tacticalMapId];
  assert.notEqual(map.id, oldId);
  assert.equal(map.layout, true);
  assert.equal(map.doors.length, 7);
  assert.equal(typeof map.revealed, 'string');
  assert.ok(Object.values(c.tokens).some((t) => t.kind === 'pc'), 'the party stands on the new map');
  assert.equal(c.mapsVersion, C.MAPS_VERSION);
  assert.match(c.log.at(-1).text, /redrawn the battle map/);
});

test("a redraw puts a travelling party's pin on the road, and puts away a battle map of a place they've left", async () => {
  const { c } = played();
  c.scene.areaLocationId = 'hamlet'; // the old pin, on the wrong place
  c.maps.tactical[c.scene.tacticalMapId].at = { areaMapId: 'region', areaLocationId: 'hamlet', location: '' };
  const r = await MR.refreshMaps(c, { ask: async () => reply({ sceneMap: [], position: { areaMapId: 'region', areaLocationId: 'north', headingTo: 'south', progress: 0.5 } }) });
  assert.ok(r.position && r.putAway, JSON.stringify(r));
  assert.deepEqual(c.scene.travel, { mapId: 'region', from: 'north', to: 'south', progress: 0.5 });
  assert.equal(c.scene.tacticalMapId, '', 'the battle map of the place they left is put away');
});

test('a fight in progress keeps its battle map; only the pin is redrawn', async () => {
  const { c } = played();
  const mapId = c.scene.tacticalMapId;
  c.combat = { mapId, combatants: {}, order: [], turnIndex: 0, round: 1, state: 'turn', economy: {}, events: [], rollRequests: [] };
  const r = await MR.refreshMaps(c, { ask: async () => reply({ position: { areaMapId: 'region', areaLocationId: 'north', headingTo: 'south', progress: 0.25 } }) });
  assert.ok(!r.battleMap && r.position);
  assert.equal(c.scene.tacticalMapId, mapId);
  assert.equal(c.scene.travel.progress, 0.25);
  c.combat = null;
});

test('after the upgrade every played campaign is redrawn once; new and unplayed ones are left alone', async () => {
  const a = played().c;
  const b = played().c;
  const fresh = C.newCampaign({ id: 'u_a' }, { name: 'Brand new' });
  assert.equal(fresh.mapsVersion, C.MAPS_VERSION, 'made by the current map maker');
  const unplayed = C.newCampaign({ id: 'u_a' }, { name: 'Not yet played' });
  unplayed.mapsVersion = 0;
  const asked = [];
  await MR.upgradeAllMaps({ ask: async (req) => { asked.push(req.campaignId); return reply(); }, wait: 0, force: true });
  assert.ok(asked.includes(a.id) && asked.includes(b.id));
  assert.ok(!asked.includes(fresh.id) && !asked.includes(unplayed.id), 'no DM call for a campaign with nothing to redraw');
  assert.equal(unplayed.mapsVersion, C.MAPS_VERSION);
  // and only once
  const again = [];
  await MR.upgradeAllMaps({ ask: async (req) => { again.push(req.campaignId); return reply(); }, wait: 0, force: true });
  assert.ok(!again.includes(a.id) && !again.includes(b.id));
  // never on a test server without the real AI (unless asked)
  assert.deepEqual(await MR.upgradeAllMaps({ wait: 0 }), []);
});
