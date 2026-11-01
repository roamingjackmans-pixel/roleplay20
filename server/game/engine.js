// The game engine: per-campaign phases, the "everyone submits, then the DM narrates" loop, roll requests,
// effects, maps, sessions and the AI Dungeon Master calls.
import { randomId } from '../security.js';
import { getUser } from '../auth.js';
import { srd } from '../srd.js';
import { askClaude, NoAIError, aiStatus } from '../ai/client.js';
import { DM_CORE, GENESIS_CORE, SESSION_END_CORE, CHARACTER_ASSIST_CORE } from '../ai/prompts.js';
import { TURN_SCHEMA, GENESIS_SCHEMA, SESSION_END_SCHEMA, CHARACTER_ASSIST_SCHEMA } from '../ai/schemas.js';
import { saveCampaign, getCharacter, saveCharacter, partyCharacters, characterOwner, member } from './campaign.js';
import { cachedCampaignContext, turnPrompt, safeDerive, partyBlock, npcBlock, questBlock, historyBlock, sceneBlock } from './context.js';
import { generateTacticalMap, placeCreatures } from './mapgen.js';
import { rollDice, rollD20, manualD20 } from '../../shared/dice.js';
import { SKILL_NAMES, levelForXp } from '../../shared/rules.js';
import * as combat from './combat.js';
import { buildView, logVisibleTo } from './views.js';

let io = null;
export function attachIO(x) { io = x; }

const LOG_KEEP = 700;
const room = (c) => `c:${c.id}`;

// ---------------------------------------------------------------- presence

const presence = new Map(); // campaignId -> Map<userId, Set<socketId>>

export function setOnline(c, userId, socketId, on) {
  let m = presence.get(c.id);
  if (!m) presence.set(c.id, (m = new Map()));
  let s = m.get(userId);
  if (!s) m.set(userId, (s = new Set()));
  if (on) s.add(socketId); else s.delete(socketId);
  if (!s.size) m.delete(userId);
}

export function onlineUsers(c) {
  return new Set([...(presence.get(c.id)?.keys() || [])]);
}

/** The players the table waits for: every member with a character. The game only moves when all of them are here. */
export function requiredUsers(c) {
  return c.members.filter((m) => m.characterId).map((m) => m.userId);
}

/** Players who aren't at the table right now. */
export function missingPlayers(c) {
  const on = onlineUsers(c);
  return requiredUsers(c).filter((u) => !on.has(u));
}

function playerLabel(c, userId) {
  const m = c.members.find((x) => x.userId === userId);
  const ch = m?.characterId ? getCharacter(m.characterId) : null;
  const name = getUser(userId)?.displayName || 'a player';
  return ch ? `${name} (${ch.name})` : name;
}

function listNames(names) {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * Game actions (declaring actions, rolls, moves, attacks, spells, rests) need a running session with every player at
 * the table. Looking at sheets, maps, handouts and the journal, table talk and private notes are always allowed.
 */
export function canAct(c) {
  if (!c.sessionActive) return { error: "The session hasn't started yet. When everyone is at the table, press Begin session." };
  const missing = missingPlayers(c);
  if (missing.length) return { error: `Paused until everyone is here: waiting for ${listNames(missing.map((u) => playerLabel(c, u)))}.` };
  return null;
}

// ---------------------------------------------------------------- broadcasting

const viewTimers = new Map();
export function pushViews(c, now = false) {
  if (!io) return;
  saveCampaign(c);
  const send = () => {
    viewTimers.delete(c.id);
    const sockets = io.sockets.adapter.rooms.get(room(c));
    if (!sockets) return;
    const cache = {};
    for (const sid of sockets) {
      const sock = io.sockets.sockets.get(sid);
      if (!sock?.data?.userId) continue;
      try { sock.emit('view', buildView(c, sock.data.userId, cache)); } catch (e) { console.error('[view]', e); }
    }
  };
  if (now) { clearTimeout(viewTimers.get(c.id)); send(); return; }
  if (!viewTimers.has(c.id)) viewTimers.set(c.id, setTimeout(send, 30));
}

function emitToUsers(c, event, payload, userIds) {
  if (!io) return;
  const sockets = io.sockets.adapter.rooms.get(room(c));
  if (!sockets) return;
  for (const sid of sockets) {
    const sock = io.sockets.sockets.get(sid);
    const uid = sock?.data?.userId;
    if (uid && (userIds === 'all' || userIds.includes(uid))) sock.emit(event, payload);
  }
}

export function addLog(c, entry) {
  entry.id = randomId('l_', 6);
  entry.ts = Date.now();
  entry.to = entry.to || 'all';
  c.log.push(entry);
  if (c.log.length > LOG_KEEP) c.log.splice(0, c.log.length - LOG_KEEP);
  if (io) {
    const sockets = io.sockets.adapter.rooms.get(room(c));
    if (sockets) for (const sid of sockets) {
      const sock = io.sockets.sockets.get(sid);
      if (sock?.data?.userId && logVisibleTo(c, entry, sock.data.userId)) sock.emit('log', entry);
    }
  }
  return entry;
}

export function system(c, text, to = 'all', extra = {}) {
  return addLog(c, { kind: 'system', text, to, ...extra });
}

export function toast(c, userIds, text, tone = 'info') {
  emitToUsers(c, 'toast', { text, tone }, userIds);
}

// ---------------------------------------------------------------- helpers

export const charName = (c, characterId) => getCharacter(characterId)?.name || 'Someone';

export function userForCharacter(c, characterId) {
  return characterOwner(c, characterId);
}

/** Map AI "to" lists (character ids, names, "all") to user ids. */
export function audience(c, to) {
  const list = [].concat(to || []);
  if (!list.length || list.some((x) => String(x).toLowerCase() === 'all')) return 'all';
  const party = partyCharacters(c);
  const users = new Set();
  for (const x of list) {
    const ch = party.find((p) => p.id === x || p.name.toLowerCase() === String(x).toLowerCase() || p.name.split(' ')[0].toLowerCase() === String(x).toLowerCase());
    const uid = ch ? characterOwner(c, ch.id) : c.members.find((m) => m.userId === x)?.userId;
    if (uid) users.add(uid);
  }
  return users.size ? [...users] : 'all';
}

function findCharacter(c, ref) {
  if (!ref) return null;
  const r = String(ref).toLowerCase();
  return partyCharacters(c).find((p) => p.id === ref || p.name.toLowerCase() === r || p.name.split(' ')[0].toLowerCase() === r) || null;
}

const clampNum = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);

function trackUsage(c, res) {
  c.usage.calls += 1;
  c.usage.costUsd = Math.round((c.usage.costUsd + (res.costUsd || 0)) * 1e6) / 1e6;
  c.usage.inputTokens += (res.usage?.input_tokens || 0) + (res.usage?.cache_creation_input_tokens || 0);
  c.usage.cacheReadTokens += res.usage?.cache_read_input_tokens || 0;
  c.usage.outputTokens += res.usage?.output_tokens || 0;
  c.usage.lastMs = res.ms;
}

