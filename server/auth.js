// Player accounts: username + password (scrypt), bearer session tokens.
import { load, save } from './store.js';
import { hashPassword, verifyPassword, randomId, randomToken, sha256, clientIp } from './security.js';

const USERS = 'users.json';
const SESSIONS = 'sessions.json';
const SESSION_DAYS = 60;
const COLORS = ['#e0b354', '#7aa2f7', '#9ece6a', '#f7768e', '#bb9af7', '#7dcfff', '#ff9e64', '#73daca', '#e9a0d0', '#c0caf5'];

const users = () => load(USERS, { users: {}, byName: {} });
const sessions = () => load(SESSIONS, {});
const loginFails = new Map(); // ip -> { n, until }

export function publicUser(u) {
  if (!u) return null;
  return { id: u.id, username: u.username, displayName: u.displayName, color: u.color, createdAt: u.createdAt, prefs: u.prefs || {} };
}

export function getUser(id) {
  return users().users[id] || null;
}

export function allUsers() {
  return Object.values(users().users);
}

function validUsername(name) {
  return typeof name === 'string' && /^[A-Za-z0-9_.\- ]{3,24}$/.test(name.trim());
}

function issueSession(userId) {
  const token = randomToken();
  const s = sessions();
  s[sha256(token)] = { userId, exp: Date.now() + SESSION_DAYS * 86400000, created: Date.now() };
  save(SESSIONS);
  return token;
}

export function signup({ username, password, displayName }) {
  if (!validUsername(username)) return { error: 'Usernames are 3-24 letters, numbers, spaces, dots, dashes or underscores.' };
  if (typeof password !== 'string' || password.length < 6) return { error: 'Passwords need at least 6 characters.' };
  const db = users();
  const key = username.trim().toLowerCase();
  if (db.byName[key]) return { error: 'That username is taken.' };
  const id = randomId('u_');
  const n = Object.keys(db.users).length;
  const user = {
    id,
    username: username.trim(),
    displayName: (typeof displayName === 'string' && displayName.trim().slice(0, 32)) || username.trim(),
    pass: hashPassword(password),
    color: COLORS[n % COLORS.length],
    createdAt: Date.now(),
    prefs: {},
  };
  db.users[id] = user;
  db.byName[key] = id;
  save(USERS);
  return { user: publicUser(user), token: issueSession(id) };
}

export function login(req, { username, password }) {
  const ip = clientIp(req);
  const f = loginFails.get(ip);
  if (f && f.until > Date.now()) return { error: 'Too many wrong passwords. Try again in a few minutes.', status: 429 };
  const db = users();
  const id = db.byName[String(username || '').trim().toLowerCase()];
  const user = id && db.users[id];
  if (!user || !verifyPassword(password || '', user.pass)) {
    const n = (f && f.until < Date.now() ? 0 : f?.n || 0) + 1;
    loginFails.set(ip, { n, until: n >= 8 ? Date.now() + 10 * 60000 : 0 });
    return { error: 'Wrong username or password.', status: 401 };
  }
  loginFails.delete(ip);
  return { user: publicUser(user), token: issueSession(id) };
}

export function logout(token) {
  const s = sessions();
  delete s[sha256(token || '')];
  save(SESSIONS);
}

export function userForToken(token) {
  if (!token) return null;
  const s = sessions()[sha256(token)];
  if (!s || s.exp < Date.now()) return null;
  return getUser(s.userId);
}

export function updatePrefs(userId, prefs) {
  const u = getUser(userId);
  if (!u) return null;
  u.prefs = { ...(u.prefs || {}), ...prefs };
  if (typeof prefs.displayName === 'string' && prefs.displayName.trim()) u.displayName = prefs.displayName.trim().slice(0, 32);
  if (typeof prefs.color === 'string' && /^#[0-9a-f]{6}$/i.test(prefs.color)) u.color = prefs.color;
  delete u.prefs.displayName;
  delete u.prefs.color;
  save(USERS);
  return publicUser(u);
}

export function changePassword(userId, oldPassword, newPassword) {
  const u = getUser(userId);
  if (!u || !verifyPassword(oldPassword || '', u.pass)) return { error: 'Your current password is wrong.' };
  if (typeof newPassword !== 'string' || newPassword.length < 6) return { error: 'Passwords need at least 6 characters.' };
  u.pass = hashPassword(newPassword);
  save(USERS);
  return { ok: true };
}

/** Express middleware: requires `Authorization: Bearer <token>`. Sets req.user. */
export function requireUser(req, res, next) {
  const h = req.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  const user = userForToken(token);
  if (!user) return res.status(401).json({ error: 'auth', message: 'Please sign in.' });
  req.user = user;
  req.token = token;
  next();
}
