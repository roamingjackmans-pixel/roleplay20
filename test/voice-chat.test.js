// Voice chat at the table: who is in the call, passing connection setup between two players, and "story time" (every
// mic off while the table's narration is read aloud, until it has finished on every device in the call).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const V = await import('../server/game/voice.js');

const sent = [];
V.configureVoice({ toSocket: (sid, event, payload) => sent.push({ sid, event, payload }) });
const c = { id: 'c_voice' };
const narration = (id, text = 'The bell tolls once, low and wrong.', to = 'all') => ({ id, kind: 'narration', to, parts: [{ speaker: 'narrator', text }] });
const lastState = (sid) => sent.filter((m) => m.sid === sid && m.event === 'voice:state').at(-1)?.payload;

beforeEach(() => { V._reset(); sent.length = 0; });

test('joining: the newcomer is told who is already in the call, and everyone sees the roster', () => {
  assert.deepEqual(V.join(c, 'u_a', 's_a').peers, []);
  const r = V.join(c, 'u_b', 's_b');
  assert.deepEqual(r.peers, ['u_a'], 'Bram calls Alex');
  assert.deepEqual(lastState('s_a').members.map((m) => m.userId), ['u_a', 'u_b']);
  assert.deepEqual(V.roster(c), [{ userId: 'u_a', muted: false }, { userId: 'u_b', muted: false }]);
  V.setMuted(c, 'u_b', true);
  assert.equal(lastState('s_a').members.find((m) => m.userId === 'u_b').muted, true);
});

test('connection setup goes only between two people in the call', () => {
  V.join(c, 'u_a', 's_a');
  V.join(c, 'u_b', 's_b');
  assert.ok(V.relay(c, 'u_b', 'u_a', { sdp: { type: 'offer', sdp: 'x' } }).ok);
  assert.deepEqual(sent.at(-1), { sid: 's_a', event: 'voice:signal', payload: { from: 'u_b', data: { sdp: { type: 'offer', sdp: 'x' } } } });
  assert.ok(V.relay(c, 'u_b', 'u_zed', {}).error, 'not to someone outside the call');
  assert.ok(V.relay(c, 'u_zed', 'u_a', {}).error, 'not from someone outside the call');
});

test('story time: shared narration mutes every mic until it has finished on every device', () => {
  V.join(c, 'u_a', 's_a');
  V.join(c, 'u_b', 's_b');
  V.onNarration(c, narration('l_1'));
  assert.deepEqual(V.hushState(c), { on: true, waiting: ['u_a', 'u_b'] });
  assert.equal(lastState('s_b').hush.on, true, 'everyone is told');
  V.readDone(c, 'u_a', 'l_1');
  assert.deepEqual(V.hushState(c), { on: true, waiting: ['u_b'] }, 'still waiting for the slower device');
  V.readDone(c, 'u_b', 'l_1');
  assert.equal(V.hushState(c).on, false);
  assert.equal(lastState('s_a').hush.on, false, 'mics come back on');
});

test('two narrations in a row keep story time on until both are done everywhere', () => {
  V.join(c, 'u_a', 's_a');
  V.join(c, 'u_b', 's_b');
  V.onNarration(c, narration('l_1'));
  V.onNarration(c, narration('l_2'));
  for (const u of ['u_a', 'u_b']) V.readDone(c, u, 'l_1');
  assert.equal(V.hushState(c).on, true);
  for (const u of ['u_a', 'u_b']) V.readDone(c, u, 'l_2');
  assert.equal(V.hushState(c).on, false);
});

test('private narration, other log entries and an empty call never start story time', () => {
  V.onNarration(c, narration('l_0'));
  assert.equal(V.hushState(c).on, false, 'nobody in the call');
  V.join(c, 'u_a', 's_a');
  V.onNarration(c, narration('l_1', 'Only you notice.', ['u_a']));
  V.onNarration(c, { id: 'l_2', kind: 'dice', to: 'all' });
  assert.equal(V.hushState(c).on, false);
});

