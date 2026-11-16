// Private table talk to one player, and DM chat (a player's private questions to the DM). Both are seen only by the
// people they are for, never by anyone else, not even the host with God view on.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-private-chat-'));
process.env.DATA_DIR = DATA;
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'file'; // the "DM" answers by writing a reply file, so the round trip can be tested
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const DC = await import('../server/game/dmchat.js');
const { logVisibleTo } = await import('../server/game/views.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let n = 0;
/** u_a hosts (God view on), u_b and u_c are here, u_d is away from the table. */
function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Chat ${++n}` });
  for (const u of ['u_b', 'u_c', 'u_d']) c.members.push({ userId: u, role: 'player', joinedAt: Date.now() });
  c.settings.dmView = true;
  for (const u of ['u_a', 'u_b', 'u_c']) E.setOnline(c, u, `s_${n}_${u}`, true);
  return c;
}
const sees = (c, e) => ['u_a', 'u_b', 'u_c', 'u_d'].filter((u) => logVisibleTo(c, e, u));

test('table talk to everyone is seen by everyone', () => {
  const c = setup();
  assert.ok(E.chat(c, 'u_b', 'Anyone want pie?').ok);
  assert.deepEqual(sees(c, c.log.at(-1)), ['u_a', 'u_b', 'u_c', 'u_d']);
});

test('a private message to one player is seen only by the two of them (not even in God view)', () => {
  const c = setup();
  assert.ok(E.chat(c, 'u_b', 'Psst, I pocketed the key.', 'u_c').ok);
  const e = c.log.at(-1);
  assert.deepEqual(sees(c, e), ['u_b', 'u_c']);
  assert.equal(e.toUserId, 'u_c');
  assert.match(E.chat(c, 'u_b', 'hello?', 'u_d').error, /isn't at the table right now/);
  assert.match(E.chat(c, 'u_b', 'me?', 'u_b').error, /someone else/);
  assert.match(E.chat(c, 'u_b', 'who?', 'u_nobody').error, /not in this campaign/);
  assert.match(E.chat(c, 'u_b', '   ', 'u_c').error, /Type a message/);
});

test('DM chat: the question and the answer are only for the player who asked', async () => {
  const c = setup();
  const r = DC.askDm(c, 'u_b', 'How far can I throw a javelin?');
  assert.ok(r.ok, r.error);
  const q = c.log.at(-1);
  assert.equal(q.kind, 'dmchat');
  assert.deepEqual(sees(c, q), ['u_b'], 'not the other players, not the host in God view');
  assert.match(DC.askDm(c, 'u_b', 'And a dagger?').error, /still answering/);

  // the DM (here: a reply file) answers
  const inbox = path.join(DATA, 'ai-inbox');
  let req = null;
  for (let i = 0; i < 50 && !req; i++) { await tick(40); req = fs.existsSync(inbox) && fs.readdirSync(inbox).find((f) => f.includes('dm_chat') && f.endsWith('.prompt.md')); }
  assert.ok(req, 'the question went to the DM');
  const prompt = fs.readFileSync(path.join(inbox, req), 'utf8');
  assert.match(prompt, /private, out-of-character question in a side chat/);
  assert.match(prompt, /Never reveal DM secrets/);
  assert.match(prompt, /# THEIR QUESTION\nHow far can I throw a javelin\?/);
  fs.writeFileSync(path.join(inbox, req.replace('.prompt.md', '.response.json')), JSON.stringify({ answer: 'A javelin flies 30 feet, or up to 120 with disadvantage.' }));
  let a = null;
  for (let i = 0; i < 60 && !a; i++) { await tick(50); a = c.log.find((e) => e.kind === 'dmchat' && e.role === 'dm' && e.replyTo === q.id); }
  assert.ok(a, 'the answer arrived');
  assert.match(a.text, /30 feet/);
  assert.deepEqual(sees(c, a), ['u_b']);
  assert.equal(DC.isAnswering(c, 'u_b'), false, 'free to ask again');

  // a follow-up question carries the earlier exchange, so "and a dagger?" makes sense
  assert.ok(DC.askDm(c, 'u_b', 'And a dagger?').ok);
  const follow = DC.dmChatPrompt(c, 'u_b', c.log.at(-1));
  assert.match(follow, /Player: How far can I throw a javelin\?\nDM: A javelin flies 30 feet/);
});

test('DM chat never touches the table: no turn, no round, nothing waiting on it', () => {
  const c = setup();
  const before = { phase: c.phase, round: c.round.n, thinking: c.thinking };
  DC.askDm(c, 'u_c', 'What does my character know about the Heartforge?');
  assert.deepEqual({ phase: c.phase, round: c.round.n, thinking: c.thinking }, before);
  assert.match(DC.askDm(c, 'u_zed', 'hi').error, /Join the campaign/);
  assert.match(DC.askDm(c, 'u_d', '  ').error, /Type your question/);
});

// answer any question still waiting, so the "DM" (polling for reply files) lets the process finish
after(async () => {
  const inbox = path.join(DATA, 'ai-inbox');
  if (!fs.existsSync(inbox)) return;
  for (const f of fs.readdirSync(inbox).filter((x) => x.endsWith('.prompt.md'))) {
    const out = path.join(inbox, f.replace('.prompt.md', '.response.json'));
    if (!fs.existsSync(out)) fs.writeFileSync(out, JSON.stringify({ answer: 'ok' }));
  }
  await tick(1200);
});
