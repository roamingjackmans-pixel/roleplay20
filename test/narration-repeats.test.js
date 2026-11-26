// The DM doesn't tell the table again what it just read: a narrator sentence that nearly copies one the same players
// read in the last narrations is left out (short ones never are, and nothing is ever emptied), the DM sees how its last
// narration ended, and every turn reminds it to carry on from there. And a Private action shows the same 👀 as
// "Just watch" to everyone else, with its roll kept secret, so the table can't tell the two apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-repeats-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { dropRepeats, contentWords, sentences } = await import('../server/game/repeats.js');
const { historyBlock, turnPrompt, clipMiddle, CARRY_ON } = await import('../server/game/context.js');
const { buildView } = await import('../server/game/views.js');

let n = 0;
// u_a hosts and plays Brannoc; u_b plays Tamsin
function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Repeats ${++n}` });
  ['u_a', 'u_b'].forEach((u, i) => {
    const id = `ch_r${n}_${i}`;
    C.storeNewCharacter({ id, ownerId: u, name: ['Brannoc', 'Tamsin'][i], hp: { max: 12, current: 12, temp: 0 }, abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 } });
    if (i === 0) c.members[0].characterId = id;
    else c.members.push({ userId: u, role: 'player', joinedAt: Date.now(), characterId: id });
  });
  return c;
}
const ON = new Set(['u_a', 'u_b']);
const narrator = (text, to = 'all') => ({ to, parts: [{ speaker: 'narrator', text }] });
const ENDING = 'The storm finally breaks over the stone circle. Wind returns to the ring, shy at first, then tugging at the herald\'s braids. Her riders stir like people waking from a bad dream, hands going to drums that finally speak again.';

test('a sentence the table just read is left out; what is new stays', () => {
  const next = 'Wind returns to the ring, shy at first, then tugging at the herald\'s braids. Her riders stir like people waking from a bad dream, hands going to the drums that finally speak again. The herald turns to you, eyes wet, and lowers her spear.';
  const r = dropRepeats([narrator(next)], [narrator(ENDING)]);
  assert.equal(r.dropped, 2);
  assert.equal(r.segments[0].parts[0].text, 'The herald turns to you, eyes wet, and lowers her spear.');
});

test('a close copy with a word or two changed still counts; a sentence that adds real news does not', () => {
  const r = dropRepeats([narrator('The wind comes back to the ring, shy at first, then tugs at the herald\'s braids. Then a horn sounds from the eastern ridge, long and low, and every rider turns toward it.')], [narrator(ENDING)]);
  assert.equal(r.dropped, 1);
  assert.match(r.segments[0].parts[0].text, /^Then a horn sounds/);
  const more = 'Wind returns to the ring and tugs at the herald\'s braids while a stranger in grey walks out of the mist carrying a lantern made of bone.';
  assert.equal(dropRepeats([narrator(more)], [narrator(ENDING)]).dropped, 0, 'mostly new: kept whole');
});

test('short sentences are never touched: a new blow can be told in the same words', () => {
  const r = dropRepeats([narrator('The goblin slashes at Brannoc again. Its blade bites into his shield arm.')], [narrator('The goblin slashes at Brannoc again. He grunts.')]);
  assert.equal(r.dropped, 0);
});

test('only what these same readers saw counts, and earlier in the same reply counts too', () => {
  const secret = narrator(ENDING, ['u_b']);
  assert.equal(dropRepeats([narrator(ENDING.split('. ').slice(1).join('. '))], [secret]).dropped, 0, 'only Tamsin read it: the table still needs it');
  const r = dropRepeats([narrator(ENDING.split('. ').slice(1).join('. '), ['u_b'])], [narrator(ENDING)]);
  assert.equal(r.dropped, 0, 'nothing left for Tamsin: the narration stays as it was');
  const reply = [narrator(ENDING), { to: ['u_b'], parts: [{ speaker: 'narrator', text: 'Her riders stir like people waking from a bad dream, hands going to drums that finally speak again. Only you notice the ring of ash under the herald\'s boots.' }] }];
  const s = dropRepeats(reply, []);
  assert.equal(s.dropped, 1);
  assert.equal(s.segments[1].parts[0].text, 'Only you notice the ring of ash under the herald\'s boots.');
});

test('NPC lines are left alone, and a reply is never emptied', () => {
  const npcLine = { to: 'all', parts: [{ speaker: 'npc_herald', text: 'Wind returns to the ring, shy at first, then tugging at my braids. My riders stir.' }] };
  assert.equal(dropRepeats([npcLine], [narrator(ENDING)]).dropped, 0);
  const tail = ENDING.split('. ').slice(1).join('. ');
  const all = dropRepeats([narrator(tail)], [narrator(ENDING)]);
  assert.equal(all.dropped, 0, 'every sentence a repeat: kept as it was');
  assert.equal(all.segments[0].parts[0].text, tail);
});

test('words and sentences', () => {
  assert.deepEqual(sentences('One. Two! "Three?" Four'), ['One. ', 'Two! ', '"Three?" ', 'Four']);
  assert.deepEqual(contentWords("The herald's braids return, returning"), ['herald', 'braid', 'return']);
});

test('posted turns: the retold opening is gone from the story, a new session\'s recap is not trimmed', () => {
  const c = setup();
  E.applyTurnResult(c, { narration: [narrator(ENDING)] }, { kind: 'actions' });
  E.applyTurnResult(c, { narration: [narrator(`${ENDING.split('. ').slice(1).join('. ')} The herald lowers her spear and asks your names.`)] }, { kind: 'actions' });
  assert.equal(c.log.at(-1).parts[0].text, 'The herald lowers her spear and asks your names.');
  assert.match(historyBlock(c), /asks your names/, 'the DM\'s history holds what was posted');
  E.applyTurnResult(c, { narration: [narrator(ENDING)] }, { kind: 'recap' });
  assert.equal(c.log.at(-1).parts[0].text, ENDING, '"Previously on..." retells on purpose');
});

test('the DM sees how a long narration ended, and is told to carry on from there', () => {
  const c = setup();
  const long = `${Array.from({ length: 40 }, (_, i) => `Mile ${i + 1} goes by under grey skies.`).join(' ')} At last the gate of the keep swings open before you.`;
  E.applyTurnResult(c, { narration: [narrator(long)] }, { kind: 'actions' });
  assert.match(historyBlock(c), /gate of the keep swings open before you\./, 'the ending survives the cut');
  assert.equal(clipMiddle('abcdefghij', 20), 'abcdefghij');
  assert.ok(clipMiddle('x'.repeat(5000), 1600).length <= 1600);
  const p = turnPrompt(c, { kind: 'actions', text: 'Brannoc: I walk in.' }, ON);
  assert.ok(p.includes(`# THIS TURN\n${CARRY_ON}`));
  assert.ok(!turnPrompt(c, { kind: 'recap', text: 'A new session begins.' }, ON).includes(CARRY_ON), 'not for the recap');
  assert.ok(!turnPrompt(setup(), { kind: 'actions', text: 'Brannoc: I look around.' }, ON).includes(CARRY_ON), 'nothing to carry on from yet');
});

