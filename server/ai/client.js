// Calls Claude for the Dungeon Master. Three providers:
//   api  - Anthropic Messages API with ANTHROPIC_API_KEY (the real thing)
//   file - developer testing: writes the request to data/ai-inbox and waits for a hand-written <id>.response.json
//   off  - no AI configured; callers fall back to the manual DM screen / quick tactics
import fs from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { randomId } from '../security.js';
import { appendLine } from '../store.js';

export class NoAIError extends Error {
  constructor(msg = 'No AI Dungeon Master is configured.') { super(msg); this.name = 'NoAIError'; }
}

// $ per million tokens. cacheRead is the cache-hit price; cache writes cost 1.25x input (5-minute TTL) or 2x (1 hour).
export const PRICES = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2, label: 'Claude Opus 5.5 (rich storytelling, recommended)' },
  'claude-fable-5-1': { in: 10, out: 50, cacheRead: 0.25, label: 'Claude Fable 5.1 (deepest storytelling, slowest, 2.5x the cost)' },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.1, label: 'Claude Sonnet 5.5 (fast and vivid)' },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01, label: 'Claude Haiku 5.5 (cheapest, quickest)' },
};
export const MODELS = Object.keys(PRICES);
export const EFFORTS = ['low', 'medium', 'high'];
const FALLBACK_OK = new Set(['claude-fable-5-1', 'claude-opus-5-5', 'claude-sonnet-5-5']);

let client = null;
function api() {
  if (!client) client = new Anthropic({ apiKey: config.anthropicKey, timeout: config.aiTimeoutMs, maxRetries: 2 });
  return client;
}

export function aiStatus() {
  return {
    provider: config.aiProvider,
    configured: config.aiProvider === 'api' ? !!config.anthropicKey : config.aiProvider === 'file',
    model: config.defaultModel,
  };
}

export function costOf(model, usage) {
  const p = PRICES[model] || PRICES['claude-opus-5-5'];
  const u = usage || {};
  const hour = u.cache_creation?.ephemeral_1h_input_tokens || 0; // the rest of the cache writes are 5-minute ones
  const writes = Math.max(0, (u.cache_creation_input_tokens || 0) - hour) * 1.25 + hour * 2;
  const usd = ((u.input_tokens || 0) * p.in + writes * p.in +
    (u.cache_read_input_tokens || 0) * p.cacheRead + (u.output_tokens || 0) * p.out) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

/** Pull the first complete JSON object out of model text (tolerates ```json fences and stray prose). */
export function extractJson(text) {
  if (!text) throw new Error('empty response');
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const start = t.indexOf('{');
  if (start < 0) throw new Error('no JSON object in response');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return JSON.parse(t.slice(start, i + 1));
  }
  throw new Error('unterminated JSON in response');
}

// Schemas too large for compiled structured outputs (the API answers "compiled grammar is too large"). For these the
// schema goes into the cached system prompt instead, and the reply is parsed and checked here.
const promptSchemaTasks = new Set(['turn', 'genesis']);

function schemaInstructions(schema) {
  return `\n\n# OUTPUT FORMAT\nRespond with ONE JSON object and nothing else (no prose, no code fences). It must match this JSON Schema exactly - every listed property present, "" / 0 / [] when not used:\n${JSON.stringify(schema)}`;
}

function missingKeys(data, schema) {
  if (!schema?.required || !data || typeof data !== 'object') return [];
  return schema.required.filter((k) => !(k in data));
}

/** A prompt is one text, or parts in order: { text, cache: true } marks a leading part that stays word for word the
 * same over several turns, so the API keeps it cached and bills it at the cache price while it's unchanged. */
export function promptText(prompt) {
  return Array.isArray(prompt) ? prompt.map((p) => p.text).filter(Boolean).join('\n\n') : String(prompt || '');
}

