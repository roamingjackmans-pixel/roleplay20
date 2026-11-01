// "You are here" follows the party: a town they've left stops marking where they stood, the region map marks the
// town they're in, and the battle map (with everyone's chips) is put away once the party has moved on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-where-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { buildView } = await import('../server/game/views.js');

let n = 0;
function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Where ${++n}` });
  const ids = ['u_a', 'u_b'];
  ids.forEach((u, i) => {
    const id = `ch_${n}_${i}`;
    C.storeNewCharacter({ id, ownerId: u, name: ['Yorgy', 'Julie'][i], hp: { max: 10, current: 10, temp: 0 } });
    if (i === 0) c.members[0].characterId = id;
    else c.members.push({ userId: u, role: 'player', joinedAt: Date.now(), characterId: id });
    E.setOnline(c, u, `s_${n}_${u}`, true);
  });
  c.sessionActive = true;
  E.upsertAreaMap(c, { id: 'calandor', name: 'Calandor', style: 'region', locations: [
    { id: 'loc_thimblewick', name: 'Thimblewick', kind: 'village', x: 0.3, y: 0.4 },
    { id: 'loc_lilt', name: 'The river Lilt', kind: 'landmark', x: 0.4, y: 0.5 },
    { id: 'loc_brindlemark', name: 'Brindlemark', kind: 'town', x: 0.5, y: 0.6 },
    { id: 'loc_steppe', name: 'The Hushed Steppe', kind: 'landmark', x: 0.7, y: 0.4 },
  ] });
  E.upsertAreaMap(c, { id: 'thimblewick', name: 'Thimblewick', style: 'village', locations: [
    { id: 'loc_tower', name: 'The Bell Tower', kind: 'tower', x: 0.5, y: 0.4 },
    { id: 'loc_square', name: 'Bell Square', kind: 'square', x: 0.5, y: 0.6 },
  ] });
  E.upsertAreaMap(c, { id: 'brindlemark', name: 'Brindlemark', style: 'town', locations: [{ id: 'loc_docks', name: 'River docks', kind: 'dock', x: 0.4, y: 0.5 }] });
  E.upsertAreaMap(c, { id: 'steppe', name: 'The Hushed Steppe around Seven Stones', style: 'region', locations: [{ id: 'loc_stones', name: 'Seven Stones', kind: 'ruins', x: 0.5, y: 0.5 }] });
  for (const u of ids) for (const m of ['calandor', 'thimblewick', 'brindlemark', 'steppe']) E.giveMap(c, `area_${m}`, C.member(c, u).characterId, false);
  c.scene.location = 'The Bell Tower balcony, Thimblewick';
  E.moveParty(c, 'area_thimblewick', 'loc_tower');
  E.setSceneMap(c, { theme: 'tower', name: 'The Bell Tower balcony, Thimblewick', size: 'small' });
  return c;
}
const hereOn = (c, uid = 'u_a') => Object.fromEntries(buildView(c, uid).areaMaps.map((a) => [a.map.id, a.knowledge.current]));
const turn = (c, data) => E.applyTurnResult(c, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'The story moves on.' }] }], ...data });

test('inside a town the town marks your spot and the region map marks the town; other maps mark nothing', () => {
  const c = setup();
  const here = hereOn(c);
  assert.equal(here.area_thimblewick, 'loc_tower');
  assert.equal(here.area_calandor, 'loc_thimblewick');
  assert.equal(here.area_brindlemark, null);
  assert.equal(here.area_steppe, null);
  assert.ok(c.scene.tacticalMapId, 'the balcony is laid out');
  assert.ok(Object.values(c.tokens).length >= 2, 'with everyone on it');
});

test('leaving town by river: the town forgets the balcony, the region marks the river, the battle map is put away', () => {
  const c = setup();
  turn(c, { scene: { location: "The Lilt, aboard Captain Dibbs's barge", areaMapId: 'area_calandor', areaLocationId: 'loc_lilt' } });
  const here = hereOn(c);
  assert.equal(here.area_thimblewick, null, 'no "you are here" left in Thimblewick');
  assert.equal(here.area_calandor, 'loc_lilt');
  assert.equal(c.scene.tacticalMapId, '');
  assert.deepEqual(c.tokens, {}, 'no chips left on the balcony');
  assert.equal(buildView(c, 'u_a').tactical, null);
});

test('a move_party effect counts as leaving too', () => {
  const c = setup();
  turn(c, { effects: [{ type: 'move_party', mapId: 'area_thimblewick', locationId: 'loc_square' }] });
  assert.equal(hereOn(c).area_thimblewick, 'loc_square');
  assert.equal(c.scene.tacticalMapId, '');
});

test('arriving somewhere with a fresh battle map shows the new map, not nothing', () => {
  const c = setup();
  const old = c.scene.tacticalMapId;
  turn(c, { scene: { location: 'Bell Square', areaLocationId: 'loc_square' }, sceneMap: [{ theme: 'street', name: 'Bell Square', size: 'small' }] });
  assert.ok(c.scene.tacticalMapId && c.scene.tacticalMapId !== old);
  assert.ok(Object.values(c.tokens).some((t) => t.kind === 'pc'), 'the party stands on the new map');
  assert.equal(c.maps.tactical[c.scene.tacticalMapId].at.areaLocationId, 'loc_square', 'the map remembers its spot');
});

test('staying put keeps the battle map, even when the DM rewords the location', () => {
  const c = setup();
  const old = c.scene.tacticalMapId;
  turn(c, { scene: { location: 'Top of the Bell Tower, at dusk', areaMapId: 'area_thimblewick', areaLocationId: 'loc_tower' } });
  turn(c, { scene: { mood: 'tense' } });
  assert.equal(c.scene.tacticalMapId, old);
  assert.equal(hereOn(c).area_thimblewick, 'loc_tower');
});

test('the DM can put the battle map away without a map move, and say the party is off every map', () => {
  const c = setup();
  turn(c, { scene: { location: 'The stairwell inside the tower', clearBattleMap: true } });
  assert.equal(c.scene.tacticalMapId, '');
  turn(c, { scene: { location: 'Lost in a dream of bells', areaLocationId: 'none' } });
  const here = hereOn(c);
  assert.equal(here.area_thimblewick, null);
  assert.equal(here.area_calandor, 'loc_thimblewick', 'still somewhere in Thimblewick on the region map');
});

test('a nested map: on the steppe map the region marks the Hushed Steppe', () => {
  const c = setup();
  turn(c, { scene: { location: 'Among the Seven Stones', areaMapId: 'area_steppe', areaLocationId: 'loc_stones' } });
  const here = hereOn(c);
  assert.equal(here.area_steppe, 'loc_stones');
  assert.equal(here.area_calandor, 'loc_steppe');
  assert.equal(here.area_thimblewick, null);
});

test('a fight in progress keeps its battle map', () => {
  const c = setup();
  const old = c.scene.tacticalMapId;
  // the goblins jump them on the balcony, and the fight spills down to the square
  turn(c, { combatStart: [{ enemies: [{ monster: 'goblin', count: 1 }], useCurrentMap: true }] });
  assert.ok(c.combat, 'a fight is on');
  turn(c, { scene: { location: 'Bell Square', areaLocationId: 'loc_square' } });
  assert.equal(c.scene.tacticalMapId, old);
});

test('a game already in progress is tidied when the server starts: a battle map the party left behind is put away', () => {
  const c = setup();
  const tm = c.maps.tactical[c.scene.tacticalMapId];
  delete tm.at; // laid out before battle maps remembered their spot
  c.scene.location = "The Lilt, aboard Captain Dibbs's barge";
  c.scene.areaMapId = 'area_calandor';
  c.scene.areaLocationId = 'loc_lilt';
  C.saveCampaign(c);
  const loaded = C.getCampaign(c.id);
  assert.equal(loaded.scene.tacticalMapId, '');
  assert.deepEqual(loaded.tokens, {});
});

test('...but a battle map that still matches where the party is stays, and learns its spot', () => {
  const c = setup();
  const id = c.scene.tacticalMapId;
  delete c.maps.tactical[id].at;
  c.scene.location = 'The Bell Tower balcony, Thimblewick';
  C.saveCampaign(c);
  const loaded = C.getCampaign(c.id);
  assert.equal(loaded.scene.tacticalMapId, id);
  assert.equal(loaded.maps.tactical[id].at.areaLocationId, 'loc_tower');
});
