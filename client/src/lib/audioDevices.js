// Which speaker plays the game's sound and which microphone the voice chat (and voice typing) uses, per browser.
//
// The choice is remembered on this device (localStorage), by the device's id and its name, so it is found again even
// when a browser hands out new ids. A chosen device that isn't plugged in is skipped (the computer's default is used)
// until it comes back, and then it is used again by itself.
//
// What can be routed: the voice chat (each player's voice is an <audio> element) and the sound effects (Web Audio).
// What can't: the read-aloud voices. They come from the browser's speechSynthesis, which always plays on the
// computer's default output and offers no way to send it anywhere else (or to capture it).
import { create } from 'zustand';
import { pickDevice, deviceLabel } from '../../../shared/audioPick.js';

const KEY = 'rp20.audioDevices';
const media = typeof navigator !== 'undefined' ? navigator.mediaDevices : null;

/** Can this browser send audio to a chosen speaker? (Chrome, Edge, Firefox: yes; Safari: no.) */
export const outputPickSupported = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;
/** Can it list microphones at all? */
export const inputPickSupported = !!media?.enumerateDevices && !!media?.getUserMedia;

function loadSaved() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}

export const useAudioDevices = create(() => ({
  saved: loadSaved(),   // { mic: { id, label }, speaker: { id, label } } what the player picked ('' / missing = default)
  inputs: [],           // [{ id, label }] microphones (no "default"/"communications" aliases)
  outputs: [],          // [{ id, label }] speakers and headphones
  named: false,         // the browser shows device names (only once the mic has been allowed)
  micId: '',            // the mic in use right now ('' = the computer's default)
  speakerId: '',        // the speaker in use right now ('' = the computer's default)
  micMissing: false,    // the chosen mic isn't plugged in (using the default meanwhile)
  speakerMissing: false,
}));
const get = () => useAudioDevices.getState();
const set = (p) => useAudioDevices.setState(p);

const micListeners = new Set();
const speakerListeners = new Set();
/** Called with the new mic id ('' = default) whenever the mic in use changes (a new pick, plugged in or out). */
export function onMicChange(fn) { micListeners.add(fn); return () => micListeners.delete(fn); }
/** Called with the new speaker id whenever the speaker in use changes. */
export function onSpeakerChange(fn) { speakerListeners.add(fn); return () => speakerListeners.delete(fn); }

function resolve() {
  const { saved, inputs, outputs } = get();
  const mic = pickDevice(saved.mic, inputs);
  const speaker = outputPickSupported ? pickDevice(saved.speaker, outputs) : { id: '', missing: false };
  const prev = { mic: get().micId, speaker: get().speakerId };
  set({ micId: mic.id, micMissing: mic.missing, speakerId: speaker.id, speakerMissing: speaker.missing });
  if (prev.mic !== mic.id) for (const f of micListeners) { try { f(mic.id); } catch (e) { console.warn('[audio] mic', e); } }
  if (prev.speaker !== speaker.id) for (const f of speakerListeners) { try { f(speaker.id); } catch (e) { console.warn('[audio] speaker', e); } }
}

/** Read the device lists again (on start, when something is plugged in or out, after the mic is allowed). */
export async function refreshDevices() {
  if (!media?.enumerateDevices) return;
  let list = [];
  try { list = await media.enumerateDevices(); } catch { return; }
  // "default" and "communications" are Chrome's aliases for the computer's choice: that is our "Default" entry
  const real = (kind) => list.filter((d) => d.kind === kind && d.deviceId && d.deviceId !== 'default' && d.deviceId !== 'communications')
    .map((d, i) => ({ id: d.deviceId, label: deviceLabel(d.label, kind, i) }));
  set({ inputs: real('audioinput'), outputs: real('audiooutput'), named: list.some((d) => d.label) });
  resolve();
}

/** Ask for the microphone once, so the browser shows device names. Returns false if it was blocked. */
export async function allowDeviceNames() {
  if (!media?.getUserMedia) return false;
  try {
    const s = await media.getUserMedia({ audio: true });
    for (const t of s.getTracks()) t.stop();
    await refreshDevices();
    return true;
  } catch { return false; }
}

function save(saved) {
  set({ saved });
  try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch { /* private window: just for now */ }
  resolve();
}

/** Pick a microphone by id ('' = the computer's default). */
export function chooseMic(id) {
  const d = get().inputs.find((x) => x.id === id);
  save({ ...get().saved, mic: d ? { id: d.id, label: d.label } : null });
}

/** Pick a speaker by id ('' = the computer's default). */
export function chooseSpeaker(id) {
  const d = get().outputs.find((x) => x.id === id);
  save({ ...get().saved, speaker: d ? { id: d.id, label: d.label } : null });
}

/** getUserMedia audio constraints for the chosen mic (plus the given processing options). */
export function micConstraints(extra = {}) {
  const id = get().micId;
  return id ? { ...extra, deviceId: { exact: id } } : { ...extra };
}

/**
 * Get the chosen microphone. If it can't be opened (unplugged a moment ago, or busy), fall back to the computer's
 * default rather than failing.
 */
export async function openMic(extra = {}) {
  try {
    return await media.getUserMedia({ audio: micConstraints(extra) });
  } catch (e) {
    if (!get().micId || e?.name === 'NotAllowedError') throw e;
    return media.getUserMedia({ audio: { ...extra } });
  }
}

/** Send an <audio> element to the chosen speaker. Safe to call on any browser. */
export async function routeElement(el, id = get().speakerId) {
  if (!el || !outputPickSupported) return;
  try { if (el.sinkId !== id) await el.setSinkId(id); } catch (e) { console.warn('[audio] setSinkId', e); }
}

/**
 * Send a Web Audio context to the chosen speaker. Chrome and Edge can do it directly (AudioContext.setSinkId); other
 * browsers that can route <audio> elements get it through one (returns the node to play into instead of the
 * context's own destination).
 */
export function routeContext(ctx) {
  if (!ctx) return null;
  const id = get().speakerId;
  if (typeof ctx.setSinkId === 'function') {
    if ((ctx.sinkId || '') !== id) ctx.setSinkId(id).catch((e) => console.warn('[audio] context sink', e));
    return ctx.destination;
  }
  if (!outputPickSupported || !id) return ctx.destination;
  // through an <audio> element (Firefox)
  if (!ctx.__rp20Out) {
    const dest = ctx.createMediaStreamDestination();
    const el = new Audio();
    el.autoplay = true;
    el.srcObject = dest.stream;
    ctx.__rp20Out = { dest, el };
    el.play().catch(() => {});
  }
  routeElement(ctx.__rp20Out.el, id);
  return ctx.__rp20Out.dest;
}

if (media?.addEventListener) {
  media.addEventListener('devicechange', () => { refreshDevices(); });
  refreshDevices();
}
