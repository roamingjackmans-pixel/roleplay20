// Long-term campaign memory, built for campaigns that run 100+ sessions.
//
// Every turn summary, session log, lasting fact, DM note and handout is archived for good in memory/<campaignId>.json
// (nothing is ever dropped), and everything - the archive plus the live NPCs, places and quests - is searchable with a
// keyword index (BM25 scoring, light stemming, no outside service). Each DM prompt then stays a bounded size: compact
// indexes of everything, full details only for what's in play, and the older memories that match this turn.
import { load, save } from '../store.js';

const file = (cid) => `memory/${cid}.json`;
const MAX_TEXT = 4000;

const STOP = new Set(('the and for are but not you your with this that from they them their there then than have has had was were will would '
  + 'could should about into onto over under after before when what which who whom whose where while been being does did doing its it\'s '
  + 'his her hers him she he our ours out off all any can each few more most other some such only own same too very just also back '
  + 'again once here why how both down upon like than then them these those through during until against between because '
  + 'say says said tell tells told ask asks asked look looks looked turn turns one two three yes no').split(/\s+/));

/** Words worth matching on: lowercase, no punctuation, no stop words, plurals folded ("hushlings" -> "hushling"). */
export function tokens(text) {
  return String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/)
    .map((w) => w.replace(/'s$/, '').replace(/'/g, ''))
    .map((w) => (w.length > 4 && w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.length > 4 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w))
    .filter((w) => w.length > 2 && !STOP.has(w));
}

// ---------------------------------------------------------------- the archive

export function memoryOf(c) {
  const m = load(file(c.id), () => ({ v: 1, seeded: false, entries: [] }));
  if (!m.seeded) seed(c, m);
  return m;
}

function addEntry(c, m, e) {
  const text = String(e.text || '').trim().slice(0, MAX_TEXT);
  if (!text) return null;
  const entry = { id: `m_${m.entries.length + 1}`, at: Date.now(), session: c.sessionNumber || 0, kind: e.kind, title: String(e.title || '').slice(0, 200), text, ...(e.extra || {}) };
  m.entries.push(entry);
  save(file(c.id));
  return entry;
}

/** First load for a campaign that started before the archive existed: archive what it already has. */
function seed(c, m) {
  m.seeded = true;
  for (const s of c.sessions || []) {
    if (s.logEntry) m.entries.push(mk(m, { kind: 'session', session: s.n, title: `Session ${s.n}`, text: s.logEntry, at: s.endedAt || s.startedAt }));
    if (s.partyState) m.entries.push(mk(m, { kind: 'party', session: s.n, title: `Party at the end of session ${s.n}`, text: s.partyState, at: s.endedAt || s.startedAt }));
  }
  for (const t of c.chronicle?.turns || []) {
    if (t.summary) m.entries.push(mk(m, { kind: 'turn', session: sessionAt(c, t.at), title: `Turn ${t.n}`, text: t.summary, at: t.at, turn: t.n }));
  }
  for (const n of c.world?.dmNotes || []) m.entries.push(mk(m, { kind: 'note', session: c.sessionNumber || 0, title: 'DM note', text: n, at: Date.now() }));
  for (const h of c.handouts || []) m.entries.push(mk(m, { kind: 'handout', session: sessionAt(c, h.at), title: h.title, text: `${h.title}: ${h.content}`, at: h.at, handoutId: h.id }));
  save(file(c.id));
}

function mk(m, e) {
  return { id: `m_${m.entries.length + 1}`, at: e.at || Date.now(), session: e.session || 0, kind: e.kind, title: e.title || '', text: String(e.text || '').slice(0, MAX_TEXT), ...(e.turn ? { turn: e.turn } : {}), ...(e.handoutId ? { handoutId: e.handoutId } : {}) };
}

function sessionAt(c, at) {
  let n = 0;
  for (const s of c.sessions || []) if (at >= s.startedAt) n = s.n;
  return n;
}

export function rememberTurn(c, { n, summary, location }) {
  if (!summary) return null;
  return addEntry(c, memoryOf(c), { kind: 'turn', title: `Turn ${n}${location ? ` at ${location}` : ''}`, text: summary, extra: { turn: n } });
}

export function rememberNote(c, text) {
  return addEntry(c, memoryOf(c), { kind: 'note', title: 'DM note', text });
}

export function rememberFact(c, text) {
  return addEntry(c, memoryOf(c), { kind: 'fact', title: 'Remembered', text });
}

export function rememberHandout(c, h) {
  return addEntry(c, memoryOf(c), { kind: 'handout', title: h.title, text: `${h.title}: ${h.content}`, extra: { handoutId: h.id } });
}

export function rememberSession(c, sess, { headline = '' } = {}) {
  const m = memoryOf(c);
  if (headline) sess.headline = String(headline).slice(0, 200);
  if (sess.logEntry) addEntry(c, m, { kind: 'session', title: `Session ${sess.n}${headline ? `: ${headline}` : ''}`, text: sess.logEntry });
  if (sess.partyState) addEntry(c, m, { kind: 'party', title: `Party at the end of session ${sess.n}`, text: sess.partyState });
}

