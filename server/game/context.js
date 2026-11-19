// Builds the text the Dungeon Master sees: a cached campaign block (world, secrets, arc) and a per-turn prompt
// (party, NPCs, scene, recent history, this turn's input).
import { deriveCharacter, xpForLevel } from '../../shared/rules.js';
import { describeMapForAI } from './mapgen.js';
import { srd } from '../srd.js';
import { getUser } from '../auth.js';
import { partyCharacters, characterOwner, getCharacter } from './campaign.js';
import { searchMemory, memoryOf, tokens } from './memory.js';
import { paceOf } from '../../shared/pace.js';

const clip = (s, n) => {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

export function safeDerive(ch) {
  try { return deriveCharacter(ch, srd()); } catch (e) { return null; }
}

/** The session the current story (backbone) began in: 1, or the one after the last story was played to its end. */
export function storyStartSession(c) {
  return (c.world.pastBackbones?.at(-1)?.endedSession || 0) + 1;
}

/**
 * How fast the host wants the story to move, and where this session stands against it. The same story takes about 20
 * sessions at a slow burn and about 5 when fast; the DM paces scenes, conversations and exposition to match.
 */
export function storyPaceBlock(c) {
  const p = paceOf(c.settings);
  const head = `# STORY PACE: ${p.label}${c.settings.shape === 'one-shot' ? ' (a one-shot: the whole story fits in one session)' : ` (about ${p.sessions} sessions for the whole story)`}\n${p.dm}`;
  if (c.settings.shape === 'one-shot' || !c.sessionNumber) return head;
  const k = c.sessionNumber - storyStartSession(c) + 1;
  const where = k > p.sessions
    ? `This is session ${k} of the story, past the ${p.sessions} or so this pace allows: steer firmly toward the ending.`
    : `This is session ${k} of about ${p.sessions} for this story. Check the story arc's current act against that: if the party is behind, tighten (quicker answers, fewer side moments, cut to the next beat); if ahead, let scenes breathe a little more.`;
  return `${head}\n${where}`;
}

export function cachedCampaignContext(c) {
  const s = c.settings;
  return [
    `# CAMPAIGN: ${c.name}${c.world.title ? ` - "${c.world.title}"` : ''}`,
    `Tone: ${[].concat(s.tone || []).join(', ')} | Magic: ${s.magicLevel} | Lethality: ${s.lethality} | Shape: ${s.shape} | Focus: ${s.pacing}`,
    s.inspiration ? `Inspiration (borrow tone/structure only): ${s.inspiration}` : '',
    `Lines (never include): ${s.lines || 'none stated'}`,
    `Veils (fade to black): ${s.veils || 'none stated'}`,
    s.namingStyle ? `NAMING STYLE for new names: ${s.namingStyle}` : '',
    '',
    storyPaceBlock(c),
    '',
    '# WORLD BIBLE (player-facing)',
    c.world.bible || '(not written yet)',
    '',
    ...(c.world.backbone ? ['# BACKBONE (for you only; fixed for the whole campaign: the villain, the plan, the central truth, the acts and the ending stay as written, only which part the players are seeing moves)', c.world.backbone, ''] : []),
    '# DM SECRETS (for you only - never reveal except through earned in-play reveals)',
    c.world.secrets || '(none yet)',
    '',
    '# STORY ARC (for you only)',
    c.world.arc || '(none yet)',
    '',
    c.world.characterPrompts?.length ? `# CHARACTER PROMPTS\n${c.world.characterPrompts.map((p) => `- ${p}`).join('\n')}` : '',
  ].filter((x) => x !== '').join('\n');
}

function slotsLeft(ch, d) {
  const sc = d?.spellcasting;
  if (!sc) return '';
  const used = ch.spellcasting?.slotsUsed || [];
  const parts = [];
  (sc.slots || []).forEach((max, i) => { if (max) parts.push(`L${i + 1} ${Math.max(0, max - (used[i] || 0))}/${max}`); });
  if (sc.pact?.slots) parts.push(`pact L${sc.pact.level} ${Math.max(0, sc.pact.slots - (ch.spellcasting?.pactUsed || 0))}/${sc.pact.slots}`);
  return parts.join(', ');
}

function usesLeft(ch, d) {
  return (d?.resources || []).filter((r) => r.max != null).map((r) => `${r.key} ${Math.max(0, r.max - (ch.resources?.[r.key]?.used || 0))}/${r.max}`).join(', ');
}

function coins(ch) {
  const cur = ch.currency || {};
  return ['pp', 'gp', 'ep', 'sp', 'cp'].filter((k) => cur[k]).map((k) => `${cur[k]} ${k}`).join(' ') || 'no coins';
}

/**
 * How many actions a character has taken since they last rolled (a check the DM asked for, or a roll in a fight), so the
 * DM can pace the dice: about one roll per player every 3-5 actions, and only when it matters.
 */
export function actionsSinceRoll(c, ch) {
  const turns = c.chronicle?.turns || [];
  let n = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if ((t.rolls || []).some((r) => String(r).includes(`(${ch.id})`) || String(r).startsWith(`${ch.name} `))) return n;
    if ((t.actions || []).some((a) => a.characterId === ch.id || (!a.characterId && a.name === ch.name))) n++;
  }
  return turns.length ? null : 0; // null: no roll in all the turns kept
}

