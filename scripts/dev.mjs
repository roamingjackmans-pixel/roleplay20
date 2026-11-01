// Development: game server (no tunnel) + Vite dev server with hot reload.
// The app at http://localhost:5173 talks to the server at http://localhost:3020.
import { spawn } from 'node:child_process';

const procs = [
  spawn(process.execPath, ['server/index.js', '--no-tunnel', ...process.argv.slice(2)], { stdio: 'inherit' }),
  spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['vite', '--config', 'client/vite.config.js'], { stdio: 'inherit', shell: process.platform === 'win32' }),
];
const stop = () => { for (const p of procs) p.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const p of procs) p.on('exit', (code) => { if (code) stop(); });
