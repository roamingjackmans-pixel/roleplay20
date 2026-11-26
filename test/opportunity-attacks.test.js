// Opportunity attacks: a creature that moves itself out of the reach of a foe who can see it gives that foe one melee
// attack as it goes (with its reaction, back at the start of its next turn). A hero who walks away from a monster is
// asked first, then the monster strikes, and a blow that drops them stops them there. A monster that walks away from a
// hero waits while the player decides and rolls. Disengage avoids it, on both sides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-oa-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
process.env.RP20_OA_WAIT_MS = '300';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const K = await import('../server/game/combat.js');
const { buildView } = await import('../server/game/views.js');
const { COMBAT_CORE } = await import('../server/ai/prompts.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const HALL = [{ name: 'Hall', w: 50, h: 50, wall: 's', door: 'none' }];
let n = 0;

/** Bram (u_a) and one goblin in a bright, empty 50-foot hall; it is Bram's turn, with the goblin right next to him. */
async function fight() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Opportunity ${++n}` });
  const id = `ch_oa${n}`;
  C.storeNewCharacter({ id, ownerId: 'u_a', name: 'Bram', race: 'human', class: 'fighter', level: 1, classes: [{ class: 'fighter', subclass: null, level: 1 }], hp: { max: 40, current: 40, temp: 0 }, speed: 30, conditions: [], abilities: { str: 14, dex: 14, con: 12, int: 10, wis: 10, cha: 10 } });
  c.members[0].characterId = id;
  E.setSceneMap(c, { theme: 'temple', rooms: HALL, partyPlacement: 'center', ambient: 'bright' });
  E.setOnline(c, 'u_a', `s_oa${n}`, true);
  assert.ok(E.startSession(c).ok);
  await tick();
  E.openActions(c);
  E.applyTurnResult(c, { narration: [], combatStart: [{ enemies: [{ monster: 'goblin', count: 1 }], useCurrentMap: true }] });
  const k = c.combat;
  for (const req of k.rollRequests.filter((r) => r.purpose === 'initiative')) E.respondRoll(c, req.userId, req.id, { mode: 'manual', natural: 20 });
  const bram = Object.values(k.combatants).find((x) => x.characterId === id);
  const gob = Object.values(k.combatants).find((x) => x.kind === 'enemy');
  // (if the goblin won initiative, let its first turn play out)
  for (let i = 0; i < 100 && !(k.state === 'turn' && K.currentCombatant(c)?.id === bram.id); i++) await tick(50);
  assert.equal(K.currentCombatant(c)?.id, bram.id, "Bram's turn");
  const map = c.maps.tactical[k.mapId];
  const hall = map.regions.find((r) => r.name === 'Hall');
  const tok = c.tokens[bram.tokenId];
  const gTok = c.tokens[gob.tokenId];
  const ch = C.getCharacter(id);
  ch.hp.current = 40; ch.conditions = []; C.saveCharacter(ch);
  gob.hp.cur = gob.hp.max; gob.reacted = false;
  // the goblin in the middle of the hall, Bram just north of it
  const gx = hall.x + 3, gy = hall.y + 4;
  Object.assign(gTok, { x: gx, y: gy });
  Object.assign(tok, { x: gx, y: gy - 1 });
  const eco = k.economy[bram.id];
  Object.assign(eco, { moved: 0, action: false, interact: false, disengaged: false });
  return { c, k, bram, gob, tok, gTok, gx, gy, eco, ch };
}
const oaCards = (c) => c.log.filter((e) => e.kind === 'dice' && / \(opportunity attack\)$/.test(e.label || ''));
const finish = (c) => { if (c.combat) K.endCombatManual(c); };

test('walking out of a goblin\'s reach: you are asked first, then it strikes as you go, and only once', async () => {
  const { c, k, bram, gob, tok, gx, gy, eco } = await fight();
  // round the goblin, staying next to it: no warning, nothing happens
  const r0 = K.moveInCombat(c, 'u_a', tok, gx + 1, gy - 1);
  assert.ok(r0.ok && !r0.provokes, JSON.stringify(r0));
  assert.equal(oaCards(c).length, 0);
  Object.assign(tok, { x: gx, y: gy - 1 });
  eco.moved = 0;
  // straight away from it: asked first, nothing moves yet
  const r1 = K.moveInCombat(c, 'u_a', tok, gx + 4, gy - 1);
  assert.ok(r1.provokes, JSON.stringify(r1));
  assert.match(r1.confirm, /^Goblin.* can make an opportunity attack on you as you leave their reach\. Move anyway\? \(Take the Disengage action first/);
  assert.deepEqual([tok.x, tok.y, eco.moved], [gx, gy - 1, 0], 'nothing moved until they say yes');
  // they go anyway: the goblin strikes once, and Bram gets where he was going
  const r2 = K.moveInCombat(c, 'u_a', tok, gx + 4, gy - 1, { provoke: true });
  assert.ok(r2.ok, JSON.stringify(r2));
  const cards = oaCards(c);
  assert.equal(cards.length, 1);
  assert.match(cards[0].label, /^Scimitar vs Bram \(opportunity attack\)$/);
  assert.ok(c.log.some((e) => e.kind === 'combat' && /⚡ Bram leaves Goblin.*'s reach: opportunity attack!/.test(e.text)));
  assert.ok(k.events.some((e) => /\(opportunity attack\)/.test(e)), 'the enemy AI hears about it');
  assert.ok(gob.reacted, 'its reaction is spent');
  assert.deepEqual([tok.x, tok.y, eco.moved], [gx + 4, gy - 1, 20]);
  // back in and out again: its reaction is gone, so no warning and no second blow
  eco.moved = 0;
  assert.ok(K.moveInCombat(c, 'u_a', tok, gx + 1, gy - 1).ok);
  const r3 = K.moveInCombat(c, 'u_a', tok, gx + 2, gy - 3);
  assert.ok(r3.ok && !r3.provokes, JSON.stringify(r3));
  assert.equal(oaCards(c).length, 1);
  finish(c);
});

test('Disengage: you slip away without an opportunity attack, and the button says so', async () => {
  const { c, bram, gob, tok, gx, gy, eco } = await fight();
  assert.ok(K.takeAction(c, 'u_a', { type: 'disengage' }).ok);
  assert.ok(eco.disengaged && eco.action);
  assert.equal(K.movementInfo(c, bram).disengaged, true);
  assert.match(K.takeAction(c, 'u_a', { type: 'disengage' }).error, /already disengaged/);
  const r = K.moveInCombat(c, 'u_a', tok, gx + 4, gy - 1);
  assert.ok(r.ok && !r.provokes, JSON.stringify(r));
  assert.equal(oaCards(c).length, 0);
  assert.equal(gob.reacted, false);
  assert.ok(c.log.some((e) => /disengages: moving away provokes no opportunity attacks/.test(e.text || '')));
  finish(c);
});

test('a rogue\'s Cunning Action disengages with the bonus action, keeping the action for an attack', async () => {
  const { c, tok, gx, gy, eco, ch } = await fight();
  assert.match(K.takeAction(c, 'u_a', { type: 'disengage', bonus: true }).error, /Cunning Action/, 'a fighter can\'t');
  assert.equal(eco.bonus, false);
  ch.class = 'rogue'; ch.classes = [{ class: 'rogue', subclass: null, level: 2 }]; ch.level = 2; C.saveCharacter(ch);
  assert.ok(K.takeAction(c, 'u_a', { type: 'disengage', bonus: true }).ok);
  assert.deepEqual([eco.bonus, eco.action, eco.disengaged], [true, false, true]);
  assert.ok(c.log.some((e) => /disengages \(Cunning Action\)/.test(e.text || '')));
  const r = K.moveInCombat(c, 'u_a', tok, gx + 4, gy - 1);
  assert.ok(r.ok && !r.provokes);
  assert.equal(oaCards(c).length, 0);
  assert.match(K.takeAction(c, 'u_a', { type: 'dodge', bonus: true }).error, /Cunning Action/, 'only Dash, Disengage and Hide');
  finish(c);
});

test('only a foe who can see you, and who can still react: hidden or out of reach, you walk away freely', async () => {
  const { c, bram, gob, tok, gTok, gx, gy } = await fight();
  const away = [{ x: gx, y: gy - 1 }, { x: gx, y: gy - 2 }, { x: gx, y: gy - 3 }];
  assert.equal(K.provokedBy(c, bram, away).length, 1);
  assert.equal(K.provokedBy(c, bram, away)[0].step, 0, 'it strikes while Bram is still next to it');
  tok.hidden = true;
  assert.equal(K.provokedBy(c, bram, away).length, 0, 'a hidden hero is unseen');
  tok.hidden = false;
  gob.conditions = ['stunned'];
  assert.equal(K.provokedBy(c, bram, away).length, 0, 'a stunned goblin can\'t react');
  gob.conditions = [];
  gob.reacted = true;
  assert.equal(K.provokedBy(c, bram, away).length, 0, 'its reaction is spent');
  gob.reacted = false;
  Object.assign(gTok, { x: gx + 5, y: gy });
  assert.equal(K.provokedBy(c, bram, away).length, 0, 'never in its reach');
  finish(c);
});

test('a blow that drops you stops you where it caught you, and your turn is over', async () => {
  const { c, k, bram, gob, tok, gTok, gx, gy, ch } = await fight();
  const blade = gob.stat.actions.find((a) => a.name === 'Scimitar');
  blade.attackBonus = 99;
  blade.damage = [{ dice: '4d6+30', type: 'slashing' }];
  let r = null;
  // (a natural 1 still misses: try again)
  for (let i = 0; i < 8; i++) {
    Object.assign(tok, { x: gx - 1, y: gy - 1 });
    Object.assign(gTok, { x: gx, y: gy });
    Object.assign(k.economy[bram.id], { moved: 0 });
    ch.hp.current = 1; ch.conditions = []; C.saveCharacter(ch);
    gob.reacted = false;
    // north-east past the goblin's shoulder: still next to it after the first step, out of its reach after the second
    r = K.moveInCombat(c, 'u_a', tok, gx + 3, gy - 1, { provoke: true });
    if (C.getCharacter(ch.id).hp.current <= 0) break;
  }
  assert.ok(r.stopped, JSON.stringify(r));
  assert.equal(C.getCharacter(ch.id).hp.current, 0);
  assert.deepEqual([tok.x, tok.y], [gx + 1, gy - 1], 'down in the last square next to the goblin');
  assert.equal(r.feet, 10);
  assert.notEqual(K.currentCombatant(c)?.id, bram.id, 'his turn ended');
  assert.ok(c.log.some((e) => e.text === "Bram's turn is over."));
  finish(c);
});

test('a monster walking out of your reach: you are asked, it waits while you roll, then it goes on its way', async () => {
  const { c, k, bram, gob, gTok, gx, gy } = await fight();
  k.turnIndex = k.order.indexOf(gob.id);
  k.state = 'enemy';
  const turn = K.executeIntent(c, gob, { action: 'none', moveToX: gx, moveToY: gy + 4 });
  await tick(20);
  const offer = buildView(c, 'u_a').combat.reaction;
  assert.ok(offer, 'Bram is offered the attack');
  assert.match(offer.moverName, /^Goblin/);
  assert.equal(offer.attacks[0].name, 'Unarmed Strike', 'no weapon: bare hands');
  assert.deepEqual([gTok.x, gTok.y], [gx, gy], 'it waits where Bram can still reach it');
  assert.equal(K.reactionView(c, 'u_b').reacting, 'Bram', 'the table sees whose answer the fight waits on');
  // a natural 20: a hit, then Bram rolls the damage himself
  const hit = K.opportunityAttack(c, 'u_a', { id: offer.id, take: true, attackId: offer.attacks[0].id, mode: 'manual', natural: 20 });
  assert.ok(hit.hit && hit.pendingId, JSON.stringify(hit));
  assert.equal(bram.reacted, true);
  assert.equal(buildView(c, 'u_a').combat.reaction, null, 'the offer is answered');
  assert.equal(buildView(c, 'u_a').combat.pending.length, 1, 'the damage waits for him');
  assert.match(K.opportunityAttack(c, 'u_a', { id: offer.id, take: true }).error, /already made that attack/);
  const before = gob.hp.cur;
  assert.ok(K.damage(c, 'u_a', { pendingId: hit.pendingId, mode: 'manual', total: 2 }).ok);
  assert.equal(gob.hp.cur, before - 2);
  assert.equal(k.state, 'enemy', 'still the goblin\'s turn');
  await turn;
  assert.deepEqual([gTok.x, gTok.y], [gx, gy + 4], 'then it gets where it was going');
  assert.ok(c.log.some((e) => e.kind === 'dice' && e.label === 'Unarmed Strike vs Goblin (opportunity attack)'));
  finish(c);
});

test('the weapon that hits hardest is offered first, bare hands last', async () => {
  const { c, k, gob, ch, gx, gy } = await fight();
  ch.equipment = [{ id: 'it_d', index: 'dagger', name: 'Dagger', qty: 1, equipped: true }, { id: 'it_l', index: 'longsword', name: 'Longsword', qty: 1, equipped: true }];
  C.saveCharacter(ch);
  k.turnIndex = k.order.indexOf(gob.id);
  k.state = 'enemy';
  const turn = K.executeIntent(c, gob, { action: 'none', moveToX: gx, moveToY: gy + 4 });
  await tick(20);
  const offer = K.reactionView(c, 'u_a').reaction;
  assert.deepEqual(offer.attacks.map((a) => a.name), ['Longsword', 'Dagger', 'Unarmed Strike']);
  K.opportunityAttack(c, 'u_a', { id: offer.id, take: false });
  await turn;
  finish(c);
});

test('a monster walking away: let it go, or say nothing and it gets away; Disengage needs no question', async () => {
  const { c, k, bram, gob, gTok, gx, gy } = await fight();
  k.turnIndex = k.order.indexOf(gob.id);
  k.state = 'enemy';
  // let it go
  let turn = K.executeIntent(c, gob, { action: 'none', moveToX: gx, moveToY: gy + 4 });
  await tick(20);
  let offer = K.reactionView(c, 'u_a').reaction;
  assert.ok(K.opportunityAttack(c, 'u_a', { id: offer.id, take: false }).passed);
  await turn;
  assert.deepEqual([gTok.x, gTok.y], [gx, gy + 4]);
  assert.equal(bram.reacted, false, 'his reaction is still there');
  assert.ok(c.log.some((e) => /^Bram lets Goblin.* go\.$/.test(e.text || '')));
  // no answer: after the wait it gets away
  Object.assign(gTok, { x: gx, y: gy });
  turn = K.executeIntent(c, gob, { action: 'none', moveToX: gx, moveToY: gy + 4 });
  await tick(20);
  assert.ok(K.reactionView(c, 'u_a').reaction);
  await turn;
  assert.deepEqual([gTok.x, gTok.y], [gx, gy + 4]);
  assert.equal(K.reactionView(c, 'u_a').reaction, null);
  // Disengage: it just walks away
  Object.assign(gTok, { x: gx, y: gy });
  turn = K.executeIntent(c, gob, { action: 'disengage', moveToX: gx, moveToY: gy + 4 });
  await tick(20);
  assert.equal(K.reactionView(c, 'u_a').reaction, null, 'nothing to ask');
  await turn;
  assert.deepEqual([gTok.x, gTok.y], [gx, gy + 4]);
  finish(c);
});

test('the enemy AI is told how opportunity attacks work', () => {
  assert.match(COMBAT_CORE, /Opportunity attacks: a creature that moves out of the reach of a hero/);
  assert.match(COMBAT_CORE, /action "disengage"/);
});
