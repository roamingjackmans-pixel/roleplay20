// A long session's write-up needs room, and when it falls back to a plain list of what happened, the host can ask the
// DM to write it up again: the new log replaces the old one in the journal and the archive (never a second copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-rewrite-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { memoryOf } = await import('../server/game/memory.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

test('a session write-up that fails leaves a plain log, and the host can have it rewritten without duplicates', async () => {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Rewrite' });
  C.storeNewCharacter({ id: 'ch_rw', ownerId: 'u_a', name: 'Yorgy', hp: { max: 10, current: 10, temp: 0 }, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  c.members[0].characterId = 'ch_rw';
  E.setOnline(c, 'u_a', 's_rw', true);
  assert.ok(E.startSession(c).ok);
  await tick();
  assert.match(E.rewriteLastSessionLog(c).error, /End the session first/);
  c.chronicle.turns.push({ n: 99, at: Date.now(), summary: 'Yorgy rang the drowned bell.' });
  await E.endSession(c);
  const sess = c.sessions.at(-1);
  assert.equal(sess.logFallback, true, 'no AI here, so the plain log stands in');
  assert.match(sess.logEntry, /Yorgy rang the drowned bell/);
  assert.equal(c.thinking, null);

  const r = E.rewriteLastSessionLog(c);
  assert.ok(r.ok, r.error);
  assert.match(E.rewriteLastSessionLog(c).error || '', /busy/, 'one rewrite at a time');
  await tick();
  assert.equal(c.thinking, null);
  const entries = memoryOf(c).entries.filter((e) => e.kind === 'session' && e.session === sess.n);
  assert.equal(entries.length, 1, 'the archive keeps one log per session');
});
