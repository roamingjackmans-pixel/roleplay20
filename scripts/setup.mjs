// Interactive setup: site password, Anthropic API key, Dungeon Master model, build. Then: npm run cloud-setup
// Run with:  npm run setup
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(ROOT, '.env');

const c = { gold: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };

function readEnv() {
  const out = {};
  if (!fs.existsSync(ENV)) return out;
  for (const line of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function writeEnv(vals) {
  const lines = [
    '# Roleplay20 server settings. This file stays on your PC (it is in .gitignore). Never share it.',
    '',
    '# Anthropic API key for the AI Dungeon Master (starts with sk-ant-)',
    `ANTHROPIC_API_KEY=${vals.ANTHROPIC_API_KEY || ''}`,
    '',
    '# Default Claude for new campaigns (each campaign can change it in the DM Screen): claude-opus-5-5 (recommended), claude-fable-5-1 (deepest, 2.5x the cost), claude-sonnet-5-5 (faster, half of Opus), claude-haiku-5-5 (cheapest)',
    `DM_MODEL=${vals.DM_MODEL || 'claude-opus-5-5'}`,
    `DM_EFFORT=${vals.DM_EFFORT || 'medium'}`,
    '',
    '# Site password (stored only as a scrypt hash) and the server signing secret.',
    `GATE_PASSWORD_HASH=${vals.GATE_PASSWORD_HASH || ''}`,
    `SERVER_SECRET=${vals.SERVER_SECRET || crypto.randomBytes(32).toString('base64url')}`,
    `PORT=${vals.PORT || 3020}`,
  ];
  for (const [k, v] of Object.entries(vals)) {
    if (!['ANTHROPIC_API_KEY', 'DM_MODEL', 'DM_EFFORT', 'GATE_PASSWORD_HASH', 'SERVER_SECRET', 'PORT'].includes(k)) lines.push(`${k}=${v}`);
  }
  fs.writeFileSync(ENV, lines.join('\n') + '\n');
}

function ask(question, { hidden = false } = {}) {
  if (hidden && process.stdin.isTTY) return askHidden(question);
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** Read a secret without ever echoing it: raw keypresses, one * per character, pastes included. */
function askHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const finish = () => {
      stdin.removeListener('data', onData);
      stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write('\n');
      resolve(buf.trim());
    };
    const onData = (chunk) => {
      const text = String(chunk).replace(/\x1b\[[0-9;]*[~A-Za-z]/g, ''); // drop bracketed-paste and arrow-key sequences
      for (const ch of text) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') { if (buf) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { buf += ch; process.stdout.write('*'); }
      }
    };
    stdin.on('data', onData);
  });
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
  return `scrypt$${salt}$${hash}`;
}

async function checkKey(key) {
  try {
    const r = await fetch('https://api.anthropic.com/v1/models', { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } });
    return r.ok ? 'ok' : r.status === 401 ? 'bad' : `status ${r.status}`;
  } catch (e) {
    return `network error (${e.message})`;
  }
}

function has(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0;
}

console.log(`\n${c.gold(c.bold('  🎲 Roleplay20 setup'))}\n`);
const env = readEnv();

// 1. site password
if (env.GATE_PASSWORD_HASH) {
  const a = await ask(`Site password is already set. Change it? ${c.dim('(y/N)')} `);
  if (/^y/i.test(a)) env.GATE_PASSWORD_HASH = '';
}
while (!env.GATE_PASSWORD_HASH) {
  const pw = await ask('New site password (everyone types this at josephjackman.com/roleplay20): ', { hidden: true });
  if (pw.length < 4) { console.log(c.red('  Too short.')); continue; }
  const again = await ask('Type it again: ', { hidden: true });
  if (pw !== again) { console.log(c.red('  They did not match.')); continue; }
  env.GATE_PASSWORD_HASH = hashPassword(pw);
  console.log(c.green('  ✓ Password saved (only a hash is stored).'));
}

