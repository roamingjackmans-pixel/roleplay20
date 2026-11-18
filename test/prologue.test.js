// Session 1 opens with a prologue: the world bible told as a story and read to the whole table (the world, its history
// and customs, the town and its people) before the first scene and the first "What do you do?". Its writer only ever
// sees player-facing material, so no DM secret can slip into it. Later sessions open with a recap, never the prologue.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-prologue-'));
process.env.DATA_DIR = dir;
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'file'; // the "DM" answers by writing reply files, so each request can be read and checked
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { prologuePrompt } = await import('../server/game/context.js');
const { PROLOGUE_CORE } = await import('../server/ai/prompts.js');

const inbox = path.join(dir, 'ai-inbox');
const seen = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pending = () => (fs.existsSync(inbox) ? fs.readdirSync(inbox).filter((f) => f.endsWith('.prompt.md') && !seen.has(f)) : []);
async function nextPrompt(task) {
  for (let i = 0; i < 100; i++) {
    const files = pending();
    if (files.length) {
      const f = files.sort()[0];
      seen.add(f);
      assert.ok(f.includes(`-${task}-`), `expected a ${task} request next, got ${f}`);
      return { id: f.replace('.prompt.md', ''), text: fs.readFileSync(path.join(inbox, f), 'utf8') };
    }
    await sleep(40);
  }
  throw new Error(`no ${task} prompt`);
}
const reply = (id, data) => fs.writeFileSync(path.join(inbox, `${id}.response.json`), typeof data === 'string' ? data : JSON.stringify(data));
async function until(fn) { for (let i = 0; i < 150; i++) { if (fn()) return; await sleep(40); } throw new Error('timed out'); }

const BIBLE = [
  '# The Bells of Aurelion',
  '## Overview & Tone',
  'Aurelion is a river kingdom where every town keeps a great bell, and the bells keep the night-things away.',
  '## Factions',
  '- **The Chime Guild**: bell-founders who answer to no lord',
  '- **The Lamplighters**: watchmen who walk the streets at dusk',
  '## Notable NPCs',
  '- **Merriwen Ashdown**, the cheerful ferry-keeper who knows every rumour',
  '## Tone & Content Boundaries',
  'No harm to children on screen. Romance fades to black.',
].join('\n');
const SECRETS = 'Merriwen is secretly the Lantern Queen in disguise.';
const BACKBONE = '## The Villain\nThe Lantern Queen wants every bell silenced.';
const ARC = 'Act 1: the Quiet Town. Next beat: the Hollow Bell cracks.';
const NOTE = 'Remember the smugglers under the mill.';

const opening = (text) => ({
  narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text }] }], npcs: [], rollRequests: [], effects: [],
  scene: { location: '', timeOfDay: '', weather: '', mood: '', areaMapId: '', areaLocationId: '', clearBattleMap: false },
  areaMaps: [], sceneMap: [], combatStart: [], quests: [], handouts: [], clarify: [], ruling: '', dmNotes: '', summary: 'The heroes met at the ferry.', waitFor: [], combatAction: [],
});

function table(name) {
  const c = C.newCampaign({ id: 'u_host' }, { name });
  Object.assign(c.world, { title: 'Bells of Aurelion', tagline: 'The bells are going quiet.', bible: BIBLE, secrets: SECRETS, backbone: BACKBONE, arc: ARC, openingHook: 'The Dawn Bell fell silent last night.', dmNotes: [NOTE] });
  c.status = 'ready';
  c.scene.location = 'Ferrytown';
  c.maps.area.ferrytown = { id: 'ferrytown', style: 'town', name: 'Ferrytown', description: 'A ferry town on the Aure.', locations: [
    { id: 'bell-tower', name: 'The Dawn Bell Tower', kind: 'tower', x: 0.5, y: 0.5, description: 'The tallest thing in town.', secret: false },
    { id: 'smugglers-den', name: 'The Drowned Cellar', kind: 'cave', x: 0.2, y: 0.8, description: 'Where the smugglers meet.', secret: true },
  ], connections: [] };
  c.scene.areaMapId = 'ferrytown';
  c.members[0].characterId = `ch_${name}`;
  C.storeNewCharacter({ id: `ch_${name}`, ownerId: 'u_host', name: 'Yorgy', race: 'dwarf', subrace: 'hill-dwarf', class: 'cleric', background: 'acolyte', hp: { max: 10, current: 10, temp: 0 } });
  E.setOnline(c, 'u_host', `s_${name}`, true);
  return c;
}

