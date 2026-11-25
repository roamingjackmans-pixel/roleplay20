// shared/charbuild.js — character creation (levels 1-5) and level-up helpers for 5e SRD characters.
// Pure ESM, no I/O. `srd` = { classes, races, backgrounds, spells, equipment, features, languages, ... }.
//
// Contract (docs/CONTRACTS.md): STANDARD_ARRAY, POINT_BUY_COSTS, pointBuyCost, racialBonuses, buildCharacter,
// startingEquipmentOptions, spellOptions, levelUpPlan, applyLevelUp.
// Extras: POINT_BUY_BUDGET, ALIGNMENTS, CLASS_COLORS, resolveStartingEquipment, expandItems, newItemId,
// defaultSpellPicks, applyAsi.
//
// `choices` for buildCharacter (everything optional except race + class; sensible defaults are filled in):
// {
//   id, ownerId, campaignId, name, playerName, race, subrace, class, subclass, background, alignment, level (1-5), xp,
//   baseAbilities: { str, dex, ... }        // before racial bonuses (default: standard array by class priority)
//   abilityMethod: "standard" | "pointbuy" | "roll" | "manual",
//   bonusChoices: ["dex", "con"] | { dex: 1, con: 1 }   // half-elf +1/+1
//   asi: [{ str: 2 } | ["str", "dex"] | "str"]           // one entry per ASI level reached (level 4)
//   skills: ["athletics", ...]              // class picks + racial picks (half-elf) + lore bonus skills
//   expertise: ["stealth", "thieves-tools"] // rogue 1 / bard 3
//   tools: ["Lute", "Smith's Tools"], languages: ["Elvish"],
//   equipment: [optionIndex | { option, picks: [["longsword"], ...] }, ...]   // one entry per class option set
//              | [ "longsword" | { index, name, qty }, ... ]               // or an explicit complete item list
//   backgroundEquipment: ["amulet"],         // picks for the background's equipmentChoices
//   cantrips: ["fire-bolt"], spells: ["magic-missile"], prepared: [...] (wizard), raceCantrip: "light",
//   fightingStyle: "defense", draconicAncestry: "red", dragonAncestor: "red", landType: "forest",
//   favoredEnemy: "beasts", favoredTerrain: "forest", featureOptions: { [featureIndex]: optionIndex | [..] },
//   hpMethod: "average" | "max" | "roll", hpRolls: [n, ...] (levels 2+),
//   personality: { traits, ideals, bonds, flaws }, appearance, backstory, portrait, color
// }

import {
  ABILITIES, SKILLS, SKILL_NAMES, abilityMod, profBonus, byIndex, classResources, spellSlots, normName, CLASS_CASTING,
  asiLevelsFor, characterClasses, totalLevel, lookupEquipment,
} from "./rules.js";

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
export const POINT_BUY_COSTS = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };
export const POINT_BUY_BUDGET = 27;
export const ALIGNMENTS = [
  "Lawful Good", "Neutral Good", "Chaotic Good", "Lawful Neutral", "Neutral", "Chaotic Neutral",
  "Lawful Evil", "Neutral Evil", "Chaotic Evil",
];
export const CLASS_COLORS = {
  barbarian: "#e06c75", bard: "#c678dd", cleric: "#e5c07b", druid: "#98c379", fighter: "#d19a66", monk: "#56b6c2",
  paladin: "#f0d77b", ranger: "#7fb069", rogue: "#9aa5b1", sorcerer: "#ff7eb6", warlock: "#a37acc", wizard: "#7aa2f7",
};
// Ability priority per class, used for default standard-array placement and default ASIs.
const ABILITY_PRIORITY = {
  barbarian: ["str", "con", "dex", "wis", "cha", "int"], bard: ["cha", "dex", "con", "wis", "int", "str"],
  cleric: ["wis", "con", "str", "dex", "cha", "int"], druid: ["wis", "con", "dex", "int", "cha", "str"],
  fighter: ["str", "con", "dex", "wis", "cha", "int"], monk: ["dex", "wis", "con", "str", "int", "cha"],
  paladin: ["str", "cha", "con", "wis", "dex", "int"], ranger: ["dex", "wis", "con", "str", "int", "cha"],
  rogue: ["dex", "con", "int", "wis", "cha", "str"], sorcerer: ["cha", "con", "dex", "wis", "int", "str"],
  warlock: ["cha", "con", "dex", "wis", "int", "str"], wizard: ["int", "con", "dex", "wis", "cha", "str"],
};

const get = (srd, coll, idx) => (idx == null ? undefined : byIndex(srd?.[coll]).get(idx));
const clone = (o) => (typeof structuredClone === "function" ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const uniq = (a) => [...new Set(a)];
const asArray = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);

/** Stable-ish short random id: "it_" + 8 base36 chars. */
export function newItemId(prefix = "it_") {
  let s = "";
  const c = globalThis.crypto;
  if (c?.getRandomValues) {
    const b = new Uint8Array(8);
    c.getRandomValues(b);
    for (const x of b) s += (x % 36).toString(36);
  } else {
    for (let i = 0; i < 8; i++) s += Math.floor(Math.random() * 36).toString(36);
  }
  return prefix + s;
}

/** Total point-buy cost; Infinity if any score is outside 8..15. */
export function pointBuyCost(scores) {
  let total = 0;
  for (const a of ABILITIES) {
    const v = Number(scores?.[a] ?? 8);
    if (!(v in POINT_BUY_COSTS)) return Infinity;
    total += POINT_BUY_COSTS[v];
  }
  return total;
}

/**
 * Racial ability bonuses. race/subrace: SRD objects or indices (indices need `srd`).
 * choices: ["dex","con"] | { dex: 1, con: 1 } | { bonusChoices: [...] } for races with bonusChoices (half-elf).
 */
export function racialBonuses(race, subrace, choices, srd) {
  const r = typeof race === "string" ? get(srd, "races", race) : race;
  let s = typeof subrace === "string" ? r?.subraces?.find((x) => x.index === subrace) : subrace;
  const out = {};
  const add = (o) => {
    for (const [k, v] of Object.entries(o || {})) out[k] = (out[k] || 0) + v;
  };
  add(r?.abilityBonuses);
  add(s?.abilityBonuses);
  const bc = r?.bonusChoices;
  if (bc) {
    let picks = choices?.bonusChoices ?? choices;
    if (picks && !Array.isArray(picks) && typeof picks === "object") {
      picks = Object.entries(picks).flatMap(([k, v]) => Array(Math.max(0, Math.round(Number(v) / bc.amount) || 0)).fill(k));
    }
    const valid = uniq(asArray(picks).filter((k) => bc.from.includes(k))).slice(0, bc.choose);
    for (const k of valid) out[k] = (out[k] || 0) + bc.amount;
  }
  return out;
}

/** Normalise an ASI choice into { ability: +n }. Accepts { str: 2 } | ["str","dex"] | "str". */
function asiToBonus(choice) {
  if (!choice) return null;
  if (typeof choice === "string") return { [choice]: 2 };
  if (Array.isArray(choice)) {
    const o = {};
    for (const k of choice.slice(0, 2)) if (ABILITIES.includes(k)) o[k] = (o[k] || 0) + (choice.length === 1 ? 2 : 1);
    return o;
  }
  if (typeof choice === "object") {
    const o = {};
    let budget = 2;
    for (const [k, v] of Object.entries(choice)) {
      if (!ABILITIES.includes(k)) continue;
      const n = Math.min(budget, Math.max(0, Math.round(Number(v) || 0)));
      if (n) o[k] = n;
      budget -= n;
    }
    return o;
  }
  return null;
}
function defaultAsi(abilities, classKey) {
  const order = ABILITY_PRIORITY[classKey] || ABILITIES;
  const first = order.find((a) => (abilities[a] ?? 10) <= 18);
  if (first) return { [first]: 2 };
  const two = order.filter((a) => (abilities[a] ?? 10) < 20).slice(0, 2);
  return Object.fromEntries(two.map((a) => [a, 1]));
}
/** Apply an ASI to abilities (in place), capping at 20. Returns the applied bonus. */
export function applyAsi(abilities, choice, classKey) {
  const bonus = asiToBonus(choice) || defaultAsi(abilities, classKey);
  const applied = {};
  for (const [k, v] of Object.entries(bonus)) {
    const before = abilities[k] ?? 10;
    abilities[k] = Math.min(20, before + v);
    if (abilities[k] !== before) applied[k] = abilities[k] - before;
  }
  return applied;
}

// ─── equipment ─────────────────────────────────────────────────────────────────────────────
/** Starting equipment option sets for a class (categories already expanded by the SRD build). */
export function startingEquipmentOptions(classKey, srd) {
  const cls = get(srd, "classes", classKey);
  if (!cls) return [];
  return clone(cls.equipmentOptions || []);
}

const PICK_PREF = ["longsword", "shortsword", "rapier", "mace", "warhammer", "battleaxe", "spear", "quarterstaff",
  "dagger", "handaxe", "javelin", "scimitar", "crossbow-light", "shortbow", "lute", "amulet", "crystal",
  "sprig-of-mistletoe", "emblem"];
function defaultPick(from, n, srd, abilities, have = []) {
  const pref = (x) => {
    const i = PICK_PREF.indexOf(x.index);
    return i < 0 ? 999 : i;
  };
  // weapons: best expected damage for this character (keeps one melee weapon handy, avoids duplicates)
  const score = (x) => {
    const w = get(srd, "equipment", x.index);
    if (!w || w.type !== "weapon" || !abilities) return 0;
    const m = (k) => abilityMod(abilities[k] ?? 10);
    const ranged = w.range === "ranged";
    const mod = ranged ? m("dex") : w.properties?.includes("finesse") ? Math.max(m("str"), m("dex")) : m("str");
    const sides = Number(String(w.damage || "").match(/d(d+)/)?.[1] || 0);
    const count = Number(String(w.damage || "").match(/^(d+)d/)?.[1] || 0);
    return count * (sides + 1) / 2 + mod + (ranged ? 0 : 1) - (have.some((h) => h.index === x.index) ? 4 : 0);
  };
  const sorted = from.slice().sort((a, b) => score(b) - score(a) || pref(a) - pref(b));
  return Array(n).fill(sorted[0]).filter(Boolean);
}

/**
 * Resolve class equipment selections into a flat item list [{ index, name, qty }] (fixed items included).
 * selections: one entry per option set: optionIndex | { option, picks: [[index, ...], ...] }; missing -> defaults.
 * `isProficient(item)` (optional) is used to avoid "(if proficient)" defaults the character can't use.
 */