function rollPace(c, ch) {
  const n = actionsSinceRoll(c, ch);
  return n === null ? 'none in a long while' : String(n);
}

export function partyBlock(c, online) {
  const lines = [];
  for (const ch of partyCharacters(c)) {
    const d = safeDerive(ch);
    const owner = characterOwner(c, ch.id);
    const u = getUser(owner);
    const away = online.has(owner) ? null : c.members.find((x) => x.userId === owner)?.away;
    const present = online.has(owner) ? 'PRESENT' : away?.mode === 'npc' ? 'PLAYER AWAY - YOU PLAY THEM' : away?.mode === 'out' ? `SITTING THIS SESSION OUT (${away.reason}) - not in the scene` : 'ABSENT';
    const tok = Object.values(c.tokens || {}).find((t) => t.characterId === ch.id);
    const skills = d ? Object.entries(ch.skillProfs || {}).map(([k]) => `${k} ${d.skills[k] >= 0 ? '+' : ''}${d.skills[k]}`).join(', ') : '';
    const spells = ch.spellcasting ? [...(ch.spellcasting.cantrips || []), ...(ch.spellcasting.prepared?.length ? ch.spellcasting.prepared : ch.spellcasting.known || [])].join(', ') : '';
    const items = (ch.equipment || []).filter((i) => i.equipped || /potion|scroll|key|map|letter|wand|ring|amulet|rope|torch|kit/i.test(i.name)).map((i) => `${i.name}${i.qty > 1 ? ` x${i.qty}` : ''}`).join(', ');
    lines.push([
      `- id ${ch.id} | ${ch.name} (player: ${u?.displayName || '?'}) [${present}] - ${ch.race}${ch.subrace ? ` (${ch.subrace})` : ''} ${(ch.classes || [{ class: ch.class, level: ch.level }]).map((k) => `${k.class}${k.subclass ? `/${k.subclass}` : ''} ${k.level}`).join(' / ')}, ${ch.background || ''}`,
      ch.dead ? '  DEAD - this character has died; their player must retire them and make a new one. Narrate nothing for them.' : '',
      `  Level ${ch.level}, XP ${ch.xp || 0}${ch.level < 20 ? ` (next level at ${xpForLevel(ch.level + 1)})` : ''}${ch.pendingLevelUp ? ' - LEVEL-UP WAITING' : ''} | Inspiration: ${ch.inspiration ? 'yes' : 'no'} | Hit Dice ${(ch.hitDice?.total || 0) - (ch.hitDice?.used || 0)}/${ch.hitDice?.total || 0} d${ch.hitDice?.die || 8} | coins: ${coins(ch)}`,
      usesLeft(ch, d) ? `  Limited uses left: ${usesLeft(ch, d)}` : '',
      `  HP ${ch.hp.current}/${ch.hp.max}${ch.hp.temp ? ` (+${ch.hp.temp} temp)` : ''} | AC ${d?.ac ?? '?'} | speed ${d?.speed ?? ch.speed} ft | darkvision ${ch.darkvision || 0} ft | passive Perception ${d?.passive?.perception ?? '?'}, Insight ${d?.passive?.insight ?? '?'}, Investigation ${d?.passive?.investigation ?? '?'}`,
      `  Conditions: ${[...(ch.conditions || []), ch.exhaustion ? `exhaustion ${ch.exhaustion}` : ''].filter(Boolean).join(', ') || 'none'}${ch.concentration ? ` | concentrating on ${ch.concentration}` : ''}${tok ? ` | token at ${tok.x},${tok.y}` : ''}`,
      `  Actions since their last roll: ${rollPace(c, ch)}`,
      skills ? `  Proficient skills: ${skills}` : '',
      `  Languages: ${(ch.otherProfs?.languages || []).join(', ') || 'Common'}`,
      spells ? `  Spells: ${spells}${slotsLeft(ch, d) ? ` | slots left: ${slotsLeft(ch, d)}` : ''}` : '',
      items ? `  Notable gear: ${clip(items, 300)}` : '',
      `  Personality: ${clip([ch.personality?.traits, ch.personality?.bonds && `Bond: ${ch.personality.bonds}`, ch.personality?.flaws && `Flaw: ${ch.personality.flaws}`].filter(Boolean).join(' | '), 360)}`,
      ch.backstory ? `  Backstory: ${clip(ch.backstory, 420)}` : '',
    ].filter(Boolean).join('\n'));
  }
  const former = c.members.flatMap((m) => (m.pastCharacters || []).map((id) => ({ ch: getCharacter(id), uid: m.userId }))).filter((x) => x.ch?.retired);
  if (former.length) lines.push(`Former party members (lore only, not player characters any more): ${former.map(({ ch, uid }) => `${ch.name} (${ch.race} ${ch.class} ${ch.level}, ${ch.retired.reason === 'died' ? 'died' : 'retired, still alive'}${ch.retired.day ? ` on day ${ch.retired.day}` : ''}; was played by ${getUser(uid)?.displayName || '?'})`).join('; ')}`);
  const building = c.members.filter((m) => m.rebuilding && !m.characterId).map((m) => getUser(m.userId)?.displayName).filter(Boolean);
  if (building.length) lines.push(`Making a new character right now (not in the scene yet): ${building.join(', ')}`);
  return lines.join('\n') || '(no characters yet)';
}

