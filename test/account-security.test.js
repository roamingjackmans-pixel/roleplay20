// Email-backed account security: sign-up email confirmation, new-device codes (30 days), three tries per code,
// forgot-password links, and changing email or password only with a code from the current email.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-acct-'));
process.env.DATA_DIR = DATA;
process.env.TUNNEL = 'off';
process.env.EMAIL_PROVIDER = 'file';
const sec = await import('../server/accountSecurity.js');
const auth = await import('../server/auth.js');
const { load } = await import('../server/store.js');

let ipN = 0;
const req = () => ({ headers: {}, socket: { remoteAddress: `10.0.0.${++ipN % 250}` } });
const outbox = () => {
  const dir = path.join(DATA, 'outbox');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
};
const lastTo = (to) => outbox().filter((m) => m.to === to).at(-1);
const codeFor = (to) => lastTo(to).subject.match(/(\d{6})$/)[1];
const wrong = (code) => String((Number(code) + 1) % 1000000).padStart(6, '0');
const age = (u, device, days) => { for (const v of Object.values(u.devices || {})) v.lastSignIn = Date.now() - days * 86400000; };

// new codes are spaced 30 seconds apart; the tests wind those clocks back instead of waiting
function forgetCooldown() {
  const st = load('auth-challenges.json', {});
  for (const k of Object.keys(st.sent || {})) st.sent[k] = st.sent[k].map((x) => ({ ...x, at: x.at - 60000 }));
}

async function newAccount(name, email, device = 'dev-A') {
  const r = await sec.signUp(req(), { username: name, password: 'secret123', email, device });
  assert.ok(r.challenge, JSON.stringify(r));
  assert.equal(r.challenge.purpose, 'verify_email');
  const v = sec.verifySignIn(req(), { challengeId: r.challenge.id, code: codeFor(email), device });
  assert.ok(v.token);
  return auth.userByName(name);
}

test('signing up needs an email, and the account is confirmed with a code sent to it', async () => {
  assert.match((await sec.signUp(req(), { username: 'noemail', password: 'secret123', device: 'x' })).error, /Add your email/);
  const r = await sec.signUp(req(), { username: 'julie', password: 'secret123', email: 'Julie@Example.com', device: 'dev-J' });
  assert.equal(r.challenge.to, 'j••••@example.com');
  assert.equal(r.token, undefined, 'no session before the code');
  const v = sec.verifySignIn(req(), { challengeId: r.challenge.id, code: codeFor('julie@example.com'), device: 'dev-J' });
  assert.ok(v.token);
  assert.equal(v.user.email, 'julie@example.com');
  assert.equal(v.user.emailVerified, true);
  assert.match((await sec.signUp(req(), { username: 'julie2', password: 'secret123', email: 'julie@example.com' })).error, /already used/);
});

test('a typo in the sign-up email can be fixed on the code screen', async () => {
  const r = await sec.signUp(req(), { username: 'lorax', password: 'secret123', email: 'lorax@exmaple.com', device: 'dev-L' });
  const fixed = await sec.fixSignUpEmail(req(), { challengeId: r.challenge.id, email: 'lorax@example.com' });
  assert.ok(fixed.challenge);
  const v = sec.verifySignIn(req(), { challengeId: fixed.challenge.id, code: codeFor('lorax@example.com'), device: 'dev-L' });
  assert.equal(v.user.email, 'lorax@example.com');
});

test('a known device signs straight in; a new one, or one unused for 30 days, gets a code', async () => {
  const u = await newAccount('yorgy', 'yorgy@example.com', 'dev-Y');
  const same = await sec.signIn(req(), { username: 'yorgy', password: 'secret123', device: 'dev-Y' });
  assert.ok(same.token, 'same device within 30 days');
  const other = await sec.signIn(req(), { username: 'yorgy', password: 'secret123', device: 'phone' });
  assert.ok(other.challenge && !other.token, 'a new device needs a code');
  assert.match(lastTo('yorgy@example.com').text, /signing in to Roleplay20 as yorgy/);
  age(u, 'dev-Y', 31);
  forgetCooldown();
  const stale = await sec.signIn(req(), { username: 'yorgy', password: 'secret123', device: 'dev-Y' });
  assert.ok(stale.challenge, '31 days later the same device needs a code again');
  assert.equal((await sec.signIn(req(), { username: 'yorgy', password: 'nope', device: 'dev-Y' })).status, 401);
});

