// Email-backed account security.
//
// - Accounts have an email (asked for when you sign up; changed from Account settings).
// - Signing in on a device you haven't signed in on for 30 days sends a 6-digit code to your email.
// - "Forgot password" emails a one-time reset link (30 minutes).
// - Changing your email or password while signed in first needs a code sent to your current email, so someone using
//   your signed-in account can't take it over without access to your inbox. A new email is confirmed with a code too.
// - Every code lasts 10 minutes and allows 3 tries; after that a new code has to be sent.
// When email isn't set up on the server (no Resend key), all of this stays off and sign-in works with just a password.
import crypto from 'node:crypto';
import { load, save } from './store.js';
import { sha256, randomId, randomToken, clientIp } from './security.js';
import { usersDb, getUser, issueSession, publicUser, revokeSessions, createUser, checkLogin, userByEmail, userByName, saveUsers, setPassword, passwordMatches } from './auth.js';
import { emailReady, sendEmail, renderEmail } from './email.js';
import { config } from './config.js';

const FILE = 'auth-challenges.json';
const store = () => load(FILE, { challenges: {}, resets: {}, sent: {} });
const CODE_MINUTES = 10;
const MAX_TRIES = 3;
const RESEND_SECONDS = 30;
const CODES_PER_HOUR = 8;
const DEVICE_DAYS = 30;
const RESET_MINUTES = 30;
const forgotByIp = new Map();

export const normEmail = (e) => String(e || '').trim().toLowerCase();
export const validEmail = (e) => typeof e === 'string' && e.trim().length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());

/** j••••@gmail.com */
export function maskEmail(e) {
  const [u = '', d = ''] = String(e || '').split('@');
  return `${u.slice(0, 1)}${'•'.repeat(Math.max(1, Math.min(6, u.length - 1)))}@${d}`;
}

const deviceKey = (device) => (device ? sha256(`device:${String(device).slice(0, 128)}`) : null);
const hasVerifiedEmail = (u) => !!(u?.email && u.emailVerified);

/** A code is needed when email works, the account has a confirmed email, and this device hasn't signed in for 30 days. */
export function needsDeviceCode(user, device) {
  if (!emailReady() || !hasVerifiedEmail(user)) return false;
  const rec = user.devices?.[deviceKey(device)];
  return !rec || Date.now() - rec.lastSignIn > DEVICE_DAYS * 86400000;
}

export function rememberDevice(user, device) {
  const k = deviceKey(device);
  if (!k) return;
  user.devices ||= {};
  user.devices[k] = { lastSignIn: Date.now() };
  // forget devices nobody has used for a long while
  for (const [key, v] of Object.entries(user.devices)) if (Date.now() - v.lastSignIn > 180 * 86400000) delete user.devices[key];
  saveUsers();
}

function session(user, device) {
  rememberDevice(user, device);
  return { user: publicUser(user), token: issueSession(user.id) };
}

// ---------------------------------------------------------------- codes

const CODE_COPY = {
  login: (u) => ({ subject: 'sign-in code', heading: 'Your sign-in code', lines: [`Someone (hopefully you) is signing in to Roleplay20 as ${u.username} on a device that hasn't been used for a while.`, 'Enter this code to finish signing in. It expires in 10 minutes.'], footer: "If this wasn't you, don't share the code, and change your password: someone knows it." }),
  verify_email: (u) => ({ subject: 'confirm your email', heading: 'Confirm your email', lines: [`Welcome to Roleplay20, ${u.displayName || u.username}!`, 'Enter this code to confirm this is your email. It expires in 10 minutes.'], footer: "If you didn't create a Roleplay20 account, you can ignore this email." }),
  change_email: (u) => ({ subject: 'code to change your email', heading: 'Code to change your email', lines: [`Someone signed in as ${u.username} asked to change the email on the account.`, 'Enter this code to continue. It expires in 10 minutes.'], footer: "If this wasn't you, someone may be using your account: change your password." }),
  change_password: (u) => ({ subject: 'code to change your password', heading: 'Code to change your password', lines: [`Someone signed in as ${u.username} asked to change the account's password.`, 'Enter this code to continue. It expires in 10 minutes.'], footer: "If this wasn't you, someone may be using your account. Don't share this code." }),
  confirm_new_email: (u) => ({ subject: 'confirm your new email', heading: 'Confirm your new email', lines: [`This will become the email for the Roleplay20 account ${u.username}.`, 'Enter this code to confirm it. It expires in 10 minutes.'], footer: "If you didn't ask for this, you can ignore this email." }),
};

