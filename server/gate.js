// The privacy gate: one shared password in front of everything else. Three wrong tries => locked out for 24 hours.
// Lockouts are tracked per IP address AND per device id, so clearing cookies or switching networks alone doesn't reset them.
import { config } from './config.js';
import { load, save } from './store.js';
import { verifyPassword, sign, unsign, clientIp } from './security.js';

const DB = 'gate.json';
const db = () => load(DB, { ips: {}, devices: {} });
const FAIL_MEMORY_MS = 24 * 3600 * 1000;

function record(bucket, key) {
  if (!key) return null;
  const now = Date.now();
  const r = bucket[key] || (bucket[key] = { fails: 0, lockedUntil: 0, lastFail: 0 });
  if (r.lockedUntil && r.lockedUntil < now) { r.lockedUntil = 0; r.fails = 0; }
  if (r.lastFail && now - r.lastFail > FAIL_MEMORY_MS && !r.lockedUntil) r.fails = 0;
  return r;
}

function cleanDevice(d) {
  return typeof d === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(d) ? d : null;
}

function state(ip, device) {
  const d = db();
  const a = record(d.ips, ip);
  const b = record(d.devices, device);
  const lockedUntil = Math.max(a?.lockedUntil || 0, b?.lockedUntil || 0);
  const fails = Math.max(a?.fails || 0, b?.fails || 0);
  return { a, b, lockedUntil, fails, remaining: Math.max(0, config.gateMaxFailures - fails) };
}

export function gateStatus(req) {
  const ip = clientIp(req);
  const device = cleanDevice(req.query?.device || req.body?.device);
  const s = state(ip, device);
  return { locked: s.lockedUntil > Date.now(), lockedUntil: s.lockedUntil || null, remaining: s.remaining, configured: !!config.gateHash };
}

export function tryGate(req) {
  const ip = clientIp(req);
  const device = cleanDevice(req.body?.device);
  const s = state(ip, device);
  const now = Date.now();
  if (s.lockedUntil > now) {
    return { ok: false, status: 423, locked: true, lockedUntil: s.lockedUntil, remaining: 0 };
  }
  if (!config.gateHash) {
    return { ok: false, status: 503, error: 'The site password has not been set up yet. Run `npm run setup` on the server.' };
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (password && verifyPassword(password, config.gateHash)) {
    for (const r of [s.a, s.b]) if (r) { r.fails = 0; r.lockedUntil = 0; }
    save(DB);
    const token = sign({ g: 1, dev: device, exp: now + config.gateTokenDays * 86400000 });
    return { ok: true, token };
  }
  for (const r of [s.a, s.b]) {
    if (!r) continue;
    r.fails += 1;
    r.lastFail = now;
    if (r.fails >= config.gateMaxFailures) r.lockedUntil = now + config.gateLockMs;
  }
  save(DB);
  const after = state(ip, device);
  console.log(`[gate] wrong password from ${ip} (${after.fails}/${config.gateMaxFailures})`);
  if (after.lockedUntil > now) {
    return { ok: false, status: 423, locked: true, lockedUntil: after.lockedUntil, remaining: 0 };
  }
  return { ok: false, status: 401, error: 'That is not the password.', remaining: after.remaining };
}

export function gateTokenValid(token) {
  const p = unsign(token);
  return !!(p && p.g === 1);
}

/** Express middleware: requires a valid gate token (header, or `g` query param for asset URLs). */
export function requireGate(req, res, next) {
  const token = req.get('x-rp20-gate') || req.query.g || req.params.gate;
  if (gateTokenValid(token)) return next();
  res.status(403).json({ error: 'gate', message: 'Enter the site password first.' });
}