export function resolveStartingEquipment(classKey, selections, srd, { isProficient, abilities } = {}) {
  const cls = get(srd, "classes", classKey);
  if (!cls) return [];
  const items = (cls.startingEquipment || []).map((i) => ({ ...i }));
  (cls.equipmentOptions || []).forEach((set, si) => {
    const sel = asArray(selections)[si];
    let oi = typeof sel === "number" ? sel : sel && typeof sel === "object" ? Number(sel.option) || 0 : null;
    if (oi == null || !set.options[oi]) {
      oi = set.options.findIndex((o) => !o.note || !isProficient || o.items.every((it) => isProficient(it)));
      if (oi < 0) oi = 0;
    }
    const opt = set.options[oi];
    for (const it of opt.items) items.push({ ...it });
    opt.picks.forEach((p, pi) => {
      const chosen = asArray(sel?.picks?.[pi])
        .map((x) => (typeof x === "string" ? p.from.find((f) => f.index === x) : p.from.find((f) => f.index === x?.index)))
        .filter(Boolean)
        .slice(0, p.choose);
      const fill = chosen.length < p.choose ? defaultPick(p.from, p.choose - chosen.length, srd, abilities, items) : [];
      for (const it of [...chosen, ...fill]) items.push({ ...it });
    });
  });
  return items;
}

/** Expand equipment packs into their contents and merge duplicates. */
export function expandItems(list, srd) {
  const out = [];
  const push = (it, note) => {
    const key = it.index ?? `name:${it.name}`;
    const ex = out.find((o) => (o.index ?? `name:${o.name}`) === key && o.notes === (note || ""));
    if (ex) ex.qty += it.qty || 1;
    else out.push({ index: it.index ?? null, name: it.name, qty: it.qty || 1, notes: note || "" });
  };
  for (const it of list) {
    const e = it.index ? get(srd, "equipment", it.index) : null;
    if (e?.type === "pack" && e.contents) {
      for (let n = 0; n < (it.qty || 1); n++) for (const c of e.contents) push(c, `from ${e.name}`);
    } else {
      push(it, it.notes);
    }
  }
  return out;
}

// ─── spells ────────────────────────────────────────────────────────────────────────────────
const SPELL_PREF = [
  // cantrips
  "fire-bolt", "eldritch-blast", "sacred-flame", "vicious-mockery", "guidance", "produce-flame", "shillelagh",
  "ray-of-frost", "mage-hand", "light", "prestidigitation", "minor-illusion", "thaumaturgy", "spare-the-dying",
  "druidcraft", "shocking-grasp", "chill-touch", "mending", "message", "poison-spray", "resistance",
  // 1st
  "magic-missile", "shield", "cure-wounds", "healing-word", "bless", "guiding-bolt", "sleep", "hunters-mark",
  "burning-hands", "thunderwave", "mage-armor", "faerie-fire", "entangle", "shield-of-faith", "detect-magic",
  "hellish-rebuke", "charm-person", "command", "goodberry", "heroism", "sanctuary", "disguise-self", "feather-fall",
  "inflict-wounds", "fog-cloud", "divine-favor", "protection-from-evil-and-good", "identify", "longstrider",
  // 2nd
  "misty-step", "spiritual-weapon", "hold-person", "scorching-ray", "lesser-restoration", "moonbeam", "web",
  "shatter", "invisibility", "aid", "flaming-sphere", "suggestion", "mirror-image", "pass-without-trace",
  "prayer-of-healing", "heat-metal", "silence", "blur", "darkness", "barkskin", "spike-growth", "magic-weapon",
  // 3rd
  "fireball", "spirit-guardians", "counterspell", "lightning-bolt", "revivify", "haste", "dispel-magic",
  "mass-healing-word", "call-lightning", "hypnotic-pattern", "fly", "fear", "slow", "conjure-animals",
  "beacon-of-hope", "remove-curse", "stinking-cloud", "vampiric-touch", "daylight", "plant-growth",
];
const prefRank = (idx) => {
  const i = SPELL_PREF.indexOf(idx);
  return i < 0 ? 999 : i;
};
// ─── spellcasting by class, or by subclass (Eldritch Knight, Arcane Trickster) ──────────────
const subclassOf = (srd, classKey, sub) => (sub ? get(srd, "classes", classKey)?.subclasses?.find((s) => s.index === (sub.index || sub)) || null : null);
function tableAt(t, level) {
  let v = 0;
  for (const k of Object.keys(t || {}).map(Number).sort((a, b) => a - b)) if (level >= k) v = t[k];
  return v;
}
/** How a class casts, with its subclass (a fighter casts only as an Eldritch Knight): CLASS_CASTING + `list`, or null. */
export function castFor(classKey, sub, srd) {
  if (CLASS_CASTING[classKey]) return { ...CLASS_CASTING[classKey], list: classKey };
  const c = subclassOf(srd, classKey, sub)?.casting;
  if (!c) return null;
  return {
    type: c.type || "third", mode: c.mode || "known", ability: c.ability || "int", from: c.from || 3, list: c.list || "wizard",
    schools: c.schools || null, anySchoolAt: c.anySchoolAt || [], cantripsAt: c.cantrips || null, knownAt: c.known || null,
  };
}
/** How many spells a school-bound caster (Eldritch Knight...) may know from outside its schools at this class level. */
export function offSchoolAllowed(cast, level) {
  return cast?.schools ? (cast.anySchoolAt || []).filter((l) => l <= level).length : Infinity;
}
const inSchools = (cast, s) => !cast?.schools || cast.schools.includes(String(s?.school || "").toLowerCase());
function classSpellList(srd, listKey) {
  return (srd?.spells ? [...byIndex(srd.spells).values()] : []).filter((s) => (s.classes || []).includes(listKey));
}
function maxSpellLevelAt(classKey, level, srd, sub = null) {
  const { slots, pact } = spellSlots([{ class: classKey, subclass: sub?.index || sub || null, level }], srd);
  let m = 0;
  slots.forEach((n, i) => n > 0 && (m = i + 1));
  if (pact) m = Math.max(m, pact.level);
  return m;
}
function classRow(srd, classKey, level) {
  return get(srd, "classes", classKey)?.levels?.[Math.max(1, Math.min(20, level)) - 1] ?? null;
}
function cantripCountAt(classKey, level, srd, sub = null) {
  const cast = castFor(classKey, sub, srd);
  if (!cast || level < cast.from) return 0;
  if (cast.cantripsAt) return tableAt(cast.cantripsAt, level);
  return classRow(srd, classKey, level)?.cantrips ?? 0;
}
/** Spells a bard learns through Magical Secrets by this level: they count among the class's spells known. */
function secretsUpTo(classKey, level, srd) {
  const cls = get(srd, "classes", classKey);
  let n = 0;
  for (let l = 1; l <= level; l++) for (const f of cls?.levels?.[l - 1]?.features || []) if (f.pick?.countsAsKnown) n += f.pick.choose || 0;
  return n;
}
function spellCountAt(classKey, level, srd, mod = 0, sub = null) {
  const cast = castFor(classKey, sub, srd);
  if (!cast || level < cast.from) return 0;
  if (cast.knownAt) return tableAt(cast.knownAt, level);
  const row = classRow(srd, classKey, level);
  if (cast.mode === "known" || cast.mode === "pact") return Math.max(0, (row?.spellsKnown ?? 0) - secretsUpTo(classKey, level, srd));
  if (cast.mode === "spellbook") return 6 + 2 * (level - 1);
  if (cast.prepared === "half") return Math.max(1, mod + Math.floor(level / 2));
  return Math.max(1, mod + level);
}
/** The spells a class learns from: its own list, plus a warlock patron's expanded spells. */
function learnableSpells(classKey, sub, srd) {
  const cast = castFor(classKey, sub, srd);
  if (!cast) return [];
  const list = classSpellList(srd, cast.list);
  const s = subclassOf(srd, classKey, sub);
  if (cast.mode === "pact") for (const e of s?.spells || []) { const sp = get(srd, "spells", e.index); if (sp && !list.includes(sp)) list.push(sp); }
  return list;
}

/**
 * Default spell picks (best-first, spread over levels as if chosen while levelling up).
 * -> { cantrips: [index], spells: [index] }
 */
export function defaultSpellPicks(classKey, level, srd, { mod = 0, exclude = [], subclass = null } = {}) {
  const cast = castFor(classKey, subclass, srd);
  const list = learnableSpells(classKey, subclass, srd);
  const taken = new Set(exclude);
  let offLeft = 0;
  const best = (lvl) => list.filter((s) => s.level === lvl && !taken.has(s.index) && (lvl === 0 || inSchools(cast, s) || offLeft > 0))
    .sort((a, b) => inSchools(cast, b) - inSchools(cast, a) || prefRank(a.index) - prefRank(b.index) || a.name.localeCompare(b.name));
  const cantrips = best(0).slice(0, cantripCountAt(classKey, level, srd, subclass)).map((s) => s.index);
  cantrips.forEach((c) => taken.add(c));
  const spells = [];
  let prev = 0;
  for (let l = 1; l <= level; l++) {
    const want = spellCountAt(classKey, l, srd, mod, subclass) - prev;
    prev += Math.max(0, want);
    offLeft = offSchoolAllowed(cast, l) - spells.filter((i) => !inSchools(cast, get(srd, "spells", i))).length;
    const top = maxSpellLevelAt(classKey, l, srd, subclass);
    for (let n = 0; n < want; n++) {
      let pick = null;
      for (let sl = top; sl >= 1 && !pick; sl--) pick = best(sl)[0];
      if (pick && !inSchools(cast, pick)) offLeft--;
      if (!pick) break;
      spells.push(pick.index);
      taken.add(pick.index);
    }
  }
  return { cantrips, spells };
}

/**
 * Spell picking info for a class at a level (character creation).
 * opts: { abilities, subclass } -> exact prepared count / always-prepared subclass spells.
 */
export function spellOptions(classKey, level, srd, opts = {}) {
  const cast = castFor(classKey, opts.subclass, srd);
  const lvl = Math.max(1, Math.min(20, Number(level) || 1));
  const empty = { cantripsToPick: 0, spellsToPick: 0, cantrips: [], spells: [], mode: cast?.mode ?? null, maxSpellLevel: 0, alwaysPrepared: [], schools: null, offSchool: Infinity };
  if (!cast || lvl < cast.from) return empty;
  const mod = opts.abilities ? abilityMod(opts.abilities[cast.ability] ?? 10) : 0;
  const maxSpellLevel = maxSpellLevelAt(classKey, lvl, srd, opts.subclass);
  const list = learnableSpells(classKey, opts.subclass, srd).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const sub = subclassOf(srd, classKey, opts.subclass);
  return {
    cantripsToPick: cantripCountAt(classKey, lvl, srd, opts.subclass),
    spellsToPick: spellCountAt(classKey, lvl, srd, mod, opts.subclass),
    cantrips: list.filter((s) => s.level === 0),
    spells: list.filter((s) => s.level >= 1 && s.level <= maxSpellLevel),
    mode: cast.mode,
    maxSpellLevel,
    alwaysPrepared: alwaysPreparedFor(classKey, sub, lvl, opts.landType),
    // Eldritch Knight / Arcane Trickster: their schools, and how many of their spells may come from any school
    schools: cast.schools || null,
    offSchool: offSchoolAllowed(cast, lvl),
    ability: cast.ability,
  };
}

