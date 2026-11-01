// Builds what ONE player is allowed to see: their own narration, the tokens their character can perceive,
// their fog of war, their maps, their notes. This is the privacy boundary - nothing hidden leaves the server.
import { getUser } from '../auth.js';
import { getCharacter, partyCharacters, characterOwner, member } from './campaign.js';
import { computeLight, computeVisibility, encodeCells } from './vision.js';
import { safeDerive } from './context.js';
import * as combat from './combat.js';
import { onlineUsers, requiredUsers } from './engine.js';
import { aiStatus, PRICES } from '../ai/client.js';

export function logVisibleTo(c, entry, userId) {
  // a player's declared action is theirs alone: the others hear about it at the table, or through the DM's narration
  if (entry.kind === 'action') {
    if (entry.userId === userId) return true;
    const m = member(c, userId);
    return m?.role === 'owner' && !!c.settings.dmView;
  }
  if (entry.to === 'all' || !entry.to) return true;
  if (Array.isArray(entry.to)) {
    if (entry.to.includes(userId)) return true;
    const m = member(c, userId);
    return m?.role === 'owner' && c.settings.dmView;
  }
  return false;
}

export function visibleLog(c, userId, limit = 220) {
  const out = [];
  for (let i = c.log.length - 1; i >= 0 && out.length < limit; i--) if (logVisibleTo(c, c.log[i], userId)) out.push(c.log[i]);
  return out.reverse();
}

function playerMap(map) {
  // secret doors look like walls; hidden objects are removed
  const tiles = map.tiles.split('');
  const doors = [];
  for (const d of map.doors || []) {
    if (d.secret) tiles[d.y * map.w + d.x] = '#';
    else doors.push({ x: d.x, y: d.y, open: !!d.open, locked: !!d.locked });
  }
  return {
    id: map.id, kind: 'tactical', name: map.name, theme: map.theme, seed: map.seed, w: map.w, h: map.h, tiles: tiles.join(''),
    objects: (map.objects || []).filter((o) => !o.hidden), doors, lights: map.lights || [], ambient: map.ambient, regions: map.regions || [],
  };
}

function orInto(explored, vis) {
  const arr = explored ? explored.split('') : new Array(vis.length).fill('0');
  let changed = false;
  for (let i = 0; i < vis.length; i++) if (vis[i] > 0 && arr[i] !== '1') { arr[i] = '1'; changed = true; }
  return { str: arr.join(''), changed };
}

function tacticalView(c, userId, cache) {
  const map = c.maps.tactical[c.scene.tacticalMapId];
  if (!map) return null;
  const m = member(c, userId);
  const godView = m?.role === 'owner' && c.settings.dmView;
  if (!cache.light) {
    const extra = Object.values(c.tokens).filter((t) => t.light && !t.dead).map((t) => ({ x: t.x, y: t.y, bright: t.light.bright, dim: t.light.dim }));
    cache.light = computeLight(map, extra);
  }
  const light = cache.light;
  const myTok = Object.values(c.tokens).find((t) => t.characterId && t.characterId === m?.characterId);
  const myChar = getCharacter(m?.characterId);
  let vis = null;
  if (godView) {
    vis = null; // the owner's spoiler view: no fog at all
  } else if (myTok && myChar && myChar.hp.current > 0) {
    vis = computeVisibility(map, { x: myTok.x, y: myTok.y, size: myTok.size || 1, darkvision: myChar.darkvision || 0, blind: (myChar.conditions || []).includes('blinded') }, light);
  } else if (!godView) {
    vis = new Uint8Array(map.w * map.h); // unconscious or no token: nothing visible (explored memory still shows)
  }
  c.explored[map.id] ||= {};
  let explored = c.explored[map.id][userId] || null;
  if (vis) { const r = orInto(explored, vis); explored = r.str; if (r.changed) c.explored[map.id][userId] = explored; }

  const k = c.combat;
  const tokens = [];
  for (const t of Object.values(c.tokens)) {
    const cells = [];
    for (let dx = 0; dx < (t.size || 1); dx++) for (let dy = 0; dy < (t.size || 1); dy++) cells.push((t.y + dy) * map.w + t.x + dx);
    const seen = !vis || cells.some((i) => vis[i] > 0);
    const party = t.kind === 'pc' || t.kind === 'ally';
    const hiddenFromMe = t.hidden && !t.revealedTo.includes(userId);
    if (!godView) {
      if (!party && (!seen || hiddenFromMe)) continue;
      if (party && hiddenFromMe && t.characterId !== m?.characterId && !seen) { /* hidden allies still shown faded */ }
    }
    const cb = k ? k.combatants[t.combatantId] : null;
    let health = null, hp = null;
    if (t.kind === 'pc') {
      const ch = getCharacter(t.characterId);
      if (ch) { hp = { cur: ch.hp.current, max: ch.hp.max, temp: ch.hp.temp || 0 }; health = ch.dead ? 'dead' : ch.hp.current <= 0 ? 'down' : combat.healthTier(ch.hp.current, ch.hp.max); }
    } else if (cb && !combat.isPc(cb)) {
      health = cb.dead ? 'dead' : combat.healthTier(cb.hp.cur, cb.hp.max);
      if (t.kind === 'ally' || godView) hp = { cur: cb.hp.cur, max: cb.hp.max, temp: cb.hp.temp || 0 };
    } else if (t.dead) health = 'dead';
    const conditions = t.kind === 'pc' ? (getCharacter(t.characterId)?.conditions || []) : (cb?.conditions || []);
    tokens.push({
      id: t.id, name: t.name, kind: t.kind, x: t.x, y: t.y, size: t.size || 1, color: t.color, img: t.img || null, initials: t.initials,
      health, hp, conditions, isMine: !!(t.characterId && t.characterId === m?.characterId),
      isTurn: !!(k && cb && k.order[k.turnIndex] === cb.id), hidden: !!t.hidden && (godView || t.characterId === m?.characterId),
      outOfSight: party && !seen, combatantId: t.combatantId || null, characterId: t.characterId || null,
    });
  }
  return { map: playerMap(map), vis: vis ? encodeCells(vis) : null, explored: explored || null, tokens, light: encodeCells(light) };
}

