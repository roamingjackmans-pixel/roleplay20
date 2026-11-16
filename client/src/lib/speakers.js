// The name and colour shown for a line of dialogue in the story. NPCs come from the campaign's voice list; a player
// character's line ("pc:<id>", or a raw character id in older logs) shows that character's name. An internal id is
// never shown: an unknown one becomes a tidy name, or "Someone".

/** { name, color, voice } for a narration part's speaker. `view` is the table view (voices and party). */
export function speakerLabel(part, view) {
  const id = String(part?.speaker || '');
  const v = view?.voices?.[id];
  if (v?.name) return { name: v.name, color: v.color || null, voice: v.voice || null };
  const party = view?.party || [];
  const raw = id.replace(/^pc:/, '');
  const pc = party.find((x) => x.id === raw) || party.find((x) => x.id === part?.speakerName);
  if (pc) return { name: pc.name, color: part?.color || pc.color || null, voice: null, pc: true };
  return { name: tidyName(part?.speakerName || (id.startsWith('creature:') ? '' : id)), color: part?.color || null, voice: null };
}

/** "npc_old_marta" -> "Old Marta"; "ch_j3x2h2ai" (a random id) -> "Someone"; "Oswin Pell" stays "Oswin Pell". */
export function tidyName(s) {
  const t = String(s || '').trim();
  const m = /^(npc|ch|pc|cb|tok|char|character)[_:-](.+)$/i.exec(t);
  if (!m) return t || 'Someone';
  if (/\d/.test(m[2])) return 'Someone';
  return m[2].replace(/[_-]+/g, ' ').replace(/\b\w/g, (x) => x.toUpperCase());
}
