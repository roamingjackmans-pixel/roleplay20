// Combat: initiative, turns, movement, attacks, spells, enemy turns (AI or quick tactics), hidden creatures.
import { randomId } from '../security.js';
import { srd, findMonster } from '../srd.js';
import { askClaude, NoAIError } from '../ai/client.js';
import { COMBAT_CORE, DM_CORE } from '../ai/prompts.js';
import { COMBAT_SCHEMA, TURN_SCHEMA } from '../ai/schemas.js';
import { getCharacter, saveCharacter, partyCharacters, characterOwner, member } from './campaign.js';
import { cachedCampaignContext, safeDerive, partyBlock, npcBlock } from './context.js';
import { generateTacticalMap, placeCreatures, describeMapForAI } from './mapgen.js';
import { computeLight, computeVisibility } from './vision.js';
import { findPath, distanceFeet } from './pathing.js';
import { templateCells } from '../../shared/templates.js';
import { rollDice, rollD20, manualD20 } from '../../shared/dice.js';
import { abilityMod, spellDamage, spellHealing, monsterSaveBonus } from '../../shared/rules.js';
import * as E from './engine.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const INCAPACITATING = ['paralyzed', 'stunned', 'unconscious', 'petrified', 'incapacitated'];

// ---------------------------------------------------------------- actors

const cbOf = (c, id) => c.combat?.combatants?.[id] || null;
export const isPc = (cb) => cb?.kind === 'pc';
function charOf(cb) { return cb?.characterId ? getCharacter(cb.characterId) : null; }
function tokenOf(c, cb) { return cb ? c.tokens[cb.tokenId] : null; }

function conditionsOf(cb) {
  if (isPc(cb)) return new Set(charOf(cb)?.conditions || []);
  return new Set(cb.conditions || []);
}

function alive(cb) {
  if (!cb) return false;
  if (isPc(cb)) { const ch = charOf(cb); return !!ch && !ch.dead; }
  return !cb.dead && !cb.fled && !cb.surrendered;
}

function conscious(cb) {
  if (!alive(cb)) return false;
  if (isPc(cb)) return (charOf(cb)?.hp.current || 0) > 0;
  return cb.hp.cur > 0;
}

function acOf(c, cb) {
  if (isPc(cb)) {
    const ch = charOf(cb);
    const d = safeDerive(ch);
    return (d?.ac ?? 10) + (conditionsOf(cb).has('shielded') ? 5 : 0);
  }
  return cb.stat.ac;
}

function hostile(a, b) {
  const side = (x) => (x.kind === 'enemy' ? 'foe' : 'party');
  return side(a) !== side(b);
}

function speedOf(cb) {
  const cond = conditionsOf(cb);
  if (cond.has('grappled') || cond.has('restrained') || INCAPACITATING.some((x) => cond.has(x))) return 0;
  let s;
  if (isPc(cb)) { const ch = charOf(cb); s = safeDerive(ch)?.speed ?? ch?.speed ?? 30; if ((ch?.exhaustion || 0) >= 2) s = Math.floor(s / 2); }
  else s = cb.stat.speed || 30;
  if (cond.has('slowed')) s = Math.floor(s / 2);
  return s;
}

function displayName(c, cb) { return cb?.name || '?'; }

function healthTier(cur, max) {
  if (cur <= 0) return 'dead';
  const r = cur / Math.max(1, max);
  if (r >= 1) return 'unhurt';
  if (r > 0.5) return 'hurt';
  if (r > 0.25) return 'bloodied';
  return 'critical';
}
export { healthTier };

// ---------------------------------------------------------------- monsters

export function normalizeMonster(m, overrides = {}) {
  const speed = typeof m.speed === 'number' ? m.speed : parseInt(m.speed?.walk ?? m.speed?.fly ?? 30, 10) || 30;
  const ab = m.abilities || { str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma };
  const ac = typeof m.ac === 'number' ? m.ac : Array.isArray(m.armor_class) ? m.armor_class[0]?.value : m.ac?.value || 12;
  const hp = m.hp ?? m.hit_points ?? 10;
  const actions = (m.actions || []).map((a) => ({
    name: a.name, desc: a.desc || '', kind: a.kind || (a.attackBonus != null || a.attack_bonus != null ? (/ranged/i.test(a.desc || '') ? 'ranged' : 'melee') : /multiattack/i.test(a.name) ? 'multiattack' : a.dc ? 'save' : 'other'),
    attackBonus: a.attackBonus ?? a.attack_bonus ?? null,
    damage: (a.damage || []).map((d) => ({ dice: d.dice || d.damage_dice, type: d.type || d.damage_type?.index || d.damage_type || '' })).filter((d) => d.dice),
    reachFt: a.reachFt || (parseInt(/reach (\d+)/.exec(a.desc || '')?.[1], 10) || 5),
    rangeFt: a.rangeFt || (() => { const r = /range (\d+)\/(\d+)/.exec(a.desc || ''); return r ? { normal: +r[1], long: +r[2] } : null; })(),
    dc: a.dc && (a.dc.value || a.dc.dc_value) ? { ability: (a.dc.ability || a.dc.dc_type?.index || 'dex').slice(0, 3), value: a.dc.value || a.dc.dc_value, success: a.dc.success || a.dc.success_type || 'half' } : null,
    multiattack: a.multiattack || null,
    area: (() => { const r = /(\d+)-foot[- ](cone|line|cube|sphere|radius)/i.exec(a.desc || ''); return r ? { size: +r[1], shape: r[2].toLowerCase() === 'radius' ? 'sphere' : r[2].toLowerCase() } : null; })(),
  }));
  return {
    index: m.index || 'custom', ac, hp, speed, size: { tiny: 1, small: 1, medium: 1, large: 2, huge: 3, gargantuan: 4 }[String(m.size || 'medium').toLowerCase()] || 1,
    abilities: { str: ab.str ?? 10, dex: ab.dex ?? 10, con: ab.con ?? 10, int: ab.int ?? 10, wis: ab.wis ?? 10, cha: ab.cha ?? 10 },
    saves: m.saves || {}, skills: m.skills || {}, darkvision: m.senses?.darkvision ?? (parseInt(m.senses?.darkvision, 10) || 0),
    passivePerception: m.senses?.passivePerception ?? m.senses?.passive_perception ?? 10,
    cr: m.cr ?? m.challenge_rating ?? 0, xp: m.xp ?? 0, actions,
    traits: (m.traits || m.special_abilities || []).map((t) => `${t.name}: ${t.desc}`).join(' ').slice(0, 900),
    resist: [].concat(m.resistances || m.damage_resistances || []).join(' ').toLowerCase(),
    immune: [].concat(m.immunities || m.damage_immunities || []).join(' ').toLowerCase(),
    vuln: [].concat(m.vulnerabilities || m.damage_vulnerabilities || []).join(' ').toLowerCase(),
    condImmune: [].concat(m.conditionImmunities || m.condition_immunities || []).map((x) => (x.index || x.name || x).toString().toLowerCase()),
    ...overrides,
  };
}

/** A one-off creature from the DM: "Bone Claw +5 2d6+3 slashing reach 5" or "Acid Spit +4 1d8 acid range 30". */
export function parseCustomAttack(text) {
  const t = String(text || '').trim();
  const m = /^(.*?)\s*\+(\d+)\s+(\d+d\d+(?:\s*[+-]\s*\d+)?)\s*([a-z]+)?(?:.*?\b(reach|range)\s*(\d+))?/i.exec(t);
  if (!m) return { name: t || 'Strike', attackBonus: 4, damage: [{ dice: '1d8+2', type: 'bludgeoning' }], reachFt: 5, rangeFt: null, kind: 'melee', desc: t };
  const ranged = /range/i.test(m[5] || '');
  const dist = Number(m[6]) || (ranged ? 30 : 5);
  return { name: m[1] || 'Strike', attackBonus: Number(m[2]), damage: [{ dice: m[3].replace(/\s+/g, ''), type: (m[4] || 'bludgeoning').toLowerCase() }], reachFt: ranged ? null : dist, rangeFt: ranged ? { normal: dist, long: dist * 4 } : null, kind: ranged ? 'ranged' : 'melee', desc: t };
}