function areaView(c, userId) {
  const out = [];
  const m = member(c, userId);
  const god = m?.role === 'owner' && c.settings.dmView;
  for (const map of Object.values(c.maps.area || {})) {
    const k = c.knowledge[userId]?.[map.id] || { owned: false, discovered: [], current: null };
    const discovered = new Set(k.discovered || []);
    if (!k.owned && !discovered.size && map.id !== c.scene.areaMapId && !god) continue;
    const locations = map.locations.filter((l) => god || discovered.has(l.id) || (k.owned && !l.secret));
    out.push({ map: { ...map, locations }, knowledge: { owned: !!k.owned || god, discovered: [...discovered], current: c.scene.areaMapId === map.id ? c.scene.areaLocationId || k.current : k.current } });
  }
  return out;
}

function combatView(c, userId) {
  const k = c.combat;
  if (!k) return null;
  const m = member(c, userId);
  const god = m?.role === 'owner' && c.settings.dmView;
  const cur = k.combatants[k.order[k.turnIndex]];
  const order = k.order.map((id) => k.combatants[id]).filter((x) => {
    if (combat.isPc(x) || x.kind === 'ally' || god) return true;
    const t = c.tokens[x.tokenId];
    return t && (!t.hidden || t.revealedTo.includes(userId));
  }).map((x) => {
    const pc = combat.isPc(x);
    const ch = pc ? getCharacter(x.characterId) : null;
    return {
      id: x.id, name: x.name, kind: x.kind, init: x.init, tokenId: x.tokenId, characterId: x.characterId || null,
      health: pc ? (ch?.dead ? 'dead' : ch?.hp.current <= 0 ? 'down' : combat.healthTier(ch?.hp.current || 0, ch?.hp.max || 1)) : combat.healthTier(x.dead ? 0 : x.hp.cur, x.hp.max),
      dead: pc ? !!ch?.dead : !!(x.dead || x.fled || x.surrendered), current: cur?.id === x.id,
      color: pc ? ch?.color : x.kind === 'ally' ? '#7bd88f' : '#e05a4f',
    };
  });
  const myCb = Object.values(k.combatants).find((x) => x.characterId && x.characterId === m?.characterId);
  const myTurn = !!(cur && myCb && cur.id === myCb.id);
  return {
    round: k.round, state: k.state, order, currentId: cur?.id || null,
    currentName: cur && (combat.isPc(cur) || !c.tokens[cur.tokenId]?.hidden || god) ? cur.name : 'Someone unseen',
    myTurn, myCombatantId: myCb?.id || null, economy: myTurn ? combat.movementInfo(c, myCb) : null,
    pending: Object.values(k.pending || {}).filter((p) => p.userId === userId).map((p) => ({ id: p.id, label: p.label, dice: p.dice, type: p.type, crit: p.crit, versatile: p.versatile, melee: p.melee, options: p.options || [] })),
  };
}