async function sendCode(user, purpose, { to = user.email, newEmail = null } = {}) {
  const st = store();
  const now = Date.now();
  const sent = (st.sent[user.id] || []).filter((x) => now - x.at < 3600000);
  if (sent.length >= CODES_PER_HOUR) return { error: 'Too many codes have been sent. Wait a while and try again.', status: 429 };
  // new codes for the same thing to the same address are spaced out (a corrected address can get one right away)
  const last = sent.filter((x) => x.purpose === purpose && (!x.to || x.to === to)).at(-1);
  if (last && now - last.at < RESEND_SECONDS * 1000) {
    return { error: `Wait ${Math.ceil((RESEND_SECONDS * 1000 - (now - last.at)) / 1000)} seconds before sending another code.`, status: 429 };
  }
  // a new code replaces any earlier one for the same thing
  for (const [id, ch] of Object.entries(st.challenges)) if ((ch.userId === user.id && ch.purpose === purpose) || ch.exp < now) delete st.challenges[id];
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const id = randomId('ch_', 12);
  st.challenges[id] = { id, userId: user.id, purpose, codeHash: sha256(`${id}:${code}`), tries: 0, exp: now + CODE_MINUTES * 60000, to, newEmail };
  st.sent[user.id] = [...sent, { at: now, purpose, to }];
  save(FILE);
  const copy = CODE_COPY[purpose](user);
  const { text, html } = renderEmail({ heading: copy.heading, lines: copy.lines, code, footer: copy.footer });
  try {
    await sendEmail({ to, subject: `Roleplay20 ${copy.subject}: ${code}`, text, html });
  } catch (e) {
    delete st.challenges[id];
    save(FILE);
    return { error: e.message, status: 502 };
  }
  return { challenge: { id, to: maskEmail(to), purpose, expiresIn: CODE_MINUTES * 60, resendIn: RESEND_SECONDS } };
}

/** Check a code. Three wrong tries end it; then a new code has to be sent. */
function checkCode(id, code, { userId = null, purposes = null } = {}) {
  const st = store();
  const ch = st.challenges[String(id || '')];
  if (!ch || ch.exp < Date.now() || ch.dead) return { error: 'That code has expired. Send a new code.', expired: true, status: 400 };
  if ((userId && ch.userId !== userId) || (purposes && !purposes.includes(ch.purpose))) return { error: 'That code is for something else.', status: 400 };
  const clean = String(code || '').replace(/\D/g, '');
  const ok = clean.length === 6 && crypto.timingSafeEqual(Buffer.from(sha256(`${ch.id}:${clean}`)), Buffer.from(ch.codeHash));
  if (!ok) {
    ch.tries += 1;
    if (ch.tries >= MAX_TRIES) {
      ch.dead = true;
      save(FILE);
      return { error: 'Wrong code three times. Send a new code to try again.', expired: true, status: 400 };
    }
    save(FILE);
    const left = MAX_TRIES - ch.tries;
    return { error: `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.`, triesLeft: left, status: 400 };
  }
  delete st.challenges[ch.id];
  save(FILE);
  return { ok: true, ch };
}

async function notice(to, heading, lines) {
  if (!to || !emailReady()) return;
  const { text, html } = renderEmail({ heading, lines, footer: "If this wasn't you, reset your password from the sign-in page right away." });
  try { await sendEmail({ to, subject: `Roleplay20: ${heading.toLowerCase()}`, text, html }); } catch { /* a notice failing shouldn't undo the change */ }
}

// ---------------------------------------------------------------- signing up and in

export function securityOptions() {
  return { email: emailReady() };
}

export async function signUp(req, { username, password, displayName, email, device }) {
  const e = normEmail(email);
  if (emailReady() && !e) return { error: 'Add your email: it lets you reset your password and keeps your account safe.', status: 400 };
  if (e && !validEmail(e)) return { error: "That email doesn't look right.", status: 400 };
  const r = createUser({ username, password, displayName, email: e });
  if (r.error) return { ...r, status: 400 };
  if (emailReady() && e) return sendCode(r.user, 'verify_email');
  return session(r.user, device);
}

