// The DM Screen's brain (model + thinking effort) is the one every AI call for the campaign uses, and the screen can
// show which model actually answered last.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-brain-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { buildView } = await import('../server/game/views.js');
const { config } = await import('../server/config.js');

test('the campaign brain is what the host picked, or the server default when nothing valid is set', () => {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Brain' });
  c.settings.model = 'claude-sonnet-5-5';
  c.settings.effort = 'high';
  assert.deepEqual(E.dmBrain(c), { model: 'claude-sonnet-5-5', effort: 'high' });
  c.settings.model = 'gpt-whatever';
  c.settings.effort = 'max';
  assert.deepEqual(E.dmBrain(c), { model: config.defaultModel, effort: config.defaultEffort });
  delete c.settings.model;
  assert.equal(E.dmBrain(c).model, config.defaultModel);
});

test('changing the brain checks the values and applies at once', () => {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Brain 2' });
  assert.match(E.setDmBrain(c, { model: 'claude-made-up' }).error, /not available/);
  assert.match(E.setDmBrain(c, { effort: 'extreme' }).error, /low, medium or high/);
  const r = E.setDmBrain(c, { model: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(r.brain, { model: 'claude-opus-5-5', effort: 'medium' });
  assert.deepEqual(buildView(c, 'u_a').ai.brain, { model: 'claude-opus-5-5', effort: 'medium' });
});

test('every AI call in the game passes the campaign brain (no call picks its own model or effort)', () => {
  for (const file of ['server/game/engine.js', 'server/game/combat.js']) {
    const src = fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    const calls = src.split('askClaude({').slice(1).map((s) => s.slice(0, s.indexOf('});') + 3));
    assert.ok(calls.length > 0, `${file} calls the AI`);
    for (const call of calls) {
      assert.match(call, /\.\.\.(E\.)?dmBrain\(c\)/, `${file}: ${call.slice(0, 80)}`);
      assert.doesNotMatch(call, /\b(model|effort):/, `${file} sets its own model or effort: ${call.slice(0, 80)}`);
    }
  }
});

test('the screen learns which model answered last, and notices a fallback', () => {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Brain 3' });
  E.trackUsage(c, { model: 'claude-opus-5-5', modelUsed: 'claude-opus-5-5', task: 'turn', costUsd: 0.05, usage: { input_tokens: 10, output_tokens: 5 }, ms: 1200 });
  let u = buildView(c, 'u_a').ai.usage;
  assert.equal(u.lastModel, 'claude-opus-5-5');
  assert.equal(u.lastTask, 'turn');
  E.trackUsage(c, { model: 'claude-opus-4-8', modelUsed: 'claude-opus-5-5', task: 'combat', costUsd: 0.01, usage: {}, ms: 900 });
  u = buildView(c, 'u_a').ai.usage;
  assert.equal(u.lastModel, 'claude-opus-4-8');
  assert.equal(u.lastAsked, 'claude-opus-5-5', 'a declined request handed to a fallback shows as such');
});

test('new campaigns start on Opus 5.5 at medium effort unless the server is told otherwise', () => {
  if (!process.env.DM_MODEL) assert.equal(config.defaultModel, 'claude-opus-5-5');
  if (!process.env.DM_EFFORT) assert.equal(config.defaultEffort, 'medium');
});
