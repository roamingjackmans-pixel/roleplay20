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

// After a quote that really ends a string comes `,` `:` `}` `]` or the end; after a comma, the next value or key.
const VALUE_START = /^\s*(?:["{[\d-]|true\b|false\b|null\b)/;
function endsString(s, j) {
  const rest = s.slice(j, j + 40);
  const m = /^\s*(.)/.exec(rest);
  if (!m) return true;
  if (':}]'.includes(m[1])) return true;
  if (m[1] !== ',') return false;
  const after = rest.slice(rest.indexOf(',') + 1);
  return VALUE_START.test(after) || /^\s*[}\]]/.test(after) || !after.trim();
}

/**
 * Fix the slips a model makes when it writes JSON by hand: a double quote inside a text value left unescaped
 * ("text": "She says "run" and goes"), a raw line break or tab inside a string, \' (not a JSON escape), a stray
 * backslash, and a comma before a closing bracket. Anything else is left as it is.
 */
export function repairJson(s) {
  let out = '';
  let inStr = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === '\\') {
        const n = s[i + 1];
        if (n !== undefined && '"\\/bfnrtu'.includes(n)) { out += c + n; i++; }
        else if (n === "'") { out += "'"; i++; }
        else out += '\\\\';
      } else if (c === '"') {
        if (endsString(s, i + 1)) { inStr = false; out += c; } else out += '\\"';
      } else if (c === '\n') out += '\\n';
      else if (c === '\r') out += '\\r';
      else if (c === '\t') out += '\\t';
      else if (c < ' ') out += `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`;
      else out += c;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === ',' && /^\s*[}\]]/.test(s.slice(i + 1, i + 40))) continue;
    out += c;
  }
  return out;
}

/** Every top-level {...} in the text, in order (string-aware), plus first `{` to last `}` for when a stray quote
 * throws the count off. */
function objectCandidates(t) {
  const out = [];
  let depth = 0, inStr = false, esc = false, start = -1;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = depth > 0;
    else if (c === '{') { if (depth++ === 0) start = i; }
    else if (c === '}' && depth > 0 && --depth === 0) out.push(t.slice(start, i + 1));
  }
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first >= 0 && last > first && !out.includes(t.slice(first, last + 1))) out.push(t.slice(first, last + 1));
  return out;
}

const keysOf = (v, schema) => (schema?.required || []).filter((k) => k in v).length;

/** A reply wrapped in one more object ({"response": {...}} or {"turn": {...}}) is unwrapped when the inside fits better. */
function unwrap(v, schema) {
  if (!schema?.required) return v;
  let best = v;
  for (const inner of Object.values(v)) {
    if (inner && typeof inner === 'object' && !Array.isArray(inner) && keysOf(inner, schema) > keysOf(best, schema)) best = inner;
  }
  return best;
}

/**
 * Pull the JSON object out of model text. Tolerates ```json fences, prose around it, more than one object (the one
 * that fits the schema best wins), a wrapper object, tool-call markup instead of JSON, and the slips repairJson fixes.
 */
export function extractJson(text, schema) {
  if (!text || !text.trim()) throw new Error('empty response');
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    const v = JSON.parse(t);
    if (v && typeof v === 'object' && !Array.isArray(v)) return unwrap(v, schema);
  } catch { /* look closer */ }
  const candidates = objectCandidates(t);
  const invoked = fromInvokeMarkup(t);
  if (!candidates.length && !invoked) throw new Error('no JSON object in response');
  let best = null, firstError = null;
  for (const cand of candidates) {
    let v;
    try { v = JSON.parse(cand); } catch (e) {
      try { v = JSON.parse(repairJson(cand)); } catch { firstError ||= e; continue; }
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    v = unwrap(v, schema);
    const score = keysOf(v, schema);
    if (!best || score > best.score) best = { v, score };
  }
  if (invoked && (!best || keysOf(invoked, schema) > best.score)) best = { v: invoked };
  if (best) return best.v;
  throw firstError || new Error('no JSON object in response');
}

/**
 * A reply written as tool-call markup in plain text (<invoke><parameter name="narration">[...]</parameter>...). Sonnet 5.5
 * answers this way when it is given no tool to call; each parameter's value is JSON, or plain text for a string.
 */
