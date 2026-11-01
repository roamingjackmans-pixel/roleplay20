// Checks that every Dungeon Master JSON schema compiles for structured outputs (tiny, cheap requests on Haiku).
// Run with:  node scripts/check-schemas.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(ROOT, '.env')); } catch { /* use the environment */ }
const S = await import('../server/ai/schemas.js');
const client = new Anthropic();
const model = process.argv[2] || 'claude-haiku-5-5';

for (const name of ['TURN_SCHEMA', 'COMBAT_SCHEMA', 'GENESIS_SCHEMA', 'SESSION_END_SCHEMA', 'CHARACTER_ASSIST_SCHEMA', 'RECAP_SCHEMA']) {
  const schema = S[name];
  const size = JSON.stringify(schema).length;
  try {
    const r = await client.messages.create({
      model, max_tokens: 64,
      messages: [{ role: 'user', content: 'Reply with the smallest valid JSON object for the schema (empty strings, zeros and empty arrays).' }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema } },
    });
    console.log(`OK    ${name.padEnd(24)} ${size} chars  (${r.usage.input_tokens} in / ${r.usage.output_tokens} out)`);
  } catch (e) {
    console.log(`FAIL  ${name.padEnd(24)} ${size} chars  ${String(e.message).slice(0, 160)}`);
  }
}
