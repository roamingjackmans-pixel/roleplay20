// While you use voice typing, everything else this device plays goes quiet, so the mic only hears you: the read-aloud
// voice (nothing new starts reading; it carries on afterwards), the other players in the voice chat, and the sound
// effects. Two voice-typing boxes can overlap; it all comes back when the last one stops.
import { holdSpeech } from './tts.js';
import { duckCall } from './voice.js';
import { setSoundsDucked } from './sound.js';

let depth = 0;

export function beginQuiet() {
  if (depth++ === 0) { holdSpeech(true); duckCall(true); setSoundsDucked(true); }
}

export function endQuiet() {
  if (depth === 0) return;
  if (--depth === 0) { holdSpeech(false); duckCall(false); setSoundsDucked(false); }
}

export function isQuiet() { return depth > 0; }
