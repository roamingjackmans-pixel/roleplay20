// Voice chat at the table. Everyone in the call hears everyone else directly, browser to browser (WebRTC, one connection
// per pair, which is plenty for a table of 4-6). The server only passes the connection setup along and runs
// "story time": while the narration the whole table shares is read aloud, every mic in the call is off, until it has
// finished on every device. Then the mics come back on by themselves.
//
// The browser's echo cancellation keeps the other players' voices from feeding back, but it can't always hear the
// read-aloud voice, which is why mics go quiet during story time (and why this device mutes its own mic while it reads
// anything private to you aloud, so it never reaches the others).
import { create } from 'zustand';
import { onEntryDone, onSpeaking, setSkipLock, currentlySpeaking } from './tts.js';

export const useVoice = create(() => ({
  joined: false,
  joining: false,
  muted: false,           // you muted yourself
  listenOnly: false,      // no microphone (or it was blocked): you hear everyone, they don't hear you
  error: '',
  members: [],            // [{ userId, muted }] everyone in the call (from the server)
  hush: { on: false, waiting: [] }, // story time, and whose devices are still reading
  peers: {},              // userId -> 'connecting' | 'connected' | 'failed'
  talking: {},            // userId (or 'me') -> true while their voice is coming through
  volumes: (() => { try { return JSON.parse(localStorage.getItem('rp20.voiceVolumes') || '{}'); } catch { return {}; } })(),
  reading: false,         // this device is reading something aloud right now
  ducked: false,          // the others are silent here while you use voice typing
}));
const set = (patch) => useVoice.setState(patch);
const get = () => useVoice.getState();

let socket = null;
let allowSkip = () => false;
let localStream = null;
let iceServers = [];
let sessionId = '';                 // this device's current call; a peer that rejoins gets a fresh connection
const peers = new Map();            // userId -> { pc, initiator, sid, audio, pending: [], meter }
let audioCtx = null;
let meterTimer = null;

/** The table's socket (a new one each time you open a campaign). */
export function bindVoice(s, opts = {}) {
  if (socket && socket !== s) leaveVoice({ quiet: true });
  socket = s;
  allowSkip = opts.allowSkip || (() => false);
  s.on('voice:state', ({ members, hush }) => {
    set({ members: members || [], hush: hush || { on: false, waiting: [] } });
    applyMic();
  });
  s.on('voice:signal', ({ from, data }) => { handleSignal(from, data).catch((e) => console.warn('[voice] signal', e)); });
  s.on('voice:left', ({ userId }) => closePeer(userId));
}

/** The table (re)joined after connecting: if we were in the call, rejoin it (a server restart drops everyone). */
export function voiceAfterTableJoin() {
  if (get().joined && localStream) connect().catch((e) => fail(e));
}

/** In the call with skipping not allowed, the table's narration is read on this device even if read-aloud is off. */
export function voiceForcesReading(entry) {
  return get().joined && !allowSkip() && entry?.kind === 'narration' && entry.to === 'all';
}

/** True while story time holds the narration on this device (the stop buttons are greyed out). */
export function useStoryLock() {
  return useVoice((s) => s.joined && s.hush.on) && !allowSkip();
}

/** This device finished reading a narration entry (or won't read it): tell story time. */
export function voiceReadDone(entryId) {
  if (get().joined && socket?.connected && entryId) socket.emit('voice:done', { entryId });
}

onEntryDone((id) => voiceReadDone(id));
setSkipLock(() => get().joined && get().hush.on && !allowSkip());

// Whenever this device reads anything aloud (the story, a replayed line, something private, a journal page), every mic
// in the call stays off until every device is quiet again. This mic goes quiet at once; the others when the server
// hears. "Quiet" waits a moment, so the pause between two sentences never lets the mics back on.
let quietTimer = null;
let reportedSpeaking = false;
onSpeaking((u) => {
  const reading = !!u;
  if (reading !== get().reading) { set({ reading }); applyMic(); }
  if (reading) {
    clearTimeout(quietTimer);
    quietTimer = null;
    reportSpeaking(true); // every sentence renews the claim
  } else if (!quietTimer) {
    quietTimer = setTimeout(() => { quietTimer = null; reportSpeaking(false); }, 700);
  }
});

