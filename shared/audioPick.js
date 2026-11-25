// Picking a saved audio device from what is plugged in right now (pure, so it can be tested without a browser).

/**
 * saved = { id, label } the player chose (null/empty = the computer's default); list = [{ id, label }] devices now.
 * -> { id, missing }: id '' means use the default; missing = they chose a device that isn't here (using the default).
 * Found by id first, then by name (some browsers hand out new ids now and then); a name shared by two devices is
 * ambiguous and not used.
 */
export function pickDevice(saved, list = []) {
  if (!saved || !saved.id) return { id: '', missing: false };
  const byId = list.find((d) => d.id === saved.id);
  if (byId) return { id: byId.id, missing: false };
  const norm = (s) => String(s || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim().toLowerCase();
  const want = norm(saved.label);
  if (want) {
    const named = list.filter((d) => norm(d.label) === want);
    if (named.length === 1) return { id: named[0].id, missing: false };
  }
  return { id: '', missing: true };
}

/** A readable name: the browser's label without the USB id on the end, or "Microphone 2" before names are allowed. */
export function deviceLabel(label, kind, i = 0) {
  const clean = String(label || '').replace(/\s*\([0-9a-f]{4}:[0-9a-f]{4}\)\s*$/i, '').trim();
  if (clean) return clean;
  return `${kind === 'audiooutput' ? 'Speaker' : 'Microphone'} ${i + 1}`;
}
