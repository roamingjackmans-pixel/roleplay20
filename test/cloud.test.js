// Running on Fly.io: the real client IP for the password lockout, and moving saved games between servers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-cloud-'));
process.env.TUNNEL = 'off';
const { clientIp } = await import('../server/security.js');
const { makeBundle, restoreBundle, BUNDLE_PATH } = await import('../server/restore.js');

test('on Fly.io the lockout counts the visitor, not the Fly proxy', () => {
  const req = { socket: { remoteAddress: '172.16.4.2' }, headers: { 'fly-client-ip': '203.0.113.9' } };
  process.env.FLY_APP_NAME = 'roleplay20';
  try {
    assert.equal(clientIp(req), '203.0.113.9');
  } finally {
    delete process.env.FLY_APP_NAME;
  }
  // off Fly, a visitor cannot pick their own IP by sending the header
  assert.equal(clientIp(req), '172.16.4.2');
});

test('saved games survive the move to another server', () => {
  const from = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-from-'));
  const to = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-to-'));
  fs.mkdirSync(path.join(from, 'campaigns'));
  fs.writeFileSync(path.join(from, 'users.json'), '{"u1":{"name":"Wren"}}');
  fs.writeFileSync(path.join(from, 'campaigns', 'c1.json'), '{"id":"c1"}');
  fs.writeFileSync(path.join(from, 'tunnel.json'), '{"pid":1}'); // belongs to the old PC only

  const { count, gz } = makeBundle(from);
  assert.equal(count, 2);
  fs.mkdirSync(path.join(to, 'import'));
  fs.writeFileSync(path.join(to, ...BUNDLE_PATH.split('/')), gz);
  fs.writeFileSync(path.join(to, 'users.json'), '{}'); // the fresh server's empty file is replaced

  assert.equal(restoreBundle(to), 2);
  assert.equal(fs.readFileSync(path.join(to, 'users.json'), 'utf8'), '{"u1":{"name":"Wren"}}');
  assert.equal(fs.readFileSync(path.join(to, 'campaigns', 'c1.json'), 'utf8'), '{"id":"c1"}');
  assert.equal(fs.existsSync(path.join(to, 'tunnel.json')), false);
  assert.equal(restoreBundle(to), 0, 'a bundle is unpacked only once');
});
