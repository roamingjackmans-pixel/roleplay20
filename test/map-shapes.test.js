// Battle maps that match the scene: a place with a shape that matters (a skull shrine, a round tower room) is built
// in that shape, and the things the scene is about (four dragon eggs to protect) are on the grid, labelled and numbered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-shapes-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const M = await import('../server/game/mapgen.js');
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');

const WALK = new Set(['.', ',', '"', '=', '_', ':', '~', '%', '+', '/']);
const tile = (m, x, y) => m.tiles[y * m.w + x];
/** Cells someone can walk to from (sx, sy), going around walls, pits and blocking objects. */
function reach(m, sx, sy) {
  const blocked = new Set();
  for (const o of m.objects) if (o.blocksMove) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) blocked.add(`${x},${y}`);
  const seen = new Set([`${sx},${sy}`]);
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy, key = `${nx},${ny}`;
      if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h || seen.has(key) || !WALK.has(tile(m, nx, ny)) || blocked.has(key)) continue;
      seen.add(key);
      q.push([nx, ny]);
    }
  }
  return seen;
}
const nextTo = (cells, o) => [[1, 0], [-1, 0], [0, 1], [0, -1], [0, 0]].some(([dx, dy]) => cells.has(`${o.x + dx},${o.y + dy}`));

test('"Inside the Skull Shrine" is built as a skull, with the four eggs on the grid', () => {
  const m = M.generateTacticalMap({ theme: 'temple', name: 'Inside the Skull Shrine', size: 'medium', seed: 7, keyObjects: [{ name: 'four dragon eggs', count: 4, placement: 'focal' }] });
  assert.equal(m.shape, 'skull', 'taken from the name');
  assert.equal(m.w, m.h, 'a skull reads best on a square grid');
  // two eye sockets (pits), mirror images of each other, and a row of teeth
  const pits = [];
  for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) if (tile(m, x, y) === ' ') pits.push([x, y]);
  const left = pits.filter(([x]) => x < m.w / 2 - 2).length;
  const right = pits.filter(([x]) => x > m.w / 2 + 1).length;
  assert.ok(left >= 6 && right >= 6 && Math.abs(left - right) <= 2, `eye sockets ${left}/${right}`);
  assert.ok(m.objects.filter((o) => o.label === 'Tooth').length >= 4, 'teeth');
  assert.ok(m.regions.some((r) => r.name === 'Left eye socket') && m.regions.some((r) => r.name === 'Jaw'));
  // the way in is through the jaw at the bottom, and everything that matters can be reached from there
  const mid = Math.round((m.w - 1) / 2);
  assert.ok(WALK.has(tile(m, mid, m.h - 1)), 'an opening at the bottom edge');
  const cells = reach(m, mid, m.h - 1);
  const eggs = m.objects.filter((o) => o.key);
  assert.deepEqual(eggs.map((o) => o.label), ['Dragon egg 1', 'Dragon egg 2', 'Dragon egg 3', 'Dragon egg 4']);
  assert.ok(eggs.every((o) => o.kind === 'egg' && !o.blocksMove));
  for (const e of eggs) assert.ok(nextTo(cells, e), `${e.label} can be reached`);
  for (let i = 0; i < eggs.length; i++) for (let j = i + 1; j < eggs.length; j++) assert.ok(Math.max(Math.abs(eggs[i].x - eggs[j].x), Math.abs(eggs[i].y - eggs[j].y)) >= 2, 'never on top of each other');
  const altar = m.objects.find((o) => o.kind === 'altar');
  assert.ok(eggs.every((e) => Math.hypot(e.x - altar.x, e.y - altar.y) <= 5), 'gathered around the shrine\'s centrepiece');
  // the DM is told where they are
  assert.match(M.describeMapForAI(m), /KEY OBJECTS .*Dragon egg 1 at \d+,\d+; Dragon egg 2 at/);
});

