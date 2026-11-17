// The host picks how fast the story moves: the same story takes about 20 sessions at a slow burn (every NPC has to be
// really talked to) and about 5 when fast (exposition comes quickly, each session covers a lot).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-pace-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { storyPaceBlock, cachedCampaignContext } = await import('../server/game/context.js');
const { buildView } = await import('../server/game/views.js');
const { STORY_PACES, paceOf, DEFAULT_PACE } = await import('../shared/pace.js');
const { DM_CORE, SESSION_END_CORE, GENESIS_CORE } = await import('../server/ai/prompts.js');

test('five paces, from about 20 sessions for the whole story down to about 5', () => {
  assert.deepEqual(STORY_PACES.map((p) => [p.id, p.sessions]), [['slow', 20], ['relaxed', 14], ['steady', 10], ['brisk', 7], ['fast', 5]]);
  assert.equal(DEFAULT_PACE, 'steady');
  assert.equal(paceOf({}).id, 'steady', 'a campaign that never chose one plays at the default');
  assert.equal(paceOf({ storyPace: 'warp speed' }).id, 'steady');
  assert.equal(C.newCampaign({ id: 'u_host' }, { name: 'New' }).settings.storyPace, 'steady');
});

test('the DM is told how to pace scenes, talk and exposition, and where this session stands', () => {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Paced', settings: { storyPace: 'fast' } });
  assert.match(storyPaceBlock(c), /^# STORY PACE: Fast \(about 5 sessions for the whole story\)/);
  assert.match(storyPaceBlock(c), /NPCs tell the party what they need the first time they ask/);
  assert.doesNotMatch(storyPaceBlock(c), /This is session/, 'no session count before the first session');
  c.sessionNumber = 3;
  assert.match(storyPaceBlock(c), /This is session 3 of about 5 for this story/);
  c.sessionNumber = 7;
  assert.match(storyPaceBlock(c), /session 7 of the story, past the 5 or so this pace allows: steer firmly toward the ending/);

  c.settings.storyPace = 'slow';
  c.sessionNumber = 3;
  assert.match(storyPaceBlock(c), /Slow burn \(about 20 sessions/);
  assert.match(storyPaceBlock(c), /NPCs never hand over what they know: the party earns it/);
  assert.match(storyPaceBlock(c), /session 3 of about 20/);

  c.world.pastBackbones = [{ text: 'The first story.', endedSession: 8 }];
  c.sessionNumber = 10;
  assert.match(storyPaceBlock(c), /session 2 of about 20/, 'a new chapter counts its own sessions');

  c.settings.shape = 'one-shot';
  assert.match(storyPaceBlock(c), /a one-shot: the whole story fits in one session/);
  assert.doesNotMatch(storyPaceBlock(c), /This is session/);

  const ctx = cachedCampaignContext(c);
  assert.ok(ctx.includes(storyPaceBlock(c)), 'every DM call sees it');
  assert.match(ctx, /Focus: balanced/);
  assert.doesNotMatch(ctx, /Pacing:/, 'the old roleplay/combat setting is called Focus now, so there is one pace');
  assert.match(DM_CORE, /STORY PACE \(in the campaign block\) sets how fast you move through it/);
  assert.match(SESSION_END_CORE, /whether the story is on pace for the STORY PACE/);
  assert.match(GENESIS_CORE, /The story is the same size at any STORY PACE/);
});

test('the host can change the pace; a change mid-session is noted for the DM, and a made-up pace is refused', () => {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Switch' });
  assert.match(E.setStoryPace(c, 'ludicrous').error, /not one of the choices/);
  assert.equal(c.settings.storyPace, 'steady');
  assert.deepEqual(E.setStoryPace(c, 'brisk'), { ok: true });
  assert.equal(c.settings.storyPace, 'brisk');
  assert.equal((c.world.dmNotes || []).length, 0, 'between sessions there is nothing to ease into');
  c.sessionActive = true;
  c.sessionNumber = 4;
  E.setStoryPace(c, 'slow');
  assert.match(c.world.dmNotes.at(-1), /changed the story pace from Brisk to Slow burn during session 4/);
  E.setStoryPace(c, 'slow');
  assert.equal(c.world.dmNotes.length, 1, 'choosing the same pace again changes nothing');
  assert.deepEqual(E.setStoryPace(c, undefined), { ok: true });
  assert.equal(buildView(c, 'u_host').campaign.settings.storyPace, 'slow', 'the DM Screen shows it');
});
