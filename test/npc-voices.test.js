// NPC dialogue used to sound robotic next to the narrator: most NPCs were pitch-shifted far from their voice's natural
// pitch (0.48-1.68), and in Chrome some got the old Windows desktop voices. Now NPCs differ by voice, pitch and speed
// stay close to natural, and a robotic voice is only used when the device has nothing better.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const v = (name, lang, local = true) => ({ name, lang, voiceURI: name, localService: local });
const CHROME_WINDOWS = [
  v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Mark - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US'),
  v('Google US English', 'en-US', false), v('Google UK English Female', 'en-GB', false), v('Google UK English Male', 'en-GB', false),
];
const EDGE_WINDOWS = [
  v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US'),
  ...[['Aria', 'en-US'], ['Guy', 'en-US'], ['Ryan', 'en-GB'], ['Sonia', 'en-GB'], ['Connor', 'en-IE'], ['Emily', 'en-IE']].map(([n, l]) => v(`Microsoft ${n} Online (Natural) - English`, l, false)),
];
const MAC = [v('Fred', 'en-US'), v('Albert', 'en-US'), v('Zarvox', 'en-US'), v('Grandpa (English (US))', 'en-US'), v('Samantha', 'en-US'), v('Daniel', 'en-GB'), v('Karen', 'en-AU')];
const ONLY_OLD = [v('Microsoft David - English (United States)', 'en-US'), v('Microsoft Zira - English (United States)', 'en-US')];

let list = CHROME_WINDOWS;
const spoken = [];
let voicesChanged = () => {};
globalThis.window = { speechSynthesis: { getVoices: () => list, addEventListener(ev, fn) { if (ev === 'voiceschanged') voicesChanged = fn; }, cancel() {}, speak(u) { spoken.push(u); setTimeout(() => u.onend?.(), 0); } } };
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const T = await import('../client/src/lib/tts.js');
const use = (voices) => { list = voices; voicesChanged(); }; // the browser announces its voice list changed
const tick = () => new Promise((r) => setTimeout(r, 5));

const NPCS = {
  npc_merchant: { gender: 'male', age: 'adult', accent: 'american', pitch: 1, rate: 1 },
  npc_baker: { gender: 'female', age: 'adult', accent: 'american', pitch: 1.1, rate: 1 },
  npc_child: { gender: 'female', age: 'child', accent: 'any', pitch: 1.5, rate: 1.3 },
  npc_sage: { gender: 'male', age: 'ancient', accent: 'irish', pitch: 0.6, rate: 0.7 },
  npc_innkeeper: { gender: 'female', age: 'old', accent: 'british', pitch: 0.95, rate: 0.9 },
};

test('no NPC gets an old robotic voice when the device has a better one', () => {
  for (const [label, voices] of [['Chrome on Windows', CHROME_WINDOWS], ['Edge on Windows', EDGE_WINDOWS], ['a Mac', MAC]]) {
    use(voices);
    for (const [key, p] of Object.entries(NPCS)) {
      const picked = T.pickVoice(p, key, 'narrator');
      assert.ok(!T.soundsRobotic(picked), `${label}: ${key} got ${picked.name}`);
    }
  }
  use(CHROME_WINDOWS);
  assert.equal(T.pickVoice(NPCS.npc_baker, 'npc_baker').name, 'Google US English', "Chrome's US voice is a woman's");
  use(EDGE_WINDOWS);
  assert.match(T.pickVoice(NPCS.npc_sage, 'npc_sage').name, /Connor Online \(Natural\)/, 'an Irish sage gets the Irish natural voice');
  use(ONLY_OLD);
  assert.ok(T.pickVoice(NPCS.npc_merchant, 'npc_merchant'), 'with nothing better, the old voices are still used');
});

test('NPC pitch and speed stay close to natural, however far the profile asks', () => {
  for (const p of Object.values(NPCS)) {
    const s = T.npcProsody(p);
    assert.ok(s.pitch >= 0.86 && s.pitch <= 1.14, `pitch ${s.pitch}`);
    assert.ok(s.rate >= 0.84 && s.rate <= 1.15, `rate ${s.rate}`);
  }
  assert.ok(T.npcProsody(NPCS.npc_child).pitch > T.npcProsody(NPCS.npc_innkeeper).pitch, 'a child still sounds younger than an old innkeeper');
  assert.ok(T.npcProsody(NPCS.npc_sage).rate < T.npcProsody(NPCS.npc_child).rate, 'an ancient sage still speaks slower');
  assert.ok(T.npcProsody({ pitch: 0.55, age: 'old' }, { creature: true }).pitch >= 0.8, 'monsters may go a little deeper, not into a drone');
});

test('what the browser is actually asked to say: dialogue near natural, the narrator unchanged', async () => {
  use(EDGE_WINDOWS);
  T.stopSpeaking({ force: true });
  spoken.length = 0;
  const npcVoices = Object.fromEntries(Object.entries(NPCS).map(([id, voice]) => [id, { voice }]));
  T.speakEntry({ id: 'e1', to: 'all', parts: [{ speaker: 'narrator', text: 'The bell tolls.' }, { speaker: 'npc_child', text: 'Is it ringing for us?' }, { speaker: 'npc_sage', text: 'It rings for everyone, child.' }] }, npcVoices, {});
  for (let i = 0; i < 20 && spoken.length < 3; i++) await tick();
  assert.equal(spoken.length, 3);
  assert.deepEqual([spoken[0].pitch, spoken[0].rate], [0.92, 0.96], 'the narrator keeps its own gentle settings');
  for (const u of spoken.slice(1)) assert.ok(u.pitch >= 0.86 && u.pitch <= 1.14 && u.rate >= 0.84 && u.rate <= 1.15, `${u.text}: pitch ${u.pitch}, rate ${u.rate}`);
  assert.ok(spoken.every((u) => !T.soundsRobotic(u.voice)));
});

test('the Voice settings know when a device has lifelike voices', () => {
  use(EDGE_WINDOWS);
  assert.equal(T.naturalVoiceCount(), 6);
  use(CHROME_WINDOWS);
  assert.equal(T.naturalVoiceCount(), 0, 'Chrome on Windows has none: the settings suggest Edge');
});