function reportSpeaking(on) {
  if (!get().joined || !socket?.connected) { reportedSpeaking = false; return; }
  if (!on && !reportedSpeaking) return;
  reportedSpeaking = on;
  socket.emit('voice:speaking', { on });
}

/** While you use voice typing, the other players' voices are silent on this device (so it only hears you). */
let ducked = false;
export function duckCall(on) {
  ducked = !!on;
  for (const p of peers.values()) if (p.audio) p.audio.muted = ducked;
  set({ ducked });
}

function ask(event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket?.connected) { resolve({ error: 'Not connected to the table.' }); return; }
    socket.timeout(15000).emit(event, payload, (err, r) => resolve(err ? { error: 'The server took too long to answer.' } : r || {}));
  });
}

function fail(e) {
  console.warn('[voice]', e);
  set({ joining: false, error: String(e?.message || e || 'Voice chat failed.') });
}

/** Join the call. Asks for the microphone; without one you can still listen. */
export async function joinVoice() {
  if (get().joined || get().joining) return;
  set({ joining: true, error: '' });
  try {
    try {
      localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      set({ listenOnly: false });
    } catch (e) {
      localStream = silentStream(); // no mic, or it was blocked: join to listen
      set({ listenOnly: true });
    }
    await connect();
  } catch (e) {
    fail(e);
    stopLocal();
  }
}

async function connect() {
  for (const uid of [...peers.keys()]) closePeer(uid);
  sessionId = Math.random().toString(36).slice(2, 10);
  const r = await ask('voice:join');
  if (r.error) throw new Error(r.error);
  iceServers = r.iceServers || [];
  set({ joined: true, joining: false, members: r.members || [], hush: r.hush || { on: false, waiting: [] } });
  applyMic();
  startMeters();
  if (currentlySpeaking()) reportSpeaking(true); // joined mid-sentence: the others' mics wait for this device too
  for (const uid of r.peers || []) makePeer(uid, true); // the newcomer calls everyone already here
}

export function leaveVoice({ quiet = false } = {}) {
  if (!quiet && socket?.connected && get().joined) socket.emit('voice:leave', {});
  for (const uid of [...peers.keys()]) closePeer(uid);
  stopLocal();
  clearInterval(meterTimer);
  meterTimer = null;
  reportedSpeaking = false;
  set({ joined: false, joining: false, members: [], hush: { on: false, waiting: [] }, peers: {}, talking: {} });
}

export function setMuted(muted) {
  set({ muted: !!muted });
  applyMic();
  if (get().joined) socket?.emit('voice:mute', { muted: !!muted });
}

export function setVolume(userId, v) {
  const volumes = { ...get().volumes, [userId]: Math.max(0, Math.min(1, v)) };
  set({ volumes });
  try { localStorage.setItem('rp20.voiceVolumes', JSON.stringify(volumes)); } catch { /* ignore */ }
  const p = peers.get(userId);
  if (p?.audio) p.audio.volume = volumes[userId];
}

/** Whether your voice goes out right now: you're in, not muted, not story time, and this device isn't reading aloud. */
export function micLive(s = get()) {
  return s.joined && !s.listenOnly && !s.muted && !s.hush.on && !s.reading;
}

function applyMic() {
  const live = micLive();
  for (const t of localStream?.getAudioTracks() || []) t.enabled = live;
}

function stopLocal() {
  for (const t of localStream?.getTracks() || []) t.stop();
  localStream = null;
}

/** A track of silence, so a listener without a microphone still connects. */
function silentStream() {
  const ctx = ctxFor();
  const dest = ctx.createMediaStreamDestination();
  return dest.stream;
}

function ctxFor() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}

