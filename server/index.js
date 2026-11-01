// Roleplay20 server: privacy gate, accounts, campaigns, characters, real-time game (Socket.IO) and the AI Dungeon Master.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import { Server } from 'socket.io';
import { config } from './config.js';
import { gateStatus, tryGate, requireGate, gateTokenValid } from './gate.js';
import * as auth from './auth.js';
import * as sec from './accountSecurity.js';
import { emailStatus } from './email.js';
import * as C from './game/campaign.js';
import * as E from './game/engine.js';
import * as K from './game/combat.js';
import { buildView, visibleLog } from './game/views.js';
import { srd, srdFile } from './srd.js';
import { aiStatus, MODELS } from './ai/client.js';
import { startTunnel } from './tunnel.js';
import { buildCharacter, applyLevelUp, levelUpPlan } from '../shared/charbuild.js';
import { deriveCharacter, levelForXp, xpForLevel } from '../shared/rules.js';
import { randomId } from './security.js';
import { sheetPatchError, applySheetPatch } from './sheetRules.js';

const app = express();
app.set('trust proxy', process.env.FLY_APP_NAME ? 1 : 'loopback'); // Fly.io: one edge proxy in front of us
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

// account security answers carry their own HTTP status
const reply = (res, r) => { const { status, ...body } = r || {}; res.status(status || (body.error ? 400 : 200)).json(body); };
const bearerUser = (req) => { const h = req.get('authorization') || ''; return h.startsWith('Bearer ') ? auth.userForToken(h.slice(7)) : null; };

// signing up and in: a 6-digit email code when the device is new (or hasn't signed in for 30 days)
api.get('/auth/options', (req, res) => res.json(sec.securityOptions()));
api.post('/auth/signup', async (req, res) => reply(res, await sec.signUp(req, req.body || {})));
api.post('/auth/login', async (req, res) => reply(res, await sec.signIn(req, req.body || {})));
api.post('/auth/verify', (req, res) => reply(res, sec.verifySignIn(req, req.body || {})));
api.post('/auth/resend', async (req, res) => reply(res, await sec.resendCode(req, req.body || {}, bearerUser(req))));
api.post('/auth/signup-email', async (req, res) => reply(res, await sec.fixSignUpEmail(req, req.body || {})));
api.post('/auth/forgot', async (req, res) => reply(res, await sec.forgotPassword(req, req.body || {})));
api.post('/auth/reset', async (req, res) => reply(res, await sec.resetPassword(req, req.body || {})));

api.use(auth.requireUser);

api.get('/auth/me', (req, res) => res.json({ user: auth.publicUser(req.user), ai: aiStatus(), security: sec.securityOptions() }));
api.post('/auth/logout', (req, res) => { auth.logout(req.token); res.json({ ok: true }); });
api.post('/auth/prefs', (req, res) => res.json({ user: auth.updatePrefs(req.user.id, req.body || {}) }));
// changing email or password while signed in: first a code to the current email
api.post('/auth/security/code', async (req, res) => reply(res, await sec.requestChangeCode(req.user, req.body || {})));
api.post('/auth/password', async (req, res) => reply(res, await sec.changePassword(req.user, req.token, req.body || {})));
api.post('/auth/email', async (req, res) => reply(res, await sec.startEmailChange(req.user, req.body || {})));
api.post('/auth/email/confirm', async (req, res) => reply(res, await sec.confirmEmailChange(req.user, req.body || {})));

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
  if (c) res.json({ campaign: C.campaignSummary(c, req.user.id), world: { bible: c.world.bible, characterPrompts: c.world.characterPrompts, title: c.world.title, tagline: c.world.tagline, openingHook: c.world.openingHook }, startLevel: E.joinLevel(c), status: c.status, thinking: c.thinking, genesisError: c.genesisError || null });
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
  delete out.retired;
  delete out.dead;
  return out;
}

