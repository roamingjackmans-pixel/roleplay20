// Reactions (❤️ 😆 😮 😢 😠 👍, as in Messenger) on another player's action or table talk: one each, swap or take it back,
// never on your own message, and only on messages you can see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-reactions-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { visibleLog } = await import('../server/game/views.js');
const { REACTION_EMOJI } = await import('../shared/reactions.js');

function table() {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Reactions' });
  c.members.push({ userId: 'u_b', role: 'player', joinedAt: Date.now() }, { userId: 'u_c', role: 'player', joinedAt: Date.now() });
  for (const u of ['u_a', 'u_b', 'u_c']) E.setOnline(c, u, `s_${u}`, true);
  return c;
}

test("Messenger's six: love, haha, wow, sad, angry, like", () => {
  assert.deepEqual(REACTION_EMOJI, ['❤️', '😆', '😮', '😢', '😠', '👍']);
});

test('react to table talk: one each, pick another to swap, the same again to take it back', () => {
  const c = table();
  E.chat(c, 'u_a', 'Did the goat just wink at me?');
  const msg = c.log.at(-1);
  assert.deepEqual(E.react(c, 'u_b', msg.id, '😆'), { ok: true, reactions: { u_b: '😆' } });
  E.react(c, 'u_c', msg.id, '❤️');
  assert.deepEqual(msg.reactions, { u_b: '😆', u_c: '❤️' });
  E.react(c, 'u_b', msg.id, '😮');
  assert.deepEqual(msg.reactions, { u_b: '😮', u_c: '❤️' }, 'swapped, still one each');
  E.react(c, 'u_b', msg.id, '😮');
  E.react(c, 'u_c', msg.id, '');
  assert.equal(msg.reactions, undefined, 'taken back');
  E.react(c, 'u_b', msg.id, '👍');
  assert.deepEqual(visibleLog(c, 'u_c').find((e) => e.id === msg.id).reactions, { u_b: '👍' }, 'everyone loading the log sees them');
});

test("react to another player's declared action", () => {
  const c = table();
  const act = E.addLog(c, { kind: 'action', userId: 'u_a', characterId: 'ch_a', name: 'Alfa', text: 'I try to pet the dragon.', private: false, to: 'all' });
  assert.equal(E.react(c, 'u_b', act.id, '😆').ok, true);
  assert.deepEqual(act.reactions, { u_b: '😆' });
});

test('not on your own message, not with other emoji, not on narration', () => {
  const c = table();
  E.chat(c, 'u_a', 'Hello');
  const msg = c.log.at(-1);
  assert.match(E.react(c, 'u_a', msg.id, '❤️').error, /your own/);
  assert.match(E.react(c, 'u_b', msg.id, '🍕').error, /Pick one/);
  const story = E.addLog(c, { kind: 'narration', parts: [{ speaker: 'narrator', text: 'Rain.' }], to: 'all' });
  assert.ok(E.react(c, 'u_b', story.id, '❤️').error);
  assert.ok(E.react(c, 'u_b', 'l_nope', '❤️').error);
  assert.match(E.react(c, 'u_stranger', msg.id, '❤️').error, /Join/);
  assert.equal(msg.reactions, undefined);
});

test('only on messages you can see: a whisper between two players, a private action', () => {
  const c = table();
  E.chat(c, 'u_a', 'psst, the innkeeper is lying', 'u_b');
  const whisper = c.log.at(-1);
  assert.ok(E.react(c, 'u_c', whisper.id, '😮').error, 'not part of the whisper');
  assert.equal(E.react(c, 'u_b', whisper.id, '😮').ok, true, 'the one it was sent to can react');
  const secret = E.addLog(c, { kind: 'action', userId: 'u_a', characterId: 'ch_a', name: 'Alfa', text: 'I pocket the ring.', private: true, to: ['u_a'] });
  assert.ok(E.react(c, 'u_b', secret.id, '😠').error);
});
