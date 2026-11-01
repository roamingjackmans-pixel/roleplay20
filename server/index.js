// Roleplay20 server: privacy gate, accounts, campaigns, characters, real-time game (Socket.IO) and the AI Dungeon Master.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { gateStatus, tryGate, requireGate, gateTokenValid } from './gate.js';
import * as auth from './auth.js';
import * as C from './game/campaign.js';
import * as E from './game/engine.js';
import * as K from './game/combat.js';
import { buildView, visibleLog } from './game/views.js';
import { srd, srdFile } from './srd.js';
import { aiStatus, MODELS } from './ai/client.js';
import { startTunnel } from './tunnel.js';
import { buildCharacter, applyLevelUp } from '../shared/charbuild.js';
import { randomId } from './security.js';

const app = express();
app.set('trust proxy', 'loopback');
app.disable('x-powered-by');
const BASE = config.basePath; // "/roleplay20"

// ---------------------------------------------------------------- CORS (the GitHub Pages shell calls us cross-origin)
function originAllowed(origin) {
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}
app.use((req, res, next) => {
  const origin = req.get('origin');
  if (origin && originAllowed(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-RP20-Gate');
    res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.set('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '2mb' }));

// ---------------------------------------------------------------- API
const api = express.Router();

api.get('/ping', (req, res) => res.json({ ok: true, name: 'Roleplay20', ai: aiStatus().configured, time: Date.now() }));
api.get('/gate/status', (req, res) => res.json(gateStatus(req)));
api.post('/gate', (req, res) => {
  const r = tryGate(req);
  res.status(r.ok ? 200 : r.status || 401).json(r);
});
api.get('/gate/check', (req, res) => res.json({ ok: gateTokenValid(req.get('x-rp20-gate')) }));

// everything below needs the gate
api.use(requireGate);

api.get('/app-manifest', (req, res) => {
  const gate = req.get('x-rp20-gate');
  const manifestFile = path.join(config.clientDist, '.vite', 'manifest.json');
  if (!fs.existsSync(manifestFile)) return res.status(503).json({ error: 'The app has not been built yet. Run `npm run build`.' });
  const man = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  const entry = man['index.html'] || Object.values(man).find((x) => x.isEntry);
  const prefix = `app/${encodeURIComponent(gate)}/`;
  const css = new Set(entry.css || []);
  for (const imp of entry.imports || []) for (const c of man[imp]?.css || []) css.add(c);
  res.json({ js: prefix + entry.file, css: [...css].map((c) => prefix + c) });
});

api.post('/auth/signup', (req, res) => {
  const r = auth.signup(req.body || {});
  res.status(r.error ? 400 : 200).json(r);
});
api.post('/auth/login', (req, res) => {
  const r = auth.login(req, req.body || {});
  res.status(r.error ? r.status || 401 : 200).json(r);
});

api.use(auth.requireUser);

api.get('/auth/me', (req, res) => res.json({ user: auth.publicUser(req.user), ai: aiStatus() }));
api.post('/auth/logout', (req, res) => { auth.logout(req.token); res.json({ ok: true }); });
api.post('/auth/prefs', (req, res) => res.json({ user: auth.updatePrefs(req.user.id, req.body || {}) }));
api.post('/auth/password', (req, res) => {
  const r = auth.changePassword(req.user.id, req.body?.oldPassword, req.body?.newPassword);
  res.status(r.error ? 400 : 200).json(r);
});

api.get('/srd/:name', (req, res) => {
  const f = srdFile(req.params.name);
  if (!f) return res.status(404).json({ error: 'not found' });
  res.set('Cache-Control', 'private, max-age=3600');
  res.sendFile(f);
});

function campaignFor(req, res, { owner = false } = {}) {
  const c = C.getCampaign(req.params.id);
  const m = c && C.member(c, req.user.id);
  if (!c || !m) { res.status(404).json({ error: 'Campaign not found.' }); return null; }
  if (owner && m.role !== 'owner') { res.status(403).json({ error: 'Only the campaign owner can do that.' }); return null; }
  return c;
}

api.get('/campaigns', (req, res) => {
  res.json({ campaigns: C.campaignsForUser(req.user.id).map((c) => C.campaignSummary(c, req.user.id)) });
});

api.post('/campaigns', (req, res) => {
  const b = req.body || {};
  const settings = {};
  for (const k of ['tone', 'inspiration', 'premise', 'magicLevel', 'lethality', 'shape', 'startLevel', 'lines', 'veils', 'pacing', 'model', 'effort', 'enemyTactics']) if (b.settings?.[k] !== undefined) settings[k] = b.settings[k];
  if (settings.model && !MODELS.includes(settings.model)) delete settings.model;
  settings.startLevel = Math.max(1, Math.min(5, Number(settings.startLevel) || 1));
  const c = C.newCampaign(req.user, { name: b.name, settings });
  E.runGenesis(c);
  res.json({ campaign: C.campaignSummary(c, req.user.id) });
});

api.post('/campaigns/join', (req, res) => {
  const c = C.campaignByInvite(req.body?.code);
  if (!c) return res.status(404).json({ error: 'No campaign has that invite code.' });
  C.joinCampaign(c, req.user.id);
  E.pushViews(c);
  res.json({ campaign: C.campaignSummary(c, req.user.id) });
});

api.get('/campaigns/:id', (req, res) => {
  const c = campaignFor(req, res);
  if (c) res.json({ campaign: C.campaignSummary(c, req.user.id), world: { bible: c.world.bible, characterPrompts: c.world.characterPrompts, title: c.world.title, tagline: c.world.tagline, openingHook: c.world.openingHook }, startLevel: c.settings.startLevel || 1, status: c.status, thinking: c.thinking, genesisError: c.genesisError || null });
});

api.patch('/campaigns/:id/settings', (req, res) => {
  const c = campaignFor(req, res, { owner: true });
  if (!c) return;
  const b = req.body || {};
  if (b.name) c.name = String(b.name).slice(0, 80);
  for (const k of ['enemyTactics', 'autoReadAloud', 'dmView', 'effort', 'lines', 'veils', 'pacing']) if (b[k] !== undefined) c.settings[k] = b[k];
  if (b.model && MODELS.includes(b.model)) c.settings.model = b.model;
  if (typeof b.worldBible === 'string') c.world.bible = b.worldBible;
  E.pushViews(c);
  res.json({ ok: true, settings: c.settings });
});

api.post('/campaigns/:id/regenerate', (req, res) => {
  const c = campaignFor(req, res, { owner: true });
  if (!c) return;
  if (c.sessionNumber > 0) return res.status(400).json({ error: 'The world is already in play.' });
  if (req.body?.settings) Object.assign(c.settings, req.body.settings);
  E.runGenesis(c);
  res.json({ ok: true });
});

api.delete('/campaigns/:id', (req, res) => {
  const c = campaignFor(req, res, { owner: true });
  if (!c) return;
  C.deleteCampaign(c);
  res.json({ ok: true });
});

api.post('/campaigns/:id/leave', (req, res) => {
  const c = campaignFor(req, res);
  if (!c) return;
  C.leaveCampaign(c, req.user.id);
  E.pushViews(c);
  res.json({ ok: true });
});

api.get('/characters', (req, res) => res.json({ characters: C.charactersForUser(req.user.id) }));

const SHEET_FIELDS = ['name', 'alignment', 'hp', 'deathSaves', 'equipment', 'currency', 'conditions', 'exhaustion', 'inspiration', 'personality', 'appearance', 'backstory', 'portrait', 'color', 'light', 'resources', 'acOverride', 'notes', 'concentration'];

function sanitizeCharacter(ch, ownerId, campaignId) {
  const out = { ...ch };
  out.id = randomId('ch_', 6);
  out.ownerId = ownerId;
  out.campaignId = campaignId;
  out.createdAt = Date.now();
  out.name = String(out.name || 'Nameless').slice(0, 60);
  if (typeof out.portrait === 'string' && out.portrait.length > 400000) out.portrait = null;
  out.hp ||= { max: 8, current: 8, temp: 0 };
  out.deathSaves ||= { success: 0, fail: 0 };
  out.conditions ||= [];
  out.equipment ||= [];
  out.currency ||= { cp: 0, sp: 0, ep: 0, gp: 0, pp: 0 };
  out.resources ||= {};
  out.xp ||= 0;
  return out;
}

api.post('/campaigns/:id/characters', (req, res) => {
  const c = campaignFor(req, res);
  if (!c) return;
  let ch = req.body?.character;
  if (!ch && req.body?.choices) {
    try { ch = buildCharacter(req.body.choices, srd()); } catch (e) { return res.status(400).json({ error: `Could not build that character: ${e.message}` }); }
  }
  if (!ch || !ch.class || !ch.race) return res.status(400).json({ error: 'Incomplete character.' });
  const saved = C.storeNewCharacter(sanitizeCharacter(ch, req.user.id, c.id));
  const m = C.member(c, req.user.id);
  m.characterId = saved.id;
  C.saveCampaign(c);
  // drop them into the current scene
  if (c.scene.tacticalMapId && !E.tokenForCharacter(c, saved.id)) {
    const map = c.maps.tactical[c.scene.tacticalMapId];
    const pos = map?.startZones?.party?.find(([x, y]) => !Object.values(c.tokens).some((t) => t.x === x && t.y === y));
    if (pos) E.addToken(c, { kind: 'pc', characterId: saved.id, name: saved.name, x: pos[0], y: pos[1], color: saved.color, img: saved.portrait, darkvision: saved.darkvision || 0 });
  }
  if (c.combat) K.addPcToCombat(c, saved);
  E.system(c, `🧙 ${saved.name} joins the party.`);
  E.pushViews(c);
  res.json({ character: saved });
});

api.put('/characters/:cid', (req, res) => {
  const ch = C.getCharacter(req.params.cid);
  if (!ch || ch.ownerId !== req.user.id) return res.status(404).json({ error: 'Character not found.' });
  const patch = req.body || {};
  for (const k of SHEET_FIELDS) if (patch[k] !== undefined) ch[k] = patch[k];
  if (patch.spellcasting && ch.spellcasting) {
    for (const k of ['slotsUsed', 'pactUsed', 'prepared']) if (patch.spellcasting[k] !== undefined) ch.spellcasting[k] = patch.spellcasting[k];
  }
  C.saveCharacter(ch);
  const c = C.getCampaign(ch.campaignId);
  if (c) {
    const tok = E.tokenForCharacter(c, ch.id);
    if (tok) { tok.name = ch.name; tok.img = ch.portrait; tok.color = ch.color; tok.light = ch.light && (ch.light.bright || ch.light.dim) ? ch.light : null; }
    E.pushViews(c);
  }
  res.json({ character: ch });
});

api.post('/characters/:cid/level-up', (req, res) => {
  const ch = C.getCharacter(req.params.cid);
  if (!ch || ch.ownerId !== req.user.id) return res.status(404).json({ error: 'Character not found.' });
  try {
    const next = applyLevelUp(ch, req.body || {}, srd());
    Object.assign(ch, next, { pendingLevelUp: false });
    C.saveCharacter(ch);
    const c = C.getCampaign(ch.campaignId);
    if (c) { E.system(c, `⬆️ ${ch.name} reaches level ${ch.level}!`, 'all', { tone: 'good' }); E.pushViews(c); }
    res.json({ character: ch });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

api.post('/campaigns/:id/character-assist', async (req, res) => {
  const c = campaignFor(req, res);
  if (!c) return;
  try {
    res.json({ suggestion: await E.characterAssist(c, req.user.id, req.body || {}) });
  } catch (e) {
    res.status(e.name === 'NoAIError' ? 503 : 500).json({ error: e.name === 'NoAIError' ? 'The AI Dungeon Master is not connected yet.' : e.message });
  }
});

api.use((err, req, res, next) => {
  console.error('[api]', err);
  res.status(500).json({ error: 'Server error.' });
});

app.use(['/api', `${BASE}/api`], api);

// ---------------------------------------------------------------- the app bundle (only after the gate)
app.use((req, res, next) => {
  const m = /^(?:\/roleplay20)?\/app\/([^/]+)\/(.+)$/.exec(req.path);
  if (!m) return next();
  if (!gateTokenValid(decodeURIComponent(m[1]))) return res.status(403).send('Enter the site password first.');
  const rel = path.normalize(decodeURIComponent(m[2])).replace(/^(\.\.[/\\])+/, '');
  const file = path.join(config.clientDist, rel);
  if (!file.startsWith(config.clientDist) || rel.startsWith('.vite')) return res.sendStatus(404);
  res.set('Cache-Control', /assets[/\\]/.test(rel) ? 'private, max-age=31536000, immutable' : 'no-cache');
  res.sendFile(file, (err) => { if (err) res.sendStatus(404); });
});

// ---------------------------------------------------------------- the public shell (gate page)
app.get('/', (req, res) => res.redirect(`${BASE}/`));
app.use(BASE, express.static(config.siteDir, { index: 'index.html', extensions: ['html'] }));

// ---------------------------------------------------------------- sockets
const server = http.createServer(app);
const io = new Server(server, {
  path: `${BASE}/socket.io`,
  cors: { origin: (origin, cb) => cb(null, originAllowed(origin)), credentials: false },
  maxHttpBufferSize: 2e6,
});
E.attachIO(io);

io.use((socket, next) => {
  const { token, gate } = socket.handshake.auth || {};
  if (!gateTokenValid(gate)) return next(new Error('gate'));
  const user = auth.userForToken(token);
  if (!user) return next(new Error('auth'));
  socket.data.userId = user.id;
  next();
});

const wrap = (fn) => async (payload, ack) => {
  try {
    const r = await fn(payload || {});
    if (typeof ack === 'function') ack(r ?? { ok: true });
  } catch (e) {
    console.error('[socket]', e);
    if (typeof ack === 'function') ack({ error: 'Something went wrong on the server.' });
  }
};

io.on('connection', (socket) => {
  const userId = socket.data.userId;
  let c = null;
  const isOwner = () => c && C.member(c, userId)?.role === 'owner';
  const need = (owner = false) => {
    if (!c) return { error: 'Join a campaign first.' };
    if (owner && !isOwner()) return { error: 'Only the campaign owner can do that.' };
    return null;
  };

  socket.on('join', wrap(({ campaignId }) => {
    const camp = C.getCampaign(campaignId);
    if (!camp || !C.member(camp, userId)) return { error: 'Campaign not found.' };
    if (c) { socket.leave(`c:${c.id}`); E.setOnline(c, userId, socket.id, false); E.pushViews(c); }
    c = camp;
    socket.join(`c:${c.id}`);
    E.setOnline(c, userId, socket.id, true);
    const m = C.member(c, userId);
    if (m) m.away = false;
    E.pushViews(c);
    return { ok: true, view: buildView(c, userId), log: visibleLog(c, userId) };
  }));

  socket.on('disconnect', () => {
    if (!c) return;
    E.setOnline(c, userId, socket.id, false);
    E.pushViews(c);
    setTimeout(() => { if (c) E.maybeResolve(c); }, 1500);
  });

  socket.on('action', wrap((p) => need() || E.submitAction(c, userId, p)));
  socket.on('action:withdraw', wrap(() => need() || E.withdrawAction(c, userId)));
  socket.on('force', wrap(() => need(true) || (E.maybeResolve(c, true), { ok: true })));
  socket.on('away', wrap(({ away }) => { if (need()) return need(); const m = C.member(c, userId); m.away = !!away; E.pushViews(c); E.maybeResolve(c); return { ok: true }; }));
  socket.on('roll:respond', wrap((p) => need() || E.respondRoll(c, userId, p.requestId, p)));
  socket.on('roll:free', wrap((p) => need() || E.freeRoll(c, userId, p)));
  socket.on('token:move', wrap((p) => need() || E.moveTokenFree(c, userId, p.tokenId, p.x | 0, p.y | 0)));
  socket.on('ping', wrap((p) => need() || (E.ping(c, userId, p.x | 0, p.y | 0), { ok: true })));
  socket.on('chat', wrap((p) => need() || (E.chat(c, userId, p.text), { ok: true })));
  socket.on('notes', wrap((p) => { if (need()) return need(); c.notes[userId] = String(p.text || '').slice(0, 50000); C.saveCampaign(c); return { ok: true }; }));

  socket.on('combat:attack', wrap((p) => need() || K.attack(c, userId, p)));
  socket.on('combat:damage', wrap((p) => need() || K.damage(c, userId, p)));
  socket.on('cast', wrap((p) => need() || K.castSpell(c, userId, p)));
  socket.on('combat:action', wrap((p) => need() || K.takeAction(c, userId, p)));
  socket.on('combat:ask', wrap((p) => need() || K.combatAsk(c, userId, p.text)));
  socket.on('combat:endTurn', wrap(() => need() || K.endTurn(c, userId)));
  socket.on('combat:skip', wrap(() => need(true) || K.skipTurn(c)));
  socket.on('combat:end', wrap((p) => need(true) || K.endCombatManual(c, p.outcome)));

  socket.on('sheet:rest', wrap((p) => {
    if (need()) return need();
    if (c.combat) return { error: "You can't rest in the middle of a fight." };
    const ch = C.getCharacter(C.member(c, userId)?.characterId);
    if (!ch) return { error: 'No character.' };
    if (p.kind === 'long') { E.longRest(ch); E.system(c, `🌙 ${ch.name} takes a long rest.`); }
    else {
      E.shortRest(ch);
      const n = Math.max(0, Math.min(Number(p.hitDice) || 0, ch.hitDice.total - (ch.hitDice.used || 0)));
      let healed = 0;
      const con = Math.floor(((ch.abilities?.con || 10) - 10) / 2);
      for (let i = 0; i < n; i++) { healed += Math.max(1, Math.ceil(Math.random() * ch.hitDice.die) + con); }
      ch.hitDice.used = (ch.hitDice.used || 0) + n;
      if (healed) E.healCharacter(c, ch, healed); else C.saveCharacter(ch);
      E.system(c, `☕ ${ch.name} takes a short rest${n ? `, spending ${n} Hit ${n === 1 ? 'Die' : 'Dice'} to recover ${healed} HP` : ''}.`);
    }
    E.pushViews(c);
    return { ok: true };
  }));

  socket.on('session:start', wrap(() => need(true) || E.startSession(c)));
  socket.on('session:end', wrap(() => need(true) || E.endSession(c)));
  socket.on('dm:retry', wrap(() => need() || E.retryTurn(c)));
  socket.on('dm:narrate', wrap((p) => need(true) || E.manualNarration(c, p)));
  socket.on('dm:settings', wrap((p) => {
    if (need(true)) return need(true);
    for (const k of ['enemyTactics', 'autoReadAloud', 'dmView', 'effort']) if (p[k] !== undefined) c.settings[k] = p[k];
    if (p.model && MODELS.includes(p.model)) c.settings.model = p.model;
    E.pushViews(c);
    return { ok: true };
  }));
});

server.listen(config.port, async () => {
  const local = `http://localhost:${config.port}${BASE}/`;
  console.log(`\n  🎲 Roleplay20 is running at ${local}`);
  const ai = aiStatus();
  console.log(`  🧠 AI Dungeon Master: ${ai.configured ? `${ai.provider} (${config.defaultModel})` : 'NOT CONNECTED - add ANTHROPIC_API_KEY to .env'}`);
  if (!config.gateHash) console.log('  🔒 Site password: NOT SET - run `npm run setup`');
  if (!fs.existsSync(path.join(config.clientDist, '.vite', 'manifest.json'))) console.log('  ⚠️  The app is not built yet - run `npm run build`');
  srd();
  try { await startTunnel(); } catch (e) { console.warn('  🌐 Public tunnel not started:', e.message); }
});
