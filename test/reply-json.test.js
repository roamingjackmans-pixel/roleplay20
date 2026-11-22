// The DM's story turn is JSON the model writes by hand (its schema is too big for the API to enforce). On Sonnet 5.5 a
// game night saw 5 of about 15 turns come back unreadable, each one asked again at 20-50 seconds and a full turn's
// cost. The slips that can be put right are put right here instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.AI_PROVIDER = 'off';
process.env.TUNNEL = 'off';
const { extractJson, repairJson } = await import('../server/ai/client.js');
const { TURN_SCHEMA } = await import('../server/ai/schemas.js');

const turn = (narrationText) => `{"narration":[{"to":["all"],"parts":[{"speaker":"narrator","text":"${narrationText}"}]}],"npcs":[],"rollRequests":[],"effects":[],"summary":"ok"}`;
const textOf = (v) => v.narration[0].parts[0].text;

test('a double quote left unescaped inside a text value', () => {
  const v = extractJson(turn('The keeper says "nobody" and looks away.'), TURN_SCHEMA);
  assert.equal(textOf(v), 'The keeper says "nobody" and looks away.');
  assert.equal(v.summary, 'ok');
});

test('quotes at the very end of a text value, and before a comma in prose', () => {
  assert.equal(textOf(extractJson(turn('She whispers "run"'), TURN_SCHEMA)), 'She whispers "run"');
  assert.equal(textOf(extractJson(turn('He said "stop", then ran.'), TURN_SCHEMA)), 'He said "stop", then ran.');
  assert.equal(textOf(extractJson(turn('"Who goes there?" the guard calls.'), TURN_SCHEMA)), '"Who goes there?" the guard calls.');
});

test('raw line breaks and tabs inside strings, \\\' and a trailing comma', () => {
  const v = extractJson('{"narration":[{"to":["all"],"parts":[{"speaker":"narrator","text":"Line one.\nLine\ttwo, it\\\'s late."},]}],"summary":"x",}', TURN_SCHEMA);
  assert.equal(textOf(v), "Line one.\nLine\ttwo, it's late.");
});

test('prose and code fences around the object; braces in the prose', () => {
  const v = extractJson(`Here is the turn for {the party}:\n\`\`\`json\n${turn('Rain.')}\n\`\`\`\nDone.`, TURN_SCHEMA);
  assert.equal(textOf(v), 'Rain.');
});

test('two objects: the one that fits the schema wins; a wrapper object is unwrapped', () => {
  const v = extractJson(`{"thought":"plan"}\n${turn('Fog.')}`, TURN_SCHEMA);
  assert.equal(textOf(v), 'Fog.');
  const w = extractJson(`{"response":${turn('Snow.')}}`, TURN_SCHEMA);
  assert.equal(textOf(w), 'Snow.');
});

test('valid JSON is never changed by the repair', () => {
  const good = JSON.stringify({ narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'He said "hi", then: [left]. {ok}' }] }], dc: -1, list: ['a', 'b'], ok: true, none: null });
  assert.equal(repairJson(good), good);
  assert.deepEqual(extractJson(good, TURN_SCHEMA), JSON.parse(good));
});

test('no JSON at all still fails, so the turn is asked again', () => {
  assert.throws(() => extractJson('The tavern falls silent as the door swings open.', TURN_SCHEMA), /no JSON object/);
  assert.throws(() => extractJson('   ', TURN_SCHEMA), /empty response/);
});
