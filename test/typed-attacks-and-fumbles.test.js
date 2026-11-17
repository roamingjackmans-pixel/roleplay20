// In a fight, a player can type "I run over and stab the goblin": their token moves where they said (if their movement
// reaches, otherwise they're asked), then they roll to hit and roll damage themselves. And a natural 1 on any attack
// roll is a fumble: something a little bad and a little funny happens on top of the miss.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-typed-attack-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const K = await import('../server/game/combat.js');
const { buildView } = await import('../server/game/views.js');
const { cellCost, findPath, distanceFeet } = await import('../server/game/pathing.js');
const { pickMishap } = await import('../server/game/fumbles.js');
const { TURN_SCHEMA } = await import('../server/ai/schemas.js');
const { DM_CORE, COMBAT_CORE } = await import('../server/ai/prompts.js');

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
let n = 0;
const item = (index, name) => ({ id: `it_${index}_${n}`, name, index, qty: 1, equipped: true, attuned: false, notes: '' });

/** Bram (a fighter with a rapier and a shortbow) against one goblin, Bram's turn first. */
async function fight() {
  const c = C.newCampaign({ id: 'u_a' }, { name: `Typed ${++n}` });
  const id = `ch_typed_${n}`;
  C.storeNewCharacter({
    id, ownerId: 'u_a', name: 'Bram', race: 'human', class: 'fighter', level: 1, classes: [{ class: 'fighter', subclass: null, level: 1 }],
    hp: { max: 12, current: 12, temp: 0 }, speed: 30, conditions: [], abilities: { str: 14, dex: 16, con: 12, int: 10, wis: 10, cha: 10 },
    otherProfs: { armor: [], weapons: ['simple', 'martial'], tools: [], languages: [] },
    equipment: [item('rapier', 'Rapier'), item('shortbow', 'Shortbow'), item('javelin', 'Javelin')],
  });
  c.members[0].characterId = id;
  E.setSceneMap(c, { theme: 'tavern', name: 'The Thimble & Thistle', size: 'medium' });
  E.setOnline(c, 'u_a', `s_${n}`, true);
  assert.ok(E.startSession(c).ok);
  await tick();
  E.openActions(c);
  E.applyTurnResult(c, { narration: [], combatStart: [{ enemies: [{ monster: 'goblin', count: 1 }], useCurrentMap: true }] });
  const k = c.combat;
  for (const req of k.rollRequests.filter((r) => r.purpose === 'initiative')) E.respondRoll(c, req.userId, req.id, { mode: 'manual', natural: 20 });
  const bram = Object.values(k.combatants).find((x) => x.characterId === id);
  const gob = Object.values(k.combatants).find((x) => x.kind === 'enemy');
  if (k.combatants[k.order[k.turnIndex]] !== bram) { // the goblin beat a 23: give Bram the first turn anyway
    k.turnIndex = k.order.indexOf(bram.id);
    k.state = 'turn';
  }
  const map = c.maps.tactical[k.mapId];
  return { c, k, map, bram, gob, bTok: c.tokens[bram.tokenId], gTok: c.tokens[gob.tokenId], ch: () => C.getCharacter(id) };
}

/** Put Bram and the goblin on open floor `minFt`-`maxFt` of walking apart. */
function placeApart(c, map, bTok, gTok, minFt, maxFt) {
  const open = [];
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (Number.isFinite(cellCost(map, x, y))) open.push({ x, y });
  for (const a of open) {
    for (const b of open) {
      const d = distanceFeet(a, b);
      if (d < minFt || d > maxFt) continue;
      if (Object.values(c.tokens).some((t) => t !== bTok && t !== gTok && !t.dead && ((t.x === a.x && t.y === a.y) || (t.x === b.x && t.y === b.y)))) continue;
      const p = findPath(map, a, b, {});
      if (p && p.feet <= maxFt + 5) { bTok.x = a.x; bTok.y = a.y; gTok.x = b.x; gTok.y = b.y; return; }
    }
  }
  throw new Error('no open spots that far apart');
}

