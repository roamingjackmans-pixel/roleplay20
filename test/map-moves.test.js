// When the story moves people, the DM moves their tokens: characters, NPCs (placed if they have no token yet) and
// enemies, to coordinates or next to a named token or prop, always onto an open cell.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-moves-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const K = await import('../server/game/combat.js');
const { generateTacticalMap } = await import('../server/game/mapgen.js');
const { cellCost } = await import('../server/game/pathing.js');

function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Moves' });
  const map = generateTacticalMap({ theme: 'tavern', size: 'small', seed: 7 });
  map.objects = [...(map.objects || []), { id: 'o_bar', kind: 'table', x: 4, y: 4, w: 1, h: 1, blocksMove: true, label: 'The long bar' }];
  c.maps.tactical[map.id] = map;
  c.scene.tacticalMapId = map.id;
  c.members[0].characterId = 'ch_a';
  c.members.push({ userId: 'u_b', role: 'player', joinedAt: Date.now(), characterId: 'ch_b' });
  C.storeNewCharacter({ id: 'ch_a', ownerId: 'u_a', name: 'Yorgy Stonebeard', hp: { max: 10, current: 10, temp: 0 } });
  C.storeNewCharacter({ id: 'ch_b', ownerId: 'u_b', name: 'Julie', hp: { max: 10, current: 10, temp: 0 } });
  const open = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (Number.isFinite(cellCost(map, x, y))) open.push([x, y]);
  E.addToken(c, { kind: 'pc', characterId: 'ch_a', name: 'Yorgy Stonebeard', x: open[0][0], y: open[0][1] });
  E.addToken(c, { kind: 'pc', characterId: 'ch_b', name: 'Julie', x: open[1][0], y: open[1][1] });
  c.npcs.npc_pip = { id: 'npc_pip', name: 'Grandmother Pip', status: 'alive', color: '#c9a' };
  return { c, map, open };
}
const tokOf = (c, pred) => Object.values(c.tokens).find(pred);
const walkable = (map, t) => Number.isFinite(cellCost(map, t.x, t.y));

test('a character moves to the cell the story names, by id or first name', () => {
  const { c, map, open } = setup();
  const [x, y] = open[open.length - 1];
  E.applyEffects(c, [{ type: 'move_token', target: 'ch_b', text: `${x},${y}` }]);
  const julie = tokOf(c, (t) => t.characterId === 'ch_b');
  assert.deepEqual([julie.x, julie.y], [x, y]);
  const [x2, y2] = open[Math.floor(open.length / 2)];
  E.applyEffects(c, [{ type: 'move_token', target: 'Yorgy', text: `${x2},${y2}` }]);
  const yorgy = tokOf(c, (t) => t.characterId === 'ch_a');
  assert.ok(Math.max(Math.abs(yorgy.x - x2), Math.abs(yorgy.y - y2)) <= 1);
});

test('nobody lands on a wall or on top of someone else', () => {
  const { c, map } = setup();
  const julie = tokOf(c, (t) => t.characterId === 'ch_b');
  E.applyEffects(c, [{ type: 'move_token', target: 'ch_a', text: `${julie.x},${julie.y}` }]);
  const yorgy = tokOf(c, (t) => t.characterId === 'ch_a');
  assert.notDeepEqual([yorgy.x, yorgy.y], [julie.x, julie.y]);
  assert.ok(walkable(map, yorgy));
});

test('an NPC with no token is placed next to a named prop, then walks over to a character', () => {
  const { c, map } = setup();
  E.applyEffects(c, [{ type: 'move_token', target: 'npc_pip', text: 'next to the long bar' }]);
  const pip = tokOf(c, (t) => t.npcId === 'npc_pip');
  assert.ok(pip, 'Pip gets a token');
  assert.ok(walkable(map, pip));
  assert.ok(Math.max(Math.abs(pip.x - 4), Math.abs(pip.y - 4)) <= 2, 'beside the bar');
  E.applyEffects(c, [{ type: 'move_token', target: 'Grandmother Pip', text: 'Julie' }]);
  const julie = tokOf(c, (t) => t.characterId === 'ch_b');
  assert.ok(Math.max(Math.abs(pip.x - julie.x), Math.abs(pip.y - julie.y)) <= 2, 'Pip stands near Julie');
});

test('"party" moves every player character together into open cells', () => {
  const { c, map, open } = setup();
  const [x, y] = open[Math.floor(open.length * 0.75)];
  E.applyEffects(c, [{ type: 'move_token', target: 'party', text: `${x},${y}` }]);
  const pcs = Object.values(c.tokens).filter((t) => t.kind === 'pc');
  assert.equal(new Set(pcs.map((t) => `${t.x},${t.y}`)).size, pcs.length);
  for (const t of pcs) {
    assert.ok(walkable(map, t));
    assert.ok(Math.max(Math.abs(t.x - x), Math.abs(t.y - y)) <= 2);
  }
});

test('an unknown target or destination changes nothing', () => {
  const { c } = setup();
  const before = JSON.stringify(c.tokens);
  assert.deepEqual(K.dmMoveToken(c, 'nobody at all', '3,3'), []);
  assert.deepEqual(K.dmMoveToken(c, 'ch_a', 'somewhere vague'), []);
  assert.equal(JSON.stringify(c.tokens), before);
});
