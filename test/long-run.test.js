// World building and the story backbone are long runs: streamed, at the highest effort, with room for the model's whole
// output. Checked against a local fake of the Messages API (no real calls, no key).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const seen = [];
let mode = 'ok';
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (d) => (body += d));
  req.on('end', () => {
    const b = JSON.parse(body);
    seen.push({ beta: req.headers['anthropic-beta'] || '', stream: !!b.stream, effort: b.output_config?.effort, max: b.max_tokens, model: b.model });
    const text = mode === 'cut' ? '{"backbone":"The Villain wants every bell sil' : JSON.stringify({ backbone: 'The Villain wants every bell silenced.' });
    const stop = mode === 'cut' ? 'max_tokens' : 'end_turn';
    const msg = { id: 'msg_1', type: 'message', role: 'assistant', model: b.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } };
    if (!b.stream) { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ...msg, content: [{ type: 'text', text }], stop_reason: stop, usage: { input_tokens: 10, output_tokens: 5 } })); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
    ev('message_start', { message: msg });
    ev('content_block_start', { index: 0, content_block: { type: 'text', text: '' } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(0, 12) } });
    ev('content_block_delta', { index: 0, delta: { type: 'text_delta', text: text.slice(12) } });
    ev('content_block_stop', { index: 0 });
    ev('message_delta', { delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 5 } });
    ev('message_stop', {});
    res.end();
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${server.address().port}`;
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
process.env.AI_PROVIDER = 'api';
process.env.TUNNEL = 'off';
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-longrun-'));
const { askClaude, worldBrain, WORLD_MAX_TOKENS } = await import('../server/ai/client.js');
const { BACKBONE_SCHEMA } = await import('../server/ai/schemas.js');
const ask = (extra) => askClaude({ task: 'backbone', system: 'S', prompt: 'P', schema: BACKBONE_SCHEMA, ...extra });

test.after(() => server.close());

test('a world build streams at the highest effort with room for the whole output; other calls stay as they were', async () => {
  const r = await ask({ ...worldBrain('claude-sonnet-5-5'), maxTokens: WORLD_MAX_TOKENS, longRun: true });
  assert.equal(r.data.backbone, 'The Villain wants every bell silenced.');
  assert.deepEqual(seen.at(-1), { beta: 'server-side-fallback-2026-07-01', stream: true, effort: 'xhigh', max: 128000, model: 'claude-opus-5-5' });
  await ask({ model: 'claude-haiku-5-5', effort: 'medium' });
  assert.deepEqual(seen.at(-1), { beta: '', stream: false, effort: 'medium', max: 16000, model: 'claude-haiku-5-5' });
});

test('a long run cut off at its length limit is not sent again (that would be another long wait for the same result)', async () => {
  mode = 'cut';
  const before = seen.length;
  await assert.rejects(ask({ ...worldBrain('claude-opus-5-5'), maxTokens: WORLD_MAX_TOKENS, longRun: true }), /ran past its length limit/);
  assert.equal(seen.length - before, 1, 'asked once');
  mode = 'ok';
});
