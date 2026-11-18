// One story from the first session to the last: a world is built with a fixed backbone (the villain, the plan, the
// central truth, the acts, the ending) that the session write-ups can't rewrite, and the DM rolls only when it matters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-backbone-'));
process.env.DATA_DIR = dir;
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'file'; // the "DM" answers by writing reply files, so each round trip can be checked
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { cachedCampaignContext, partyBlock, actionsSinceRoll } = await import('../server/game/context.js');
const { DM_CORE, GENESIS_CORE, SESSION_END_CORE } = await import('../server/ai/prompts.js');

const inbox = path.join(dir, 'ai-inbox');
const seen = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function nextPrompt(task) {
  for (let i = 0; i < 100; i++) {
    const files = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => f.endsWith('.prompt.md') && f.includes(`-${task}-`) && !seen.has(f)) : [];
    if (files.length) { seen.add(files[0]); return { id: files[0].replace('.prompt.md', ''), text: fs.readFileSync(path.join(inbox, files[0]), 'utf8') }; }
    await sleep(50);
  }
  throw new Error(`no ${task} prompt`);
}
const reply = (id, data) => fs.writeFileSync(path.join(inbox, `${id}.response.json`), JSON.stringify(data));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(50); } throw new Error('timed out'); }

const BACKBONE = '## The Villain\nThe Lantern Queen wants every bell in Aurelion silenced.\n## The Acts\n1. The Quiet Town\n2. The Drowned Choir\n3. The Last Bell\n## The Ending\nThe Bell of Dawn rings or breaks.';
const sessionEnd = (extra) => ({ campaignLogEntry: '## Session - A night in town', recapBlurb: 'Previously...', npcUpdates: [], questUpdates: [], partyState: '', dmSecrets: '', storyArc: '', backboneComplete: false, chronicle: '', headline: 'The party came to town.', memories: [], storySoFar: '', ...extra });
const emptyTurn = { narration: [], npcs: [], rollRequests: [], effects: [], scene: { location: '', timeOfDay: '', weather: '', mood: '', areaMapId: '', areaLocationId: '' }, areaMaps: [], sceneMap: [], combatStart: [], quests: [], handouts: [], clarify: [], ruling: '', dmNotes: '', summary: '' };