const plan = (k, bram, extra) => ({ narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Bram vaults the bench.' }] }], attack: [{ characterId: bram.characterId, moveTo: '', targetId: '', weapon: '', ...extra }] });

test('the DM is told that moving and weapon attacks are for the app and the player\'s own dice', async () => {
  const { c } = await fight();
  K.combatAsk(c, 'u_a', 'I run over and stab the goblin');
  const text = c.pendingInput?.text || '';
  assert.match(text, /fill "attack" with one entry/);
  assert.match(text, /they roll to hit and roll damage themselves/);
  assert.match(text, /leave rollRequests and effects empty/);
  const a = TURN_SCHEMA.properties.attack;
  assert.deepEqual(a.items.required, ['characterId', 'moveTo', 'targetId', 'weapon', 'thrown']);
  assert.deepEqual(TURN_SCHEMA.properties.combatCost.enum, ['action', 'bonus', 'free', 'none']);
});

test('"I run over and stab the goblin": the token runs next to it, and the player rolls to hit (nothing rolled yet)', async () => {
  const { c, k, map, bram, gob, bTok, gTok } = await fight();
  placeApart(c, map, bTok, gTok, 15, 20);
  const logBefore = c.log.length;
  k.state = 'asking';
  E.applyTurnResult(c, plan(k, bram, { moveTo: gob.name, targetId: gob.id }), { kind: 'combat_ask' });
  assert.ok(distanceFeet(bTok, gTok) <= 5, 'Bram ends up next to the goblin');
  const eco = k.economy[bram.id];
  assert.ok(eco.moved >= 10 && eco.moved <= 30, `moved ${eco.moved} ft`);
  assert.equal(eco.action, false, 'the attack has not happened yet');
  assert.equal(k.state, 'turn');
  assert.equal(k.ready?.attackName, 'Rapier', 'their usual melee weapon');
  assert.ok(!c.log.slice(logBefore).some((e) => e.kind === 'dice'), 'no dice were rolled for them');
  const v = buildView(c, 'u_a').combat;
  assert.equal(v.ready.targetName, gob.name);
  assert.equal(v.ready.attackName, 'Rapier');

  // the player rolls to hit (a real-dice 20), then rolls damage
  const hit = K.attack(c, 'u_a', { attackId: v.ready.attackId, targetTokenId: v.ready.targetTokenId, mode: 'manual', natural: 20 });
  assert.equal(hit.hit, true);
  assert.equal(hit.crit, true);
  assert.equal(k.ready, null, 'the readied attack is used up');
  assert.equal(buildView(c, 'u_a').combat.ready, null);
  const dmg = K.damage(c, 'u_a', { pendingId: hit.pendingId, mode: 'auto' });
  assert.ok(dmg.ok && dmg.total > 0);
});

test('too far to run this turn: nothing moves, and the player is asked what they want', async () => {
  const { c, k, map, bram, gob, bTok, gTok } = await fight();
  placeApart(c, map, bTok, gTok, 20, 25);
  k.economy[bram.id].moved = 25; // 5 ft left
  const at = { x: bTok.x, y: bTok.y };
  k.state = 'asking';
  E.applyTurnResult(c, plan(k, bram, { moveTo: gob.name, targetId: gob.id }), { kind: 'combat_ask' });
  assert.deepEqual({ x: bTok.x, y: bTok.y }, at, 'the token stays put');
  assert.equal(k.ready, null);
  assert.equal(k.economy[bram.id].action, false, 'their action is not spent');
  const q = c.log.at(-1);
  assert.equal(q.kind, 'clarify');
  assert.deepEqual(q.to, ['u_a']);
  assert.match(q.text, /you have 5 ft of movement left/);
});

test('already next to the target: no movement, just the roll; a shot from range keeps its distance', async () => {
  const { c, k, map, bram, gob, bTok, gTok } = await fight();
  placeApart(c, map, bTok, gTok, 5, 5);
  k.state = 'asking';
  E.applyTurnResult(c, plan(k, bram, { targetId: gob.id }), { kind: 'combat_ask' });
  assert.equal(k.economy[bram.id].moved, 0);
  assert.equal(k.ready?.attackName, 'Rapier');

  const f2 = await fight();
  placeApart(f2.c, f2.map, f2.bTok, f2.gTok, 20, 25);
  const at = { x: f2.bTok.x, y: f2.bTok.y };
  f2.k.state = 'asking';
  E.applyTurnResult(f2.c, plan(f2.k, f2.bram, { targetId: f2.gob.id, weapon: 'my shortbow' }), { kind: 'combat_ask' });
  assert.deepEqual({ x: f2.bTok.x, y: f2.bTok.y }, at, 'no need to move for a bow shot');
  assert.equal(f2.k.ready?.attackName, 'Shortbow');
});

test('the weapon they name is the one they use', () => {
  const attacks = [
    { id: 'r', name: 'Rapier', kind: 'melee' }, { id: 's', name: 'Shortbow', kind: 'ranged' }, { id: 'u', name: 'Unarmed Strike', kind: 'melee' },
  ];
  assert.equal(K.pickAttack(attacks, 'my shortbow').name, 'Shortbow');
  assert.equal(K.pickAttack(attacks, 'the bow').name, 'Shortbow');
  assert.equal(K.pickAttack(attacks, 'punch').name, 'Unarmed Strike');
  assert.equal(K.pickAttack(attacks, 'rapier').name, 'Rapier');
  assert.equal(K.pickAttack(attacks, '').name, 'Rapier', 'usual melee weapon');
  assert.equal(K.pickAttack([{ id: 'u', name: 'Unarmed Strike', kind: 'melee' }], '').name, 'Unarmed Strike');
});

test('every mishap is worded with the names filled in', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const m = pickMishap({ name: 'Bram', target: 'the goblin', weapon: 'Rapier', rng: () => (i % 10) / 10 + 0.01 });
    seen.add(m.key);
    assert.doesNotMatch(m.text + m.rule, /\{[ntw]\}/);
    assert.match(m.rule, /[.]$/, 'the rule is a full sentence');
    assert.match(m.text, /^[A-Z]/);
  }
  assert.deepEqual([...seen].sort(), ['drop', 'nick', 'open', 'prone', 'stuck']);
  assert.ok(!pickMishap({ name: 'Goblin', canStick: false, rng: () => 0.99 }).key.includes('stuck'), 'a monster has already moved');
  assert.match(pickMishap({ name: 'Wren', weapon: 'Fire Bolt', spell: true, rng: () => 0 }).text, /Fire Bolt/);
});

