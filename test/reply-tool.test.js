// Story turns are answered with one call to the send_reply tool. Given no tool, Sonnet 5.5 wrote tool-call markup into its
// text instead of the JSON (<invoke name="noop">, <parameter name="clarify">...), and now and then repeated it until it
// ran out of room: 16,000 tokens and 80 seconds for nothing. These tests drive the real request loop against canned
// API replies (no network).
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-reply-tool-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'api';
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';

const sent = [];
let replies = [];
globalThis.fetch = async (url, init) => {
  sent.push(JSON.parse(init.body));
  const body = replies.shift();
  return new Response(JSON.stringify({ id: `msg_${sent.length}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_details: null, ...body }), { status: 200, headers: { 'content-type': 'application/json' } });
};

const { askClaude, buildRequest, REPLY_TOOL, fromInvokeMarkup, conformToSchema } = await import('../server/ai/client.js');
const { TURN_SCHEMA } = await import('../server/ai/schemas.js');

const usage = (out) => ({ input_tokens: 100, output_tokens: out, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 });
const fullTurn = { narration: [{ to: ['all'], parts: [{ speaker: 'narrator', text: 'Oswin says "never" and looks away.' }] }], npcs: [], rollRequests: [], effects: [], scene: { location: 'Quay', timeOfDay: '', weather: '', mood: '', areaMapId: '', areaLocationId: '', clearBattleMap: false }, areaMaps: [], sceneMap: [], combatStart: [], quests: [], handouts: [], clarify: [], attack: [], combatCost: 'none', waitFor: [], ruling: '', dmNotes: '', summary: 'They asked Oswin.' };
const ask = () => askClaude({ task: 'turn', system: 'You are the DM.', prompt: [{ text: 'What happens?' }], schema: TURN_SCHEMA, model: 'claude-sonnet-5-5', effort: 'medium' });

beforeEach(() => { sent.length = 0; replies = []; });

test('a story turn offers the send_reply tool (not forced: the current models refuse that) and reads its input', async () => {
  replies = [{ stop_reason: 'tool_use', usage: usage(900), content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'tool_use', id: 'tu_1', name: REPLY_TOOL, input: fullTurn }] }];
  const res = await ask();
  assert.equal(res.data.narration[0].parts[0].text, 'Oswin says "never" and looks away.');
  const req = sent[0];
  assert.equal(req.tools[0].name, REPLY_TOOL);
  assert.deepEqual(req.tools[0].input_schema, TURN_SCHEMA);
  assert.deepEqual(req.tool_choice, { type: 'auto', disable_parallel_tool_use: true });
  assert.match(req.system[0].text, /ONE call to the send_reply tool/);
  assert.doesNotMatch(req.system[0].text, /JSON Schema exactly/, 'the schema is in the tool, not repeated in the prompt');
  assert.equal(req.output_config.format, undefined);
});

test('tool-call markup written as text is read like a tool call', async () => {
  const markup = Object.entries(fullTurn).map(([k, v]) => `<parameter name="${k}">${typeof v === 'string' ? v : JSON.stringify(v)}</parameter>`).join('\n');
  replies = [{ stop_reason: 'end_turn', usage: usage(900), content: [{ type: 'text', text: `<invoke name="${REPLY_TOOL}">\n${markup}\n</invoke>` }] }];
  const res = await ask();
  assert.equal(sent.length, 1, 'no second request');
  assert.equal(res.data.summary, 'They asked Oswin.');
  assert.equal(res.data.combatCost, 'none');
  assert.deepEqual(res.data.npcs, []);
});

test('a reply stuck repeating markup until its limit is asked again with more room, and both attempts are paid for', async () => {
  const loop = '<invoke>\n<parameter name="x">0</parameter>\n</invoke>\n\n'.repeat(50);
  replies = [
    { stop_reason: 'max_tokens', usage: usage(16000), content: [{ type: 'text', text: loop }] },
    { stop_reason: 'tool_use', usage: usage(1000), content: [{ type: 'tool_use', id: 'tu_2', name: REPLY_TOOL, input: fullTurn }] },
  ];
  const res = await ask();
  assert.equal(sent.length, 2);
  assert.equal(sent[0].max_tokens, 16000);
  assert.equal(sent[1].max_tokens, 32000, 'room to finish');
  assert.match(sent[1].messages[0].content.at(-1).text, /Your previous reply was missing these properties/);
  assert.equal(res.usage.output_tokens, 17000, 'the wasted attempt counts in the cost log');
  await new Promise((r) => setTimeout(r, 100)); // the line is appended in the background
  const kept = fs.readFileSync(path.join(process.env.DATA_DIR, 'ai-failures.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(kept.at(-1).stop, 'max_tokens');
  assert.match(kept.at(-1).head, /<invoke>/);
});

test('a reply with no tool call and no JSON is asked again, saying what was wrong', async () => {
  replies = [
    { stop_reason: 'end_turn', usage: usage(300), content: [{ type: 'text', text: 'The fog thickens over the quay.' }] },
    { stop_reason: 'tool_use', usage: usage(900), content: [{ type: 'tool_use', id: 'tu_3', name: REPLY_TOOL, input: fullTurn }] },
  ];
  const res = await ask();
  assert.equal(sent.length, 2);
  assert.match(sent[1].messages[0].content.at(-1).text, /did not call the send_reply tool/);
  assert.equal(res.data.summary, 'They asked Oswin.');
});

test('lists written out as JSON text inside the tool input are read as lists', () => {
  const v = conformToSchema({ ...fullTurn, clarify: '[{"characterId":"ch_1","message":"Which one?"}]', npcs: '' }, TURN_SCHEMA);
  assert.deepEqual(v.clarify, [{ characterId: 'ch_1', message: 'Which one?' }]);
  assert.deepEqual(v.npcs, []);
  assert.equal(fromInvokeMarkup('no markup here'), null);
});

test('tasks with a schema small enough for structured outputs are unchanged', () => {
  const req = buildRequest({ system: 'x', prompt: 'y', schema: { type: 'object', properties: { a: { type: 'string' } }, required: ['a'], additionalProperties: false }, model: 'm', effort: 'low', useSchema: true });
  assert.equal(req.tools, undefined);
  assert.equal(req.output_config.format.type, 'json_schema');
});