export function fromInvokeMarkup(text) {
  const out = {};
  for (const m of String(text || '').matchAll(/<parameter name="([A-Za-z_][\w]*)">([\s\S]*?)<\/parameter>/g)) {
    const raw = m[2].trim();
    try { out[m[1]] = JSON.parse(raw); } catch {
      try { out[m[1]] = /^[[{]/.test(raw) ? JSON.parse(repairJson(raw)) : raw; } catch { out[m[1]] = raw; }
    }
  }
  return Object.keys(out).length ? out : null;
}

// Schemas too large for compiled structured outputs (the API answers "compiled grammar is too large"). For these the
// reply comes as one call to the send_reply tool, whose input schema is the reply's (tool inputs aren't compiled, so
// size doesn't matter). Without a tool, Sonnet 5.5 wrote tool-call markup into its text instead of the JSON, and now
// and then repeated it until it ran out of room. A long run (world building) still writes the JSON as text.
const promptSchemaTasks = new Set(['turn', 'genesis']);
const noToolTasks = new Set(); // tasks whose reply tool the API turned down: they write the JSON as text instead
export const REPLY_TOOL = 'send_reply';

function schemaInstructions(schema) {
  return `\n\n# OUTPUT FORMAT\nRespond with ONE JSON object and nothing else (no prose, no code fences). It must match this JSON Schema exactly - every listed property present, "" / 0 / [] when not used:\n${JSON.stringify(schema)}`;
}
const TOOL_INSTRUCTIONS = `\n\n# OUTPUT FORMAT\nGive your whole reply as ONE call to the ${REPLY_TOOL} tool, with every property of its input present ("" / 0 / [] when not used). Write nothing outside that call.`;

/**
 * Bend a reply into its schema's lists. A reply written from a schema in the prompt isn't checked by the API, and models
 * differ in how strictly they follow it: one writes a list of one as the item itself ("parts": {...} or "parts": "...").
 * Here a lone item becomes a list of one, null or "" becomes an empty list, and a list or object written out as JSON
 * text is read, at every depth. Nothing else changes.
 */
export function conformToSchema(value, schema) {
  if (!schema || value === undefined) return value;
  if ((schema.type === 'array' || schema.type === 'object') && typeof value === 'string' && /^\s*[[{]/.test(value)) {
    try { value = JSON.parse(value); } catch { /* leave it */ }
  }
  if (schema.type === 'array') {
    if (value === null || value === '') return [];
    return (Array.isArray(value) ? value : [value]).map((v) => conformToSchema(v, schema.items));
  }
  if (schema.type === 'object' && schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    const out = { ...value };
    for (const [k, s] of Object.entries(schema.properties)) if (k in out) out[k] = conformToSchema(out[k], s);
    return out;
  }
  return value;
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
export function buildRequest({ system, cachedContext, prompt, schema, model, effort, maxTokens, useSchema, replyTool = false, retryNote = '', cacheTtl = '5m' }) {
  const mark = { type: 'ephemeral', ...(cacheTtl === '1h' ? { ttl: '1h' } : {}) };
  const format = !schema || useSchema ? '' : replyTool ? TOOL_INSTRUCTIONS : schemaInstructions(schema);
  const systemBlocks = [{ type: 'text', text: system + format }];
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
    // tool_choice "auto": the current models refuse a forced tool choice; the prompt says to call it
    ...(replyTool ? {
      tools: [{ name: REPLY_TOOL, description: 'Send your whole reply. Call it exactly once, with every property filled in ("" / 0 / [] when not used).', input_schema: schema }],
      tool_choice: { type: 'auto', disable_parallel_tool_use: true },
    } : {}),
  };
}

/** Token counts of every attempt added up, so the cost log counts the replies that had to be asked again. */
function addUsage(a, b) {
  if (!a) return b;
  if (!b) return a;
  const sum = { ...a };
  for (const k of ['input_tokens', 'output_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens']) sum[k] = (a[k] || 0) + (b[k] || 0);
  sum.cache_creation = { ...(a.cache_creation || {}), ephemeral_1h_input_tokens: (a.cache_creation?.ephemeral_1h_input_tokens || 0) + (b.cache_creation?.ephemeral_1h_input_tokens || 0) };
  return sum;
}

/** Keep what an unreadable reply looked like (its start and end), so the next problem can be seen, not guessed at. */
function noteFailure(task, model, attempt, res, text, why) {
  appendLine('ai-failures.jsonl', {
    at: Date.now(), task, model, attempt, why: String(why).slice(0, 200), stop: res?.stop_reason, out: res?.usage?.output_tokens,
    blocks: (res?.content || []).map((b) => b.type).join(','), head: String(text || '').slice(0, 700), tail: String(text || '').slice(-300),
  });
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
  let tokens = maxTokens || 16000;
  let usage = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const replyTool = !!schema && !useSchema && !longRun && !noToolTasks.has(task);
    const req = buildRequest({ system, cachedContext, prompt, schema, model, effort, maxTokens: tokens, useSchema, replyTool, retryNote, cacheTtl });
    try {
      const res = await send(req, useFallback, longRun);
      usage = addUsage(usage, res.usage);
      if (res.stop_reason === 'refusal') {
        throw new Error(`Claude declined this request (${res.stop_details?.category || 'policy'}). Try rephrasing the action.`);
      }
      const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
      const call = replyTool ? res.content.find((b) => b.type === 'tool_use' && b.name === REPLY_TOOL) : null;
      const cut = res.stop_reason === 'max_tokens';
      if (cut) console.warn(`[ai] ${task}: reply hit its length limit (${tokens} tokens); trying to read it anyway`);
      let data;
      if (call?.input && typeof call.input === 'object' && Object.keys(call.input).length) data = unwrap(call.input, schema);
      else {
        try { data = extractJson(text, schema); } catch (pe) {
          noteFailure(task, model, attempt, res, text, pe.message);
          // a long run cut off at its length limit would only be cut off again: asking again costs another long wait
          if (longRun && cut) throw new Error('The reply ran past its length limit before it was finished.');
          if (attempt < 3) {
            if (cut) tokens = Math.min(tokens * 2, 32000);
            console.warn(`[ai] ${task}: reply was not readable (${pe.message}); asking again (kept in ai-failures.jsonl)`);
            retryNote = replyTool
              ? `\n\n(Your previous reply did not call the ${REPLY_TOOL} tool. Give your whole reply as one call to ${REPLY_TOOL}, and write nothing else.)`
              : '\n\n(Your previous reply was not a valid JSON object. Reply with only the JSON object.)';
            continue;
          }
          throw pe;
        }
      }
      const missing = useSchema ? [] : missingKeys(data, schema);
      if (missing.length > 3 && attempt < 3) {
        noteFailure(task, model, attempt, res, call ? JSON.stringify(call.input) : text, `missing ${missing.join(', ')}`);
        if (cut) tokens = Math.min(tokens * 2, 32000);
        console.warn(`[ai] ${task}: reply is missing ${missing.join(', ')}; asking again`);
        retryNote = `\n\n(Your previous reply was missing these properties: ${missing.join(', ')}. Include every property${replyTool ? ` of the ${REPLY_TOOL} input` : ' of the schema'}.)`;
        continue;
      }
      return { data, usage, model: res.model || model, raw: call ? JSON.stringify(call.input) : text };
    } catch (e) {
      const msg = String(e?.message || e);
      if (e instanceof Anthropic.BadRequestError) {
        if (useFallback && /fallback/i.test(msg)) { useFallback = false; continue; }
        if (replyTool && /tool/i.test(msg)) {
          console.warn(`[ai] ${task}: the reply tool was not accepted (${msg.slice(0, 120)}); writing the reply as JSON text from now on`);
          noToolTasks.add(task);
          continue;
        }
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
      return { data: extractJson(text, schema), usage: {}, model: 'file', raw: text };
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
  if (schema) out.data = conformToSchema(out.data, schema);
  const ms = Date.now() - t0;
  const costUsd = costOf(m, out.usage);
  appendLine('ai-calls.jsonl', { at: t0, task, campaignId, model: out.model, ms, usage: out.usage, costUsd });
  console.log(`[ai] ${task} ${out.model} ${(ms / 1000).toFixed(1)}s in=${out.usage?.input_tokens ?? '-'} cached=${out.usage?.cache_read_input_tokens ?? '-'} out=${out.usage?.output_tokens ?? '-'} $${costUsd.toFixed(4)}`);
  return { ...out, ms, costUsd, modelUsed: m, task };
}
