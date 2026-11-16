// The DM can grant a spell (a boon, a bond's gift) or take one away, and it lands on the character's sheet:
// a cleric gains an extra cantrip, a fighter who casts nothing gets one with a sensible spellcasting ability.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-spells-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const { srd } = await import('../server/srd.js');
const { buildCharacter, applyLevelUp } = await import('../shared/charbuild.js');
const { deriveCharacter, xpForLevel } = await import('../shared/rules.js');
const { EFFECT_TYPES } = await import('../server/ai/schemas.js');

function party() {
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Dawn' });
  const cleric = C.storeNewCharacter({ ...buildCharacter({ name: 'Kragnir Lighthunter', race: 'half-orc', class: 'cleric', subclass: 'life', baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } }, srd()), id: 'ch_kr', ownerId: 'u_host', xp: 0 });
  const fighter = C.storeNewCharacter({ ...buildCharacter({ name: 'Dagon Lighthunter', race: 'half-orc', class: 'fighter', baseAbilities: { str: 14, dex: 14, con: 14, int: 12, wis: 8, cha: 8 } }, srd()), id: 'ch_dg', ownerId: 'u_two', xp: 0 });
  c.members[0].characterId = cleric.id;
  c.members.push({ userId: 'u_two', role: 'player', characterId: fighter.id });
  return { c, cleric, fighter };
}
const lastSystem = (c) => c.log.filter((l) => l.kind === 'system').at(-1)?.text || '';

test('the DM knows it can grant spells', () => {
  assert.ok(EFFECT_TYPES.includes('spell_add') && EFFECT_TYPES.includes('spell_remove'));
});

test('a cleric gains a bonus cantrip from a boon and casts it with Wisdom', () => {
  const { c, cleric } = party();
  const before = cleric.spellcasting.cantrips.length;
  E.applyEffects(c, [{ type: 'spell_add', target: 'Kragnir', text: 'Ray of Frost (Dawnmark)' }]);
  assert.equal(cleric.spellcasting.cantrips.length, before + 1);
  assert.ok(cleric.spellcasting.cantrips.includes('ray-of-frost'));
  assert.equal(cleric.spellcasting.ability, 'wis', 'still a Wisdom caster');
  assert.match(lastSystem(c), /Kragnir Lighthunter gains the spell Ray of Frost \(Dawnmark\)/);
  // the same grant twice changes nothing and says nothing new
  const logs = c.log.length;
  E.applyEffects(c, [{ type: 'spell_add', target: 'ch_kr', text: 'ray-of-frost' }]);
  assert.equal(cleric.spellcasting.cantrips.filter((s) => s === 'ray-of-frost').length, 1);
  assert.equal(c.log.length, logs);
  // and it is still there after a level-up
  cleric.xp = xpForLevel(2);
  const up = applyLevelUp(cleric, {}, srd());
  assert.ok((up.spellcasting || cleric.spellcasting).cantrips.includes('ray-of-frost'));
});

test('a fighter who casts nothing gets Fire Bolt with the ability the DM names, or his best mental one', () => {
  const { c, fighter } = party();
  assert.equal(fighter.spellcasting, null);
  E.applyEffects(c, [{ type: 'spell_add', target: 'ch_dg', text: 'Fire Bolt (Dawnmark)' }]);
  assert.deepEqual(fighter.spellcasting.cantrips, ['fire-bolt']);
  assert.equal(fighter.spellcasting.ability, 'int', 'Int 12 is his best of Int, Wis and Cha');
  const d = deriveCharacter(fighter, srd());
  assert.equal(d.spellcasting.ability, 'int');
  assert.equal(d.spellcasting.attack, 2 + 1, 'proficiency + Int');
  assert.equal(d.spellcasting.dc, 8 + 2 + 1);
  // the DM can name the ability instead
  const { c: c2, fighter: f2 } = party();
  E.applyEffects(c2, [{ type: 'spell_add', target: 'Dagon', text: 'Fire Bolt (cha, Dawnmark)' }]);
  assert.equal(f2.spellcasting.ability, 'cha');
  // and take it away again: he goes back to casting nothing
  E.applyEffects(c2, [{ type: 'spell_remove', target: 'Dagon', text: 'Fire Bolt' }]);
  assert.equal(f2.spellcasting, null);
  assert.match(lastSystem(c2), /no longer has Fire Bolt/);
});

test('a granted levelled spell is always prepared; an unknown spell leaves the DM a note', () => {
  const { c, cleric } = party();
  E.applyEffects(c, [{ type: 'spell_add', target: 'Kragnir', text: 'Shield' }]);
  assert.ok(cleric.spellcasting.prepared.includes('shield') && cleric.spellcasting.alwaysPrepared.includes('shield'));
  E.applyEffects(c, [{ type: 'spell_add', target: 'Kragnir', text: 'Dawnfire Lance' }]);
  assert.match(c.world.dmNotes.at(-1), /no spell called "Dawnfire Lance"/);
});