test('someone leaving (or dropping off) mid-story is not waited for', () => {
  V.join(c, 'u_a', 's_a');
  V.join(c, 'u_b', 's_b');
  V.onNarration(c, narration('l_1'));
  V.readDone(c, 'u_a', 'l_1');
  V.leave(c, 'u_b', 's_b');
  assert.equal(V.hushState(c).on, false);
  assert.ok(sent.some((m) => m.sid === 's_a' && m.event === 'voice:left' && m.payload.userId === 'u_b'));
  // an old socket closing doesn't throw out the same player's newer connection
  V.join(c, 'u_a', 's_a2');
  V.leave(c, 'u_a', 's_a');
  assert.deepEqual(V.roster(c).map((m) => m.userId), ['u_a']);
});

test('while anyone in the call is still listening to the read-aloud voice, every mic stays muted', () => {
  V.join(c, 'u_a', 's_a');
  V.join(c, 'u_b', 's_b');
  V.onNarration(c, narration('l_1'));
  V.setSpeaking(c, 'u_a', true);
  V.setSpeaking(c, 'u_b', true);
  V.readDone(c, 'u_a', 'l_1');
  V.readDone(c, 'u_b', 'l_1');
  V.setSpeaking(c, 'u_a', false);
  assert.deepEqual(V.hushState(c), { on: true, waiting: ['u_b'] }, 'Bram\'s device is still reading (its queue ran late)');
  V.setSpeaking(c, 'u_b', false);
  assert.equal(V.hushState(c).on, false);
  assert.equal(lastState('s_a').hush.on, false);
  // a replayed line, a private moment or a journal page read on one device mutes everyone too
  V.setSpeaking(c, 'u_a', true);
  assert.deepEqual(lastState('s_b').hush, { on: true, waiting: ['u_a'] });
  V.leave(c, 'u_a', 's_a');
  assert.equal(V.hushState(c).on, false, 'leaving the call never holds the others');
});

test('a "reading aloud" claim lapses if the device goes quiet without saying so', () => {
  V.join(c, 'u_a', 's_a');
  const real = globalThis.setTimeout;
  let fire = null;
  globalThis.setTimeout = (fn) => { fire = fn; return 0; };
  try { V.setSpeaking(c, 'u_a', true); } finally { globalThis.setTimeout = real; }
  assert.equal(V.hushState(c).on, true);
  assert.equal(V.hushState(c, Date.now() + V.SPEAKING_CLAIM_MS + 1).on, false, 'after a minute without news it no longer counts');
  fire();
  assert.equal(lastState('s_a').hush.on, false, 'and everyone is told');
});

test('a device that never reports back cannot hold the table forever', async () => {
  assert.ok(V.readingAllowanceMs(narration('x', 'a'.repeat(400))) >= 40000, 'long enough to read 400 characters slowly');
  assert.ok(V.readingAllowanceMs(narration('x', 'a'.repeat(100000))) <= 240000, 'never more than four minutes');
  V.join(c, 'u_a', 's_a');
  const real = globalThis.setTimeout;
  let fire = null;
  globalThis.setTimeout = (fn) => { fire = fn; return 0; };
  try { V.onNarration(c, narration('l_1')); } finally { globalThis.setTimeout = real; }
  assert.equal(V.hushState(c).on, true);
  fire();
  assert.equal(V.hushState(c).on, false);
});

