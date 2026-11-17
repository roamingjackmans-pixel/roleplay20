// The DM's turn prompt is cheap to send again: what stays the same from turn to turn (the settled turns of the story,
// the settled DM notes, the rules and the world) is cached, and only the newest few turns and notes are new.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-cache-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { turnPromptParts, turnPrompt, PAGE } = await import('../server/game/context.js');
const { buildRequest, costOf } = await import('../server/ai/client.js');

function playTurn(c, n) {
  c.chronicle.turns.push({ n, at: n, actions: [{ name: 'Wren', text: `Wren tries thing ${n}.` }], rolls: [], narration: [{ to: 'all', parts: [{ speaker: 'narrator', text: `The answer to thing ${n}.` }] }], summary: `Turn ${n}: Wren did thing ${n}.` });
  if (c.chronicle.turns.length > 120) c.chronicle.turns.splice(0, c.chronicle.turns.length - 120);
  E.addDmNote(c, `Note ${n}: remember thing ${n}.`);
}

test('the cached parts stay word for word the same until a page fills up, and nothing recent is left out', () => {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Long night' });
  let prev = null, storyChanges = 0, noteChanges = 0;
  for (let n = 1; n <= 150; n++) {
    playTurn(c, n);
    const parts = turnPromptParts(c, { text: 'We press on.' }, new Set());
    assert.equal(parts.length, 3);
    assert.ok(parts[0].cache && parts[1].cache && !parts[2].cache);
    const all = parts.map((p) => p.text).join('\n');
    for (let k = Math.max(1, n - 7); k <= n; k++) assert.ok(all.includes(`## Turn ${k}\n`), `turn ${k} is shown in full at turn ${n}`);
    for (let k = Math.max(1, n - 11); k <= n; k++) assert.ok(all.includes(`Note ${k}:`), `note ${k} is shown at turn ${n}`);
    assert.ok(parts[2].text.includes(`## Turn ${n}\n`) || n % PAGE === 0, 'the newest turn is in the part that changes');
    if (prev) {
      const pageTurned = n % PAGE === 0;
      if (!pageTurned) {
        assert.equal(parts[0].text, prev[0].text, `the story part is unchanged at turn ${n}`);
        assert.equal(parts[1].text, prev[1].text, `the notes part is unchanged at turn ${n}`);
      }
      if (parts[0].text !== prev[0].text) storyChanges++;
      if (parts[1].text !== prev[1].text) noteChanges++;
    }
    prev = parts;
  }
  assert.ok(c.world.dmNotesDropped > 0, 'old notes have left the list (the archive keeps them)');
  assert.ok(storyChanges <= Math.ceil(150 / PAGE) && noteChanges <= Math.ceil(150 / PAGE), `pages turn once every ${PAGE} turns`);
  assert.ok(!turnPrompt(c, { text: 'x' }, new Set()).includes('## Turn 120\n'), 'old turns are one-line summaries, not in full');
});

test('the request caches the rules for an hour and each settled part, never the newest part', () => {
  const parts = [{ text: 'STORY', cache: true }, { text: 'NOTES', cache: true }, { text: 'NOW' }];
  const req = buildRequest({ system: 'RULES', cachedContext: 'WORLD', prompt: parts, model: 'claude-opus-5-5', effort: 'medium', cacheTtl: '1h', retryNote: ' (again)' });
  assert.deepEqual(req.system[1].cache_control, { type: 'ephemeral', ttl: '1h' });
  assert.deepEqual(req.messages[0].content.map((b) => [b.text, b.cache_control?.type || null]), [['STORY', 'ephemeral'], ['NOTES', 'ephemeral'], ['NOW (again)', null]]);
  const marks = JSON.stringify(req).split('cache_control').length - 1;
  assert.ok(marks <= 4, 'the API allows four cache breakpoints');
  const noNotes = buildRequest({ system: 'RULES', prompt: [{ text: 'STORY', cache: true }, { text: '', cache: true }, { text: 'NOW' }], model: 'claude-opus-5-5', effort: 'medium' });
  assert.equal(noNotes.messages[0].content.length, 2, 'an empty part is left out');
  assert.deepEqual(noNotes.system[0].cache_control, { type: 'ephemeral' }, 'five minutes unless asked');
  const plain = buildRequest({ system: 'RULES', prompt: 'Just text', model: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(plain.messages[0].content, [{ type: 'text', text: 'Just text' }]);
});

test('costs: hour-long cache writes cost twice the input price, and Sonnet 5.5 cache reads cost $0.10 per million', () => {
  assert.equal(costOf('claude-opus-5-5', { input_tokens: 0, cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 1e6, ephemeral_5m_input_tokens: 0 } }), 8);
  assert.equal(costOf('claude-opus-5-5', { cache_creation_input_tokens: 1e6 }), 5);
  assert.equal(costOf('claude-sonnet-5-5', { cache_read_input_tokens: 1e6 }), 0.1);
});