function alwaysPreparedFor(classKey, sub, classLevel, landType) {
  if (!sub || !["cleric", "paladin", "druid"].includes(classKey)) return [];
  return (sub.spells || [])
    .filter((s) => s.level <= classLevel && (!s.requires || s.requires === `circle-of-the-land-${landType || "forest"}`))
    .map((s) => s.index);
}

// ─── features and the choices they offer ───────────────────────────────────────────────────
// A feature can be a choice: fixed `options` (fighting styles, maneuvers, invocations...), plain words (a ranger's
// favoured enemies and terrains) or a `pick` the app builds from its own lists (skills, languages, tools, cantrips,
// spells: Magical Secrets, Mystic Arcanum...). Options can need a class level, a pact boon, a cantrip or another
// feature first (`requires`), and options a character already has aren't offered again. A feature or a chosen option
// can carry `grants`: proficiencies, skills, expertise, languages, cantrips and spells that go on the sheet.

const skillLabel = (k) => SKILL_NAMES[k] || String(k).replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const byLevelName = (a, b) => a.level - b.level || a.name.localeCompare(b.name);
const wordFamily = (index) => String(index).replace(/-\d.*$/, "");

/** What a character already has that choices depend on (or exclude). */
function haveOf(char = {}) {
  const sc = char.spellcasting || {};
  const h = {
    features: new Set((char.features || []).map((f) => f.index).filter(Boolean)),
    words: new Map(), // feature family ("favored-enemy") -> words already chosen
    cantrips: new Set(sc.cantrips || []),
    spells: new Set([...(sc.known || []), ...(sc.prepared || [])]),
    skills: new Set(Object.keys(char.skillProfs || {}).filter((k) => char.skillProfs[k] === true || Number(char.skillProfs[k]) > 0)),
    languages: new Set(char.otherProfs?.languages || []),
    tools: new Set(char.otherProfs?.tools || []),
  };
  for (const f of char.features || []) {
    const m = /^Chosen: (.*)$/m.exec(f.desc || "");
    if (m && f.index) addWords(h, f.index, m[1].split(", "));
  }
  return h;
}
function addWords(h, index, words) {
  const k = wordFamily(index);
  if (!h.words.has(k)) h.words.set(k, new Set());
  for (const w of words) h.words.get(k).add(w);
}
function haveGrants(h, g) {
  if (!g) return;
  for (const s of g.skills || []) h.skills.add(s);
  for (const s of g.cantrips || []) h.cantrips.add(s);
  for (const s of g.spells || []) h.spells.add(s);
  for (const s of g.languages || []) h.languages.add(s);
  for (const s of g.tools || []) h.tools.add(s);
}
function meets(req, ctx) {
  if (!req) return true;
  if (req.level && (ctx.classLevel || 0) < req.level) return false;
  for (const k of ["pact", "feature"]) if (req[k] && !ctx.have.features.has(req[k])) return false;
  if (req.cantrip && !ctx.have.cantrips.has(req.cantrip)) return false;
  return true;
}
const isChoice = (f) => !!(f.options?.length || f.stringOptions || f.pick);
const pickCount = (f, ctx = {}) => (f.pick ? f.pick.choose ?? 1 : f.stringOptions && !f.options?.length ? f.stringOptions.choose ?? 1 : f.choose ?? ctx.invocationsKnown ?? 1);

/** The options a `pick` feature offers this character now: [{ index, name, desc, grants, spell? }]. */
function pickChoices(f, ctx) {
  const p = f.pick;
  const srd = ctx.srd;
  const h = ctx.have;
  const label = p.label || f.name;
  const opt = (value, name, desc, grants, extra = {}) => ({ index: `${f.index}--${value}`, name: `${label}: ${name}`, desc: desc || "", grants, ...extra });
  switch (p.type) {
    case "skill": {
      const from = asArray(p.from).length ? asArray(p.from) : Object.keys(SKILLS);
      // an expertise pick may be a skill you already have (it becomes doubled); a plain pick is a new skill
      return from.filter((k) => k in SKILLS && (p.expertise || !h.skills.has(k))).map((k) => opt(k, skillLabel(k),
        `${p.expertise ? "Proficiency, with double your proficiency bonus," : "Proficiency"} in ${skillLabel(k)} (${String(SKILLS[k]).toUpperCase()}).`,
        { skills: [k], ...(p.expertise ? { expertise: [k] } : {}) }));
    }
    case "language":
      return languagePool(srd).filter((l) => !h.languages.has(l)).map((l) => opt(slug(l), l, `You can speak, read and write ${l}.`, { languages: [l] }));
    case "tool": {
      const from = Array.isArray(p.from) ? p.from
        : (srd?.equipment ? [...byIndex(srd.equipment).values()] : []).filter((e) => e.type === "tool" && (!p.from || e.toolCategory === p.from)).map((e) => e.name);
      return uniq(from).filter((t) => !h.tools.has(t)).map((t) => opt(slug(t), t, `Proficiency with ${t}: add your proficiency bonus to checks you make with them.`, { tools: [t] }));
    }
    case "cantrip":
      return classSpellList(srd, p.list).filter((s) => s.level === 0 && !h.cantrips.has(s.index)).sort(byLevelName)
        .map((s) => opt(s.index, s.name, s.desc, { cantrips: [s.index] }, { spell: s.index }));
    case "spell": {
      let list = p.lists === "any" ? (srd?.spells ? [...byIndex(srd.spells).values()] : []) : uniq(asArray(p.lists).flatMap((k) => classSpellList(srd, k)));
      const max = p.maxLevel === "castable" ? Math.max(1, ctx.maxSpellLevel || 1) : null;
      // Magical Secrets may also take a cantrip; the other picks name their spell level
      list = list.filter((s) => (p.level != null ? s.level === p.level : s.level >= (p.minLevel ?? 0) && s.level <= max));
      if (p.schools) list = list.filter((s) => p.schools.includes(String(s.school).toLowerCase()));
      list = p.from === "known" ? list.filter((s) => h.spells.has(s.index)) : list.filter((s) => !h.spells.has(s.index) && !h.cantrips.has(s.index));
      return list.sort(byLevelName).map((s) => opt(s.index, s.name, s.desc,
        p.from === "known" ? null : s.level === 0 ? { cantrips: [s.index] } : { spells: [s.index], ...(p.countsAsKnown ? { countsAsKnown: true } : {}) },
        { spell: s.index }));
    }
    default:
      return [];
  }
}

/** The options a feature offers this character right now (requirements met, not already theirs); null = not a choice. */
function choiceOptions(f, ctx) {
  if (f.pick) return pickChoices(f, ctx);
  if (f.options?.length) return f.options.filter((o) => meets(o.requires, ctx) && !ctx.have.features.has(o.index));
  if (f.stringOptions) {
    const taken = ctx.have.words.get(wordFamily(f.index)) || new Set();
    return f.stringOptions.from.filter((w) => !taken.has(w)).map((w) => ({ index: w, name: w, desc: "" }));
  }
  return null;
}

/** A choice as the creator and level-up helper show it: { index, name, desc, level, choose, words, options }. */
function choiceEntry(f, ctx, level) {
  const options = choiceOptions(f, ctx);
  if (!options?.length) return null;
  const words = !!f.stringOptions && !f.options?.length && !f.pick;
  return {
    index: f.index, name: f.name, desc: f.desc || "", level, words,
    choose: Math.min(pickCount(f, ctx), options.length),
    options: options.map((o) => ({ index: o.index, name: o.name, desc: o.desc || "", ...(o.spell ? { spell: o.spell } : {}) })),
  };
}

/** The player's picks among `options` (matched loosely, as older saves name them), topped up with the first ones. */
function pickOptions(feature, choices, extraKeys = []) {
  if (!feature.options?.length) return [];
  const wanted = asArray(choices?.featureOptions?.[feature.index]);
  for (const k of extraKeys) if (k) wanted.push(k);
  const n = feature.choose ?? 1;
  const found = [];
  for (const w of wanted) {
    const key = String(w).toLowerCase();
    const opt = feature.options.find((o) => o.index === key || o.index.endsWith(`-${key}`) || o.index.includes(`-${key}-`) ||
      o.name.toLowerCase() === key || o.name.toLowerCase().endsWith(`: ${key}`) || o.name.toLowerCase().includes(`: ${key} `));
    if (opt && !found.includes(opt)) found.push(opt);
  }
  for (const o of feature.options) if (found.length < n && !found.includes(o)) found.push(o);
  return found.slice(0, n);
}
const FIGHTING_STYLE = /fighting-style$/;

/**
 * Feature entries a class (and subclass) gives at exactly `classLevel`. ctx: { srd, have, grants, classLevel,
 * maxSpellLevel, invocationsKnown }: choices are made against (and added to) ctx.have, and every grant (of a feature
 * or of a chosen option) is collected in ctx.grants.
 */
function classFeaturesAt(cls, subclass, classLevel, choices, ctx = {}) {
  const out = [];
  const row = cls.levels?.[classLevel - 1];
  const source = cls.name;
  const have = ctx.have || (ctx.have = haveOf({}));
  const cctx = { ...ctx, have, classLevel };
  const grant = (g) => { if (g) { ctx.grants?.push(g); haveGrants(have, g); } };
  const push = (f, src, kind) => {
    if (f.placeholder || /^Ability Score Improvement$/i.test(f.name)) return;
    grant(f.grants);
    let desc = f.desc || "";
    const opts = choiceOptions(f, cctx);
    if (f.stringOptions && !f.options?.length && !f.pick) {
      const key = /enemy/i.test(f.index) ? "favoredEnemy" : "favoredTerrain";
      const ok = new Set(opts.map((o) => o.index));
      const pick = uniq([...asArray(choices?.featureOptions?.[f.index]), ...asArray(choices?.[key])]).filter((x) => ok.has(x));
      const chosen = (pick.length ? pick : opts.map((o) => o.index)).slice(0, f.stringOptions.choose);
      desc += `\nChosen: ${chosen.join(", ")}`;
      addWords(have, f.index, chosen);
      out.push({ name: f.name, source: src, level: classLevel, desc, kind, index: f.index });
      return;
    }
    if (opts) {
      const extra = FIGHTING_STYLE.test(f.index) ? [choices?.fightingStyle || "defense"]
        : f.index === "dragon-ancestor" ? [choices?.dragonAncestor || choices?.draconicAncestry]
        : f.index === "circle-of-the-land" ? [choices?.landType || "forest"] : [];
      const picks = pickOptions({ ...f, options: opts, choose: Math.min(pickCount(f, ctx), opts.length) }, choices, extra);
      out.push({ name: f.name, source: src, level: classLevel, desc, kind, index: f.index });
      for (const p of picks) {
        out.push({ name: p.name, source: src, level: classLevel, desc: p.desc, kind, index: p.index });
        have.features.add(p.index);
        grant(p.grants);
      }
      return;
    }
    out.push({ name: f.name, source: src, level: classLevel, desc, kind, index: f.index });
    have.features.add(f.index);
  };
  for (const f of row?.features || []) push(f, source, "class");
  const sub = subclass ? cls.subclasses?.find((s) => s.index === subclass) : null;
  for (const f of sub?.features || []) if (f.level === classLevel) push(f, sub.name, "subclass");
  return out;
}