test('a natural 1 on an attack is a fumble with a real (small) consequence', async () => {
  const f = await fight();
  placeApart(f.c, f.map, f.bTok, f.gTok, 5, 5);
  const r = K.attack(f.c, 'u_a', { attackId: f.ch().equipment[0].id, targetTokenId: f.gTok.id, mode: 'manual', natural: 1 });
  assert.equal(r.hit, false);
  assert.equal(r.fumble, true);
  const card = f.c.log.filter((e) => e.kind === 'dice').at(-1);
  assert.equal(card.outcome, 'Fumble!');
  const line = f.c.log.at(-1);
  assert.equal(line.tone, 'fumble');
  assert.equal(line.to, 'all', 'everyone sees it');
  assert.match(line.text, /^🤦 Fumble! .*Bram/);
});

test('each mishap does what it says', async () => {
  const at = (v) => { let i = 0; return () => (i++ === 0 ? v : 0); }; // first draw picks the mishap, second the wording
  // falls prone, and gets back up at the start of their next turn for half their movement
  let f = await fight();
  K.fumble(f.c, f.bram, f.gob, 'Rapier', { rng: at(0) });
  assert.ok(f.ch().conditions.includes('prone'));
  // wide open: the next attack against them has advantage
  f = await fight();
  K.fumble(f.c, f.bram, f.gob, 'Rapier', { rng: at(0.25) });
  assert.equal(f.bram.exposed, true);
  // a nick: 1 damage, but never below 1 HP
  f = await fight();
  K.fumble(f.c, f.bram, f.gob, 'Rapier', { rng: at(0.45) });
  assert.equal(f.ch().hp.current, 11);
  f.ch().hp.current = 1;
  const m = K.fumble(f.c, f.bram, f.gob, 'Rapier', { rng: at(0.45) });
  assert.equal(f.ch().hp.current, 1);
  assert.match(m.rule, /no damage/);
  // drops the weapon: half their movement next turn
  f = await fight();
  K.fumble(f.c, f.bram, f.gob, 'Rapier', { rng: at(0.65) });
  assert.equal(f.bram.fumbledWeapon, true);
  // stuck: the rest of this turn's movement is gone
  f = await fight();
  K.fumble(f.c, f.bram, f.gob, 'Rapier', { rng: at(0.85) });
  assert.equal(K.movementInfo(f.c, f.bram).left, 0);
  // monsters fumble too
  f = await fight();
  const hp = f.gob.hp.cur;
  K.fumble(f.c, f.gob, f.bram, 'Scimitar', { rng: at(0.6) }); // monsters have no "stuck" (they move before attacking)
  assert.equal(f.gob.hp.cur, hp > 1 ? hp - 1 : hp);
});

