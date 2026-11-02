// The host can begin (or carry on) without players who aren't here. For each one the host chooses: they sit the
// session out, for a reason the host gives, or the DM plays them like an NPC. Nobody waits for them, and they take
// their character back as soon as they join.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-away-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { buildView } = await import('../server/game/views.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let n = 0;
// u_a hosts and plays Yorgy; u_b plays Julie; u_c plays Lorax
function setup({ online = ['u_a', 'u_b', 'u_c'] } = {}) {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Away ${++n}` });
  ['u_a', 'u_b', 'u_c'].forEach((u, i) => {
    const id = `ch_${n}_${i}`;
    C.storeNewCharacter({ id, ownerId: u, name: ['Yorgy', 'Julie', 'Lorax'][i], hp: { max: 12, current: 12, temp: 0 }, abilities: { str: 12, dex: i === 2 ? 20 : 12, con: 12, int: 10, wis: 10, cha: 10 } }); // Lorax is quick: always first in a fight
    if (i === 0) c.members[0].characterId = id;
    else c.members.push({ userId: u, role: 'player', joinedAt: Date.now(), characterId: id });
  });
  E.setSceneMap(c, { theme: 'tavern', name: 'The Thimble & Thistle', size: 'small' });
  for (const u of online) E.setOnline(c, u, `s_${n}_${u}`, true);
  return c;
}
const ch = (c, u) => C.getCharacter(C.member(c, u).characterId);
const SICK = { mode: 'out', reason: 'down with bell fever at the inn' };

test('only the host can begin without everyone, and must choose for each missing player', () => {
  const c = setup({ online: ['u_a', 'u_b'] });
  assert.match(E.startSession(c).error, /Everyone needs to be at the table first.*host can begin without them/);
  assert.match(E.startSession(c, { without: { u_c: 'npc' }, byUserId: 'u_b', isHost: false }).error, /Only the host/);
  assert.match(E.startSession(c, { without: {}, byUserId: 'u_a', isHost: true }).error, /Choose what happens with .*Lorax/);
  assert.match(E.startSession(c, { without: { u_c: { mode: 'out', reason: '  ' } }, byUserId: 'u_a', isHost: true }).error, /Say why Lorax is sitting this one out/);
  assert.equal(c.sessionActive, false, 'nothing started');
});

test('beginning without two players: one sits out for the host\'s reason, the DM plays the other', () => {
  const c = setup({ online: ['u_a'] });
  const r = E.startSession(c, { without: { u_b: SICK, u_c: 'npc' }, byUserId: 'u_a', isHost: true });
  assert.ok(r.ok, r.error);
  assert.equal(c.sessionActive, true);
  assert.deepEqual(E.missingPlayers(c), [], 'the table waits for nobody');
  assert.equal(E.canAct(c), null);
  assert.ok(!E.tokenForCharacter(c, ch(c, 'u_b').id), "Julie's chip leaves the battle map");
  assert.ok(E.tokenForCharacter(c, ch(c, 'u_c').id), 'Lorax stays with the party');
  assert.deepEqual(E.sceneParty(c).map((x) => x.name).sort(), ['Lorax', 'Yorgy']);
  // the DM's opening hears the reason and who it plays
  const text = c.pendingInput?.text || '';
  assert.match(text, /Julie .* sits this out\. The host's reason: "down with bell fever at the inn"/);
  assert.match(text, /YOU play Lorax/);
  assert.ok(c.log.some((e) => e.kind === 'system' && /Julie sits this one out \(down with bell fever at the inn\)/.test(e.text) && /the DM plays Lorax/.test(e.text)));
  // everyone sees who is away and how
  const members = buildView(c, 'u_a').members;
  assert.deepEqual(members.find((m) => m.userId === 'u_b').away, { mode: 'out', reason: SICK.reason });
  assert.deepEqual(members.find((m) => m.userId === 'u_c').away, { mode: 'npc', reason: '' });
});

test('rounds wait only for the players at the table, and the DM plays the away character', async () => {
  const c = setup({ online: ['u_a'] });
  E.startSession(c, { without: { u_b: SICK, u_c: 'npc' }, byUserId: 'u_a', isHost: true });
  await tick(); // the opening turn finishes (no AI here)
  E.openActions(c);
  assert.deepEqual(E.roundNeeds(c), ['u_a']);
  E.submitAction(c, 'u_a', { text: 'Yorgy orders a round of pies.' });
  const text = c.pendingInput?.text || '';
  assert.match(text, /Yorgy .*: Yorgy orders a round of pies\./);
  assert.match(text, /You play Lorax \(ch_\d+_2\) this round/);
  assert.doesNotMatch(text, /You play .*Julie/);
});

test("rolls asked of the DM's character roll themselves", () => {
  const c = setup({ online: ['u_a'] });
  E.startSession(c, { without: { u_b: SICK, u_c: 'npc' }, byUserId: 'u_a', isHost: true });
  const req = E.makeRollRequest(c, { characterId: ch(c, 'u_c').id, kind: 'skill', key: 'perception', dc: 12 }, 'turn');
  const mine = E.makeRollRequest(c, { characterId: ch(c, 'u_a').id, kind: 'skill', key: 'perception', dc: 12 }, 'turn');
  c.phase = 'rolls';
  c.round.rollRequests = [req, mine];
  E.rollForAway(c);
  assert.equal(req.status, 'done');
  assert.equal(mine.status, 'pending', 'present players still roll their own dice');
});

test('a player who comes back takes their character back, into the scene if they sat out', () => {
  const c = setup({ online: ['u_a'] });
  E.startSession(c, { without: { u_b: SICK, u_c: 'npc' }, byUserId: 'u_a', isHost: true });
  c.awayNews = [];
  E.setOnline(c, 'u_b', 's_back', true);
  E.playerReturned(c, 'u_b');
  assert.equal(C.member(c, 'u_b').away, null);
  assert.ok(E.tokenForCharacter(c, ch(c, 'u_b').id), 'Julie is back on the map');
  assert.deepEqual(c.awayNews, [{ userId: 'u_b', mode: 'back', wasOut: true }]);
  E.openActions(c);
  assert.deepEqual(E.roundNeeds(c).sort(), ['u_a', 'u_b'], 'the table waits for Julie again');
});

test('someone dropping off mid-session pauses the table until the host carries on without them', () => {
  const c = setup();
  assert.ok(E.startSession(c).ok);
  E.setOnline(c, 'u_c', `s_${n}_u_c`, false);
  assert.match(E.canAct(c).error, /Paused until everyone is here.*Lorax.*host can carry on/);
  assert.match(E.carryOnWithout(c, {}, 'u_a').error, /Choose what happens/);
  assert.ok(E.carryOnWithout(c, { u_c: 'npc' }, 'u_a').ok);
  assert.equal(E.canAct(c), null);
});

test("in a fight the DM takes the away character's turn, and one sitting out steps out of it", async () => {
  const c = setup();
  assert.ok(E.startSession(c).ok);
  await tick();
  E.openActions(c);
  E.applyTurnResult(c, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Goblins burst in!' }] }], combatStart: [{ enemies: [{ monster: 'goblin', count: 1 }], useCurrentMap: true }] });
  const k = c.combat;
  assert.ok(k, 'a fight is on');
  // Lorax goes first, then Yorgy, then Julie
  const init = { u_a: 15, u_b: 2, u_c: 20 };
  for (const req of k.rollRequests.filter((r) => r.purpose === 'initiative')) E.respondRoll(c, req.userId, req.id, { mode: 'manual', natural: init[req.userId] });
  const loraxCb = Object.values(k.combatants).find((x) => x.characterId === ch(c, 'u_c').id);
  assert.equal(k.combatants[k.order[k.turnIndex]], loraxCb, 'Lorax acts first');
  assert.equal(k.state, 'turn');
  // Lorax's player drops; the host has the DM play them, and the turn is taken (the AI is off here, so it passes)
  E.setOnline(c, 'u_c', `s_${n}_u_c`, false);
  assert.ok(E.carryOnWithout(c, { u_c: 'npc' }, 'u_a').ok);
  await tick();
  assert.equal(k.awayTurn, null);
  assert.ok(c.log.some((e) => /Lorax ends their turn/.test(e.text || '')));
  assert.notEqual(k.combatants[k.order[k.turnIndex]], loraxCb, 'the fight moved on');
  // Julie's player drops too and sits out: she leaves the fight and the map
  E.setOnline(c, 'u_b', `s_${n}_u_b`, false);
  assert.ok(E.carryOnWithout(c, { u_b: { mode: 'out', reason: 'chasing a runaway goat' } }, 'u_a').ok);
  const julieCb = Object.values(k.combatants).find((x) => x.characterId === ch(c, 'u_b').id);
  assert.equal(julieCb.withdrawn, true);
  assert.ok(!E.tokenForCharacter(c, ch(c, 'u_b').id));
});