/** The cantrips a new character's class gives them: their picks, else the defaults (as buildSpellcasting chooses). */
function classCantripsFor(classKey, sub, level, srd, choices = {}) {
  const n = cantripCountAt(classKey, level, srd, sub);
  if (!n) return [];
  const valid = new Set(learnableSpells(classKey, sub, srd).filter((s) => s.level === 0).map((s) => s.index));
  return fillFrom([...valid], [...asArray(choices.cantrips).filter((c) => valid.has(c)), ...defaultSpellPicks(classKey, level, srd, { subclass: sub }).cantrips], n, new Set());
}

/** Apply collected grants to a character: proficiencies, skills, expertise, languages, saves, cantrips and spells. */
function applyGrants(c, grants, cast = null) {
  for (const g of grants || []) {
    if (!g) continue;
    c.otherProfs = c.otherProfs || { armor: [], weapons: [], tools: [], languages: [] };
    for (const k of ["armor", "weapons", "tools", "languages"]) if (g[k]?.length) c.otherProfs[k] = uniq([...(c.otherProfs[k] || []), ...g[k]]);
    c.skillProfs = c.skillProfs || {};
    for (const s of g.skills || []) if (!(Number(c.skillProfs[s]) >= 1) && c.skillProfs[s] !== true) c.skillProfs[s] = 1;
    for (const s of g.expertise || []) c.skillProfs[s] = 2;
    if (g.saves?.length) c.saveProfs = uniq([...(c.saveProfs || []), ...g.saves]);
    const sc = c.spellcasting;
    if (!sc || !(g.cantrips?.length || g.spells?.length)) continue; // only spellcasters get spells from features
    sc.cantrips = uniq([...(sc.cantrips || []), ...(g.cantrips || [])]);
    // remembered apart, so the sheet counts them on top of the class's own number (Magical Secrets are part of it)
    sc.fromFeatures = sc.fromFeatures || { cantrips: [], spells: [] };
    sc.fromFeatures.cantrips = uniq([...sc.fromFeatures.cantrips, ...(g.cantrips || [])]);
    if (!g.countsAsKnown) sc.fromFeatures.spells = uniq([...sc.fromFeatures.spells, ...(g.spells || [])]);
    for (const s of g.spells || []) {
      sc.known = uniq([...(sc.known || []), s]);
      if (cast?.mode === "spellbook") continue; // added to the spellbook; preparing it is up to the wizard
      sc.prepared = uniq([...(sc.prepared || []), s]);
      if (cast?.mode === "prepared" && !g.countsAsKnown) sc.alwaysPrepared = uniq([...(sc.alwaysPrepared || []), s]);
    }
  }
}

/**
 * Class feature choices a new character makes for levels 1..level: fighting style, favoured enemy and terrain,
 * dragon ancestor, metamagic, invocations, pact boon, hunter's prey, maneuvers, magical secrets... ->
 * [{ index, name, level, desc, choose, words, options: [{ index, name, desc, spell? }] }].
 * Pass the picks to buildCharacter as `featureOptions: { [index]: [..] }`. `words` = the options are plain words with no
 * rules text (a ranger's enemy types and terrains). `choices` (optional, buildCharacter's) lets later levels leave out
 * what earlier levels already picked.
 */
export function creationFeatureChoices(classKey, subclassKey, level, srd, choices = {}) {
  const cls = get(srd, "classes", classKey);
  if (!cls) return [];
  const lvl = Math.max(1, Math.min(20, Number(level) || 1));
  const sub = subclassKey && lvl >= (cls.subclassLevel || 3) ? cls.subclasses?.find((s) => s.index === subclassKey) : null;
  const out = [];
  const ctx = { srd, have: haveOf({ spellcasting: { cantrips: classCantripsFor(classKey, sub?.index, lvl, srd, choices) } }), grants: [] };
  for (let l = 1; l <= lvl; l++) {
    const row = cls.levels?.[l - 1];
    const lctx = { ...ctx, classLevel: l, maxSpellLevel: maxSpellLevelAt(classKey, l, srd, sub?.index), invocationsKnown: row?.specific?.invocationsKnown ?? null };
    for (const f of [...(row?.features || []), ...((sub?.features || []).filter((x) => x.level === l))]) {
      if (!isChoice(f)) continue;
      const e = choiceEntry(f, lctx, l);
      if (e) out.push(e);
    }
    // what this level picks (the player's or the defaults) is taken when the next levels offer their options
    classFeaturesAt(cls, sub?.index, l, choices, lctx);
  }
  return out;
}

function raceFeatures(race, sub, choices, srd) {
  const out = [];
  for (const t of race?.traits || []) out.push({ name: t.name, source: race.name, level: 1, desc: t.desc, kind: "race", index: t.index });
  if (race?.draconicAncestry?.length) {
    const want = String(choices?.draconicAncestry || "").toLowerCase();
    const anc = race.draconicAncestry.find((a) => a.name.toLowerCase() === want || a.index === want || a.index.endsWith(`-${want}`)) || race.draconicAncestry[0];
    const area = anc.area.type === "line" ? `5 by ${anc.area.size} ft line` : `${anc.area.size} ft cone`;
    out.push({ name: `Draconic Ancestry (${anc.name})`, source: race.name, level: 1, kind: "race", index: anc.index,
      desc: `${anc.name} dragon ancestry: your breath weapon deals ${anc.damageType} damage in a ${area} (${anc.save.toUpperCase()} save), and you have resistance to ${anc.damageType} damage.` });
  }
  for (const t of sub?.traits || []) out.push({ name: t.name, source: sub.name, level: 1, desc: t.desc, kind: "race", index: t.index });
  return out;
}

// ─── proficiencies helpers ─────────────────────────────────────────────────────────────────
function fillFrom(list, wanted, n, taken) {
  const out = [];
  for (const w of wanted) if (out.length < n && list.includes(w) && !taken.has(w) && !out.includes(w)) out.push(w);
  for (const w of list) if (out.length < n && !taken.has(w) && !out.includes(w)) out.push(w);
  return out;
}
const STD_LANGS = ["Common", "Elvish", "Dwarvish", "Halfling", "Gnomish", "Giant", "Goblin", "Orc", "Draconic",
  "Celestial", "Infernal", "Sylvan", "Abyssal", "Primordial", "Deep Speech", "Undercommon"];
function languagePool(srd, from) {
  if (Array.isArray(from)) return from;
  const all = srd?.languages ? [...byIndex(srd.languages).values()] : [];
  return all.length ? all.sort((a, b) => (a.type === b.type ? 0 : a.type === "Standard" ? -1 : 1)).map((l) => l.name) : STD_LANGS;
}
/** One choice group's picks: the player's own (in order), then defaults that aren't taken or wanted by another group. */
function groupPicks(from, wanted, n, taken, avoid) {
  const out = [];
  for (const w of wanted) if (out.length < n && from.includes(w) && !taken.has(w) && !out.includes(w)) out.push(w);
  for (const w of from) if (out.length < n && !taken.has(w) && !avoid.has(w) && !out.includes(w)) out.push(w);
  for (const w of from) if (out.length < n && !taken.has(w) && !out.includes(w)) out.push(w);
  return out;
}

/**
 * The tool and language proficiencies a new character chooses (from race, subrace, class and background) and what
 * each choice comes to. `choices` = buildCharacter's (race, subrace, class, background, tools, languages).
 * -> { tools: [group], languages: [group], fixedTools: [name], fixedLanguages: [name] }
 * group = { key: "class-0", kind: "tools"|"languages", source: "race"|"subrace"|"class"|"background", sourceName,
 *           desc, choose, from: [name], picked: [name] }; `picked` = the player's picks for it, topped up with defaults.
 * Picks go to buildCharacter as `tools: { [key]: [name] }` and `languages: { [key]: [name] }` (a plain list still
 * works: each group takes the names on it that it offers).
 */
export function creationProficiencyChoices(choices = {}, srd = {}) {
  const cls = get(srd, "classes", choices.class);
  const race = get(srd, "races", choices.race);
  const sub = race?.subraces?.find((s) => s.index === choices.subrace) || race?.subraces?.[0] || null;
  const bg = get(srd, "backgrounds", choices.background) || null;
  const fixedTools = [...(cls?.proficiencies?.tools || []), ...(race?.proficiencies?.tools || []), ...(sub?.proficiencies?.tools || []), ...(bg?.tools || [])];
  const fixedLanguages = [...(race?.languages || []), ...(cls?.index === "druid" ? ["Druidic"] : []), ...(cls?.index === "rogue" ? ["Thieves' Cant"] : []), ...(bg?.languages || [])];
  const tools = [];
  const addTools = (groups, source, sourceName) => groups.forEach((g, i) => tools.push({
    key: `${source}-${i}`, kind: "tools", source, sourceName, desc: g.desc || "Tool proficiency", choose: g.choose || 1, from: g.from || [],
  }));
  addTools(cls?.toolChoices || [], "class", cls?.name);
  addTools((race?.proficiencyChoices || []).filter((p) => p.type === "tools"), "race", race?.name);
  addTools((sub?.proficiencyChoices || []).filter((p) => p.type === "tools"), "subrace", sub?.name);
  addTools(bg?.toolChoices || [], "background", bg?.name);
  const languages = [[race?.languageChoices, "race", race?.name], [sub?.languageChoices, "subrace", sub?.name], [bg?.languageChoices, "background", bg?.name]]
    .filter(([g]) => g)
    .map(([g, source, sourceName]) => ({
      key: `${source}-0`, kind: "languages", source, sourceName, choose: g.choose || 1, from: languagePool(srd, g.from),
      desc: `${g.choose > 1 ? `${g.choose} languages` : "one language"} of your choice`,
    }));
  const resolve = (groups, input, fixed) => {
    const flat = Array.isArray(input) || typeof input === "string";
    const wantedFor = (key) => (flat ? asArray(input) : asArray(input?.[key]));
    const avoid = new Set(flat ? asArray(input) : Object.values(input || {}).flatMap(asArray));
    const taken = new Set(fixed);
    for (const g of groups) {
      g.picked = groupPicks(g.from, wantedFor(g.key), g.choose, taken, avoid);
      g.picked.forEach((x) => taken.add(x));
    }
  };
  resolve(tools, choices.tools, fixedTools);
  resolve(languages, choices.languages, fixedLanguages);
  return { tools, languages, fixedTools, fixedLanguages };
}

