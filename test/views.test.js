// Privacy rules for the story log: who sees which entries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-views-'));
process.env.TUNNEL = 'off';
const { logVisibleTo } = await import('../server/game/views.js');

const c = { members: [{ userId: 'host', role: 'owner' }, { userId: 'p2', role: 'player' }], settings: { dmView: false } };

test('declared actions are shared with the whole table', () => {
  const e = { kind: 'action', userId: 'p2', to: 'all', text: 'I drink the water' };
  assert.equal(logVisibleTo(c, e, 'p2'), true);
  assert.equal(logVisibleTo(c, e, 'host'), true);
});

test('a Private action stays with its player (and older actions keep their audience)', () => {
  const priv = { kind: 'action', userId: 'p2', to: ['p2'], private: true, text: 'I pocket the disc' };
  assert.equal(logVisibleTo(c, priv, 'p2'), true);
  assert.equal(logVisibleTo(c, priv, 'host'), false);
  assert.equal(logVisibleTo(c, { kind: 'action', userId: 'p2', to: ['p2'], text: 'from before' }, 'host'), false);
});

test('the host sees everything only in spoiler god view', () => {
  const e = { kind: 'action', userId: 'p2', to: ['p2'] };
  assert.equal(logVisibleTo({ ...c, settings: { dmView: true } }, e, 'host'), true);
});

test('narration addressed to one player stays private; "all" is shared', () => {
  assert.equal(logVisibleTo(c, { kind: 'narration', to: ['p2'] }, 'host'), false);
  assert.equal(logVisibleTo(c, { kind: 'narration', to: ['p2'] }, 'p2'), true);
  assert.equal(logVisibleTo(c, { kind: 'narration', to: 'all' }, 'host'), true);
});