test('a new world comes with its backbone, and the DM sees it on every turn', async () => {
  assert.match(GENESIS_CORE, /"backbone".*will NOT be rewritten.*The Villain.*The Villain's Plan.*The Acts.*The Ending.*Contingencies/s);
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Bells' });
  E.runGenesis(c);
  const p = await nextPrompt('genesis');
  assert.match(p.text, /THE GROUP'S BRIEF/);
  assert.match(p.text, /# STORY PACE: Steady \(about 10 sessions for the whole story\)/, 'the world is planned knowing the pace');
  reply(p.id, { title: 'Bells of Aurelion', tagline: '', worldBible: '# Aurelion', backbone: BACKBONE, dmSecrets: 'The queen was once the bell-keeper.', storyArc: 'Act 1, first beat.', characterPrompts: [], npcs: [], areaMaps: [], quests: [], startingScene: { location: 'Aurelion', timeOfDay: 'dusk', weather: '', mood: '', areaMapId: '', areaLocationId: '' }, openingHook: 'The bells stop.' });
  await until(() => c.status === 'ready');
  assert.equal(c.world.backbone, BACKBONE);
  const ctx = cachedCampaignContext(c);
  assert.match(ctx, /# BACKBONE \(for you only; fixed for the whole campaign/);
  assert.ok(ctx.includes('The Lantern Queen wants every bell in Aurelion silenced.'));
  E.clearWorld(c);
  assert.equal(c.world.backbone, '', 'a rebuilt world starts its backbone over too');
});

test('opening a new campaign while its world is being built never calls the build "interrupted by a server restart"', async () => {
  const S = await import('../server/store.js');
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Cave of Night' });
  E.runGenesis(c);
  const p = await nextPrompt('genesis');
  const opened = C.getCampaign(c.id); // the owner's browser opens the campaign page right after creating it
  assert.equal(opened.status, 'genesis', 'still building');
  assert.equal(opened.genesisError ?? null, null);
  assert.ok(opened.thinking, 'the page shows the world being built');
  assert.equal(E.genesisRunning(c), true);
  reply(p.id, { title: 'Cave of Night', tagline: '', worldBible: '# Night', backbone: BACKBONE, dmSecrets: '', storyArc: '', characterPrompts: [], npcs: [], areaMaps: [], quests: [], startingScene: { location: 'The cave mouth', timeOfDay: 'night', weather: '', mood: '', areaMapId: '', areaLocationId: '' }, openingHook: '' });
  await until(() => c.status === 'ready');
  assert.equal(c.genesisError, null);

  // ...but a build that really was cut off (the campaign was mid-build when the server stopped) is still caught
  const id = 'c_cutoff';
  fs.mkdirSync(path.join(dir, 'campaigns'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'campaigns', `${id}.json`), JSON.stringify({ ...structuredClone(c), id, status: 'genesis', thinking: { kind: 'genesis' }, genesisError: null }));
  S.load('campaign-index.json', { campaigns: {}, invites: {} }).campaigns[id] = { id, ownerId: 'u_host' };
  const cut = C.getCampaign(id);
  assert.equal(cut.status, 'ready');
  assert.match(cut.genesisError, /interrupted by a server restart/);
});

test('session write-ups move the party through the backbone but never rewrite it; a finished story makes way for the next chapter', async () => {
  assert.match(SESSION_END_CORE, /BACKBONE is fixed and you can't change it/);
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Long road' });
  Object.assign(c.world, { bible: '# Aurelion', backbone: BACKBONE, secrets: 'Old secrets.', arc: 'Act 1.' });
  c.status = 'active';
  const play = async (n, answer) => {
    c.sessionActive = true;
    c.sessionNumber = n;
    c.sessions.push({ n, startedAt: Date.now() - 1000, endedAt: null, recap: '', logEntry: '' });
    const done = E.endSession(c);
    const p = await nextPrompt('session_end');
    reply(p.id, sessionEnd(answer));
    await done;
    return p;
  };
  const p1 = await play(1, { storyArc: 'Act 2: the Drowned Choir. The queen silenced the harbour bell meanwhile.', backboneComplete: false });
  assert.ok(p1.text.includes('The Lantern Queen wants every bell in Aurelion silenced.'), 'the write-up sees the backbone');
  assert.equal(c.world.backbone, BACKBONE, 'unchanged');
  assert.match(c.world.arc, /Act 2/, 'the arc tracks where the party is');

  await play(2, { backboneComplete: true });
  assert.equal(c.world.backbone, '', 'the story was played to its end');
  assert.equal(c.world.pastBackbones.length, 1);
  assert.equal(c.world.pastBackbones[0].text, BACKBONE);
  assert.equal(c.world.pastBackbones[0].endedSession, 2);

  const next = E.ensureBackbone(c);
  const p = await nextPrompt('backbone');
  assert.match(p.text, /THE PREVIOUS BACKBONE'S STORY HAS ENDED\. Write the next chapter\./);
  assert.ok(p.text.includes('The Lantern Queen wants every bell in Aurelion silenced.'));
  reply(p.id, { backbone: '## The Villain\nThe Choirmaster, the queen\'s heir.' });
  assert.deepEqual(await next, { ok: true });
  assert.match(c.world.backbone, /The Choirmaster/);
});

test('a campaign that started without a backbone gets one when its next session begins, built from what was played', async () => {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Old table' });
  Object.assign(c.world, { bible: '# Wyrmcradle', secrets: 'Merriwen is the singer at the seam.', arc: 'Act 1: the Skull Shrine.' });
  c.status = 'active';
  c.sessionNumber = 5;
  c.members[0].characterId = 'ch_dagon';
  C.storeNewCharacter({ id: 'ch_dagon', ownerId: 'u_host', name: 'Dagon', hp: { max: 10, current: 10, temp: 0 } });
  E.setOnline(c, 'u_host', 's1', true);
  assert.ok(E.startSession(c).ok);
  const recap = await nextPrompt('turn');
  const p = await nextPrompt('backbone');
  assert.match(p.text, /keeping everything already established/);
  assert.match(p.text, /never invent a different main villain/);
  assert.ok(p.text.includes('Merriwen is the singer at the seam.'), 'built from the secrets the DM already has');
  assert.deepEqual(await E.ensureBackbone(c), { ok: false }, 'only one at a time');
  reply(p.id, { backbone: '## The Villain\nMerriwen, the silver singer.' });
  reply(recap.id, emptyTurn);
  await until(() => c.world.backbone);
  assert.match(c.world.backbone, /Merriwen/);
  assert.deepEqual(await E.ensureBackbone(c), { ok: false }, 'a campaign that has one keeps it');
  const bare = C.newCampaign({ id: 'u_host' }, { name: 'Nothing yet' });
  assert.deepEqual(await E.ensureBackbone(bare), { ok: false }, 'no world, nothing to build from');
});

test('the DM rolls only when it matters: competence counts, one roller per moment, about one roll per player every 3-5 actions', () => {
  assert.match(DM_CORE, /Roll only when the outcome is uncertain AND it can change the story/);
  assert.match(DM_CORE, /Competence counts.*athletic one hikes up the hill/s);
  assert.match(DM_CORE, /One roll per moment, from whoever is doing it/);
  assert.match(DM_CORE, /every 3 to 5 of their actions/);
  assert.match(DM_CORE, /drop them below 1 hit point/);
  assert.doesNotMatch(DM_CORE, /loves rolling dice|Look for the roll in every action|Ask several characters to roll in the same turn whenever it fits/);
  assert.doesNotMatch(fs.readFileSync(new URL('../server/game/engine.js', import.meta.url), 'utf8'), /this table loves dice/);

  const c = C.newCampaign({ id: 'u_host' }, { name: 'Dice pace' });
  c.members[0].characterId = 'ch_a';
  c.members.push({ userId: 'u_two', role: 'player', joinedAt: Date.now(), characterId: 'ch_b' });
  C.storeNewCharacter({ id: 'ch_a', ownerId: 'u_host', name: 'Alfa', hp: { max: 10, current: 10, temp: 0 } });
  C.storeNewCharacter({ id: 'ch_b', ownerId: 'u_two', name: 'Bravo', hp: { max: 10, current: 10, temp: 0 } });
  const both = [{ name: 'Alfa', characterId: 'ch_a', text: 'I climb.' }, { name: 'Bravo', characterId: 'ch_b', text: 'I watch.' }];
  c.chronicle.turns = [
    { n: 1, actions: both, rolls: [] },
    { n: 2, actions: [], rolls: ['Alfa (ch_a) Athletics [the cliff]: total 12 vs DC 12 -> SUCCESS'] },
    { n: 3, actions: both, rolls: [] },
    { n: 4, actions: both, rolls: [] },
  ];
  const a = C.getCharacter('ch_a'), b = C.getCharacter('ch_b');
  assert.equal(actionsSinceRoll(c, a), 2);
  assert.equal(actionsSinceRoll(c, b), null, 'Bravo has not rolled in all the turns kept');
  assert.match(partyBlock(c, new Set()), /Actions since their last roll: 2/);
  assert.match(partyBlock(c, new Set()), /Actions since their last roll: none in a long while/);
  c.chronicle.turns.push({ n: 5, actions: [], rolls: ['Bravo Attack: 15'] }); // a roll in a fight counts too
  assert.equal(actionsSinceRoll(c, b), 0);
});
