// Until email is set up on the server, nothing needs a code: nobody can be locked out by a missing email service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-acct-off-'));
process.env.TUNNEL = 'off';
process.env.EMAIL_PROVIDER = 'off';
delete process.env.RESEND_API_KEY;
const sec = await import('../server/accountSecurity.js');
const auth = await import('../server/auth.js');
const req = () => ({ headers: {}, socket: { remoteAddress: '10.1.1.1' } });

test('without email: sign up and sign in with just a password, on any device', async () => {
  assert.deepEqual(sec.securityOptions(), { email: false });
  const up = await sec.signUp(req(), { username: 'joe', password: 'secret123', device: 'a' });
  assert.ok(up.token, 'no email needed');
  const withEmail = await sec.signUp(req(), { username: 'alex', password: 'secret123', email: 'alex@example.com', device: 'a' });
  assert.ok(withEmail.token, 'an email can be given, and is confirmed later');
  assert.ok((await sec.signIn(req(), { username: 'alex', password: 'secret123', device: 'brand-new' })).token);
});

test('without email: forgot password says so, and password changes use the current password', async () => {
  assert.equal((await sec.forgotPassword(req(), { login: 'joe' })).status, 503);
  const u = auth.userByName('joe');
  assert.match((await sec.changePassword(u, null, { oldPassword: 'nope', newPassword: 'another1' })).error, /current password/);
  assert.deepEqual(await sec.changePassword(u, null, { oldPassword: 'secret123', newPassword: 'another1' }), { ok: true });
  const saved = await sec.startEmailChange(u, { newEmail: 'joe@example.com', password: 'another1' });
  assert.equal(saved.saved, true);
  assert.equal(saved.user.email, 'joe@example.com');
  assert.equal(saved.user.emailVerified, false);
});
