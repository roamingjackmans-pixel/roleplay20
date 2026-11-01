// Makes this PC reachable from josephjackman.com/roleplay20 without opening router ports:
// starts a free Cloudflare quick tunnel (no account needed) and publishes its address to the `live` branch of the
// GitHub repo, where the public gate page looks it up.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { config, ROOT } from './config.js';

let current = null;
let child = null;
let restarts = 0;

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
  const body = JSON.stringify({ url, updatedAt: new Date().toISOString() }, null, 1) + '\n';
  // make sure the branch exists
  try {
    await gh(['api', `repos/${repo}/git/ref/heads/${branch}`]);
  } catch {
    const main = JSON.parse(await gh(['api', `repos/${repo}/git/ref/heads/main`]));
    await gh(['api', '-X', 'POST', `repos/${repo}/git/refs`, '-f', `ref=refs/heads/${branch}`, '-f', `sha=${main.object.sha}`]);
  }
  let sha = '';
  try { sha = JSON.parse(await gh(['api', `repos/${repo}/contents/server.json?ref=${branch}`])).sha; } catch { /* new file */ }
  const payload = JSON.stringify({ message: `Server address ${new Date().toISOString()}`, content: Buffer.from(body).toString('base64'), branch, ...(sha ? { sha } : {}) });
  await gh(['api', '-X', 'PUT', `repos/${repo}/contents/server.json`, '--input', '-'], payload);
}

async function publish(url) {
  current = url;
  fs.writeFileSync(path.join(config.dataDir, 'public-url.json'), JSON.stringify({ url, at: Date.now() }));
  console.log(`  🌐 Public address: ${url}`);
  try {
    await publishToGitHub(url);
    console.log('  📡 Published to GitHub - josephjackman.com/roleplay20 will find this server.');
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

function launch(bin) {
  return new Promise((resolve) => {
    const args = ['tunnel', '--no-autoupdate', '--url', `http://localhost:${config.port}`];
    child = spawn(bin, args, { windowsHide: true });
    let found = false;
    const onData = (buf) => {
      const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(buf.toString());
      if (m && !found) {
        found = true;
        restarts = 0;
        resolve(`${m[0]}${config.basePath}/`);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => {
      child = null;
      if (!found) resolve(null);
      console.warn(`  🌐 Tunnel stopped (code ${code}). Restarting…`);
      const delay = Math.min(60000, 3000 * 2 ** restarts++);
      setTimeout(() => startTunnel().catch(() => {}), delay);
    });
  });
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
  const url = await launch(bin);
  if (!url) return;
  // wait until the new hostname resolves before telling the world about it
  for (let i = 0; i < 20 && !(await healthy(url)); i++) await new Promise((r) => setTimeout(r, 3000));
  await publish(url);
  // keep an eye on it
  const timer = setInterval(async () => {
    if (current !== url) return clearInterval(timer);
    if (!(await healthy(url))) {
      console.warn('  🌐 Tunnel is not answering; restarting it.');
      clearInterval(timer);
      if (child) child.kill(); else startTunnel().catch(() => {});
    }
  }, 5 * 60000);
}

process.on('exit', () => { if (child) child.kill(); });
