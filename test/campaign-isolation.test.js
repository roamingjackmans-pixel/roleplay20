// Every campaign is its own world. Nothing one campaign builds, says or remembers can reach another one, and a world
// that is rebuilt (or built twice at once) never leaves its people, places or quests behind in the world that replaced it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-isolation-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const M = await import('../server/game/memory.js');
const { turnPrompt, cachedCampaignContext } = await import('../server/game/context.js');
const { buildView } = await import('../server/game/views.js');

const world = (tag, names) => ({
  title: `${tag} world`, tagline: `The ${tag} tagline`, worldBible: `The bible of ${tag}.`, dmSecrets: `${tag} secrets`, storyArc: `${tag} arc`,
  characterPrompts: [`A ${tag} hook`], openingHook: `${tag} opens`,
  npcs: [{ id: `npc_${names.npc.toLowerCase()}`, name: names.npc, role: 'tea-shop keeper', description: `${names.npc} keeps the ${names.place}.` }],
  areaMaps: [{ id: `area_${names.town.toLowerCase()}`, name: names.town, style: 'town', locations: [{ id: `loc_${names.place.toLowerCase().replace(/\W+/g, '_')}`, name: names.place, kind: 'inn', x: 0.5, y: 0.5 }] }],
  quests: [{ id: `q_${names.quest.toLowerCase().replace(/\W+/g, '_')}`, title: names.quest, status: 'active', summary: `Something odd at the ${names.place}.`, giver: names.npc }],
  startingScene: { location: `${names.place}, ${names.town}`, timeOfDay: 'dusk', areaMapId: `area_${names.town.toLowerCase()}` },
});
const DRAFT = { npc: 'Pellwick', town: 'Updrift', place: 'Cracked Cup', quest: 'The Shard in the Tea House' };
const FINAL = { npc: 'Pemba', town: 'Wyrmcradle', place: 'Tooth Tower', quest: 'The Silver Fire' };

test('a rebuilt world keeps nothing of the world it replaces', () => {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Rebuilt' });
  E.applyGenesis(c, world('draft', DRAFT));
  M.rememberNote(c, 'Pellwick hid the shard under the Cracked Cup floor.');
  c.world.dmNotes.push('Pellwick knows about the shard.');
  E.applyGenesis(c, world('final', FINAL));
  const all = JSON.stringify(c);
  for (const w of Object.values(DRAFT)) assert.ok(!all.includes(w), `"${w}" from the thrown-away world is gone`);
  assert.deepEqual(Object.keys(c.npcs), ['npc_pemba']);
  assert.deepEqual(c.quests.map((q) => q.title), ['The Silver Fire']);
  assert.deepEqual(Object.keys(c.maps.area), ['area_wyrmcradle']);
  assert.equal(c.scene.areaMapId, 'area_wyrmcradle');
  assert.deepEqual(M.searchMemory(c, 'Pellwick shard Cracked Cup'), [], 'the archive forgot the old world too');
  const asked = 'We ask about the shard at the Cracked Cup.'; // the players' own words are the only place it may appear
  const prompt = turnPrompt(c, { text: asked }, new Set()).replace(asked, '') + cachedCampaignContext(c);
  for (const w of Object.values(DRAFT)) assert.ok(!prompt.includes(w), `the DM is never told about "${w}"`);
});

test('a world is built once at a time: a second build while one is running is turned away', async () => {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Double click' });
  const first = E.runGenesis(c);
  assert.equal(E.genesisRunning(c), true);
  assert.match((await E.runGenesis(c)).error, /still being built/);
  await first; // the AI is off in tests, so this build ends straight away with a blank page
  assert.equal(E.genesisRunning(c), false);
  assert.ok(!(await E.runGenesis(c)).error, 'once it has finished, the host can rebuild');
});

test('two campaigns never see each other: not in the views, the logs, the memory or the DM prompts', () => {
  const a = C.newCampaign({ id: 'u_host' }, { name: 'Calandor-like' });
  const b = C.newCampaign({ id: 'u_host' }, { name: 'Epiphany-like' });
  for (const c of [a, b]) { c.members.push({ userId: 'u_p', role: 'player', characterId: null }); E.setOnline(c, 'u_host', `s_${c.id}`, true); E.setOnline(c, 'u_p', `p_${c.id}`, true); }
  E.applyGenesis(a, world('alpha', DRAFT));
  E.applyGenesis(b, world('beta', FINAL));
  // play in A: a new person, a quest, a note, a handout, narration and table talk
  E.upsertNpc(a, { id: 'npc_grandmother_quill', name: 'Grandmother Quill', role: 'bell-ringer' });
  E.upsertQuest(a, { title: 'The Heart of the Quillbell', summary: 'Grandmother Quill wants the heart back.' });
  M.rememberNote(a, 'Grandmother Quill rang the Quillbell at midnight.');
  E.addLog(a, { kind: 'narration', to: 'all', parts: [{ speaker: 'narrator', text: 'The Quillbell tolls over Updrift.' }] });
  E.addLog(a, { kind: 'chat', userId: 'u_p', name: 'Wren', text: 'Who is Grandmother Quill?' });
  const ASKED = 'Is anyone here called Grandmother Quill? We look for the Quillbell.'; // the players' own words aside
  const leaked = ['Quill', 'Updrift', 'Cracked Cup', 'Pellwick', 'alpha'];
  const seenInB = [
    JSON.stringify(buildView(b, 'u_host')), JSON.stringify(buildView(b, 'u_p')), JSON.stringify(b.log),
    turnPrompt(b, { text: ASKED }, new Set()).replace(ASKED, ''),
    cachedCampaignContext(b),
    JSON.stringify(M.searchMemory(b, 'Grandmother Quill Quillbell Updrift Cracked Cup Pellwick')),
  ].join('\n');
  for (const w of leaked) assert.ok(!seenInB.includes(w), `"${w}" from the other campaign never reaches this one`);
  // and A still has all of it
  assert.ok(turnPrompt(a, { text: 'We go and find Grandmother Quill.' }, new Set()).includes('Grandmother Quill'));
});