function customMonster(g) {
  const cr = g.customCr || 0.5;
  return normalizeMonster({
    index: 'custom', ac: g.customAc || 12, hp: g.customHp || 11, speed: g.customSpeed || 30, cr, xp: Math.round(cr * 200),
    abilities: { str: 12, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    skills: {}, senses: { darkvision: 60, passivePerception: 11 },
    actions: [parseCustomAttack(g.customAttack)],
  });
}

function monsterStealth(stat) {
  return stat.skills?.stealth ?? abilityMod(stat.abilities.dex);
}

// ---------------------------------------------------------------- vision helpers

function lightFor(c, map) {
  const extra = Object.values(c.tokens).filter((t) => t.light && !t.dead).map((t) => ({ x: t.x, y: t.y, bright: t.light.bright, dim: t.light.dim }));
  return computeLight(map, extra);
}

function canSeeToken(c, map, light, viewerTok, viewerDarkvision, targetTok) {
  const vis = computeVisibility(map, { x: viewerTok.x, y: viewerTok.y, size: viewerTok.size || 1, darkvision: viewerDarkvision || 0 }, light);
  for (let dx = 0; dx < (targetTok.size || 1); dx++) for (let dy = 0; dy < (targetTok.size || 1); dy++) {
    const i = (targetTok.y + dy) * map.w + targetTok.x + dx;
    if (vis[i] > 0) return true;
  }
  return false;
}

/** Reveal hidden tokens to players whose characters can now perceive them (passive Perception vs Stealth). */
export function updateReveals(c, { force = false } = {}) {
  const map = c.maps.tactical[c.scene.tacticalMapId];
  if (!map) return;
  const hidden = Object.values(c.tokens).filter((t) => t.hidden && !t.dead);
  if (!hidden.length) return;
  const light = lightFor(c, map);
  for (const pcTok of Object.values(c.tokens).filter((t) => t.kind === 'pc')) {
    const ch = getCharacter(pcTok.characterId);
    const owner = characterOwner(c, pcTok.characterId);
    if (!ch || !owner || ch.hp.current <= 0) continue;
    const pp = safeDerive(ch)?.passive?.perception ?? 10;
    const vis = computeVisibility(map, { x: pcTok.x, y: pcTok.y, size: 1, darkvision: ch.darkvision || 0 }, light);
    for (const t of hidden) {
      if (t.revealedTo.includes(owner)) continue;
      if (vis[t.y * map.w + t.x] > 0 && (force || pp >= (t.stealth || 0))) {
        t.revealedTo.push(owner);
        E.addLog(c, { kind: 'system', text: `👁️ ${ch.name} spots ${t.name} lurking nearby!`, to: [owner], tone: 'warn' });
      }
    }
  }
}

function revealToWatchers(c, tok) {
  if (!tok?.hidden) return;
  const map = c.maps.tactical[c.scene.tacticalMapId];
  if (!map) return;
  const light = lightFor(c, map);
  for (const pcTok of Object.values(c.tokens).filter((t) => t.kind === 'pc')) {
    const ch = getCharacter(pcTok.characterId);
    const owner = characterOwner(c, pcTok.characterId);
    if (!ch || !owner || tok.revealedTo.includes(owner)) continue;
    if (canSeeToken(c, map, light, pcTok, ch.darkvision, tok)) tok.revealedTo.push(owner);
  }
}

// ---------------------------------------------------------------- start / end

export function startCombat(c, spec) {
  const party = partyCharacters(c);
  let map = c.maps.tactical[c.scene.tacticalMapId];
  if ((spec.map && !spec.useCurrentMap) || !map) {
    map = E.setSceneMap(c, spec.map || { theme: 'field', size: 'medium' });
    if (!map) { E.system(c, 'Could not build a battle map.', 'all', { tone: 'warn' }); E.openActions(c); return; }
  }
  // make sure every party member has a token
  const occupied = new Set(Object.values(c.tokens).map((t) => `${t.x},${t.y}`));
  for (const ch of party) {
    if (E.tokenForCharacter(c, ch.id)) continue;
    const pos = placeCreatures(map, [{ key: 'p', count: 1, size: 1, zone: 'party' }], { occupied }).p?.[0];
    if (pos) { occupied.add(`${pos[0]},${pos[1]}`); E.addToken(c, { kind: 'pc', characterId: ch.id, name: ch.name, x: pos[0], y: pos[1], color: ch.color, img: ch.portrait, darkvision: ch.darkvision || 0, light: ch.light }); }
  }
  const cb = {};
  const add = (x) => { cb[x.id] = x; return x; };
  for (const ch of party) {
    const tok = E.tokenForCharacter(c, ch.id);
    add({ id: randomId('cb_', 4), kind: 'pc', characterId: ch.id, name: ch.name, tokenId: tok?.id, init: null, dexMod: abilityMod(ch.abilities?.dex || 10) });
  }
  // enemies
  const groups = [];
  for (const g of spec.enemies || []) {
    const count = Math.max(1, Math.min(12, g.count || 1));
    const ref = g.monster && g.monster !== 'custom' ? findMonster(g.monster) : null;
    const stat = ref ? normalizeMonster(ref) : customMonster(g);
    const baseName = g.name || ref?.name || 'Enemy';
    const key = randomId('g_', 3);
    const pos = placeCreatures(map, [{ key, count, size: stat.size, zone: g.hidden ? 'hidden' : g.placement || 'far' }], { occupied })[key] || [];
    for (let i = 0; i < count; i++) {
      const p = pos[i];
      if (!p) continue;
      occupied.add(`${p[0]},${p[1]}`);
      const name = count > 1 ? `${baseName} ${i + 1}` : baseName;
      const stealthRoll = g.hidden ? rollD20(monsterStealth(stat)).total : 0;
      const id = randomId('cb_', 4);
      const tok = E.addToken(c, { kind: 'enemy', name, x: p[0], y: p[1], size: stat.size, color: '#c0392b', hidden: !!g.hidden, stealth: stealthRoll, combatantId: id, darkvision: stat.darkvision });
      add({ id, kind: 'enemy', name, monster: stat.index, stat, hp: { cur: stat.hp, max: stat.hp, temp: 0 }, tokenId: tok.id, init: null, dexMod: abilityMod(stat.abilities.dex), group: key, conditions: [], dead: false, xp: stat.xp || 0 });
    }
    groups.push(key);
  }
  // allies (NPCs fighting with the party)
  for (const npcId of spec.allies || []) {
    const n = c.npcs[npcId];
    if (!n) continue;
    let tok = Object.values(c.tokens).find((t) => t.npcId === npcId);
    if (!tok) {
      const p = placeCreatures(map, [{ key: 'a', count: 1, size: 1, zone: 'party' }], { occupied }).a?.[0];
      if (!p) continue;
      occupied.add(`${p[0]},${p[1]}`);
      tok = E.addToken(c, { kind: 'ally', npcId, name: n.name, x: p[0], y: p[1], color: n.color });
    }
    tok.kind = 'ally';
    const stat = normalizeMonster(findMonster(n.statBlock || 'guard') || { name: n.name });
    const id = randomId('cb_', 4);
    tok.combatantId = id;
    add({ id, kind: 'ally', npcId, name: n.name, stat, hp: { cur: stat.hp, max: stat.hp, temp: 0 }, tokenId: tok.id, init: null, dexMod: abilityMod(stat.abilities.dex), conditions: [], dead: false });
  }
  if (!Object.values(cb).some((x) => x.kind === 'enemy')) { E.system(c, 'The fight never quite starts.'); E.openActions(c); return; }

  c.combat = { id: randomId('cmb_', 4), round: 0, turnIndex: 0, state: 'initiative', order: [], combatants: cb, economy: {}, events: [], rollRequests: [], pending: {}, surprised: [], mapId: map.id, startedAt: Date.now(), reason: spec.reason || '', defeatedXp: 0, surprise: !!spec.surprise };
  c.phase = 'combat';
  for (const t of Object.values(c.tokens)) if (t.kind === 'pc') { const x = Object.values(cb).find((k) => k.characterId === t.characterId); if (x) t.combatantId = x.id; }
  updateReveals(c);
  E.addLog(c, { kind: 'combat', text: `⚔️ Roll for initiative!${spec.reason ? ` ${spec.reason}` : ''}`, tone: 'combat' });

  // initiative: groups share a roll; PCs roll themselves (online) or automatically (offline)
  const groupRolls = {};
  for (const x of Object.values(cb)) {
    if (x.kind === 'pc') continue;
    const key = x.group || x.id;
    groupRolls[key] ??= rollD20(x.dexMod);
    x.init = groupRolls[key].total;
  }
  const online = E.onlineUsers(c);
  for (const x of Object.values(cb).filter(isPc)) {
    const ch = charOf(x);
    const owner = characterOwner(c, x.characterId);
    if (c.combat.surprise) {
      // a surprised character is one who noticed none of the hidden enemies
      const noticed = Object.values(c.tokens).some((t) => t.kind === 'enemy' && t.hidden && t.revealedTo.includes(owner));
      if (!noticed && Object.values(c.tokens).some((t) => t.kind === 'enemy' && t.hidden)) c.combat.surprised.push(x.id);
    }
    if (!online.has(owner)) {
      x.init = E.performRoll(ch, { kind: 'initiative' }).total;
      continue;
    }
    const req = E.makeRollRequest(c, { characterId: ch.id, kind: 'initiative', key: 'dex', dc: 0, reason: 'Roll initiative!' }, 'initiative', { combatantId: x.id });
    if (req) c.combat.rollRequests.push(req);
  }
  maybeBeginRound(c);
}

function maybeBeginRound(c) {
  const k = c.combat;
  if (!k || k.state !== 'initiative') return;
  if (k.rollRequests.some((r) => r.purpose === 'initiative' && r.status === 'pending')) return;
  k.order = Object.values(k.combatants).sort((a, b) => (b.init ?? 0) - (a.init ?? 0) || b.dexMod - a.dexMod || (isPc(b) ? 1 : 0) - (isPc(a) ? 1 : 0)).map((x) => x.id);
  k.round = 1;
  k.turnIndex = 0;
  const order = k.order.map((id) => k.combatants[id]);
  E.addLog(c, { kind: 'combat', text: `Initiative order: ${order.filter((x) => isPc(x) || !(c.tokens[x.tokenId]?.hidden)).map((x) => `${x.name} (${x.init})`).join(' → ')}`, tone: 'combat' });
  if (k.surprised.length) E.system(c, `😱 Surprise! ${k.surprised.map((id) => k.combatants[id].name).join(', ')} ${k.surprised.length > 1 ? 'are' : 'is'} caught off guard and lose${k.surprised.length > 1 ? '' : 's'} the first turn.`, 'all', { tone: 'danger' });
  beginTurn(c);
}

/** A player who creates a character (or arrives) mid-fight joins the initiative order with an automatic roll. */
export function addPcToCombat(c, ch) {
  const k = c.combat;
  if (!k || Object.values(k.combatants).some((x) => x.characterId === ch.id)) return;
  const tok = E.tokenForCharacter(c, ch.id);
  const id = randomId('cb_', 4);
  const init = E.performRoll(ch, { kind: 'initiative' }).total;
  k.combatants[id] = { id, kind: 'pc', characterId: ch.id, name: ch.name, tokenId: tok?.id, init, dexMod: abilityMod(ch.abilities?.dex || 10) };
  if (tok) tok.combatantId = id;
  if (k.state === 'initiative') return;
  // insert into the order by initiative, without disturbing whose turn it is now
  const curId = k.order[k.turnIndex];
  let at = k.order.findIndex((oid) => (k.combatants[oid].init ?? 0) < init);
  if (at < 0) at = k.order.length;
  k.order.splice(at, 0, id);
  k.turnIndex = k.order.indexOf(curId);
  E.addLog(c, { kind: 'combat', text: `${ch.name} joins the fight (initiative ${init}).` });
}

export function endCombat(c, outcome = 'victory', reason = '') {
  const k = c.combat;
  if (!k) return;
  const enemies = Object.values(k.combatants).filter((x) => x.kind === 'enemy');
  const defeated = enemies.filter((x) => x.dead || x.surrendered);
  const fled = enemies.filter((x) => x.fled);
  const pcs = partyCharacters(c).filter((ch) => !ch.dead);
  const xp = defeated.reduce((s, x) => s + (x.xp || 0), 0);
  c.combat = null;
  // round-by-round states end with the fight
  for (const ch of partyCharacters(c)) {
    const before = (ch.conditions || []).length;
    ch.conditions = (ch.conditions || []).filter((x) => !['dodging', 'shielded', 'raging', 'hidden'].includes(x));
    if (ch.conditions.length !== before) saveCharacter(ch);
  }
  for (const t of Object.values(c.tokens)) {
    t.combatantId = null;
    if (t.kind === 'enemy' && t.dead) t.name = `${t.name} (dead)`;
  }
  E.addLog(c, { kind: 'combat', text: `🏁 The fight is over (${outcome}).`, tone: 'combat' });
  if (xp && pcs.length && outcome !== 'defeat') E.awardXp(c, pcs, Math.floor(xp / pcs.length), 'combat');
  E.runTurn(c, {
    kind: 'combat_end',
    text: `COMBAT HAS ENDED - outcome: ${outcome}${reason ? ` (${reason})` : ''}. Defeated: ${defeated.map((x) => x.name).join(', ') || 'none'}. Fled: ${fled.map((x) => x.name).join(', ') || 'none'}. Rounds: ${k.round}.\nFight log:\n${k.events.slice(-30).join('\n')}\n\nNarrate the aftermath for each character (what they see, how they feel, wounds, the silence after). Mention loot only if it makes sense (use item_add/gold effects when they take it). XP has already been awarded. Then invite action.`,
  });
}

function checkVictory(c) {
  const k = c.combat;
  if (!k) return false;
  const foes = Object.values(k.combatants).filter((x) => x.kind === 'enemy');
  if (foes.length && foes.every((x) => !alive(x))) { endCombat(c, foes.some((x) => x.dead) ? 'victory' : 'retreat'); return true; }
  const pcs = Object.values(k.combatants).filter(isPc);
  if (pcs.length && pcs.every((x) => !conscious(x))) {
    E.system(c, '☠️ Every hero has fallen…', 'all', { tone: 'danger' });
  }
  return false;
}

// ---------------------------------------------------------------- turns

function current(c) {
  const k = c.combat;
  return k ? k.combatants[k.order[k.turnIndex]] : null;
}
export { current as currentCombatant };

function resetEconomy(c, cb) {
  const ch = charOf(cb);
  const d = ch ? safeDerive(ch) : null;
  const extra = ch ? extraAttacks(ch) : 0;
  c.combat.economy[cb.id] = { action: false, bonus: false, reaction: false, moved: 0, speed: speedOf(cb), dash: false, attacksLeft: 0, maxAttacks: 1 + extra, sneakUsed: false, ac: d?.ac };
  if (cb.dodging) cb.dodging = false;
  if (ch && ch.conditions?.includes('dodging')) { ch.conditions = ch.conditions.filter((x) => x !== 'dodging'); saveCharacter(ch); }
  if (ch && ch.conditions?.includes('shielded')) { ch.conditions = ch.conditions.filter((x) => x !== 'shielded'); saveCharacter(ch); }
}

function extraAttacks(ch) {
  let n = 0;
  for (const k of ch.classes || [{ class: ch.class, level: ch.level }]) {
    if (k.class === 'fighter') n = Math.max(n, k.level >= 20 ? 3 : k.level >= 11 ? 2 : k.level >= 5 ? 1 : 0);
    else if (['barbarian', 'paladin', 'ranger', 'monk'].includes(k.class) && k.level >= 5) n = Math.max(n, 1);
  }
  return n;
}

function beginTurn(c) {
  const k = c.combat;
  if (!k) return;
  for (let guard = 0; guard < k.order.length * 2 + 2; guard++) {
    if (k.turnIndex >= k.order.length) { k.turnIndex = 0; k.round += 1; E.addLog(c, { kind: 'combat', text: `— Round ${k.round} —`, tone: 'round' }); }
    const cb = current(c);
    if (!cb || !alive(cb)) { k.turnIndex++; continue; }
    resetEconomy(c, cb);
    if (isPc(cb)) {
      const ch = charOf(cb);
      if (k.round === 1 && k.surprised.includes(cb.id)) { E.system(c, `${ch.name} is surprised and can't act this turn.`); k.turnIndex++; continue; }
      if (ch.hp.current <= 0) {
        if (ch.stable) { k.turnIndex++; continue; }
        k.state = 'waiting';
        const owner = characterOwner(c, ch.id);
        const req = E.makeRollRequest(c, { characterId: ch.id, kind: 'death', key: '', dc: 10, reason: `${ch.name} is dying. Roll a death saving throw!` }, 'death', { combatantId: cb.id });
        if (req) { k.rollRequests.push(req); if (!E.onlineUsers(c).has(owner)) E.completeRoll(c, req, E.performRoll(ch, { kind: 'death' }), { auto: true }); }
        E.pushViews(c);
        return;
      }
      const cond = conditionsOf(cb);
      const inc = INCAPACITATING.find((x) => cond.has(x));
      if (inc) { E.system(c, `${ch.name} is ${inc} and loses the turn.`); k.turnIndex++; continue; }
      k.state = 'turn';
      E.addLog(c, { kind: 'turn', text: `🎯 ${ch.name}'s turn`, characterId: ch.id, tone: 'turn' });
      const owner = characterOwner(c, ch.id);
      E.toast(c, [owner], "It's your turn! Move your token, attack or cast from your sheet, then End Turn.", 'turn');
      if (!E.onlineUsers(c).has(owner)) {
        // give a disconnected player time to come back (a page refresh shouldn't cost a turn)
        const turnKey = `${k.round}:${k.turnIndex}`;
        setTimeout(() => {
          if (c.combat !== k || `${k.round}:${k.turnIndex}` !== turnKey || k.state !== 'turn') return;
          if (E.onlineUsers(c).has(owner)) return;
          E.system(c, `${ch.name}'s player is away; they take the Dodge action.`);
          if (!ch.conditions.includes('dodging')) ch.conditions.push('dodging');
          saveCharacter(ch);
          k.turnIndex++;
          beginTurn(c);
          E.pushViews(c);
        }, 45000);
      }
      E.pushViews(c);
      return;
    }
    // a run of consecutive non-player combatants acts together
    const stretch = [];
    let i = k.turnIndex;
    while (i < k.order.length) {
      const x = k.combatants[k.order[i]];
      if (isPc(x)) break;
      if (alive(x)) stretch.push(x);
      i++;
    }
    k.state = 'enemy';
    k.stretch = { from: k.turnIndex, to: i, ids: stretch.map((x) => x.id) };
    E.pushViews(c);
    runEnemyPhase(c, stretch).catch((e) => console.error('[enemy phase]', e));
    return;
  }
}

export function endTurn(c, userId) {
  const k = c.combat;
  const cb = current(c);
  if (!k || !cb || !isPc(cb) || characterOwner(c, cb.characterId) !== userId) return { error: "It isn't your turn." };
  if (k.state === 'damage') { for (const id of Object.keys(k.pending)) if (k.pending[id].userId === userId) delete k.pending[id]; k.state = 'turn'; }
  if (k.state !== 'turn') return { error: 'Wait for the current action to finish.' };
  E.addLog(c, { kind: 'combat', text: `${cb.name} ends their turn.`, tone: 'muted' });
  k.turnIndex++;
  beginTurn(c);
  E.pushViews(c);
  return { ok: true };
}

/** Owner tool: skip the current combatant (stuck player, etc.). */
export function skipTurn(c) {
  const k = c.combat;
  if (!k) return { error: 'No fight.' };
  if (k.state === 'enemy') return { error: 'The enemies are acting.' };
  k.turnIndex++;
  beginTurn(c);
  E.pushViews(c);
  return { ok: true };
}

// ---------------------------------------------------------------- rolls coming back

const waiters = new Map(); // requestId -> resolve

function waitForRolls(c, reqs, timeoutMs = 60000) {
  return Promise.all(reqs.map((req) => new Promise((resolve) => {
    if (req.status === 'done') return resolve(req);
    waiters.set(req.id, resolve);
    setTimeout(() => {
      if (req.status === 'pending') {
        const ch = getCharacter(req.characterId);
        E.completeRoll(c, req, E.performRoll(ch, { kind: req.kind, key: req.key, advantage: req.advantage }), { auto: true });
      }
    }, timeoutMs);
  })));
}

export function onRollComplete(c, req) {
  const k = c.combat;
  const w = waiters.get(req.id);
  if (w) { waiters.delete(req.id); w(req); }
  if (!k) return;
  if (req.purpose === 'initiative') {
    const cb = k.combatants[req.combatantId];
    if (cb) cb.init = req.result.total;
    maybeBeginRound(c);
  } else if (req.purpose === 'death') {
    const ch = getCharacter(req.characterId);
    const n = req.result.natural ?? req.result.total;
    if (n === 20) { E.healCharacter(c, ch, 1); E.system(c, `✨ ${ch.name} rolls a natural 20 and surges back to consciousness!`, 'all', { tone: 'good' }); }
    else if (n >= 10) { ch.deathSaves.success += 1; if (ch.deathSaves.success >= 3) { ch.stable = true; E.system(c, `${ch.name} is stable.`, 'all', { tone: 'good' }); } }
    else { ch.deathSaves.fail += n === 1 ? 2 : 1; if (ch.deathSaves.fail >= 3) { ch.dead = true; E.system(c, `💀 ${ch.name} has died.`, 'all', { tone: 'danger' }); } }
    saveCharacter(ch);
    k.turnIndex++;
    beginTurn(c);
  } else if (req.purpose === 'concentration') {
    const ch = getCharacter(req.characterId);
    if (req.result.total < req.dc) dropConcentration(c, ch, 'lost concentration');
    else E.system(c, `${ch.name} keeps concentrating.`);
  } else if (req.purpose === 'combat_ask') {
    const all = k.rollRequests.filter((r) => r.purpose === 'combat_ask' && r.askId === req.askId);
    if (all.every((r) => r.status === 'done')) {
      const lines = all.map((r) => `${r.characterName} ${E.rollLabel(r)}: ${r.result.total}${r.dc ? ` vs DC ${r.dc} -> ${r.success ? 'SUCCESS' : 'FAILURE'}` : ''}`);
      k.rollRequests = k.rollRequests.filter((r) => r.askId !== req.askId);
      E.runTurn(c, { kind: 'combat_rolls', rollsText: lines, text: `COMBAT IS ONGOING. Roll results for the action you just adjudicated:\n${lines.join('\n')}\nNarrate the outcome briefly and apply it with effects (target combatant ids for enemies). Do not start a new combat, do not set sceneMap, do not request more rolls unless essential.` });
    }
  } else if (req.purpose === 'hide') {
    const cb = k.combatants[req.combatantId];
    const tok = tokenOf(c, cb);
    if (tok) { tok.stealth = req.result.total; E.system(c, `${cb.name} tries to hide (Stealth ${req.result.total}).`); }
  }
  k.rollRequests = k.rollRequests.filter((r) => r.status === 'pending' || r.purpose === 'combat_ask');
}

export function requestConcentration(c, ch, damage) {
  if (!c.combat) { return; }
  const dc = Math.max(10, Math.floor(damage / 2));
  const req = E.makeRollRequest(c, { characterId: ch.id, kind: 'save', key: 'con', dc, reason: `You took damage while concentrating on ${ch.concentration}. Constitution save (DC ${dc}) to keep it.` }, 'concentration');
  if (req) c.combat.rollRequests.push(req);
}

export function dropConcentration(c, ch, why) {
  const spell = ch.concentration;
  if (!spell) return;
  ch.concentration = null;
  saveCharacter(ch);
  if (c.combat) for (const x of Object.values(c.combat.combatants)) {
    if (x.conditionSources) for (const [cond, src] of Object.entries(x.conditionSources)) if (src === `${ch.id}:${spell}`) { x.conditions = (x.conditions || []).filter((y) => y !== cond); delete x.conditionSources[cond]; }
  }
  E.system(c, `${ch.name} ${why}: ${spellName(spell)} ends.`, 'all', { tone: 'warn' });
}

const spellName = (index) => srd().by.spells.get(index)?.name || index;

// ---------------------------------------------------------------- movement

function hostileCells(c, mover) {
  const set = new Set();
  const k = c.combat;
  for (const t of Object.values(c.tokens)) {
    if (t.id === mover.id || t.dead) continue;
    const other = k ? k.combatants[t.combatantId] : null;
    const me = k ? k.combatants[mover.combatantId] : null;
    const isHostile = other && me ? hostile(me, other) && alive(other) : (t.kind === 'enemy') !== (mover.kind === 'enemy');
    if (!isHostile) continue;
    for (let dx = 0; dx < (t.size || 1); dx++) for (let dy = 0; dy < (t.size || 1); dy++) set.add(`${t.x + dx},${t.y + dy}`);
  }
  return set;
}

function occupiedBy(c, x, y, except) {
  return Object.values(c.tokens).some((t) => t.id !== except && !t.dead && x >= t.x && x < t.x + (t.size || 1) && y >= t.y && y < t.y + (t.size || 1));
}

function openDoorsOnPath(map, path) {
  for (const p of path || []) {
    const d = map.doors?.find((dd) => dd.x === p.x && dd.y === p.y);
    if (d && !d.open && !d.locked) d.open = true;
  }
}

export function moveOutOfCombat(c, tok, x, y) {
  const map = c.maps.tactical[c.scene.tacticalMapId];
  if (!map) return { error: 'No map.' };
  if (x < 0 || y < 0 || x >= map.w || y >= map.h) return { error: 'Off the map.' };
  if (occupiedBy(c, x, y, tok.id)) return { error: 'Someone is already there.' };
  const blocked = hostileCells(c, tok);
  const res = findPath(map, { x: tok.x, y: tok.y }, { x, y }, { size: tok.size || 1, isBlocked: (cx, cy) => blocked.has(`${cx},${cy}`) });
  if (!res) return { error: "You can't get there from here." };
  openDoorsOnPath(map, res.path);
  tok.x = x; tok.y = y;
  updateReveals(c);
  E.pushViews(c);
  return { ok: true, feet: res.feet };
}

export function moveInCombat(c, userId, tok, x, y) {
  const k = c.combat;
  const cb = current(c);
  const map = c.maps.tactical[k.mapId] || c.maps.tactical[c.scene.tacticalMapId];
  if (!cb || cb.tokenId !== tok.id || k.state !== 'turn') return { error: 'You can only move on your turn.' };
  if (occupiedBy(c, x, y, tok.id)) return { error: 'That space is occupied.' };
  const eco = k.economy[cb.id];
  const budget = eco.speed * (eco.dash ? 2 : 1) - eco.moved;
  if (budget <= 0) return { error: 'You have no movement left.' };
  const blocked = hostileCells(c, tok);
  const res = findPath(map, { x: tok.x, y: tok.y }, { x, y }, { size: tok.size || 1, isBlocked: (cx, cy) => blocked.has(`${cx},${cy}`), maxFeet: budget });
  if (!res) return { error: `Too far (you have ${budget} ft of movement left).` };
  openDoorsOnPath(map, res.path);
  eco.moved += res.feet;
  tok.x = x; tok.y = y;
  k.events.push(`${cb.name} moves ${res.feet} ft to (${x},${y}).`);
  updateReveals(c);
  E.pushViews(c);
  return { ok: true, feet: res.feet, left: eco.speed * (eco.dash ? 2 : 1) - eco.moved };
}

export function movementInfo(c, cb) {
  const k = c.combat;
  const eco = k?.economy?.[cb?.id];
  if (!eco) return null;
  return { left: Math.max(0, eco.speed * (eco.dash ? 2 : 1) - eco.moved), speed: eco.speed, action: eco.action, bonus: eco.bonus, reaction: eco.reaction, attacksLeft: eco.attacksLeft, maxAttacks: eco.maxAttacks, dash: eco.dash };
}

// ---------------------------------------------------------------- attack math

function advantageFor(c, attacker, target, { ranged = false, distFt = 5 } = {}) {
  const map = c.maps.tactical[c.combat.mapId] || c.maps.tactical[c.scene.tacticalMapId];
  const aTok = tokenOf(c, attacker), tTok = tokenOf(c, target);
  const aCond = conditionsOf(attacker), tCond = conditionsOf(target);
  const adv = [], dis = [];
  if (tCond.has('prone')) (distFt <= 5 && !ranged ? adv : dis).push('target is prone');
  for (const x of ['restrained', 'stunned', 'paralyzed', 'unconscious', 'petrified', 'blinded']) if (tCond.has(x)) adv.push(`target is ${x}`);
  if (tCond.has('dodging') || target.dodging) dis.push('target is dodging');
  if (tCond.has('outlined')) adv.push('target is outlined (Faerie Fire)');
  for (const x of ['poisoned', 'blinded', 'frightened', 'restrained', 'prone']) if (aCond.has(x)) dis.push(`you are ${x}`);
  if (isPc(attacker) && (charOf(attacker)?.exhaustion || 0) >= 3) dis.push('exhaustion');
  if (aCond.has('invisible')) adv.push('you are invisible');
  if (tCond.has('invisible')) dis.push('target is invisible');
  if (ranged) {
    const nearFoe = Object.values(c.combat.combatants).some((x) => x.id !== attacker.id && hostile(attacker, x) && conscious(x) && tokenOf(c, x) && distanceFeet(tokenOf(c, x), aTok) <= 5);
    if (nearFoe) dis.push('a hostile creature is next to you');
  }
  if (map && aTok && tTok) {
    const light = lightFor(c, map);
    const aDv = isPc(attacker) ? charOf(attacker)?.darkvision : attacker.stat?.darkvision;
    const tDv = isPc(target) ? charOf(target)?.darkvision : target.stat?.darkvision;
    const attackerSeesTarget = canSeeToken(c, map, light, aTok, aDv, tTok) && !(tTok.hidden && isPc(attacker) && !tTok.revealedTo.includes(characterOwner(c, attacker.characterId)));
    const targetSeesAttacker = canSeeToken(c, map, light, tTok, tDv, aTok) && !(aTok.hidden && !isPc(attacker) ? false : aTok.hidden);
    if (!attackerSeesTarget) dis.push("you can't see the target");
    if (!targetSeesAttacker || (aTok.hidden && !isPc(attacker))) adv.push("the target can't see you");
  }
  return { mode: adv.length && dis.length ? 'none' : adv.length ? 'adv' : dis.length ? 'dis' : 'none', adv, dis };
}

function combine(auto, manual) {
  const a = (auto === 'adv' ? 1 : 0) + (manual === 'adv' ? 1 : 0);
  const d = (auto === 'dis' ? 1 : 0) + (manual === 'dis' ? 1 : 0);
  return a && d ? 'none' : a ? 'adv' : d ? 'dis' : 'none';
}

function scaleDamage(cb, amount, type) {
  if (isPc(cb) || !type) return { amount, note: '' };
  const t = String(type).toLowerCase();
  const s = cb.stat;
  if (s.immune.includes(t)) return { amount: 0, note: 'immune' };
  if (s.resist.includes(t)) return { amount: Math.floor(amount / 2), note: 'resisted' };
  if (s.vuln.includes(t)) return { amount: amount * 2, note: 'vulnerable' };
  return { amount, note: '' };
}

function applyDamage(c, target, amount, type, { crit = false, source = '' } = {}) {
  const sc = scaleDamage(target, amount, type);
  if (isPc(target)) {
    const ch = charOf(target);
    E.applyDamageToCharacter(c, ch, sc.amount, { type, crit, source });
    return { dealt: sc.amount, note: sc.note, down: ch.hp.current <= 0 };
  }
  let rest = sc.amount;
  if (target.hp.temp) { const t = Math.min(target.hp.temp, rest); target.hp.temp -= t; rest -= t; }
  target.hp.cur = Math.max(0, target.hp.cur - rest);
  // Undead Fortitude (zombies): CON save DC 5 + damage to drop to 1 HP instead, unless radiant or a critical hit
  if (target.hp.cur <= 0 && !target.dead && /undead fortitude/i.test(target.stat.traits || '') && !crit && String(type).toLowerCase() !== 'radiant') {
    const save = rollD20(monsterSaveBonus ? monsterSaveBonus({ abilities: target.stat.abilities, saves: target.stat.saves }, 'con') : abilityMod(target.stat.abilities.con || 10));
    const dc = 5 + sc.amount;
    if (save.total >= dc) {
      target.hp.cur = 1;
      E.addLog(c, { kind: 'combat', text: `💀 ${target.name} should have fallen - but it lurches back up! (Undead Fortitude: ${save.total} vs DC ${dc})`, tone: 'kill' });
      return { dealt: sc.amount, note: 'undead fortitude', down: false };
    }
  }
  if (target.hp.cur <= 0 && !target.dead) {
    target.dead = true;
    const tok = tokenOf(c, target);
    if (tok) { tok.dead = true; tok.hidden = false; }
    c.combat.defeatedXp += target.xp || 0;
    E.addLog(c, { kind: 'combat', text: `☠️ ${target.name} falls!`, tone: 'kill' });
  }
  return { dealt: sc.amount, note: sc.note, down: target.dead };
}

export function damageCombatantByRef(c, ref, amount, type) {
  if (!c.combat) return false;
  const cb = c.combat.combatants[ref] || Object.values(c.combat.combatants).find((x) => !isPc(x) && (x.tokenId === ref || x.name.toLowerCase() === String(ref).toLowerCase()));
  if (!cb || isPc(cb)) return false;
  const r = applyDamage(c, cb, amount, type);
  E.system(c, `💥 ${cb.name} takes ${r.dealt}${type ? ` ${type}` : ''} damage.`);
  checkVictory(c);
  return true;
}

export function conditionCombatantByRef(c, ref, cond, add) {
  if (!c.combat) return false;
  const cb = c.combat.combatants[ref] || Object.values(c.combat.combatants).find((x) => !isPc(x) && (x.tokenId === ref || x.name.toLowerCase() === String(ref).toLowerCase()));
  if (!cb || isPc(cb)) return false;
  cb.conditions = (cb.conditions || []).filter((x) => x !== cond);
  if (add && !cb.stat.condImmune.includes(cond)) cb.conditions.push(cond);
  if (cond === 'surrendered' || cond === 'fled') cb[cond] = add;
  return true;
}

function d20(mod, { advantage, mode, natural }) {
  if (mode === 'manual' && Number.isFinite(+natural)) return { ...manualD20(Math.min(20, Math.max(1, +natural)), mod), manual: true };
  return rollD20(mod, { advantage });
}

function rollDamage(expr, { crit, mode, total }) {
  if (mode === 'manual' && Number.isFinite(+total)) return { expr, total: Math.max(0, +total), text: `${expr} → ${total} (rolled at the table)`, manual: true };
  return rollDice(expr, { crit });
}

function diceCard(c, { name, label, result, advantage, outcome, to = 'all', tone, characterId }) {
  return E.addLog(c, { kind: 'dice', name, label, characterId, result: { total: result.total, natural: result.natural, text: result.text, manual: !!result.manual, isCrit: result.isCrit, isFumble: result.isFumble }, advantage, outcome, to, tone });
}

// ---------------------------------------------------------------- player attacks

function requirePlayerTurn(c, userId) {
  const k = c.combat;
  const cb = current(c);
  if (!k) return { error: 'There is no fight going on.' };
  if (!cb || !isPc(cb) || characterOwner(c, cb.characterId) !== userId) return { error: "It isn't your turn." };
  if (k.state !== 'turn') return { error: 'Wait a moment - something is still resolving.' };
  return { cb, ch: charOf(cb), k };
}

function targetCombatant(c, tokenId) {
  const t = c.tokens[tokenId];
  return t ? c.combat.combatants[t.combatantId] || null : null;
}

export function attack(c, userId, p) {
  const r = requirePlayerTurn(c, userId);
  if (r.error) return r;
  const { cb, ch, k } = r;
  const eco = k.economy[cb.id];
  const d = safeDerive(ch);
  const atk = (d?.attacks || []).find((a) => a.id === p.attackId) || (d?.attacks || [])[0];
  if (!atk) return { error: 'No attack selected.' };
  const target = targetCombatant(c, p.targetTokenId);
  if (!target || !alive(target)) return { error: 'Pick a target on the map.' };
  if (eco.attacksLeft <= 0) {
    if (eco.action) return { error: 'You have already used your action.' };
    eco.action = true;
    eco.attacksLeft = eco.maxAttacks;
  }
  const aTok = tokenOf(c, cb), tTok = tokenOf(c, target);
  const dist = distanceFeet({ ...aTok, size: aTok.size || 1 }, { ...tTok, size: tTok.size || 1 });
  const ranged = atk.kind === 'ranged' || (p.thrown && atk.rangeFt);
  let rangeDis = false;
  if (ranged) {
    const rng = atk.rangeFt || { normal: 20, long: 60 };
    if (dist > rng.long) return { error: `Out of range (${dist} ft; max ${rng.long} ft).` };
    if (dist > rng.normal) rangeDis = true;
  } else if (dist > (atk.reachFt || 5)) return { error: `Too far for a melee attack (${dist} ft). Move closer first.` };
  eco.attacksLeft -= 1;
  const auto = advantageFor(c, cb, target, { ranged, distFt: dist });
  if (rangeDis) { auto.dis.push('long range'); auto.mode = auto.adv.length ? 'none' : 'dis'; }
  const adv = combine(auto.mode, p.advantage);
  const roll = d20(atk.bonus, { advantage: adv, mode: p.mode, natural: p.natural });
  const ac = acOf(c, target);
  const crit = roll.natural === 20 || ((conditionsOf(target).has('paralyzed') || conditionsOf(target).has('unconscious')) && dist <= 5 && roll.total >= ac && roll.natural !== 1);
  const hit = roll.natural !== 1 && (roll.natural === 20 || roll.total >= ac);
  revealToWatchers(c, aTok);
  if (aTok.hidden) { aTok.hidden = false; }
  diceCard(c, { name: ch.name, characterId: ch.id, label: `${atk.name} vs ${target.name}`, result: roll, advantage: adv, outcome: crit ? 'CRITICAL HIT!' : hit ? 'Hit!' : 'Miss', tone: crit ? 'crit' : hit ? 'hit' : 'miss' });
  k.events.push(`${ch.name} attacks ${target.name} with ${atk.name}: ${roll.total}${crit ? ' (CRIT)' : ''} -> ${hit ? 'hit' : 'miss'}.`);
  if (!hit) { E.pushViews(c); return { ok: true, hit: false, reasons: [...auto.adv.map((x) => `+ ${x}`), ...auto.dis.map((x) => `- ${x}`)] }; }
  const pendingId = randomId('pd_', 4);
  const options = damageOptions(ch, eco, { melee: !ranged, weapon: true });
  k.pending[pendingId] = { id: pendingId, userId, attackerId: cb.id, targets: [target.id], dice: atk.damage, type: atk.damageType, crit, label: atk.name, kind: 'weapon', melee: !ranged, versatile: atk.versatile || null, options };
  k.state = 'damage';
  E.pushViews(c);
  return { ok: true, hit: true, crit, pendingId, damage: atk.damage, damageType: atk.damageType, options };
}

function damageOptions(ch, eco, { melee, weapon }) {
  const opts = [];
  const lv = (cls) => (ch.classes || [{ class: ch.class, level: ch.level }]).find((k) => k.class === cls)?.level || 0;
  if (lv('rogue') && !eco.sneakUsed && weapon) opts.push({ key: 'sneak', label: `Sneak Attack (+${Math.ceil(lv('rogue') / 2)}d6)`, dice: `${Math.ceil(lv('rogue') / 2)}d6` });
  if (lv('paladin') >= 2 && melee && weapon && ch.spellcasting) opts.push({ key: 'smite', label: 'Divine Smite (spend a slot: +2d8, +1d8 per slot level above 1st)', slot: true });
  if ((ch.conditions || []).includes('raging') && melee) { const b = lv('barbarian') >= 16 ? 4 : lv('barbarian') >= 9 ? 3 : 2; opts.push({ key: 'rage', label: `Rage (+${b})`, flat: b, auto: true }); }
  if (ch.concentration === 'hunters-mark' || ch.concentration === 'hex') opts.push({ key: 'mark', label: `${ch.concentration === 'hex' ? 'Hex' : "Hunter's Mark"} (+1d6)`, dice: '1d6', auto: true });
  return opts;
}

function doubleDice(expr) {
  return String(expr).replace(/(\d+)d(\d+)/g, (_, n, s) => `${n * 2}d${s}`);
}

export function damage(c, userId, p) {
  const k = c.combat;
  const pd = k?.pending?.[p.pendingId];
  if (!pd || pd.userId !== userId) return { error: 'That damage roll has expired.' };
  const attacker = k.combatants[pd.attackerId];
  const ch = charOf(attacker);
  const eco = k.economy[attacker.id];
  let expr = p.twoHanded && pd.versatile ? pd.versatile : pd.dice;
  const extras = [];
  for (const o of p.options || []) {
    if (o === 'sneak' && !eco.sneakUsed) { const n = Math.ceil(((ch.classes || []).find((x) => x.class === 'rogue')?.level || ch.level) / 2); expr += `+${n}d6`; eco.sneakUsed = true; extras.push('Sneak Attack'); }
    if (o === 'rage') { const lvl = (ch.classes || []).find((x) => x.class === 'barbarian')?.level || 1; expr += `+${lvl >= 16 ? 4 : lvl >= 9 ? 3 : 2}`; extras.push('Rage'); }
    if (o === 'mark') { expr += '+1d6'; extras.push(ch.concentration === 'hex' ? 'Hex' : "Hunter's Mark"); }
    if (o === 'smite') {
      const lvl = Math.max(1, Math.min(5, p.smiteLevel || lowestSlot(ch) || 1));
      if (!spendSlot(ch, lvl)) return { error: 'No spell slot left for Divine Smite.' };
      const target = k.combatants[pd.targets[0]];
      const undead = /undead|fiend/i.test(target?.stat?.traits || '') || ['skeleton', 'zombie', 'ghoul', 'ghost', 'specter', 'wight', 'vampire', 'imp', 'demon', 'devil'].some((x) => (target?.monster || '').includes(x));
      expr += `+${Math.min(5, 1 + lvl) + (undead ? 1 : 0)}d8`;
      extras.push(`Divine Smite (L${lvl})`);
    }
  }
  if (pd.crit && p.mode !== 'manual') expr = doubleDice(expr);
  const roll = rollDamage(expr, { mode: p.mode, total: p.total });
  delete k.pending[pd.id];
  k.state = 'turn';
  const results = [];
  for (const tid of pd.targets) {
    const target = k.combatants[tid];
    if (!target || !alive(target)) continue;
    const rr = applyDamage(c, target, roll.total, pd.type, { crit: pd.crit });
    results.push(`${target.name} ${rr.dealt}${rr.note ? ` (${rr.note})` : ''}`);
  }
  diceCard(c, { name: ch.name, characterId: ch.id, label: `${pd.label} damage${extras.length ? ` + ${extras.join(', ')}` : ''}${pd.type ? ` (${pd.type})` : ''}`, result: roll, outcome: results.join(', '), tone: 'damage' });
  k.events.push(`${ch.name}'s ${pd.label} deals ${roll.total} ${pd.type || ''} damage to ${results.join(', ')}.`);
  if (!checkVictory(c)) E.pushViews(c);
  return { ok: true, total: roll.total };
}

function lowestSlot(ch) {
  const d = safeDerive(ch);
  const slots = d?.spellcasting?.slots || [];
  for (let i = 0; i < slots.length; i++) if (slots[i] - (ch.spellcasting.slotsUsed[i] || 0) > 0) return i + 1;
  return 0;
}

export function spendSlot(ch, level) {
  if (!ch.spellcasting || level < 1) return level < 1;
  const d = safeDerive(ch);
  const sc = d?.spellcasting;
  const max = sc?.slots?.[level - 1] || 0;
  const used = ch.spellcasting.slotsUsed[level - 1] || 0;
  if (used < max) { ch.spellcasting.slotsUsed[level - 1] = used + 1; saveCharacter(ch); return true; }
  if (sc?.pact && sc.pact.level >= level && (ch.spellcasting.pactUsed || 0) < sc.pact.slots) { ch.spellcasting.pactUsed = (ch.spellcasting.pactUsed || 0) + 1; saveCharacter(ch); return true; }
  return false;
}

// ---------------------------------------------------------------- spells

const SPELL_CONDITIONS = {
  'hold-person': { cond: ['paralyzed'], ends: 'wis' }, 'hold-monster': { cond: ['paralyzed'], ends: 'wis' },
  'charm-person': { cond: ['charmed'] }, 'command': { cond: ['prone'] }, 'entangle': { cond: ['restrained'], ends: 'str' },
  'web': { cond: ['restrained'], ends: 'str' }, 'hideous-laughter': { cond: ['prone', 'incapacitated'], ends: 'wis' },
  'blindness-deafness': { cond: ['blinded'], ends: 'con' }, 'fear': { cond: ['frightened'], ends: 'wis' },
  'hypnotic-pattern': { cond: ['charmed', 'incapacitated'] }, 'faerie-fire': { cond: ['outlined'] }, 'slow': { cond: ['slowed'], ends: 'wis' },
  'confusion': { cond: ['confused'], ends: 'wis' }, 'banishment': { cond: ['banished'] }, 'dominate-person': { cond: ['charmed'], ends: 'wis' },
  'phantasmal-killer': { cond: ['frightened'], ends: 'wis' }, 'flesh-to-stone': { cond: ['restrained'], ends: 'con' },
};

function castingCost(spell) {
  const t = String(spell.castingTime || spell.casting_time || '1 action').toLowerCase();
  if (t.includes('bonus')) return 'bonus';
  if (t.includes('reaction')) return 'reaction';
  if (t.includes('action')) return 'action';
  return 'long';
}

function casterLevelOf(ch) { return ch.level || 1; }

function spellMod(ch) {
  const d = safeDerive(ch);
  return { dc: d?.spellcasting?.dc ?? 10, attack: d?.spellcasting?.attack ?? 0, mod: abilityMod(ch.abilities?.[d?.spellcasting?.ability || ch.spellcasting?.ability || 'int'] || 10) };
}

/** Cast a spell from the sheet. In combat it targets tokens/templates; out of combat it is logged for the DM to narrate. */
export async function castSpell(c, userId, p) {
  const m = member(c, userId);
  const ch = getCharacter(m?.characterId);
  if (!ch || !ch.spellcasting) return { error: 'Your character has no spells.' };
  const spell = srd().by.spells.get(p.spellIndex);
  if (!spell) return { error: 'Unknown spell.' };
  const lvl = spell.level || 0;
  const slotLevel = lvl === 0 ? 0 : Math.max(lvl, Math.min(9, p.slotLevel || lvl));
  const inCombat = !!c.combat;
  let cb = null, k = null, eco = null;
  if (inCombat) {
    const r = requirePlayerTurn(c, userId);
    if (r.error) return r;
    ({ cb, k } = r);
    eco = k.economy[cb.id];
    const cost = castingCost(spell);
    if (cost === 'action') { if (eco.action && eco.attacksLeft <= 0) return { error: 'You have already used your action.' }; eco.action = true; eco.attacksLeft = 0; }
    if (cost === 'bonus') { if (eco.bonus) return { error: 'You have already used your bonus action.' }; eco.bonus = true; }
    if (cost === 'reaction') { if (eco.reaction) return { error: 'You have already used your reaction.' }; eco.reaction = true; }
  }
  if (lvl > 0 && !(p.ritual && spell.ritual && !inCombat) && !spendSlot(ch, slotLevel)) return { error: `No level ${slotLevel} spell slots left.` };
  if (spell.concentration) {
    if (ch.concentration) dropConcentration(c, ch, `switched concentration`);
    ch.concentration = spell.index;
    saveCharacter(ch);
  }
  const label = `${spell.name}${slotLevel > lvl ? ` (level ${slotLevel})` : ''}`;
  const sm = spellMod(ch);

  if (!inCombat) {
    // Out of combat: healing resolves now; everything else becomes part of the player's declared action.
    const heal = spellHealing?.(spell, { slotLevel: slotLevel || 1 });
    if (heal && p.targetCharacterId) {
      const tgt = getCharacter(p.targetCharacterId);
      const addMod = /spellcasting ability modifier/i.test(spell.desc || '');
      const roll = rollDamage(`${heal}${addMod ? `+${sm.mod}` : ''}`, { mode: p.mode, total: p.total });
      const healed = tgt ? E.healCharacter(c, tgt, roll.total) : 0;
      diceCard(c, { name: ch.name, characterId: ch.id, label: `${label} on ${tgt?.name}`, result: roll, outcome: `${tgt?.name} regains ${healed} HP`, tone: 'heal' });
    } else {
      E.addLog(c, { kind: 'cast', name: ch.name, characterId: ch.id, text: `✨ ${ch.name} casts ${label}.`, spell: spell.index });
    }
    if (c.phase === 'actions') {
      const cur = c.round.actions[userId];
      if (!cur) E.toast(c, [userId], `${spell.name} is cast. Describe what you do with it in your action.`, 'info');
    }
    E.pushViews(c);
    return { ok: true };
  }

  // ---- in combat
  const caster = cb;
  const aTok = tokenOf(c, caster);
  revealToWatchers(c, aTok);
  const map = c.maps.tactical[k.mapId] || c.maps.tactical[c.scene.tacticalMapId];
  let targets = (p.targets || []).map((tid) => targetCombatant(c, tid)).filter((x) => x && alive(x));
  if (p.template && spell.area) {
    const cells = templateCells(map, { shape: spell.area.type, size: spell.area.size, origin: { x: aTok.x, y: aTok.y }, target: p.template.target || { x: aTok.x, y: aTok.y } });
    const set = new Set(cells.map(([x, y]) => `${x},${y}`));
    targets = Object.values(k.combatants).filter((x) => {
      const t = tokenOf(c, x);
      if (!t || !alive(x)) return false;
      if (x.id === caster.id && /self/i.test(spell.range || '')) return false;
      for (let dx = 0; dx < (t.size || 1); dx++) for (let dy = 0; dy < (t.size || 1); dy++) if (set.has(`${t.x + dx},${t.y + dy}`)) return true;
      return false;
    });
  }
  const rangeFt = spell.rangeFt ?? 30;
  for (const t of targets) {
    const dist = distanceFeet(aTok, tokenOf(c, t));
    if (!p.template && rangeFt > 0 && dist > rangeFt) return { error: `${t.name} is out of range (${dist} ft; ${spell.name} reaches ${rangeFt} ft).` };
  }
  E.addLog(c, { kind: 'cast', name: ch.name, characterId: ch.id, text: `✨ ${ch.name} casts ${label}${targets.length ? ` at ${targets.map((x) => x.name).join(', ')}` : ''}.`, spell: spell.index, template: p.template ? { ...p.template, shape: spell.area?.type, size: spell.area?.size, origin: { x: aTok.x, y: aTok.y } } : null });
  k.events.push(`${ch.name} casts ${label}${targets.length ? ` targeting ${targets.map((x) => x.name).join(', ')}` : ''}.`);
  const dmg = spellDamage(spell, { slotLevel: slotLevel || 1, casterLevel: casterLevelOf(ch) });
  const heal = spellHealing?.(spell, { slotLevel: slotLevel || 1 });

  if (spell.index === 'magic-missile' && targets.length) {
    const darts = 3 + Math.max(0, slotLevel - 1);
    const per = targets.map((_, i) => Math.floor(darts / targets.length) + (i < darts % targets.length ? 1 : 0));
    targets.forEach((t, i) => {
      const roll = rollDice(`${per[i]}d4+${per[i]}`, {});
      const rr = applyDamage(c, t, roll.total, 'force');
      diceCard(c, { name: ch.name, characterId: ch.id, label: `Magic Missile ×${per[i]} → ${t.name}`, result: roll, outcome: `${rr.dealt} force`, tone: 'damage' });
    });
  } else if (heal && !dmg) {
    const addMod = /spellcasting ability modifier/i.test(spell.desc || '');
    for (const t of (targets.length ? targets : [caster]).filter((x) => !hostile(caster, x))) {
      const roll = rollDamage(`${heal}${addMod ? `+${sm.mod}` : ''}`, { mode: p.mode, total: p.total });
      if (isPc(t)) { const got = E.healCharacter(c, charOf(t), roll.total); diceCard(c, { name: ch.name, characterId: ch.id, label: `${spell.name} → ${t.name}`, result: roll, outcome: `+${got} HP`, tone: 'heal' }); }
      else { t.hp.cur = Math.min(t.hp.max, t.hp.cur + roll.total); diceCard(c, { name: ch.name, characterId: ch.id, label: `${spell.name} → ${t.name}`, result: roll, outcome: `+${roll.total} HP`, tone: 'heal' }); }
    }
  } else if (spell.attackType && targets.length) {
    // spell attack: one attack per target; damage rolled automatically for each hit (or entered for the first)
    const beams = spell.index === 'eldritch-blast' ? (ch.level >= 17 ? 4 : ch.level >= 11 ? 3 : ch.level >= 5 ? 2 : 1) : spell.index === 'scorching-ray' ? 3 + Math.max(0, slotLevel - 2) : 1;
    const list = [];
    for (let i = 0; i < beams; i++) list.push(targets[i % targets.length]);
    for (const t of list) {
      if (!alive(t)) continue;
      const dist = distanceFeet(aTok, tokenOf(c, t));
      const auto = advantageFor(c, caster, t, { ranged: spell.attackType === 'ranged', distFt: dist });
      const adv = combine(auto.mode, p.advantage);
      const roll = d20(sm.attack, { advantage: adv, mode: list.length === 1 ? p.mode : 'auto', natural: p.natural });
      const ac = acOf(c, t);
      const hit = roll.natural !== 1 && (roll.natural === 20 || roll.total >= ac);
      diceCard(c, { name: ch.name, characterId: ch.id, label: `${spell.name} vs ${t.name}`, result: roll, advantage: adv, outcome: roll.natural === 20 ? 'CRITICAL HIT!' : hit ? 'Hit!' : 'Miss', tone: roll.natural === 20 ? 'crit' : hit ? 'hit' : 'miss' });
      if (hit && dmg) {
        const dr = rollDice(roll.natural === 20 ? doubleDice(dmg.dice) : dmg.dice, {});
        const rr = applyDamage(c, t, dr.total, dmg.type, { crit: roll.natural === 20 });
        diceCard(c, { name: ch.name, characterId: ch.id, label: `${spell.name} damage (${dmg.type})`, result: dr, outcome: `${t.name} ${rr.dealt}${rr.note ? ` (${rr.note})` : ''}`, tone: 'damage' });
        k.events.push(`${spell.name} hits ${t.name} for ${rr.dealt} ${dmg.type}.`);
      }
    }
  } else if (spell.dc && targets.length) {
    const ability = (spell.dc.ability || 'dex').slice(0, 3);
    const results = [];
    // PCs caught in the area roll their own saves (friendly fire!)
    const pcReqs = [];
    for (const t of targets.filter(isPc)) {
      const req = E.makeRollRequest(c, { characterId: t.characterId, kind: 'save', key: ability, dc: sm.dc, reason: `You're caught in ${ch.name}'s ${spell.name}! ${ability.toUpperCase()} save.` }, 'save_vs');
      if (req) { k.rollRequests.push(req); pcReqs.push([t, req]); }
    }
    k.state = 'waiting';
    E.pushViews(c);
    if (pcReqs.length) await waitForRolls(c, pcReqs.map((x) => x[1]), 45000);
    if (!c.combat) return { ok: true };
    for (const t of targets) {
      let saved;
      if (isPc(t)) saved = pcReqs.find((x) => x[0] === t)?.[1]?.success;
      else {
        const bonus = monsterSaveBonus ? monsterSaveBonus({ abilities: t.stat.abilities, saves: t.stat.saves, proficiency_bonus: 2 }, ability) : abilityMod(t.stat.abilities[ability] || 10);
        const sr = rollD20(bonus);
        saved = sr.total >= sm.dc;
        diceCard(c, { name: t.name, label: `${ability.toUpperCase()} save vs ${spell.name} (DC ${sm.dc})`, result: sr, outcome: saved ? 'Saved' : 'Failed', tone: saved ? 'miss' : 'hit', to: tokenOf(c, t)?.hidden ? [] : 'all' });
      }
      results.push({ t, saved });
    }
    if (dmg) {
      const roll = rollDamage(dmg.dice, { mode: p.mode, total: p.total });
      const hits = [];
      for (const { t, saved } of results) {
        const success = spell.dc.success || 'half';
        const amount = saved ? (success === 'half' ? Math.floor(roll.total / 2) : 0) : roll.total;
        if (!amount) { hits.push(`${t.name} 0`); continue; }
        const rr = applyDamage(c, t, amount, dmg.type);
        hits.push(`${t.name} ${rr.dealt}${saved ? ' (half)' : ''}${rr.note ? ` (${rr.note})` : ''}`);
      }
      diceCard(c, { name: ch.name, characterId: ch.id, label: `${spell.name} damage (${dmg.type})`, result: roll, outcome: hits.join(', '), tone: 'damage' });
      k.events.push(`${spell.name}: ${hits.join(', ')}.`);
    }
    const sc = SPELL_CONDITIONS[spell.index];
    if (sc) for (const { t, saved } of results) {
      if (saved) continue;
      for (const cond of sc.cond) {
        if (isPc(t)) { const tc = charOf(t); if (!tc.conditions.includes(cond)) tc.conditions.push(cond); saveCharacter(tc); }
        else if (!t.stat.condImmune.includes(cond)) {
          t.conditions = [...new Set([...(t.conditions || []), cond])];
          t.conditionSources = { ...(t.conditionSources || {}), [cond]: `${ch.id}:${spell.index}` };
          if (sc.ends) t.saveEnds = [...(t.saveEnds || []), { cond, ability: sc.ends, dc: sm.dc, source: spell.name }];
        }
      }
      E.system(c, `${t.name} is ${sc.cond.join(' and ')}!`, 'all', { tone: 'warn' });
    }
    k.state = 'turn';
  } else {
    // utility spell: no automated effect
    if (spell.index === 'shield') { ch.conditions.push('shielded'); saveCharacter(ch); }
    k.events.push(`(${spell.name} has no automatic effect - DM, adjudicate it.)`);
  }
  if (!checkVictory(c)) E.pushViews(c);
  return { ok: true };
}

// ---------------------------------------------------------------- other actions

export function takeAction(c, userId, p) {
  const r = requirePlayerTurn(c, userId);
  if (r.error) return r;
  const { cb, ch, k } = r;
  const eco = k.economy[cb.id];
  const type = p.type;
  const bonusOk = p.bonus === true;
  const useAction = () => { if (bonusOk) { if (eco.bonus) return false; eco.bonus = true; return true; } if (eco.action) return false; eco.action = true; eco.attacksLeft = 0; return true; };
  switch (type) {
    case 'dash': if (!useAction()) return { error: 'No action left.' }; eco.dash = true; E.addLog(c, { kind: 'combat', text: `💨 ${ch.name} dashes.` }); break;
    case 'dodge': if (!useAction()) return { error: 'No action left.' }; ch.conditions.push('dodging'); saveCharacter(ch); E.addLog(c, { kind: 'combat', text: `🛡️ ${ch.name} takes the Dodge action.` }); break;
    case 'disengage': if (!useAction()) return { error: 'No action left.' }; E.addLog(c, { kind: 'combat', text: `↩️ ${ch.name} disengages.` }); break;
    case 'help': if (!useAction()) return { error: 'No action left.' }; E.addLog(c, { kind: 'combat', text: `🤝 ${ch.name} helps an ally (their next attack has advantage).` }); break;
    case 'hide': {
      if (!useAction()) return { error: 'No action left.' };
      const tok = tokenOf(c, cb);
      const roll = E.performRoll(ch, { kind: 'skill', key: 'stealth', mode: p.mode, natural: p.natural });
      diceCard(c, { name: ch.name, characterId: ch.id, label: 'Stealth (Hide)', result: roll, tone: 'muted' });
      const watchers = Object.values(k.combatants).filter((x) => x.kind === 'enemy' && conscious(x));
      const spotted = watchers.some((x) => (x.stat.passivePerception || 10) >= roll.total);
      if (!spotted && tok) { tok.hidden = true; tok.stealth = roll.total; E.system(c, `${ch.name} slips out of sight.`); }
      else E.system(c, `${ch.name} tries to hide, but is still being watched.`);
      break;
    }
    case 'second_wind': {
      if (eco.bonus) return { error: 'Bonus action already used.' };
      const res = ch.resources.secondWind || (ch.resources.secondWind = { used: 0 });
      if (res.used >= 1) return { error: 'Second Wind is spent until you rest.' };
      eco.bonus = true; res.used += 1;
      const lvl = (ch.classes || []).find((x) => x.class === 'fighter')?.level || ch.level;
      const roll = rollDice(`1d10+${lvl}`, {});
      const got = E.healCharacter(c, ch, roll.total);
      diceCard(c, { name: ch.name, characterId: ch.id, label: 'Second Wind', result: roll, outcome: `+${got} HP`, tone: 'heal' });
      break;
    }
    case 'action_surge': {
      const res = ch.resources.actionSurge || (ch.resources.actionSurge = { used: 0 });
      if (res.used >= 1) return { error: 'Action Surge is spent until you rest.' };
      res.used += 1; eco.action = false; eco.attacksLeft = 0; saveCharacter(ch);
      E.addLog(c, { kind: 'combat', text: `⚡ ${ch.name} surges with a burst of action!` });
      break;
    }
    case 'rage': {
      if (eco.bonus) return { error: 'Bonus action already used.' };
      const res = ch.resources.rage || (ch.resources.rage = { used: 0 });
      const max = safeDerive(ch)?.resources?.find((x) => x.key === 'rage')?.max ?? 2;
      if (res.used >= max) return { error: 'No rages left until you rest.' };
      eco.bonus = true; res.used += 1;
      if (!ch.conditions.includes('raging')) ch.conditions.push('raging');
      saveCharacter(ch);
      E.addLog(c, { kind: 'combat', text: `🔥 ${ch.name} flies into a RAGE!`, tone: 'crit' });
      break;
    }
    case 'potion': {
      const pot = ch.equipment.find((i) => /potion of healing/i.test(i.name) && i.qty > 0);
      if (!pot) return { error: 'You have no Potion of Healing.' };
      if (!useAction()) return { error: 'No action left.' };
      pot.qty -= 1;
      if (pot.qty <= 0) ch.equipment = ch.equipment.filter((i) => i !== pot);
      const roll = rollDice('2d4+2', {});
      const got = E.healCharacter(c, ch, roll.total);
      diceCard(c, { name: ch.name, characterId: ch.id, label: 'Potion of Healing', result: roll, outcome: `+${got} HP`, tone: 'heal' });
      break;
    }
    default: return { error: 'Unknown action.' };
  }
  k.events.push(`${ch.name}: ${type.replace('_', ' ')}.`);
  saveCharacter(ch);
  E.pushViews(c);
  return { ok: true };
}

/** A creative action in combat ("I kick the brazier into the oil"): the DM adjudicates it right away. */
export function combatAsk(c, userId, text) {
  const r = requirePlayerTurn(c, userId);
  if (r.error) return r;
  const { cb, ch, k } = r;
  const t = String(text || '').trim().slice(0, 1000);
  if (!t) return { error: 'Describe what you try.' };
  E.addLog(c, { kind: 'action', userId, characterId: ch.id, name: ch.name, text: t, to: 'all' });
  k.events.push(`${ch.name} tries: ${t}`);
  k.state = 'asking';
  const askId = randomId('ask_', 3);
  k.askId = askId;
  E.runTurn(c, {
    kind: 'combat_ask',
    text: `COMBAT IS ONGOING (round ${k.round}). It is ${ch.name}'s turn (${ch.id}) and they try something creative:\n"${t}"\n\nCombatants: ${Object.values(k.combatants).map((x) => `${x.id} ${x.name} (${x.kind}${isPc(x) ? '' : `, HP ${x.hp.cur}/${x.hp.max}, AC ${x.stat.ac}`}) at ${tokenOf(c, x)?.x},${tokenOf(c, x)?.y}${alive(x) ? '' : ' DOWN'}`).join('; ')}\n\nAdjudicate this one action (it uses their action unless trivially free). If the outcome is uncertain, request ONE roll (or a contest) and stop. Otherwise narrate the result in 1-3 sentences and apply it with effects (damage/condition_add on combatant ids). Do not start combat, do not set sceneMap.`,
  });
  return { ok: true };
}

/** Called by engine.applyTurnResult when a combat-time DM turn comes back. */
export function afterAsk(c, data) {
  const k = c.combat;
  if (!k) return;
  const reqs = (data.rollRequests || []).map((r) => E.makeRollRequest(c, r, 'combat_ask', { askId: k.askId })).filter(Boolean);
  if (reqs.length) { k.rollRequests.push(...reqs); k.state = 'waiting'; }
  else {
    k.state = current(c)?.kind === 'pc' ? 'turn' : k.state;
    const eco = k.economy[current(c)?.id];
    if (eco && !eco.action) { eco.action = true; eco.attacksLeft = 0; }
  }
  if (data.combatStart?.length || (data.effects || []).some((e) => e.type === 'damage')) checkVictory(c);
}

export function endCombatManual(c, outcome = 'victory') {
  if (!c.combat) return { error: 'No fight.' };
  endCombat(c, outcome, 'ended by the DM');
  return { ok: true };
}

// ---------------------------------------------------------------- enemy turns

function combatPrompt(c, stretch) {
  const k = c.combat;
  const map = c.maps.tactical[k.mapId] || c.maps.tactical[c.scene.tacticalMapId];
  const lines = Object.values(k.combatants).map((x) => {
    const t = tokenOf(c, x);
    const pos = t ? `(${t.x},${t.y})` : '(off map)';
    if (isPc(x)) {
      const ch = charOf(x);
      return `- ${x.id} ${x.name} [PC] at ${pos} HP ${ch.hp.current}/${ch.hp.max} AC ${acOf(c, x)} conditions: ${(ch.conditions || []).join(', ') || 'none'}${t?.hidden ? ' (hidden)' : ''}${ch.hp.current <= 0 ? ' DOWN' : ''}`;
    }
    const acts = x.stat.actions.map((a) => `${a.name}${a.attackBonus != null ? ` +${a.attackBonus}` : ''}${a.damage?.length ? ` ${a.damage.map((d) => `${d.dice} ${d.type}`).join(' + ')}` : ''}${a.rangeFt ? ` range ${a.rangeFt.normal}/${a.rangeFt.long}` : a.kind === 'melee' ? ` reach ${a.reachFt}` : ''}${a.dc ? ` DC${a.dc.value} ${a.dc.ability}` : ''}${a.area ? ` ${a.area.size}ft ${a.area.shape}` : ''}`).join('; ');
    return `- ${x.id} ${x.name} [${x.kind}] at ${pos} HP ${x.hp.cur}/${x.hp.max} AC ${x.stat.ac} speed ${x.stat.speed} ${alive(x) ? '' : '(DEAD/GONE)'} conditions: ${(x.conditions || []).join(', ') || 'none'}${t?.hidden ? ' HIDDEN' : ''} | actions: ${acts}${x.stat.traits ? ` | traits: ${x.stat.traits.slice(0, 300)}` : ''}`;
  });
  return [
    `# THE FIGHT (round ${k.round}) - ${k.reason || ''}`,
    `# BATTLE MAP\n${describeMapForAI(map, Object.values(c.tokens))}`,
    `# COMBATANTS\n${lines.join('\n')}`,
    `# WHAT HAPPENED SINCE THE ENEMIES LAST ACTED\n${k.events.slice(-25).join('\n') || '(the fight just started)'}`,
    `# NPC ROSTER (for voices)\n${npcBlock(c)}`,
    `# ACTING NOW (in this order)\n${stretch.map((x) => `- ${x.id} ${x.name}`).join('\n')}`,
  ].join('\n\n');
}

export function retryEnemyPhase(c) {
  const k = c.combat;
  if (!k?.stretch) return;
  const stretch = k.stretch.ids.map((id) => k.combatants[id]).filter(alive);
  k.state = 'enemy';
  runEnemyPhase(c, stretch);
}

async function runEnemyPhase(c, stretch) {
  const k = c.combat;
  let plan = null;
  if (c.settings.enemyTactics !== 'quick') {
    E.setThinking(c, 'combat', 'The enemies are deciding what to do…');
    try {
      const res = await askClaude({ task: 'combat', system: COMBAT_CORE, cachedContext: cachedCampaignContext(c), prompt: combatPrompt(c, stretch), schema: COMBAT_SCHEMA, model: c.settings.model, effort: 'low', campaignId: c.id });
      c.usage.calls += 1;
      c.usage.costUsd = Math.round((c.usage.costUsd + (res.costUsd || 0)) * 1e6) / 1e6;
      plan = res.data;
    } catch (e) {
      if (!(e instanceof NoAIError)) console.error('[combat ai]', e.message);
      plan = null;
    }
    c.thinking = null;
  }
  if (!c.combat || c.combat !== k) return;
  if (plan?.narration?.length) {
    for (const seg of plan.narration) {
      const parts = (seg.parts || []).filter((p) => p.text);
      if (parts.length) E.addLog(c, { kind: 'narration', parts: parts.map((p) => ({ speaker: c.npcs[p.speaker] ? p.speaker : 'narrator', speakerName: c.npcs[p.speaker]?.name, text: p.text })), to: E.audience(c, seg.to) });
    }
  }
  k.events = [];
  E.pushViews(c);
  for (const cb of stretch) {
    if (!c.combat || c.combat !== k) return;
    if (!alive(cb)) continue;
    const intent = plan?.enemyActions?.find((a) => a.combatantId === cb.id) || quickIntent(c, cb);
    try { await executeIntent(c, cb, intent); } catch (e) { console.error('[enemy action]', e); }
    updateReveals(c); // a creature that moved into someone's sight may now be noticed
    endOfTurnSaves(c, cb);
    if (!c.combat) return;
    if (checkVictory(c)) return;
    E.pushViews(c);
    await sleep(700);
  }
  if (!c.combat || c.combat !== k) return;
  applyEffectsSafe(c, plan?.effects);
  if (plan?.endCombat?.length) { endCombat(c, plan.endCombat[0].outcome, plan.endCombat[0].reason); return; }
  if (checkVictory(c)) return;
  k.turnIndex = k.stretch.to;
  beginTurn(c);
  E.pushViews(c);
}

function applyEffectsSafe(c, effects) {
  try { E.applyEffects(c, effects || []); } catch (e) { console.error(e); }
}

function endOfTurnSaves(c, cb) {
  if (isPc(cb) || !cb.saveEnds?.length) return;
  const keep = [];
  for (const s of cb.saveEnds) {
    const bonus = monsterSaveBonus ? monsterSaveBonus({ abilities: cb.stat.abilities, saves: cb.stat.saves, proficiency_bonus: 2 }, s.ability) : abilityMod(cb.stat.abilities[s.ability] || 10);
    const r = rollD20(bonus);
    if (r.total >= s.dc) {
      cb.conditions = (cb.conditions || []).filter((x) => x !== s.cond);
      diceCard(c, { name: cb.name, label: `${s.ability.toUpperCase()} save to end ${s.cond} (${s.source})`, result: r, outcome: 'Breaks free!', tone: 'miss' });
    } else keep.push(s);
  }
  cb.saveEnds = keep;
}

function nearestTarget(c, cb) {
  const me = tokenOf(c, cb);
  const foes = Object.values(c.combat.combatants).filter((x) => hostile(cb, x) && conscious(x) && tokenOf(c, x));
  foes.sort((a, b) => distanceFeet(me, tokenOf(c, a)) - distanceFeet(me, tokenOf(c, b)));
  return foes[0] || null;
}

function quickIntent(c, cb) {
  const target = nearestTarget(c, cb);
  if (!target) return { action: 'none' };
  const hasMulti = cb.stat.actions.find((a) => a.kind === 'multiattack' || /multiattack/i.test(a.name));
  const melee = cb.stat.actions.find((a) => a.kind === 'melee' && a.attackBonus != null);
  const ranged = cb.stat.actions.find((a) => a.kind === 'ranged' && a.attackBonus != null);
  const dist = distanceFeet(tokenOf(c, cb), tokenOf(c, target));
  if (ranged && (!melee || dist > 5)) return { action: 'attack', actionName: ranged.name, targetId: target.id, moveToX: -1, moveToY: -1 };
  return { action: 'attack', actionName: hasMulti ? hasMulti.name : melee?.name || cb.stat.actions[0]?.name, targetId: target.id, moveToX: -1, moveToY: -1 };
}

function stepToward(c, cb, dest, { adjacentTo = null, budget }) {
  const map = c.maps.tactical[c.combat.mapId] || c.maps.tactical[c.scene.tacticalMapId];
  const tok = tokenOf(c, cb);
  if (!tok || budget <= 0) return 0;
  const blocked = hostileCells(c, tok);
  const occupied = (x, y) => occupiedBy(c, x, y, tok.id);
  let goals = [];
  if (adjacentTo) {
    const t = adjacentTo;
    for (let dx = -1; dx <= (t.size || 1); dx++) for (let dy = -1; dy <= (t.size || 1); dy++) {
      const x = t.x + dx, y = t.y + dy;
      if (x >= t.x && x < t.x + (t.size || 1) && y >= t.y && y < t.y + (t.size || 1)) continue;
      if (x >= 0 && y >= 0 && x < map.w && y < map.h && !occupied(x, y) && !blocked.has(`${x},${y}`)) goals.push({ x, y });
    }
  } else if (dest) goals = [dest];
  let best = null;
  for (const g of goals) {
    // creatures may pass through allies' spaces (5e) but not hostile ones; the end cell must be free
    const res = findPath(map, { x: tok.x, y: tok.y }, g, { size: tok.size || 1, isBlocked: (x, y) => blocked.has(`${x},${y}`) });
    if (res && (!best || res.feet < best.feet)) best = res;
  }
  if (!best) return 0;
  // walk the path as far as the budget allows, ending on a free cell
  let spent = 0, last = best.path[0];
  for (let i = 1; i < best.path.length; i++) {
    const step = best.path[i];
    const prev = best.path[i - 1];
    const cost = best.feet && best.path.length > 1 ? stepCost(map, step) : 5;
    if (spent + cost > budget) break;
    spent += cost;
    if (!occupied(step.x, step.y)) last = step;
    void prev;
  }
  if (last && (last.x !== tok.x || last.y !== tok.y)) {
    openDoorsOnPath(map, best.path);
    tok.x = last.x; tok.y = last.y;
  }
  return spent;
}

function stepCost(map, p) {
  const ch = map.tiles[p.y * map.w + p.x];
  return ch === '~' || ch === '%' ? 10 : 5;
}

async function executeIntent(c, cb, intent) {
  const k = c.combat;
  const tok = tokenOf(c, cb);
  if (!tok) return;
  const speed = speedOf(cb);
  let budget = speed * (intent.action === 'dash' || intent.action === 'flee' ? 2 : 1);
  if (intent.say) {
    const npc = cb.npcId ? c.npcs[cb.npcId] : null;
    E.addLog(c, { kind: 'narration', parts: [{ speaker: npc?.id || `creature:${cb.monster || 'custom'}`, speakerName: cb.name, text: intent.say }], to: tok.hidden ? [] : 'all', creature: true });
  }
  const target = intent.targetId ? (k.combatants[intent.targetId] || Object.values(k.combatants).find((x) => x.tokenId === intent.targetId || x.name === intent.targetId)) : null;
  if (Number.isInteger(intent.moveToX) && intent.moveToX >= 0 && intent.moveToY >= 0) {
    budget -= stepToward(c, cb, { x: intent.moveToX, y: intent.moveToY }, { budget });
    E.pushViews(c);
    await sleep(350);
  }
  const action = intent.action;
  if (action === 'flee') {
    const map = c.maps.tactical[k.mapId];
    const edge = [{ x: 0, y: tok.y }, { x: map.w - 1, y: tok.y }, { x: tok.x, y: 0 }, { x: tok.x, y: map.h - 1 }].sort((a, b) => Math.hypot(a.x - tok.x, a.y - tok.y) - Math.hypot(b.x - tok.x, b.y - tok.y))[0];
    stepToward(c, cb, edge, { budget });
    if (tok.x === 0 || tok.y === 0 || tok.x === map.w - 1 || tok.y === map.h - 1) { cb.fled = true; tok.dead = true; tok.name = `${cb.name} (fled)`; }
    E.addLog(c, { kind: 'combat', text: `${cb.name} ${cb.fled ? 'flees the fight!' : 'tries to flee.'}`, to: tok.hidden ? [] : 'all' });
    return;
  }
  if (action === 'surrender') { cb.surrendered = true; E.addLog(c, { kind: 'combat', text: `🏳️ ${cb.name} throws down its weapons and surrenders!`, tone: 'good' }); return; }
  if (action === 'dodge') { cb.dodging = true; E.addLog(c, { kind: 'combat', text: `${cb.name} takes a defensive stance.`, to: tok.hidden ? [] : 'all' }); return; }
  if (action === 'hide') { tok.hidden = true; tok.revealedTo = []; tok.stealth = rollD20(monsterStealth(cb.stat)).total; updateReveals(c); E.addLog(c, { kind: 'combat', text: `${cb.name} melts into the shadows.` }); return; }
  if (['dash', 'disengage', 'help', 'none', 'other'].includes(action)) {
    if (action === 'dash' && target) stepToward(c, cb, null, { adjacentTo: tokenOf(c, target), budget });
    if (intent.onHit && action === 'other') E.addLog(c, { kind: 'narration', parts: [{ speaker: 'narrator', text: intent.onHit }], to: tok.hidden ? [] : 'all' });
    return;
  }
  if (!target || !conscious(target)) {
    const alt = nearestTarget(c, cb);
    if (!alt) return;
    return executeIntent(c, cb, { ...quickIntent(c, cb), say: '' });
  }
  // pick the stat-block action
  let act = cb.stat.actions.find((a) => a.name.toLowerCase() === String(intent.actionName || '').toLowerCase()) || cb.stat.actions.find((a) => a.attackBonus != null);
  if (!act) return;
  const attacks = [];
  if (act.kind === 'multiattack' || /multiattack/i.test(act.name)) {
    const parts = act.multiattack?.length ? act.multiattack : (() => {
      const out = [];
      for (const a of cb.stat.actions.filter((x) => x.attackBonus != null)) {
        const m = new RegExp(`(one|two|three|four)\\s+(?:with its\\s+)?${a.name.split(' ')[0]}`, 'i').exec(act.desc || '');
        if (m) out.push({ name: a.name, count: { one: 1, two: 2, three: 3, four: 4 }[m[1].toLowerCase()] });
      }
      return out.length ? out : [{ name: cb.stat.actions.find((x) => x.attackBonus != null)?.name, count: 2 }];
    })();
    for (const p of parts) for (let i = 0; i < (p.count || 1); i++) { const a = cb.stat.actions.find((x) => x.name === p.name); if (a) attacks.push(a); }
  } else attacks.push(act);

  if (act.dc && act.attackBonus == null && action === 'save_ability') return saveAbility(c, cb, act, target, intent);

  for (const a of attacks) {
    const tTok = tokenOf(c, target);
    if (!conscious(target) || !tTok) break;
    const ranged = a.kind === 'ranged' || (a.rangeFt && !a.reachFt);
    let dist = distanceFeet(tokenOf(c, cb), tTok);
    if (!ranged && dist > (a.reachFt || 5)) {
      budget -= stepToward(c, cb, null, { adjacentTo: tTok, budget });
      E.pushViews(c);
      await sleep(300);
      dist = distanceFeet(tokenOf(c, cb), tTok);
      if (dist > (a.reachFt || 5)) { E.addLog(c, { kind: 'combat', text: `${cb.name} closes in on ${target.name}.`, to: tok.hidden ? [] : 'all' }); return; }
    }
    if (ranged && a.rangeFt && dist > a.rangeFt.long) { stepToward(c, cb, null, { adjacentTo: tTok, budget }); return; }
    const auto = advantageFor(c, cb, target, { ranged, distFt: dist });
    const wasHidden = tok.hidden;
    const roll = rollD20(a.attackBonus || 0, { advantage: auto.mode });
    const ac = acOf(c, target);
    const crit = roll.natural === 20;
    const hit = roll.natural !== 1 && (crit || roll.total >= ac);
    revealToWatchers(c, tok);
    tok.hidden = false;
    const tName = target.name;
    const outcomeText = hit ? (intent.onHit || `${cb.name} hits ${tName}.`) : (intent.onMiss || `${cb.name} misses ${tName}.`);
    E.addLog(c, { kind: 'narration', parts: [{ speaker: 'narrator', text: outcomeText }], to: 'all', enemy: true });
    diceCard(c, { name: wasHidden ? `${cb.name} (from hiding)` : cb.name, label: `${a.name} vs ${tName}`, result: roll, advantage: auto.mode, outcome: crit ? 'CRITICAL HIT!' : hit ? 'Hit!' : 'Miss', tone: crit ? 'crit' : hit ? 'hit' : 'miss' });
    if (hit && a.damage?.length) {
      let total = 0;
      const texts = [];
      for (const d of a.damage) {
        const r = rollDice(crit ? doubleDice(d.dice) : d.dice, {});
        const rr = applyDamage(c, target, r.total, d.type, { crit });
        total += rr.dealt;
        texts.push(`${r.text} ${d.type}`);
      }
      E.addLog(c, { kind: 'dice', name: cb.name, label: `${a.name} damage`, result: { total, text: texts.join(' + ') }, outcome: `${tName} takes ${total}`, tone: 'damage' });
      k.events.push(`${cb.name} hits ${tName} with ${a.name} for ${total}.`);
    } else k.events.push(`${cb.name} ${hit ? 'hits' : 'misses'} ${tName} with ${a.name}.`);
    E.pushViews(c);
    await sleep(450);
  }
}

async function saveAbility(c, cb, act, target, intent) {
  const k = c.combat;
  const map = c.maps.tactical[k.mapId];
  const tok = tokenOf(c, cb);
  let victims = [target];
  if (act.area) {
    const cells = new Set(templateCells(map, { shape: act.area.shape, size: act.area.size, origin: { x: tok.x, y: tok.y }, target: { x: tokenOf(c, target).x, y: tokenOf(c, target).y } }).map(([x, y]) => `${x},${y}`));
    victims = Object.values(k.combatants).filter((x) => x.id !== cb.id && alive(x) && tokenOf(c, x) && cells.has(`${tokenOf(c, x).x},${tokenOf(c, x).y}`));
  }
  tok.hidden = false;
  E.addLog(c, { kind: 'narration', parts: [{ speaker: 'narrator', text: intent.onHit || `${cb.name} unleashes ${act.name}!` }], to: 'all', enemy: true });
  const reqs = [];
  const results = [];
  for (const v of victims) {
    if (isPc(v)) {
      const req = E.makeRollRequest(c, { characterId: v.characterId, kind: 'save', key: act.dc.ability, dc: act.dc.value, reason: `${cb.name} uses ${act.name}! ${act.dc.ability.toUpperCase()} saving throw.` }, 'save_vs');
      if (req) { k.rollRequests.push(req); reqs.push([v, req]); }
    } else {
      const bonus = monsterSaveBonus ? monsterSaveBonus({ abilities: v.stat.abilities, saves: v.stat.saves, proficiency_bonus: 2 }, act.dc.ability) : 0;
      results.push({ v, saved: rollD20(bonus).total >= act.dc.value });
    }
  }
  E.pushViews(c);
  if (reqs.length) await waitForRolls(c, reqs.map((x) => x[1]), 45000);
  if (!c.combat) return;
  for (const [v, req] of reqs) results.push({ v, saved: !!req.success });
  if (act.damage?.length) {
    const r = rollDice(act.damage.map((d) => d.dice).join('+'), {});
    const type = act.damage[0].type;
    const hits = [];
    for (const { v, saved } of results) {
      const amount = saved ? (act.dc.success === 'none' ? 0 : Math.floor(r.total / 2)) : r.total;
      const rr = amount ? applyDamage(c, v, amount, type) : { dealt: 0 };
      hits.push(`${v.name} ${rr.dealt}${saved ? ' (saved)' : ''}`);
    }
    E.addLog(c, { kind: 'dice', name: cb.name, label: `${act.name} damage (${type})`, result: { total: r.total, text: r.text }, outcome: hits.join(', '), tone: 'damage' });
    k.events.push(`${cb.name}'s ${act.name}: ${hits.join(', ')}.`);
  }
}
