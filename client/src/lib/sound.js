// Small synthesized sound effects (no audio files): dice clatter, page turn, your-turn chime, ping.
let ctx = null;
let enabled = true;
try { enabled = JSON.parse(localStorage.getItem('rp20.prefs') || '{}').sounds !== false; } catch { /* default on */ }
export function setSoundsEnabled(v) { enabled = v; }

function ac() {
  if (!ctx) {
    const A = window.AudioContext || window.webkitAudioContext;
    if (!A) return null;
    ctx = new A();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

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
  src.connect(bp).connect(g).connect(c.destination);
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
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
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
};