/** The items a background's equipment choices come to: the player's pick for each (index or name), else the first. */
export function backgroundEquipmentPicks(bg, picks) {
  return (bg?.equipmentChoices || []).map((g, gi) => {
    const want = asArray(picks)[gi];
    return g.from.find((f) => (f.index != null && f.index === want) || f.name === want) || g.from[0] || null;
  });
}

function armorProficient(armorProfs, base) {
  if (!base || base.type !== "armor") return true;
  const set = new Set(armorProfs.map(normName));
  if (base.armorType === "shield") return set.has(normName("Shields"));
  return set.has(normName(`${base.armorType} armor`));
}

// ─── buildCharacter ────────────────────────────────────────────────────────────────────────
export function buildCharacter(choices = {}, srd = {}) {
  const level = Math.max(1, Math.min(20, Number(choices.level) || 1));
  const cls = get(srd, "classes", choices.class);
  if (!cls) throw new Error(`buildCharacter: unknown class "${choices.class}"`);
  const race = get(srd, "races", choices.race);
  if (!race) throw new Error(`buildCharacter: unknown race "${choices.race}"`);
  const sub = race.subraces?.find((s) => s.index === choices.subrace) || (race.subraces?.length ? race.subraces[0] : null);
  const bg = get(srd, "backgrounds", choices.background) || null;
  const subclass = level >= (cls.subclassLevel || 3)
    ? (cls.subclasses?.find((s) => s.index === choices.subclass) || cls.subclasses?.[0] || null)
    : null;
  const classKey = cls.index;

  // abilities
  const order = ABILITY_PRIORITY[classKey] || ABILITIES;
  const base = {};
  if (choices.baseAbilities) for (const a of ABILITIES) base[a] = Number(choices.baseAbilities[a]) || 10;
  else order.forEach((a, i) => (base[a] = STANDARD_ARRAY[i]));
  let bonusChoices = choices.bonusChoices;
  if (race.bonusChoices && !bonusChoices) {
    bonusChoices = race.bonusChoices.from.slice().sort((a, b) => order.indexOf(a) - order.indexOf(b)).slice(0, race.bonusChoices.choose);
  }
  const bonuses = racialBonuses(race, sub, bonusChoices, srd);
  const abilities = {};
  for (const a of ABILITIES) abilities[a] = Math.min(20, base[a] + (bonuses[a] || 0));
  const asiLevels = asiLevelsFor(classKey).filter((l) => l <= level);
  asiLevels.forEach((l, i) => applyAsi(abilities, asArray(choices.asi)[i], classKey));

  // proficiencies
  const armor = [...(cls.proficiencies?.armor || []), ...(race.proficiencies?.armor || []), ...(sub?.proficiencies?.armor || [])];
  if (subclass?.index === "life") armor.push("Heavy Armor");
  const weapons = [...(cls.proficiencies?.weapons || []), ...(race.proficiencies?.weapons || []), ...(sub?.proficiencies?.weapons || [])];
  // tools and languages: fixed ones plus the player's picks for each choice (defaults where they made none)
  const profChoices = creationProficiencyChoices({ ...choices, class: classKey, race: race.index, subrace: sub?.index, background: bg?.index }, srd);
  const tools = [...profChoices.fixedTools, ...profChoices.tools.flatMap((g) => g.picked)];

  // skills
  const fixedSkills = uniq([...(bg?.skills || []), ...(race.proficiencies?.skills || []), ...(sub?.proficiencies?.skills || [])]);
  const raceSkillChoices = [...(race.proficiencyChoices || []), ...(sub?.proficiencyChoices || [])].filter((p) => p.type === "skills");
  const loreBonus = subclass?.index === "lore" && level >= 3 ? 3 : 0;
  const allSkills = Object.keys(SKILLS);
  const wantedSkills = asArray(choices.skills).filter((s) => s in SKILLS);
  // defaults: skills keyed to the character's best abilities first
  const byMods = (list) => list.slice().sort((a, b) => abilityMod(abilities[SKILLS[b]]) - abilityMod(abilities[SKILLS[a]]));
  const skillDefaults = (list) => (wantedSkills.length ? wantedSkills : byMods(list));
  const taken = new Set(fixedSkills);
  const classPicks = fillFrom(cls.skillChoices?.from || [], skillDefaults(cls.skillChoices?.from || []), cls.skillChoices?.choose || 0, taken);
  classPicks.forEach((s) => taken.add(s));
  const extraWanted = wantedSkills.filter((s) => !taken.has(s));
  const raceN = raceSkillChoices.reduce((a, p) => a + p.choose, 0);
  const extraPicks = fillFrom(allSkills, wantedSkills.length ? extraWanted : byMods(allSkills), raceN + loreBonus, taken);
  const skillProfs = {};
  for (const s of [...fixedSkills, ...classPicks, ...extraPicks]) skillProfs[s] = 1;

  // expertise
  let expertiseN = 0;
  if (classKey === "rogue") expertiseN = level >= 6 ? 4 : 2;
  if (classKey === "bard" && level >= 3) expertiseN = level >= 10 ? 4 : 2;
  if (expertiseN) {
    const pref = classKey === "rogue" ? ["stealth", "perception", "sleightOfHand", "acrobatics", "deception", "investigation", "athletics"]
      : ["persuasion", "performance", "deception", "perception", "insight", "acrobatics"];
    const wanted = asArray(choices.expertise);
    const pool = [...Object.keys(skillProfs), ...(classKey === "rogue" && tools.includes("Thieves' Tools") ? ["thieves-tools"] : [])];
    const picks = fillFrom(pool, [...wanted, ...pref.filter((p) => !wanted.length)], expertiseN, new Set());
    for (const p of picks) {
      if (p === "thieves-tools") {
        const i = tools.indexOf("Thieves' Tools");
        if (i >= 0) tools[i] = "Thieves' Tools (expertise)";
      } else skillProfs[p] = 2;
    }
  }

  // languages
  const languages = [...profChoices.fixedLanguages, ...profChoices.languages.flatMap((g) => g.picked)];

  // hit points
  const con = abilityMod(abilities.con);
  const die = cls.hitDie;
  const hpMethod = choices.hpMethod || "average";
  let hpMax = die + con;
  for (let l = 2; l <= level; l++) {
    let roll = Math.floor(die / 2) + 1;
    if (hpMethod === "max") roll = die;
    else if (hpMethod === "roll" && Number(asArray(choices.hpRolls)[l - 2]) > 0) roll = Math.min(die, Number(choices.hpRolls[l - 2]));
    hpMax += Math.max(1, roll + con);
  }
  hpMax = Math.max(1, hpMax);
  if (sub?.hpPerLevel) hpMax += sub.hpPerLevel * level;
  if (subclass?.index === "draconic") hpMax += level;

  // features (choices are made level by level, so a later level never offers what an earlier one took)
  const fctx = { srd, grants: [], have: haveOf({ skillProfs: Object.fromEntries(Object.keys(skillProfs).map((k) => [k, 1])), otherProfs: { languages, tools },
    spellcasting: { cantrips: classCantripsFor(classKey, subclass?.index, level, srd, choices) } }) };
  const features = [...raceFeatures(race, sub, choices, srd)];
  for (let l = 1; l <= level; l++) {
    features.push(...classFeaturesAt(cls, subclass?.index, l, choices, {
      ...fctx, classLevel: l, maxSpellLevel: maxSpellLevelAt(classKey, l, srd, subclass?.index), invocationsKnown: cls.levels?.[l - 1]?.specific?.invocationsKnown ?? null,
    }));
  }
  if (bg?.feature) features.push({ name: bg.feature.name, source: bg.name, level: 1, desc: bg.feature.desc, kind: "background" });

  // equipment
  const otherProfs = { armor: uniq(armor), weapons: uniq(weapons), tools: uniq(tools), languages: uniq(languages) };
  const isProficient = (it) => armorProficient(otherProfs.armor, get(srd, "equipment", it.index));
  let classItems;
  const eqIn = asArray(choices.equipment);
  if (eqIn.length && eqIn.every((e) => typeof e === "string" || (e && typeof e === "object" && !("option" in e) && (e.index || e.name)))) {
    classItems = eqIn.map((e) => (typeof e === "string" ? { index: e, name: get(srd, "equipment", e)?.name ?? e, qty: 1 } : { index: e.index ?? null, name: e.name ?? get(srd, "equipment", e.index)?.name ?? e.index, qty: e.qty || 1 }));
  } else {
    classItems = resolveStartingEquipment(classKey, eqIn, srd, { isProficient, abilities });
  }
  const bgItems = [...(bg?.equipment || []).map((i) => ({ ...i }))];
  for (const found of backgroundEquipmentPicks(bg, choices.backgroundEquipment)) if (found) bgItems.push({ ...found });
  const items = expandItems([...classItems, ...bgItems], srd).map((it) => ({
    id: newItemId(), name: it.name, index: it.index, qty: it.qty, equipped: false, attuned: false, notes: it.notes || "",
  }));
  let haveArmor = false;
  let haveShield = false;
  for (const it of items) {
    const e = lookupEquipment(it, srd);
    if (!e) continue;
    if (e.type === "weapon") it.equipped = true;
    else if (e.type === "armor" && armorProficient(otherProfs.armor, e)) {
      if (e.armorType === "shield" && !haveShield) { it.equipped = true; haveShield = true; }
      else if (e.armorType !== "shield" && !haveArmor) { it.equipped = true; haveArmor = true; }
    }
  }

  // spellcasting (cantrips and spells features give don't count against the class's own picks)
  const granted = { cantrips: fctx.grants.flatMap((g) => g.cantrips || []), spells: fctx.grants.flatMap((g) => g.spells || []) };
  const landType = landTypeOf(features, choices);
  const spellcasting = buildSpellcasting(classKey, subclass, level, abilities, { ...choices, landType }, race, sub, srd, granted);

  // resources
  const resources = {};
  const tmpChar = { abilities, classes: [{ class: classKey, subclass: subclass?.index ?? null, level }], race: race.index };
  for (const r of classResources(classKey, level, tmpChar)) if (r.max != null) resources[r.key] = { used: 0 };
  if (race.index === "dragonborn") resources.breathWeapon = { used: 0 };
  if (race.index === "half-orc") resources.relentlessEndurance = { used: 0 };
  if (race.index === "tiefling" && level >= 3) resources.hellishRebuke = { used: 0 };
  if (race.index === "tiefling" && level >= 5) resources.darkness = { used: 0 };

  const anc = race.draconicAncestry?.length
    ? (race.draconicAncestry.find((a) => a.name.toLowerCase() === String(choices.draconicAncestry || "").toLowerCase() || a.index === choices.draconicAncestry) || race.draconicAncestry[0]).name.toLowerCase()
    : undefined;

  const p = choices.personality || {};
  const char = {
    id: choices.id || newItemId("ch_"),
    ownerId: choices.ownerId ?? null,
    campaignId: choices.campaignId ?? null,
    name: choices.name || "Unnamed Adventurer",
    playerName: choices.playerName || "",
    race: race.index,
    subrace: sub?.index ?? null,
    class: classKey,
    subclass: subclass?.index ?? null,
    level,
    xp: Number(choices.xp) || 0,
    classes: [{ class: classKey, subclass: subclass?.index ?? null, level }],
    background: bg?.index ?? choices.background ?? null,
    alignment: choices.alignment || "Neutral",
    abilities,
    abilityMethod: choices.abilityMethod || (choices.baseAbilities ? "manual" : "standard"),
    skillProfs,
    saveProfs: (cls.saves || []).slice(),
    otherProfs,
    hp: { max: hpMax, current: hpMax, temp: 0 },
    hitDice: { die, total: level, used: 0 },
    deathSaves: { success: 0, fail: 0 },
    acOverride: null,
    speed: sub?.speed ?? race.speed ?? 30,
    darkvision: sub?.darkvision ?? race.darkvision ?? 0,
    equipment: items,
    currency: { cp: 0, sp: 0, ep: 0, gp: Number(choices.gold ?? bg?.gold ?? 0) || 0, pp: 0 },
    spellcasting,
    resources,
    features,
    conditions: [],
    exhaustion: 0,
    inspiration: false,
    concentration: null,
    personality: { traits: p.traits || "", ideals: p.ideals || "", bonds: p.bonds || "", flaws: p.flaws || "" },
    appearance: choices.appearance || "",
    backstory: choices.backstory || "",
    portrait: choices.portrait || null,
    color: choices.color || CLASS_COLORS[classKey] || "#7aa2f7",
    light: { bright: 0, dim: 0 },
  };
  if (anc) char.draconicAncestry = anc;
  applyGrants(char, fctx.grants, castFor(classKey, subclass?.index, srd));
  return char;
}

