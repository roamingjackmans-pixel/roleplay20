// shared/rules.js — D&D 5e (SRD 5.1) derived stats: modifiers, saves, skills, AC, attacks, spellcasting,
// spell slots (single + multiclass + pact magic), class resources, monster helpers, XP.
// Pure ESM, no I/O: SRD data is passed in as `srd` ({ classes, races, equipment, spells, ... } arrays from
// shared/srd/*.json). Everything degrades gracefully when parts of `srd` are missing.
//
// Contract (docs/CONTRACTS.md): abilityMod, profBonus, SKILLS, SKILL_NAMES, ABILITIES, CONDITIONS,
// deriveCharacter, classResources, spellSlots, spellDamage, spellHealing, monsterSaveBonus, monsterSkillBonus,
// monsterInitiative, xpForLevel, levelForXp.
// Extras: byIndex, ABILITY_NAMES, CONDITION_NAMES, CLASS_CASTING, MULTICLASS_SLOTS, PACT_SLOTS, XP_THRESHOLDS,
// XP_BY_CR, crToXp, encounterDifficulty, normName, characterClasses, totalLevel, lookupEquipment,
// isProficientWithWeapon, magicBonus, casterLevel, ASI_LEVELS, asiLevelsFor, hasJackOfAllTrades.

// ─── constants ─────────────────────────────────────────────────────────────────────────────
export const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];
export const ABILITY_NAMES = {
  str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma",
};
export const SKILLS = {
  acrobatics: "dex", animalHandling: "wis", arcana: "int", athletics: "str", deception: "cha", history: "int",
  insight: "wis", intimidation: "cha", investigation: "int", medicine: "wis", nature: "int", perception: "wis",
  performance: "cha", persuasion: "cha", religion: "int", sleightOfHand: "dex", stealth: "dex", survival: "wis",
};
export const SKILL_NAMES = {
  acrobatics: "Acrobatics", animalHandling: "Animal Handling", arcana: "Arcana", athletics: "Athletics",
  deception: "Deception", history: "History", insight: "Insight", intimidation: "Intimidation",
  investigation: "Investigation", medicine: "Medicine", nature: "Nature", perception: "Perception",
  performance: "Performance", persuasion: "Persuasion", religion: "Religion", sleightOfHand: "Sleight of Hand",
  stealth: "Stealth", survival: "Survival",
};
/** The 14 standard conditions (exhaustion is tracked separately as char.exhaustion 0-6). */
export const CONDITIONS = [
  "blinded", "charmed", "deafened", "frightened", "grappled", "incapacitated", "invisible",
  "paralyzed", "petrified", "poisoned", "prone", "restrained", "stunned", "unconscious",
];
export const CONDITION_NAMES = Object.fromEntries(CONDITIONS.map((c) => [c, c[0].toUpperCase() + c.slice(1)]));

/** Spellcasting metadata per SRD class. type: full | half | third | pact; mode as in the contract. */
export const CLASS_CASTING = {
  bard: { type: "full", mode: "known", ability: "cha", from: 1 },
  cleric: { type: "full", mode: "prepared", ability: "wis", from: 1, prepared: "level" },
  druid: { type: "full", mode: "prepared", ability: "wis", from: 1, prepared: "level" },
  paladin: { type: "half", mode: "prepared", ability: "cha", from: 2, prepared: "half" },
  ranger: { type: "half", mode: "known", ability: "wis", from: 2 },
  sorcerer: { type: "full", mode: "known", ability: "cha", from: 1 },
  warlock: { type: "pact", mode: "pact", ability: "cha", from: 1 },
  wizard: { type: "full", mode: "spellbook", ability: "int", from: 1, prepared: "level" },
};

/** Multiclass spellcaster table (PHB/SRD): row = caster level 1..20, 9 slot levels. */
export const MULTICLASS_SLOTS = [
  [2, 0, 0, 0, 0, 0, 0, 0, 0], [3, 0, 0, 0, 0, 0, 0, 0, 0], [4, 2, 0, 0, 0, 0, 0, 0, 0], [4, 3, 0, 0, 0, 0, 0, 0, 0],
  [4, 3, 2, 0, 0, 0, 0, 0, 0], [4, 3, 3, 0, 0, 0, 0, 0, 0], [4, 3, 3, 1, 0, 0, 0, 0, 0], [4, 3, 3, 2, 0, 0, 0, 0, 0],
  [4, 3, 3, 3, 1, 0, 0, 0, 0], [4, 3, 3, 3, 2, 0, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0], [4, 3, 3, 3, 2, 1, 0, 0, 0],
  [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 0, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0], [4, 3, 3, 3, 2, 1, 1, 1, 0],
  [4, 3, 3, 3, 2, 1, 1, 1, 1], [4, 3, 3, 3, 3, 1, 1, 1, 1], [4, 3, 3, 3, 3, 2, 1, 1, 1], [4, 3, 3, 3, 3, 2, 2, 1, 1],
];
/** Warlock Pact Magic by warlock level: { slots, level }. */
export const PACT_SLOTS = [
  { slots: 1, level: 1 }, { slots: 2, level: 1 }, { slots: 2, level: 2 }, { slots: 2, level: 2 }, { slots: 2, level: 3 },
  { slots: 2, level: 3 }, { slots: 2, level: 4 }, { slots: 2, level: 4 }, { slots: 2, level: 5 }, { slots: 2, level: 5 },
  { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 }, { slots: 3, level: 5 },
  { slots: 3, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 }, { slots: 4, level: 5 },
];
// Fallback tables (used only when srd.classes is missing).
const CANTRIPS = {
  bard: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4], cleric: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5], druid: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4],
  sorcerer: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6], warlock: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4], wizard: [3, 3, 3, 4, 4, 4, 4, 4, 4, 5],
};
const SPELLS_KNOWN = {
  bard: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22],
  sorcerer: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15],
  ranger: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11],
  warlock: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15],
};
export const ASI_LEVELS = {
  fighter: [4, 6, 8, 12, 14, 16, 19], rogue: [4, 8, 10, 12, 16, 19], default: [4, 8, 12, 16, 19],
};
export const asiLevelsFor = (classKey) => ASI_LEVELS[classKey] || ASI_LEVELS.default;