test('every shape builds a sound map in every indoor theme', () => {
  for (const shape of M.SHAPES) {
    for (const theme of ['temple', 'crypt', 'cave', 'castle', 'dungeon']) {
      for (const seed of [1, 2, 3]) {
        const m = M.generateTacticalMap({ theme, name: 'Test', shape, seed, size: 'medium', keyObjects: [{ name: 'Lever', count: 1, placement: 'far' }, { name: 'Glass orbs', count: 3, placement: 'scattered' }] });
        assert.equal(m.shape, shape, `${shape}/${theme}/${seed}`);
        const mid = Math.round((m.w - 1) / 2);
        const cells = reach(m, mid, m.h - 1);
        assert.ok(cells.size > 40, `${shape}/${theme}/${seed}: room to move (${cells.size})`);
        const keys = m.objects.filter((o) => o.key);
        assert.equal(keys.length, 4, `${shape}/${theme}/${seed}: all key objects placed`);
        for (const k of keys) assert.ok(nextTo(cells, k), `${shape}/${theme}/${seed}: ${k.label} reachable`);
        assert.deepEqual(keys.filter((k) => k.kind === 'crystal').map((k) => k.label), ['Glass orb 1', 'Glass orb 2', 'Glass orb 3']);
        assert.equal(keys.find((k) => k.label === 'Lever').kind, 'lever');
      }
    }
  }
});

test('outdoor places keep their usual layout; "auto" and no shape leave a theme alone', () => {
  assert.equal(M.generateTacticalMap({ theme: 'village', name: 'Comet Green beneath the Ribcage', seed: 3 }).shape, undefined);
  assert.equal(M.generateTacticalMap({ theme: 'temple', name: 'Chapel of the Tidemother', seed: 3 }).shape, undefined);
  assert.equal(M.generateTacticalMap({ theme: 'temple', name: 'The Rotunda', shape: 'auto', seed: 3 }).shape, 'round', 'a plain name still counts');
  assert.equal(M.resolveShape({ name: 'The Bone Hall', shape: 'ribcage' }, 'crypt'), 'ribcage');
  assert.equal(M.resolveShape({ name: 'A clearing', shape: 'round' }, 'forest'), null);
  // key objects work on any map
  const m = M.generateTacticalMap({ theme: 'forest', seed: 5, keyObjects: [{ name: 'Stolen crates', count: 2, placement: 'near_party' }] });
  assert.deepEqual(m.objects.filter((o) => o.key).map((o) => `${o.kind}:${o.label}`), ['crate:Stolen crate 1', 'crate:Stolen crate 2']);
});

test('the DM can put key objects on the map mid-scene, and take them away', () => {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Shrine' });
  C.storeNewCharacter({ id: 'ch_sh', ownerId: 'u_a', name: 'Joe', hp: { max: 10, current: 10, temp: 0 }, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  c.members[0].characterId = 'ch_sh';
  E.setSceneMap(c, { theme: 'temple', name: 'Inside the Skull Shrine', size: 'medium', keyObjects: [] });
  const map = c.maps.tactical[c.scene.tacticalMapId];
  assert.equal(map.shape, 'skull');
  const altar = map.objects.find((o) => o.kind === 'altar');
  E.applyEffects(c, [{ type: 'place_object', text: 'Dragon egg', amount: 4, target: 'the altar' }]);
  const eggs = map.objects.filter((o) => o.key);
  assert.deepEqual(eggs.map((o) => o.label), ['Dragon egg 1', 'Dragon egg 2', 'Dragon egg 3', 'Dragon egg 4']);
  assert.ok(eggs.every((e) => Math.hypot(e.x - altar.x, e.y - altar.y) <= 5), 'next to the altar');
  const tokens = Object.values(c.tokens);
  assert.ok(eggs.every((e) => !tokens.some((t) => t.x === e.x && t.y === e.y)), 'never under someone');
  assert.equal(new Set(map.objects.map((o) => o.id)).size, map.objects.length, 'unique ids');
  E.applyEffects(c, [{ type: 'remove_object', text: 'Dragon egg 3' }]);
  assert.deepEqual(map.objects.filter((o) => o.key).map((o) => o.label), ['Dragon egg 1', 'Dragon egg 2', 'Dragon egg 4']);
  E.applyEffects(c, [{ type: 'place_object', text: 'Cursed idol', target: '3,3 hidden' }]);
  assert.equal(map.objects.find((o) => o.label === 'Cursed idol')?.hidden, true);
  E.applyEffects(c, [{ type: 'remove_object', text: 'Dragon egg' }]);
  assert.equal(map.objects.filter((o) => o.label?.startsWith('Dragon egg')).length, 0, 'all of them');
});