export async function signIn(req, { username, password, device }) {
  const r = checkLogin(req, { username, password });
  if (r.error) return r;
  const u = r.user;
  if (emailReady() && u.email && !u.emailVerified) return sendCode(u, 'verify_email');
  if (needsDeviceCode(u, device)) return sendCode(u, 'login');
  return session(u, device);
}

/** The code from a sign-in or sign-up email: confirms the email (if needed) and signs this device in. */
export function verifySignIn(req, { challengeId, code, device }) {
  const r = checkCode(challengeId, code, { purposes: ['login', 'verify_email'] });
  if (r.error) return r;
  const u = getUser(r.ch.userId);
  if (!u) return { error: 'That account no longer exists.', status: 400 };
  if (r.ch.purpose === 'verify_email') { u.emailVerified = true; saveUsers(); }
  return session(u, device);
}

/** Send a fresh code for an earlier challenge (sign-in ones need no session; account ones must be the same user). */
export async function resendCode(req, { challengeId }, user = null) {
  const ch = store().challenges[String(challengeId || '')];
  if (!ch) return { error: 'Start again: that request has expired.', status: 400 };
  const signInKind = ['login', 'verify_email'].includes(ch.purpose);
  if (!signInKind && ch.userId !== user?.id) return { error: 'Sign in again to do that.', status: 403 };
  const u = getUser(ch.userId);
  if (!u) return { error: 'That account no longer exists.', status: 400 };
  return sendCode(u, ch.purpose, { to: ch.to, newEmail: ch.newEmail });
}

/** Typo in the email you signed up with? Fix it on the code screen (only before it was ever confirmed). */
export async function fixSignUpEmail(req, { challengeId, email }) {
  const ch = store().challenges[String(challengeId || '')];
  if (!ch || ch.purpose !== 'verify_email') return { error: 'Start again: that request has expired.', status: 400 };
  const u = getUser(ch.userId);
  if (!u || u.emailVerified) return { error: 'That email is already confirmed.', status: 400 };
  const e = normEmail(email);
  if (!validEmail(e)) return { error: "That email doesn't look right.", status: 400 };
  const other = userByEmail(e);
  if (other && other.id !== u.id) return { error: 'That email is already used by another account.', status: 400 };
  u.email = e;
  saveUsers();
  return sendCode(u, 'verify_email');
}

// ---------------------------------------------------------------- forgot password

const GENERIC_FORGOT = "If that account has a confirmed email, we've sent it a link to choose a new password. It works for 30 minutes.";

export async function forgotPassword(req, { login }) {
  if (!emailReady()) return { error: "Password resets by email aren't set up on this server yet. Ask the host to help.", status: 503 };
  const ip = clientIp(req);
  const hits = (forgotByIp.get(ip) || []).filter((t) => Date.now() - t < 3600000);
  if (hits.length >= 5) return { error: 'Too many reset requests. Try again in an hour.', status: 429 };
  forgotByIp.set(ip, [...hits, Date.now()]);
  const key = String(login || '').trim();
  const u = key.includes('@') ? userByEmail(key) : userByName(key);
  if (!u || !hasVerifiedEmail(u)) return { ok: true, message: GENERIC_FORGOT };
  const st = store();
  const recent = Object.values(st.resets).filter((r) => r.userId === u.id && Date.now() - r.created < 3600000);
  if (recent.length >= 3) return { ok: true, message: GENERIC_FORGOT };
  for (const [k, r] of Object.entries(st.resets)) if (r.userId === u.id || r.exp < Date.now()) delete st.resets[k];
  const token = randomToken();
  st.resets[sha256(token)] = { userId: u.id, exp: Date.now() + RESET_MINUTES * 60000, created: Date.now() };
  save(FILE);
  const link = `${config.siteUrl.replace(/\/?$/, '/')}#/reset?token=${encodeURIComponent(token)}`;
  const { text, html } = renderEmail({
    heading: 'Choose a new password',
    lines: [`Someone asked to reset the password for the Roleplay20 account ${u.username}.`, 'Use the button to choose a new one. The link works once, for 30 minutes. You may need the site password first.'],
    link, linkText: 'Choose a new password',
    footer: "If you didn't ask for this, ignore this email: your password stays the same.",
  });
  try { await sendEmail({ to: u.email, subject: 'Roleplay20: reset your password', text, html }); } catch (e) { console.error('[reset]', e.message); }
  return { ok: true, message: GENERIC_FORGOT };
}