export function setThinking(c, task, label) {
  c.thinking = task ? { task, label: label || 'The Dungeon Master is weaving the tale…', since: Date.now() } : null;
  pushViews(c);
}

// ---------------------------------------------------------------- NPCs, maps, scene

export function upsertNpc(c, n) {
  if (!n || !n.name) return null;
  const id = n.id ? (n.id.startsWith('npc_') ? n.id : `npc_${slug(n.id)}`) : `npc_${slug(n.name)}`;
  const prev = c.npcs[id] || Object.values(c.npcs).find((x) => x.name.toLowerCase() === n.name.toLowerCase());
  const key = prev?.id || id;
  const voice = prev?.voice || {
    gender: n.gender || 'neutral', age: n.age || 'adult', accent: n.accent || 'any',
    pitch: clampNum(n.pitch, 0.5, 1.7, 1), rate: clampNum(n.rate, 0.6, 1.4, 1), style: n.voiceStyle || '',
  };
  c.npcs[key] = {
    ...(prev || {}),
    id: key, name: n.name || prev?.name, role: n.role || prev?.role || '', description: n.description || prev?.description || '',
    voice, attitude: n.attitude || prev?.attitude || 'unknown', location: n.location || prev?.location || '',
    status: n.status || prev?.status || 'alive', notes: n.notes || prev?.notes || '',
    firstSeen: prev?.firstSeen || Date.now(), color: prev?.color || npcColor(key),
  };
  return c.npcs[key];
}