const npcLine = (n) => `- ${n.id}: ${n.name} - ${n.role || ''}; ${clip(n.description, 140)} | voice: ${n.voice?.gender || ''} ${n.voice?.age || ''} ${n.voice?.accent || ''}, "${clip(n.voice?.style, 80)}" | attitude ${n.attitude || 'unknown'} | at ${n.location || '?'} | ${n.status || 'alive'}${n.notes ? ` | notes: ${clip(n.notes, 160)}` : ''}${n.ally ? ' | ACTIVE ALLY' : ''}`;

/** Full NPC entries: the ones in play (focus), or the latest 60 when no focus is given. */
export function npcBlock(c, focus = null) {
  const npcs = Object.values(c.npcs || {});
  if (!npcs.length) return '(none yet)';
  const list = focus ? npcs.filter((n) => focus.has(n.id)) : npcs.slice(-60);
  return list.map(npcLine).join('\n') || '(nobody in particular right now)';
}

/** Everyone else, one short entry each (most recently seen first): who exists, so names are never reused. */
export function npcIndex(c, skip = new Set(), cap = 200) {
  const rest = Object.values(c.npcs || {}).filter((n) => !skip.has(n.id))
    .sort((a, b) => (b.lastSeenSession || 0) - (a.lastSeenSession || 0) || (b.lastSeenRound || 0) - (a.lastSeenRound || 0) || (b.firstSeen || 0) - (a.firstSeen || 0));
  const shown = rest.slice(0, cap).map((n) => `${n.name} [${n.id}]${n.role ? ` ${clip(n.role, 40)}` : ''}${n.status && n.status !== 'alive' ? ` (${n.status})` : ''}${n.lastSeenSession ? ` s${n.lastSeenSession}` : ''}`);
  const more = rest.length - shown.length;
  return shown.join('; ') + (more > 0 ? `; ...and ${more} more from long ago (their details come up in RECALLED when they matter)` : '');
}

