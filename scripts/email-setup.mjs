// Switch on email for Roleplay20 (sign-in codes on new devices, password-reset links, account-change codes) using
// Resend. Asks for your Resend API key (hidden as you type - it never appears on screen or in any chat), the address
// emails come from, and sends a test email. Saves both to .env and stages them as Fly secrets; the next deploy turns
// email on.
// Run with:  npm run email-setup
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV = path.join(ROOT, '.env');
const c = { gold: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const ok = (s) => console.log(c.green(`  ✓ ${s}`));
const fail = (s) => { console.log(c.red(`\n  ✗ ${s}\n`)); process.exit(1); };

function readEnv() {
  const out = {};
  if (!fs.existsSync(ENV)) return out;
  for (const line of fs.readFileSync(ENV, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/** Set some keys in .env, keeping every other line as it is. */
function updateEnv(vals) {
  const lines = fs.existsSync(ENV) ? fs.readFileSync(ENV, 'utf8').split(/\r?\n/) : [];
  const done = new Set();
  const out = lines.map((line) => {
    const m = /^([A-Z0-9_]+)=/.exec(line);
    if (m && m[1] in vals) { done.add(m[1]); return `${m[1]}=${vals[m[1]]}`; }
    return line;
  });
  const missing = Object.keys(vals).filter((k) => !done.has(k));
  if (missing.length) {
    while (out.length && out[out.length - 1] === '') out.pop();
    out.push('', '# Email (Resend): sign-in codes, password resets and account-change codes');
    for (const k of missing) out.push(`${k}=${vals[k]}`);
  }
  fs.writeFileSync(ENV, out.join('\n').replace(/\n*$/, '\n'));
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

/** Read a secret without echoing it: one * per character, pastes included. */
function askHidden(question) {
  if (!process.stdin.isTTY) return ask(question);
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let buf = '';
    const finish = () => { stdin.removeListener('data', onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write('\n'); resolve(buf.trim()); };
    const onData = (chunk) => {
      for (const ch of String(chunk).replace(/\x1b\[[0-9;]*[~A-Za-z]/g, '')) {
        if (ch === '\r' || ch === '\n') return finish();
        if (ch === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (ch === '\u007f' || ch === '\b') { if (buf) { buf = buf.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { buf += ch; process.stdout.write('*'); }
      }
    };
    stdin.on('data', onData);
  });
}

function findFly() {
  for (const cand of ['flyctl', 'fly', path.join(os.homedir(), '.fly', 'bin', process.platform === 'win32' ? 'flyctl.exe' : 'flyctl')]) {
    const r = spawnSync(cand, ['version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) return cand;
  }
  return null;
}

console.log(`\n  ${c.bold('Roleplay20 email setup')} ${c.dim('(Resend)')}\n`);
console.log(c.dim('  You need: a Resend account (resend.com), a domain you send from that is verified in Resend'));
console.log(c.dim('  (Resend > Domains), and an API key (Resend > API Keys > Create, "Sending access" is enough).\n'));

const env = readEnv();
const fromDefault = env.EMAIL_FROM || 'Roleplay20 <dm@josephjackman.com>';
const from = (await ask(`  Send emails from ${c.dim(`[${fromDefault}]`)}: `)) || fromDefault;
if (!/@[^\s>]+\.[a-z]{2,}/i.test(from)) fail('That from-address needs an email in it, like: Roleplay20 <dm@yourdomain.com>');
const key = await askHidden('  Resend API key (starts with re_, hidden): ');
if (!/^re_[A-Za-z0-9_]{10,}$/.test(key)) fail("That doesn't look like a Resend API key (they start with re_).");
const testTo = await ask('  Send a test email to (your own address): ');

if (testTo) {
  process.stdout.write('  Sending a test email…');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: [testTo], subject: 'Roleplay20 email is working', text: 'This is a test from Roleplay20. Sign-in codes and password-reset links will come from this address.' }),
  }).catch((e) => ({ ok: false, status: 0, json: async () => ({ message: e.message }) }));
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    process.stdout.write('\n');
    fail(`Resend didn't send it: ${j.message || `HTTP ${res.status}`}\n  Check that the domain in "${from}" is verified in Resend (Domains) and the key has sending access.`);
  }
  process.stdout.write(' sent.\n');
  ok(`Test email sent to ${testTo}. Check that inbox (and spam).`);
}

updateEnv({ RESEND_API_KEY: key, EMAIL_FROM: from });
ok('Saved to .env (this file never leaves your PC and is not in git).');

const fly = findFly();
if (!fly) {
  console.log(c.gold('\n  Fly.io tool not found: run "npm run cloud-setup" to copy these settings to the cloud server.\n'));
} else {
  const app = /^app = '([^']+)'/m.exec(fs.readFileSync(path.join(ROOT, 'fly.toml'), 'utf8'))?.[1] || 'roleplay20';
  const r = spawnSync(fly, ['secrets', 'import', '--stage', '-a', app], { cwd: ROOT, input: `RESEND_API_KEY=${key}\nEMAIL_FROM=${from}\n`, encoding: 'utf8', windowsHide: true });
  if (r.status !== 0) fail(`Couldn't save the settings on Fly.io:\n${(r.stderr || '').trim()}`);
  ok('Saved on the cloud server as secrets (values not shown). They switch on with the next deploy.');
}
console.log(`\n  ${c.bold('Done.')} Tell Claude "email is set up" (or run ${c.gold('npm run deploy')}) to switch it on.\n`);