/**
 * The Messages API request for one call. The system prompt (rules + campaign world) is always cached; cacheTtl '1h'
 * keeps it through the long pauses of a game night (players talking for 5-60 minutes) instead of the default 5 minutes.
 * Cached prompt parts get their own breakpoints (the API allows 4 in all, one is the system prompt's).
 */
export function buildRequest({ system, cachedContext, prompt, schema, model, effort, maxTokens, useSchema, retryNote = '', cacheTtl = '5m' }) {
  const mark = { type: 'ephemeral', ...(cacheTtl === '1h' ? { ttl: '1h' } : {}) };
  const systemBlocks = [{ type: 'text', text: system + (schema && !useSchema ? schemaInstructions(schema) : '') }];
  if (cachedContext) systemBlocks.push({ type: 'text', text: cachedContext, cache_control: mark });
  else systemBlocks[0].cache_control = mark;
  const parts = (Array.isArray(prompt) ? prompt : [{ text: String(prompt || '') }]).filter((p) => p.text);
  let marks = 1;
  const content = parts.map((p, i) => {
    const last = i === parts.length - 1;
    const block = { type: 'text', text: last ? p.text + retryNote : p.text };
    if (p.cache && !last && marks < 4) { block.cache_control = { type: 'ephemeral' }; marks++; }
    return block;
  });
  return {
    model,
    max_tokens: maxTokens || 16000,
    system: systemBlocks,
    messages: [{ role: 'user', content: content.length ? content : [{ type: 'text', text: retryNote || '(no details)' }] }],
    output_config: { effort, ...(useSchema ? { format: { type: 'json_schema', schema } } : {}) },
  };
}

/**
 * The model and effort for the campaign's foundations (the world and its story backbone): written once and followed for
 * the whole campaign, so they get the deepest thinking whatever brain the table plays with. Fable stays Fable.
 */
export function worldBrain(model) {
  return { model: model === 'claude-fable-5-1' ? model : 'claude-opus-5-5', effort: 'xhigh' };
}

// Room for a world build's thinking and its long reply: the model's full output. The first real build at this effort
// (The Cave of Night) used 62,791 tokens over 21 minutes, all but brushing the 64,000 it had; a reply cut off at the
// limit is unusable and would have meant building it all again.
export const WORLD_MAX_TOKENS = 128000;