test('relays for strict networks come from Cloudflare when the server has a TURN key, otherwise free STUN', async () => {
  const stun = await V.iceServers({});
  assert.match(JSON.stringify(stun), /stun:/);
  let asked = null;
  const fake = async (url, init) => { asked = { url, init }; return { ok: true, json: async () => ({ iceServers: [{ urls: ['turn:turn.cloudflare.com:3478'], username: 'u', credential: 'p' }] }) }; };
  const turn = await V.iceServers({ turnKeyId: 'key1', turnKeyToken: 'tok' }, fake);
  assert.match(asked.url, /rtc\.live\.cloudflare\.com\/v1\/turn\/keys\/key1\/credentials\/generate-ice-servers/);
  assert.equal(asked.init.headers.Authorization, 'Bearer tok');
  assert.equal(turn[0].username, 'u');
  const broken = await V.iceServers({ turnKeyId: 'k', turnKeyToken: 't' }, async () => ({ ok: false, status: 500 }));
  assert.match(JSON.stringify(broken), /stun:/, 'falls back to STUN');
});

// ---- the browser side: read-aloud tells story time when each narration is done, and can't be cut short
const spoken = [];
globalThis.window = {
  speechSynthesis: {
    getVoices: () => [], addEventListener() {}, cancel() {},
    speak(u) { spoken.push(u); },
  },
};
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const T = await import('../client/src/lib/tts.js');
const finish = () => { const u = spoken.shift(); u?.onend?.(); };

test('read-aloud reports each narration as done when its last sentence ends', () => {
  const done = [];
  const off = T.onEntryDone((id) => done.push(id));
  T.stopSpeaking({ force: true });
  spoken.length = 0;
  done.length = 0;
  assert.equal(T.speakEntry(narration('l_a', 'One sentence. ' + 'Another, much longer sentence that keeps going on and on. '.repeat(6))), true);
  assert.ok(spoken.length === 1);
  finish();
  assert.deepEqual(done, [], 'not done while sentences remain');
  while (spoken.length) finish();
  assert.deepEqual(done, ['l_a']);
  assert.equal(T.speakEntry(narration('l_b', '*a wet growl*')), false, 'stage directions are not read');
  assert.equal(T.speakEntry(narration('l_c'), {}, { readAloud: false }), false);
  off();
});

test('during story time the table\'s narration cannot be stopped unless forced (or skipping is allowed)', () => {
  const done = [];
  const off = T.onEntryDone((id) => done.push(id));
  T.stopSpeaking({ force: true });
  spoken.length = 0;
  let locked = true;
  T.setSkipLock(() => locked);
  T.speakEntry(narration('l_x'));
  assert.equal(T.storyLocked(), true);
  assert.equal(T.stopSpeaking(), false, 'the stop button does nothing');
  assert.equal(spoken.length, 1, 'still reading');
  locked = false; // the host allows skipping
  assert.equal(T.stopSpeaking(), true);
  assert.deepEqual(done, ['l_x'], 'cut short counts as done for story time');
  // private narration is never locked (it isn't part of story time)
  locked = true;
  T.speakEntry(narration('l_p', 'Only you notice.', ['u_me']));
  assert.equal(T.storyLocked(), false);
  assert.equal(T.stopSpeaking(), true);
  T.setSkipLock(null);
  off();
});

test('voice typing: nothing new is read aloud and the other players are silent here until you stop', async () => {
  const { beginQuiet, endQuiet, isQuiet } = await import('../client/src/lib/quiet.js');
  const { useVoice } = await import('../client/src/lib/voice.js');
  T.stopSpeaking({ force: true });
  spoken.length = 0;
  beginQuiet();
  beginQuiet(); // the chat box and the action box can overlap
  assert.equal(isQuiet(), true);
  assert.equal(useVoice.getState().ducked, true, "the others' voices are muted on this device");
  T.speakEntry(narration('l_q', 'The door creaks open.'));
  assert.equal(spoken.length, 0, 'held while you speak');
  endQuiet();
  assert.equal(spoken.length, 0, 'still one box listening');
  endQuiet();
  assert.equal(isQuiet(), false);
  assert.equal(useVoice.getState().ducked, false);
  assert.equal(spoken.length, 1, 'the narration carries on afterwards');
  assert.equal(spoken[0].text, 'The door creaks open.');
  T.stopSpeaking({ force: true });
});