function npcColor(id) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 55% 62%)`;
}

export function upsertAreaMap(c, spec) {
  if (!spec || !spec.name) return null;
  const id = spec.id ? (spec.id.startsWith('area_') ? spec.id : `area_${slug(spec.id)}`) : `area_${slug(spec.name)}`;
  const prev = c.maps.area[id];
  const locs = new Map((prev?.locations || []).map((l) => [l.id, l]));
  for (const l of spec.locations || []) {
    if (!l?.name) continue;
    const lid = l.id || `loc_${slug(l.name)}`;
    locs.set(lid, { ...(locs.get(lid) || {}), id: lid, name: l.name, kind: l.kind || 'landmark', x: clampNum(l.x, 0.04, 0.96, 0.5), y: clampNum(l.y, 0.04, 0.96, 0.5), description: l.description || '', secret: !!l.secret });
  }
  const map = {
    id, kind: 'area', style: spec.style || prev?.style || 'town', name: spec.name, seed: prev?.seed || Math.floor(Math.random() * 1e9),
    description: spec.description || prev?.description || '',
    features: {
      river: spec.river && spec.river !== 'none' ? spec.river : prev?.features?.river || null,
      coast: spec.coast && spec.coast !== 'none' ? spec.coast : prev?.features?.coast || null,
      walls: spec.walls ?? prev?.features?.walls ?? false,
      forest: clampNum(spec.forest, 0, 1, prev?.features?.forest ?? 0.3), hills: clampNum(spec.hills, 0, 1, prev?.features?.hills ?? 0.2),
      roads: spec.roads?.length ? spec.roads : prev?.features?.roads || ['n', 's'],
    },
    locations: [...locs.values()],
    connections: (spec.connections || []).filter((p) => Array.isArray(p) && p.length === 2).concat(prev?.connections || []).slice(0, 80),
    price: spec.price || prev?.price || '',
  };
  c.maps.area[id] = map;
  for (const who of spec.ownedBy || []) giveMap(c, id, who, false);
  return map;
}

function knowledge(c, userId, mapId) {
  const k = (c.knowledge[userId] ||= {});
  return (k[mapId] ||= { owned: false, discovered: [], current: null });
}

function eachTargetUser(c, target, fn) {
  const t = String(target || 'party').toLowerCase();
  if (t === 'party' || t === 'all' || t === '') { for (const m of c.members) fn(m.userId); return; }
  const ch = findCharacter(c, target);
  if (ch) { const uid = characterOwner(c, ch.id); if (uid) fn(uid); }
}

export function giveMap(c, mapId, target, announce = true) {
  const m = c.maps.area[mapId];
  if (!m) return;
  eachTargetUser(c, target, (uid) => {
    const k = knowledge(c, uid, mapId);
    if (!k.owned) {
      k.owned = true;
      if (announce) addLog(c, { kind: 'system', icon: 'map', text: `🗺️ You now have the map of ${m.name}. Open it from the Maps panel.`, to: [uid] });
    }
  });
}

export function discoverLocation(c, mapId, locId, target = 'party') {
  const m = c.maps.area[mapId];
  if (!m || !m.locations.some((l) => l.id === locId)) return;
  eachTargetUser(c, target, (uid) => {
    const k = knowledge(c, uid, mapId);
    if (!k.discovered.includes(locId)) k.discovered.push(locId);
  });
}

export function moveParty(c, mapId, locId) {
  const m = c.maps.area[mapId];
  if (!m) return;
  c.scene.areaMapId = mapId;
  if (locId && m.locations.some((l) => l.id === locId)) {
    c.scene.areaLocationId = locId;
    discoverLocation(c, mapId, locId, 'party');
    for (const mem of c.members) knowledge(c, mem.userId, mapId).current = locId;
  }
}

/** Lay out a scene on a fresh battle map and place the party (and present NPCs) on it. */
export function setSceneMap(c, spec, { keepTokens = false } = {}) {
  let map;
  try {
    map = generateTacticalMap({ theme: spec.theme || 'field', name: spec.name || c.scene.location || 'Scene', size: spec.size || 'medium', ambient: spec.ambient, timeOfDay: spec.timeOfDay, features: spec.features || [] });
  } catch (e) {
    console.error('[engine] map generation failed', e);
    return null;
  }
  map.id = map.id || randomId('map_', 5);
  c.maps.tactical[map.id] = map;
  // keep at most a few old battle maps
  const ids = Object.keys(c.maps.tactical);
  if (ids.length > 6) for (const old of ids.slice(0, ids.length - 6)) if (old !== map.id) delete c.maps.tactical[old];
  c.scene.tacticalMapId = map.id;
  if (!keepTokens) c.tokens = {};
  const party = partyCharacters(c);
  const interior = ['tavern', 'temple', 'castle', 'ship'].includes(map.theme);
  const zone = spec.partyPlacement === 'center' ? 'center' : spec.partyPlacement === 'near_npcs' ? 'npc' : spec.partyPlacement === 'entrance' ? 'party' : interior ? 'center' : 'party';
  const placed = placeCreatures(map, [{ key: 'party', count: party.length, size: 1, zone }], { occupied: new Set() });
  party.forEach((ch, i) => {
    const pos = placed.party?.[i];
    if (!pos) return;
    addToken(c, { kind: 'pc', characterId: ch.id, name: ch.name, x: pos[0], y: pos[1], color: ch.color, img: ch.portrait, darkvision: ch.darkvision || 0, light: ch.light });
  });
  const occupied = new Set(Object.values(c.tokens).map((t) => `${t.x},${t.y}`));
  for (const p of spec.npcsPresent || []) {
    const n = c.npcs[p.npcId];
    if (!n) continue;
    const pos = placeCreatures(map, [{ key: 'n', count: 1, size: 1, zone: p.placement || 'npc' }], { occupied }).n?.[0];
    if (!pos) continue;
    occupied.add(`${pos[0]},${pos[1]}`);
    addToken(c, { kind: n.ally ? 'ally' : 'npc', npcId: n.id, name: n.name, x: pos[0], y: pos[1], color: n.color, hidden: p.placement === 'hidden' });
  }
  return map;
}

export function addToken(c, t) {
  const id = t.id || randomId('t_', 5);
  c.tokens[id] = {
    id, kind: t.kind, name: t.name, x: t.x, y: t.y, size: t.size || 1, color: t.color || '#888', img: t.img || null,
    initials: (t.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase(),
    characterId: t.characterId || null, npcId: t.npcId || null, combatantId: t.combatantId || null,
    hidden: !!t.hidden, stealth: t.stealth || 0, revealedTo: [], darkvision: t.darkvision || 0,
    light: t.light && (t.light.bright || t.light.dim) ? t.light : null, dead: false,
  };
  return c.tokens[id];
}

export function tokenForCharacter(c, characterId) {
  return Object.values(c.tokens).find((t) => t.characterId === characterId) || null;
}

// ---------------------------------------------------------------- effects

const CONDITIONS = ['blinded', 'charmed', 'deafened', 'frightened', 'grappled', 'incapacitated', 'invisible', 'paralyzed', 'petrified', 'poisoned', 'prone', 'restrained', 'stunned', 'unconscious'];

export function applyDamageToCharacter(c, ch, amount, { type = '', source = '', crit = false } = {}) {
  amount = Math.max(0, Math.round(amount));
  if (!amount) return { dropped: false };
  const wasUp = ch.hp.current > 0;
  let rest = amount;
  if (ch.hp.temp) { const t = Math.min(ch.hp.temp, rest); ch.hp.temp -= t; rest -= t; }
  if (!wasUp) {
    // damage at 0 HP: death save failures (instant death if it equals max HP)
    if (rest >= ch.hp.max) { ch.dead = true; ch.deathSaves = { success: 0, fail: 3 }; }
    else { ch.deathSaves.fail = Math.min(3, (ch.deathSaves.fail || 0) + (crit ? 2 : 1)); if (ch.deathSaves.fail >= 3) ch.dead = true; }
    ch.stable = false;
  } else {
    const overflow = rest - ch.hp.current;
    ch.hp.current = Math.max(0, ch.hp.current - rest);
    if (ch.hp.current === 0) {
      if (overflow >= ch.hp.max) { ch.dead = true; }
      else { ch.deathSaves = { success: 0, fail: 0 }; ch.stable = false; if (!ch.conditions.includes('unconscious')) ch.conditions.push('unconscious'); }
    }
  }
  // concentration check
  if (ch.concentration && amount > 0 && ch.hp.current > 0) {
    combat.requestConcentration(c, ch, amount);
  } else if (ch.concentration && ch.hp.current === 0) {
    combat.dropConcentration(c, ch, 'fell unconscious');
  }
  saveCharacter(ch);
  const dropped = wasUp && ch.hp.current === 0;
  if (dropped) system(c, ch.dead ? `💀 ${ch.name} is killed outright.` : `🩸 ${ch.name} falls unconscious!`, 'all', { tone: 'danger' });
  return { dropped };
}

export function healCharacter(c, ch, amount) {
  amount = Math.max(0, Math.round(amount));
  if (ch.dead) return 0;
  const before = ch.hp.current;
  ch.hp.current = Math.min(ch.hp.max, ch.hp.current + amount);
  if (before === 0 && ch.hp.current > 0) {
    ch.conditions = ch.conditions.filter((x) => x !== 'unconscious');
    ch.deathSaves = { success: 0, fail: 0 };
    ch.stable = false;
  }
  saveCharacter(ch);
  return ch.hp.current - before;
}

export function shortRest(ch) {
  const d = safeDerive(ch);
  for (const r of d?.resources || []) if (r.recharge === 'short' && ch.resources?.[r.key]) ch.resources[r.key].used = 0;
  if (ch.spellcasting) ch.spellcasting.pactUsed = 0;
  saveCharacter(ch);
}

export function longRest(ch) {
  const d = safeDerive(ch);
  ch.hp.current = ch.hp.max;
  ch.hp.temp = 0;
  ch.deathSaves = { success: 0, fail: 0 };
  ch.conditions = (ch.conditions || []).filter((x) => !['unconscious', 'prone', 'poisoned', 'frightened', 'charmed', 'stunned', 'incapacitated'].includes(x));
  ch.hitDice.used = Math.max(0, (ch.hitDice.used || 0) - Math.max(1, Math.floor(ch.hitDice.total / 2)));
  ch.exhaustion = Math.max(0, (ch.exhaustion || 0) - 1);
  for (const r of d?.resources || []) if (ch.resources?.[r.key]) ch.resources[r.key].used = 0;
  if (ch.spellcasting) { ch.spellcasting.slotsUsed = [0, 0, 0, 0, 0, 0, 0, 0, 0]; ch.spellcasting.pactUsed = 0; }
  ch.concentration = null;
  saveCharacter(ch);
}

export function awardXp(c, chars, amount, why = '') {
  if (!amount || !chars.length) return;
  for (const ch of chars) {
    ch.xp = (ch.xp || 0) + amount;
    const lvl = levelForXp ? levelForXp(ch.xp) : ch.level;
    if (lvl > ch.level) ch.pendingLevelUp = true;
    saveCharacter(ch);
  }
  system(c, `✨ ${chars.map((x) => x.name).join(', ')} gain${chars.length === 1 ? 's' : ''} ${amount} XP${why ? ` (${why})` : ''}.`);
  const ready = chars.filter((x) => x.pendingLevelUp);
  if (ready.length) system(c, `⬆️ ${ready.map((x) => x.name).join(', ')} can level up! Open the character sheet.`, 'all', { tone: 'good' });
}

export function applyEffects(c, effects, source = 'dm') {
  for (const e of effects || []) {
    try { applyEffect(c, e, source); } catch (err) { console.error('[effects]', e, err); }
  }
}

function applyEffect(c, e) {
  const type = e.type;
  const amount = Number(e.amount) || 0;
  const targetChars = () => {
    const t = String(e.target || '').toLowerCase();
    if (t === 'party' || t === 'all' || t === '') return partyCharacters(c);
    const ch = findCharacter(c, e.target);
    return ch ? [ch] : [];
  };
  switch (type) {
    case 'damage': {
      if (combat.damageCombatantByRef(c, e.target, amount, e.text)) break;
      for (const ch of targetChars()) {
        applyDamageToCharacter(c, ch, amount, { type: e.text });
        system(c, `💥 ${ch.name} takes ${amount}${e.text ? ` ${e.text}` : ''} damage.`, 'all', { tone: 'danger' });
      }
      break;
    }
    case 'heal': for (const ch of targetChars()) { const h = healCharacter(c, ch, amount); if (h) system(c, `💚 ${ch.name} regains ${h} HP.`, 'all', { tone: 'good' }); } break;
    case 'temp_hp': for (const ch of targetChars()) { ch.hp.temp = Math.max(ch.hp.temp || 0, amount); saveCharacter(ch); } break;
    case 'condition_add':
    case 'condition_remove': {
      const cond = String(e.text || '').toLowerCase().trim();
      if (!cond) break;
      if (combat.conditionCombatantByRef(c, e.target, cond, type === 'condition_add')) break;
      for (const ch of targetChars()) {
        ch.conditions = (ch.conditions || []).filter((x) => x !== cond);
        if (type === 'condition_add') ch.conditions.push(cond);
        saveCharacter(ch);
        system(c, `${type === 'condition_add' ? '⚠️' : '✅'} ${ch.name} ${type === 'condition_add' ? 'is now' : 'is no longer'} ${cond}.`);
      }
      break;
    }
    case 'item_add': case 'item_remove': {
      const name = String(e.text || '').trim();
      if (!name) break;
      const qty = Math.max(1, amount || 1);
      for (const ch of targetChars().slice(0, String(e.target).toLowerCase() === 'party' ? 1 : 99)) {
        const it = ch.equipment.find((i) => i.name.toLowerCase() === name.toLowerCase());
        if (type === 'item_add') {
          if (it) it.qty = (it.qty || 1) + qty;
          else {
            const ref = srd().by.equipment.get(slug(name).replace(/_/g, '-')) || null;
            ch.equipment.push({ id: randomId('it_', 4), name, index: ref?.index || null, qty, equipped: false, attuned: false, notes: '' });
          }
          system(c, `🎒 ${ch.name} receives ${qty > 1 ? `${qty}× ` : ''}${name}.`, [userForCharacter(c, ch.id)].filter(Boolean));
        } else if (it) {
          it.qty = (it.qty || 1) - qty;
          if (it.qty <= 0) ch.equipment = ch.equipment.filter((i) => i !== it);
        }
        saveCharacter(ch);
      }
      break;
    }
    case 'gold': {
      const chars = targetChars();
      if (String(e.target).toLowerCase() === 'party' && amount > 0) {
        const each = Math.floor(amount / Math.max(1, chars.length));
        for (const ch of chars) { ch.currency.gp = (ch.currency.gp || 0) + each; saveCharacter(ch); }
        system(c, `🪙 The party splits ${amount} gp (${each} gp each).`);
      } else for (const ch of chars) {
        ch.currency.gp = Math.max(0, (ch.currency.gp || 0) + amount);
        saveCharacter(ch);
        system(c, `🪙 ${ch.name} ${amount >= 0 ? 'gains' : 'spends'} ${Math.abs(amount)} gp.`, [userForCharacter(c, ch.id)].filter(Boolean));
      }
      break;
    }
    case 'xp': awardXp(c, targetChars(), amount, e.text); break;
    case 'level_up': for (const ch of targetChars()) { ch.pendingLevelUp = true; saveCharacter(ch); system(c, `⬆️ ${ch.name} can level up! Open the character sheet.`, 'all', { tone: 'good' }); } break;
    case 'rest_short': for (const ch of targetChars()) shortRest(ch); system(c, '☕ Short rest: short-rest abilities recharge. You can spend Hit Dice from your sheet.'); break;
    case 'rest_long': for (const ch of targetChars()) longRest(ch); system(c, '🌙 Long rest: hit points, spell slots and abilities are restored.'); break;
    case 'inspiration': for (const ch of targetChars()) { ch.inspiration = true; saveCharacter(ch); system(c, `🌟 ${ch.name} gains Inspiration!`); } break;
    case 'exhaustion': for (const ch of targetChars()) { ch.exhaustion = clampNum((ch.exhaustion || 0) + amount, 0, 6, 0); saveCharacter(ch); } break;
    case 'spend_slot': for (const ch of targetChars()) if (ch.spellcasting && amount >= 1 && amount <= 9) { ch.spellcasting.slotsUsed[amount - 1] = (ch.spellcasting.slotsUsed[amount - 1] || 0) + 1; saveCharacter(ch); } break;
    case 'spend_resource': for (const ch of targetChars()) { const k = e.text; if (k) { ch.resources[k] = { used: (ch.resources[k]?.used || 0) + Math.max(1, amount) }; saveCharacter(ch); } } break;
    case 'give_map': giveMap(c, e.mapId, e.target || 'party'); break;
    case 'discover_location': discoverLocation(c, e.mapId, e.locationId, e.target || 'party'); break;
    case 'move_party': moveParty(c, e.mapId || c.scene.areaMapId, e.locationId); break;
    case 'reveal_token': case 'hide_token': case 'remove_token': {
      const t = c.tokens[e.target] || Object.values(c.tokens).find((x) => x.combatantId === e.target || x.npcId === e.target || x.name.toLowerCase() === String(e.target).toLowerCase());
      if (!t) break;
      if (type === 'reveal_token') { t.hidden = false; }
      else if (type === 'hide_token') { t.hidden = true; t.revealedTo = []; }
      else delete c.tokens[t.id];
      break;
    }
    case 'door_open': case 'door_close': case 'door_lock': case 'door_unlock': {
      const map = c.maps.tactical[c.scene.tacticalMapId];
      const [x, y] = String(e.text || '').split(',').map(Number);
      const d = map?.doors?.find((dd) => dd.x === x && dd.y === y);
      if (!d) break;
      if (type === 'door_open') { d.open = true; d.locked = false; }
      if (type === 'door_close') d.open = false;
      if (type === 'door_lock') { d.open = false; d.locked = true; }
      if (type === 'door_unlock') d.locked = false;
      d.secret = false;
      break;
    }
    case 'ambient': { const map = c.maps.tactical[c.scene.tacticalMapId]; if (map && ['bright', 'dim', 'dark'].includes(e.text)) map.ambient = e.text; break; }
    case 'npc_join_party': case 'npc_leave_party': {
      const n = c.npcs[e.target] || Object.values(c.npcs).find((x) => x.name.toLowerCase() === String(e.target).toLowerCase());
      if (!n) break;
      n.ally = type === 'npc_join_party';
      for (const t of Object.values(c.tokens)) if (t.npcId === n.id) t.kind = n.ally ? 'ally' : 'npc';
      system(c, n.ally ? `🤝 ${n.name} joins the party as an ally.` : `👋 ${n.name} parts ways with the party.`);
      break;
    }
    default: break;
  }
}

// ---------------------------------------------------------------- applying a DM turn

function postNarration(c, narration, { kind = 'narration' } = {}) {
  const posted = [];
  for (const seg of narration || []) {
    const parts = (seg.parts || []).filter((p) => p && p.text && String(p.text).trim());
    if (!parts.length) continue;
    const to = audience(c, seg.to);
    const out = parts.map((p) => {
      const npc = p.speaker && p.speaker !== 'narrator' ? (c.npcs[p.speaker] || Object.values(c.npcs).find((n) => n.name.toLowerCase() === String(p.speaker).toLowerCase())) : null;
      return { speaker: npc ? npc.id : p.speaker === 'narrator' || !p.speaker ? 'narrator' : String(p.speaker), speakerName: npc?.name || (p.speaker !== 'narrator' ? p.speaker : undefined), text: String(p.text).trim() };
    });
    posted.push(addLog(c, { kind, parts: out, to }));
  }
  return posted;
}

export function applyTurnResult(c, data, input = {}) {
  for (const n of data.npcs || []) upsertNpc(c, n);
  for (const m of data.areaMaps || []) upsertAreaMap(c, m);
  const s = data.scene || {};
  for (const k of ['location', 'timeOfDay', 'weather', 'mood']) if (s[k]) c.scene[k] = s[k];
  if (s.areaMapId && c.maps.area[s.areaMapId]) moveParty(c, s.areaMapId, s.areaLocationId);
  else if (s.areaLocationId && c.scene.areaMapId) moveParty(c, c.scene.areaMapId, s.areaLocationId);

  const startCombat = (data.combatStart || [])[0];
  if (data.sceneMap?.[0] && !startCombat) setSceneMap(c, data.sceneMap[0]);

  const posted = postNarration(c, data.narration);
  applyEffects(c, data.effects);
  for (const q of data.quests || []) upsertQuest(c, q);
  for (const h of data.handouts || []) {
    if (!h.title) continue;
    const to = audience(c, h.to?.length ? h.to : ['all']);
    c.handouts.push({ id: h.id || randomId('h_', 4), title: h.title, kind: h.kind, content: h.content, to, at: Date.now() });
    addLog(c, { kind: 'system', icon: 'scroll', text: `📜 New handout: ${h.title}`, to });
  }
  if (data.ruling) system(c, `⚖️ ${data.ruling}`, 'all', { tone: 'ruling' });
  if (data.dmNotes) { c.world.dmNotes.push(data.dmNotes); if (c.world.dmNotes.length > 80) c.world.dmNotes.splice(0, c.world.dmNotes.length - 80); }

  c.round.n += 1;
  c.chronicle.turns.push({
    n: c.round.n, at: Date.now(), kind: input.kind,
    actions: input.actions || [], rolls: input.rollsText || [],
    narration: posted.map((p) => ({ to: p.to, parts: p.parts })), summary: data.summary || '',
  });
  if (c.chronicle.turns.length > 120) c.chronicle.turns.splice(0, c.chronicle.turns.length - 120);
  c.lastPlayedAt = Date.now();

  if (c.combat) {
    combat.afterAsk(c, data);
    return;
  }
  if (startCombat) {
    combat.startCombat(c, { ...startCombat, map: data.sceneMap?.[0] || null });
    return;
  }
  const reqs = (data.rollRequests || []).map((r) => makeRollRequest(c, r, 'turn')).filter(Boolean);
  if (reqs.length) {
    c.phase = 'rolls';
    c.round.rollRequests = reqs;
  } else {
    openActions(c);
  }
}

function upsertQuest(c, q) {
  if (!q?.title) return;
  const id = q.id || `q_${slug(q.title)}`;
  let cur = c.quests.find((x) => x.id === id || x.title.toLowerCase() === q.title.toLowerCase());
  if (!cur) {
    cur = { id, title: q.title, status: q.status || 'active', summary: q.summary || '', giver: q.giver || '', updates: [], createdAt: Date.now() };
    c.quests.push(cur);
    system(c, `📌 New quest: ${q.title}`, 'all', { tone: 'quest' });
  } else {
    if (q.status && q.status !== cur.status) {
      cur.status = q.status;
      if (q.status === 'completed') system(c, `🏆 Quest complete: ${cur.title}`, 'all', { tone: 'good' });
      if (q.status === 'failed') system(c, `✖ Quest failed: ${cur.title}`, 'all', { tone: 'danger' });
    }
    if (q.summary) cur.summary = q.summary;
  }
  if (q.update) cur.updates.push(q.update);
}

export function openActions(c) {
  c.phase = 'actions';
  c.round.actions = {};
  c.round.rollRequests = [];
}

// ---------------------------------------------------------------- the action round

export function submitAction(c, userId, { text, private: priv }) {
  const m = member(c, userId);
  if (!m?.characterId) return { error: 'Create a character for this campaign first.' };
  if (c.phase !== 'actions') return { error: c.phase === 'thinking' ? 'The DM is still narrating.' : 'Not the time for that right now.' };
  const t = String(text || '').trim().slice(0, 2000);
  if (!t) return { error: 'Describe what your character does.' };
  c.round.actions[userId] = { text: t, private: !!priv, at: Date.now() };
  pushViews(c);
  maybeResolve(c);
  return { ok: true };
}

export function withdrawAction(c, userId) {
  if (c.phase !== 'actions') return { error: 'Too late to change it.' };
  delete c.round.actions[userId];
  pushViews(c);
  return { ok: true };
}

export function maybeResolve(c, force = false) {
  if (c.phase !== 'actions' || c.thinking) return;
  const need = requiredUsers(c);
  const got = Object.keys(c.round.actions);
  if (!got.length) return;
  if (force || need.every((u) => got.includes(u))) resolveActions(c);
}

function resolveActions(c) {
  const acts = [];
  for (const [uid, a] of Object.entries(c.round.actions)) {
    const m = member(c, uid);
    const ch = getCharacter(m?.characterId);
    if (!ch) continue;
    acts.push({ name: ch.name, characterId: ch.id, text: a.text, private: a.private, userId: uid });
    addLog(c, { kind: 'action', userId: uid, characterId: ch.id, name: ch.name, text: a.text, private: a.private, to: [uid] });
  }
  const text = acts.map((a) => `${a.name} (${a.characterId})${a.private ? ' [PRIVATE - only this player knows]' : ''}: ${a.text}`).join('\n') +
    '\n\nResolve these actions together in one narration. Give each character their own perception. Ask for rolls where outcomes are uncertain.';
  c.round.actions = {};
  runTurn(c, { kind: 'actions', actions: acts.map(({ name, text, private: p }) => ({ name, text, private: p })), text });
}

export async function runTurn(c, input) {
  if (c.thinking) return;
  if (!c.combat) c.phase = 'thinking';
  c.pendingInput = input;
  setThinking(c, 'turn');
  try {
    const res = await askClaude({
      task: 'turn', system: DM_CORE, cachedContext: cachedCampaignContext(c), prompt: turnPrompt(c, input, onlineUsers(c)),
      schema: TURN_SCHEMA, model: c.settings.model, effort: c.settings.effort, campaignId: c.id,
    });
    trackUsage(c, res);
    c.thinking = null;
    c.pendingInput = null;
    applyTurnResult(c, res.data, input);
  } catch (e) {
    c.thinking = null;
    if (c.combat) {
      if (['asking', 'waiting'].includes(c.combat.state)) c.combat.state = 'turn';
      system(c, e instanceof NoAIError ? 'No AI DM is connected, so creative actions need the campaign owner to narrate them (DM Screen).' : `The DM couldn't resolve that (${String(e.message || e).slice(0, 140)}). Carry on with your turn.`, 'all', { tone: 'warn' });
      if (input.kind === 'combat_end') openActions(c);
    } else if (e instanceof NoAIError) {
      c.phase = 'manual';
      system(c, 'The AI Dungeon Master is not connected. The campaign owner can narrate this turn from the DM Screen.', 'all', { tone: 'warn' });
    } else {
      console.error('[turn]', e);
      c.phase = 'failed';
      system(c, `The Dungeon Master lost the thread (${String(e.message || e).slice(0, 160)}). Press "Try again".`, 'all', { tone: 'warn' });
    }
  } finally {
    pushViews(c);
  }
}

