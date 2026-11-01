// Password hashing, signed tokens and client IP detection.
import crypto from 'node:crypto';
import { config } from './config.js';

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keylen, SCRYPT).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const [kind, salt, hash] = stored.split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = crypto.scryptSync(String(password), salt, expected.length, SCRYPT);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

let secret = config.secret;
if (!secret) {
  // No secret configured: generate one for this run (tokens won't survive a restart). setup.mjs writes a permanent one.
  secret = crypto.randomBytes(32).toString('base64url');
  console.warn('[security] SERVER_SECRET is not set; using a temporary secret. Run `npm run setup`.');
}

export function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function unsign(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function randomId(prefix = '', bytes = 9) {
  return prefix + crypto.randomBytes(bytes).toString('base64url').replace(/[-_]/g, 'x');
}

export function randomToken() {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256(s) {
  return crypto.createHash('sha256').update(String(s)).digest('base64url');
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * The real client IP (the password lockout counts per IP, so this must not be the proxy's address).
 * On Fly.io every request comes through Fly's edge proxy, which sets Fly-Client-IP itself.
 * Behind a Cloudflare tunnel on a PC every request arrives from localhost with CF-Connecting-IP set.
 */
export function clientIp(reqOrSocket) {
  const remote = reqOrSocket.socket?.remoteAddress || reqOrSocket.conn?.remoteAddress || reqOrSocket.handshake?.address || '';
  const headers = reqOrSocket.headers || reqOrSocket.handshake?.headers || {};
  if (process.env.FLY_APP_NAME && headers['fly-client-ip']) return String(headers['fly-client-ip']).trim();
  if (LOOPBACK.has(remote)) {
    const cf = headers['cf-connecting-ip'];
    if (cf) return String(cf).trim();
    const xff = headers['x-forwarded-for'];
    if (xff) return String(xff).split(',')[0].trim();
  }
  return remote.replace('::ffff:', '') || 'unknown';
}
