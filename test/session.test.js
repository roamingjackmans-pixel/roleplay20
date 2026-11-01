// The table only moves when every player is here: sessions begin with everyone present, actions pause otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-session-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');

function setup() {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Test table' });
  c.members[0].characterId = 'ch_a';
  c.members.push({ userId: 'u_two', role: 'player', joinedAt: Date.now(), characterId: 'ch_b' });
  c.members.push({ userId: 'u_watch', role: 'player', joinedAt: Date.now(), characterId: null }); // no character: not waited for
  C.storeNewCharacter({ id: 'ch_a', ownerId: 'u_host', name: 'Alfa', hp: { max: 10, current: 10, temp: 0 } });
  C.storeNewCharacter({ id: 'ch_b', ownerId: 'u_two', name: 'Bravo', hp: { max: 10, current: 10, temp: 0 } });
  return c;
}

test('every player with a character is required; spectators are not', () => {
  const c = setup();
  assert.deepEqual(E.requiredUsers(c).sort(), ['u_host', 'u_two']);
});

test('nobody can act before the session begins', () => {
  const c = setup();
  E.setOnline(c, 'u_host', 's1', true);
  E.setOnline(c, 'u_two', 's2', true);
  assert.match(E.canAct(c).error, /hasn't started/);
});

test('a session only begins when every player is at the table', () => {
  const c = setup();
  E.setOnline(c, 'u_host', 's1', true);
  const r = E.startSession(c);
  assert.match(r.error, /waiting for/);
  assert.equal(c.sessionActive, false);
  assert.equal(c.sessionNumber, 0);
});

test('a prepared opening is posted when the session begins, with its roll requests', () => {
  const c = setup();
  c.sessionNumber = 1;
  c.chronicle.turns.push({ n: 1, summary: 'earlier' });
  c.nextOpening = {
    narration: [{ to: 'all', parts: [{ speaker: 'narrator', text: 'Previously...' }] }, { to: ['u_two'], parts: [{ speaker: 'narrator', text: 'Only Bravo sees this.' }] }],
    rollRequests: [{ characterId: 'ch_b', kind: 'custom', key: '1d4+3', expr: '1d4+3', label: 'Healing Word', reason: 'heal' }],
    summary: 'opened',
  };
  E.setOnline(c, 'u_host', 's1', true);
  E.setOnline(c, 'u_two', 's2', true);
  assert.deepEqual(E.startSession(c), { ok: true });
  assert.equal(c.sessionActive, true);
  assert.equal(c.sessionNumber, 2);
  assert.equal(c.nextOpening, undefined);
  assert.equal(c.phase, 'rolls');
  assert.equal(c.round.rollRequests.length, 1);
  assert.equal(c.round.rollRequests[0].expr, '1d4+3');
  assert.equal(c.round.rollRequests[0].label, 'Healing Word');
  const narr = c.log.filter((e) => e.kind === 'narration');
  assert.equal(narr.length, 2);
  assert.deepEqual(narr[1].to, ['u_two']);
  assert.equal(c.chronicle.turns.at(-1).kind, 'recap');
  assert.equal(E.canAct(c), null);
});

test('when a player drops off mid-session, actions pause until they are back', () => {
  const c = setup();
  c.sessionActive = true;
  c.phase = 'actions';
  E.setOnline(c, 'u_host', 's1', true);
  assert.match(E.canAct(c).error, /Paused until everyone is here/);
  E.setOnline(c, 'u_two', 's2', true);
  assert.equal(E.canAct(c), null);
  E.setOnline(c, 'u_two', 's2', false);
  assert.ok(E.canAct(c).error);
});