export function retryTurn(c) {
  if (c.thinking) return { error: 'Already thinking.' };
  if (c.combat && c.combat.state === 'enemy_failed') { combat.retryEnemyPhase(c); return { ok: true }; }
  if (!c.pendingInput) { openActions(c); pushViews(c); return { ok: true }; }
  runTurn(c, c.pendingInput);
  return { ok: true };
}

/** The campaign owner narrates by hand (no AI, or overriding it). */
export function manualNarration(c, { text, to, npcId }) {
  const t = String(text || '').trim();
  if (!t) return { error: 'Write something first.' };
  postNarration(c, [{ to: to?.length ? to : ['all'], parts: [{ speaker: npcId || 'narrator', text: t }] }]);
  if (c.phase === 'manual' || c.phase === 'failed') {
    c.pendingInput = null;
    if (!c.combat) openActions(c); else c.phase = 'combat';
  }
  pushViews(c);
  return { ok: true };
}

// ---------------------------------------------------------------- rolls

export function makeRollRequest(c, r, purpose, extra = {}) {
  const ch = findCharacter(c, r.characterId);
  if (!ch) return null;
  const userId = characterOwner(c, ch.id);
  const kind = r.kind || 'skill';
  let key = String(r.key || '').trim();
  if (kind === 'skill') {
    const k = key.replace(/[\s_-]+(\w)/g, (_, x) => x.toUpperCase());
    key = Object.keys(SKILL_NAMES).find((s) => s.toLowerCase() === k.toLowerCase()) || k;
  }
  if (['save', 'ability'].includes(kind)) key = key.slice(0, 3).toLowerCase();
  const req = {
    id: randomId('r_', 5), userId, characterId: ch.id, characterName: ch.name, kind, key, dc: Number(r.dc) || 0,
    advantage: r.advantage || 'none', reason: r.reason || '', secret: !!r.secret, purpose, status: 'pending', createdAt: Date.now(), ...extra,
  };
  addLog(c, { kind: 'roll_request', requestId: req.id, characterName: ch.name, label: rollLabel(req), reason: req.reason, to: req.secret ? [userId] : 'all' });
  return req;
}

