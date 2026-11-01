// What a player may change on their own sheet.

/**
 * From the sheet a player can only spend HP, spell slots, Inspiration and limited uses, never get them back.
 * Getting them back takes a rest, a spell or the DM (all server-side), so nobody adds an extra cast or a quiet heal by accident.
 */
export function consumableError(ch, patch) {
  const no = 'Your sheet can only spend HP, spell slots, Inspiration and limited uses. Getting them back takes a long rest, a spell or the DM.';
  if (patch.hp) {
    const cur = ch.hp || { max: 0, current: 0, temp: 0 };
    if (Number(patch.hp.current ?? cur.current) > cur.current) return no;
    if (Number(patch.hp.temp ?? cur.temp ?? 0) > (cur.temp || 0)) return no;
    if (Number(patch.hp.max ?? cur.max) !== cur.max) return 'Maximum hit points change only when you level up.';
  }
  if (patch.inspiration === true && !ch.inspiration) return 'Only the DM can give you Inspiration.';
  if (patch.spellcasting) {
    const old = ch.spellcasting?.slotsUsed || [];
    const su = patch.spellcasting.slotsUsed;
    if (Array.isArray(su) && su.some((n, i) => (Number(n) || 0) < (old[i] || 0))) return no;
    if (patch.spellcasting.pactUsed !== undefined && Number(patch.spellcasting.pactUsed) < (ch.spellcasting?.pactUsed || 0)) return no;
  }
  if (patch.resources && typeof patch.resources === 'object') {
    for (const [k, v] of Object.entries(patch.resources)) {
      if (v && (Number(v.used) || 0) < (ch.resources?.[k]?.used || 0)) return no;
    }
  }
  return null;
}
