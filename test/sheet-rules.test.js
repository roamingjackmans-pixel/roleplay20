// Players can't change stats from their sheet: the DM, the rules engine and the level-up wizard do. Outside a session
// nothing changes except your picture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetPatchError, applySheetPatch, DM_ONLY } from '../server/sheetRules.js';

const ch = () => ({
  name: 'Lorax',
  hp: { max: 10, current: 6, temp: 2 },
  inspiration: true,
  currency: { gp: 5 },
  conditions: [],
  spellcasting: { slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0, prepared: ['bless'], alwaysPrepared: ['cure-wounds'] },
  resources: { bardicInspiration: { used: 2 } },
  equipment: [{ id: 'it_1', name: 'Longsword', qty: 1, equipped: false }, { id: 'it_2', name: 'Rope', qty: 1, equipped: false }],
  concentration: 'bless',
});
const live = { sessionError: null, inCombat: false };
const between = { sessionError: "The session hasn't started yet." };

test('no stat can be changed from the sheet, spending or not', () => {
  for (const patch of [
    { hp: { max: 10, current: 3, temp: 0 } },
    { hp: { max: 10, current: 7, temp: 2 } },
    { inspiration: false },
    { inspiration: true },
    { currency: { gp: 50 } },
    { conditions: ['blessed'] },
    { resources: { bardicInspiration: { used: 3 } } },
    { spellcasting: { slotsUsed: [2, 0, 0, 0, 0, 0, 0, 0, 0] } },
    { spellcasting: { pactUsed: 1 } },
    { name: 'Lorax the Great' },
    { xp: 9000 },
  ]) assert.equal(sheetPatchError(ch(), patch, live), DM_ONLY, JSON.stringify(patch));
});

test('your picture can change any time, even between sessions', () => {
  assert.equal(sheetPatchError(ch(), { portrait: 'data:image/jpeg;base64,x' }, between), null);
  assert.match(sheetPatchError(ch(), { portrait: 'x'.repeat(400001) }, live), /too big/);
});

test('nothing else changes outside a session', () => {
  assert.match(sheetPatchError(ch(), { light: { bright: 20, dim: 20 } }, between), /only changes during a session/);
  assert.match(sheetPatchError(ch(), { concentration: null }, between), /only changes during a session/);
  const eq = ch().equipment.map((i) => ({ ...i, equipped: i.id === 'it_1' }));
  assert.match(sheetPatchError(ch(), { equipment: eq }, between), /only changes during a session/);
});

test('in a session: torch, ending concentration and equipping what you carry', () => {
  assert.equal(sheetPatchError(ch(), { light: { bright: 20, dim: 20 } }, live), null);
  assert.equal(sheetPatchError(ch(), { concentration: null }, live), null);
  assert.match(sheetPatchError(ch(), { concentration: 'bless' }, live), /only end it/);
  const eq = ch().equipment.map((i) => ({ ...i, equipped: i.id === 'it_1' }));
  assert.equal(sheetPatchError(ch(), { equipment: eq }, live), null);
  assert.match(sheetPatchError(ch(), { equipment: eq }, { ...live, inCombat: true }), /after the fight/);
});

test('equipping cannot add, remove, rename or multiply items', () => {
  const base = ch().equipment;
  assert.equal(sheetPatchError(ch(), { equipment: [...base, { id: 'it_3', name: 'Potion of Healing', qty: 1 }] }, live), DM_ONLY);
  assert.equal(sheetPatchError(ch(), { equipment: base.slice(1) }, live), DM_ONLY);
  assert.equal(sheetPatchError(ch(), { equipment: base.map((i) => (i.id === 'it_2' ? { ...i, qty: 5 } : i)) }, live), DM_ONLY);
  assert.equal(sheetPatchError(ch(), { equipment: base.map((i) => (i.id === 'it_1' ? { ...i, name: 'Vorpal Sword' } : i)) }, live), DM_ONLY);
});

test('prepared spells change only right after a long rest, up to the limit', () => {
  assert.match(sheetPatchError(ch(), { spellcasting: { prepared: ['shield'] } }, live), /after a long rest/);
  const rested = { ...ch(), mayPrepare: true };
  assert.equal(sheetPatchError(rested, { spellcasting: { prepared: ['cure-wounds', 'bless', 'command'] } }, { ...live, preparedMax: 2 }), null);
  assert.match(sheetPatchError(rested, { spellcasting: { prepared: ['bless', 'command', 'shield'] } }, { ...live, preparedMax: 2 }), /at most 2/);
  assert.equal(sheetPatchError(rested, { spellcasting: { prepared: ['bless'], slotsUsed: [0] } }, live), DM_ONLY);
});

test('a fallen hero only keeps their picture; a retired one keeps nothing', () => {
  assert.match(sheetPatchError({ ...ch(), dead: true }, { light: { bright: 20, dim: 20 } }, live), /has died/);
  assert.equal(sheetPatchError({ ...ch(), dead: true }, { portrait: 'data:x' }, live), null);
  assert.match(sheetPatchError({ ...ch(), retired: { reason: 'retired' } }, { portrait: 'data:x' }, live), /retired/);
});

test('applying a patch only flips equipped and keeps always-prepared spells', () => {
  const c = { ...ch(), mayPrepare: true };
  applySheetPatch(c, { equipment: c.equipment.map((i) => ({ ...i, equipped: i.id === 'it_1' })), spellcasting: { prepared: ['command'] } });
  assert.equal(c.equipment[0].equipped, true);
  assert.equal(c.equipment[1].equipped, false);
  assert.deepEqual(c.spellcasting.prepared, ['cure-wounds', 'command']);
  assert.equal(c.spellcasting.slotsUsed[0], 1);
});

test('your dice look can change any time, but only to a real choice', () => {
  assert.equal(sheetPatchError(ch(), { dice: { color: 'ruby', style: 'galaxy', ink: 'gold' } }, between), null);
  assert.match(sheetPatchError(ch(), { dice: { color: 'plaid', style: 'galaxy', ink: 'gold' } }, live), /isn't one of the choices/);
  assert.match(sheetPatchError(ch(), { dice: { color: 'ruby', style: 'galaxy', ink: 'gold', hp: 99 } }, live), /isn't one of the choices/);
  const c = ch();
  applySheetPatch(c, { dice: { color: 'aurora', style: 'neon', ink: 'auto' } });
  assert.deepEqual(c.dice, { color: 'aurora', style: 'neon', ink: 'auto' });
});