export function rollLabel(r) {
  if (r.kind === 'skill') return `${SKILL_NAMES[r.key] || r.key} check`;
  if (r.kind === 'save') return `${r.key.toUpperCase()} saving throw`;
  if (r.kind === 'ability') return `${r.key.toUpperCase()} check`;
  if (r.kind === 'initiative') return 'Initiative';
  if (r.kind === 'death') return 'Death saving throw';
  if (r.kind === 'attack') return 'Attack roll';
  return r.label || `Roll ${r.key || 'd20'}`;
}

export function rollModifier(ch, kind, key) {
  const d = safeDerive(ch);
  if (!d) return 0;
  switch (kind) {
    case 'skill': return d.skills?.[key] ?? 0;
    case 'save': return d.saves?.[key] ?? 0;
    case 'ability': return d.mods?.[key] ?? 0;
    case 'initiative': return d.initiative ?? 0;
    default: return 0;
  }
}

/** Advantage from the character's own conditions (exhaustion, poisoned...). Combined with the requested mode. */
function autoAdvantage(ch, kind, key, requested) {
  let adv = requested === 'adv' ? 1 : 0;
  let dis = requested === 'dis' ? 1 : 0;
  const cond = new Set(ch.conditions || []);
  const ex = ch.exhaustion || 0;
  if (['skill', 'ability', 'initiative'].includes(kind) && (ex >= 1 || cond.has('poisoned') || cond.has('frightened'))) dis++;
  if (kind === 'save' && ex >= 3) dis++;
  if (kind === 'save' && key === 'dex' && cond.has('restrained')) dis++;
  if (adv && dis) return 'none';
  return adv ? 'adv' : dis ? 'dis' : 'none';
}

