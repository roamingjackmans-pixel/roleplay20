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
  ABILITIES, SKILLS, abilityMod, profBonus, byIndex, classResources, spellSlots, normName, CLASS_CASTING,
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
function classSpellList(srd, classKey) {
  return (srd?.spells ? [...byIndex(srd.spells).values()] : []).filter((s) => (s.classes || []).includes(classKey));
}
function maxSpellLevelAt(classKey, level, srd) {
  const { slots, pact } = spellSlots([{ class: classKey, level }], srd);
  let m = 0;
  slots.forEach((n, i) => n > 0 && (m = i + 1));
  if (pact) m = Math.max(m, pact.level);
  return m;
}
function classRow(srd, classKey, level) {
  return get(srd, "classes", classKey)?.levels?.[Math.max(1, Math.min(20, level)) - 1] ?? null;
}
function spellCountAt(classKey, level, srd, mod = 0) {
  const cast = CLASS_CASTING[classKey];
  if (!cast || level < cast.from) return 0;
  const row = classRow(srd, classKey, level);
  if (cast.mode === "known" || cast.mode === "pact") return row?.spellsKnown ?? 0;
  if (cast.mode === "spellbook") return 6 + 2 * (level - 1);
  if (cast.prepared === "half") return Math.max(1, mod + Math.floor(level / 2));
  return Math.max(1, mod + level);
}

/**
 * Default spell picks (best-first, spread over levels as if chosen while levelling up).
 * -> { cantrips: [index], spells: [index] }
 */