// A new character joins at the party's level (with matching experience), so a replacement hero is never behind.
api.post('/campaigns/:id/characters', (req, res) => {
  const c = campaignFor(req, res);
  if (!c) return;
  const m = C.member(c, req.user.id);
  const old = m?.characterId ? C.getCharacter(m.characterId) : null;
  if (old && !old.retired) return res.status(409).json({ error: `You already play ${old.name}. To start someone new, retire ${old.name} at the bottom of the character sheet.` });
  const level = E.joinLevel(c);
  let ch = req.body?.character;
  if (!ch && req.body?.choices) {
    try { ch = buildCharacter({ ...req.body.choices, level }, srd()); } catch (e) { return res.status(400).json({ error: `Could not build that character: ${e.message}` }); }
  }
  if (!ch || !ch.class || !ch.race) return res.status(400).json({ error: 'Incomplete character.' });
  const fresh = sanitizeCharacter(ch, req.user.id, c.id);
  fresh.xp = Math.max(Number(fresh.xp) || 0, E.joinXp(c, fresh.level || 1));
  fresh.pendingLevelUp = false;
  const saved = C.storeNewCharacter(fresh);
  m.characterId = saved.id;
  delete m.rebuilding;
  C.saveCampaign(c);
  // drop them into the current scene
  if (c.scene.tacticalMapId && !E.tokenForCharacter(c, saved.id)) {
    const map = c.maps.tactical[c.scene.tacticalMapId];
    const pos = map?.startZones?.party?.find(([x, y]) => !Object.values(c.tokens).some((t) => t.x === x && t.y === y));
    if (pos) E.addToken(c, { kind: 'pc', characterId: saved.id, name: saved.name, x: pos[0], y: pos[1], color: saved.color, img: saved.portrait, darkvision: saved.darkvision || 0 });
  }
  if (c.combat) K.addPcToCombat(c, saved);
  E.characterJoined(c, saved, req.user.id);
  E.pushViews(c);
  res.json({ character: saved });
});

// The sheet can't add or restore anything: the DM, the rules engine and the level-up wizard change stats (sheetRules.js).
api.put('/characters/:cid', (req, res) => {
  const ch = C.getCharacter(req.params.cid);
  if (!ch || ch.ownerId !== req.user.id) return res.status(404).json({ error: 'Character not found.' });
  const c = C.getCampaign(ch.campaignId);
  const patch = req.body || {};
  let preparedMax = null;
  try { preparedMax = deriveCharacter(ch, srd()).spellcasting?.preparedMax ?? null; } catch { /* rules data missing: no cap */ }
  const blocked = sheetPatchError(ch, patch, { sessionError: c ? E.canAct(c)?.error || null : 'This character has no campaign.', inCombat: !!c?.combat, preparedMax });
  if (blocked) return res.status(403).json({ error: blocked });
  applySheetPatch(ch, patch);
  C.saveCharacter(ch);
  if (c) {
    const tok = E.tokenForCharacter(c, ch.id);
    if (tok) { tok.name = ch.name; tok.img = ch.portrait; tok.color = ch.color; tok.light = ch.light && (ch.light.bright || ch.light.dim) ? ch.light : null; }
    E.pushViews(c);
  }
  res.json({ character: ch });
});