/** A Circle of the Land druid's land: the option they chose (circle-of-the-land-<land>), else choices.landType. */
function landTypeOf(features, choices = {}) {
  const f = (features || []).find((x) => /^circle-of-the-land-[a-z]+$/.test(x.index || ""));
  return f ? f.index.replace("circle-of-the-land-", "") : choices.landType || asArray(choices.featureOptions?.["circle-of-the-land"])[0]?.replace?.("circle-of-the-land-", "") || undefined;
}

function innateSpellsFor(race, sub, level, choices) {
  const out = [];
  if (sub?.cantripChoice) {
    const want = choices.raceCantrip;
    const pick = sub.cantripChoice.from.includes(want) ? want : sub.cantripChoice.from.includes("fire-bolt") ? "fire-bolt" : sub.cantripChoice.from[0];
    out.push({ spell: pick, ability: sub.cantripChoice.ability, source: sub.name, level: 0 });
  }
  if (race.index === "tiefling") {
    out.push({ spell: "thaumaturgy", ability: "cha", source: "Infernal Legacy", level: 0 });
    if (level >= 3) out.push({ spell: "hellish-rebuke", ability: "cha", source: "Infernal Legacy", level: 2, uses: "1/long rest", resource: "hellishRebuke" });
    if (level >= 5) out.push({ spell: "darkness", ability: "cha", source: "Infernal Legacy", level: 2, uses: "1/long rest", resource: "darkness" });
  }
  return out;
}

function buildSpellcasting(classKey, subclass, level, abilities, choices, race, sub, srd, granted = { cantrips: [], spells: [] }) {
  const cast = castFor(classKey, subclass?.index, srd);
  const innate = innateSpellsFor(race, sub, level, choices);
  const canCast = cast && level >= cast.from;
  if (!canCast && !innate.length) return null;
  const sc = {
    ability: canCast ? cast.ability : innate[0].ability,
    cantrips: [], known: [], prepared: [],
    slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0,
  };
  if (canCast) {
    const mod = abilityMod(abilities[cast.ability]);
    const opts = spellOptions(classKey, level, srd, { abilities, subclass: subclass?.index, landType: choices.landType });
    const validC = new Set(opts.cantrips.map((s) => s.index));
    const validS = new Set(opts.spells.map((s) => s.index));
    const always = opts.alwaysPrepared;
    const defaults = defaultSpellPicks(classKey, level, srd, { mod, exclude: [...always, ...granted.spells, ...granted.cantrips], subclass: subclass?.index });
    const innateC = new Set([...innate.filter((i) => i.level === 0).map((i) => i.spell), ...granted.cantrips]);
    const cantrips = fillFrom([...validC], [...asArray(choices.cantrips).filter((c) => validC.has(c)), ...defaults.cantrips], opts.cantripsToPick, innateC);
    const chosen = asArray(choices.spells).filter((s) => validS.has(s) && !always.includes(s));
    // a school-bound caster (Eldritch Knight...) keeps to its schools except for the picks it may take from any
    let off = opts.offSchool;
    const inSchool = (i) => !opts.schools || opts.schools.includes(String(get(srd, "spells", i)?.school || "").toLowerCase());
    const allowed = [...chosen, ...(chosen.length ? [] : defaults.spells)].filter((i) => inSchool(i) || off-- > 0);
    const spells = fillFrom([...validS].filter((i) => inSchool(i)), allowed, opts.spellsToPick, new Set([...always, ...granted.spells]));
    for (const i of allowed) if (!spells.includes(i) && spells.length < opts.spellsToPick && !always.includes(i) && !granted.spells.includes(i)) spells.push(i);
    sc.cantrips = cantrips;
    if (cast.mode === "spellbook") {
      sc.known = spells;
      const prepMax = Math.max(1, mod + level);
      const prepWanted = asArray(choices.prepared).filter((s) => spells.includes(s));
      sc.prepared = fillFrom(spells, prepWanted.length ? prepWanted : spells.slice().sort((a, b) => prefRank(a) - prefRank(b)), prepMax, new Set());
    } else if (cast.mode === "prepared") {
      sc.prepared = uniq([...always, ...spells]);
      sc.known = sc.prepared.slice();
      if (always.length) sc.alwaysPrepared = always.slice();
    } else {
      sc.known = spells;
      sc.prepared = spells.slice();
    }
  }
  if (innate.length) {
    sc.innate = innate;
    for (const i of innate) if (i.level === 0 && !sc.cantrips.includes(i.spell)) sc.cantrips.push(i.spell);
  }
  return sc;
}

// ─── level up ──────────────────────────────────────────────────────────────────────────────
function meetsMulticlassPrereq(char, cls) {
  const mc = cls?.multiclass;
  if (!mc?.prereq?.length) return true;
  const ok = (p) => (char.abilities?.[p.ability] ?? 10) >= p.min;
  return mc.prereqMode === "any" ? mc.prereq.some(ok) : mc.prereq.every(ok);
}

const ABILITY_NAMES = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

/** "Wisdom 13", "Strength 13 or Dexterity 13", "Dexterity 13 and Wisdom 13". */
export function multiclassPrereqText(cls) {
  const p = cls?.multiclass?.prereq || [];
  return p.map((x) => `${ABILITY_NAMES[x.ability] || x.ability} ${x.min}`).join(cls?.multiclass?.prereqMode === "any" ? " or " : " and ");
}

/**
 * 5e multiclassing needs the ability scores of the new class AND of every class you already have.
 * Returns the unmet requirements as text ([] = allowed).
 */
export function multiclassProblems(char, srd, classKey) {
  const classes = characterClasses(char);
  if (classes.some((c) => c.class === classKey)) return [];
  const out = [];
  const cls = get(srd, "classes", classKey);
  if (cls && !meetsMulticlassPrereq(char, cls)) out.push(`${cls.name} needs ${multiclassPrereqText(cls)}`);
  for (const c of classes) {
    const own = get(srd, "classes", c.class);
    if (own && !meetsMulticlassPrereq(char, own)) out.push(`multiclassing out of ${own.name} needs ${multiclassPrereqText(own)}`);
  }
  return out;
}

/** Every class a character could take their next level in: the ones they have, then the rest (multiclass). */
export function levelUpOptions(char, srd) {
  const have = characterClasses(char);
  const all = srd?.classes || [];
  const order = [...have.map((c) => c.class), ...all.map((c) => c.index).filter((k) => !have.some((h) => h.class === k))];
  return order.map((k) => {
    const cls = get(srd, "classes", k);
    if (!cls) return null;
    const cur = have.find((h) => h.class === k);
    const next = (cur?.level || 0) + 1;
    const row = cls.levels?.[next - 1];
    const sub = cls.subclasses?.find((s) => s.index === cur?.subclass);
    const feats = [...(row?.features || []), ...((sub?.features || []).filter((f) => f.level === next))].map((f) => f.name);
    const problems = multiclassProblems(char, srd, k);
    return {
      classKey: k, name: cls.name, current: cur?.level || 0, next, subclass: cur?.subclass || null, multiclass: !cur,
      hitDie: cls.hitDie, features: uniq(feats).slice(0, 6), asi: asiLevelsFor(k).includes(next),
      subclassAt: !cur?.subclass && next >= (cls.subclassLevel || 3) ? cls.subclassLevel || 3 : null,
      prereqText: multiclassPrereqText(cls), allowed: !problems.length && next <= 20, problems,
    };
  }).filter(Boolean);
}

/**
 * What happens at the next level. classKey (optional) = class to gain a level in (multiclass); default the
 * character's first class.
 */
