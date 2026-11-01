// From the sheet, HP, spell slots, Inspiration and limited uses can be spent but never given back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { consumableError } from '../server/sheetRules.js';

const ch = () => ({
  hp: { max: 10, current: 6, temp: 2 },
  inspiration: true,
  spellcasting: { slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 1 },
  resources: { bardicInspiration: { used: 2 } },
});

test('spending is allowed', () => {
  assert.equal(consumableError(ch(), { hp: { max: 10, current: 3, temp: 0 } }), null);
  assert.equal(consumableError(ch(), { inspiration: false }), null);
  assert.equal(consumableError(ch(), { spellcasting: { slotsUsed: [2, 0, 0, 0, 0, 0, 0, 0, 0] } }), null);
  assert.equal(consumableError(ch(), { spellcasting: { pactUsed: 2 } }), null);
  assert.equal(consumableError(ch(), { resources: { bardicInspiration: { used: 3 } } }), null);
  assert.equal(consumableError(ch(), { name: 'New name', portrait: 'data:image/jpeg;base64,x' }), null);
});

test('healing yourself or adding temporary HP from the sheet is refused', () => {
  assert.ok(consumableError(ch(), { hp: { max: 10, current: 7, temp: 2 } }));
  assert.ok(consumableError(ch(), { hp: { max: 10, current: 6, temp: 5 } }));
  assert.ok(consumableError(ch(), { hp: { max: 12, current: 6, temp: 2 } }));
});

test('Inspiration only comes from the DM', () => {
  assert.ok(consumableError({ ...ch(), inspiration: false }, { inspiration: true }));
});

test('spent spell slots, pact slots and uses cannot be restored from the sheet', () => {
  assert.ok(consumableError(ch(), { spellcasting: { slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0] } }));
  assert.ok(consumableError(ch(), { spellcasting: { pactUsed: 0 } }));
  assert.ok(consumableError(ch(), { resources: { bardicInspiration: { used: 1 } } }));
});
