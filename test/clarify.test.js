// When a player declares more than one turn holds, the DM asks them privately and the round waits for their revision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-clarify-'));
process.env.DATA_DIR = dir;
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'file';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');

const inbox = path.join(dir, 'ai-inbox');
const seen = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function nextPrompt() {
  for (let i = 0; i < 100; i++) {
    const files = fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => f.endsWith('.prompt.md') && !seen.has(f)) : [];
    if (files.length) { seen.add(files[0]); return { id: files[0].replace('.prompt.md', ''), text: fs.readFileSync(path.join(inbox, files[0]), 'utf8') }; }
    await sleep(100);
  }
  throw new Error('no prompt');
}
const empty = { narration: [], npcs: [], rollRequests: [], effects: [], scene: { location: '', timeOfDay: '', weather: '', mood: '', areaMapId: '', areaLocationId: '' }, areaMaps: [], sceneMap: [], combatStart: [], quests: [], handouts: [], clarify: [], ruling: '', dmNotes: '', summary: '' };
const reply = (id, data) => fs.writeFileSync(path.join(inbox, `${id}.response.json`), JSON.stringify({ ...empty, ...data }));
async function until(fn) { for (let i = 0; i < 100; i++) { if (fn()) return; await sleep(100); } throw new Error('timed out'); }

function table() {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Clarify table' });
  c.members[0].characterId = 'ch_a';
  c.members.push({ userId: 'u_two', role: 'player', joinedAt: Date.now(), characterId: 'ch_b' });
  C.storeNewCharacter({ id: 'ch_a', ownerId: 'u_host', name: 'Alfa', hp: { max: 10, current: 10, temp: 0 } });
  C.storeNewCharacter({ id: 'ch_b', ownerId: 'u_two', name: 'Bravo', hp: { max: 10, current: 10, temp: 0 } });
  c.sessionActive = true;
  E.openActions(c);
  E.setOnline(c, 'u_host', 's1', true);
  E.setOnline(c, 'u_two', 's2', true);
  return c;
}

test('the DM asks only the overreaching player, keeps the others, and resolves after the revision', async () => {
  const c = table();
  E.submitAction(c, 'u_host', { text: 'I look around the hall.' });
  E.submitAction(c, 'u_two', { text: 'I attack all three goblins and run to the door.' });

  const p1 = await nextPrompt();
  assert.match(p1.text, /attack all three goblins/);
  assert.match(p1.text, /use "clarify"/);
  reply(p1.id, { clarify: [{ characterId: 'ch_b', message: 'You get one attack and 30 ft of movement. Which goblin, and do you move first?' }] });

  await until(() => c.round.revise?.u_two);
  assert.equal(c.phase, 'actions');
  assert.ok(c.round.actions.u_host?.logged, "the other player's action stands");
  assert.equal(c.round.actions.u_two, undefined);
  assert.equal(c.round.revise.u_two.text, 'I attack all three goblins and run to the door.');
  const q = c.log.filter((e) => e.kind === 'clarify');
  assert.equal(q.length, 1);
  assert.deepEqual(q[0].to, ['u_two']);
  assert.equal(c.log.filter((e) => e.kind === 'narration').length, 0, 'nothing was resolved yet');

  E.submitAction(c, 'u_two', { text: 'I attack the nearest goblin.' });
  const p2 = await nextPrompt();
  assert.match(p2.text, /REVISED after you asked/);
  assert.match(p2.text, /I look around the hall/);
  reply(p2.id, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Steel flashes.' }] }], summary: 'Bravo attacks a goblin.' });

  await until(() => c.log.some((e) => e.kind === 'narration'));
  await until(() => c.phase === 'actions');
  assert.equal(c.log.filter((e) => e.kind === 'action' && e.userId === 'u_host').length, 1, 'the kept action is not logged twice');
  assert.deepEqual(c.round.revise, {});
});

test('a player is never asked twice in one round: the DM is told to resolve instead', async () => {
  const c = table();
  E.submitAction(c, 'u_host', { text: 'I wait.' });
  E.submitAction(c, 'u_two', { text: 'I cast two spells and attack twice.' });
  const p1 = await nextPrompt();
  reply(p1.id, { clarify: [{ characterId: 'ch_b', message: 'One leveled spell or one attack. Which?' }] });
  await until(() => c.round.revise?.u_two);
  E.submitAction(c, 'u_two', { text: 'I cast one spell and attack.' });
  const p2 = await nextPrompt();
  reply(p2.id, { clarify: [{ characterId: 'ch_b', message: 'Still too much.' }] });
  const p3 = await nextPrompt();
  assert.match(p3.text, /Do not use "clarify": resolve now/);
  reply(p3.id, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'The spell lands; the swing will have to wait.' }] }] });
  await until(() => c.log.some((e) => e.kind === 'narration'));
  assert.equal(c.log.filter((e) => e.kind === 'clarify').length, 1, 'only one question was ever shown');
});
