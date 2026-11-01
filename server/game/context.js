// Builds the text the Dungeon Master sees: a cached campaign block (world, secrets, arc) and a per-turn prompt
// (party, NPCs, scene, recent history, this turn's input).
import { deriveCharacter } from '../../shared/rules.js';
import { describeMapForAI } from './mapgen.js';
import { srd } from '../srd.js';
import { getUser } from '../auth.js';
import { partyCharacters, characterOwner } from './campaign.js';

const clip = (s, n) => {
  s = String(s || '').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
};

export function safeDerive(ch) {
  try { return deriveCharacter(ch, srd()); } catch (e) { return null; }
}

export function cachedCampaignContext(c) {
  const s = c.settings;
  return [
    `# CAMPAIGN: ${c.name}${c.world.title ? ` - "${c.world.title}"` : ''}`,
    `Tone: ${[].concat(s.tone || []).join(', ')} | Magic: ${s.magicLevel} | Lethality: ${s.lethality} | Shape: ${s.shape} | Pacing: ${s.pacing}`,
    s.inspiration ? `Inspiration (borrow tone/structure only): ${s.inspiration}` : '',
    `Lines (never include): ${s.lines || 'none stated'}`,
    `Veils (fade to black): ${s.veils || 'none stated'}`,
    '',
    '# WORLD BIBLE (player-facing)',
    c.world.bible || '(not written yet)',
    '',
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

export function partyBlock(c, online) {
  const lines = [];
  for (const ch of partyCharacters(c)) {
    const d = safeDerive(ch);
    const owner = characterOwner(c, ch.id);
    const u = getUser(owner);
    const present = online.has(owner) ? 'PRESENT' : 'ABSENT';
    const tok = Object.values(c.tokens || {}).find((t) => t.characterId === ch.id);
    const skills = d ? Object.entries(ch.skillProfs || {}).map(([k]) => `${k} ${d.skills[k] >= 0 ? '+' : ''}${d.skills[k]}`).join(', ') : '';
    const spells = ch.spellcasting ? [...(ch.spellcasting.cantrips || []), ...(ch.spellcasting.prepared?.length ? ch.spellcasting.prepared : ch.spellcasting.known || [])].join(', ') : '';
    const items = (ch.equipment || []).filter((i) => i.equipped || /potion|scroll|key|map|letter|wand|ring|amulet|rope|torch|kit/i.test(i.name)).map((i) => `${i.name}${i.qty > 1 ? ` x${i.qty}` : ''}`).join(', ');
    lines.push([
      `- id ${ch.id} | ${ch.name} (player: ${u?.displayName || '?'}) [${present}] - ${ch.race}${ch.subrace ? ` (${ch.subrace})` : ''} ${(ch.classes || [{ class: ch.class, level: ch.level }]).map((k) => `${k.class}${k.subclass ? `/${k.subclass}` : ''} ${k.level}`).join(' / ')}, ${ch.background || ''}`,
      `  HP ${ch.hp.current}/${ch.hp.max}${ch.hp.temp ? ` (+${ch.hp.temp} temp)` : ''} | AC ${d?.ac ?? '?'} | speed ${d?.speed ?? ch.speed} ft | darkvision ${ch.darkvision || 0} ft | passive Perception ${d?.passive?.perception ?? '?'}, Insight ${d?.passive?.insight ?? '?'}, Investigation ${d?.passive?.investigation ?? '?'}`,
      `  Conditions: ${[...(ch.conditions || []), ch.exhaustion ? `exhaustion ${ch.exhaustion}` : ''].filter(Boolean).join(', ') || 'none'}${ch.concentration ? ` | concentrating on ${ch.concentration}` : ''}${tok ? ` | token at ${tok.x},${tok.y}` : ''}`,
      skills ? `  Proficient skills: ${skills}` : '',
      `  Languages: ${(ch.otherProfs?.languages || []).join(', ') || 'Common'}`,
      spells ? `  Spells: ${spells}${slotsLeft(ch, d) ? ` | slots left: ${slotsLeft(ch, d)}` : ''}` : '',
      items ? `  Notable gear: ${clip(items, 300)} | gold ${ch.currency?.gp ?? 0} gp` : '',
      `  Personality: ${clip([ch.personality?.traits, ch.personality?.bonds && `Bond: ${ch.personality.bonds}`, ch.personality?.flaws && `Flaw: ${ch.personality.flaws}`].filter(Boolean).join(' | '), 360)}`,
      ch.backstory ? `  Backstory: ${clip(ch.backstory, 420)}` : '',
    ].filter(Boolean).join('\n'));
  }
  return lines.join('\n') || '(no characters yet)';
}

export function npcBlock(c) {
  const npcs = Object.values(c.npcs || {});
  if (!npcs.length) return '(none yet)';
  return npcs.slice(-60).map((n) => `- ${n.id}: ${n.name} - ${n.role || ''}; ${clip(n.description, 140)} | voice: ${n.voice?.gender || ''} ${n.voice?.age || ''} ${n.voice?.accent || ''}, "${clip(n.voice?.style, 80)}" | attitude ${n.attitude || 'unknown'} | at ${n.location || '?'} | ${n.status || 'alive'}${n.notes ? ` | notes: ${clip(n.notes, 160)}` : ''}${n.ally ? ' | ACTIVE ALLY' : ''}`).join('\n');
}

export function sceneBlock(c) {
  const s = c.scene;
  const out = [`Location: ${s.location || 'unknown'} | Time: ${s.timeOfDay || '?'} | Weather: ${s.weather || '?'} | Mood: ${s.mood || '?'} | Day ${s.day || 1}`];
  for (const m of Object.values(c.maps.area || {})) {
    const owners = Object.entries(c.knowledge || {}).filter(([, k]) => k[m.id]?.owned).map(([uid]) => getUser(uid)?.displayName).filter(Boolean);
    out.push(`Area map ${m.id} "${m.name}" (${m.style}) - owned by: ${owners.join(', ') || 'nobody yet'}${m.price ? ` | price: ${m.price}` : ''}${m.id === s.areaMapId ? ' [CURRENT AREA]' : ''}`);
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
  return c.quests.map((q) => `- ${q.id}: ${q.title} [${q.status}] - ${clip(q.summary, 200)}${q.updates?.length ? ` | latest: ${clip(q.updates[q.updates.length - 1], 140)}` : ''}`).join('\n');
}

function narrationText(entry, nameForUser) {
  const who = entry.to === 'all' ? 'ALL' : (entry.to || []).map(nameForUser).join('+');
  return `[to ${who}] ` + (entry.parts || []).map((p) => (p.speaker === 'narrator' ? p.text : `${p.speakerName || p.speaker}: "${p.text}"`)).join(' ');
}

export function historyBlock(c) {
  const nameForUser = (uid) => {
    const m = c.members.find((x) => x.userId === uid);
    return m?.characterId ? (partyCharacters(c).find((ch) => ch.id === m.characterId)?.name || '?') : getUser(uid)?.displayName || '?';
  };
  const turns = c.chronicle?.turns || [];
  const older = turns.slice(0, -8).map((t) => t.summary).filter(Boolean);
  const recent = turns.slice(-8).map((t) => [
    `## Turn ${t.n}${t.kind ? ` (${t.kind})` : ''}`,
    ...(t.actions || []).map((a) => `* ${a.name}${a.private ? ' (PRIVATE)' : ''}: ${clip(a.text, 400)}`),
    ...(t.rolls || []).map((r) => `* roll: ${r}`),
    ...(t.narration || []).map((n) => clip(narrationText(n, nameForUser), 900)),
    t.summary ? `Summary: ${t.summary}` : '',
  ].filter(Boolean).join('\n'));
  return [
    c.chronicle?.summary ? `# STORY SO FAR\n${c.chronicle.summary}` : '',
    older.length ? `# EARLIER THIS SESSION\n${older.slice(-25).map((s) => `- ${s}`).join('\n')}` : '',
    recent.length ? `# RECENT TURNS (most recent last)\n${recent.join('\n\n')}` : '',
  ].filter(Boolean).join('\n\n');
}

export function turnPrompt(c, input, online) {
  const notes = (c.world.dmNotes || []).slice(-20);
  const parts = [
    `# PARTY (use these ids in "to", rollRequests and effects)\n${partyBlock(c, online)}`,
    `# NPC ROSTER\n${npcBlock(c)}`,
    `# QUESTS\n${questBlock(c)}`,
    `# SCENE\n${sceneBlock(c)}`,
    notes.length ? `# YOUR PRIVATE DM NOTES\n${notes.map((n) => `- ${n}`).join('\n')}` : '',
    historyBlock(c),
    `# THIS TURN\n${input.text}`,
  ];
  return parts.filter(Boolean).join('\n\n');
}