// ---------------------------------------------------------------- search

// the live parts of the campaign are searchable too (they change, so they're read fresh)
function liveEntries(c) {
  const out = [];
  for (const n of Object.values(c.npcs || {})) {
    out.push({ id: `npc:${n.id}`, kind: 'npc', npcId: n.id, title: `${n.name} (${n.role || 'NPC'})`, session: n.lastSeenSession || 0,
      text: [n.name, n.role, n.description, n.location && `at ${n.location}`, n.status, n.attitude, n.notes].filter(Boolean).join('. ') });
  }
  for (const map of Object.values(c.maps?.area || {})) {
    for (const l of map.locations || []) {
      out.push({ id: `place:${map.id}:${l.id}`, kind: 'place', title: `${l.name} (${map.name})`, session: 0,
        text: [l.name, l.kind, `in ${map.name}`, l.description, l.secret ? 'SECRET place' : ''].filter(Boolean).join('. ') });
    }
  }
  for (const q of c.quests || []) {
    out.push({ id: `quest:${q.id}`, kind: 'quest', title: `${q.title} [${q.status}]`, session: 0,
      text: [q.title, q.status, q.summary, q.giver && `given by ${q.giver}`, ...(q.updates || [])].filter(Boolean).join('. ') });
  }
  return out;
}

const indexes = new Map(); // campaignId -> { docs, size }

// the archive only ever grows, so the index just takes in the new entries
function indexFor(c) {
  const m = memoryOf(c);
  let ix = indexes.get(c.id);
  if (!ix || ix.size > m.entries.length) { ix = { docs: [], size: 0 }; indexes.set(c.id, ix); }
  for (let i = ix.size; i < m.entries.length; i++) ix.docs.push({ e: m.entries[i], tf: termFreq(`${m.entries[i].title} ${m.entries[i].text}`) });
  ix.size = m.entries.length;
  return ix;
}

function termFreq(text) {
  const tf = new Map();
  let len = 0;
  for (const t of tokens(text)) { tf.set(t, (tf.get(t) || 0) + 1); len++; }
  return { tf, len };
}

const KIND_WEIGHT = { note: 1.25, fact: 1.25, session: 1.1, handout: 1.05, npc: 1.05, place: 1, quest: 1.05, party: 0.8, turn: 1 };

/**
 * The memories that best match a query: a string, or [{ text, weight }] parts (the players' own words weigh more
 * than background like where they are). opts: { exclude: Set of ids, kinds: [..], limit, budget (characters),
 * sessionNow (for a small recency bonus) }. Returns entries with a "score".
 */
export function searchMemory(c, query, { exclude = new Set(), kinds = null, limit = 10, budget = 7000, sessionNow = c.sessionNumber || 0 } = {}) {
  const weights = new Map();
  for (const part of Array.isArray(query) ? query : [{ text: query, weight: 1 }]) {
    for (const t of tokens(part.text)) weights.set(t, Math.max(weights.get(t) || 0, part.weight ?? 1));
  }
  const q = [...weights.keys()];
  if (!q.length) return [];
  const docs = [...indexFor(c).docs, ...liveEntries(c).map((e) => ({ e, tf: termFreq(`${e.title} ${e.text}`) }))]
    .filter((d) => !exclude.has(d.e.id) && (!kinds || kinds.includes(d.e.kind)));
  if (!docs.length) return [];
  const N = docs.length;
  const avgLen = docs.reduce((s, d) => s + d.tf.len, 0) / N || 1;
  const df = new Map();
  for (const t of q) { let n = 0; for (const d of docs) if (d.tf.tf.has(t)) n++; df.set(t, n); }
  const k1 = 1.4, b = 0.7;
  const scored = [];
  for (const d of docs) {
    let s = 0;
    let hits = 0;
    for (const t of q) {
      const f = d.tf.tf.get(t);
      if (!f) continue;
      const w = weights.get(t);
      hits += w;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (d.tf.len / avgLen))));
    }
    if (!s) continue;
    // matching several different words of the query matters more than one word many times
    s *= (KIND_WEIGHT[d.e.kind] || 1) * (1 + 0.15 * Math.max(0, hits - 1));
    if (sessionNow && d.e.session) s *= 1 + 0.1 * (d.e.session / sessionNow);
    scored.push({ ...d.e, score: s });
  }
  scored.sort((a, b2) => b2.score - a.score);
  const out = [];
  let used = 0;
  const top = scored[0]?.score || 0;
  for (const e of scored) {
    if (out.length >= limit) break;
    if (e.score < top * 0.18) break; // weak matches only add noise
    const cost = e.title.length + Math.min(e.text.length, 900) + 20;
    if (used + cost > budget && out.length) continue;
    out.push(e);
    used += cost;
  }
  return out;
}

/** How many archived memories a campaign has, by kind (for the DM Screen and tests). */
export function memoryStats(c) {
  const out = {};
  for (const e of memoryOf(c).entries) out[e.kind] = (out[e.kind] || 0) + 1;
  return out;
}
