// Small synthesized sound effects (no audio files): dice clatter, page turn, your-turn chime, ping.
// They play on the speaker picked in Settings (routeContext), where the browser allows it.
import { routeContext, onSpeakerChange } from './audioDevices.js';
let ctx = null;
let enabled = true;
try { enabled = JSON.parse(localStorage.getItem('rp20.prefs') || '{}').sounds !== false; } catch { /* default on */ }
export function setSoundsEnabled(v) { enabled = v; }
// silent while you use voice typing, so the mic doesn't hear dice and chimes
let ducked = false;
export function setSoundsDucked(v) { ducked = !!v; }

function ac() {
  if (ducked) return null;
  if (!ctx) {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    ctx = new A();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}
onSpeakerChange(() => { if (ctx) routeContext(ctx); });

function noiseBurst(t0, dur, freq, gain) {
  const c = ac();
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = freq;
  bp.Q.value = 2.5;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(bp).connect(g).connect(routeContext(c));
  src.start(t0);
}

function tone(t0, freq, dur, gain = 0.08, type = 'sine') {
  const c = ac();
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(routeContext(c));
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** A short chime on the chosen speaker, for the Test button in Settings (plays even with sound effects off). */
export function testSpeaker() {
  if (!ac()) return;
  const t = ctx.currentTime;
  tone(t, 523.25, 0.5, 0.09, 'triangle');
  tone(t + 0.12, 659.25, 0.5, 0.09, 'triangle');
  tone(t + 0.24, 783.99, 0.8, 0.09, 'triangle');
}

export const sounds = {
  dice() {
    if (!enabled || !ac()) return;
    const t = ctx.currentTime;
    for (let i = 0; i < 6; i++) noiseBurst(t + i * 0.055 + Math.random() * 0.03, 0.05, 1800 + Math.random() * 2200, 0.35 - i * 0.04);
  },
  page() {
    if (!enabled || !ac()) return;
    noiseBurst(ctx.currentTime, 0.18, 900, 0.06);
  },
  turn() {
    if (!enabled || !ac()) return;
    const t = ctx.currentTime;
    tone(t, 523.25, 0.5, 0.07, 'triangle');
    tone(t + 0.12, 659.25, 0.5, 0.07, 'triangle');
    tone(t + 0.24, 783.99, 0.8, 0.07, 'triangle');
  },
  request() {
    if (!enabled || !ac()) return;
    const t = ctx.currentTime;
    tone(t, 880, 0.25, 0.05);
    tone(t + 0.1, 1174.66, 0.35, 0.05);
  },
  ping() {
    if (!enabled || !ac()) return;
    tone(ctx.currentTime, 1318.5, 0.4, 0.04);
  },
  crit() {
    if (!enabled || !ac()) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(t + i * 0.07, f, 0.9, 0.06, 'triangle'));
  },
  fumble() {
    if (!enabled || !ac()) return;
    const t = ctx.currentTime;
    tone(t, 220, 0.5, 0.08, 'sawtooth');
    tone(t + 0.15, 164.81, 0.7, 0.08, 'sawtooth');
  },
  /** A party member's natural 20: a brass "da-da-da-DAAA!" fanfare, a shimmer, and a shower of sparkles (~1.8 s). */
  nat20() {
    if (!enabled || !ac()) return;
    const t = ctx.currentTime + 0.02;
    [0, 0.11, 0.22].forEach((d) => brass(t + d, 523.25, 0.09, 0.05));
    [523.25, 659.25, 783.99, 1046.5].forEach((f) => brass(t + 0.34, f, 1.05, 0.035));
    swell(t + 0.3, 0.9, 5200, 0.05);
    const sparkle = [1567.98, 1760, 2093, 2349.32, 2637.02, 3135.96, 3520];
    for (let i = 0; i < 12; i++) tone(t + 0.42 + i * 0.075, sparkle[(i * 5) % sparkle.length], 0.35, 0.025, 'triangle');
  },
  /** A party member's natural 1: a muted trombone going "wah, wah, wah, waaaah" (~2.2 s). */
  nat1() {
    if (!enabled || !ac()) return;
    const t = ctx.currentTime + 0.02;
    [293.66, 277.18, 261.63].forEach((f, i) => brass(t + i * 0.36, f, 0.3, 0.07, { wah: true }));
    brass(t + 1.08, 246.94, 1.1, 0.07, { wah: true, vibrato: true, bend: -0.06 });
  },
};

/** A brassy note: buzzy sawtooth through a filter that opens as it's blown (and a plunger "wah" if asked). */
function brass(t0, freq, dur, gain, { wah = false, vibrato = false, bend = 0 } = {}) {
  const c = ac();
  const o1 = c.createOscillator();
  const o2 = c.createOscillator();
  o1.type = o2.type = 'sawtooth';
  o1.frequency.setValueAtTime(freq, t0);
  o2.frequency.setValueAtTime(freq * 1.004, t0);
  if (bend) {
    o1.frequency.linearRampToValueAtTime(freq * (1 + bend), t0 + dur);
    o2.frequency.linearRampToValueAtTime(freq * 1.004 * (1 + bend), t0 + dur);
  }
  let lfo = null;
  if (vibrato) {
    lfo = c.createOscillator();
    const depth = c.createGain();
    lfo.frequency.setValueAtTime(5.5, t0);
    depth.gain.setValueAtTime(0, t0);
    depth.gain.linearRampToValueAtTime(freq * 0.025, t0 + 0.35);
    lfo.connect(depth);
    depth.connect(o1.frequency);
    depth.connect(o2.frequency);
  }
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.Q.setValueAtTime(wah ? 6 : 1.5, t0);
  f.frequency.setValueAtTime(wah ? 350 : 700, t0);
  f.frequency.linearRampToValueAtTime(wah ? 1500 : 3200, t0 + Math.min(0.12, dur * 0.4));
  f.frequency.linearRampToValueAtTime(wah ? 450 : 1800, t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.025);
  g.gain.setValueAtTime(gain, t0 + Math.max(0.03, dur - 0.08));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.12);
  o1.connect(f);
  o2.connect(f);
  f.connect(g).connect(routeContext(c));
  for (const o of [o1, o2, lfo].filter(Boolean)) { o.start(t0); o.stop(t0 + dur + 0.15); }
}

/** A soft rising hiss, like a crowd's breath before the cheer. */
function swell(t0, dur, freq, gain) {
  const c = ac();
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
  const src = c.createBufferSource();
  src.buffer = buf;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.setValueAtTime(freq, t0);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  src.connect(hp).connect(g).connect(routeContext(c));
  src.start(t0);
}

// Browsers keep sound off until the page has been clicked or typed in. Wake the audio on the first touch so
// another player's natural 20 is heard even if you haven't clicked anything since the page loaded.
if (typeof window !== 'undefined' && window.addEventListener) {
  const wake = () => {
    if (!ac()) return;
    window.removeEventListener('pointerdown', wake, true);
    window.removeEventListener('keydown', wake, true);
  };
  window.addEventListener('pointerdown', wake, true);
  window.addEventListener('keydown', wake, true);
}