test('a Private action shows 👀 to the others, like Just watch', () => {
  const c = setup();
  c.round.actions.u_a = { text: 'I pocket the key while nobody looks.', private: true, at: Date.now() };
  const seenBy = (viewer) => buildView(c, viewer).members.find((m) => m.userId === 'u_a');
  assert.deepEqual([seenBy('u_b').submitted, seenBy('u_b').watching], [true, true], 'Tamsin sees eyes');
  assert.equal(seenBy('u_a').watching, false, 'Brannoc\'s player knows what they did');
  c.round.actions.u_b = { text: '(just watching)', private: false, watch: true, at: Date.now() };
  assert.equal(buildView(c, 'u_a').members.find((m) => m.userId === 'u_b').watching, true, 'Just watch looks the same');
  c.round.actions.u_a = { text: 'I wave to the guard.', private: false, at: Date.now() };
  assert.equal(seenBy('u_b').watching, false, 'an open action is just "ready"');
  // the host in God view sees what it really is
  c.round.actions.u_b = { text: 'I read the letter alone.', private: true, at: Date.now() };
  c.settings.dmView = true;
  assert.equal(buildView(c, 'u_a').members.find((m) => m.userId === 'u_b').watching, false);
});

test('a roll for a Private action is secret, so the table sees only "a secret roll"', () => {
  const c = setup();
  const [a, b] = ['u_a', 'u_b'].map((u) => C.member(c, u).characterId);
  E.applyTurnResult(c, {
    narration: [narrator('Brannoc lingers by the desk a moment longer.')],
    rollRequests: [{ characterId: a, kind: 'skill', key: 'sleightOfHand', dc: 13, reason: 'Lift the key unseen' }, { characterId: b, kind: 'skill', key: 'perception', dc: 12, reason: 'Spot the guard' }],
  }, { kind: 'actions', actions: [{ characterId: a, name: 'Brannoc', text: 'I pocket the key.', private: true }, { characterId: b, name: 'Tamsin', text: 'I watch the door.', private: false }] });
  const [ra, rb] = c.round.rollRequests;
  assert.equal(ra.secret, true);
  assert.equal(rb.secret, false);
  assert.deepEqual(buildView(c, 'u_b').rolls.waiting.map((w) => w.label), ['a secret roll', 'Spot the guard']);
});