test('back on their feet (and weapon in hand) at the start of their next turn, for half their movement', async () => {
  const f = await fight();
  const at = (v) => { let i = 0; return () => (i++ === 0 ? v : 0); };
  f.ch().hp = { max: 200, current: 200, temp: 0 }; // the goblin can't drop him before his next turn
  K.fumble(f.c, f.bram, f.gob, 'Rapier', { rng: at(0) });
  assert.ok(f.ch().conditions.includes('prone'));
  assert.ok(K.endTurn(f.c, 'u_a').ok);
  // the goblin takes its turn (quick tactics with no AI), then it's Bram's again
  for (let i = 0; i < 100 && K.currentCombatant(f.c)?.id !== f.bram.id; i++) await tick(50);
  assert.ok(f.c.combat, 'the fight is still on');
  assert.equal(K.currentCombatant(f.c).id, f.bram.id);
  assert.ok(!f.ch().conditions.includes('prone'), 'stood up');
  assert.equal(K.movementInfo(f.c, f.bram).left, 15, 'standing cost half their speed');
  assert.ok(f.c.log.some((e) => /Bram gets back on their feet/.test(e.text || '')));
});

test('the DM keeps the same content in about 40% fewer words, and makes natural 1s memorable', () => {
  assert.match(DM_CORE, /about 35-110 words per narration segment/);
  assert.doesNotMatch(DM_CORE, /60-180 words/);
  assert.match(DM_CORE, /Keep every piece of content/);
  assert.match(DM_CORE, /natural 1.*critical fail.*really goes wrong.*never deadly/s);
  assert.match(COMBAT_CORE, /one punchy sentence each/);
});

// ---- throwing, and nothing from an earlier turn counting against this one
const { historyBlock } = await import('../server/game/context.js');
const weaponId = (f, name) => f.ch().equipment.find((i) => i.name === name).id;

test('a javelin can be thrown at range (it used to be refused as "too far for a melee attack")', async () => {
  const f = await fight();
  placeApart(f.c, f.map, f.bTok, f.gTok, 20, 25);
  const melee = K.attack(f.c, 'u_a', { attackId: weaponId(f, 'Javelin'), targetTokenId: f.gTok.id, mode: 'auto' });
  assert.match(melee.error, /Too far for a melee attack .*switch on 🎯 Throw to throw it \(30\/120 ft\)/);
  assert.equal(f.k.economy[f.bram.id].action, false, 'a refused attack never uses up the action');
  const r = K.attack(f.c, 'u_a', { attackId: weaponId(f, 'Javelin'), targetTokenId: f.gTok.id, mode: 'manual', natural: 15, thrown: true });
  assert.ok(r.ok, r.error);
  assert.equal(f.k.economy[f.bram.id].action, true);
  const card = f.c.log.filter((e) => e.kind === 'dice').at(-1);
  assert.match(card.label, /^Javelin \(thrown\) vs /);
  if (r.hit) assert.equal(r.damageType, 'piercing', 'a throwing weapon keeps its own damage');
});

