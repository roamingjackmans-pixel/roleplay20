// Every player sees the same area map; only the markers, labels and fog depend on what they've found.
// Unknown places reach the browser without names, and secret places not at all until found.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-area-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const { buildView } = await import('../server/game/views.js');
const { buildArea } = await import('../client/src/map/areaRenderer.js');

function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Same map' });
  c.members.push({ userId: 'u_b', role: 'player', joinedAt: Date.now(), characterId: null });
  c.maps.area.town = {
    id: 'town', style: 'town', name: 'Thimblewick', description: 'A gnome village.', seed: 4242, river: 'ns', coast: 'none', walls: false, forest: 0.4, hills: 0.2, roads: ['n', 's'],
    locations: [
      { id: 'inn', name: 'The Thimble & Thistle', kind: 'inn', x: 0.45, y: 0.5, description: 'Pies.', secret: false },
      { id: 'tower', name: 'Bell Tower', kind: 'tower', x: 0.55, y: 0.4, description: 'The Great Bell.', secret: false },
      { id: 'mill', name: 'Old Mill', kind: 'mill', x: 0.3, y: 0.65, description: 'Creaks.', secret: false },
      { id: 'square', name: 'Bell Square', kind: 'square', x: 0.5, y: 0.55, description: 'Lanterns.', secret: false },
      { id: 'den', name: "Smugglers' Den", kind: 'cave', x: 0.8, y: 0.2, description: 'Hidden.', secret: true },
    ],
    connections: [['inn', 'square'], ['square', 'tower'], ['mill', 'den']],
  };
  c.scene.areaMapId = 'town';
  c.scene.areaLocationId = 'square';
  c.knowledge = { u_a: { town: { owned: false, discovered: ['inn'] } }, u_b: { town: { owned: false, discovered: ['mill', 'den'] } } };
  return c;
}
const areaFor = (c, uid) => buildView(c, uid).areaMaps.find((a) => a.map.id === 'town');
const shape = (s) => JSON.stringify({ roads: s.roads, buildings: s.buildings, trees: s.trees, hills: s.hills, mountains: s.mountains, fields: s.fields, rivers: s.rivers, lakes: s.lakes, bridges: s.bridges, plazas: s.plazas });

test('two players who found different places get exactly the same drawing', () => {
  const c = setup();
  const a = areaFor(c, 'u_a');
  const b = areaFor(c, 'u_b');
  const sa = buildArea(a.map, a.knowledge);
  const sb = buildArea(b.map, b.knowledge);
  assert.equal(shape(sa), shape(sb));
  assert.notDeepEqual(sa.markers.map((m) => m.loc.id).sort(), sb.markers.map((m) => m.loc.id).sort(), 'what each has found still differs');
});

test("places you haven't found come without names; secret ones don't come at all", () => {
  const c = setup();
  const a = areaFor(c, 'u_a');
  const ids = a.map.locations.map((l) => l.id);
  assert.ok(!ids.includes('den'), 'the secret den stays on the server');
  assert.ok(!a.map.connections.some((p) => p.includes('den')));
  const mill = a.map.locations.find((l) => l.id === 'mill');
  assert.equal(mill.name, undefined);
  assert.equal(mill.description, undefined);
  assert.equal(a.map.locations.find((l) => l.id === 'square').name, 'Bell Square', 'where you stand is known');
  const b = areaFor(c, 'u_b');
  assert.equal(b.map.locations.find((l) => l.id === 'den').name, "Smugglers' Den", 'a found secret place is marked');
});

test('finding a secret place adds a marker without changing the map', () => {
  const c = setup();
  const before = areaFor(c, 'u_a');
  c.knowledge.u_a.town.discovered.push('den');
  const after = areaFor(c, 'u_a');
  const s1 = buildArea(before.map, before.knowledge);
  const s2 = buildArea(after.map, after.knowledge);
  assert.equal(shape(s1), shape(s2));
  assert.ok(s2.markers.some((m) => m.loc.id === 'den'));
});
