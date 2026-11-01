// Moves Roleplay20 to the cloud so nothing has to run on this PC:
// installs the Fly.io tool, signs you in, creates the always-on server and its saved-game disk, copies your settings
// from .env as Fly secrets (values are never shown), deploys, moves your saved games once and points
// josephjackman.com/roleplay20 at the new server. Safe to run again.
//   npm run cloud-setup     first time, or after changing .env (new API key, new site password)
//   npm run deploy          push code changes to the cloud server
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeBundle, BUNDLE_PATH } from '../server/restore.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const MARKER = path.join(DATA, 'moved-to-cloud.json');
const DEPLOY_ONLY = process.argv.includes('--deploy');
const REGION = 'ord';
const VOLUME = 'rp20_data';
const SECRET_KEYS = ['ANTHROPIC_API_KEY', 'GATE_PASSWORD_HASH', 'SERVER_SECRET', 'DM_MODEL', 'DM_EFFORT', 'RESEND_API_KEY', 'EMAIL_FROM'];

const c = { gold: (s) => `\x1b[33m${s}\x1b[0m`, green: (s) => `\x1b[32m${s}\x1b[0m`, red: (s) => `\x1b[31m${s}\x1b[0m`, dim: (s) => `\x1b[2m${s}\x1b[0m`, bold: (s) => `\x1b[1m${s}\x1b[0m` };
const ok = (s) => console.log(c.green(`  ✓ ${s}`));
const fail = (s) => { console.log(c.red(`\n  ✗ ${s}\n`)); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readEnv() {
  const out = {};
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[2] !== '') out[m[1]] = m[2];
  }
  return out;
}

function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl.question(question, (a) => { rl.close(); resolve(a.trim()); });
  });
}

function findFly() {
  const bin = path.join(os.homedir(), '.fly', 'bin');
  for (const f of ['flyctl.exe', 'fly.exe', 'flyctl']) if (fs.existsSync(path.join(bin, f))) return path.join(bin, f);
  for (const cmd of ['flyctl', 'fly']) {
    const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.split(/\r?\n/)[0].trim();
  }
  return null;
}

let FLY = null;
/** Run flyctl. `show` streams its output to this window; otherwise output is captured (and secrets never printed). */
function fly(args, { input, show = false, allowFail = false } = {}) {
  const r = spawnSync(FLY, args, { cwd: ROOT, encoding: 'utf8', input, windowsHide: true, stdio: show ? [input ? 'pipe' : 'inherit', 'inherit', 'inherit'] : 'pipe' });
  if (r.status !== 0 && !allowFail) fail(`fly ${args[0]} ${args[1] || ''} failed${r.stderr ? `:\n${r.stderr.trim()}` : ''}`);
  return { status: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
}

const flyToml = path.join(ROOT, 'fly.toml');
const readApp = () => /^app = '([^']+)'/m.exec(fs.readFileSync(flyToml, 'utf8'))?.[1] || 'roleplay20';
const writeApp = (name) => fs.writeFileSync(flyToml, fs.readFileSync(flyToml, 'utf8').replace(/^app = '[^']*'/m, `app = '${name}'`));

async function waitUntilUp(url, seconds = 90) {
  for (let t = 0; t < seconds; t += 3) {
    try {
      const r = await fetch(`${url}api/ping`, { signal: AbortSignal.timeout(5000) });
      if (r.ok && (await r.json()).name === 'Roleplay20') return true;
    } catch { /* not yet */ }
    await sleep(3000);
  }
  return false;
}

console.log(`\n${c.gold(c.bold(DEPLOY_ONLY ? '  🎲 Roleplay20: deploy to the cloud' : '  🎲 Roleplay20: move to the cloud (Fly.io)'))}\n`);

const env = readEnv();
if (!env.GATE_PASSWORD_HASH || !env.SERVER_SECRET) fail('The site password is not set yet. Run `npm run setup` first.');
if (!env.ANTHROPIC_API_KEY) console.log(c.gold('  ! No ANTHROPIC_API_KEY in .env: the cloud server will run without the AI Dungeon Master until you add one.'));

// 1. the Fly.io command-line tool
FLY = findFly();
if (!FLY) {
  if (process.platform !== 'win32') fail('Install flyctl first: https://fly.io/docs/flyctl/install/');
  const a = await ask(`  The Fly.io command-line tool is needed. Install it now with Fly's official installer? ${c.dim('(Y/n)')} `);
  if (/^n/i.test(a)) fail('Install it from https://fly.io/docs/flyctl/install/ and run this again.');
  spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'iwr https://fly.io/install.ps1 -useb | iex'], { stdio: 'inherit' });
  FLY = findFly();
  if (!FLY) fail('The Fly.io tool did not install. Get it from https://fly.io/docs/flyctl/install/ and run this again.');
}
ok('Fly.io tool is installed.');

// 2. sign in
if (fly(['auth', 'whoami'], { allowFail: true }).status !== 0) {
  console.log(`\n  ${c.bold('A browser window will open.')} Sign up or sign in to Fly.io there, then come back to this window.`);
  console.log(c.dim('  New account? Add a card under Billing in the Fly.io dashboard; this server costs about $4 a month.\n'));
  fly(['auth', 'login'], { show: true, allowFail: true });
  if (fly(['auth', 'whoami'], { allowFail: true }).status !== 0) fail('Not signed in to Fly.io. Run this again to retry.');
}
ok(`Signed in to Fly.io as ${fly(['auth', 'whoami']).out}.`);