const NAME_TITLES = new Set(['grandmother', 'grandfather', 'mother', 'father', 'brother', 'sister', 'captain', 'young', 'grey', 'gray', 'lady', 'lord', 'sir', 'master', 'mistress', 'elder', 'soldier', 'guard', 'king', 'queen', 'maestro', 'the', 'old', 'high', 'priest', 'priestess', 'clan', 'little', 'big', 'dame', 'goodwife', 'goodman']);

/**
 * The NPCs in play this turn: on the battle map, travelling with the party, speaking lately, or named in this turn or
 * the last few. They get full entries; everyone else gets a line in the index.
 */
export function focusNpcIds(c, text = '', cap = 30) {
  const out = new Set();
  const npcs = Object.values(c.npcs || {});
  for (const t of Object.values(c.tokens || {})) if (t.npcId && !t.dead && c.npcs?.[t.npcId]) out.add(t.npcId);
  for (const n of npcs) if (n.ally) out.add(n.id);
  const turns = (c.chronicle?.turns || []).slice(-8);
  for (const t of turns) for (const seg of t.narration || []) for (const p of seg.parts || []) if (c.npcs?.[p.speaker]) out.add(p.speaker);
  const recent = [text, ...turns.slice(-3).map((t) => t.summary), ...turns.slice(-2).flatMap((t) => (t.actions || []).map((a) => a.text))].join(' ');
  const words = new Set(tokens(recent));
  const lower = recent.toLowerCase();
  for (const n of npcs) {
    if (out.size >= cap) break;
    if (lower.includes(String(n.name).toLowerCase()) || lower.includes(n.id) || tokens(n.name).some((w) => !NAME_TITLES.has(w) && words.has(w))) out.add(n.id);
  }
  return out;
}

/** One line per finished session: the spine of a long campaign. */
export function sessionIndex(c) {
  const done = (c.sessions || []).filter((s) => s.endedAt || s.logEntry);
  return done.map((s) => `S${s.n}: ${clip(s.headline || firstSentence(s.logEntry), 160)}`).join('\n');
}