export const XP_THRESHOLDS = [0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000,
  120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000];
export const XP_BY_CR = {
  0: 10, 0.125: 25, 0.25: 50, 0.5: 100, 1: 200, 2: 450, 3: 700, 4: 1100, 5: 1800, 6: 2300, 7: 2900, 8: 3900,
  9: 5000, 10: 5900, 11: 7200, 12: 8400, 13: 10000, 14: 11500, 15: 13000, 16: 15000, 17: 18000, 18: 20000,
  19: 22000, 20: 25000, 21: 33000, 22: 41000, 23: 50000, 24: 62000, 25: 75000, 26: 90000, 27: 105000,
  28: 120000, 29: 135000, 30: 155000,
};
// Per-character XP thresholds by level: [easy, medium, hard, deadly] (DMG).
const ENCOUNTER_THRESHOLDS = [
  [25, 50, 75, 100], [50, 100, 150, 200], [75, 150, 225, 400], [125, 250, 375, 500], [250, 500, 750, 1100],
  [300, 600, 900, 1400], [350, 750, 1100, 1700], [450, 900, 1400, 2100], [550, 1100, 1600, 2400], [600, 1200, 1900, 2800],
  [800, 1600, 2400, 3600], [1000, 2000, 3000, 4500], [1100, 2200, 3400, 5100], [1250, 2500, 3800, 5700],
  [1400, 2800, 4300, 6400], [1600, 3200, 4800, 7200], [2000, 3900, 5900, 8800], [2100, 4200, 6300, 9500],
  [2400, 4900, 7300, 10900], [2800, 5700, 8500, 12700],
];

// ─── small helpers ─────────────────────────────────────────────────────────────────────────
export const abilityMod = (score) => Math.floor(((Number(score) || 10) - 10) / 2);
export const profBonus = (totalLevel) => 2 + Math.floor((Math.max(1, Math.min(20, Number(totalLevel) || 1)) - 1) / 4);
const fmt = (n) => (n > 0 ? `+${n}` : n < 0 ? `${n}` : "");
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

const _cache = new WeakMap();
/** Build (and cache) a Map index -> entry from an SRD array. Accepts arrays, Maps or plain objects. */
export function byIndex(list) {
  if (!list) return new Map();
  if (list instanceof Map) return list;
  if (typeof list !== "object") return new Map();
  let m = _cache.get(list);
  if (!m) {
    m = Array.isArray(list) ? new Map(list.filter(Boolean).map((x) => [x.index ?? x.key, x])) : new Map(Object.entries(list));
    _cache.set(list, m);
  }
  return m;
}
const get = (srd, coll, idx) => (idx == null ? undefined : byIndex(srd?.[coll]).get(idx));

/** Normalise a proficiency / item name for lenient matching ("Crossbows, light" == "Light Crossbow"). */
export function normName(s) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\+\d+/g, " ")
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .sort()
    .join(" ");
}
const _nameCache = new WeakMap();
function equipmentByName(srd) {
  const list = srd?.equipment;
  if (!list || typeof list !== "object") return new Map();
  let m = _nameCache.get(list);
  if (!m) {
    m = new Map();
    for (const e of Array.isArray(list) ? list : list.values?.() ?? Object.values(list)) m.set(normName(e.name), e);
    _nameCache.set(list, m);
  }
  return m;
}
/** Find the SRD equipment entry for a character item (by index, else by name). */
export function lookupEquipment(item, srd) {
  if (!item) return null;
  return get(srd, "equipment", item.index) || equipmentByName(srd).get(normName(item.name)) || null;
}
/** Magic +N bonus of an item: item.bonus, or "+1" in its name. */
export function magicBonus(item) {
  if (item && Number.isFinite(Number(item.bonus)) && item.bonus !== null && item.bonus !== "") return Number(item.bonus);
  const m = String(item?.name ?? "").match(/\+(\d)\b/);
  return m ? Number(m[1]) : 0;
}

/** Normalised class list: [{ class, subclass, level }]. */
export function characterClasses(char) {
  if (Array.isArray(char?.classes) && char.classes.length) {
    return char.classes.filter((c) => c && c.class).map((c) => ({ class: c.class, subclass: c.subclass ?? null, level: Math.max(1, Number(c.level) || 1) }));
  }
  if (char?.class) return [{ class: char.class, subclass: char.subclass ?? null, level: Math.max(1, Number(char.level) || 1) }];
  return [];
}
export const totalLevel = (char) => characterClasses(char).reduce((a, c) => a + c.level, 0) || Math.max(1, Number(char?.level) || 1);
const classLevelOf = (classes, key) => classes.filter((c) => c.class === key).reduce((a, c) => a + c.level, 0);
const subclassOf = (classes, key) => classes.find((c) => c.class === key)?.subclass ?? null;
function levelRow(srd, classKey, level) {
  const cls = get(srd, "classes", classKey);
  return cls?.levels?.[clamp(level, 1, 20) - 1] ?? null;
}
const featureNames = (char) => new Set((char?.features || []).map((f) => String(f?.name ?? "").toLowerCase()));
const hasFeature = (names, name) => names.has(name.toLowerCase());

