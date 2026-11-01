// Text-to-speech for the narrator and every NPC, using the browser's built-in voices (free, no API).
// Each NPC has a stored voice profile (gender, age, accent, pitch, rate); the same profile always maps to the
// same browser voice on a given device, so an old innkeeper keeps her voice all campaign long.
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [];
let queue = [];
let speaking = false;
let currentUtter = null;
const listeners = new Set();

const FEMALE = /\b(aria|jenny|sonia|libby|natasha|emily|neerja|leah|zira|hazel|susan|catherine|linda|heera|samantha|karen|moira|tessa|fiona|victoria|serena|kate|female|ava|allison|michelle|clara|emma|maisie|hollie|elizabeth|sara|ana|nancy|amber|ashley|cora|monica|jane|joanna|kimberly|salli|ivy|olivia|amy|nicole|aditi|raveena|veena|isla|bella|abbi|alice|ellie|ruby|sophie|mia|luna|michelle|nova|shimmer)\b/i;
const MALE = /\b(guy|ryan|william|connor|prabhat|luke|david|mark|george|ravi|daniel|alex|fred|arthur|rishi|thomas|oliver|male|christopher|eric|roger|steffan|andrew|brian|davis|tony|jason|ken|mitchell|ethan|james|liam|noah|elliot|alfie|hamish|duncan|brandon|jacob|kevin|matthew|joey|justin|russell|geraint|aaron|reed|ralph|albert|bruce|junior|gordon|lee|rocko|grandpa)\b/i;
const ACCENT_LANG = { american: ['en-US'], british: ['en-GB'], scottish: ['en-GB-SCOTLAND', 'en-GB'], irish: ['en-IE', 'en-GB'], australian: ['en-AU', 'en-NZ'], indian: ['en-IN'], southafrican: ['en-ZA'], any: [] };

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function load() {
  if (!synth) return;
  voices = synth.getVoices().filter((v) => /^en/i.test(v.lang));
}
if (synth) {
  load();
  synth.addEventListener?.('voiceschanged', load);
}

export function availableVoices() { if (!voices.length) load(); return voices; }
export const ttsSupported = () => !!synth;

function gender(v) {
  if (FEMALE.test(v.name)) return 'female';
  if (MALE.test(v.name)) return 'male';
  return 'unknown';
}

function quality(v) {
  let q = 0;
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) q += 3;
  if (/google/i.test(v.name)) q += 1;
  if (v.localService === false) q += 1;
  return q;
}

export function pickVoice(profile = {}, key = '', avoid = null) {
  const list = availableVoices();
  if (!list.length) return null;
  const want = profile.gender || 'neutral';
  const langs = ACCENT_LANG[profile.accent] || [];
  const scored = list.map((v) => {
    let s = quality(v);
    const g = gender(v);
    if (want === 'female' || want === 'male') s += g === want ? 6 : g === 'unknown' ? 1 : -6;
    if (langs.length) {
      const idx = langs.findIndex((l) => v.lang.toUpperCase().startsWith(l.toUpperCase()) || (l.includes('SCOTLAND') && /scot|fiona/i.test(v.name)));
      s += idx === 0 ? 4 : idx > 0 ? 2 : 0;
    } else if (/en-US|en-GB/i.test(v.lang)) s += 1;
    if (avoid && v.voiceURI === avoid) s -= 3;
    return { v, s };
  });
  const best = Math.max(...scored.map((x) => x.s));
  const top = scored.filter((x) => x.s >= best - 1).map((x) => x.v);
  return top[hash(key || JSON.stringify(profile)) % top.length] || list[0];
}

const AGE = { child: { p: 1.45, r: 1.08 }, young: { p: 1.12, r: 1.04 }, adult: { p: 1, r: 1 }, old: { p: 0.86, r: 0.9 }, ancient: { p: 0.74, r: 0.82 } };

function narratorProfile(prefs) {
  return { gender: prefs?.narratorGender || 'male', accent: prefs?.narratorAccent || 'british', age: 'adult', pitch: 0.92, rate: 0.96 };
}