export function levelUpPlan(char, srd, classKey, opts = {}) {
  const classes = characterClasses(char);
  const target = classKey || classes[0]?.class;
  const cls = get(srd, "classes", target);
  if (!cls) throw new Error(`levelUpPlan: unknown class "${target}"`);
  const existing = classes.find((c) => c.class === target);
  const classLevel = (existing?.level || 0) + 1;
  const newLevel = totalLevel(char) + (classes.length ? 1 : 0);
  if (classLevel > 20 || newLevel > 20) return { newLevel: totalLevel(char), maxed: true, classKey: target, classLevel: classLevel - 1, features: [], asi: false, subclassChoice: false, spellsToPick: 0, cantripsToPick: 0 };
  const row = cls.levels?.[classLevel - 1];
  const prev = classLevel > 1 ? cls.levels?.[classLevel - 2] : null;
  const subclass = existing?.subclass ?? null;
  const subclassChoice = !subclass && classLevel >= (cls.subclassLevel || 3);
  // the path being chosen this level (if the helper says which), for its spellcasting
  const pathNow = subclass || (subclassChoice && cls.subclasses?.some((s) => s.index === opts.subclass) ? opts.subclass : null);
  const newClasses = existing ? classes.map((c) => (c.class === target ? { ...c, level: classLevel, subclass: pathNow } : c)) : [...classes, { class: target, subclass: null, level: 1 }];
  const slotsAfter = spellSlots(newClasses, srd);
  let maxAfter = 0;
  slotsAfter.slots.forEach((n, i) => n > 0 && (maxAfter = i + 1));
  if (slotsAfter.pact) maxAfter = Math.max(maxAfter, slotsAfter.pact.level);
  // choices are offered against what the character already has (no option they took before, requirements met)
  const ctxAt = (lvl) => ({ srd, have: haveOf(char), classLevel: lvl, maxSpellLevel: maxAfter, invocationsKnown: row?.specific?.invocationsKnown ?? null });
  const features = classFeaturesAt(cls, subclass, classLevel, {}, ctxAt(classLevel));
  // feature choices (fighting style, metamagic, pact boon, invocations, hunter's prey, maneuvers, magical secrets...)
  const rowFeats = [...(row?.features || []), ...((cls.subclasses?.find((s) => s.index === subclass)?.features || []).filter((f) => f.level === classLevel))];
  const choiceOf = (f) => choiceEntry(f, ctxAt(classLevel), f.level ?? classLevel);
  const featureChoices = rowFeats.filter(isChoice).map(choiceOf).filter(Boolean);
  const cast = castFor(target, pathNow, srd);
  const mod = cast ? abilityMod(char.abilities?.[cast.ability] ?? 10) : 0;
  let cantripsToPick = 0;
  let spellsToPick = 0;
  const sc = char.spellcasting || {};
  if (cast && classLevel >= cast.from) {
    cantripsToPick = cantripCountAt(target, classLevel, srd, pathNow) - (classLevel - 1 >= cast.from ? cantripCountAt(target, classLevel - 1, srd, pathNow) : 0);
    if (cast.mode === "known" || cast.mode === "pact") spellsToPick = spellCountAt(target, classLevel, srd, mod, pathNow) - (classLevel - 1 >= cast.from ? spellCountAt(target, classLevel - 1, srd, mod, pathNow) : 0);
    else if (cast.mode === "spellbook") spellsToPick = classLevel === 1 ? 6 : 2;
    else {
      // prepared casters fill every open place: all the spells they can prepare now, beyond the ones they have
      const always = alwaysPreparedFor(target, subclassOf(srd, target, pathNow), classLevel, landTypeOf(char.features));
      const current = (sc.prepared || []).filter((s) => !always.includes(s) && !(sc.alwaysPrepared || []).includes(s)).length;
      spellsToPick = existing ? spellCountAt(target, classLevel, srd, mod, pathNow) - current : spellCountAt(target, classLevel, srd, mod, pathNow);
    }
  }
  const { slots, pact } = spellSlots(newClasses, srd);
  let maxSpellLevel = 0;
  slots.forEach((n, i) => n > 0 && (maxSpellLevel = i + 1));
  if (pact) maxSpellLevel = Math.max(maxSpellLevel, pact.level);
  const expertise = (target === "rogue" && (classLevel === 1 || classLevel === 6)) || (target === "bard" && (classLevel === 3 || classLevel === 10)) ? 2 : 0;
  return {
    newLevel,
    classKey: target,
    classLevel,
    multiclass: !existing,
    prereqOk: existing ? true : !multiclassProblems(char, srd, target).length,
    prereqProblems: existing ? [] : multiclassProblems(char, srd, target),
    multiclassSkills: !existing && cls.multiclass?.skillChoices ? cls.multiclass.skillChoices : null,
    multiclassProficiencies: !existing ? cls.multiclass?.proficiencies || null : null,
    hpDie: cls.hitDie,
    hpAverage: Math.floor(cls.hitDie / 2) + 1,
    conMod: abilityMod(char.abilities?.con ?? 10),
    profBonus: profBonus(newLevel),
    features,
    featureChoices,
    asi: asiLevelsFor(target).includes(classLevel),
    subclassChoice,
    // each path's own choices up to this level (a ranger 3 Hunter picks Hunter's Prey): offered once a path is chosen
    subclassOptions: subclassChoice ? (cls.subclasses || []).map((s) => ({ index: s.index, name: s.name, desc: s.desc, srd: s.srd !== false,
      features: s.features.filter((f) => f.level <= classLevel).map((f) => ({ name: f.name, level: f.level, desc: f.desc })),
      featureChoices: s.features.filter((f) => f.level <= classLevel && isChoice(f)).map(choiceOf).filter(Boolean) })) : [],
    spellsToPick: Math.max(0, spellsToPick),
    cantripsToPick: Math.max(0, cantripsToPick),
    maxSpellLevel,
    classMaxSpellLevel: cast && classLevel >= cast.from ? maxSpellLevelAt(target, classLevel, srd, pathNow) : 0,
    // Eldritch Knight / Arcane Trickster: their schools and how many spells they may know from any school
    spellSchools: cast?.schools || null,
    offSchoolAllowed: cast?.schools ? offSchoolAllowed(cast, classLevel) : null,
    spellMode: cast && classLevel >= cast.from ? cast.mode : null,
    slots,
    pact,
    expertiseToPick: expertise,
    skillsToPick: target === "bard" && classLevel === 3 && (subclass === "lore" || subclassChoice) ? 3 : 0,
    resources: classResources(target, classLevel, { ...char, classes: newClasses }),
  };
}

/**
 * The spells a level-up can add: { cantrips, spells (spell objects not known yet, castable by this class),
 * cantripNeed, spellNeed, schools, offSchoolLeft } — the same for the level-up helper and the server's check.
 */
export function levelUpPools(char, plan, srd, subclass = null) {
  const path = plan.subclassChoice ? subclass : characterClasses(char).find((c) => c.class === plan.classKey)?.subclass ?? null;
  const opts = spellOptions(plan.classKey, plan.classLevel, srd, { abilities: char.abilities, subclass: path, landType: landTypeOf(char.features) });
  const sc = char.spellcasting || {};
  // what this level's features give for free (an Arcane Trickster's mage hand) isn't offered as a pick
  const cls = get(srd, "classes", plan.classKey);
  const sub = subclassOf(srd, plan.classKey, path);
  const gained = [...(cls?.levels?.[plan.classLevel - 1]?.features || []), ...((sub?.features || []).filter((f) => (plan.subclassChoice ? f.level <= plan.classLevel : f.level === plan.classLevel)))];
  const free = gained.flatMap((f) => [...(f.grants?.cantrips || []), ...(f.grants?.spells || [])]);
  const known = new Set([...(sc.cantrips || []), ...(sc.known || []), ...(sc.prepared || []), ...(opts.alwaysPrepared || []), ...free]);
  const maxSpell = plan.classMaxSpellLevel || plan.maxSpellLevel;
  const cantrips = (opts.cantrips || []).filter((s) => !known.has(s.index));
  const spells = (opts.spells || []).filter((s) => !known.has(s.index) && s.level <= maxSpell);
  const cast = castFor(plan.classKey, path, srd);
  // spells from outside a school-bound caster's schools: how many more it may learn
  const listed = new Set(learnableSpells(plan.classKey, path, srd).map((s) => s.index));
  const offUsed = (sc.known || []).filter((i) => listed.has(i) && !inSchools(cast, get(srd, "spells", i))).length;
  return {
    cantrips, spells,
    cantripNeed: Math.min(plan.cantripsToPick || 0, cantrips.length),
    spellNeed: Math.min(plan.spellsToPick || 0, spells.length),
    schools: cast?.schools || null,
    offSchoolLeft: cast?.schools ? Math.max(0, offSchoolAllowed(cast, plan.classLevel) - offUsed) : Infinity,
  };
}

/**
 * Everything a level-up still needs before it can happen: every choice is the player's to make, none is filled in
 * for them. -> ["your path", "Fighting Style", "2 more spells", ...] (empty = ready). `choices` as for applyLevelUp.
 */
export function levelUpProblems(char, choices = {}, srd = {}) {
  const plan = levelUpPlan(char, srd, choices.class, { subclass: choices.subclass });
  if (plan.maxed) return [];
  const out = [];
  const sub = plan.subclassChoice ? plan.subclassOptions.find((s) => s.index === choices.subclass) : null;
  if (plan.subclassChoice && !sub) out.push("your path");
  for (const fc of [...(plan.featureChoices || []), ...(sub?.featureChoices || [])]) {
    const valid = new Set(fc.options.map((o) => o.index));
    const picks = uniq(asArray(choices.featureOptions?.[fc.index])).filter((x) => valid.has(x));
    if (picks.length < Math.min(fc.choose, fc.options.length)) out.push(fc.name);
  }
  if (plan.asi) {
    const a = choices.asi && typeof choices.asi === "object" && !Array.isArray(choices.asi) ? choices.asi : {};
    const vals = Object.entries(a).filter(([k]) => ABILITIES.includes(k)).map(([, v]) => Number(v));
    const ok = vals.reduce((x, y) => x + y, 0) === 2 && vals.every((v) => v === 1 || v === 2);
    if (!ok) out.push("your ability score improvement");
  }
  const has = (s) => Number(char.skillProfs?.[s]) > 0 || char.skillProfs?.[s] === true;
  const skillPool = plan.multiclassSkills ? plan.multiclassSkills.from.filter((s) => !has(s))
    : plan.skillsToPick && (plan.subclassChoice ? choices.subclass === "lore" : true) ? Object.keys(SKILLS).filter((s) => !has(s)) : [];
  const skillNeed = Math.min(plan.multiclassSkills ? plan.multiclassSkills.choose : skillPool.length ? plan.skillsToPick : 0, skillPool.length);
  const skillPicks = uniq(asArray(choices.skills)).filter((s) => skillPool.includes(s));
  if (skillPicks.length < skillNeed) out.push(`${skillNeed - skillPicks.length} more skill${skillNeed - skillPicks.length === 1 ? "" : "s"}`);
  const expertPool = Object.keys(char.skillProfs || {}).filter((s) => Number(char.skillProfs[s]) === 1 || char.skillProfs[s] === true);
  const expertNeed = Math.min(plan.expertiseToPick || 0, expertPool.length);
  const expertPicks = uniq(asArray(choices.expertise)).filter((s) => expertPool.includes(s));
  if (expertPicks.length < expertNeed) out.push(`${expertNeed - expertPicks.length} more expertise`);
  const pools = levelUpPools(char, plan, srd, choices.subclass);
  const cPicks = uniq(asArray(choices.cantrips)).filter((s) => pools.cantrips.some((x) => x.index === s));
  if (cPicks.length < pools.cantripNeed) out.push(`${pools.cantripNeed - cPicks.length} more cantrip${pools.cantripNeed - cPicks.length === 1 ? "" : "s"}`);
  const sPicks = uniq(asArray(choices.spells)).filter((s) => pools.spells.some((x) => x.index === s));
  if (sPicks.length < pools.spellNeed) out.push(`${pools.spellNeed - sPicks.length} more spell${pools.spellNeed - sPicks.length === 1 ? "" : "s"}`);
  if (pools.schools) {
    const off = sPicks.filter((i) => !pools.schools.includes(String(get(srd, "spells", i)?.school || "").toLowerCase())).length;
    if (off > pools.offSchoolLeft) out.push(`spells from your schools (only ${pools.offSchoolLeft} may come from another school)`);
  }
  return out;
}

