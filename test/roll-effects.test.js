// Natural 20s and natural 1s: which rolls set off the celebration or the sad trombone, that a following roll
// never cuts the moment short, and that the sounds are made in the browser and respect the sound setting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { natEffect, showsOverlay, queueDice, dequeueDice, feedFlourish, overlayMs, CONFETTI } from '../client/src/lib/rollFx.js';

const pcRoll = (natural, extra = {}) => ({ id: `l_${natural}_${Math.random()}`, kind: 'dice', characterId: 'ch_ana', name: 'Ana', label: 'Perception', result: { total: natural + 3, natural, isCrit: natural === 20, isFumble: natural === 1 }, ...extra });
const withKey = (e) => ({ ...e, key: e.id });

test('a party member\'s natural 20 and natural 1 on a d20 get the effects', () => {
  assert.equal(natEffect(pcRoll(20)), 'nat20');
  assert.equal(natEffect(pcRoll(1)), 'nat1');
  assert.equal(natEffect(pcRoll(19)), null);
  assert.equal(natEffect(pcRoll(2)), null);
});

test('monsters, damage dice and other log entries never do', () => {
  assert.equal(natEffect({ kind: 'dice', name: 'Goblin', result: { total: 24, natural: 20, isCrit: true } }), null, 'a goblin\'s crit is no party');
  assert.equal(natEffect({ kind: 'dice', characterId: 'ch_ana', result: { total: 14, natural: null, isCrit: true } }), null, 'crit damage dice have no natural');
  assert.equal(natEffect({ kind: 'dice', characterId: 'ch_ana', result: { total: 1, natural: null } }), null, 'a 1 on a d4 is not a natural 1');
  assert.equal(natEffect({ kind: 'narration', characterId: 'ch_ana', result: { natural: 20 } }), null);
  assert.equal(natEffect(null), null);
});

test('everyone sees the big die for anyone\'s natural 20 or 1; ordinary rolls only for the roller', () => {
  assert.equal(showsOverlay(pcRoll(20), 'ch_bo'), true);
  assert.equal(showsOverlay(pcRoll(1), 'ch_bo'), true);
  assert.equal(showsOverlay(pcRoll(12), 'ch_bo'), false);
  assert.equal(showsOverlay(pcRoll(12), 'ch_ana'), true);
  assert.equal(showsOverlay({ kind: 'chat', text: 'hi' }, 'ch_ana'), false);
});

test('the damage roll right after a natural 20 waits until the celebration is over', () => {
  const t = 1_000_000;
  const crit = withKey(pcRoll(20, { label: 'Longsword vs Goblin' }));
  const dmg = withKey({ id: 'l_dmg', kind: 'dice', characterId: 'ch_ana', label: 'Longsword damage', result: { total: 13, natural: null } });
  let s = queueDice({ dice: null, diceQueue: [] }, crit, t);
  assert.equal(s.dice.key, crit.key);
  s = queueDice(s, dmg, t + 200);
  assert.equal(s.dice.key, crit.key, 'the natural 20 keeps the screen');
  assert.deepEqual(s.diceQueue.map((d) => d.key), [dmg.key]);
  s = dequeueDice(s, 'some-other-roll', t + 300);
  assert.equal(s.dice.key, crit.key, 'only the roll that is showing can finish');
  s = dequeueDice(s, crit.key, t + overlayMs(crit));
  assert.equal(s.dice.key, dmg.key, 'then the damage roll shows');
  assert.equal(s.diceQueue.length, 0);
  s = dequeueDice(s, dmg.key, t + 6000);
  assert.equal(s.dice, null);
});

test('an ordinary roll is replaced by the next one, and a natural 1 takes over at once', () => {
  const t = 2_000_000;
  const a = withKey(pcRoll(9));
  const b = withKey(pcRoll(11));
  const fumble = withKey(pcRoll(1));
  let s = queueDice({ dice: null, diceQueue: [] }, a, t);
  s = queueDice(s, b, t + 100);
  assert.equal(s.dice.key, b.key);
  s = queueDice(s, fumble, t + 200);
  assert.equal(s.dice.key, fumble.key);
});

test('a die left on screen far too long never blocks the next roll, and the queue stays short', () => {
  const t = 3_000_000;
  const crit = withKey(pcRoll(20));
  let s = queueDice({ dice: null, diceQueue: [] }, crit, t);
  for (let i = 0; i < 6; i++) s = queueDice(s, withKey(pcRoll(5 + i)), t + 100 + i);
  assert.equal(s.diceQueue.length, 3, 'at most three rolls wait');
  const late = withKey(pcRoll(14));
  s = queueDice(s, late, t + 60_000);
  assert.equal(s.dice.key, late.key);
});