export function defaultSpellPicks(classKey, level, srd, { mod = 0, exclude = [] } = {}) {
  const list = classSpellList(srd, classKey);
  const taken = new Set(exclude);
  const best = (lvl) => list.filter((s) => s.level === lvl && !taken.has(s.index)).sort((a, b) => prefRank(a.index) - prefRank(b.index) || a.name.localeCompare(b.name));
  const row = classRow(srd, classKey, level);
  const cantrips = best(0).slice(0, row?.cantrips ?? 0).map((s) => s.index);
  cantrips.forEach((c) => taken.add(c));
  const spells = [];
  let prev = 0;
  for (let l = 1; l <= level; l++) {
    const want = spellCountAt(classKey, l, srd, mod) - prev;
    prev += Math.max(0, want);
    const top = maxSpellLevelAt(classKey, l, srd);
    for (let n = 0; n < want; n++) {
      let pick = null;
      for (let sl = top; sl >= 1 && !pick; sl--) pick = best(sl)[0];
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
  const cast = CLASS_CASTING[classKey] || null;
  const lvl = Math.max(1, Math.min(20, Number(level) || 1));
  const empty = { cantripsToPick: 0, spellsToPick: 0, cantrips: [], spells: [], mode: cast?.mode ?? null, maxSpellLevel: 0, alwaysPrepared: [] };
  if (!cast || lvl < cast.from) return empty;
  const row = classRow(srd, classKey, lvl);
  const mod = opts.abilities ? abilityMod(opts.abilities[cast.ability] ?? 10) : 0;
  const maxSpellLevel = maxSpellLevelAt(classKey, lvl, srd);
  const list = classSpellList(srd, classKey).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const sub = opts.subclass ? get(srd, "classes", classKey)?.subclasses?.find((s) => s.index === opts.subclass) : null;
  return {
    cantripsToPick: row?.cantrips ?? 0,
    spellsToPick: spellCountAt(classKey, lvl, srd, mod),
    cantrips: list.filter((s) => s.level === 0),
    spells: list.filter((s) => s.level >= 1 && s.level <= maxSpellLevel),
    mode: cast.mode,
    maxSpellLevel,
    alwaysPrepared: alwaysPreparedFor(classKey, sub, lvl, opts.landType),
  };
}

function alwaysPreparedFor(classKey, sub, classLevel, landType) {
  if (!sub || !["cleric", "paladin", "druid"].includes(classKey)) return [];
  return (sub.spells || [])
    .filter((s) => s.level <= classLevel && (!s.requires || s.requires === `circle-of-the-land-${landType || "forest"}`))
    .map((s) => s.index);
}

// ─── features ──────────────────────────────────────────────────────────────────────────────
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

/** Feature entries a class (and subclass) gives at exactly `classLevel`. */
function classFeaturesAt(cls, subclass, classLevel, choices, ctx = {}) {
  const out = [];
  const row = cls.levels?.[classLevel - 1];
  const source = cls.name;
  const push = (f, src, kind) => {
    if (f.placeholder || /^Ability Score Improvement$/i.test(f.name)) return;
    let desc = f.desc || "";
    if (f.stringOptions) {
      const key = /enemy/i.test(f.index) ? "favoredEnemy" : "favoredTerrain";
      const pick = asArray(choices?.[key] ?? choices?.featureOptions?.[f.index]).filter((x) => f.stringOptions.from.includes(x));
      const chosen = (pick.length ? pick : f.stringOptions.from.slice(0, 1)).slice(0, f.stringOptions.choose);
      desc += `\nChosen: ${chosen.join(", ")}`;
    }
    if (f.options?.length) {
      const extra = FIGHTING_STYLE.test(f.index) ? [choices?.fightingStyle || "defense"]
        : f.index === "dragon-ancestor" ? [choices?.dragonAncestor || choices?.draconicAncestry]
        : f.index === "circle-of-the-land" ? [choices?.landType || "forest"] : [];
      let n = f.choose;
      if (n == null && ctx.invocationsKnown != null) n = ctx.invocationsKnown;
      const picks = pickOptions({ ...f, choose: n ?? 1 }, choices, extra);
      out.push({ name: f.name, source: src, level: classLevel, desc, kind, index: f.index });
      for (const p of picks) out.push({ name: p.name, source: src, level: classLevel, desc: p.desc, kind, index: p.index });
      return;
    }
    out.push({ name: f.name, source: src, level: classLevel, desc, kind, index: f.index });
  };
  for (const f of row?.features || []) push(f, source, "class");
  const sub = subclass ? cls.subclasses?.find((s) => s.index === subclass) : null;
  for (const f of sub?.features || []) if (f.level === classLevel) push(f, sub.name, "subclass");
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
  const toolChoicesIn = asArray(choices.tools);
  const tools = [...(cls.proficiencies?.tools || []), ...(race.proficiencies?.tools || []), ...(sub?.proficiencies?.tools || []), ...(bg?.tools || [])];
  const toolGroups = [
    ...(cls.toolChoices || []),
    ...[...(race.proficiencyChoices || []), ...(sub?.proficiencyChoices || [])].filter((p) => p.type === "tools"),
    ...(bg?.toolChoices || []),
  ];
  for (const g of toolGroups) tools.push(...fillFrom(g.from, toolChoicesIn, g.choose, new Set(tools)));

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
  const languages = [...(race.languages || [])];
  if (classKey === "druid") languages.push("Druidic");
  if (classKey === "rogue") languages.push("Thieves' Cant");
  const langWanted = asArray(choices.languages);
  for (const g of [race.languageChoices, sub?.languageChoices, bg?.languageChoices].filter(Boolean)) {
    languages.push(...fillFrom(languagePool(srd, g.from), langWanted, g.choose, new Set(languages)));
  }

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

  // features
  const ctxFor = (l) => ({ invocationsKnown: cls.levels?.[l - 1]?.specific?.invocationsKnown ?? null });
  const features = [...raceFeatures(race, sub, choices, srd)];
  for (let l = 1; l <= level; l++) features.push(...classFeaturesAt(cls, subclass?.index, l, choices, ctxFor(l)));
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
  (bg?.equipmentChoices || []).forEach((g, gi) => {
    const want = asArray(choices.backgroundEquipment)[gi];
    const found = g.from.find((f) => f.index === want || f.name === want) || g.from[0];
    if (found) bgItems.push({ ...found });
  });
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

  // spellcasting
  const spellcasting = buildSpellcasting(classKey, subclass, level, abilities, choices, race, sub, srd);

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
  return char;
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

function buildSpellcasting(classKey, subclass, level, abilities, choices, race, sub, srd) {
  const cast = CLASS_CASTING[classKey];
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
    const defaults = defaultSpellPicks(classKey, level, srd, { mod, exclude: always });
    const innateC = new Set(innate.filter((i) => i.level === 0).map((i) => i.spell));
    const cantrips = fillFrom([...validC], [...asArray(choices.cantrips).filter((c) => validC.has(c)), ...defaults.cantrips], opts.cantripsToPick, innateC);
    const chosen = asArray(choices.spells).filter((s) => validS.has(s) && !always.includes(s));
    const spells = fillFrom([...validS], [...chosen, ...(chosen.length ? [] : defaults.spells)], opts.spellsToPick, new Set(always));
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
export function levelUpPlan(char, srd, classKey) {
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
  const features = classFeaturesAt(cls, subclass, classLevel, {}, { invocationsKnown: row?.specific?.invocationsKnown ?? null });
  // feature choices (fighting style, metamagic, pact boon, invocations, hunter's prey, ...)
  const rowFeats = [...(row?.features || []), ...((cls.subclasses?.find((s) => s.index === subclass)?.features || []).filter((f) => f.level === classLevel))];
  const featureChoices = rowFeats.filter((f) => f.options?.length || f.stringOptions).map((f) => ({
    index: f.index, name: f.name,
    choose: f.options?.length ? f.choose ?? row?.specific?.invocationsKnown - (prev?.specific?.invocationsKnown || 0) : f.stringOptions.choose,
    options: f.options?.length ? f.options.map((o) => ({ index: o.index, name: o.name, desc: o.desc })) : f.stringOptions.from.map((s) => ({ index: s, name: s, desc: "" })),
  }));
  const cast = CLASS_CASTING[target];
  const mod = cast ? abilityMod(char.abilities?.[cast.ability] ?? 10) : 0;
  let cantripsToPick = 0;
  let spellsToPick = 0;
  if (cast && classLevel >= cast.from) {
    cantripsToPick = (row?.cantrips ?? 0) - (prev?.cantrips ?? 0);
    if (cast.mode === "known" || cast.mode === "pact") spellsToPick = (row?.spellsKnown ?? 0) - (prev?.spellsKnown ?? 0);
    else if (cast.mode === "spellbook") spellsToPick = classLevel === 1 ? 6 : 2;
    else spellsToPick = spellCountAt(target, classLevel, srd, mod) - (classLevel - 1 >= cast.from ? spellCountAt(target, classLevel - 1, srd, mod) : 0);
  }
  const newClasses = existing ? classes.map((c) => (c.class === target ? { ...c, level: classLevel } : c)) : [...classes, { class: target, subclass: null, level: 1 }];
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
    subclassOptions: subclassChoice ? (cls.subclasses || []).map((s) => ({ index: s.index, name: s.name, desc: s.desc,
      features: s.features.filter((f) => f.level <= classLevel).map((f) => ({ name: f.name, level: f.level, desc: f.desc })) })) : [],
    spellsToPick: Math.max(0, spellsToPick),
    cantripsToPick: Math.max(0, cantripsToPick),
    maxSpellLevel,
    classMaxSpellLevel: cast && classLevel >= cast.from ? maxSpellLevelAt(target, classLevel, srd) : 0,
    slots,
    pact,
    expertiseToPick: expertise,
    skillsToPick: target === "bard" && classLevel === 3 && (subclass === "lore" || subclassChoice) ? 3 : 0,
    resources: classResources(target, classLevel, { ...char, classes: newClasses }),
  };
}

/** Apply a level-up. choices: { class?, hp?, hpMethod?, asi?, subclass?, cantrips?, spells?, expertise?, skills?,
 *  fightingStyle?, featureOptions?, favoredEnemy?, favoredTerrain?, tools? }. Returns a new character. */
export function applyLevelUp(char, choices = {}, srd = {}) {
  const c = clone(char);
  const plan = levelUpPlan(c, srd, choices.class);
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

  // features
  c.features = c.features || [];
  const ctx = { invocationsKnown: (cls.levels?.[plan.classLevel - 1]?.specific?.invocationsKnown ?? 0) - (cls.levels?.[plan.classLevel - 2]?.specific?.invocationsKnown ?? 0) || null };
  const newFeats = classFeaturesAt(cls, entry.subclass, plan.classLevel, choices, ctx);
  if (newSubclass) {
    for (let l = 1; l < plan.classLevel; l++) newFeats.push(...classFeaturesAt({ ...cls, levels: [] }, entry.subclass, l, choices));
  }
  for (const f of newFeats) c.features.push({ ...f });
  if (newSubclass && entry.subclass === "life") c.otherProfs.armor = uniq([...(c.otherProfs.armor || []), "Heavy Armor"]);

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
  const cast = CLASS_CASTING[plan.classKey];
  if (cast && plan.classLevel >= cast.from) {
    c.spellcasting = c.spellcasting || { ability: cast.ability, cantrips: [], known: [], prepared: [], slotsUsed: [0, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0 };
    const sc = c.spellcasting;
    if (!sc.ability || (sc.innate?.length && !sc.known?.length && !sc.prepared?.length)) sc.ability = cast.ability;
    sc.cantrips = sc.cantrips || [];
    sc.known = sc.known || [];
    sc.prepared = sc.prepared || [];
    const list = classSpellList(srd, plan.classKey);
    const validC = list.filter((s) => s.level === 0).map((s) => s.index);
    // a class learns spells of levels it could cast on its own (multiclass rule)
    const classMax = maxSpellLevelAt(plan.classKey, plan.classLevel, srd);
    const validS = list.filter((s) => s.level >= 1 && s.level <= classMax).map((s) => s.index);
    const mod = abilityMod(c.abilities?.[cast.ability] ?? 10);
    const sub2 = cls.subclasses?.find((s) => s.index === entry.subclass);
    const always = alwaysPreparedFor(plan.classKey, sub2, plan.classLevel, choices.landType);
    // defaults for new picks: best spells of the highest available level first
    const rank = (idx) => {
      const sp = get(srd, "spells", idx);
      return -(sp?.level ?? 0) * 1000 + prefRank(idx);
    };
    const best = (valid, wanted, n, have) => fillFrom(valid, [...wanted, ...valid.slice().sort((a, b) => rank(a) - rank(b))], n, new Set(have));
    const newC = best(validC, asArray(choices.cantrips), plan.cantripsToPick, sc.cantrips);
    sc.cantrips.push(...newC);
    if (cast.mode === "prepared") {
      const max = spellCountAt(plan.classKey, plan.classLevel, srd, mod);
      const current = sc.prepared.filter((s) => !always.includes(s));
      const want = asArray(choices.spells);
      const add = best(validS, want, Math.max(0, max - current.length), [...current, ...always]);
      sc.prepared = uniq([...always, ...current, ...add]);
      sc.known = sc.prepared.slice();
      if (always.length) sc.alwaysPrepared = always.slice();
    } else {
      const add = best(validS, asArray(choices.spells), plan.spellsToPick, [...sc.known, ...always]);
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
