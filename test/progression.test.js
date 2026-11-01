// Retiring and replacing characters, joining at the party's level, experience from quests, and the DM-only effects
// that change stats (coins with change, Inspiration, Hit Dice, milestones).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-progress-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { srd } = await import('../server/srd.js');
const { buildCharacter, levelUpOptions, levelUpPlan, multiclassProblems } = await import('../shared/charbuild.js');
const { xpForLevel } = await import('../shared/rules.js');

let n = 0;
function hero(ownerId, choices) {
  const ch = buildCharacter({ name: `Hero${++n}`, race: 'human', class: 'fighter', ...choices }, srd());
  return C.storeNewCharacter({ ...ch, id: `ch_${n}`, ownerId, xp: choices.xp ?? xpForLevel(choices.level || 1), currency: { cp: 0, sp: 0, ep: 0, gp: 10, pp: 0 } });
}

function setup(levels = [3, 3, 2]) {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Progress table' });
  const ids = ['u_a', 'u_b', 'u_c'];
  levels.forEach((lvl, i) => {
    const ch = hero(ids[i], { level: lvl });
    if (i === 0) c.members[0].characterId = ch.id;
    else c.members.push({ userId: ids[i], role: 'player', joinedAt: Date.now(), characterId: ch.id });
  });
  return c;
}
const charOf = (c, uid) => C.getCharacter(C.member(c, uid).characterId);

test('a new character joins at the level most of the party has, with matching experience', () => {
  const c = setup([3, 3, 2]);
  assert.equal(E.joinLevel(c), 3);
  charOf(c, 'u_a').xp = 1500; charOf(c, 'u_b').xp = 1200;
  assert.equal(E.joinXp(c, 3), 1200);
  assert.equal(E.joinLevel(setup([2, 4])), 4, 'ties go to the higher level');
  const fresh = C.newCampaign({ id: 'u_z' }, { name: 'Empty', settings: { startLevel: 2 } });
  fresh.settings.startLevel = 2;
  assert.equal(E.joinLevel(fresh), 2, 'no party yet: the campaign starting level');
});

