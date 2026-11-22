// How long a concentration spell lasts, and how much of it is left. Story time passes as combat rounds (6 seconds each),
// story turns out of a fight (about a minute each) and rests; the server keeps the clock in ch.concentrationTime.

/** A concentration spell's duration in minutes: "Up to 1 minute" is 1, a round is 0.1. Unknown: an hour. */
export function concentrationMinutes(spell) {
  const m = /(\d+)\s*(round|minute|hour|day)/i.exec(String(spell?.duration || ''));
  if (!m) return 60;
  return Number(m[1]) * { round: 0.1, minute: 1, hour: 60, day: 1440 }[m[2].toLowerCase()];
}

/** Minutes left on a character's concentration spell (spell = its SRD entry), or null if they aren't concentrating. */
export function concentrationLeft(ch, spell) {
  if (!ch?.concentration) return null;
  const t = ch.concentrationTime || { minutes: concentrationMinutes(spell), used: 0 };
  return Math.max(0, Math.round((t.minutes - t.used) * 10) / 10);
}

/** "about 7 rounds left", "about 9 minutes left", "about 2 hours left" for minutes left (null: ""). */
export function timeLeftText(minutes) {
  if (minutes == null) return '';
  if (minutes < 1) return `about ${Math.max(1, Math.round(minutes * 10))} round${Math.round(minutes * 10) === 1 ? '' : 's'} left`;
  if (minutes < 60) return `about ${Math.round(minutes)} minute${Math.round(minutes) === 1 ? '' : 's'} left`;
  const h = Math.round(minutes / 60);
  return `about ${h} hour${h === 1 ? '' : 's'} left`;
}