export function hasJackOfAllTrades(char) {
  return classLevelOf(characterClasses(char), "bard") >= 2;
}

// ─── spell slots ───────────────────────────────────────────────────────────────────────────
function castingFor(classKey, subclass, srd) {
  if (CLASS_CASTING[classKey]) return CLASS_CASTING[classKey];
  const sc = get(srd, "classes", classKey)?.spellcasting;
  if (sc) return { type: sc.type || "full", mode: sc.mode || "prepared", ability: sc.ability, from: sc.level || 1, prepared: sc.prepared };
  // third casters (Eldritch Knight / Arcane Trickster are not SRD, but support them if present)
  if (subclass === "eldritch-knight") return { type: "third", mode: "known", ability: "int", from: 3 };
  if (subclass === "arcane-trickster") return { type: "third", mode: "known", ability: "int", from: 3 };
  return null;
}

/** Caster level for the multiclass table (full + half/2 + third/3, rounded down per class). */
export function casterLevel(classes, srd) {
  let lvl = 0;
  for (const c of classes) {
    const cast = castingFor(c.class, c.subclass, srd);
    if (!cast) continue;
    if (cast.type === "full") lvl += c.level;
    else if (cast.type === "half") lvl += Math.floor(c.level / 2);
    else if (cast.type === "third") lvl += Math.floor(c.level / 3);
  }
  return lvl;
}

/**
 * Spell slots for a class list. One slot-casting class: its own table (half casters use ceil(level/2) of the
 * multiclass table, which reproduces the paladin/ranger tables). Several: the multiclass caster table.
 * Warlock Pact Magic is returned separately in `pact`.
 */
export function spellSlots(classes, srd) {
  const list = Array.isArray(classes) ? classes.map((c) => ({ class: c.class, subclass: c.subclass ?? null, level: Number(c.level) || 0 })) : characterClasses(classes);
  const slots = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  let pact = null;
  const casters = [];
  for (const c of list) {
    const cast = castingFor(c.class, c.subclass, srd);
    if (!cast) continue;
    if (cast.type === "pact") {
      const row = PACT_SLOTS[clamp(c.level, 1, 20) - 1];
      pact = { level: row.level, slots: row.slots };
    } else if (c.level >= (cast.from || 1)) {
      casters.push({ ...c, cast });
    }
  }
  let lvl = 0;
  if (casters.length === 1) {
    const c = casters[0];
    lvl = c.cast.type === "full" ? c.level : c.cast.type === "half" ? Math.ceil(c.level / 2) : Math.ceil(c.level / 3);
  } else if (casters.length > 1) {
    lvl = casterLevel(casters, srd);
  }
  if (lvl > 0) MULTICLASS_SLOTS[clamp(lvl, 1, 20) - 1].forEach((n, i) => (slots[i] = n));
  return { slots, pact };
}

// ─── spells ────────────────────────────────────────────────────────────────────────────────
function pickScaled(map, level) {
  if (!map) return null;
  const keys = Object.keys(map).map(Number).sort((a, b) => a - b);
  if (!keys.length) return null;
  let best = keys[0];
  for (const k of keys) if (k <= level) best = k;
  return map[best];
}
const withMod = (dice, mod) => (mod ? `${dice}${fmt(mod)}` : dice);

/** Damage dice for a spell at a slot level / caster level. { dice, type, addMod?, extra? } | null */
export function spellDamage(spell, { slotLevel, casterLevel: cl, mod } = {}) {
  const d = spell?.damage;
  if (!d) return null;
  const one = (e) => {
    const dice = e.atSlot ? pickScaled(e.atSlot, slotLevel ?? spell.level ?? 1) : pickScaled(e.atCharLevel, cl ?? 1);
    if (!dice) return null;
    const out = { dice: e.addMod && mod != null ? withMod(dice, mod) : dice, type: e.type };
    if (e.addMod) out.addMod = true;
    return out;
  };
  const main = one(d);
  if (!main) return null;
  const extra = (spell.extraDamage || []).map(one).filter(Boolean);
  if (extra.length) main.extra = extra;
  return main;
}

/** Healing dice for a spell at a slot level ("1d8"; the spellcasting modifier is added only if `mod` is given). */
export function spellHealing(spell, { slotLevel, mod } = {}) {
  const h = spell?.heal;
  if (!h?.atSlot) return null;
  const dice = pickScaled(h.atSlot, slotLevel ?? spell.level ?? 1);
  if (!dice) return null;
  return h.addMod && mod != null ? withMod(dice, mod) : dice;
}

// ─── class resources ───────────────────────────────────────────────────────────────────────
const rageCount = (l) => (l >= 20 ? Infinity : l >= 17 ? 6 : l >= 12 ? 5 : l >= 6 ? 4 : l >= 3 ? 3 : 2);
const rageDamage = (l) => (l >= 16 ? 4 : l >= 9 ? 3 : 2);
const bardDie = (l) => (l >= 15 ? 12 : l >= 10 ? 10 : l >= 5 ? 8 : 6);
const martialArtsDie = (l) => (l >= 17 ? 10 : l >= 11 ? 8 : l >= 5 ? 6 : 4);
const unarmoredMovement = (l) => (l >= 18 ? 30 : l >= 14 ? 25 : l >= 10 ? 20 : l >= 6 ? 15 : l >= 2 ? 10 : 0);

