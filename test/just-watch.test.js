// "Just watch": a player can ready up for a round without doing anything. The round goes ahead as soon as everyone is
// ready; the DM is told who is only watching (no action, nothing asked of them), and a round where the whole table
// watches lets the scene move on by itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-watch-'));
process.env.DATA_DIR = dir;
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'file';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { buildView } = await import('../server/game/views.js');
const { actionsSinceRoll } = await import('../server/game/context.js');

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

let n = 0;
function table() {
  n++;
  const c = C.newCampaign({ id: `u_host${n}` }, { name: `Watch table ${n}` });
  c.members[0].characterId = `ch_a${n}`;
  c.members.push({ userId: `u_two${n}`, role: 'player', joinedAt: Date.now(), characterId: `ch_b${n}` });
  C.storeNewCharacter({ id: `ch_a${n}`, ownerId: `u_host${n}`, name: 'Alfa', hp: { max: 10, current: 10, temp: 0 } });
  C.storeNewCharacter({ id: `ch_b${n}`, ownerId: `u_two${n}`, name: 'Bravo', hp: { max: 10, current: 10, temp: 0 } });
  c.sessionActive = true;
  E.openActions(c);
  E.setOnline(c, `u_host${n}`, 's1', true);
  E.setOnline(c, `u_two${n}`, 's2', true);
  return { c, host: `u_host${n}`, two: `u_two${n}`, a: `ch_a${n}`, b: `ch_b${n}` };
}

test('ticking "Just watch" readies a player without an action, and the others see they are watching', () => {
  const { c, host, two } = table();
  assert.deepEqual(E.submitAction(c, two, { watch: true }), { ok: true });
  assert.equal(c.phase, 'actions', 'the round still waits for the host');
  const v = buildView(c, host);
  const bravo = v.members.find((m) => m.userId === two);
  assert.equal(bravo.submitted, true);
  assert.equal(bravo.watching, true);
  assert.equal(v.round.submittedCount, 1);
  assert.equal(buildView(c, two).round.myAction.watch, true);
  // unticking it takes it back, like changing an action
  E.withdrawAction(c, two);
  assert.equal(buildView(c, host).members.find((m) => m.userId === two).submitted, false);
});

test('the DM is told who is just watching, and the watcher gets no action card or question', async () => {
  const { c, host, two, a, b } = table();
  E.submitAction(c, two, { watch: true });
  E.submitAction(c, host, { text: 'I knock on the cellar door.' });
  const p = await nextPrompt();
  assert.match(p.text, /Alfa \(ch_a\d+\): I knock on the cellar door\./);
  assert.match(p.text, new RegExp(`Bravo \\(${b}\\) is just watching this round`));
  assert.doesNotMatch(p.text, /Bravo \(ch_b\d+\): /, 'no declared action for the watcher');
  assert.deepEqual(c.log.filter((e) => e.kind === 'action').map((e) => e.name), ['Alfa']);
  // the DM tries to ask the watcher something anyway: there is nothing to revise, so the round resolves instead
  reply(p.id, { clarify: [{ characterId: b, message: 'What does Bravo do?' }] });
  const p2 = await nextPrompt();
  assert.match(p2.text, /Do not use "clarify"/);
  reply(p2.id, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'The door creaks open.' }] }], summary: 'Alfa opens the cellar.' });
  await until(() => c.phase === 'actions' && c.chronicle.turns.length);
  const turn = c.chronicle.turns.at(-1);
  assert.deepEqual(turn.actions.map((x) => [x.name, x.text, !!x.watch]), [['Alfa', 'I knock on the cellar door.', false], ['Bravo', E.WATCH_TEXT, true]]);
  c.chronicle.turns.unshift({ n: 0, actions: [], rolls: [`Alfa (${a}) Perception 12`, `Bravo (${b}) Perception 9`] }); // both last rolled before this round
  assert.equal(actionsSinceRoll(c, { id: b, name: 'Bravo' }), 0, 'watching is not an action for roll pacing');
  assert.equal(actionsSinceRoll(c, { id: a, name: 'Alfa' }), 1);
});

test('when the whole table watches, the scene moves on by itself', async () => {
  const { c, host, two } = table();
  E.submitAction(c, host, { watch: true });
  E.submitAction(c, two, { watch: true });
  const p = await nextPrompt();
  assert.match(p.text, /Nobody declares an action this round: the whole table is just watching/);
  assert.match(p.text, /Alfa \(ch_a\d+\) and Bravo \(ch_b\d+\) are just watching/);
  reply(p.id, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Night falls over the square.' }] }] });
  await until(() => c.phase === 'actions' && c.log.some((e) => e.kind === 'narration'));
});

test('a watcher kept waiting while the DM asks someone else stays a watcher', async () => {
  const { c, host, two, a } = table();
  E.submitAction(c, two, { watch: true });
  E.submitAction(c, host, { text: 'I attack all three goblins and run to the door.' });
  const p = await nextPrompt();
  reply(p.id, { clarify: [{ characterId: a, message: 'One attack and 30 ft. Which goblin?' }] });
  await until(() => c.round.revise?.[host]);
  assert.equal(c.round.actions[two].watch, true);
  E.submitAction(c, host, { text: 'I attack the nearest goblin.' });
  const p2 = await nextPrompt();
  assert.match(p2.text, /Bravo \(ch_b\d+\) is just watching/);
  reply(p2.id, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Steel rings.' }] }] });
  await until(() => c.phase === 'actions' && c.chronicle.turns.length);
});
