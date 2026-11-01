// Makes this PC reachable from josephjackman.com/roleplay20 without opening router ports:
// runs a free Cloudflare quick tunnel (no account needed) and publishes its address to the `live` branch of the
// GitHub repo, where the public gate page looks it up.
//
// The tunnel runs as its own background process, so restarting the game server keeps the same public address
// (players' pages simply reconnect). It is replaced only if it dies or stops answering. `npm run stop-tunnel` ends it.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { config, ROOT } from './config.js';

const STATE = path.join(config.dataDir, 'tunnel.json'); // { pid, url, startedAt }
const LOG = path.join(config.dataDir, 'cloudflared.log');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let current = null;
let monitorTimer = null;

export const publicUrl = () => current;

function which(cmd) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    for (const e of exts) {
      const p = path.join(dir, cmd + e);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

export function findCloudflared() {
  const candidates = [config.cloudflaredPath, path.join(ROOT, 'bin', 'cloudflared.exe'), path.join(ROOT, 'bin', 'cloudflared'),
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe', 'C:\\Program Files\\cloudflared\\cloudflared.exe'].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  return which('cloudflared');
}

function gh(args, input) {
  return new Promise((resolve, reject) => {
    const p = execFile('gh', args, { windowsHide: true, maxBuffer: 1 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error((stderr || err.message).toString().trim().slice(0, 300)));
      resolve(stdout.toString());
    });
    if (input) { p.stdin.write(input); p.stdin.end(); }
  });
}

async function publishToGitHub(url) {
  const repo = config.publishRepo;
  const branch = config.publishBranch;
  try {
    await gh(['api', `repos/${repo}/git/ref/heads/${branch}`]);
  } catch {
    const main = JSON.parse(await gh(['api', `repos/${repo}/git/ref/heads/main`]));
    await gh(['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${main.object.sha}`]);
  }
  let sha = '';
  try {
    const cur = JSON.parse(await gh(['api', `repos/${repo}/contents/server.json?ref=${branch}`]));
    sha = cur.sha;
    const published = JSON.parse(Buffer.from(cur.content || '', 'base64').toString('utf8') || '{}');
    if (published.url === url) return 'unchanged';
  } catch { /* new file */ }
  const body = JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 1) + '\n';
  const payload = JSON.stringify({ message: `Server address ${new Date().toISOString()}`, content: Buffer.from(body).toString('base64'), branch, ...(sha ? { sha } : {}) });
  await gh(['api', '-X', 'PUT', `repos/${repo}/contents/server.json`, '--input', '-'], payload);
  return 'published';
}

async function publish(url) {
  current = url;
  fs.writeFileSync(path.join(config.dataDir, 'public-url.json'), JSON.stringify({ url, at: Date.now() }));
  console.log(`  🌐 Public address: ${url}`);
  try {
    const r = await publishToGitHub(url);
    console.log(r === 'unchanged' ? '  📡 Same address as before - players reconnect on their own.' : '  📡 Published to GitHub - josephjackman.com/roleplay20 will find this server.');
  } catch (e) {
    console.warn(`  📡 Could not publish the address to GitHub (${e.message}). Players can still use ?server=${url}`);
  }
}

async function healthy(url) {
  try {
    const r = await fetch(`${url}api/ping`, { signal: AbortSignal.timeout(10000) });
    return r.ok;
  } catch {
    return false;
  }
}

function alive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; }
}

/** A tunnel left running by an earlier server start, if it still works. */
async function reuseExisting() {
  const s = readState();
  if (!s?.url || !alive(s.pid)) return null;
  for (let i = 0; i < 6; i++) {
    if (await healthy(s.url)) return s;
    await sleep(2000);
  }
  try { process.kill(s.pid); } catch { /* already gone */ }
  return null;
}

/** Start cloudflared as an independent background process that outlives this server. */
async function launchDetached(bin) {
  fs.writeFileSync(LOG, '');
  const out = fs.openSync(LOG, 'a');
  const child = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.port}`], { detached: true, stdio: ['ignore', out, out], windowsHide: true });
  child.unref();
  fs.closeSync(out);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    await sleep(500);
    const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(fs.readFileSync(LOG, 'utf8'));
    if (m) {
      const s = { pid: child.pid, url: `${m[0]}${config.basePath}/`, startedAt: Date.now() };
      fs.writeFileSync(STATE, JSON.stringify(s));
      return s;
    }
    if (!alive(child.pid)) break;
  }
  return null;
}

function monitor(s) {
  clearInterval(monitorTimer);
  let fails = 0;
  monitorTimer = setInterval(async () => {
    if (await healthy(s.url)) { fails = 0; return; }
    if (++fails < 2) return;
    console.warn('  🌐 The tunnel stopped answering; starting a new one.');
    clearInterval(monitorTimer);
    try { process.kill(s.pid); } catch { /* gone */ }
    startTunnel().catch((e) => console.warn('  🌐 Tunnel restart failed:', e.message));
  }, 3 * 60000);
}

export async function startTunnel() {
  if (config.tunnel === 'off') return;
  if (config.publicUrl) {
    await publish(config.publicUrl.endsWith('/') ? config.publicUrl : `${config.publicUrl}/`);
    return;
  }
  const bin = findCloudflared();
  if (!bin) {
    console.log('  🌐 cloudflared not found - only reachable on this network. Run `npm run setup` to install it.');
    return;
  }
  let s = await reuseExisting();
  if (s) console.log('  🌐 Reusing the running tunnel.');
  else {
    s = await launchDetached(bin);
    if (!s) { console.warn(`  🌐 cloudflared did not start a tunnel (see ${LOG}). Retrying in a minute.`); setTimeout(() => startTunnel().catch(() => {}), 60000); return; }
    for (let i = 0; i < 20 && !(await healthy(s.url)); i++) await sleep(3000);
  }
  await publish(s.url);
  monitor(s);
}

/** Used by `npm run stop-tunnel`. */
export function stopTunnel() {
  const s = readState();
  if (s?.pid && alive(s.pid)) { process.kill(s.pid); return true; }
  return false;
}
