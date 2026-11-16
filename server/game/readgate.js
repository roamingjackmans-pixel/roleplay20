// The host's Read button. The DM's narration isn't read aloud the moment it arrives: it waits on screen until the host
// presses Read, so whoever is mid-sentence at the table can finish first. Then it is read on every device at once and,
// in the voice chat, story time mutes every mic until it has finished for everyone.
//
// The table only waits while the host is here (and hasn't turned this off on the DM Screen); otherwise narration is read
// as soon as it arrives, as before. Nothing here is saved: after a restart, narration that was waiting simply stays on
// screen (anyone can still press its 🔊 to hear it).

const waitingByCampaign = new Map(); // campaignId -> [entryId] in the order they were posted

/** True when new narration waits for the host's Read: the setting is on and the host is at the table. */
export function hostReads(c, online) {
  if (c.settings?.hostStartsReading === false) return false;
  return (c.members || []).some((m) => m.role === 'owner' && online.has(m.userId));
}

/** A narration entry was just posted. Hold it for the host if the table waits for them; true if it was held. */
export function holdNarration(c, entry, online) {
  if (entry?.kind !== 'narration') return false;
  const audience = entry.to === 'all' || (Array.isArray(entry.to) && entry.to.length > 0);
  if (!audience || !hostReads(c, online)) return false;
  let list = waitingByCampaign.get(c.id);
  if (!list) waitingByCampaign.set(c.id, (list = []));
  list.push(entry.id);
  if (list.length > 60) list.splice(0, list.length - 60);
  return true;
}

/** The narration still waiting for the host to press Read (ids, oldest first). */
export function waitingNarration(c) {
  return [...(waitingByCampaign.get(c.id) || [])];
}

/** The host pressed Read: everything waiting is released (and forgotten here). */
export function takeWaitingNarration(c) {
  const ids = waitingNarration(c);
  waitingByCampaign.delete(c.id);
  return ids;
}

/** For tests. */
export function _resetReadGate() { waitingByCampaign.clear(); }