// 3. the app (its name is the address: <name>.fly.dev)
let app = readApp();
if (!DEPLOY_ONLY) {
  const listed = JSON.parse(fly(['apps', 'list', '--json']).out || '[]');
  const mine = listed.map((a) => a.Name || a.name || a.ID).filter(Boolean);
  if (!mine.includes(app)) {
    const names = [app, ...Array.from({ length: 3 }, () => `roleplay20-${crypto.randomBytes(2).toString('hex')}`)];
    let made = null;
    for (const name of names) {
      const r = fly(['apps', 'create', name, '--org', 'personal'], { allowFail: true });
      if (r.status === 0) { made = name; break; }
      if (!/taken|already|exists|unavailable/i.test(r.err + r.out)) fail(`Could not create the Fly.io app:\n${r.err || r.out}\n  (New accounts need a card under Billing first.)`);
    }
    if (!made) fail('Could not find a free app name. Edit `app` in fly.toml and run this again.');
    app = made;
    writeApp(app);
  }
  ok(`Cloud server app: ${app}`);

  // 4. the disk that holds accounts, campaigns and characters
  const vols = JSON.parse(fly(['volumes', 'list', '-a', app, '--json']).out || '[]');
  if (!vols.some((v) => (v.Name || v.name) === VOLUME)) fly(['volumes', 'create', VOLUME, '--region', REGION, '--size', '1', '--yes', '-a', app], { show: true });
  ok('Saved-game disk is ready (1 GB).');

  // 5. settings from .env, sent straight to Fly (never printed)
  const keys = SECRET_KEYS.filter((k) => env[k]);
  const input = keys.map((k) => `${k}=${env[k]}`).join('\n') + '\n';
  let r = fly(['secrets', 'import', '--stage', '-a', app], { input, allowFail: true });
  if (r.status !== 0 && /unknown flag/i.test(r.err)) r = fly(['secrets', 'import', '-a', app], { input, allowFail: true });
  if (r.status !== 0) fail(`Could not save the settings as Fly secrets:\n${r.err}`);
  ok(`Copied ${keys.length} settings from .env as Fly secrets (values not shown).`);
}

// 6. build the app and deploy it
console.log(`\n${c.bold('  Building the app…')}`);
if (spawnSync('npm run build:client', { cwd: ROOT, stdio: 'inherit', shell: true }).status !== 0) fail('The app did not build.');
console.log(`\n${c.bold('  Deploying to Fly.io…')} ${c.dim('(the first time takes a few minutes)')}`);
fly(['deploy', '--ha=false', '-a', app], { show: true });
const url = `https://${app}.fly.dev/roleplay20/`;
if (!(await waitUntilUp(url))) fail(`The server deployed but is not answering at ${url}. See \`fly logs -a ${app}\`.`);
ok(`The cloud server is live at ${url}`);

if (!DEPLOY_ONLY) {
  // 7. move the saved games from this PC (first time only; --move-data forces it, replacing what is in the cloud)
  if (!fs.existsSync(MARKER) || process.argv.includes('--move-data')) {
    const { count, gz } = fs.existsSync(DATA) ? makeBundle(DATA) : { count: 0 };
    if (count) {
      const tmp = path.join(os.tmpdir(), `rp20-bundle-${Date.now()}.json.gz`);
      fs.writeFileSync(tmp, gz);
      fly(['ssh', 'console', '-a', app, '-C', 'mkdir -p /data/import']);
      fly(['ssh', 'sftp', 'put', tmp, `/data/${BUNDLE_PATH}`, '-a', app]);
      fs.unlinkSync(tmp);
      fly(['apps', 'restart', app]);
      if (!(await waitUntilUp(url))) fail(`The server did not come back after moving the saved games. See \`fly logs -a ${app}\`.`);
      ok(`Moved ${count} saved files (accounts, campaigns, characters) to the cloud.`);
    }
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(MARKER, JSON.stringify({ app, at: new Date().toISOString(), files: count }));
  } else ok('Saved games were already moved earlier (kept the cloud copy).');

  // 8. point josephjackman.com/roleplay20 at the cloud server, and end any old PC tunnel
  const { publishToGitHub, stopTunnel } = await import('../server/tunnel.js');
  try { await publishToGitHub(url); ok('josephjackman.com/roleplay20 now points at the cloud server.'); }
  catch (e) { console.log(c.red(`  ✗ Could not update the website's server address (${e.message}). Run \`gh auth login\`, then run this again.`)); }
  if (stopTunnel()) ok('Stopped the old tunnel on this PC.');
}

console.log(`\n${c.gold(c.bold('  All set!'))} Roleplay20 runs in the cloud now; nothing needs to stay on in this PC.`);
console.log(c.dim(`  Play: https://josephjackman.com/roleplay20   Logs: fly logs -a ${app}   Billing: https://fly.io/dashboard\n`));
