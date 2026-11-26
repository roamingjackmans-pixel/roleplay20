// The DM sometimes starts a turn by telling again how its last narration ended, nearly word for word. The players have
// just read that, so before a narration is posted, a narrator sentence that says almost exactly what one the same
// readers already saw said (in the last few narrations, or earlier in this one) is left out. Short sentences ("The door
// shudders again.") are never touched: a new event can be told in the same few words. Nothing is ever emptied: if every
// sentence would go, the narration stays as it was.

const STOP = new Set(('the a an and or but nor of to in on at by for with from into onto over under as is are was were be been being ' +
  'it its this that these those there here their they them then than so such his her hers him he she you your yours we our ours us ' +
  'me my mine not no do does did has have had just still again also very too up down out off all any each every some more most ' +
  'other one two now who whom which what when where while how why can could would should will shall may might must like through ' +
  'around about across against along among before after behind beside between beyond during within without upon toward towards').split(' '));

/** "returns" and "return", "tugging" and "tugs", "waking" and "wake": close enough to spot the same sentence twice. */
function stem(w) {
  let s = w;
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  else if (s.length > 4 && /(ss|x|z|ch|sh)es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s !== w && /([b-df-hj-np-tv-z])\1$/.test(s)) s = s.slice(0, -1); // tugg -> tug, stirr -> stir
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1); // wake -> wak, like waking
  return s;
}

/** The words that carry a sentence's meaning, each once. */
export function contentWords(s) {
  const words = String(s || '').toLowerCase().replace(/[’‘]/g, "'").match(/[\p{L}\p{N}']+/gu) || [];
  return [...new Set(words.map((w) => w.replace(/'s$/, '').replace(/'/g, '')).filter((w) => w.length > 2 && !STOP.has(w)).map(stem))];
}

/** A text cut into sentences, each with the spacing after it, so joining the kept ones reads naturally. */
export function sentences(text) {
  return (String(text || '').match(/[^.!?…]*(?:[.!?…]+["'”’)\]]*\s*|$)/g) || []).filter((s) => s.length);
}

const MIN_WORDS = 6; // a sentence with fewer meaning words is always kept
const SHARE = 0.75;  // ...and one is a repeat when at least this much of it was in a single earlier sentence (or two in a row)

function isRepeat(words, pool) {
  if (words.length < MIN_WORDS) return false;
  for (const seen of pool) {
    let n = 0;
    for (const w of words) if (seen.has(w)) n++;
    if (n >= MIN_WORDS - 1 && n / words.length >= SHARE) return true;
  }
  return false;
}

/** Everyone who reads `newTo` also read `oldTo` ('all' or a list of user ids). */
function sawIt(oldTo, newTo) {
  if (oldTo === 'all') return true;
  if (newTo === 'all') return false;
  return newTo.every((u) => oldTo.includes(u));
}

/** Word sets for each sentence of the parts, and for each two sentences in a row (a repeat can merge two into one). */
function wordSets(parts) {
  const all = parts.flatMap((p) => sentences(p.text).map(contentWords)).filter((w) => w.length);
  const out = all.map((w) => new Set(w));
  for (let i = 0; i + 1 < all.length; i++) out.push(new Set([...all[i], ...all[i + 1]]));
  return out;
}

const isNarrator = (p) => !p.speaker || p.speaker === 'narrator';

/**
 * Leaves out the narrator sentences that repeat what the same readers already read.
 * @param segments this narration: [{ to: 'all' | [userIds], parts: [{ speaker, text }] }]
 * @param earlier the narration posted before it, oldest first, in the same shape
 * @returns {{ segments: object[], dropped: number }}
 */
export function dropRepeats(segments, earlier = []) {
  const seen = earlier.map((e) => ({ to: e.to, sets: wordSets(e.parts || []) }));
  let dropped = 0;
  const out = [];
  for (const seg of segments) {
    const pool = seen.filter((e) => sawIt(e.to, seg.to)).flatMap((e) => e.sets);
    const mine = { to: seg.to, sets: [] };
    seen.push(mine);
    const parts = [];
    for (const p of seg.parts) {
      if (!isNarrator(p)) { parts.push(p); continue; }
      const kept = [];
      for (const s of sentences(p.text)) {
        const words = contentWords(s);
        if (isRepeat(words, [...pool, ...mine.sets])) { dropped++; continue; }
        kept.push(s);
        if (words.length) mine.sets.push(new Set(words));
      }
      const text = kept.join('').trim();
      if (text) parts.push({ ...p, text });
    }
    if (parts.length) out.push({ ...seg, parts });
  }
  if (!dropped) return { segments, dropped: 0 };
  // never leave the table with nothing new to read
  if (!out.some((s) => s.parts.some(isNarrator))) return { segments, dropped: 0 };
  return { segments: out, dropped };
}

/** The narration the table read lately (this session's last dozen narration entries), oldest first. */
export function recentNarration(c, limit = 12) {
  const out = [];
  const log = c.log || [];
  for (let i = log.length - 1; i >= 0 && out.length < limit; i--) {
    const e = log[i];
    if (e.kind === 'session') break;
    if (e.kind === 'narration' && e.parts?.length) out.unshift({ to: e.to || 'all', parts: e.parts });
  }
  return out;
}
