// What a player may change on their own character sheet.
import { validDiceLook } from '../shared/diceStyles.js';
//
// Hit points, spell slots, limited uses, Inspiration, coins, items, conditions, rests and experience change only
// through the DM (story effects), the rules engine (attacks and spells cast through the app) or the level-up wizard.
// The sheet itself can only: change your picture and your dice (any time), and during a session light or put out a torch, end
// concentration, choose what you wear and wield (not mid-fight) and change prepared spells right after a long rest.

export const DM_ONLY = 'Only the DM changes hit points, spell slots, uses, Inspiration, coins, items and conditions. Say what you do in your action and the DM updates your sheet.';

const ALWAYS = new Set(['portrait', 'color', 'dice']);
const IN_SESSION = new Set(['light', 'concentration', 'equipment', 'spellcasting']);

/**
 * Why this patch isn't allowed, or null.
 * ctx: { sessionError: why game actions are blocked right now (null = a session is running with everyone here),
 *        inCombat, preparedMax }
 */
export function sheetPatchError(ch, patch, { sessionError = null, inCombat = false, preparedMax = null } = {}) {
  if (ch.retired) return `${ch.name} has retired. Their story stays in the journal, but the sheet no longer changes.`;
  const keys = Object.keys(patch || {}).filter((k) => patch[k] !== undefined);
  for (const k of keys) if (!ALWAYS.has(k) && !IN_SESSION.has(k)) return DM_ONLY;
  if (typeof patch.portrait === 'string' && patch.portrait.length > 400000) return 'That picture is too big.';
  if (patch.dice !== undefined && !validDiceLook(patch.dice)) return "That dice look isn't one of the choices.";
  if (!keys.some((k) => IN_SESSION.has(k))) return null;

  if (ch.dead) return `${ch.name} has died. Retire them at the bottom of the sheet to make a new character.`;
  if (sessionError) return `Your sheet only changes during a session. ${sessionError}`;
  if (patch.light !== undefined) {
    const l = patch.light;
    if (l !== null && (typeof l !== 'object' || ![l.bright, l.dim].every((n) => Number.isFinite(Number(n)) && n >= 0 && n <= 60))) return 'That light is not allowed.';
  }
  if (patch.concentration !== undefined && patch.concentration !== null) return 'You start concentrating by casting a spell; here you can only end it.';
  if (patch.equipment !== undefined) {
    if (inCombat) return 'Change what you wear and wield after the fight.';
    const err = equipError(ch.equipment || [], patch.equipment);
    if (err) return err;
  }
  if (patch.spellcasting !== undefined) {
    const sc = patch.spellcasting || {};
    if (Object.keys(sc).some((k) => k !== 'prepared')) return DM_ONLY;
    if (!ch.mayPrepare) return 'You can change your prepared spells right after a long rest.';
    if (!Array.isArray(sc.prepared) || sc.prepared.some((x) => typeof x !== 'string')) return 'Choose the spells to prepare.';
    const always = ch.spellcasting?.alwaysPrepared || [];
    if (preparedMax != null && sc.prepared.filter((x) => !always.includes(x)).length > preparedMax) return `You can prepare at most ${preparedMax} spells.`;
  }
  return null;
}

// Equipping only flips "equipped" on items you already carry; adding, removing or renaming items is the DM's job.
function equipError(cur, next) {
  if (!Array.isArray(next) || next.length !== cur.length) return DM_ONLY;
  const byId = new Map(cur.map((i) => [i.id, i]));
  for (const it of next) {
    const was = it && byId.get(it.id);
    if (!was) return DM_ONLY;
    for (const k of new Set([...Object.keys(was), ...Object.keys(it)])) {
      if (k !== 'equipped' && JSON.stringify(was[k]) !== JSON.stringify(it[k])) return DM_ONLY;
    }
  }
  return null;
}

/** Apply a patch that passed sheetPatchError. */
export function applySheetPatch(ch, patch) {
  for (const k of ['portrait', 'color', 'light', 'concentration']) if (patch[k] !== undefined) ch[k] = patch[k];
  if (patch.dice !== undefined) ch.dice = { color: patch.dice.color, style: patch.dice.style, ink: patch.dice.ink };
  if (Array.isArray(patch.equipment)) {
    const on = new Map(patch.equipment.map((i) => [i.id, !!i.equipped]));
    for (const it of ch.equipment || []) if (on.has(it.id)) it.equipped = on.get(it.id);
  }
  if (Array.isArray(patch.spellcasting?.prepared) && ch.spellcasting) {
    ch.spellcasting.prepared = [...new Set([...(ch.spellcasting.alwaysPrepared || []), ...patch.spellcasting.prepared])];
  }
}
