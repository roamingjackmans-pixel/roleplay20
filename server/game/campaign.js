// Campaign + character persistence and membership.
import { load, save, put, list, remove } from '../store.js';
import { randomId } from '../security.js';
import { getUser } from '../auth.js';
import { config } from '../config.js';

const INDEX = 'campaign-index.json';
const cfile = (id) => `campaigns/${id}.json`;
const chfile = (id) => `characters/${id}.json`;

const index = () => load(INDEX, { campaigns: {}, invites: {} });

export const DEFAULT_SETTINGS = {
  tone: ['heroic'], inspiration: '', premise: '', magicLevel: 'in between', lethality: 'balanced',
  shape: 'short season', startLevel: 1, lines: '', veils: '', pacing: 'balanced',
  model: config.defaultModel, effort: config.defaultEffort, enemyTactics: 'ai', autoReadAloud: true, dmView: false,
};

function inviteCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export function newCampaign(owner, { name, settings }) {
  const id = randomId('c_', 6);
  let code = inviteCode();
  while (index().invites[code]) code = inviteCode();
  const c = {
    id, name: String(name || 'Untitled Campaign').slice(0, 80), ownerId: owner.id, createdAt: Date.now(), inviteCode: code,
    members: [{ userId: owner.id, role: 'owner', joinedAt: Date.now(), characterId: null }],
    settings: { ...DEFAULT_SETTINGS, ...(settings || {}) },
    status: 'new',                     // new -> genesis -> ready -> active
    world: { title: '', tagline: '', bible: '', secrets: '', arc: '', characterPrompts: [], openingHook: '', dmNotes: [] },
    npcs: {}, quests: [], handouts: [],
    maps: { area: {}, tactical: {} },
    knowledge: {},                     // userId -> { areaMapId -> { owned, discovered: [], current } }
    explored: {},                      // tacticalMapId -> userId -> "0101..."
    scene: { location: '', timeOfDay: '', weather: '', mood: '', areaMapId: '', areaLocationId: '', tacticalMapId: '', day: 1 },
    tokens: {},                        // tokens on the current tactical map
    combat: null,
    phase: 'idle',
    round: { n: 0, actions: {}, rollRequests: [] },
    log: [],
    chronicle: { summary: '', turns: [] },
    sessions: [], sessionActive: false, sessionNumber: 0,
    notes: {},                         // userId -> private notes (markdown)
    usage: { calls: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
    party: { gold: 0, allies: [] },
  };
  put(cfile(id), c);
  const idx = index();
  idx.campaigns[id] = { id, ownerId: owner.id };
  idx.invites[code] = id;
  save(INDEX);
  return c;
}

const recovered = new Set();

export function getCampaign(id) {
  if (!id || !index().campaigns[id]) return null;
  const c = load(cfile(id), null);
  if (!c || !c.id) return null;
  if (!recovered.has(id)) {
    // first load since the server started: anything that was mid-flight when it stopped can be retried
    recovered.add(id);
    if (c.thinking) {
      c.thinking = null;
      if (c.combat) {
        if (c.combat.state === 'enemy') c.combat.state = 'enemy_failed';
        else if (['asking', 'waiting', 'damage'].includes(c.combat.state)) c.combat.state = 'turn';
      } else if (c.status === 'genesis') {
        c.status = 'ready';
        c.genesisError = 'World building was interrupted by a server restart. Press "Rebuild world".';
      } else c.phase = c.pendingInput ? 'failed' : 'actions';
    } else if (c.combat?.state === 'enemy') c.combat.state = 'enemy_failed';
  }
  return c;
}

export function saveCampaign(c) {
  save(cfile(c.id));
}

export function deleteCampaign(c) {
  const idx = index();
  delete idx.campaigns[c.id];
  delete idx.invites[c.inviteCode];
  save(INDEX);
  remove(cfile(c.id));
}

export function campaignsForUser(userId) {
  const out = [];
  for (const { id } of Object.values(index().campaigns)) {
    const c = getCampaign(id);
    if (c && c.members.some((m) => m.userId === userId)) out.push(c);
  }
  return out.sort((a, b) => (b.lastPlayedAt || b.createdAt) - (a.lastPlayedAt || a.createdAt));
}

export function campaignByInvite(code) {
  const id = index().invites[String(code || '').trim().toUpperCase()];
  return id ? getCampaign(id) : null;
}

export function member(c, userId) {
  return c.members.find((m) => m.userId === userId) || null;
}

export function joinCampaign(c, userId) {
  if (!member(c, userId)) {
    c.members.push({ userId, role: 'player', joinedAt: Date.now(), characterId: null });
    saveCampaign(c);
  }
  return member(c, userId);
}

export function leaveCampaign(c, userId) {
  c.members = c.members.filter((m) => m.userId !== userId || m.role === 'owner');
  saveCampaign(c);
}

export function campaignSummary(c, userId) {
  const m = member(c, userId);
  return {
    id: c.id, name: c.name, status: c.status, role: m?.role, inviteCode: c.inviteCode,
    title: c.world.title, tagline: c.world.tagline, createdAt: c.createdAt, lastPlayedAt: c.lastPlayedAt || null,
    sessionNumber: c.sessionNumber, sessionActive: c.sessionActive,
    members: c.members.map((x) => {
      const u = getUser(x.userId);
      const ch = x.characterId ? getCharacter(x.characterId) : null;
      return {
        userId: x.userId, role: x.role, displayName: u?.displayName || '?', color: u?.color,
        character: ch ? { id: ch.id, name: ch.name, race: ch.race, class: ch.class, level: ch.level, portrait: ch.portrait, color: ch.color } : null,
      };
    }),
    myCharacterId: m?.characterId || null,
  };
}

// ---------- characters ----------

export function getCharacter(id) {
  if (!id) return null;
  const ch = load(chfile(id), null);
  return ch && ch.id ? ch : null;
}

export function saveCharacter(ch) {
  ch.updatedAt = Date.now();
  save(chfile(ch.id));
}

export function storeNewCharacter(ch) {
  put(chfile(ch.id), ch);
  return ch;
}

export function deleteCharacter(id) {
  remove(chfile(id));
}

export function charactersForUser(userId) {
  return list('characters').map((f) => load(f, null)).filter((ch) => ch && ch.ownerId === userId);
}

export function partyCharacters(c) {
  return c.members.map((m) => (m.characterId ? getCharacter(m.characterId) : null)).filter(Boolean);
}

export function characterOwner(c, characterId) {
  return c.members.find((m) => m.characterId === characterId)?.userId || null;
}
