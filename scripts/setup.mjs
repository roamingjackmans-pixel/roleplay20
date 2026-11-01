// Interactive setup: site password, Anthropic API key, Dungeon Master model, build, tunnel check.
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
    '# Which Claude runs the Dungeon Master: claude-opus-5-5 (richest), claude-sonnet-5-5 (faster, about half the cost), claude-haiku-5-5 (cheapest)',
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
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = function (s) { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(question, (a) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(a.trim()); });
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
const m = await ask(`\nDungeon Master brain: ${c.bold('1')} Opus 5.5 (richest) / ${c.bold('2')} Sonnet 5.5 (faster, ~half cost) / ${c.bold('3')} Haiku 5.5 (cheapest) ${c.dim(`[current: ${env.DM_MODEL || 'claude-opus-5-5'}]`)} `);
env.DM_MODEL = { 1: 'claude-opus-5-5', 2: 'claude-sonnet-5-5', 3: 'claude-haiku-5-5' }[m] || env.DM_MODEL || 'claude-opus-5-5';
writeEnv(env);
console.log(c.green(`  ✓ Settings written to .env (${env.DM_MODEL}).`));

// 4. build
console.log(`\n${c.bold('Building the app…')}`);
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) execSync('npm install', { cwd: ROOT, stdio: 'inherit' });
execSync('npm run build', { cwd: ROOT, stdio: 'inherit' });

// 5. tunnel + publishing
console.log(`\n${c.bold('Going online')}`);
const cloudflared = has('cloudflared') || fs.existsSync('C:\\Program Files (x86)\\cloudflared\\cloudflared.exe') || fs.existsSync(path.join(ROOT, 'bin', 'cloudflared.exe'));
if (cloudflared) console.log(c.green('  ✓ cloudflared is installed (free Cloudflare tunnel, no account needed).'));
else if (process.platform === 'win32' && has('winget')) {
  const a = await ask(`  cloudflared (Cloudflare's free tunnel tool) is needed so friends can reach your PC. Install it now with winget? ${c.dim('(Y/n)')} `);
  if (!/^n/i.test(a)) {
    try { execSync('winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements', { stdio: 'inherit' }); console.log(c.green('  ✓ Installed. Open a new terminal before starting the server.')); }
    catch { console.log(c.red('  Install failed - get it from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/')); }
  }
} else console.log(c.gold('  Install cloudflared: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/'));
if (has('gh')) {
  const r = spawnSync('gh', ['auth', 'status'], { encoding: 'utf8' });
  console.log(r.status === 0 ? c.green('  ✓ GitHub CLI is signed in, so the server can publish its address for josephjackman.com/roleplay20.') : c.gold('  Run `gh auth login` so the server can publish its address for the website.'));
} else console.log(c.gold('  Install the GitHub CLI (https://cli.github.com) so the server can publish its address for the website.'));

console.log(`\n${c.gold(c.bold('  All set!'))} Start the game with ${c.bold('Start Roleplay20.bat')} (or ${c.bold('npm start')}).\n`);
