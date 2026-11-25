// A roll the DM asks for is made with advantage, disadvantage or normally as the DM (and the character's conditions)
// decide: the player sees which, and nothing they send can change it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-adv-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { buildView } = await import('../server/game/views.js');

let n = 0;
function setup(conditions = []) {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Adv ${++n}` });
  const id = `ch_adv_${n}`;
  C.storeNewCharacter({ id, ownerId: 'u_a', name: 'Tamsin', hp: { max: 10, current: 10, temp: 0 }, conditions });
  c.members[0].characterId = id;
  E.setOnline(c, 'u_a', `s_adv_${n}`, true);
  c.sessionActive = true;
  c.phase = 'rolls';
  return { c, id };
}
function ask(c, id, advantage) {
  const req = E.makeRollRequest(c, { characterId: id, kind: 'skill', key: 'stealth', dc: 12, advantage, reason: 'Slip past the guard' }, 'turn');
  c.round.rollRequests = [req];
  return req;
}

test('the roll card shows the mode the DM asked for', () => {
  for (const mode of ['adv', 'dis', 'none']) {
    const { c, id } = setup();
    ask(c, id, mode);
    const card = buildView(c, 'u_a').rolls.mine[0];
    assert.equal(card.advantage, mode);
    assert.equal(card.mode, mode);
    assert.deepEqual(card.modeWhy, []);
  }
});

test('a player cannot change a DM-requested roll to advantage (or anything else)', () => {
  // disadvantage asked: the client asks for advantage; the server rolls two and keeps the lower anyway
  const { c, id } = setup();
  const req = ask(c, id, 'dis');
  const r = E.respondRoll(c, 'u_a', req.id, { mode: 'auto', advantage: 'adv' });
  assert.ok(r.ok);
  assert.equal(r.result.advantage, 'dis');
  const d20 = r.result.terms[0];
  assert.equal(d20.rolls.length, 2);
  assert.equal(d20.kept[0], Math.min(...d20.rolls));
  assert.equal(c.log.filter((e) => e.kind === 'dice').at(-1).advantage, 'dis');

  // a normal roll stays one d20 however often the client asks
  for (let i = 0; i < 20; i++) {
    const s = setup();
    const q = ask(s.c, s.id, 'none');
    const res = E.respondRoll(s.c, 'u_a', q.id, { mode: 'auto', advantage: 'adv' });
    assert.equal(res.result.advantage, 'none');
    assert.equal(res.result.terms[0].rolls.length, 1);
  }
});

test("the character's conditions are part of the mode, and the card says why", () => {
  const { c, id } = setup(['poisoned']);
  ask(c, id, 'none');
  const card = buildView(c, 'u_a').rolls.mine[0];
  assert.equal(card.mode, 'dis');
  assert.deepEqual(card.modeWhy, ['poisoned']);

  // advantage from the DM and disadvantage from being poisoned cancel out
  const s = setup(['poisoned']);
  ask(s.c, s.id, 'adv');
  const both = buildView(s.c, 'u_a').rolls.mine[0];
  assert.equal(both.advantage, 'adv');
  assert.equal(both.mode, 'none');
  const req = s.c.round.rollRequests[0];
  assert.equal(E.respondRoll(s.c, 'u_a', req.id, { mode: 'auto', advantage: 'adv' }).result.advantage, 'none');
});

test('rollAdvantage: death saves and plain dice never get advantage', () => {
  assert.equal(E.rollAdvantage({ conditions: ['poisoned'] }, 'death', null, 'adv').mode, 'none');
  assert.equal(E.rollAdvantage({}, 'custom', '1d4', 'adv').mode, 'none');
  assert.deepEqual(E.rollAdvantage({ exhaustion: 3 }, 'save', 'con', 'none'), { mode: 'dis', why: ['exhaustion'] });
  assert.deepEqual(E.rollAdvantage({ conditions: ['restrained'] }, 'save', 'dex', 'none'), { mode: 'dis', why: ['restrained'] });
});
