// Privacy gate: three wrong passwords lock the IP and the device; the lock expires; tokens verify.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-gate-'));
const salt = crypto.randomBytes(16).toString('base64url');
const hash = crypto.scryptSync('open sesame', salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
process.env.DATA_DIR = dir;
process.env.GATE_PASSWORD_HASH = `scrypt$${salt}$${hash}`;
process.env.GATE_LOCK_HOURS = String(0.6 / 3600); // 0.6 s so the test can watch the lock expire
process.env.SERVER_SECRET = 'test-secret';

const { tryGate, gateStatus, gateTokenValid } = await import('../server/gate.js');
const req = (password, device = 'devicedevice01', ip = '203.0.113.7') => ({ body: { password, device }, query: { device }, socket: { remoteAddress: ip }, headers: {} });

test('the right password returns a valid token', () => {
  const r = tryGate(req('open sesame', 'happydevice001', '198.51.100.1'));
  assert.equal(r.ok, true);
  assert.ok(gateTokenValid(r.token));
  assert.equal(gateTokenValid(r.token + 'x'), false);
});

test('three wrong passwords lock the IP and the device', async () => {
  let r = tryGate(req('nope'));
  assert.equal(r.status, 401);
  assert.equal(r.remaining, 2);
  r = tryGate(req('still nope'));
  assert.equal(r.remaining, 1);
  r = tryGate(req('third time'));
  assert.equal(r.status, 423);
  assert.equal(r.locked, true);
  // even the right password is refused while locked, from the same IP with another device ...
  r = tryGate(req('open sesame', 'otherdevice0001'));
  assert.equal(r.locked, true);
  // ... and from the same device on another network
  r = tryGate(req('open sesame', 'devicedevice01', '192.0.2.99'));
  assert.equal(r.locked, true);
  assert.equal(gateStatus(req('', 'devicedevice01')).locked, true);
  await new Promise((res) => setTimeout(res, 800));
  r = tryGate(req('open sesame'));
  assert.equal(r.ok, true, 'lock expires');
});