/** Roll for a character: mode "auto" (server rolls) or "manual" (player typed their natural d20 or a total). */
export function performRoll(ch, { kind, key, advantage = 'none', mode = 'auto', natural, total, expr }) {
  const adv = autoAdvantage(ch, kind, key, advantage);
  if (kind === 'custom' || kind === 'damage') {
    const e = expr || key || '1d20';
    if (mode === 'manual' && Number.isFinite(+total)) return { expr: e, total: +total, manual: true, text: `${e} → ${total} (rolled at the table)` };
    return rollDice(e, {});
  }
  if (kind === 'death') {
    if (mode === 'manual' && Number.isFinite(+natural)) return manualD20(clampNum(natural, 1, 20, 10), 0);
    return rollD20(0, { advantage: 'none' });
  }
  const mod = rollModifier(ch, kind, key);
  let r;
  if (mode === 'manual') {
    if (Number.isFinite(+natural)) r = manualD20(clampNum(natural, 1, 20, 10), mod);
    else if (Number.isFinite(+total)) r = { ...manualD20(clampNum(+total - mod, 1, 20, 10), mod), total: +total };
    else r = rollD20(mod, { advantage: adv });
    r.manual = true;
  } else r = rollD20(mod, { advantage: adv });
  r.advantage = adv;
  r.mod = mod;
  return r;
}

export function respondRoll(c, userId, reqId, payload = {}) {
  const pools = [c.round.rollRequests || [], c.combat?.rollRequests || []];
  let req = null;
  for (const p of pools) { req = p.find((r) => r.id === reqId); if (req) break; }
  if (!req) return { error: 'That roll is no longer needed.' };
  if (req.userId !== userId) return { error: 'That roll belongs to another player.' };
  if (req.status !== 'pending') return { error: 'Already rolled.' };
  const ch = getCharacter(req.characterId);
  if (!ch) return { error: 'Character not found.' };
  const r = performRoll(ch, { kind: req.kind, key: req.key, advantage: payload.advantage || req.advantage, mode: payload.mode, natural: payload.natural, total: payload.total, expr: req.expr });
  completeRoll(c, req, r);
  return { ok: true, result: r };
}

