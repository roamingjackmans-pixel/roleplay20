// "Who can hear this device?": alone, everything is read aloud; with others around, private and "only you"
// narration stays silent while the shared story is still read.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// a stand-in for the browser's speech engine that records what it was asked to say
const spoken = [];
globalThis.window = {
  speechSynthesis: {
    getVoices: () => [],
    addEventListener() {},
    cancel() {},
    speak(u) { spoken.push(u.text); setTimeout(() => u.onend?.(), 0); },
  },
};
globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
const T = await import('../client/src/lib/tts.js');
const tick = () => new Promise((r) => setTimeout(r, 5));

const shared = { id: 'l1', kind: 'narration', to: 'all', parts: [{ speaker: 'narrator', text: 'The bell hums for everyone.' }] };
const onlyMe = { id: 'l2', kind: 'narration', to: ['u_me'], parts: [{ speaker: 'narrator', text: 'Only you notice the shame on his face.' }] };

test('private and "only you" entries are recognised', () => {
  assert.equal(T.isPrivateEntry(shared), false);
  assert.equal(T.isPrivateEntry(onlyMe), true);
  assert.equal(T.isPrivateEntry({ kind: 'action', to: 'all', private: true }), true);
});

test('with others around, private narration is skipped and the shared story is still read', async () => {
  spoken.length = 0;
  T.speakEntry(onlyMe, {}, { alone: false });
  T.speakEntry(shared, {}, { alone: false });
  await tick();
  assert.deepEqual(spoken, ['The bell hums for everyone.']);
});

test('alone (the default), everything is read', async () => {
  T.stopSpeaking();
  spoken.length = 0;
  T.speakEntry(onlyMe, {}, {});
  await tick();
  T.speakEntry(shared, {}, { alone: true });
  await tick();
  assert.deepEqual(spoken, ['Only you notice the shame on his face.', 'The bell hums for everyone.']);
});