function clean(text) {
  return String(text || '').replace(/\*+/g, '').replace(/_+/g, '').replace(/\s+/g, ' ').trim();
}

function play() {
  if (!synth || speaking) return;
  const next = queue.shift();
  if (!next) { emit(); return; }
  speaking = true;
  const u = new SpeechSynthesisUtterance(next.text);
  if (next.voice) u.voice = next.voice;
  u.lang = next.voice?.lang || 'en-US';
  u.pitch = Math.max(0.1, Math.min(2, next.pitch));
  u.rate = Math.max(0.5, Math.min(2, next.rate));
  u.volume = next.volume ?? 1;
  u.onend = u.onerror = () => { speaking = false; currentUtter = null; play(); };
  currentUtter = { ...next, utter: u };
  emit();
  synth.speak(u);
}

function emit() { for (const l of listeners) l(currentUtter); }
export function onSpeaking(fn) { listeners.add(fn); return () => listeners.delete(fn); }

export function stopSpeaking() {
  queue = [];
  speaking = false;
  currentUtter = null;
  if (synth) synth.cancel();
  emit();
}

function enqueue(text, profile, key, prefs, extra = {}) {
  const t = clean(text);
  if (!t) return;
  const age = AGE[profile.age] || AGE.adult;
  const narr = pickVoice(narratorProfile(prefs), 'narrator');
  const voice = key === 'narrator' && prefs?.narratorVoice
    ? availableVoices().find((v) => v.voiceURI === prefs.narratorVoice) || narr
    : key === 'narrator' ? narr : pickVoice(profile, key, narr?.voiceURI);
  const rate = (profile.rate || 1) * age.r * (prefs?.rate || 1);
  const pitch = (profile.pitch || 1) * (key === 'narrator' ? 1 : age.p);
  // long text: split on sentences so the browser doesn't cut it off
  const chunks = t.match(/[^.!?…]+[.!?…]*["”’)]*\s*/g) || [t];
  let buf = '';
  for (const c of chunks) {
    if ((buf + c).length > 220 && buf) { queue.push({ text: buf.trim(), voice, rate, pitch, key, ...extra }); buf = ''; }
    buf += c;
  }
  if (buf.trim()) queue.push({ text: buf.trim(), voice, rate, pitch, key, ...extra });
}

const CREATURE = { gender: 'male', age: 'old', accent: 'any', pitch: 0.55, rate: 0.85 };

/** Read a narration log entry aloud: narrator parts in the narrator's voice, dialogue in each NPC's voice. */
export function speakEntry(entry, npcVoices = {}, prefs = {}) {
  if (!synth || prefs.readAloud === false) return;
  for (const p of entry.parts || []) {
    if (/^\s*\*[^*]+\*\s*$/.test(p.text || '')) continue; // stage directions like *a wet growl* are shown, not read
    if (p.speaker === 'narrator') {
      if (prefs.readMode === 'dialogue') continue;
      enqueue(p.text, narratorProfile(prefs), 'narrator', prefs, { entryId: entry.id });
    } else if (String(p.speaker).startsWith('creature:')) {
      enqueue(p.text, CREATURE, p.speaker, prefs, { entryId: entry.id });
    } else {
      const v = npcVoices[p.speaker]?.voice || { gender: 'neutral', age: 'adult', accent: 'any' };
      enqueue(p.text, v, p.speaker, prefs, { entryId: entry.id });
    }
  }
  play();
}

/** Preview a voice profile ("Hear voice" buttons in the NPC panel). */
export function previewVoice(profile, key, sample, prefs = {}) {
  stopSpeaking();
  enqueue(sample || 'Well met, traveller. What brings you to these parts?', profile, key, prefs);
  play();
}

export function voiceLabel(profile, key, prefs = {}) {
  const v = key === 'narrator' ? pickVoice(narratorProfile(prefs), 'narrator') : pickVoice(profile, key, pickVoice(narratorProfile(prefs), 'narrator')?.voiceURI);
  return v ? v.name.replace(/Microsoft |Google | Online \(Natural\)|\s*-\s*English.*$/g, '') : 'browser default';
}