export function completeRoll(c, req, r, { auto = false } = {}) {
  req.status = 'done';
  req.result = { total: r.total, natural: r.natural, text: r.text, manual: !!r.manual, isCrit: r.isCrit, isFumble: r.isFumble };
  const success = req.dc ? r.total >= req.dc : null;
  req.success = success;
  addLog(c, {
    kind: 'dice', characterId: req.characterId, name: req.characterName, label: rollLabel(req) + (auto ? ' (rolled automatically)' : ''),
    result: req.result, advantage: r.advantage, dc: req.secret ? 0 : req.dc, success: req.secret ? null : success, to: req.secret ? [req.userId] : 'all',
  });
  if (req.purpose === 'turn') {
    pushViews(c);
    const all = c.round.rollRequests.filter((x) => x.purpose === 'turn');
    if (all.every((x) => x.status === 'done')) resolveRolls(c);
  } else {
    combat.onRollComplete(c, req);
    pushViews(c);
  }
}

function resolveRolls(c) {
  const reqs = c.round.rollRequests.filter((x) => x.purpose === 'turn');
  const lines = reqs.map((r) => `${r.characterName} (${r.characterId}) ${rollLabel(r)}${r.reason ? ` [${r.reason}]` : ''}: total ${r.result.total}${r.result.natural ? ` (natural ${r.result.natural})` : ''}${r.dc ? ` vs DC ${r.dc} -> ${r.success ? 'SUCCESS' : 'FAILURE'}` : ''}${r.result.manual ? ' (rolled at the table)' : ''}`);
  c.round.rollRequests = [];
  runTurn(c, { kind: 'rolls', rollsText: lines, text: `Roll results for the checks you asked for:\n${lines.join('\n')}\n\nNarrate the outcomes (each character's own perception), then move the scene on.` });
}

/** A roll a player makes from their sheet. If it matches a pending request, it answers the request. */
export function freeRoll(c, userId, p) {
  const m = member(c, userId);
  const ch = getCharacter(p.characterId || m?.characterId);
  if (!ch || ch.ownerId !== userId) return { error: 'Pick your own character.' };
  const pending = [...(c.round.rollRequests || []), ...(c.combat?.rollRequests || [])]
    .find((r) => r.userId === userId && r.status === 'pending' && r.kind === p.kind && (r.key === p.key || ['initiative', 'death'].includes(r.kind)));
  if (pending) return respondRoll(c, userId, pending.id, p);
  const r = performRoll(ch, p);
  const label = p.label || rollLabel({ kind: p.kind, key: p.key, label: p.label });
  addLog(c, { kind: 'dice', characterId: ch.id, name: ch.name, label, result: { total: r.total, natural: r.natural, text: r.text, manual: !!r.manual, isCrit: r.isCrit, isFumble: r.isFumble }, advantage: r.advantage, to: p.private ? [userId] : 'all', free: true });
  return { ok: true, result: r };
}

// ---------------------------------------------------------------- tokens on the scene map

export function moveTokenFree(c, userId, tokenId, x, y) {
  const t = c.tokens[tokenId];
  if (!t) return { error: 'No such token.' };
  const m = member(c, userId);
  const isOwner = m?.role === 'owner';
  if (!(t.characterId && t.characterId === m?.characterId) && !(isOwner && c.settings.dmView)) return { error: 'You can only move your own token.' };
  if (c.combat) return combat.moveInCombat(c, userId, t, x, y);
  return combat.moveOutOfCombat(c, t, x, y);
}

export function ping(c, userId, x, y) {
  const u = getUser(userId);
  emitToUsers(c, 'ping', { x, y, color: u?.color || '#fff', by: u?.displayName, at: Date.now() }, 'all');
}

export function chat(c, userId, text) {
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) return;
  const u = getUser(userId);
  addLog(c, { kind: 'chat', userId, name: u?.displayName || '?', color: u?.color, text: t });
}

// ---------------------------------------------------------------- sessions

export function startSession(c) {
  if (c.sessionActive) return { error: 'A session is already running.' };
  if (c.status === 'genesis') return { error: 'The world is still being built.' };
  if (!partyCharacters(c).length) return { error: 'At least one player needs a character.' };
  const missing = missingPlayers(c);
  if (missing.length) return { error: `Everyone needs to be at the table first: waiting for ${listNames(missing.map((u) => playerLabel(c, u)))}.` };
  c.sessionActive = true;
  c.sessionNumber += 1;
  c.status = 'active';
  c.sessions.push({ n: c.sessionNumber, startedAt: Date.now(), endedAt: null, recap: '', logEntry: '' });
  addLog(c, { kind: 'session', text: `Session ${c.sessionNumber}`, n: c.sessionNumber });
  if (c.nextOpening) {
    // a prepared opening (for example a campaign carried over from another table): post it instead of an AI recap
    const o = c.nextOpening;
    delete c.nextOpening;
    const posted = postNarration(c, o.narration);
    c.round.n += 1;
    c.chronicle.turns.push({ n: c.round.n, at: Date.now(), kind: 'recap', actions: [], rolls: [], narration: posted.map((p) => ({ to: p.to, parts: p.parts })), summary: o.summary || '' });
    const reqs = (o.rollRequests || []).map((r) => makeRollRequest(c, r, 'turn', { ...(r.label ? { label: r.label } : {}), ...(r.expr ? { expr: r.expr } : {}) })).filter(Boolean);
    if (reqs.length) { c.phase = 'rolls'; c.round.rollRequests = reqs; } else openActions(c);
    c.lastPlayedAt = Date.now();
    pushViews(c);
    return { ok: true };
  }
  if (c.sessionNumber === 1 && !c.chronicle.turns.length) {
    if (!c.scene.tacticalMapId && c.scene.location) {
      // nothing; the opening turn may set a scene map
    }
    runTurn(c, {
      kind: 'opening',
      text: `This is the very first session. Open the campaign: set the scene at the starting location (${c.scene.location || 'see world bible'}) with the opening hook ("${c.world.openingHook}"). Introduce each PRESENT character in their own segment with a personal, sensory moment that ties to their backstory, then bring them together and end on a hook that invites action. Lay the scene out on a battle map ("sceneMap") if positions could matter. Mention which local maps exist only through the fiction (e.g. a cartographer's stall), don't hand them out.`,
    });
  } else {
    const last = c.sessions[c.sessions.length - 2];
    runTurn(c, {
      kind: 'recap',
      text: `A new session begins (session ${c.sessionNumber}). Open with a spoken "Previously on..." recap in one "all" segment${last?.recap ? ` based on: "${last.recap}"` : ''}, then re-establish exactly where each present character is and what they perceive right now, and end inviting action.`,
    });
  }
  return { ok: true };
}

