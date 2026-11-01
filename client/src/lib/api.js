// Talks to the game server. The server address and gate token come from the public shell page (window.RP20)
// or, during development, from localStorage / the Vite dev defaults.
const store = {
  get(k) { try { return sessionStorage.getItem(k) ?? localStorage.getItem(k); } catch { return null; } },
  set(k, v, { session = false } = {}) {
    try {
      if (v == null) { sessionStorage.removeItem(k); localStorage.removeItem(k); return; }
      sessionStorage.setItem(k, v);
      if (!session) localStorage.setItem(k, v);
    } catch { /* private mode */ }
  },
};
export { store };

const shell = window.RP20 || {};
const devServer = import.meta.env?.DEV ? `http://${location.hostname}:3020/roleplay20/` : new URL('./', location.href).href;

export const cfg = {
  server: shell.server || store.get('rp20.server') || devServer,
  gate: shell.gate || store.get('rp20.gate') || null,
  device: shell.device || store.get('rp20.device') || null,
};

/** This browser's random device id (made by the password page): a new device means a sign-in code by email. */
export function getDevice() {
  if (!cfg.device) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    cfg.device = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    store.set('rp20.device', cfg.device);
  }
  return cfg.device;
}

export function setGate(token) { cfg.gate = token; store.set('rp20.gate', token); }
export function getToken() { return store.get('rp20.token'); }
export function setToken(t) { store.set('rp20.token', t); }

export class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

export async function api(path, { method = 'GET', body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (cfg.gate) headers['X-RP20-Gate'] = cfg.gate;
  const t = getToken();
  if (t) headers.Authorization = `Bearer ${t}`;
  let res;
  try {
    res = await fetch(cfg.server + 'api/' + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError("Can't reach the game server. Is it running?", 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403 && data.error === 'gate') window.dispatchEvent(new Event('rp20:gate'));
    if (res.status === 401 && data.error === 'auth') window.dispatchEvent(new Event('rp20:auth'));
    throw new ApiError(data.message || data.error || `Error ${res.status}`, res.status, data);
  }
  return data;
}

const srdCache = new Map();
export function loadSrd(name) {
  if (!srdCache.has(name)) srdCache.set(name, api(`srd/${name}`).catch((e) => { srdCache.delete(name); throw e; }));
  return srdCache.get(name);
}

/** Everything shared/rules.js needs, keyed the way the server builds it. */
let srdAll = null;
export function loadAllSrd() {
  if (!srdAll) {
    srdAll = Promise.all(['classes', 'races', 'backgrounds', 'spells', 'equipment', 'features', 'conditions', 'skills'].map((n) => loadSrd(n).catch(() => [])))
      .then(([classes, races, backgrounds, spells, equipment, features, conditions, skills]) => {
        const d = { classes, races, backgrounds, spells, equipment, features, conditions, skills };
        d.by = {};
        for (const [k, v] of Object.entries(d)) {
          if (k === 'by') continue;
          const m = new Map();
          if (Array.isArray(v)) for (const x of v) if (x?.index) m.set(x.index, x);
          else if (v && typeof v === 'object') for (const [kk, vv] of Object.entries(v)) m.set(kk, vv);
          d.by[k] = m;
        }
        return d;
      })
      .catch((e) => { srdAll = null; throw e; });
  }
  return srdAll;
}