test('the feed flourish plays only for rolls that just arrived, not history', () => {
  const now = 5_000_000;
  assert.equal(feedFlourish({ ...pcRoll(20), recvAt: now - 500 }, now), 'nat20');
  assert.equal(feedFlourish({ ...pcRoll(1), recvAt: now - 500 }, now), 'nat1');
  assert.equal(feedFlourish(pcRoll(20), now), null, 'loaded with the log on joining');
  assert.equal(feedFlourish({ ...pcRoll(20), recvAt: now - 60_000 }, now), null);
});

test('the effects never hold the screen for long', () => {
  assert.ok(overlayMs(pcRoll(20)) <= 3500);
  assert.ok(overlayMs(pcRoll(1)) <= 3500);
  assert.equal(CONFETTI.length, 42);
  assert.ok(CONFETTI.every((p) => p.y <= 0), 'confetti flies up and away from the result under the die');
});

// --- the sounds: a stand-in for the browser's Web Audio that records what was played
class Param {
  constructor() { this.value = 0; this.events = []; }
  setValueAtTime(v, t) { this.events.push(['set', v, t]); return this; }
  linearRampToValueAtTime(v, t) { this.events.push(['lin', v, t]); return this; }
  exponentialRampToValueAtTime(v, t) { assert.ok(v > 0, 'exponential ramps must stay above zero'); this.events.push(['exp', v, t]); return this; }
}
const played = [];
class Node {
  constructor(kind) { this.kind = kind; this.frequency = new Param(); this.gain = new Param(); this.Q = new Param(); }
  connect(n) { return n; }
  start(t) { played.push({ kind: this.kind, type: this.type, start: t, freq: this.frequency.events[0]?.[1] }); }
  stop(t) { played[played.length - 1].stop = t; }
}
class FakeAudioContext {
  constructor() { this.currentTime = 10; this.sampleRate = 8000; this.state = 'running'; this.destination = {}; }
  resume() { this.state = 'running'; return Promise.resolve(); }
  createOscillator() { return new Node('osc'); }
  createGain() { return new Node('gain'); }
  createBiquadFilter() { return new Node('filter'); }
  createBufferSource() { return new Node('noise'); }
  createBuffer(ch, len) { const d = new Float32Array(len); return { getChannelData: () => d }; }
}
globalThis.window = { AudioContext: FakeAudioContext, addEventListener() {}, removeEventListener() {} };
const { sounds, setSoundsEnabled } = await import('../client/src/lib/sound.js');

test('the natural 20 fanfare is synthesized, bright and short', () => {
  setSoundsEnabled(true);
  played.length = 0;
  sounds.nat20();
  assert.ok(played.length > 10, 'brass notes, a swell and sparkles');
  const end = Math.max(...played.map((p) => p.stop ?? p.start + 1));
  assert.ok(end - 10 < 2.2, `over within about two seconds (${(end - 10).toFixed(2)} s)`);
  assert.ok(played.some((p) => p.freq >= 1500), 'has high sparkles');
});

test('the natural 1 sad trombone falls in pitch', () => {
  setSoundsEnabled(true);
  played.length = 0;
  sounds.nat1();
  const notes = played.filter((p) => p.kind === 'osc' && p.type === 'sawtooth' && p.freq > 100);
  const firstOfEach = [...new Map(notes.map((n) => [n.start, n.freq])).values()];
  assert.ok(firstOfEach.length >= 4, 'four "wah"s');
  for (let i = 1; i < firstOfEach.length; i++) assert.ok(firstOfEach[i] < firstOfEach[i - 1], 'each lower than the last');
  const end = Math.max(...played.map((p) => p.stop ?? p.start));
  assert.ok(end - 10 < 2.6);
});

test('with sound effects switched off, nothing plays (the animation still shows)', () => {
  setSoundsEnabled(false);
  played.length = 0;
  sounds.nat20();
  sounds.nat1();
  assert.equal(played.length, 0);
  setSoundsEnabled(true);
});

test('while you use voice typing, sound effects stay quiet so the mic only hears you', async () => {
  const { setSoundsDucked } = await import('../client/src/lib/sound.js');
  setSoundsDucked(true);
  played.length = 0;
  sounds.nat20();
  sounds.dice();
  assert.equal(played.length, 0);
  setSoundsDucked(false);
  sounds.nat20();
  assert.ok(played.length > 0, 'back afterwards');
});