test('anything else can be thrown as an improvised weapon: 1d4, 20/60 ft, no proficiency bonus', async () => {
  const f = await fight();
  placeApart(f.c, f.map, f.bTok, f.gTok, 15, 20);
  const r = K.attack(f.c, 'u_a', { attackId: weaponId(f, 'Rapier'), targetTokenId: f.gTok.id, mode: 'manual', natural: 20, thrown: true });
  assert.ok(r.ok && r.hit, r.error);
  assert.equal(r.damage, '1d4+3', 'its usual (finesse: DEX) modifier, improvised damage');
  assert.equal(r.damageType, 'bludgeoning');
  const card = f.c.log.filter((e) => e.kind === 'dice').at(-1);
  assert.match(card.label, /Rapier \(thrown, improvised\)/);
  assert.equal(card.result.total, 23, '20 + DEX 3, without the proficiency bonus');
  const f2 = await fight();
  placeApart(f2.c, f2.map, f2.bTok, f2.gTok, 5, 5);
  assert.match(K.attack(f2.c, 'u_a', { attackId: 'unarmed', targetTokenId: f2.gTok.id, thrown: true }).error, /can't throw your unarmed strike/);
});

test('"I throw my javelin at the goblin" readies a thrown attack from where they stand', async () => {
  const f = await fight();
  placeApart(f.c, f.map, f.bTok, f.gTok, 20, 25);
  const at = { x: f.bTok.x, y: f.bTok.y };
  f.k.state = 'asking';
  E.applyTurnResult(f.c, plan(f.k, f.bram, { targetId: f.gob.id, weapon: 'javelin', thrown: true }), { kind: 'combat_ask' });
  assert.deepEqual({ x: f.bTok.x, y: f.bTok.y }, at, 'no running up to it');
  assert.equal(f.k.ready?.attackName, 'Javelin (thrown)');
  assert.equal(buildView(f.c, 'u_a').combat.ready.thrown, true);
});

test('the DM is told exactly what was done this turn, and that earlier rounds never count', async () => {
  const f = await fight();
  f.ch().hp = { max: 200, current: 200, temp: 0 };
  placeApart(f.c, f.map, f.bTok, f.gTok, 5, 5);
  assert.ok(K.takeAction(f.c, 'u_a', { type: 'dodge' }).ok);
  assert.deepEqual(f.k.economy[f.bram.id].done, ['dodge']);
  K.combatAsk(f.c, 'u_a', 'I shout a warning to the others');
  assert.match(f.c.pendingInput.text, /THIS turn so far \(the only things that count against it\): dodge\./);
  // the next round: nothing from last turn carries over
  await tick();
  assert.ok(K.endTurn(f.c, 'u_a').ok);
  for (let i = 0; i < 100 && K.currentCombatant(f.c)?.id !== f.bram.id; i++) await tick(50);
  assert.equal(K.currentCombatant(f.c).id, f.bram.id);
  assert.equal(K.movementInfo(f.c, f.bram).action, false);
  K.combatAsk(f.c, 'u_a', 'I kick sand in its eyes');
  const text = f.c.pendingInput.text;
  assert.match(text, /THIS turn so far \(the only things that count against it\): nothing yet\./);
  assert.match(text, /a spell they cast or an attack they made last round does not use up this turn's action/);
});

test('a correction or question to the DM costs nothing; an action costs the action', async () => {
  const f = await fight();
  const ask = (data) => { f.k.state = 'asking'; E.applyTurnResult(f.c, { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Noted.' }] }], ...data }, { kind: 'combat_ask', combatRound: f.k.round, turnOf: 'Bram', askText: 'I cast that last round, not this one' }); };
  ask({ combatCost: 'free' });
  assert.equal(f.k.economy[f.bram.id].action, false, 'still has the action');
  const turn = f.c.chronicle.turns.at(-1);
  assert.equal(turn.combatRound, f.k.round);
  assert.match(historyBlock(f.c), new RegExp(`combat round ${f.k.round}, Bram's turn`));
  assert.match(historyBlock(f.c), /\* Bram: I cast that last round, not this one/);
  ask({ combatCost: 'bonus' });
  assert.equal(f.k.economy[f.bram.id].bonus, true);
  assert.equal(f.k.economy[f.bram.id].action, false);
  ask({}); // an older reply with no cost given: the action, as before
  assert.equal(f.k.economy[f.bram.id].action, true);
});