test('retiring takes the hero out of play but keeps their story, and the next session waits for the new one', () => {
  const c = setup();
  const old = charOf(c, 'u_c');
  E.addToken(c, { kind: 'pc', characterId: old.id, name: old.name, x: 1, y: 1 });
  const r = E.retireCharacter(c, old, 'u_c', 'Gone home to the hills.');
  assert.deepEqual(r, { ok: true });
  assert.equal(C.member(c, 'u_c').characterId, null);
  assert.equal(C.member(c, 'u_c').rebuilding, true);
  assert.deepEqual(C.member(c, 'u_c').pastCharacters, [old.id]);
  assert.equal(C.getCharacter(old.id).retired.reason, 'retired');
  assert.equal(Object.values(c.tokens).some((t) => t.characterId === old.id), false);
  assert.ok(!E.requiredUsers(c).includes('u_c'));
  assert.ok(c.world.dmNotes.at(-1).includes('RETIRED'));
  assert.ok(c.log.some((e) => /retires from the party/.test(e.text)));
  for (const u of ['u_a', 'u_b', 'u_c']) E.setOnline(c, u, `s_${u}`, true);
  assert.match(E.startSession(c).error, /finish making a new character/);
  assert.match(E.retireCharacter(c, old, 'u_c').error, /isn't your character|already retired/);
});

test('a living hero cannot retire mid-fight; a fallen one can', () => {
  const c = setup();
  c.combat = { combatants: {} };
  const ch = charOf(c, 'u_b');
  assert.match(E.retireCharacter(c, ch, 'u_b').error, /Finish the fight/);
  ch.dead = true;
  C.saveCharacter(ch);
  assert.deepEqual(E.retireCharacter(c, ch, 'u_b'), { ok: true });
  assert.equal(C.getCharacter(ch.id).retired.reason, 'died');
});

test('a dead hero cannot act and the round does not wait for them', () => {
  const c = setup();
  const ch = charOf(c, 'u_c');
  ch.dead = true;
  C.saveCharacter(ch);
  assert.ok(!E.actingUsers(c).includes('u_c'));
  c.phase = 'actions';
  assert.match(E.submitAction(c, 'u_c', { text: 'I get up' }).error, /has died/);
});

test('dying posts a private note telling the player to retire and rebuild', () => {
  const c = setup();
  const ch = charOf(c, 'u_b');
  E.applyDamageToCharacter(c, ch, 999);
  assert.equal(ch.dead, true);
  const note = c.log.find((e) => Array.isArray(e.to) && e.to.includes('u_b') && /retire/.test(e.text));
  assert.ok(note);
});

test('completing a quest gives everyone experience, once', () => {
  const c = setup([1, 1, 1]);
  c.members.forEach((m) => { const ch = C.getCharacter(m.characterId); ch.xp = 0; C.saveCharacter(ch); });
  E.upsertQuest(c, { title: 'Save the Bell', status: 'active' });
  E.upsertQuest(c, { title: 'Save the Bell', status: 'completed', xp: 0 });
  const std = E.standardQuestXp(c);
  assert.equal(std, 75, 'a quarter of level 1 to 2');
  assert.equal(charOf(c, 'u_a').xp, std);
  E.upsertQuest(c, { title: 'Save the Bell', status: 'active' });
  E.upsertQuest(c, { title: 'Save the Bell', status: 'completed' });
  assert.equal(charOf(c, 'u_a').xp, std, 'no second award');
  E.upsertQuest(c, { title: 'Find the heart', status: 'completed', xp: 300 });
  assert.equal(charOf(c, 'u_b').xp, std + 300);
  assert.equal(charOf(c, 'u_b').pendingLevelUp, true);
});

test('a milestone level-up moves experience to the next level', () => {
  const c = setup([2, 2, 2]);
  const ch = charOf(c, 'u_a');
  E.applyEffects(c, [{ type: 'level_up', target: ch.id }]);
  assert.equal(charOf(c, 'u_a').xp, xpForLevel(3));
  assert.equal(charOf(c, 'u_a').pendingLevelUp, true);
});

test('coins: spending pays with change, and you cannot spend what you do not have', () => {
  const purse = { pp: 0, gp: 1, ep: 0, sp: 0, cp: 0 };
  assert.equal(E.payCoins(purse, 35), true);
  assert.deepEqual(purse, { pp: 0, gp: 0, ep: 0, sp: 6, cp: 5 });
  assert.equal(E.payCoins(purse, 1000), false);
  assert.deepEqual(purse, { pp: 0, gp: 0, ep: 0, sp: 6, cp: 5 });
  const c = setup();
  const ch = charOf(c, 'u_a');
  E.applyEffects(c, [{ type: 'gold', target: ch.id, amount: -3, text: 'sp' }]);
  assert.deepEqual(charOf(c, 'u_a').currency, { cp: 0, sp: 7, ep: 0, gp: 9, pp: 0 });
  E.applyEffects(c, [{ type: 'gold', target: ch.id, amount: -50 }]);
  assert.equal(charOf(c, 'u_a').currency.gp, 9);
  assert.ok(c.log.some((e) => /can't afford/.test(e.text)));
});

test('Inspiration: the DM gives it and takes it when used', () => {
  const c = setup();
  const ch = charOf(c, 'u_a');
  E.applyEffects(c, [{ type: 'inspiration', target: ch.id, amount: 1 }]);
  assert.equal(charOf(c, 'u_a').inspiration, true);
  E.applyEffects(c, [{ type: 'inspiration', target: ch.id, amount: -1 }]);
  assert.equal(charOf(c, 'u_a').inspiration, false);
});

test('Hit Dice spent in a short rest heal and are used up', () => {
  const c = setup();
  const ch = charOf(c, 'u_a');
  ch.hp.current = 1;
  C.saveCharacter(ch);
  E.applyEffects(c, [{ type: 'hit_dice', target: ch.id, amount: 2 }]);
  assert.equal(charOf(c, 'u_a').hitDice.used, 2);
  assert.ok(charOf(c, 'u_a').hp.current > 1);
});

test('a limited-use ability can be named by its name or key', () => {
  const c = setup([2, 2, 2]);
  const ch = charOf(c, 'u_a');
  E.applyEffects(c, [{ type: 'spend_resource', target: ch.id, text: 'Second Wind', amount: 1 }]);
  assert.equal(charOf(c, 'u_a').resources.secondWind.used, 1);
});

test('level-up choices list your classes first, then every class you could multiclass into', () => {
  const ch = buildCharacter({ race: 'human', class: 'fighter', level: 2, baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } }, srd());
  const opts = levelUpOptions(ch, srd());
  assert.equal(opts[0].classKey, 'fighter');
  assert.equal(opts[0].next, 3);
  assert.equal(opts[0].multiclass, false);
  const rogue = opts.find((o) => o.classKey === 'rogue');
  assert.equal(rogue.multiclass, true);
  assert.equal(rogue.allowed, true, 'Dex 13+ (human +1) meets the rogue requirement');
  const wizard = opts.find((o) => o.classKey === 'wizard');
  assert.equal(wizard.allowed, false);
  assert.match(wizard.problems[0], /Intelligence 13/);
  assert.deepEqual(multiclassProblems(ch, srd(), 'fighter'), []);
  assert.equal(levelUpPlan(ch, srd(), 'rogue').multiclassSkills.choose, 1);
});
