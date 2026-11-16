// The story always shows a speaker's name, never an internal id: a player character's quoted line shows the
// character's name (the DM gave it their id), and an id nobody knows becomes a tidy name or "Someone".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-speakers-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { historyBlock } = await import('../server/game/context.js');
const { speakerLabel, tidyName } = await import('../client/src/lib/speakers.js');

function setup() {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Speakers' });
  C.storeNewCharacter({ id: 'ch_j3x2h2ai', ownerId: 'u_a', name: 'Yorgy Ironbrow', color: '#c06040', hp: { max: 10, current: 10, temp: 0 }, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 } });
  c.members[0].characterId = 'ch_j3x2h2ai';
  c.npcs.npc_oswin = { id: 'npc_oswin', name: 'Oswin Pell' };
  return c;
}
const say = (c, speaker, text) => { E.applyTurnResult(c, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'You roar up at the rib:' }, { speaker, text }] }] }, { kind: 'actions' }); return c.log.at(-1).parts[1]; };

test("a player character's line shows their name, not their id", () => {
  const c = setup();
  const p = say(c, 'ch_j3x2h2ai', 'We are here to protect them!');
  assert.equal(p.speaker, 'pc:ch_j3x2h2ai');
  assert.equal(p.speakerName, 'Yorgy Ironbrow');
  assert.equal(p.color, '#c06040');
  assert.equal(say(c, 'Yorgy', 'Again!').speakerName, 'Yorgy Ironbrow', 'by first name too');
  assert.match(historyBlock(c), /Yorgy Ironbrow: "We are here to protect them!"/, 'the DM sees the name in its history');
});

test('NPCs by id or name, and ids nobody knows never show raw', () => {
  const c = setup();
  assert.equal(say(c, 'npc_oswin', 'Go on.').speakerName, 'Oswin Pell');
  assert.equal(say(c, 'Oswin Pell', 'Go on.').speaker, 'npc_oswin');
  assert.equal(say(c, 'npc_old_marta', 'Hush.').speakerName, 'Old Marta');
  assert.equal(say(c, 'ch_zz9k2', 'Who?').speakerName, 'Someone');
  assert.equal(say(c, 'A Fisherman', 'Ahoy!').speakerName, 'A Fisherman');
});

test('the story shows names for lines already saved with a raw id', () => {
  const view = { voices: { npc_oswin: { name: 'Oswin Pell', color: '#557' } }, party: [{ id: 'ch_j3x2h2ai', name: 'Yorgy Ironbrow', color: '#c06040' }] };
  assert.equal(speakerLabel({ speaker: 'ch_j3x2h2ai', speakerName: 'ch_j3x2h2ai' }, view).name, 'Yorgy Ironbrow', 'the old way (from the screenshot)');
  assert.equal(speakerLabel({ speaker: 'pc:ch_j3x2h2ai', speakerName: 'Yorgy Ironbrow' }, view).name, 'Yorgy Ironbrow');
  assert.equal(speakerLabel({ speaker: 'npc_oswin' }, view).name, 'Oswin Pell');
  assert.equal(speakerLabel({ speaker: 'ch_gone123', speakerName: 'ch_gone123' }, view).name, 'Someone', 'a retired character');
  assert.equal(speakerLabel({ speaker: 'creature:wolf', speakerName: 'Grey Wolf' }, view).name, 'Grey Wolf');
  assert.equal(tidyName('npc_harbour_master'), 'Harbour Master');
  assert.equal(tidyName(''), 'Someone');
});