test('the prologue writer is told to cover the world, the town and its people, and never to ask "What do you do?"', () => {
  assert.match(PROLOGUE_CORE, /history.*customs.*the town where the story begins.*the people of that town/s);
  assert.match(PROLOGUE_CORE, /Don't start the first scene and don't ask the players anything/);
  assert.match(PROLOGUE_CORE, /Never hint at hidden truths/);
});

test('session 1 reads a prologue from the world bible to everyone, then plays the first scene', async () => {
  const c = table('first');
  assert.deepEqual(E.startSession(c), { ok: true });
  assert.equal(c.phase, 'thinking', 'nobody is asked to act while the prologue is written');

  // 1. the prologue comes first, written only from player-facing material
  const p = await nextPrompt('prologue');
  for (const safe of ['Aurelion is a river kingdom', 'Chime Guild', 'Merriwen Ashdown', 'The Dawn Bell fell silent last night.', 'Ferrytown', 'The Dawn Bell Tower', 'Yorgy', 'Hill Dwarf Cleric', 'Bells of Aurelion']) {
    assert.ok(p.text.includes(safe), `the prologue writer sees ${safe}`);
  }
  for (const secret of [SECRETS, BACKBONE, ARC, NOTE, 'The Drowned Cellar', 'Where the smugglers meet', 'Lantern Queen']) {
    assert.ok(!p.text.includes(secret), `the prologue writer never sees: ${secret}`);
  }
  assert.equal(c.thinking?.task, 'prologue');
  reply(p.id, { title: 'Prologue: The Bells of Aurelion', paragraphs: ['## The kingdom\nAurelion is a river kingdom of bells.', 'In Ferrytown, the Chime Guild and the Lamplighters keep the peace, and Merriwen Ashdown keeps the ferry.\n\nLast night, the Dawn Bell fell silent.'], summary: 'The prologue told of Aurelion, its bells and Ferrytown.' });

  // 2. the prologue is posted to everyone, as plain paragraphs, before any scene
  await until(() => c.chronicle.turns.some((t) => t.kind === 'prologue'));
  const pro = c.log.find((e) => e.kind === 'narration');
  assert.equal(pro.to, 'all', 'everyone hears the prologue');
  assert.deepEqual(pro.parts.map((x) => x.speaker), ['narrator', 'narrator', 'narrator']);
  assert.equal(pro.parts[0].text, 'Aurelion is a river kingdom of bells.', 'no headings read out');
  assert.equal(pro.parts[2].text, 'Last night, the Dawn Bell fell silent.');
  assert.ok(c.log.some((e) => e.kind === 'system' && e.text === '📜 Prologue: The Bells of Aurelion'));
  assert.notEqual(c.phase, 'actions', 'still no "What do you do?" after the prologue');

  // 3. then the first scene, which knows the prologue was read and doesn't retell it
  const t = await nextPrompt('turn');
  assert.match(t.text, /The PROLOGUE \(the latest turn\) has just been read aloud to the whole table.*Don't retell any of it/s);
  assert.match(t.text, /## Turn 1 \(prologue\)/);
  reply(t.id, opening('Mist curls off the Aure as the ferry bumps the dock. What do you do?'));
  await until(() => c.phase === 'actions');
  const narr = c.log.filter((e) => e.kind === 'narration');
  assert.equal(narr.length, 2);
  assert.equal(narr[0].id, pro.id, 'the prologue comes before the scene');
  assert.match(narr[1].parts[0].text, /What do you do\?/);
  assert.deepEqual(c.chronicle.turns.map((x) => x.kind), ['prologue', 'opening']);
  assert.equal(c.pendingInput, null);
});

test('later sessions open with a recap, never the prologue again', async () => {
  const c = table('second');
  c.sessionNumber = 1;
  c.sessions.push({ n: 1, startedAt: 1, endedAt: 2, recap: 'The bell fell silent.', logEntry: '' });
  c.chronicle.turns.push({ n: 1, kind: 'prologue', summary: 'The prologue.' }, { n: 2, kind: 'opening', summary: 'They met.' });
  assert.deepEqual(E.startSession(c), { ok: true });
  const t = await nextPrompt('turn'); // asserts the next request is a turn, not a prologue
  assert.match(t.text, /A new session begins \(session 2\)/);
  reply(t.id, opening('Previously...'));
  await until(() => c.phase === 'actions');
  assert.equal(c.chronicle.turns.filter((x) => x.kind === 'prologue').length, 1);
  assert.equal(pending().length, 0, 'no prologue was asked for');
});

test('no usable prologue from the DM: the world bible itself is read out, table notes left on the page', async () => {
  const c = table('fallback');
  E.startSession(c);
  const p = await nextPrompt('prologue');
  reply(p.id, { title: '', paragraphs: [], summary: '' });
  await until(() => c.chronicle.turns.some((t) => t.kind === 'prologue'));
  const pro = c.log.find((e) => e.kind === 'narration');
  const text = pro.parts.map((x) => x.text);
  assert.deepEqual(text, [
    'Aurelion is a river kingdom where every town keeps a great bell, and the bells keep the night-things away.',
    '**The Chime Guild**: bell-founders who answer to no lord. **The Lamplighters**: watchmen who walk the streets at dusk.',
    '**Merriwen Ashdown**, the cheerful ferry-keeper who knows every rumour.',
    'The Dawn Bell fell silent last night.',
  ]);
  assert.ok(!text.join(' ').includes('fades to black'), 'the table\'s content boundaries are not read as lore');
  const t = await nextPrompt('turn');
  reply(t.id, opening('The ferry docks.'));
  await until(() => c.phase === 'actions');
});

test('a failed opening scene is retried without reading the prologue twice; one cut off by a restart is read first', async () => {
  const c = table('retry');
  E.startSession(c);
  reply((await nextPrompt('prologue')).id, { title: 'Bells', paragraphs: ['Aurelion is a river kingdom of bells.'], summary: 'Aurelion.' });
  const t = await nextPrompt('turn');
  reply(t.id, 'not json at all');
  await until(() => c.phase === 'failed');
  assert.deepEqual(E.retryTurn(c), { ok: true });
  const again = await nextPrompt('turn');
  assert.match(again.text, /The PROLOGUE \(the latest turn\) has just been read aloud/);
  reply(again.id, opening('The ferry docks.'));
  await until(() => c.phase === 'actions');
  assert.equal(c.log.filter((e) => e.kind === 'narration').length, 2, 'one prologue, one scene');

  // the server restarted while the prologue was being written: "Try again" writes it, then plays the scene
  const r = table('restart');
  r.sessionActive = true;
  r.sessionNumber = 1;
  r.phase = 'failed';
  r.pendingInput = { kind: 'opening', text: '' };
  assert.deepEqual(E.retryTurn(r), { ok: true });
  reply((await nextPrompt('prologue')).id, { title: 'Bells', paragraphs: ['Aurelion is a river kingdom of bells.'], summary: 'Aurelion.' });
  reply((await nextPrompt('turn')).id, opening('The ferry docks.'));
  await until(() => r.phase === 'actions');
  assert.deepEqual(r.chronicle.turns.map((x) => x.kind), ['prologue', 'opening']);
});

test('a campaign without a world bible goes straight to the first scene', async () => {
  const c = table('blank');
  c.world.bible = '';
  E.startSession(c);
  assert.equal(c.thinking?.task, 'turn', 'the scene is asked for at once');
  reply((await nextPrompt('turn')).id, opening('The ferry docks.'));
  await until(() => c.phase === 'actions');
  assert.ok(!c.chronicle.turns.some((t) => t.kind === 'prologue'));
});

test('the prologue prompt is bounded and asks for a shorter telling in a one-shot', () => {
  const c = table('length');
  assert.match(prologuePrompt(c), /About 600-900 words/);
  c.settings.shape = 'one-shot';
  assert.match(prologuePrompt(c), /About 300-500 words/);
});