/** Apply a level-up. choices: { class?, hp?, hpMethod?, asi?, subclass?, cantrips?, spells?, expertise?, skills?,
 *  fightingStyle?, featureOptions?, favoredEnemy?, favoredTerrain?, tools? }. Returns a new character. */
export function applyLevelUp(char, choices = {}, srd = {}) {
  const c = clone(char);
  const plan = levelUpPlan(c, srd, choices.class, { subclass: choices.subclass });
  if (plan.maxed) return c;
  const cls = get(srd, "classes", plan.classKey);
  const oldLevel = totalLevel(c);
  const oldCon = abilityMod(c.abilities?.con ?? 10);
  let classes = characterClasses(c);

  // classes / subclass
  let entry = classes.find((x) => x.class === plan.classKey);
  if (entry) entry.level = plan.classLevel;
  else {
    entry = { class: plan.classKey, subclass: null, level: 1 };
    classes.push(entry);
    const mc = cls.multiclass || {};
    c.otherProfs = c.otherProfs || { armor: [], weapons: [], tools: [], languages: [] };
    for (const k of ["armor", "weapons", "tools"]) c.otherProfs[k] = uniq([...(c.otherProfs[k] || []), ...(mc.proficiencies?.[k] || [])]);
    if (mc.skillChoices) {
      c.skillProfs = c.skillProfs || {};
      const pick = fillFrom(mc.skillChoices.from, asArray(choices.skills), mc.skillChoices.choose, new Set(Object.keys(c.skillProfs)));
      for (const s of pick) c.skillProfs[s] = 1;
    }
  }
  let newSubclass = false;
  if (plan.subclassChoice) {
    const sc = cls.subclasses?.find((s) => s.index === choices.subclass) || cls.subclasses?.[0];
    if (sc) { entry.subclass = sc.index; newSubclass = true; }
  }
  c.classes = classes;
  c.level = totalLevel(c);
  c.class = classes[0].class;
  c.subclass = classes[0].subclass ?? null;

  // ASI
  if (plan.asi) applyAsi(c.abilities, choices.asi, plan.classKey);
  const newCon = abilityMod(c.abilities?.con ?? 10);

  // HP
  const die = plan.hpDie;
  let roll = Math.floor(die / 2) + 1;
  if (choices.hpMethod === "max") roll = die;
  if (Number(choices.hp) >= 1) roll = Math.min(die, Math.round(Number(choices.hp)));
  let gain = Math.max(1, roll + newCon) + (newCon - oldCon) * oldLevel;
  const race = get(srd, "races", c.race);
  const sub = race?.subraces?.find((s) => s.index === c.subrace);
  if (sub?.hpPerLevel) gain += sub.hpPerLevel;
  if (plan.classKey === "sorcerer" && entry.subclass === "draconic") gain += newSubclass ? plan.classLevel : 1;
  c.hp = c.hp || { max: 0, current: 0, temp: 0 };
  c.hp.max = (Number(c.hp.max) || 0) + gain;
  c.hp.current = Math.min(c.hp.max, (Number(c.hp.current) || 0) + gain);
  c.hitDice = { die: c.hitDice?.die ?? get(srd, "classes", classes[0].class)?.hitDie ?? die, total: c.level, used: Math.min(c.hitDice?.used || 0, c.level) };

  // features (and what they grant: proficiencies, skills, languages, cantrips, spells)
  c.features = c.features || [];
  const fctx = { srd, have: haveOf(char), grants: [], maxSpellLevel: plan.maxSpellLevel,
    invocationsKnown: (cls.levels?.[plan.classLevel - 1]?.specific?.invocationsKnown ?? 0) - (cls.levels?.[plan.classLevel - 2]?.specific?.invocationsKnown ?? 0) || null };
  const newFeats = classFeaturesAt(cls, entry.subclass, plan.classLevel, choices, { ...fctx, classLevel: plan.classLevel });
  if (newSubclass) {
    for (let l = 1; l < plan.classLevel; l++) newFeats.push(...classFeaturesAt({ ...cls, levels: [] }, entry.subclass, l, choices, { ...fctx, classLevel: l }));
  }
  for (const f of newFeats) c.features.push({ ...f });
  if (newSubclass && entry.subclass === "life") c.otherProfs = { ...c.otherProfs, armor: uniq([...(c.otherProfs?.armor || []), "Heavy Armor"]) };

  // skills: expertise, lore bonus proficiencies
  c.skillProfs = c.skillProfs || {};
  if (plan.expertiseToPick) {
    const pool = Object.keys(c.skillProfs).filter((s) => c.skillProfs[s] === 1);
    const pick = fillFrom(pool, asArray(choices.expertise), plan.expertiseToPick, new Set());
    for (const s of pick) c.skillProfs[s] = 2;
  }
  if (plan.classKey === "bard" && plan.classLevel === 3 && entry.subclass === "lore") {
    const pick = fillFrom(Object.keys(SKILLS), asArray(choices.skills), 3, new Set(Object.keys(c.skillProfs)));
    for (const s of pick) c.skillProfs[s] = 1;
  }

  // spellcasting
  const cast = castFor(plan.classKey, entry.subclass, srd);
  const granted = { cantrips: fctx.grants.flatMap((g) => g.cantrips || []), spells: fctx.grants.flatMap((g) => g.spells || []) };
  if (cast && plan.classLevel >= cast.from) {
    c.spellcasting = c.spellcasting || { ability: cast.ability, cantrips: [], known: [], prepared: [], slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0 };
    const sc = c.spellcasting;
    if (!sc.ability || (sc.innate?.length && !sc.known?.length && !sc.prepared?.length)) sc.ability = cast.ability;
    sc.cantrips = sc.cantrips || [];
    sc.known = sc.known || [];
    sc.prepared = sc.prepared || [];
    const list = learnableSpells(plan.classKey, entry.subclass, srd);
    const validC = list.filter((s) => s.level === 0).map((s) => s.index);
    // a class learns spells of levels it could cast on its own (multiclass rule)
    const classMax = maxSpellLevelAt(plan.classKey, plan.classLevel, srd, entry.subclass);
    const validS = list.filter((s) => s.level >= 1 && s.level <= classMax).map((s) => s.index);
    const mod = abilityMod(c.abilities?.[cast.ability] ?? 10);
    const sub2 = cls.subclasses?.find((s) => s.index === entry.subclass);
    const always = alwaysPreparedFor(plan.classKey, sub2, plan.classLevel, landTypeOf(c.features, choices));
    // defaults for new picks: best spells of the highest available level first
    const rank = (idx) => {
      const sp = get(srd, "spells", idx);
      return -(sp?.level ?? 0) * 1000 + prefRank(idx);
    };
    const best = (valid, wanted, n, have) => fillFrom(valid, [...wanted, ...valid.slice().sort((a, b) => rank(a) - rank(b))], n, new Set(have));
    const newC = best(validC, asArray(choices.cantrips), plan.cantripsToPick, [...sc.cantrips, ...granted.cantrips]);
    sc.cantrips.push(...newC);
    if (cast.mode === "prepared") {
      const max = spellCountAt(plan.classKey, plan.classLevel, srd, mod, entry.subclass);
      // spells a feature gave earlier (Moon's alter self...) stay always prepared, beside the subclass's own list
      const keep = (sc.alwaysPrepared || []).filter((s) => !always.includes(s));
      const current = sc.prepared.filter((s) => !always.includes(s) && !keep.includes(s));
      const want = asArray(choices.spells);
      const add = best(validS, want, Math.max(0, max - current.length), [...current, ...always, ...keep, ...granted.spells]);
      sc.prepared = uniq([...always, ...keep, ...current, ...add]);
      sc.known = sc.prepared.slice();
      if (always.length || keep.length) sc.alwaysPrepared = uniq([...always, ...keep]);
    } else {
      const add = best(validS, asArray(choices.spells), plan.spellsToPick, [...sc.known, ...always, ...granted.spells]);
      sc.known.push(...add);
      if (cast.mode === "spellbook") {
        const prepMax = Math.max(1, mod + plan.classLevel);
        sc.prepared = fillFrom(sc.known, [...asArray(choices.prepared), ...sc.prepared, ...add], prepMax, new Set());
      } else {
        sc.prepared = uniq([...sc.prepared, ...add]);
      }
    }
    while (sc.slotsUsed.length < 9) sc.slotsUsed.push(0);
  }
  applyGrants(c, fctx.grants, cast);
  // racial innate spells unlocked by total level (tiefling)
  if (c.race === "tiefling" && c.spellcasting) {
    const inn = (c.spellcasting.innate = c.spellcasting.innate || []);
    if (c.level >= 3 && !inn.some((i) => i.spell === "hellish-rebuke")) inn.push({ spell: "hellish-rebuke", ability: "cha", source: "Infernal Legacy", level: 2, uses: "1/long rest", resource: "hellishRebuke" });
    if (c.level >= 5 && !inn.some((i) => i.spell === "darkness")) inn.push({ spell: "darkness", ability: "cha", source: "Infernal Legacy", level: 2, uses: "1/long rest", resource: "darkness" });
  }

  // resources
  c.resources = c.resources || {};
  for (const r of plan.resources) if (r.max != null && !c.resources[r.key]) c.resources[r.key] = { used: 0 };
  if (c.race === "tiefling" && c.level >= 3 && !c.resources.hellishRebuke) c.resources.hellishRebuke = { used: 0 };
  if (c.race === "tiefling" && c.level >= 5 && !c.resources.darkness) c.resources.darkness = { used: 0 };
  return c;
}