// 2. API key
console.log(`\n${c.bold('AI Dungeon Master')}`);
console.log(c.dim('  Create a key at https://platform.claude.com (API Keys). On a Max plan, first claim your monthly API credits:'));
console.log(c.dim('  claude.ai -> Settings -> Billing -> link a Claude Console organization.'));
const keyPrompt = env.ANTHROPIC_API_KEY ? `API key is set (…${env.ANTHROPIC_API_KEY.slice(-4)}). Paste a new one or press Enter to keep it: ` : 'Paste your Anthropic API key (sk-ant-…), or press Enter to skip for now: ';
const key = await ask(keyPrompt, { hidden: true });
if (key) env.ANTHROPIC_API_KEY = key;
if (env.ANTHROPIC_API_KEY) {
  const r = await checkKey(env.ANTHROPIC_API_KEY);
  console.log(r === 'ok' ? c.green('  ✓ The key works.') : r === 'bad' ? c.red('  ✗ Anthropic rejected that key. Check it and run setup again.') : c.gold(`  ? Could not verify the key (${r}).`));
} else {
  console.log(c.gold('  Skipped. The game still runs; the campaign owner narrates from the DM Screen until a key is added.'));
}

// 3. model
const m = await ask(`\nDungeon Master brain for new campaigns: ${c.bold('1')} Opus 5.5 (recommended) / ${c.bold('2')} Fable 5.1 (deepest, 2.5x cost) / ${c.bold('3')} Sonnet 5.5 (faster, half of Opus) / ${c.bold('4')} Haiku 5.5 (cheapest) ${c.dim(`[current: ${env.DM_MODEL || 'claude-opus-5-5'}]`)} `);
env.DM_MODEL = { 1: 'claude-opus-5-5', 2: 'claude-fable-5-1', 3: 'claude-sonnet-5-5', 4: 'claude-haiku-5-5' }[m] || env.DM_MODEL || 'claude-opus-5-5';
writeEnv(env);
console.log(c.green(`  ✓ Settings written to .env (${env.DM_MODEL}).`));

// 4. build
console.log(`\n${c.bold('Building the app…')}`);
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

// 5. publishing the gate page
console.log(`\n${c.bold('Going online')}`);
const REPO = 'roamingjackmans-pixel/roleplay20';
if (has('gh')) {
  const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  console.log(r.status === 0 ? c.green('  ✓ GitHub CLI is signed in, so the website can be pointed at the cloud server.') : c.gold('  Run `gh auth login` so the website can be pointed at the cloud server.'));
  const exists = spawnSync('gh', ['repo', 'view', REPO, '--json', 'name'], { encoding: 'utf8' }).status === 0;
  if (!exists) {
    console.log(`\n  The website josephjackman.com/roleplay20 needs a ${c.bold('public')} GitHub repo named ${c.bold('roleplay20')} (like lieage and horserace).`);
    console.log(c.dim('  Only the password gate page is published by GitHub Pages; the repo holds the source code. .env and saved games are never committed.'));
    const a = await ask(`  Create ${REPO}, push the code and turn on GitHub Pages now? ${c.dim('(y/N)')} `);
    if (/^y/i.test(a)) {
      try {
        execSync(`gh repo create ${REPO} --public --description "Roleplay20: an AI Dungeon Master and virtual tabletop for D&D 5e" --source . --remote origin --push`, { cwd: ROOT, stdio: 'inherit' });
        execSync(`gh api -X POST repos/${REPO}/pages -f build_type=workflow`, { cwd: ROOT, stdio: 'inherit' });
        execSync(`gh workflow run pages.yml -R ${REPO}`, { cwd: ROOT, stdio: 'inherit' });
        console.log(c.green('  ✓ Published. In a minute or two the gate will be live at https://josephjackman.com/roleplay20/'));
      } catch (e) {
        console.log(c.red(`  Publishing failed: ${e.message}`));
      }
    }
  } else console.log(c.green(`  ✓ ${REPO} exists.`));
} else console.log(c.gold('  Install the GitHub CLI (https://cli.github.com) so the website can be pointed at the cloud server.'));

console.log(`\n${c.gold(c.bold('  All set!'))} Next, put the game in the cloud with ${c.bold('npm run cloud-setup')} (nothing has to run on this PC).\n`);