export async function endSession(c) {
  if (!c.sessionActive) return { error: 'No session is running.' };
  if (c.combat) return { error: 'Finish or end the fight first.' };
  c.sessionActive = false;
  c.phase = 'idle';
  const sess = c.sessions[c.sessions.length - 1];
  sess.endedAt = Date.now();
  addLog(c, { kind: 'session_end', text: `End of session ${c.sessionNumber}`, n: c.sessionNumber });
  setThinking(c, 'session_end', 'The Dungeon Master is writing up the session…');
  try {
    const prompt = [
      `# SESSION ${c.sessionNumber} JUST ENDED. Write the session log.`,
      `# PARTY\n${partyBlock(c, onlineUsers(c))}`,
      `# NPC ROSTER\n${npcBlock(c)}`,
      `# QUESTS\n${questBlock(c)}`,
      `# SCENE NOW\n${sceneBlock(c)}`,
      `# PREVIOUS CAMPAIGN LOG ENTRIES\n${c.sessions.slice(0, -1).map((s) => s.logEntry).filter(Boolean).slice(-3).join('\n\n') || '(first session)'}`,
      historyBlock({ ...c, chronicle: { summary: c.chronicle.summary, turns: c.chronicle.turns.filter((t) => t.at >= sess.startedAt) } }),
    ].join('\n\n');
    const res = await askClaude({ task: 'session_end', system: SESSION_END_CORE, cachedContext: cachedCampaignContext(c), prompt, schema: SESSION_END_SCHEMA, model: c.settings.model, effort: 'medium', campaignId: c.id });
    trackUsage(c, res);
    const d = res.data;
    sess.logEntry = d.campaignLogEntry || '';
    sess.recap = d.recapBlurb || '';
    sess.partyState = d.partyState || '';
    for (const u of d.npcUpdates || []) {
      const n = c.npcs[u.id];
      if (n) { if (u.status) n.status = u.status; if (u.notes) n.notes = u.notes; if (u.attitude) n.attitude = u.attitude; }
    }
    for (const q of d.questUpdates || []) upsertQuest(c, q);
    if (d.dmSecrets) c.world.secrets = d.dmSecrets;
    if (d.storyArc) c.world.arc = d.storyArc;
    if (d.chronicle) c.chronicle.summary = d.chronicle;
    system(c, `📖 The chronicle of session ${c.sessionNumber} has been written. Read it in the Journal panel.`, 'all', { tone: 'good' });
  } catch (e) {
    if (!(e instanceof NoAIError)) console.error('[session_end]', e);
    sess.logEntry = `## Session ${c.sessionNumber}\n\n${c.chronicle.turns.filter((t) => t.at >= sess.startedAt).map((t) => t.summary).filter(Boolean).join(' ')}`;
  } finally {
    c.thinking = null;
    pushViews(c);
  }
  return { ok: true };
}

// ---------------------------------------------------------------- world building + character help

export async function runGenesis(c) {
  c.status = 'genesis';
  setThinking(c, 'genesis', 'The Dungeon Master is building your world…');
  const s = c.settings;
  const brief = [
    `Campaign name: ${c.name}`,
    `Tone: ${[].concat(s.tone).join(', ')}`,
    `Inspiration: ${s.inspiration || 'none - from scratch'}`,
    `Premise / what the group wants: ${s.premise || 'surprise us'}`,
    `Magic level: ${s.magicLevel}; lethality: ${s.lethality}; campaign shape: ${s.shape}; pacing: ${s.pacing}; starting level: ${s.startLevel}`,
    `Lines (never include): ${s.lines || 'none stated'}; veils (fade to black): ${s.veils || 'none stated'}`,
    `Number of players expected: ${Math.max(1, c.members.length)}-${Math.max(4, c.members.length)}`,
  ].join('\n');
  try {
    const res = await askClaude({ task: 'genesis', system: GENESIS_CORE, prompt: `# THE GROUP'S BRIEF\n${brief}`, schema: GENESIS_SCHEMA, model: c.settings.model, effort: 'high', maxTokens: 32000, campaignId: c.id });
    trackUsage(c, res);
    applyGenesis(c, res.data);
  } catch (e) {
    if (!(e instanceof NoAIError)) console.error('[genesis]', e);
    c.world.title = c.world.title || c.name;
    c.world.bible = c.world.bible || `# ${c.name}\n\n${s.premise || 'A world waiting to be written.'}\n\n*The AI Dungeon Master isn't connected, so this world bible is a blank page. The campaign owner can write it from the DM Screen.*`;
    c.status = 'ready';
    c.genesisError = e instanceof NoAIError ? 'no-ai' : String(e.message || e).slice(0, 200);
  } finally {
    c.thinking = null;
    pushViews(c);
  }
}

export function applyGenesis(c, d) {
  c.world.title = d.title || c.name;
  c.world.tagline = d.tagline || '';
  c.world.bible = d.worldBible || '';
  c.world.secrets = d.dmSecrets || '';
  c.world.arc = d.storyArc || '';
  c.world.characterPrompts = d.characterPrompts || [];
  c.world.openingHook = d.openingHook || '';
  for (const n of d.npcs || []) upsertNpc(c, n);
  for (const m of d.areaMaps || []) upsertAreaMap(c, m);
  for (const q of d.quests || []) upsertQuest(c, q);
  const st = d.startingScene || {};
  Object.assign(c.scene, { location: st.location || '', timeOfDay: st.timeOfDay || '', weather: st.weather || '', mood: st.mood || '' });
  if (st.areaMapId) moveParty(c, st.areaMapId, st.areaLocationId);
  c.log = c.log.filter((e) => e.kind !== 'system');
  c.status = 'ready';
  c.genesisError = null;
}

export async function characterAssist(c, userId, p) {
  const prompt = [
    `# WORLD BIBLE\n${c.world.bible || '(none)'}`,
    `# NPC ROSTER\n${npcBlock(c)}`,
    c.world.characterPrompts?.length ? `# CHARACTER PROMPTS\n${c.world.characterPrompts.map((x) => `- ${x}`).join('\n')}` : '',
    `# THE PLAYER'S CHOICES SO FAR\n${JSON.stringify(p, null, 1).slice(0, 3000)}`,
    `# OTHER CHARACTERS IN THE PARTY\n${partyCharacters(c).map((ch) => `- ${ch.name}, ${ch.race} ${ch.class}: ${String(ch.backstory || '').slice(0, 200)}`).join('\n') || '(none yet)'}`,
  ].filter(Boolean).join('\n\n');
  const res = await askClaude({ task: 'character', system: CHARACTER_ASSIST_CORE, cachedContext: c.world.secrets ? `# DM SECRETS (use only to plant a hook, never reveal)\n${c.world.secrets}` : '', prompt, schema: CHARACTER_ASSIST_SCHEMA, model: c.settings.model, effort: 'low', campaignId: c.id });
  trackUsage(c, res);
  if (res.data.secretHook) c.world.dmNotes.push(`Character hook (${p.name || 'new character'}): ${res.data.secretHook}`);
  saveCampaign(c);
  const { secretHook, ...visible } = res.data;
  return visible;
}

export { aiStatus };