/** Send one request. A long run (world building) streams, so a reply that takes many minutes isn't cut off. */
function send(req, useFallback, longRun) {
  const body = useFallback ? { ...req, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : req;
  const messages = useFallback ? api().beta.messages : api().messages;
  return longRun ? messages.stream(body, { timeout: config.aiLongTimeoutMs }).finalMessage() : messages.create(body);
}

async function callApi({ task, system, cachedContext, prompt, schema, model, effort, maxTokens, cacheTtl, longRun }) {
  if (!config.anthropicKey) throw new NoAIError('ANTHROPIC_API_KEY is not set.');
  let useFallback = FALLBACK_OK.has(model);
  let useSchema = !!schema && !promptSchemaTasks.has(task);
  let retryNote = '';
  for (let attempt = 0; attempt < 4; attempt++) {
    const req = buildRequest({ system, cachedContext, prompt, schema, model, effort, maxTokens, useSchema, retryNote, cacheTtl });
    try {
      const res = await send(req, useFallback, longRun);
      if (res.stop_reason === 'refusal') {
        throw new Error(`Claude declined this request (${res.stop_details?.category || 'policy'}). Try rephrasing the action.`);
      }
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      if (res.stop_reason === 'max_tokens') console.warn('[ai] response hit max_tokens; trying to parse anyway');
      let data;
      try { data = extractJson(text); } catch (pe) {
        // a long run cut off at its length limit would only be cut off again: asking again costs another long wait
        if (longRun && res.stop_reason === 'max_tokens') throw new Error('The reply ran past its length limit before it was finished.');
        if (attempt < 3) { console.warn(`[ai] ${task}: reply was not valid JSON (${pe.message}); asking again`); retryNote = '\n\n(Your previous reply was not a valid JSON object. Reply with only the JSON object.)'; continue; }
        throw pe;
      }
      const missing = useSchema ? [] : missingKeys(data, schema);
      if (missing.length > 3 && attempt < 3) {
        console.warn(`[ai] ${task}: reply is missing ${missing.join(', ')}; asking again`);
        retryNote = `\n\n(Your previous reply was missing these properties: ${missing.join(', ')}. Include every property of the schema.)`;
        continue;
      }
      return { data, usage: res.usage, model: res.model || model, raw: text };
    } catch (e) {
      const msg = String(e?.message || e);
      if (e instanceof Anthropic.BadRequestError) {
        if (useFallback && /fallback/i.test(msg)) { useFallback = false; continue; }
        if (useSchema && /(schema|output_config|format|grammar)/i.test(msg)) {
          console.warn(`[ai] ${task}: schema not accepted for structured outputs; using the schema in the prompt from now on`);
          promptSchemaTasks.add(task);
          useSchema = false;
          continue;
        }
      }
      if (e instanceof Anthropic.AuthenticationError) throw new Error('The Anthropic API key was rejected. Check ANTHROPIC_API_KEY in .env.');
      if (e instanceof Anthropic.RateLimitError) throw new Error('Claude is rate-limited right now. Wait a moment and try again.');
      throw e;
    }
  }
  throw new Error('Claude could not produce a valid response.');
}

async function callFile({ task, system, cachedContext, prompt, schema, timeoutMs }) {
  const dir = path.join(config.dataDir, 'ai-inbox');
  fs.mkdirSync(dir, { recursive: true });
  const id = `${Date.now()}-${task}-${randomId('', 3)}`;
  fs.writeFileSync(path.join(dir, `${id}.request.json`), JSON.stringify({ task, schema }, null, 1));
  fs.writeFileSync(path.join(dir, `${id}.prompt.md`), `# SYSTEM\n\n${system}\n\n# CAMPAIGN CONTEXT (cached)\n\n${cachedContext || ''}\n\n# USER\n\n${promptText(prompt)}\n`);
  console.log(`[ai:file] waiting for ${path.join(dir, id + '.response.json')}`);
  const resFile = path.join(dir, `${id}.response.json`);
  const deadline = Date.now() + (timeoutMs || 30 * 60000);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (fs.existsSync(resFile)) {
      await new Promise((r) => setTimeout(r, 200));
      const text = fs.readFileSync(resFile, 'utf8');
      return { data: extractJson(text), usage: {}, model: 'file', raw: text };
    }
  }
  throw new Error('Timed out waiting for the test DM response file.');
}

/**
 * Ask Claude to do one Dungeon Master task.
 * @returns {{ data: object, usage: object, model: string, ms: number, costUsd: number }}
 */
export async function askClaude({ task, system, cachedContext = '', prompt, schema, model, effort, maxTokens, campaignId, cacheTtl, longRun = false }) {
  const t0 = Date.now();
  const m = MODELS.includes(model) ? model : config.defaultModel;
  const eff = effort || config.defaultEffort;
  let out;
  if (config.aiProvider === 'api') out = await callApi({ task, system, cachedContext, prompt, schema, model: m, effort: eff, maxTokens, cacheTtl, longRun });
  else if (config.aiProvider === 'file') out = await callFile({ task, system, cachedContext, prompt, schema });
  else throw new NoAIError();
  const ms = Date.now() - t0;
  const costUsd = costOf(m, out.usage);
  appendLine('ai-calls.jsonl', { at: t0, task, campaignId, model: out.model, ms, usage: out.usage, costUsd });
  console.log(`[ai] ${task} ${out.model} ${(ms / 1000).toFixed(1)}s in=${out.usage?.input_tokens ?? '-'} cached=${out.usage?.cache_read_input_tokens ?? '-'} out=${out.usage?.output_tokens ?? '-'} $${costUsd.toFixed(4)}`);
  return { ...out, ms, costUsd, modelUsed: m, task };
}
