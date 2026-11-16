// Natural 1s on attack rolls: a fumble. On top of the miss, something a little bad and a little funny happens to the
// attacker, hero or monster alike. Every mishap is small (at most 1 damage, never below 1 HP) so it stings and gets a
// laugh without being cruel. combat.js applies the rule; this file only picks the mishap and words it.

const WEAPON = [
  { key: 'prone', rule: '{n} is prone until they get up on their next turn.', lines: [
    '{n} swings with everything they have, hits nothing but air, and the follow-through spins them straight onto the floor.',
    '{n} lunges, plants a foot on something slick, and goes down in a heap.',
    "{n} charges in, catches a toe, and makes a very loud, very undignified introduction to the ground.",
  ] },
  { key: 'open', rule: 'The next attack against {n} has advantage.', lines: [
    "{n}'s wild miss leaves them wide open. {t} can't believe their luck.",
    '{n} overcommits so badly they end up facing the wrong way.',
    "{n}'s {w} sails past {t} by a mile, and the momentum leaves them flailing.",
  ] },
  { key: 'nick', rule: '{n} takes 1 damage, and a lot of pride.', lines: [
    '{n} fumbles the backswing and smacks themselves with their own {w}.',
    "{n}'s {w} glances off {t}'s gear and rebounds right into {n}.",
  ] },
  { key: 'drop', rule: 'Picking it back up costs {n} half their movement next turn.', lines: [
    "{n}'s {w} slips out of sweaty fingers and skitters across the floor.",
    "{n}'s grip fails; the {w} goes flying and lands with an embarrassing clang.",
  ] },
  { key: 'stuck', rule: '{n} loses the rest of their movement this turn.', lines: [
    "{n}'s {w} bites deep into the floor and sticks fast. A long, awkward tug follows.",
    '{n} trips over their own feet, windmills both arms, and only just stays upright.',
  ] },
];

const SPELL = [
  { key: 'prone', rule: '{n} is prone until they get up on their next turn.', lines: [
    "The recoil from {n}'s botched {w} knocks them flat on their back.",
  ] },
  { key: 'open', rule: 'The next attack against {n} has advantage.', lines: [
    "{n}'s {w} goes wide and scorches the ceiling. Everyone, {t} included, looks up. {n} is left wide open.",
    "{n} mangles the words of {w} and stands there blinking while it sputters out.",
  ] },
  { key: 'nick', rule: '{n} takes 1 damage, and a lot of pride.', lines: [
    "{n}'s {w} fizzles and backfires with a sad little pop, right in their face.",
  ] },
];

/**
 * Pick a mishap. `canStick` is false when losing the rest of this turn's movement means nothing (a monster has already
 * moved before it attacks). Returns { key, rule, text } with the names filled in.
 */
export function pickMishap({ name, target = 'the enemy', weapon = 'weapon', spell = false, canStick = true, rng = Math.random } = {}) {
  const table = (spell ? SPELL : WEAPON).filter((m) => canStick || m.key !== 'stuck');
  const m = table[Math.floor(rng() * table.length) % table.length];
  const line = m.lines[Math.floor(rng() * m.lines.length) % m.lines.length];
  const w = spell ? weapon : String(weapon).toLowerCase();
  const fill = (s) => { const out = s.replaceAll('{n}', name).replaceAll('{t}', target).replaceAll('{w}', w); return out.charAt(0).toUpperCase() + out.slice(1); };
  return { key: m.key, rule: fill(m.rule), text: fill(line) };
}

/** What the table reads for the 1-HP case of a nick: no damage, only pride. */
export const NO_DAMAGE_NICK = 'Luckily it was the flat of the blade: no damage, only pride.';

export const MISHAP_KEYS = [...new Set([...WEAPON, ...SPELL].map((m) => m.key))];