// a headline for a session that has none: its title ("## Session 1 — The Festival of Small Bells"), or else its first
// real sentence (skipping date lines like "*Played 31 October*" and "**Party present:**")
function firstSentence(md) {
  const src = String(md || '');
  const title = src.match(/^#+\s*Session\s*\d+\s*[—–:-]\s*(.+)$/im);
  if (title) return title[1].trim();
  const t = src.split('\n').filter((l) => !/^\s*#/.test(l) && !/^\s*\*[^*].*\*\s*$/.test(l) && !/^\s*\*\*[^*]+:\*\*/.test(l))
    .join(' ').replace(/[*_>#]/g, '').replace(/\s+/g, ' ').trim();
  return (t.match(/^.{20,220}?[.!?](\s|$)/) || [t.slice(0, 160)])[0].trim();
}

/**
 * Older details from the archive that match this turn (the players' words, where they are, what just happened),
 * leaving out what the prompt already shows.
 */
export function recallBlock(c, input, { focus = new Set(), shownTurns = new Set(), shownNotes = [] } = {}) {
  const last = (c.chronicle?.turns || []).slice(-2);
  // what the players just said matters most; where they are and what just happened help a little
  const query = [{ text: input?.text || '', weight: 1 }, { text: [c.scene?.location, ...last.map((t) => t.summary)].filter(Boolean).join(' '), weight: 0.35 }];
  const exclude = new Set();
  for (const id of focus) exclude.add(`npc:${id}`);
  for (const q of c.quests || []) if (q.status === 'active' || q.status === 'rumor') exclude.add(`quest:${q.id}`);
  const cur = c.maps?.area?.[c.scene?.areaMapId];
  for (const l of cur?.locations || []) exclude.add(`place:${cur.id}:${l.id}`);
  for (const e of memoryOf(c).entries) {
    if (e.kind === 'turn' && shownTurns.has(e.turn)) exclude.add(e.id);
    if (e.kind === 'note' && shownNotes.includes(e.text)) exclude.add(e.id);
  }
  const hits = searchMemory(c, query, { exclude, limit: 10, budget: 7000 });
  const tag = (e) => (['npc', 'place', 'quest'].includes(e.kind) ? e.kind : `${e.kind}${e.session ? `, session ${e.session}` : ''}`);
  return hits.map((e) => `- [${tag(e)}] ${e.title ? `${e.title}: ` : ''}${clip(e.text, 900)}`).join('\n');
}

export function sceneBlock(c) {
  const s = c.scene;
  const out = [`Location: ${s.location || 'unknown'} | Time: ${s.timeOfDay || '?'} | Weather: ${s.weather || '?'} | Mood: ${s.mood || '?'} | Day ${s.day || 1}`];
  for (const m of Object.values(c.maps.area || {})) {
    const owners = Object.entries(c.knowledge || {}).filter(([, k]) => k[m.id]?.owned).map(([uid]) => getUser(uid)?.displayName).filter(Boolean);
    if (m.id !== s.areaMapId) {
      const known = (m.locations || []).filter((l) => Object.values(c.knowledge || {}).some((k) => k[m.id]?.owned || k[m.id]?.discovered?.includes(l.id))).length;
      out.push(`Area map ${m.id} "${m.name}" (${m.style}) - ${(m.locations || []).length} places, ${known} known to the party - owned by: ${owners.join(', ') || 'nobody'} (its places come up in RECALLED when they matter)`);
      continue;
    }
    out.push(`Area map ${m.id} "${m.name}" (${m.style}) - owned by: ${owners.join(', ') || 'nobody yet'}${m.price ? ` | price: ${m.price}` : ''} [CURRENT AREA]`);
    for (const l of m.locations || []) {
      const knownBy = Object.entries(c.knowledge || {}).filter(([, k]) => k[m.id]?.owned || k[m.id]?.discovered?.includes(l.id)).length;
      out.push(`   - ${l.id}: ${l.name} (${l.kind})${l.secret ? ' SECRET' : ''}${knownBy ? '' : ' [undiscovered]'}${l.id === s.areaLocationId ? ' <- PARTY IS HERE' : ''} - ${clip(l.description, 100)}`);
    }
  }
  const tm = s.tacticalMapId && c.maps.tactical[s.tacticalMapId];
  if (tm) {
    const toks = Object.values(c.tokens || {});
    out.push(`Battle map ${tm.id} "${tm.name}" (${tm.theme}, ${tm.w}x${tm.h}, ambient ${tm.ambient}):`);
    try { out.push(describeMapForAI(tm, toks)); } catch (e) { out.push('(map description unavailable)'); }
  }
  return out.join('\n');
}

export function questBlock(c) {
  if (!c.quests?.length) return '(none)';
  const open = c.quests.filter((q) => q.status === 'active' || q.status === 'rumor');
  const closed = c.quests.filter((q) => !open.includes(q));
  const lines = open.map(questLine);
  if (closed.length) lines.push(`Finished or failed (${closed.length}): ${closed.slice(-40).reverse().map((q) => `${q.title} [${q.status}]`).join('; ')}${closed.length > 40 ? '; older ones come up in RECALLED' : ''}`);
  return lines.join('\n') || '(none open)';
}

function questLine(q) {
  return [q].map((q) => `- ${q.id}: ${q.title} [${q.status}] - ${clip(q.summary, 200)}${q.updates?.length ? ` | latest: ${clip(q.updates[q.updates.length - 1], 140)}` : ''}`)[0];
}

function narrationText(entry, nameForUser, nameForSpeaker = (p) => p.speakerName || p.speaker) {
  const who = entry.to === 'all' ? 'ALL' : (entry.to || []).map(nameForUser).join('+');
  return `[to ${who}] ` + (entry.parts || []).map((p) => (p.speaker === 'narrator' ? p.text : `${nameForSpeaker(p)}: "${p.text}"`)).join(' ');
}

/** Writes out one turn in full: what each player did, the rolls, the narration and its summary. */
function turnWriter(c) {
  const nameForUser = (uid) => {
    const m = c.members.find((x) => x.userId === uid);
    return m?.characterId ? (partyCharacters(c).find((ch) => ch.id === m.characterId)?.name || '?') : getUser(uid)?.displayName || '?';
  };
  // a player character's line shows their name (older logs may hold their raw id)
  const pcs = partyCharacters(c);
  const nameForSpeaker = (p) => { const id = String(p.speaker || '').replace(/^pc:/, ''); return pcs.find((x) => x.id === id || x.id === p.speakerName)?.name || p.speakerName || p.speaker; };
  return (t) => [
    `## Turn ${t.n}${t.kind ? ` (${t.kind})` : ''}${t.combatRound ? ` - combat round ${t.combatRound}${t.turnOf ? `, ${t.turnOf}'s turn` : ''}` : ''}`,
    ...(t.actions || []).map((a) => `* ${a.name}${a.private ? ' (PRIVATE)' : ''}: ${clip(a.text, 400)}`),
    ...(t.rolls || []).map((r) => `* roll: ${r}`),
    ...(t.narration || []).map((n) => clip(narrationText(n, nameForUser, nameForSpeaker), 900)),
    t.summary ? `Summary: ${t.summary}` : '',
  ].filter(Boolean).join('\n');
}

export function historyBlock(c) {
  const turns = c.chronicle?.turns || [];
  const older = turns.slice(0, -8).map((t) => t.summary).filter(Boolean);
  const recent = turns.slice(-8).map(turnWriter(c));
  return [
    c.chronicle?.summary ? `# STORY SO FAR\n${c.chronicle.summary}` : '',
    older.length ? `# EARLIER THIS SESSION\n${older.slice(-25).map((s) => `- ${s}`).join('\n')}` : '',
    recent.length ? `# RECENT TURNS (most recent last)\n${recent.join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

// The lists that only ever grow - the turns played and the DM's notes - are shown a page at a time. Everything up to
// the last page boundary stays word for word the same for several turns, so the AI service keeps it cached and bills it
// at a twentieth of the normal price; only the newest few entries (fewer than a page) are new each turn.
export const PAGE = 6;
const FULL_TURNS = 8;     // turns before the boundary shown in full (every turn after it is shown in full too)
const SUMMARY_TURNS = 25; // one-line summaries of the turns before those
const NOTES = 12;         // DM notes before the boundary (every note after it is shown too)
const edgeOf = (count) => Math.floor(count / PAGE) * PAGE;

/** The DM's notes in two parts: the settled page (unchanged for several turns) and the newest few. */
function notePages(c) {
  const all = c.world.dmNotes || [];
  const dropped = c.world.dmNotesDropped || 0; // the oldest notes leave this list (the archive keeps them)
  const cut = Math.max(0, edgeOf(dropped + all.length) - dropped);
  return { settled: all.slice(Math.max(0, cut - NOTES), cut), newest: all.slice(cut) };
}

/**
 * Everything the DM sees for a turn, in parts: first what stays the same from turn to turn (the story so far and the
 * settled turns, then the settled DM notes), which is cached, then what changes every turn. It stays about the same size
 * however long the campaign runs: compact indexes of every session, NPC, quest and place, full details only for what's
 * in play, and the older memories that match.
 * @returns {{ text: string, cache?: boolean }[]}
 */
export function turnPromptParts(c, input, online) {
  const turns = c.chronicle?.turns || [];
  const edge = edgeOf(turns.at(-1)?.n || 0);
  const settledTurns = turns.filter((t) => t.n <= edge);
  const latest = turns.filter((t) => t.n > edge);
  const full = settledTurns.slice(-FULL_TURNS);
  const summarized = settledTurns.slice(0, -FULL_TURNS).slice(-SUMMARY_TURNS);
  const notes = notePages(c);
  const focus = focusNpcIds(c, input?.text || '');
  const shownTurns = new Set([...summarized, ...full, ...latest].map((t) => t.n));
  const recalled = recallBlock(c, input, { focus, shownTurns, shownNotes: [...notes.settled, ...notes.newest] });
  const others = npcIndex(c, focus);
  const spine = sessionIndex(c);
  const write = turnWriter(c);
  const lines = summarized.map((t) => t.summary).filter(Boolean);
  const story = [
    c.chronicle?.summary ? `# STORY SO FAR\n${c.chronicle.summary}` : '',
    spine ? `# SESSION INDEX (one line per session so far)\n${spine}` : '',
    lines.length ? `# EARLIER TURNS (one line each, oldest first)\n${lines.map((s) => `- ${s}`).join('\n')}` : '',
    full.length ? `# RECENT TURNS (oldest first; the newest turns come later, under THE LATEST TURNS)\n${full.map(write).join('\n\n')}` : '',
  ];
  const now = [
    notes.newest.length ? `# YOUR NEWEST DM NOTES (written after the ones above)\n${notes.newest.map((n) => `- ${n}`).join('\n')}` : '',
    `# PARTY (use these ids in "to", rollRequests and effects)\n${partyBlock(c, online)}`,
    `# NPCs IN PLAY (in the scene, travelling with the party, or mentioned lately)\n${npcBlock(c, focus)}`,
    others ? `# EVERYONE ELSE THE PARTY HAS MET (name [id] role, sN = last seen in session N; reuse these ids, never a new one for the same person)\n${others}` : '',
    `# QUESTS\n${questBlock(c)}`,
    `# SCENE\n${sceneBlock(c)}`,
    recalled ? `# RECALLED FROM THE CAMPAIGN ARCHIVE (older details that match this turn: trust them over guesses)\n${recalled}` : '',
    latest.length ? `# THE LATEST TURNS (most recent last${full.length ? '; they carry straight on from RECENT TURNS above' : ''})\n${latest.map(write).join('\n\n')}` : '',
    `# THIS TURN\n${input.text}`,
  ];
  return [
    { text: story.filter(Boolean).join('\n\n'), cache: true },
    { text: notes.settled.length ? `# YOUR DM NOTES (oldest first; every older note is kept in the archive and comes up in RECALLED when it matters)\n${notes.settled.map((n) => `- ${n}`).join('\n')}` : '', cache: true },
    { text: now.filter(Boolean).join('\n\n') },
  ];
}

/** The turn prompt as one text (for tests and the developer's file provider). */
export function turnPrompt(c, input, online) {
  return turnPromptParts(c, input, online).map((p) => p.text).filter(Boolean).join('\n\n');
}

const words = (s) => String(s || '').replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()).trim();

/**
 * Everything the prologue writer sees, and nothing more: the player-facing world bible, title and tagline, the table's
 * tone and lines, where the story begins (the starting town's public places, never its secret ones), the opening hook
 * and the heroes' names. No backbone, DM secrets, story arc, DM notes or NPC notes, so the prologue can't give any away.
 */
export function prologuePrompt(c, heroes = []) {
  const s = c.settings || {};
  const sc = c.scene || {};
  const map = c.maps?.area?.[sc.areaMapId];
  const here = (map?.locations || []).find((l) => l.id === sc.areaLocationId);
  const places = (map?.locations || []).filter((l) => !l.secret).map((l) => `- ${l.name} (${l.kind})${l.description ? `: ${clip(l.description, 160)}` : ''}`);
  const oneShot = s.shape === 'one-shot';
  return [
    `# CAMPAIGN: ${c.world.title || c.name}${c.world.tagline ? ` - ${c.world.tagline}` : ''}`,
    `Tone: ${[].concat(s.tone || []).join(', ') || 'not stated'} | Magic: ${s.magicLevel || 'not stated'}`,
    `Lines (never include): ${s.lines || 'none stated'}`,
    `Veils (fade to black): ${s.veils || 'none stated'}`,
    `# WORLD BIBLE (player-facing)\n${c.world.bible}`,
    [
      '# WHERE THE STORY BEGINS',
      `${sc.location || 'see the world bible'}${here && here.name !== sc.location ? ` (${here.name})` : ''}${sc.timeOfDay ? `, ${sc.timeOfDay}` : ''}${sc.weather ? `, ${sc.weather}` : ''}`,
      map ? `${map.name}${map.description ? `: ${clip(map.description, 400)}` : ''}` : '',
      places.length ? `Places anyone in town knows:\n${places.join('\n')}` : '',
    ].filter(Boolean).join('\n'),
    c.world.openingHook ? `# OPENING HOOK\n${c.world.openingHook}` : '',
    heroes.length ? `# THE HEROES (name them only; the first scene introduces them)\n${heroes.map((h) => `- ${h.name}: ${[words(h.subrace || h.race), words(h.class)].filter(Boolean).join(' ')}${h.background ? `, ${words(h.background).toLowerCase()}` : ''}`).join('\n')}` : '',
    `# LENGTH\n${oneShot ? 'About 300-500 words in 4-6 paragraphs (this is a one-shot: keep it brisk).' : 'About 600-900 words in 5-8 paragraphs (four to six minutes read aloud).'}`,
  ].filter(Boolean).join('\n\n');
}
