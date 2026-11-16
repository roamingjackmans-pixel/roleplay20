// Voice chat at the table. Browsers talk to each other directly (WebRTC, one connection per pair of players); the
// server only keeps track of who is in the call, passes their connection setup messages along, and runs "story time":
// while narration the whole table shares is being read aloud, every mic in the call is muted, until that narration has
// finished on every device in the call. Nothing here is saved: a restart simply drops the call and everyone rejoins.

const calls = new Map(); // campaignId -> { members: Map<userId, { socketId, muted, joinedAt }>, hush: Map<entryId, { waiting: Set<userId>, timer }> }
let send = () => {};     // (socketId, event, payload) - set by the server

/** The server tells the voice room how to reach a socket. */
export function configureVoice({ toSocket }) { send = toSocket; }

function call(c) {
  let v = calls.get(c.id);
  if (!v) calls.set(c.id, (v = { members: new Map(), hush: new Map() }));
  return v;
}

const others = (v, userId) => [...v.members.keys()].filter((u) => u !== userId);

function broadcast(c, event, payload, except = null) {
  const v = call(c);
  for (const [uid, m] of v.members) if (uid !== except) send(m.socketId, event, payload);
}

/** Who is in the call and who is muted (for everyone's screen). */
export function roster(c) {
  const v = calls.get(c.id);
  if (!v) return [];
  return [...v.members].map(([userId, m]) => ({ userId, muted: !!m.muted }));
}

/** Story time: on while any shared narration is still being read on a device in the call. */
export function hushState(c) {
  const v = calls.get(c.id);
  const waiting = new Set();
  for (const h of v?.hush.values() || []) for (const u of h.waiting) waiting.add(u);
  return { on: waiting.size > 0, waiting: [...waiting] };
}

function pushState(c) {
  const v = calls.get(c.id);
  if (!v) return;
  const state = { members: roster(c), hush: hushState(c) };
  for (const m of v.members.values()) send(m.socketId, 'voice:state', state);
}

/** Join the call from this socket. The newcomer connects to everyone already in it. */
export function join(c, userId, socketId) {
  const v = call(c);
  const was = v.members.get(userId);
  v.members.set(userId, { socketId, muted: was?.muted || false, joinedAt: Date.now() });
  pushState(c);
  return { ok: true, peers: others(v, userId), hush: hushState(c), members: roster(c) };
}

/** Leave the call (or the socket went away). Nobody waits for them to finish reading any more. */
export function leave(c, userId, socketId = null) {
  const v = calls.get(c.id);
  const m = v?.members.get(userId);
  if (!m || (socketId && m.socketId !== socketId)) return { ok: true };
  v.members.delete(userId);
  for (const [entryId, h] of v.hush) { h.waiting.delete(userId); if (!h.waiting.size) endHush(c, entryId); }
  broadcast(c, 'voice:left', { userId });
  pushState(c);
  if (!v.members.size) { for (const h of v.hush.values()) clearTimeout(h.timer); calls.delete(c.id); }
  return { ok: true };
}

export function setMuted(c, userId, muted) {
  const m = calls.get(c.id)?.members.get(userId);
  if (!m) return { error: 'You are not in the voice chat.' };
  m.muted = !!muted;
  pushState(c);
  return { ok: true };
}

/** Pass a connection setup message (offer, answer, network candidate) to another player in the call. */
export function relay(c, fromUserId, toUserId, data) {
  const v = calls.get(c.id);
  const from = v?.members.get(fromUserId);
  const to = v?.members.get(toUserId);
  if (!from || !to || fromUserId === toUserId) return { error: 'They are not in the voice chat.' };
  send(to.socketId, 'voice:signal', { from: fromUserId, data });
  return { ok: true };
}

/** How long reading this narration could reasonably take, so a device that never reports back can't hold the table. */
export function readingAllowanceMs(entry) {
  const chars = (entry.parts || []).reduce((n, p) => n + String(p.text || '').length, 0);
  return Math.min(4 * 60000, 8000 + Math.round(chars * 110));
}

/** Shared narration was just posted: everyone in the call reads it, so every mic waits until they all have. */
export function onNarration(c, entry) {
  if (!entry || entry.kind !== 'narration' || entry.to !== 'all') return;
  const v = calls.get(c.id);
  if (!v || !v.members.size) return;
  const waiting = new Set(v.members.keys());
  const timer = setTimeout(() => endHush(c, entry.id), readingAllowanceMs(entry));
  timer.unref?.();
  v.hush.set(entry.id, { waiting, timer });
  pushState(c);
}

/** A device finished reading this narration (or isn't reading it). */
export function readDone(c, userId, entryId) {
  const h = calls.get(c.id)?.hush.get(entryId);
  if (!h) return { ok: true };
  h.waiting.delete(userId);
  if (!h.waiting.size) endHush(c, entryId);
  else pushState(c);
  return { ok: true };
}

function endHush(c, entryId) {
  const v = calls.get(c.id);
  const h = v?.hush.get(entryId);
  if (!h) return;
  clearTimeout(h.timer);
  v.hush.delete(entryId);
  pushState(c);
}

/** Cloudflare TURN relays (for players behind strict networks), when the server has a key; otherwise free STUN only. */
export async function iceServers(config, fetchImpl = globalThis.fetch) {
  const stun = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
  if (!config.turnKeyId || !config.turnKeyToken) return stun;
  try {
    const r = await fetchImpl(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(config.turnKeyId)}/credentials/generate-ice-servers`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.turnKeyToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ttl: 12 * 3600 }),
    });
    if (!r.ok) throw new Error(`TURN ${r.status}`);
    const j = await r.json();
    return Array.isArray(j.iceServers) && j.iceServers.length ? j.iceServers : stun;
  } catch (e) {
    console.warn('[voice] TURN credentials unavailable, using STUN only:', e.message);
    return stun;
  }
}

/** For tests. */
export function _reset() { for (const v of calls.values()) for (const h of v.hush.values()) clearTimeout(h.timer); calls.clear(); }
