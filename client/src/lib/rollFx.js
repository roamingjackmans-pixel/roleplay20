// Which dice rolls get the big tumbling die, and the natural 20 / natural 1 moments everyone at the table sees.
// Pure functions (no browser needed) so the store, the overlay and the tests share one set of rules.

export const ROLL_MS = 820;                       // the die tumbles this long before it lands
export const OVERLAY_MS = { plain: 2600, nat20: 3300, nat1: 3300 };

/**
 * 'nat20' or 'nat1' when a party member's d20 shows a natural 20 or 1, else null. Monsters' rolls never have a
 * characterId, so a goblin's crit doesn't set off the party's celebration. Damage dice have no natural.
 */
export function natEffect(entry) {
  if (!entry || entry.kind !== 'dice' || !entry.characterId) return null;
  const n = entry.result?.natural;
  return n === 20 ? 'nat20' : n === 1 ? 'nat1' : null;
}

/** The big die shows your own rolls on your screen, and everyone's crits, natural 20s and natural 1s. */
export function showsOverlay(entry, myCharacterId) {
  if (!entry || entry.kind !== 'dice') return false;
  const r = entry.result || {};
  return (!!entry.characterId && entry.characterId === myCharacterId) || !!r.isCrit || r.natural === 20 || r.natural === 1;
}

export function overlayMs(entry) {
  return OVERLAY_MS[natEffect(entry) || 'plain'];
}

/**
 * The overlay state after a roll arrives. An ordinary roll replaces an ordinary one (the newest roll matters),
 * but a natural 20 or 1 is never cut short: rolls that land during it (the damage roll right after a crit) wait
 * their turn. A die left showing far too long (its screen was closed) never blocks the next roll.
 */
export function queueDice(state, entry, now = Date.now()) {
  const shown = { ...entry, shownAt: now };
  const cur = state.dice;
  const queue = state.diceQueue || [];
  const stale = cur && now - (cur.shownAt || 0) > overlayMs(cur) + 1500;
  if (!cur || stale) return { dice: shown, diceQueue: stale ? queue : [] };
  if (natEffect(cur)) return { dice: cur, diceQueue: [...queue, entry].slice(-3) };
  return { dice: shown, diceQueue: queue };
}

/** The overlay for `key` has finished: show the next waiting roll, if any. */
export function dequeueDice(state, key, now = Date.now()) {
  if (!state.dice || state.dice.key !== key) return { dice: state.dice, diceQueue: state.diceQueue || [] };
  const [next, ...rest] = state.diceQueue || [];
  return { dice: next ? { ...next, shownAt: now } : null, diceQueue: rest };
}

/**
 * A feed entry for a natural 20 or 1 that just arrived gets a short flourish. `recvAt` is stamped by this
 * device when the roll comes in live, so history loaded on joining stays still (and server clock skew can't matter).
 */
export function feedFlourish(entry, now = Date.now()) {
  const fx = natEffect(entry);
  return fx && entry.recvAt && now - entry.recvAt < 10000 ? fx : null;
}

// fixed "random" confetti so the burst looks the same on every screen and every render
function seeded(seed) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
}
const CONFETTI_COLORS = ['#ffd56b', '#f6b73c', '#fff3c4', '#7fd1ff', '#ff7fb0', '#9df29d', '#c59bff'];
export const CONFETTI = (() => {
  const r = seeded(20);
  return Array.from({ length: 42 }, (_, i) => {
    // mostly up and out, so the pieces fly away from the result shown under the die
    const angle = (-180 + r() * 180) * (Math.PI / 180);
    const dist = 110 + r() * 190;
    return {
      x: Math.round(Math.cos(angle) * dist * 1.25),
      y: Math.round(Math.sin(angle) * dist),
      rot: Math.round(180 + r() * 540) * (r() < 0.5 ? -1 : 1),
      w: 7 + Math.round(r() * 7),
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.round(r() * 160),
      round: r() < 0.25,
    };
  });
})();