function charMods(char) {
  const a = char?.abilities || {};
  return Object.fromEntries(ABILITIES.map((k) => [k, abilityMod(a[k] ?? 10)]));
}

/**
 * Limited-use class features at a class level: [{ key, name, max, recharge, desc }].
 * max null = informational (no uses to track, e.g. Sneak Attack). recharge: "short" | "long" | "dawn" | null.
 */
export function classResources(classKey, classLevel, char = {}) {
  const l = Number(classLevel) || 0;
  const m = charMods(char);
  const prof = profBonus(totalLevel(char) || l);
  const subclass = characterClasses(char).find((c) => c.class === classKey)?.subclass ?? null;
  const out = [];
  const add = (key, name, max, recharge, desc) => out.push({ key, name, max, recharge, desc });
  switch (classKey) {
    case "barbarian": {
      const n = rageCount(l);
      add("rage", "Rage", Number.isFinite(n) ? n : null, "long",
        `Bonus action, 1 minute: +${rageDamage(l)} damage on Strength melee weapon attacks, advantage on Strength checks and saves, resistance to bludgeoning, piercing and slashing damage. Can't cast or concentrate on spells. ${Number.isFinite(n) ? `${n} per long rest.` : "Unlimited uses."}`);
      break;
    }
    case "bard": {
      const die = bardDie(l);
      add("bardicInspiration", `Bardic Inspiration (d${die})`, Math.max(1, m.cha), l >= 5 ? "short" : "long",
        `Bonus action: a creature within 60 ft that can hear you gains a d${die} to add to one ability check, attack roll or saving throw within 10 minutes.${l >= 5 ? " Font of Inspiration: regain all uses on a short or long rest." : ""}`);
      break;
    }
    case "cleric": {
      if (l >= 2) {
        const n = l >= 18 ? 3 : l >= 6 ? 2 : 1;
        const opts = ["Turn Undead"];
        if (subclass === "life") opts.push("Preserve Life (restore 5 x cleric level HP split among creatures within 30 ft, up to half their max)");
        add("channelDivinity", "Channel Divinity", n, "short", `Options: ${opts.join("; ")}. Turn Undead: undead within 30 ft make a Wisdom save (DC ${8 + prof + m.wis}) or are turned for 1 minute.`);
      }
      if (l >= 10) add("divineIntervention", "Divine Intervention", 1, "long", `Roll d100; if the roll is ${l >= 20 ? "anything (automatic at 20th level)" : `${l} or lower`}, your deity intervenes. On success, can't use again for 7 days.`);
      break;
    }
    case "druid": {
      if (l >= 2) {
        const cr = l >= 8 ? "1" : l >= 4 ? "1/2" : "1/4";
        const lim = l >= 8 ? "" : l >= 4 ? " (no flying speed)" : " (no flying or swimming speed)";
        add("wildShape", "Wild Shape", l >= 20 ? null : 2, "short", `Action: turn into a beast of CR ${cr} or lower${lim} for up to ${Math.floor(l / 2)} hours.${l >= 20 ? " Archdruid: unlimited uses." : ""}`);
      }
      break;
    }
    case "fighter": {
      add("secondWind", "Second Wind", 1, "short", `Bonus action: regain 1d10+${l} hit points.`);
      if (l >= 2) add("actionSurge", "Action Surge", l >= 17 ? 2 : 1, "short", "Take one additional action on your turn (once per turn).");
      if (l >= 9) add("indomitable", "Indomitable", l >= 17 ? 3 : l >= 13 ? 2 : 1, "long", "Reroll a failed saving throw; you must use the new roll.");
      break;
    }
    case "monk": {
      if (l >= 2) add("ki", "Ki Points", l, "short", `Flurry of Blows, Patient Defense, Step of the Wind (1 ki each)${l >= 5 ? ", Stunning Strike (1 ki)" : ""}. Ki save DC ${8 + prof + m.wis}. Martial Arts die d${martialArtsDie(l)}.`);
      break;
    }
    case "paladin": {
      add("divineSense", "Divine Sense", Math.max(1, 1 + m.cha), "long", "Action: until the end of your next turn, know the location of celestials, fiends and undead within 60 ft not behind total cover.");
      add("layOnHands", "Lay on Hands", 5 * l, "long", "Action: touch a creature to restore hit points from this pool, or spend 5 points to cure one disease or neutralize one poison.");
      if (l >= 3) {
        const opts = subclass === "devotion" || !subclass ? "Sacred Weapon (add CHA to attack rolls for 1 minute), Turn the Unholy" : "see your Sacred Oath";
        add("channelDivinity", "Channel Divinity", 1, "short", `Options: ${opts}. Save DC ${8 + prof + m.cha}.`);
      }
      break;
    }
    case "rogue": {
      add("sneakAttack", `Sneak Attack (${Math.ceil(l / 2)}d6)`, null, null,
        `Once per turn, deal an extra ${Math.ceil(l / 2)}d6 damage to one creature you hit with a finesse or ranged weapon attack if you have advantage, or an enemy of the target is within 5 ft of it and you don't have disadvantage.`);
      break;
    }
    case "sorcerer": {
      if (l >= 2) add("sorceryPoints", "Sorcery Points", l, "long", "Font of Magic: convert sorcery points into spell slots (1st 2, 2nd 3, 3rd 5, 4th 6, 5th 7 points) or slots into points (slot level). Fuel Metamagic from 3rd level.");
      break;
    }
    case "warlock": {
      const arc = [[11, 6], [13, 7], [15, 8], [17, 9]];
      for (const [lv, sl] of arc) if (l >= lv) add(`mysticArcanum${sl}`, `Mystic Arcanum (${sl}th level)`, 1, "long", `Cast your chosen ${sl}th-level warlock spell once without a spell slot.`);
      break;
    }
    case "wizard": {
      add("arcaneRecovery", "Arcane Recovery", 1, "long", `Once per day after a short rest, recover expended spell slots with a combined level of up to ${Math.ceil(l / 2)} (none of 6th level or higher).`);
      break;
    }
    default:
      break;
  }
  return out;
}