function signal(to, data) {
  socket?.emit('voice:signal', { to, data: { ...data, sid: sessionId } });
}

function setPeerState(uid, state) {
  set({ peers: { ...get().peers, [uid]: state } });
}

function makePeer(uid, initiator, remoteSid = null) {
  closePeer(uid);
  const pc = new RTCPeerConnection({ iceServers });
  const p = { pc, initiator, sid: remoteSid, audio: null, pending: [], meter: null };
  peers.set(uid, p);
  setPeerState(uid, 'connecting');
  for (const t of localStream?.getTracks() || []) pc.addTrack(t, localStream);
  pc.onicecandidate = (e) => { if (e.candidate) signal(uid, { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }); };
  pc.ontrack = (e) => {
    const stream = e.streams[0] || new MediaStream([e.track]);
    if (!p.audio) { p.audio = new Audio(); p.audio.autoplay = true; }
    p.audio.srcObject = stream;
    p.audio.volume = get().volumes[uid] ?? 1;
    p.audio.muted = ducked;
    p.audio.play().catch(() => {});
    p.meter = meterFor(stream);
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    setPeerState(uid, st === 'connected' ? 'connected' : st === 'failed' ? 'failed' : 'connecting');
    if (st === 'failed' && p.initiator) pc.restartIce?.(); // try again, through a relay if one is set up
  };
  if (initiator) {
    pc.onnegotiationneeded = async () => {
      try {
        await pc.setLocalDescription();
        signal(uid, { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
      } catch (e) { console.warn('[voice] offer', e); }
    };
  }
  return p;
}

async function handleSignal(from, data) {
  if (!get().joined || !data) return;
  let p = peers.get(from);
  // a new offer from someone who (re)joined the call: start a fresh connection with them
  if (data.sdp?.type === 'offer' && (!p || p.sid !== data.sid)) p = makePeer(from, false, data.sid);
  if (!p || (p.sid && data.sid && p.sid !== data.sid && !p.initiator)) return;
  if (p.initiator && data.sid) p.sid = data.sid;
  const { pc } = p;
  if (data.sdp) {
    await pc.setRemoteDescription(data.sdp);
    if (data.sdp.type === 'offer') {
      await pc.setLocalDescription();
      signal(from, { sdp: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
    }
    for (const cand of p.pending.splice(0)) await pc.addIceCandidate(cand).catch(() => {});
  } else if (data.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(data.candidate).catch(() => {});
    else p.pending.push(data.candidate);
  }
}

function closePeer(uid) {
  const p = peers.get(uid);
  if (!p) return;
  peers.delete(uid);
  try { p.pc.close(); } catch { /* already closed */ }
  if (p.audio) { p.audio.srcObject = null; }
  const next = { ...get().peers };
  delete next[uid];
  const talking = { ...get().talking };
  delete talking[uid];
  set({ peers: next, talking });
}

// ---- who is talking (a soft glow on their chip)

function meterFor(stream) {
  try {
    const ctx = ctxFor();
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    src.connect(an);
    return { an, buf: new Uint8Array(an.fftSize) };
  } catch { return null; }
}

function level(m) {
  if (!m) return 0;
  m.an.getByteTimeDomainData(m.buf);
  let sum = 0;
  for (let i = 0; i < m.buf.length; i++) { const v = (m.buf[i] - 128) / 128; sum += v * v; }
  return Math.sqrt(sum / m.buf.length);
}

function startMeters() {
  clearInterval(meterTimer);
  const mine = localStream && !get().listenOnly ? meterFor(localStream) : null;
  meterTimer = setInterval(() => {
    const talking = {};
    for (const [uid, p] of peers) if (level(p.meter) > 0.04) talking[uid] = true;
    if (micLive() && level(mine) > 0.04) talking.me = true;
    const prev = get().talking;
    const same = Object.keys(talking).length === Object.keys(prev).length && Object.keys(talking).every((k) => prev[k]);
    if (!same) set({ talking });
  }, 160);
}
