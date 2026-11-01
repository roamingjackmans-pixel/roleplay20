// Clears every site-password lockout (for the host, e.g. when a friend fat-fingered the password three times).
// Run with:  npm run unlock   (restart the server afterwards)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(ROOT, process.env.DATA_DIR || 'data');
const file = path.join(dataDir, 'gate.json');
if (fs.existsSync(file)) {
  fs.writeFileSync(file, JSON.stringify({ ips: {}, devices: {} }));
  console.log('All lockouts cleared. Restart the server (close and reopen Start Roleplay20.bat).');
} else {
  console.log('No lockouts recorded.');
}
