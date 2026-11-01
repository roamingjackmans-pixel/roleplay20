import { create } from 'zustand';
import { io } from 'socket.io-client';
import { cfg, getToken } from './api.js';
import { speakEntry } from './tts.js';
import { sounds } from './sound.js';

let socket = null;
let toastId = 0;

export const useStore = create((set, get) => ({
  user: null,
  route: parseRoute(),
  view: null,
  log: [],
  connected: false,
  joining: false,
  toasts: [],
  pings: [],
  dice: null,           // the dice result currently being animated
  srd: null,
  prefs: loadPrefs(),

  setUser: (user) => set({ user }),
  setSrd: (srd) => set({ srd }),
  go: (hash) => { if (location.hash !== hash) location.hash = hash; else set({ route: parseRoute() }); },
  setPrefs: (p) => { const prefs = { ...get().prefs, ...p }; savePrefs(prefs); set({ prefs }); },

  toast: (text, tone = 'info', ms = 4200) => {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, text, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },

  joinCampaign: (campaignId) => {
    if (socket) { socket.disconnect(); socket = null; }
    set({ view: null, log: [], joining: true });
    const url = new URL(cfg.server);
    socket = io(url.origin, { path: `${url.pathname.replace(/\/$/, '')}/socket.io`, auth: { token: getToken(), gate: cfg.gate }, transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      set({ connected: true });
      socket.emit('join', { campaignId }, (r) => {
        if (r?.error) { get().toast(r.error, 'bad'); set({ joining: false }); return; }
        set({ view: r.view, log: r.log || [], joining: false });
      });
    });
    let failures = 0;
    socket.on('connect', () => { failures = 0; });
    socket.on('disconnect', () => set({ connected: false }));
    socket.on('connect_error', (e) => {
      set({ connected: false });
      if (e.message === 'gate') window.dispatchEvent(new Event('rp20:gate'));
      if (e.message === 'auth') window.dispatchEvent(new Event('rp20:auth'));
      // the host's server may have come back on a new public address: look it up and reload onto it
      if (++failures % 4 === 0) rediscover();
    });
    socket.on('view', (view) => {
      const prev = get().view;
      set({ view });
      if (view?.combat?.myTurn && !prev?.combat?.myTurn) sounds.turn();
      if (view?.rolls?.mine?.length > (prev?.rolls?.mine?.length || 0)) sounds.request();
    });
    socket.on('log', (entry) => {
      set((s) => ({ log: [...s.log.slice(-400), entry] }));
      const { prefs, view } = get();
      if (entry.kind === 'narration' && prefs.readAloud !== false) speakEntry(entry, view?.voices || {}, prefs);
      if (entry.kind === 'dice') {
        const mine = entry.characterId && entry.characterId === view?.me?.characterId;
        if (mine || entry.result?.isCrit || entry.result?.natural === 20 || entry.result?.natural === 1) set({ dice: { ...entry, key: entry.id } });
        sounds.dice();
      }
      if (entry.kind === 'narration') sounds.page();
      if (entry.kind === 'clarify') sounds.request();
    });
    socket.on('toast', (t) => get().toast(t.text, t.tone));
    socket.on('ping', (p) => {
      set((s) => ({ pings: [...s.pings.filter((x) => Date.now() - x.at < 2500), p] }));
      sounds.ping();
    });
  },

  leaveCampaign: () => {
    if (socket) socket.disconnect();
    socket = null;
    set({ view: null, log: [], connected: false });
  },
}));

/** Send a game event and wait for the server's answer. Shows errors as toasts. */
export function emit(event, payload = {}, { quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!socket || !socket.connected) { useStore.getState().toast('Not connected to the table.', 'bad'); resolve({ error: 'offline' }); return; }
    socket.timeout(30000).emit(event, payload, (err, r) => {
      if (err) { useStore.getState().toast('The server took too long to answer.', 'bad'); resolve({ error: 'timeout' }); return; }
      if (r?.error && !quiet) useStore.getState().toast(r.error, 'bad');
      resolve(r || {});
    });
  });
}

async function rediscover() {
  if (!window.RP20?.shell) return; // only the public site moves between addresses
  try {
    const r = await fetch('https://api.github.com/repos/roamingjackmans-pixel/roleplay20/contents/server.json?ref=live', { cache: 'no-store', headers: { Accept: 'application/vnd.github.raw+json' } });
    const j = await r.json();
    if (j?.url && j.url !== cfg.server) {
      try { localStorage.setItem('rp20.server', j.url); } catch { /* ignore */ }
      location.reload();
    }
  } catch { /* still offline; try again later */ }
}

function parseRoute() {
  const h = location.hash.replace(/^#\/?/, '');
  const parts = h.split('/').filter(Boolean);
  if (!parts.length) return { name: 'lobby' };
  if (parts[0] === 'new') return { name: 'new' };
  if (parts[0] === 'c' && parts[1]) {
    if (parts[2] === 'play') return { name: 'play', id: parts[1] };
    if (parts[2] === 'create') return { name: 'create', id: parts[1] };
    return { name: 'campaign', id: parts[1] };
  }
  return { name: 'lobby' };
}
window.addEventListener('hashchange', () => useStore.setState({ route: parseRoute() }));

function loadPrefs() {
  try { return { readAloud: true, sounds: true, rate: 1, narratorVoice: '', ...JSON.parse(localStorage.getItem('rp20.prefs') || '{}') }; } catch { return { readAloud: true, sounds: true, rate: 1 }; }
}
function savePrefs(p) { try { localStorage.setItem('rp20.prefs', JSON.stringify(p)); } catch { /* ignore */ } }