test('three wrong codes end it; a new code has to be sent', async () => {
  await newAccount('steph', 'steph@example.com', 'dev-S');
  const r = await sec.signIn(req(), { username: 'steph', password: 'secret123', device: 'laptop' });
  const good = codeFor('steph@example.com');
  assert.match(sec.verifySignIn(req(), { challengeId: r.challenge.id, code: wrong(good), device: 'laptop' }).error, /2 tries left/);
  assert.match(sec.verifySignIn(req(), { challengeId: r.challenge.id, code: wrong(good), device: 'laptop' }).error, /1 try left/);
  assert.match(sec.verifySignIn(req(), { challengeId: r.challenge.id, code: wrong(good), device: 'laptop' }).error, /three times/);
  assert.match(sec.verifySignIn(req(), { challengeId: r.challenge.id, code: good, device: 'laptop' }).error, /expired/, 'even the right code is refused now');
  assert.match((await sec.resendCode(req(), { challengeId: r.challenge.id })).error, /Wait \d+ seconds/, 'and new codes are spaced out');
});

test('forgot password emails a one-time link that resets it and signs out everywhere else', async () => {
  const u = await newAccount('rcplayer', 'rc@example.com', 'dev-R');
  const oldSession = (await sec.signIn(req(), { username: 'rcplayer', password: 'secret123', device: 'dev-R' })).token;
  const unknown = await sec.forgotPassword(req(), { login: 'nobody-here' });
  const known = await sec.forgotPassword(req(), { login: 'rc@example.com' });
  assert.equal(unknown.message, known.message, "the answer doesn't reveal which accounts exist");
  const link = lastTo('rc@example.com').text.match(/https:\/\/\S+token=(\S+)/);
  assert.ok(link, 'the email has a reset link');
  assert.match(link[0], /^https:\/\/josephjackman\.com\/games\/roleplay20\/#\/reset\?token=/);
  const token = decodeURIComponent(link[1]);
  const r = await sec.resetPassword(req(), { token, password: 'brandnew1', device: 'dev-R' });
  assert.ok(r.token);
  assert.equal(auth.userForToken(oldSession), null, 'old sessions are signed out');
  assert.equal((await sec.resetPassword(req(), { token, password: 'again123' })).error.includes('expired'), true, 'the link works once');
  assert.ok((await sec.signIn(req(), { username: 'rcplayer', password: 'brandnew1', device: 'dev-R' })).token);
  assert.ok(auth.passwordMatches(u, 'brandnew1'));
});

test('changing the password while signed in needs a code from the current email', async () => {
  const u = await newAccount('pip', 'pip@example.com', 'dev-P');
  const token = (await sec.signIn(req(), { username: 'pip', password: 'secret123', device: 'dev-P' })).token;
  assert.match((await sec.changePassword(u, token, { oldPassword: 'secret123', newPassword: 'hijacked1' })).error, /expired|code/, 'the old password alone is not enough');
  const step = await sec.requestChangeCode(u, { purpose: 'change_password' });
  assert.match(lastTo('pip@example.com').subject, /change your password/);
  assert.match((await sec.changePassword(u, token, { challengeId: step.challenge.id, code: wrong(codeFor('pip@example.com')), newPassword: 'newpass12' })).error, /2 tries left/);
  assert.deepEqual(await sec.changePassword(u, token, { challengeId: step.challenge.id, code: codeFor('pip@example.com'), newPassword: 'newpass12' }), { ok: true });
  assert.ok(auth.passwordMatches(u, 'newpass12'));
  assert.ok(auth.userForToken(token), 'the device that made the change stays signed in');
  assert.match(lastTo('pip@example.com').subject, /password was changed/);
});

test('changing the email needs a code from the current email, then confirms the new one', async () => {
  const u = await newAccount('kesh', 'kesh@example.com', 'dev-K');
  assert.match((await sec.startEmailChange(u, { newEmail: 'thief@example.com', password: 'secret123' })).error, /expired|code/);
  const step = await sec.requestChangeCode(u, { purpose: 'change_email' });
  const next = await sec.startEmailChange(u, { challengeId: step.challenge.id, code: codeFor('kesh@example.com'), newEmail: 'kesh.new@example.com' });
  assert.equal(next.challenge.purpose, 'confirm_new_email');
  assert.equal(u.email, 'kesh@example.com', 'not changed until the new address is confirmed');
  const done = await sec.confirmEmailChange(u, { challengeId: next.challenge.id, code: codeFor('kesh.new@example.com') });
  assert.equal(done.user.email, 'kesh.new@example.com');
  assert.match(lastTo('kesh@example.com').subject, /email was changed/, 'the old address is told');
});

test('an older account with no email adds one with its password, then confirms it', async () => {
  const made = auth.createUser({ username: 'oldtimer', password: 'secret123' });
  const u = made.user;
  const signed = await sec.signIn(req(), { username: 'oldtimer', password: 'secret123', device: 'any' });
  assert.ok(signed.token, 'no email yet: signs in with just the password');
  assert.match((await sec.startEmailChange(u, { newEmail: 'old@example.com', password: 'wrong' })).error, /current password/);
  const next = await sec.startEmailChange(u, { newEmail: 'old@example.com', password: 'secret123' });
  const done = await sec.confirmEmailChange(u, { challengeId: next.challenge.id, code: codeFor('old@example.com') });
  assert.equal(done.user.emailVerified, true);
});