function partyView(c) {
  return partyCharacters(c).map((ch) => {
    const d = safeDerive(ch);
    const uid = characterOwner(c, ch.id);
    return {
      id: ch.id, userId: uid, name: ch.name, race: ch.race, subrace: ch.subrace, class: ch.class, level: ch.level, portrait: ch.portrait, color: ch.color,
      hp: ch.hp, ac: d?.ac ?? null, conditions: ch.conditions || [], dead: !!ch.dead, deathSaves: ch.deathSaves, passivePerception: d?.passive?.perception ?? null,
      playerName: getUser(uid)?.displayName || '?',
    };
  });
}

export function buildView(c, userId, cache = {}) {
  const m = member(c, userId);
  const isOwner = m?.role === 'owner';
  const online = onlineUsers(c);
  const need = requiredUsers(c);
  const rollPool = [...(c.round.rollRequests || []), ...(c.combat?.rollRequests || [])];
  const myRolls = rollPool.filter((r) => r.userId === userId && r.status === 'pending').map((r) => ({ id: r.id, kind: r.kind, key: r.key, dc: r.secret ? 0 : r.dc, advantage: r.advantage, reason: r.reason, purpose: r.purpose, label: r.label }));
  const waitingRolls = rollPool.filter((r) => r.status === 'pending').map((r) => ({ characterName: r.characterName, userId: r.userId, label: r.secret ? 'a secret roll' : r.reason?.slice(0, 60) }));
  const view = {
    at: Date.now(),
    me: { userId, role: m?.role || null, characterId: m?.characterId || null, away: !!m?.away },
    campaign: {
      id: c.id, name: c.name, status: c.status, ownerId: c.ownerId, inviteCode: c.inviteCode,
      title: c.world.title, tagline: c.world.tagline, characterPrompts: c.world.characterPrompts, openingHook: c.world.openingHook,
      sessionActive: c.sessionActive, sessionNumber: c.sessionNumber, genesisError: c.genesisError || null,
      settings: { model: c.settings.model, effort: c.settings.effort, enemyTactics: c.settings.enemyTactics, autoReadAloud: c.settings.autoReadAloud, dmView: !!c.settings.dmView, tone: c.settings.tone, startLevel: c.settings.startLevel },
    },
    members: c.members.map((x) => {
      const u = getUser(x.userId);
      return { userId: x.userId, role: x.role, displayName: u?.displayName || '?', color: u?.color, online: online.has(x.userId), characterId: x.characterId, away: !!x.away, submitted: !!c.round.actions[x.userId], required: need.includes(x.userId) };
    }),
    party: partyView(c),
    myCharacter: m?.characterId ? getCharacter(m.characterId) : null,
    phase: c.phase,
    thinking: c.thinking || null,
    round: { n: c.round.n, myAction: c.round.actions[userId] || null, myRevision: c.round.revise?.[userId] || null, submittedCount: Object.keys(c.round.actions).length, requiredCount: need.length },
    rolls: { mine: myRolls, waiting: waitingRolls },
    scene: { ...c.scene },
    tactical: tacticalView(c, userId, cache),
    areaMaps: areaView(c, userId),
    combat: combatView(c, userId),
    npcs: Object.values(c.npcs).filter((n) => c.log.some((e) => e.parts?.some((p) => p.speaker === n.id) && logVisibleTo(c, e, userId)) || isOwner && c.settings.dmView || n.ally).map((n) => ({ id: n.id, name: n.name, role: n.role, description: n.description, voice: n.voice, attitude: n.attitude, location: n.location, status: n.status, color: n.color, ally: !!n.ally })),
    voices: Object.fromEntries(Object.values(c.npcs).map((n) => [n.id, { name: n.name, voice: n.voice, color: n.color }])),
    quests: c.quests.map((q) => ({ id: q.id, title: q.title, status: q.status, summary: q.summary, giver: q.giver, updates: q.updates.slice(-5) })),
    handouts: c.handouts.filter((h) => h.to === 'all' || (Array.isArray(h.to) && h.to.includes(userId))),
    journal: {
      worldBible: c.world.bible,
      storySoFar: c.world.storySoFar || '',
      sessions: c.sessions.map((s) => ({ n: s.n, startedAt: s.startedAt, endedAt: s.endedAt, logEntry: s.logEntry, recap: s.recap, partyState: s.partyState })),
    },
    notes: c.notes[userId] || '',
    ai: { ...aiStatus(), usage: isOwner ? { ...c.usage } : null, models: Object.entries(PRICES).map(([id, p]) => ({ id, label: p.label })) },
    canRetry: c.phase === 'failed' || c.combat?.state === 'enemy_failed',
  };
  if (isOwner && c.settings.dmView) {
    view.dm = { secrets: c.world.secrets, arc: c.world.arc, notes: c.world.dmNotes.slice(-30), allNpcs: Object.values(c.npcs) };
  }
  return view;
}