/** The reset link: sets the new password, signs out everywhere else and signs this device in. */
export async function resetPassword(req, { token, password, device }) {
  const st = store();
  const k = sha256(String(token || ''));
  const r = st.resets[k];
  if (!r || r.exp < Date.now()) return { error: 'This reset link has expired or was already used. Ask for a new one.', status: 400 };
  const u = getUser(r.userId);
  if (!u) return { error: 'That account no longer exists.', status: 400 };
  const set = setPassword(u, password);
  if (set.error) return { ...set, status: 400 };
  delete st.resets[k];
  save(FILE);
  u.emailVerified = true; // the link proved the inbox is theirs
  revokeSessions(u.id);
  notice(u.email, 'Your password was changed', [`The password for the Roleplay20 account ${u.username} was just reset with an emailed link.`]);
  return session(u, device);
}

// ---------------------------------------------------------------- changing email or password while signed in

/** Step 1 for a signed-in change: a code to the current email. */
export async function requestChangeCode(user, { purpose }) {
  if (!['change_email', 'change_password'].includes(purpose)) return { error: 'Unknown request.', status: 400 };
  if (!emailReady() || !hasVerifiedEmail(user)) return { error: 'Your account has no confirmed email to send a code to.', status: 400 };
  return sendCode(user, purpose);
}

/** Change password: with a code from your email, or (only when there's no confirmed email to use) your current password. */
export async function changePassword(user, token, { challengeId, code, oldPassword, newPassword }) {
  if (emailReady() && hasVerifiedEmail(user)) {
    const r = checkCode(challengeId, code, { userId: user.id, purposes: ['change_password'] });
    if (r.error) return r;
  } else if (!passwordMatches(user, oldPassword)) {
    return { error: 'Your current password is wrong.', status: 400 };
  }
  const set = setPassword(user, newPassword);
  if (set.error) return { ...set, status: 400 };
  revokeSessions(user.id, token);
  notice(user.email, 'Your password was changed', [`The password for the Roleplay20 account ${user.username} was just changed. Other devices were signed out.`]);
  return { ok: true };
}

/**
 * Change (or add) your email. With a confirmed email: first a code to it. Without one: your password. Then the new
 * address gets a code of its own, so a typo can't lock you out. When email isn't set up on the server, the address
 * is just saved (with your password) and confirmed later.
 */
export async function startEmailChange(user, { challengeId, code, password, newEmail }) {
  const e = normEmail(newEmail);
  if (!validEmail(e)) return { error: "That email doesn't look right.", status: 400 };
  if (e === user.email && user.emailVerified) return { error: "That's already your email.", status: 400 };
  const other = userByEmail(e);
  if (other && other.id !== user.id) return { error: 'That email is already used by another account.', status: 400 };
  if (emailReady() && hasVerifiedEmail(user)) {
    const r = checkCode(challengeId, code, { userId: user.id, purposes: ['change_email'] });
    if (r.error) return r;
  } else if (!passwordMatches(user, password)) {
    return { error: 'Enter your current password to add an email.', status: 400 };
  }
  if (!emailReady()) {
    user.email = e;
    user.emailVerified = false;
    saveUsers();
    return { ok: true, user: publicUser(user), saved: true };
  }
  return sendCode(user, 'confirm_new_email', { to: e, newEmail: e });
}

export async function confirmEmailChange(user, { challengeId, code }) {
  const r = checkCode(challengeId, code, { userId: user.id, purposes: ['confirm_new_email'] });
  if (r.error) return r;
  const other = userByEmail(r.ch.newEmail);
  if (other && other.id !== user.id) return { error: 'That email is already used by another account.', status: 400 };
  const old = user.emailVerified ? user.email : '';
  user.email = r.ch.newEmail;
  user.emailVerified = true;
  saveUsers();
  if (old && old !== user.email) notice(old, 'Your email was changed', [`The email for the Roleplay20 account ${user.username} was changed to ${maskEmail(user.email)}.`]);
  return { ok: true, user: publicUser(user) };
}

// for tests: how many accounts exist with this email
export function _emailCount(email) {
  return Object.values(usersDb().users).filter((u) => u.email === normEmail(email)).length;
}
