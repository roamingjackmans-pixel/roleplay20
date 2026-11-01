// A question to one character waits only for that player; clashing actions are settled by a contested roll.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-convo-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');

let n = 0;
function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Convo ${++n}` });
  const ids = ['u_a', 'u_b', 'u_c'];
  ids.forEach((u, i) => {
    const id = `ch_${n}_${i}`;
    C.storeNewCharacter({ id, ownerId: u, name: ['Yorgy', 'Julie', 'Lorax'][i], hp: { max: 10, current: 10, temp: 0 } });
    if (i === 0) c.members[0].characterId = id;
    else c.members.push({ userId: u, role: 'player', joinedAt: Date.now(), characterId: id });
    E.setOnline(c, u, `s_${n}_${u}`, true);
  });
  c.sessionActive = true;
  return c;
}
const charId = (c, uid) => C.member(c, uid).characterId;

test('when an NPC asks one character, the round resolves on that player\'s answer alone', () => {
  const c = setup();
  E.applyTurnResult(c, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Pell turns to Julie: "Where did you learn that rhythm?"' }] }], waitFor: [charId(c, 'u_b')] });
  assert.equal(c.phase, 'actions');
  assert.deepEqual(E.roundNeeds(c), ['u_b']);
  assert.deepEqual(E.submitAction(c, 'u_b', { text: 'From my grandmother, on the steppe.' }), { ok: true });
  assert.deepEqual(c.round.actions, {}, 'resolved without waiting for Yorgy or Lorax');
});

test('the others can chime in, and their words go to the DM with the answer', () => {
  const c = setup();
  E.openActions(c, { waitFor: E.waitForUsers(c, ['Julie']) });
  E.submitAction(c, 'u_c', { text: 'Lorax raises an eyebrow at Pell.' });
  assert.ok(c.round.actions.u_c, 'chiming in does not end the round');
  E.submitAction(c, 'u_b', { text: 'Julie shrugs.' });
  assert.deepEqual(c.round.actions, {});
  const logged = c.log.filter((e) => e.kind === 'action').map((e) => e.name);
  assert.deepEqual(logged.sort(), ['Julie', 'Lorax']);
});

test('without a directed question the round still waits for everyone', () => {
  const c = setup();
  E.applyTurnResult(c, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'The bell hums.' }] }], waitFor: [] });
  E.submitAction(c, 'u_b', { text: 'Julie listens.' });
  assert.ok(c.round.actions.u_b, 'still waiting for the others');
  assert.equal(E.roundNeeds(c).length, 3);
});

test('a question to someone who cannot answer falls back to the whole table', () => {
  const c = setup();
  E.openActions(c, { waitFor: E.waitForUsers(c, ['nobody', 'ch_missing']) });
  assert.equal(E.roundNeeds(c).length, 3);
});

test('a contested roll: the higher total wins, a tie keeps things as they were', () => {
  const done = (name, total, contest) => ({ characterName: name, contest, status: 'done', result: { total }, kind: 'skill', key: 'athletics' });
  const [win] = E.contestResults([done('Yorgy', 17, 'idol'), done('Julie', 12, 'idol'), done('Lorax', 20, '')]);
  assert.equal(win.winner.characterName, 'Yorgy');
  assert.equal(win.tie, false);
  const [tie] = E.contestResults([done('Yorgy', 14, 'door'), done('Julie', 14, 'door')]);
  assert.equal(tie.tie, true);
  assert.equal(tie.winner, null);
  assert.deepEqual(E.contestResults([done('Yorgy', 14, 'solo')]), [], 'one side is not a contest');
});

test('contest roll requests are open to both players, with no DC', () => {
  const c = setup();
  const r = E.makeRollRequest(c, { characterId: charId(c, 'u_b'), kind: 'skill', key: 'sleight of hand', dc: 15, secret: true, contest: 'palm_disc', reason: 'Palm the disc' }, 'turn');
  assert.equal(r.contest, 'palm_disc');
  assert.equal(r.dc, 0);
  assert.equal(r.secret, false);
  assert.equal(r.key, 'sleightOfHand');
});