function racialResources(char, srd, mods, prof) {
  const out = [];
  const lvl = totalLevel(char);
  const race = char?.race;
  if (race === "dragonborn") {
    const names = (char.features || []).map((f) => f.name || "");
    let colour = char.draconicAncestry || (names.find((n) => /^Draconic Ancestry \(/.test(n)) || "").replace(/^Draconic Ancestry \((.+)\)$/, "$1");
    const anc = (get(srd, "races", "dragonborn")?.draconicAncestry || []).find(
      (a) => a.name.toLowerCase() === String(colour).toLowerCase() || a.index === colour
    );
    const dice = lvl >= 16 ? "5d6" : lvl >= 11 ? "4d6" : lvl >= 6 ? "3d6" : "2d6";
    const area = anc ? (anc.area.type === "line" ? `5 by ${anc.area.size} ft line` : `${anc.area.size} ft cone`) : "area set by your ancestry";
    const save = anc ? ABILITY_NAMES[anc.save] : "Dexterity or Constitution";
    out.push({ key: "breathWeapon", name: "Breath Weapon", max: 1, recharge: "short",
      desc: `Action: ${dice} ${anc ? anc.damageType : ""} damage in a ${area}; ${save} save DC ${8 + mods.con + prof}, half damage on a success.`.replace(/\s+/g, " ") });
  }
  if (race === "half-orc") {
    out.push({ key: "relentlessEndurance", name: "Relentless Endurance", max: 1, recharge: "long", desc: "When reduced to 0 hit points but not killed outright, drop to 1 hit point instead." });
  }
  if (race === "tiefling") {
    if (lvl >= 3) out.push({ key: "hellishRebuke", name: "Hellish Rebuke (Infernal Legacy)", max: 1, recharge: "long", desc: `Cast hellish rebuke as a 2nd-level spell (3d10 fire, Dex save DC ${8 + prof + mods.cha}) once per long rest.` });
    if (lvl >= 5) out.push({ key: "darkness", name: "Darkness (Infernal Legacy)", max: 1, recharge: "long", desc: "Cast darkness once per long rest. Charisma is your spellcasting ability." });
  }
  return out;
}

// ─── proficiency checks ────────────────────────────────────────────────────────────────────
function proficiencySet(char, srd, kind /* "weapons" | "armor" */) {
  const set = new Set((char?.otherProfs?.[kind] || []).map(normName));
  const classes = characterClasses(char);
  classes.forEach((c, i) => {
    const cls = get(srd, "classes", c.class);
    if (!cls) return;
    const list = i === 0 ? cls.proficiencies?.[kind] : cls.multiclass?.proficiencies?.[kind];
    for (const p of list || []) set.add(normName(p));
  });
  const race = get(srd, "races", char?.race);
  for (const p of race?.proficiencies?.[kind] || []) set.add(normName(p));
  const sub = race?.subraces?.find((s) => s.index === char?.subrace);
  for (const p of sub?.proficiencies?.[kind] || []) set.add(normName(p));
  return set;
}
/** Is the character proficient with this SRD weapon (category or specific weapon)? */
export function isProficientWithWeapon(char, weapon, srd, _set) {
  if (!weapon) return false;
  const set = _set || proficiencySet(char, srd, "weapons");
  if (weapon.category && set.has(normName(`${weapon.category} weapons`))) return true;
  return set.has(normName(weapon.name)) || set.has(normName(String(weapon.index || "").replace(/-/g, " ")));
}

// ─── deriveCharacter ───────────────────────────────────────────────────────────────────────
const SPEED_ZERO = new Set(["grappled", "restrained", "paralyzed", "petrified", "stunned", "unconscious"]);
const PROTECTION_ITEMS = new Set([normName("Ring of Protection"), normName("Cloak of Protection")]);

export function deriveCharacter(char, srd = {}) {
  char = char || {};
  const classes = characterClasses(char);
  const level = totalLevel(char);
  const prof = profBonus(level);
  const mods = charMods(char);
  const abilities = Object.fromEntries(ABILITIES.map((k) => [k, Number(char.abilities?.[k] ?? 10)]));
  const feats = featureNames(char);
  const lv = (k) => classLevelOf(classes, k);
  const conditions = new Set((char.conditions || []).map((c) => String(c).toLowerCase()));

  // magic items worn: Ring/Cloak of Protection (+1 AC and saves) when attuned
  let protection = 0;
  for (const it of char.equipment || []) {
    if (it && it.attuned && PROTECTION_ITEMS.has(normName(it.name))) protection += 1;
  }

  // saves
  const saveProfs = new Set(char.saveProfs || []);
  const saves = {};
  for (const a of ABILITIES) saves[a] = mods[a] + (saveProfs.has(a) ? prof : 0) + protection;

  // skills (expertise, Jack of All Trades, Remarkable Athlete)
  const jack = lv("bard") >= 2 ? Math.floor(prof / 2) : 0;
  const champion = classes.some((c) => c.class === "fighter" && c.subclass === "champion" && c.level >= 7);
  const athlete = champion ? Math.ceil(prof / 2) : 0;
  const physical = new Set(["str", "dex", "con"]);
  const skills = {};
  for (const [k, ab] of Object.entries(SKILLS)) {
    const raw = char.skillProfs?.[k];
    const p = raw === true ? 1 : Number(raw) || 0;
    let b = mods[ab];
    if (p >= 2) b += prof * 2;
    else if (p >= 1) b += prof;
    else b += Math.max(jack, physical.has(ab) ? athlete : 0);
    skills[k] = b;
  }
  const passive = { perception: 10 + skills.perception, investigation: 10 + skills.investigation, insight: 10 + skills.insight };
  const initiative = mods.dex + Math.max(jack, athlete);

  // equipment lookups
  const equipped = (char.equipment || []).filter((it) => it && it.equipped);
  let armor = null;
  let shield = null;
  for (const it of equipped) {
    const base = lookupEquipment(it, srd);
    if (!base || base.type !== "armor") continue;
    if (base.armorType === "shield") {
      if (!shield) shield = { it, base, bonus: magicBonus(it) };
      continue;
    }
    const dex = base.dexBonus ? (base.maxDex != null ? Math.min(mods.dex, base.maxDex) : mods.dex) : 0;
    const val = base.ac + dex + magicBonus(it);
    if (!armor || val > armor.value) armor = { it, base, bonus: magicBonus(it), value: val, dex };
  }

  // armor class
  let ac;
  let acNote;
  if (armor) {
    ac = armor.value;
    acNote = `${armor.it.name} ${armor.base.ac}${armor.dex ? ` + Dex ${armor.dex}` : ""}${armor.bonus ? ` + ${armor.bonus}` : ""}`;
  } else {
    const opts = [{ v: 10 + mods.dex, n: "Unarmored 10 + Dex" }];
    if (lv("barbarian") >= 1) opts.push({ v: 10 + mods.dex + mods.con, n: "Unarmored Defense 10 + Dex + Con" });
    if (lv("monk") >= 1 && !shield) opts.push({ v: 10 + mods.dex + mods.wis, n: "Unarmored Defense 10 + Dex + Wis" });
    if (classes.some((c) => c.class === "sorcerer" && c.subclass === "draconic")) opts.push({ v: 13 + mods.dex, n: "Draconic Resilience 13 + Dex" });
    if (char.mageArmor) opts.push({ v: 13 + mods.dex, n: "Mage Armor 13 + Dex" });
    const best = opts.reduce((a, b) => (b.v > a.v ? b : a));
    ac = best.v;
    acNote = best.n;
  }
  if (shield) {
    ac += 2 + shield.bonus;
    acNote += ` + ${shield.it.name} ${2 + shield.bonus}`;
  }
  if (armor && hasFeature(feats, "Fighting Style: Defense")) {
    ac += 1;
    acNote += " + Defense 1";
  }
  if (protection) {
    ac += protection;
    acNote += ` + Protection ${protection}`;
  }
  const acOverride = char.acOverride;
  if (acOverride !== null && acOverride !== undefined && acOverride !== "" && Number.isFinite(Number(acOverride))) {
    ac = Number(acOverride);
    acNote = "Override";
  }

  // speed
  const race = get(srd, "races", char.race);
  let baseSpeed = Number.isFinite(Number(char.speed)) && char.speed !== null && char.speed !== "" ? Number(char.speed) : race?.speed ?? 30;
  if (armor && armor.base.armorType === "heavy" && armor.base.strMin > abilities.str && char.race !== "dwarf") baseSpeed -= 10;
  const unarmored = !armor && !shield;
  if (lv("monk") >= 2 && unarmored) baseSpeed += unarmoredMovement(lv("monk"));
  if (lv("barbarian") >= 5 && !(armor && armor.base.armorType === "heavy")) baseSpeed += 10;
  let speed = baseSpeed;
  const exhaustion = Number(char.exhaustion) || 0;
  if (exhaustion >= 5 || [...conditions].some((c) => SPEED_ZERO.has(c))) speed = 0;
  else if (exhaustion >= 2) speed = Math.floor(speed / 2);

  // attacks
  const weaponProfs = proficiencySet(char, srd, "weapons");
  const monkLevel = lv("monk");
  const martialArts = monkLevel >= 1 && unarmored;
  const maDie = martialArtsDie(monkLevel);
  const archery = hasFeature(feats, "Fighting Style: Archery");
  const dueling = hasFeature(feats, "Fighting Style: Dueling");
  const champLvl = classes.filter((c) => c.class === "fighter" && c.subclass === "champion").reduce((a, c) => a + c.level, 0);
  const critRange = champLvl >= 15 ? 18 : champLvl >= 3 ? 19 : 20;
  const rogue = lv("rogue") >= 1;
  const dieSides = (d) => Number(String(d || "").match(/d(\d+)/)?.[1] || 0);
  const attacks = [];
  for (const it of equipped) {
    const w = lookupEquipment(it, srd);
    if (!w || w.type !== "weapon") continue;
    const props = w.properties || [];
    const ranged = w.range === "ranged";
    const bonusMagic = magicBonus(it);
    const monkWeapon = martialArts && !ranged && (props.includes("monk") || w.index === "shortsword" ||
      (w.category === "simple" && !props.includes("two-handed") && !props.includes("heavy")));
    let ab = "str";
    if (ranged) ab = "dex";
    else if (props.includes("finesse") || monkWeapon) ab = mods.dex > mods.str ? "dex" : "str";
    const proficient = isProficientWithWeapon(char, w, srd, weaponProfs);
    const bonus = mods[ab] + (proficient ? prof : 0) + bonusMagic + (archery && ranged ? 2 : 0);
    let die = w.damage;
    if (monkWeapon && die && dieSides(die) < maDie) die = `1d${maDie}`;
    const dmgMod = mods[ab] + bonusMagic + (dueling && !ranged && !props.includes("two-handed") ? 2 : 0);
    const a = {
      id: it.id ?? w.index,
      name: it.name || w.name,
      kind: ranged ? "ranged" : "melee",
      bonus,
      damage: die ? withMod(die, dmgMod) : "",
      damageType: w.damageType ?? null,
      rangeFt: ranged ? w.rangeFt ?? null : props.includes("thrown") ? w.throwFt ?? null : null,
      reachFt: ranged ? null : w.reachFt ?? 5,
      properties: props.slice(),
      itemId: it.id ?? null,
      ability: ab,
      proficient,
      critRange,
    };
    if (w.versatile) a.versatile = withMod(w.versatile, mods[ab] + bonusMagic);
    if (rogue && (ranged || props.includes("finesse"))) a.sneakAttack = true;
    if (w.special) a.special = w.special;
    attacks.push(a);
  }
  {
    const ab = martialArts && mods.dex > mods.str ? "dex" : "str";
    const dmg = martialArts ? withMod(`1d${maDie}`, mods[ab]) : String(Math.max(0, 1 + mods.str));
    attacks.push({
      id: "unarmed", name: "Unarmed Strike", kind: "melee", bonus: mods[ab] + prof, damage: dmg,
      damageType: "bludgeoning", rangeFt: null, reachFt: 5, properties: martialArts ? ["monk"] : [], itemId: null,
      ability: ab, proficient: true, critRange,
    });
  }
  const extraAttacks = Math.max(
    lv("fighter") >= 20 ? 3 : lv("fighter") >= 11 ? 2 : lv("fighter") >= 5 ? 1 : 0,
    ["barbarian", "monk", "paladin", "ranger"].some((k) => lv(k) >= 5) ? 1 : 0
  );

  // spellcasting
  const spellcasting = deriveSpellcasting(char, srd, classes, mods, prof);

  // resources
  const merged = new Map();
  for (const c of classes) {
    for (const r of classResources(c.class, lv(c.class), char)) {
      const prev = merged.get(r.key);
      if (!prev || (r.max ?? Infinity) > (prev.max ?? Infinity)) merged.set(r.key, r);
    }
  }
  for (const r of racialResources(char, srd, mods, prof)) merged.set(r.key, r);
  const resources = [...merged.values()].map((r) => {
    const used = Number(char.resources?.[r.key]?.used) || 0;
    return { ...r, used: r.max == null ? 0 : clamp(used, 0, r.max) };
  });

  // hit dice
  const hitDicePool = [];
  for (const c of classes) {
    const die = get(srd, "classes", c.class)?.hitDie ?? { barbarian: 12, fighter: 10, paladin: 10, ranger: 10, sorcerer: 6, wizard: 6 }[c.class] ?? 8;
    const ex = hitDicePool.find((h) => h.die === die);
    if (ex) ex.total += c.level;
    else hitDicePool.push({ die, total: c.level });
  }
  const hitDie = hitDicePool[0]?.die ?? char.hitDice?.die ?? 8;

  return {
    level,
    abilities,
    mods,
    prof,
    saves,
    skills,
    passive,
    initiative,
    ac,
    acNote,
    speed,
    baseSpeed,
    hitDie,
    hitDicePool,
    spellcasting,
    attacks,
    attacksPerAction: 1 + extraAttacks,
    resources,
    features: char.features || [],
    darkvision: Number(char.darkvision ?? race?.darkvision ?? 0) || 0,
    resistances: [...new Set([...(race?.resistances || []), ...draconicResistance(char, srd)])],
    carryCapacity: abilities.str * 15,
  };
}

function draconicResistance(char, srd) {
  if (char.race !== "dragonborn") return [];
  const names = (char.features || []).map((f) => f.name || "");
  const colour = char.draconicAncestry || (names.find((n) => /^Draconic Ancestry \(/.test(n)) || "").replace(/^Draconic Ancestry \((.+)\)$/, "$1");
  const anc = (get(srd, "races", "dragonborn")?.draconicAncestry || []).find((a) => a.name.toLowerCase() === String(colour).toLowerCase() || a.index === colour);
  return anc ? [anc.damageType] : [];
}

function deriveSpellcasting(char, srd, classes, mods, prof) {
  const perClass = [];
  for (const c of classes) {
    const cast = castingFor(c.class, c.subclass, srd);
    if (!cast || c.level < (cast.from || 1)) continue;
    const ability = cast.ability;
    const mod = mods[ability];
    const row = levelRow(srd, c.class, c.level);
    const cantrips = row ? row.cantrips ?? 0 : CANTRIPS[c.class]?.[Math.min(c.level, 10) - 1] ?? 0;
    const known = cast.mode === "known" || cast.mode === "pact"
      ? row ? row.spellsKnown ?? 0 : SPELLS_KNOWN[c.class]?.[c.level - 1] ?? 0
      : null;
    let preparedMax = null;
    if (cast.prepared === "level") preparedMax = Math.max(1, mod + c.level);
    else if (cast.prepared === "half") preparedMax = Math.max(1, mod + Math.floor(c.level / 2));
    const entry = {
      class: c.class, level: c.level, ability, mode: cast.mode, type: cast.type,
      dc: 8 + prof + mod, attack: prof + mod, cantripsKnown: cantrips, spellsKnown: known, preparedMax,
    };
    if (cast.mode === "spellbook") entry.spellbookMin = 6 + 2 * (c.level - 1);
    perClass.push(entry);
  }
  const innate = char.spellcasting?.innate || [];
  if (!perClass.length && !innate.length && !(char.spellcasting?.cantrips?.length)) return null;
  const { slots, pact } = spellSlots(classes, srd);
  const primary = perClass[0];
  const ability = char.spellcasting?.ability && ABILITIES.includes(char.spellcasting.ability) ? char.spellcasting.ability : primary?.ability ?? innate[0]?.ability ?? "int";
  const mod = mods[ability];
  const sum = (k) => (perClass.some((p) => p[k] != null) ? perClass.reduce((a, p) => a + (p[k] ?? 0), 0) : null);
  let maxSpellLevel = 0;
  slots.forEach((n, i) => n > 0 && (maxSpellLevel = i + 1));
  if (pact) maxSpellLevel = Math.max(maxSpellLevel, pact.level);
  return {
    ability,
    dc: 8 + prof + mod,
    attack: prof + mod,
    slots,
    pact,
    cantripsKnown: perClass.reduce((a, p) => a + p.cantripsKnown, 0),
    spellsKnown: sum("spellsKnown"),
    preparedMax: sum("preparedMax"),
    mode: primary?.mode ?? "innate",
    maxSpellLevel,
    classes: perClass,
    slotsUsed: (char.spellcasting?.slotsUsed || []).slice(0, 9),
    pactUsed: Number(char.spellcasting?.pactUsed) || 0,
  };
}

// ─── monsters ──────────────────────────────────────────────────────────────────────────────
export function monsterSaveBonus(monster, ability) {
  const s = monster?.saves?.[ability];
  if (s != null) return Number(s);
  return abilityMod(monster?.abilities?.[ability] ?? 10);
}
export function monsterSkillBonus(monster, skill) {
  const s = monster?.skills?.[skill];
  if (s != null) return Number(s);
  const ab = SKILLS[skill];
  return ab ? abilityMod(monster?.abilities?.[ab] ?? 10) : 0;
}
export const monsterInitiative = (monster) => abilityMod(monster?.abilities?.dex ?? 10);

// ─── XP ────────────────────────────────────────────────────────────────────────────────────
export const xpForLevel = (level) => XP_THRESHOLDS[clamp(Number(level) || 1, 1, 20) - 1];
export function levelForXp(xp) {
  const n = Number(xp) || 0;
  let lvl = 1;
  for (let i = 0; i < XP_THRESHOLDS.length; i++) if (n >= XP_THRESHOLDS[i]) lvl = i + 1;
  return lvl;
}
export const crToXp = (cr) => XP_BY_CR[Number(cr)] ?? 0;

/**
 * Encounter difficulty (DMG): partyLevels [3,3,4,2], monsters [{ xp } | { cr } | number(xp)].
 * -> { totalXp, adjustedXp, multiplier, thresholds: { easy, medium, hard, deadly }, difficulty }
 */
export function encounterDifficulty(partyLevels, monsters) {
  const th = { easy: 0, medium: 0, hard: 0, deadly: 0 };
  for (const l of partyLevels || []) {
    const row = ENCOUNTER_THRESHOLDS[clamp(Number(l) || 1, 1, 20) - 1];
    th.easy += row[0]; th.medium += row[1]; th.hard += row[2]; th.deadly += row[3];
  }
  const xps = (monsters || []).map((m) => (typeof m === "number" ? m : m?.xp ?? crToXp(m?.cr)));
  const totalXp = xps.reduce((a, b) => a + b, 0);
  const n = xps.length;
  const steps = [1, 1.5, 2, 2.5, 3, 4];
  let idx = n <= 1 ? 0 : n === 2 ? 1 : n <= 6 ? 2 : n <= 10 ? 3 : n <= 14 ? 4 : 5;
  const party = (partyLevels || []).length;
  if (party > 0 && party < 3) idx = Math.min(5, idx + 1);
  else if (party >= 6) idx = Math.max(0, idx - 1);
  const multiplier = n === 0 ? 1 : party >= 6 && n <= 1 ? 0.5 : steps[idx];
  const adjustedXp = Math.round(totalXp * multiplier);
  const difficulty = adjustedXp >= th.deadly ? "deadly" : adjustedXp >= th.hard ? "hard" : adjustedXp >= th.medium ? "medium" : adjustedXp >= th.easy ? "easy" : "trivial";
  return { totalXp, adjustedXp, multiplier, thresholds: th, difficulty };
}
