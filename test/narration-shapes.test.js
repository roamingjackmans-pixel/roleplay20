// A story turn's reply is written from a schema in the prompt (the API can't enforce one that large), and models differ
// in how strictly they follow it: after switching the DM from Opus to Sonnet, a reply came back with a narration
// segment's "parts" as one object instead of a list, and the turn failed with "(seg.parts || []).filter is not a
// function". Replies are now bent into their schema's lists, and narration in any of those shapes is still told.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-narration-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'file';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { conformToSchema, askClaude } = await import('../server/ai/client.js');
const { TURN_SCHEMA } = await import('../server/ai/schemas.js');

function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Shapes' });
  C.storeNewCharacter({ id: 'ch_a', ownerId: 'u_a', name: 'Yorgy Ironbrow', hp: { max: 10, current: 10, temp: 0 }, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  c.members[0].characterId = 'ch_a';
  c.npcs.npc_oswin = { id: 'npc_oswin', name: 'Oswin Pell' };
  return c;
}
const told = (c, from) => c.log.slice(from).filter((e) => e.kind === 'narration').map((e) => e.parts.map((p) => p.text).join(' | '));

test('lone items become lists of one, at every depth, and null lists become empty', () => {
  const data = conformToSchema({
    narration: { to: 'all', parts: { speaker: 'narrator', text: 'Rain on the roof.' } },
    npcs: null,
    effects: '',
    summary: 'It rained.',
  }, TURN_SCHEMA);
  assert.deepEqual(data.narration, [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Rain on the roof.' }] }]);
  assert.deepEqual(data.npcs, []);
  assert.deepEqual(data.effects, []);
  assert.equal(data.summary, 'It rained.', 'strings stay as they are');
  assert.equal(conformToSchema(undefined, TURN_SCHEMA), undefined);
});

test('a well-formed reply comes through unchanged', () => {
  const reply = { narration: [{ to: ['all'], parts: [{ speaker: 'npc_oswin', text: 'Go on.' }] }], npcs: [], summary: 'x' };
  assert.deepEqual(conformToSchema(reply, TURN_SCHEMA), reply);
});

test('narration in any shape the model writes is still told, never a crash', () => {
  const c = setup();
  const from = c.log.length;
  E.applyTurnResult(c, {
    narration: [
      { to: ['all'], parts: { speaker: 'narrator', text: 'One part, not a list.' } },
      { to: ['all'], parts: 'Parts as a bare string.' },
      { to: ['all'], speaker: 'npc_oswin', text: 'A segment with no parts.' },
      'A plain string segment.',
      { to: ['all'], parts: [{ speaker: 'narrator', text: '   ' }, null, 'A string part.'] },
      { to: ['all'], parts: [] },
      null,
    ],
  }, { kind: 'actions' });
  assert.deepEqual(told(c, from), ['One part, not a list.', 'Parts as a bare string.', 'A segment with no parts.', 'A plain string segment.', 'A string part.']);
  const oswin = c.log.slice(from).find((e) => e.parts?.[0]?.speaker === 'npc_oswin');
  assert.equal(oswin.parts[0].speakerName, 'Oswin Pell');
  assert.equal(c.chronicle.turns.at(-1).narration.length, 5, 'the DM remembers all of it next turn');
});

test('a whole segment on its own, not in a list, is told too', () => {
  const c = setup();
  const from = c.log.length;
  E.applyTurnResult(c, { narration: { to: ['all'], parts: [{ speaker: 'narrator', text: 'Just the one.' }] } }, { kind: 'actions' });
  assert.deepEqual(told(c, from), ['Just the one.']);
});

test('askClaude hands back a reply already in its schema’s lists', async () => {
  const dir = path.join(process.env.DATA_DIR, 'ai-inbox');
  const answer = (async () => {
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 50));
      const req = fs.existsSync(dir) && fs.readdirSync(dir).find((f) => f.endsWith('.request.json'));
      if (req) {
        const body = { narration: [{ to: ['all'], parts: { speaker: 'narrator', text: 'Sonnet-shaped.' } }], npcs: null, summary: 's' };
        fs.writeFileSync(path.join(dir, req.replace('.request.json', '.response.json')), JSON.stringify(body));
        return;
      }
    }
  })();
  const res = await askClaude({ task: 'turn', system: 'sys', prompt: 'go', schema: TURN_SCHEMA });
  await answer;
  assert.deepEqual(res.data.narration[0].parts, [{ speaker: 'narrator', text: 'Sonnet-shaped.' }]);
  assert.deepEqual(res.data.npcs, []);
});