// Levels come from experience (combat, quests, milestones). Level up during a session, in any class you have or a new one.
api.post('/characters/:cid/level-up', (req, res) => {
  const ch = C.getCharacter(req.params.cid);
  if (!ch || ch.ownerId !== req.user.id) return res.status(404).json({ error: 'Character not found.' });
  const c = C.getCampaign(ch.campaignId);
  if (ch.retired || ch.dead) return res.status(403).json({ error: `${ch.name} can't level up any more.` });
  if (!(ch.pendingLevelUp || levelForXp(ch.xp) > ch.level)) return res.status(400).json({ error: 'No level-up is waiting. Levels come from the experience the DM awards.' });
  const blocked = c ? E.canAct(c) : { error: 'This character has no campaign.' };
  if (blocked) return res.status(403).json({ error: `Level up during a session. ${blocked.error}` });
  if (c.combat) return res.status(403).json({ error: 'Level up after the fight.' });
  try {
    const plan = levelUpPlan(ch, srd(), req.body?.class);
    if (plan.maxed) return res.status(400).json({ error: `${ch.name} is already level 20.` });
    if (plan.multiclass && !plan.prereqOk) return res.status(400).json({ error: `Can't multiclass yet: ${plan.prereqProblems.join('; ')}.` });
    const next = applyLevelUp(ch, req.body || {}, srd());
    Object.assign(ch, next);
    ch.xp = Math.max(Number(ch.xp) || 0, xpForLevel(ch.level));
    ch.pendingLevelUp = levelForXp(ch.xp) > ch.level;
    C.saveCharacter(ch);
    E.system(c, `⬆️ ${ch.name} reaches level ${ch.level}${plan.multiclass ? ` and becomes a ${titleCase(plan.classKey)} too` : ''}!`, 'all', { tone: 'good' });
    E.pushViews(c);
    res.json({ character: ch });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Retiring (or after death): the character leaves play for good, but their story stays in the journal and the world.
api.post('/characters/:cid/retire', (req, res) => {
  const ch = C.getCharacter(req.params.cid);
  if (!ch || ch.ownerId !== req.user.id) return res.status(404).json({ error: 'Character not found.' });
  const c = C.getCampaign(ch.campaignId);
  if (!c) return res.status(404).json({ error: 'Campaign not found.' });
  const r = E.retireCharacter(c, ch, req.user.id, String(req.body?.farewell || '').slice(0, 400));
  if (r.error) return res.status(400).json(r);
  res.json(r);
});

const titleCase = (k) => String(k || '').replace(/(^|[-_ ])(\w)/g, (_, s, ch) => `${s ? ' ' : ''}${ch.toUpperCase()}`);

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
  // game actions need a running session with every player at the table (looking around and table talk never do)
  const act = (owner = false) => need(owner) || E.canAct(c);

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

  socket.on('action', wrap((p) => act() || E.submitAction(c, userId, p)));
  socket.on('action:withdraw', wrap(() => act() || E.withdrawAction(c, userId)));
  socket.on('force', wrap(() => act(true) || (E.maybeResolve(c, true), { ok: true })));
  socket.on('away', wrap(({ away }) => { if (need()) return need(); const m = C.member(c, userId); m.away = !!away; E.pushViews(c); E.maybeResolve(c); return { ok: true }; }));
  socket.on('roll:respond', wrap((p) => act() || E.respondRoll(c, userId, p.requestId, p)));
  socket.on('roll:free', wrap((p) => act() || E.freeRoll(c, userId, p)));
  socket.on('token:move', wrap((p) => act() || E.moveTokenFree(c, userId, p.tokenId, p.x | 0, p.y | 0)));
  // battle-map pings are grid cells; town and region map pings are 0-1 positions on that map
  socket.on('ping', wrap((p) => need() || (p.mapId ? E.ping(c, userId, Math.min(1, Math.max(0, Number(p.x) || 0)), Math.min(1, Math.max(0, Number(p.y) || 0)), String(p.mapId).slice(0, 80)) : E.ping(c, userId, p.x | 0, p.y | 0), { ok: true })));
  socket.on('chat', wrap((p) => need() || (E.chat(c, userId, p.text), { ok: true })));
  socket.on('notes', wrap((p) => { if (need()) return need(); c.notes[userId] = String(p.text || '').slice(0, 50000); C.saveCampaign(c); return { ok: true }; }));

  socket.on('combat:attack', wrap((p) => act() || K.attack(c, userId, p)));
  socket.on('combat:damage', wrap((p) => act() || K.damage(c, userId, p)));
  socket.on('cast', wrap((p) => act() || K.castSpell(c, userId, p)));
  socket.on('combat:action', wrap((p) => act() || K.takeAction(c, userId, p)));
  socket.on('combat:ask', wrap((p) => act() || K.combatAsk(c, userId, p.text)));
  socket.on('combat:endTurn', wrap(() => act() || K.endTurn(c, userId)));
  socket.on('combat:skip', wrap(() => need(true) || K.skipTurn(c)));
  socket.on('combat:end', wrap((p) => need(true) || K.endCombatManual(c, p.outcome)));

  // rests come from the DM (rest_short / rest_long effects), never from the sheet

  socket.on('session:start', wrap(() => {
    if (need()) return need();
    if (!isOwner() && !C.member(c, userId)?.characterId) return { error: 'Only players at the table can begin the session.' };
    return E.startSession(c);
  }));
  socket.on('session:end', wrap(() => need(true) || E.endSession(c)));
  socket.on('dm:retry', wrap(() => act() || E.retryTurn(c)));
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
  console.log(`  📧 Email: ${emailStatus().ready ? `on (${config.emailProvider})` : 'off (run npm run email-setup to switch on codes and password resets)'}`);
  if (!config.gateHash) console.log('  🔒 Site password: NOT SET - run `npm run setup`');
  if (!fs.existsSync(path.join(config.clientDist, '.vite', 'manifest.json'))) console.log('  ⚠️  The app is not built yet - run `npm run build`');
  srd();
  try { await startTunnel(); } catch (e) { console.warn('  🌐 Public tunnel not started:', e.message); }
});
