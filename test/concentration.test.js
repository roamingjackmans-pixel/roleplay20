// Concentration spells end when their time runs out: combat rounds (6 seconds), story turns out of a fight (about a
// minute) and short rests (an hour) use up the clock. They also end between sessions, when the DM says so, and when the
// player ends them from the sheet. Before this, Bless lasted until the next long rest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-conc-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const K = await import('../server/game/combat.js');
const { partyBlock } = await import('../server/game/context.js');
const { srd } = await import('../server/srd.js');
const { concentrationMinutes, concentrationLeft, timeLeftText } = await import('../shared/concentration.js');

const spell = (i) => srd().by.spells.get(i);
let n = 0;
function table() {
  n++;
  const c = C.newCampaign({ id: `u_${n}` }, { name: `Concentration ${n}` });
  const ch = C.storeNewCharacter({ id: `ch_${n}`, ownerId: `u_${n}`, name: 'Mira', hp: { max: 20, current: 20, temp: 0 }, abilities: { str: 10, dex: 10, con: 12, int: 10, wis: 16, cha: 10 } });
  c.members[0].characterId = ch.id;
  c.sessionActive = true;
  E.setOnline(c, `u_${n}`, `s_${n}`, true);
  E.openActions(c);
  return { c, ch: C.getCharacter(ch.id) };
}
const said = (c) => c.log.filter((e) => e.kind === 'system').map((e) => e.text).join('\n');
const quiet = { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Time passes.' }] }] };

test('durations come from the spell', () => {
  assert.equal(concentrationMinutes(spell('bless')), 1);
  assert.equal(concentrationMinutes(spell('detect-magic')), 10);
  assert.equal(concentrationMinutes(spell('hunters-mark')), 60);
  assert.equal(concentrationMinutes({ duration: 'Up to 1 round' }), 0.1);
  assert.equal(concentrationMinutes({ duration: 'Up to 24 hours' }), 1440);
  assert.equal(concentrationMinutes({ duration: 'Instantaneous' }), 60, 'unknown: an hour');
  assert.equal(timeLeftText(0.7), 'about 7 rounds left');
  assert.equal(timeLeftText(9), 'about 9 minutes left');
  assert.equal(timeLeftText(120), 'about 2 hours left');
});

test('a 1-minute spell lasts 10 combat rounds, then ends on its own', () => {
  const { c, ch } = table();
  K.startConcentration(c, ch, spell('bless'));
  for (let i = 0; i < 9; i++) K.passTime(c, 0.1);
  assert.equal(C.getCharacter(ch.id).concentration, 'bless', 'still going after 9 rounds');
  assert.equal(concentrationLeft(C.getCharacter(ch.id), spell('bless')), 0.1);
  K.passTime(c, 0.1);
  assert.equal(C.getCharacter(ch.id).concentration, null);
  assert.match(said(c), /Mira's Bless ends: its time is up/);
});

test('out of a fight, each story turn is about a minute, but not while the table waits on dice', () => {
  const { c, ch } = table();
  K.startConcentration(c, ch, spell('guidance'));
  E.applyTurnResult(c, { ...quiet, rollRequests: [{ characterId: ch.id, kind: 'skill', key: 'investigation', dc: 12, reason: 'Search the desk' }] }, { kind: 'actions' });
  assert.equal(c.phase, 'rolls');
  assert.equal(C.getCharacter(ch.id).concentration, 'guidance', 'Guidance is still there for the roll it was cast for');
  c.phase = 'thinking';
  E.applyTurnResult(c, quiet, { kind: 'rolls' });
  assert.equal(C.getCharacter(ch.id).concentration, null, 'the scene moved on: a minute has passed');

  K.startConcentration(c, ch, spell('detect-magic'));
  for (let i = 0; i < 9; i++) E.applyTurnResult(c, quiet, { kind: 'actions' });
  assert.equal(C.getCharacter(ch.id).concentration, 'detect-magic', '9 of 10 minutes');
  assert.match(partyBlock(c, new Set()), /concentrating on Detect Magic \(detect-magic, about 1 minute left\)/, 'the DM sees what is left');
  E.applyTurnResult(c, quiet, { kind: 'actions' });
  assert.equal(C.getCharacter(ch.id).concentration, null);
});

test('a short rest takes an hour; the DM can end it; a new session starts with none', () => {
  const { c, ch } = table();
  K.startConcentration(c, ch, spell('hunters-mark'));
  E.applyEffects(c, [{ type: 'rest_short', target: 'party' }]);
  assert.equal(C.getCharacter(ch.id).concentration, null, "Hunter's Mark lasts an hour");

  K.startConcentration(c, ch, spell('hunters-mark'));
  E.applyEffects(c, [{ type: 'end_concentration', target: ch.id }]);
  assert.equal(C.getCharacter(ch.id).concentration, null);
  assert.match(said(c), /Mira stops concentrating: Hunter's Mark ends/);

  K.startConcentration(c, ch, spell('hunters-mark'));
  c.sessionActive = false;
  const before = c.log.length;
  assert.equal(E.startSession(c).error, undefined);
  assert.equal(C.getCharacter(ch.id).concentration, null, 'left over from last time');
  assert.equal(c.log.slice(before).filter((e) => /Hunter's Mark/.test(e.text || '')).length, 0, 'quietly');
});

test('casting another concentration spell ends the first; a stuck spell from before this fix still runs out', () => {
  const { c, ch } = table();
  K.startConcentration(c, ch, spell('bless'));
  K.startConcentration(c, C.getCharacter(ch.id), spell('detect-magic'));
  assert.equal(C.getCharacter(ch.id).concentration, 'detect-magic');
  assert.match(said(c), /Mira switched concentration: Bless ends/);

  const old = C.getCharacter(ch.id);
  old.concentration = 'bless';
  delete old.concentrationTime; // saved before spells had a clock
  C.saveCharacter(old);
  E.applyTurnResult(c, quiet, { kind: 'actions' });
  assert.equal(C.getCharacter(ch.id).concentration, null);
});
