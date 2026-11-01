#!/usr/bin/env node
/**
 * build-srd.mjs — compiles data-src/srd-raw/5e-SRD-*.json (5e-bits/5e-database, SRD 5.1, CC-BY-4.0)
 * into compact, denormalised shared/srd/*.json files. Run with `npm run build:srd`.
 *
 * Every output file is a JSON array of objects that each carry an `index` (kebab-case slug).
 * Ability keys: str dex con int wis cha. Skill keys: camelCase (animalHandling, sleightOfHand...).
 * Distances are in feet, costs in gp (fractions allowed: 1 sp = 0.1), weights in lb.
 *
 * ── classes.json ─────────────────────────────────────────────────────────────────────────────
 * { index, name, hitDie, primaryAbility, saves: ["str","con"],
 *   proficiencies: { armor: ["Light Armor", ...], weapons: ["Simple Weapons", "Longswords", ...], tools: [...] },
 *   skillChoices: { choose: 2, from: ["athletics", ...] },
 *   toolChoices: [{ desc, choose, from: ["Lute", ...] }],
 *   startingEquipment: [{ index, name, qty }],                 // always given
 *   equipmentOptions: [{ desc, choose: 1, options: [{ label, note?, items: [{ index, name, qty }],
 *                         picks: [{ desc, choose, from: [{ index, name, qty }] }] }] }],
 *       // pick one option per set; an option gives its fixed `items` plus, for each entry of `picks`,
 *       // `choose` items picked from `from` (equipment categories already expanded to item lists)
 *   startingWealth: "5d4x10",                                   // gp, alternative to the equipment
 *   spellcasting: { ability: "int", level: 1, type: "full"|"half"|"pact", mode: "prepared"|"known"|"spellbook"|"pact",
 *                   prepared: "level"|"half"|null, focus, ritual: bool, info: [{ name, desc }] } | null,
 *   multiclass: { prereq: [{ ability, min }], prereqMode: "all"|"any",
 *                 proficiencies: { armor, weapons, tools }, skillChoices: { choose, from } | null },
 *   subclassLevel: 3, subclassFlavor: "Martial Archetype",
 *   asiLevels: [4, 6, 8, 12, 14, 16, 19],
 *   levels: [ {                                                   // 20 entries, levels[0] is level 1
 *     level, prof, asi: bool,
 *     features: [{ index, name, desc, placeholder?: true ("Path feature": the subclass fills it in),
 *                  choose?: 1, options?: [{ index, name, desc }] (pick sub-features, e.g. fighting styles; choose null = see class table),
 *                  stringOptions?: { choose, from: ["beasts", ...] }, expertise?: 2 }],
 *     cantrips: n | null, spellsKnown: n | null, slots: [s1..s9] | null, pact: { slots, level } | null,
 *     specific: { rageCount, rageDamage, brutalCriticalDice, bardicInspirationDie, songOfRestDie, magicalSecretsMax5,
 *                 channelDivinity, destroyUndeadCr, wildShapeMaxCr, wildShapeSwim, wildShapeFly, actionSurges,
 *                 indomitableUses, extraAttacks, martialArts: "1d4", kiPoints, unarmoredMovement, auraRange,
 *                 favoredEnemies, favoredTerrain, sneakAttack: "1d6", sorceryPoints, metamagicKnown,
 *                 invocationsKnown, mysticArcanumLevel6..9, arcaneRecoveryLevels ... }  // only the class's own keys
 *   } ],
 *   subclasses: [{ index, name, flavor, desc, level (level the subclass is chosen),
 *                  features: [{ level, index, name, desc, options? }],
 *                  spells: [{ level (class level), index, name, requires?: "circle-of-the-land-arctic" }] }] }
 *
 * ── races.json ───────────────────────────────────────────────────────────────────────────────
 * { index, name, speed, size: "Medium", sizeDesc, age, alignment, languageDesc,
 *   abilityBonuses: { con: 2 }, bonusChoices: { choose: 2, amount: 1, from: ["str", ...] } | null,
 *   darkvision: 60 (ft, 0 = none), resistances: ["poison"],
 *   languages: ["Common", "Dwarvish"], languageChoices: { choose, from: ["Giant", ...] } | null,
 *   proficiencies: { armor, weapons, tools, skills: ["perception"] },
 *   proficiencyChoices: [{ desc, choose, type: "skills"|"tools", from: [...] }],
 *   traits: [{ index, name, desc }],
 *   draconicAncestry?: [{ index, name: "Red", damageType: "fire", area: { type: "cone", size: 15 }, save: "dex" }],
 *   subraces: [{ index, name, desc, abilityBonuses, darkvision?, speed?, proficiencies, proficiencyChoices,
 *                languageChoices, traits, cantripChoice?: { choose, ability, from: [spellIndex] }, hpPerLevel? }] }
 *
 * ── backgrounds.json ─────────────────────────────────────────────────────────────────────────
 * { index, name, srd: bool, skills: ["insight", "religion"], tools: ["Disguise Kit"],
 *   toolChoices: [{ desc, choose, from: [...] }], languages: [], languageChoices: { choose, from: "any" } | null,
 *   equipment: [{ index | null, name, qty }], equipmentChoices: [{ desc, choose, from: [{ index, name, qty }] }],
 *   gold: 15, feature: { name, desc },
 *   suggestions: { traits: [..], ideals: [..], bonds: [..], flaws: [..] } }
 *   (Only Acolyte is SRD; the others use 5e mechanics with feature descriptions written for Roleplay20.)
 *
 * ── spells.json ──────────────────────────────────────────────────────────────────────────────
 * { index, name, level (0 = cantrip), school, castingTime, range: "150 feet", rangeFt: 150 | null
 *   (self = 0, touch = 5, sight/unlimited/special = null), components: ["V","S","M"], material,
 *   duration, concentration, ritual, desc, higherLevel,
 *   attackType: "melee"|"ranged"|null, area: { type: "sphere"|"cube"|"cone"|"line"|"cylinder", size } | null,
 *   damage: { type: "fire", atSlot?: { "3": "8d6", ... }, atCharLevel?: { "1": "1d10", "5": "2d10", ... }, addMod? } | null,
 *   extraDamage?: [ same shape ],             // second damage type (ice storm, flame strike, meteor swarm)
 *   heal: { atSlot: { "1": "1d8" }, addMod: true } | null,
 *   effectDice?: { atSlot },                  // sleep: hit points of creatures affected
 *   dc: { ability: "dex", success: "half"|"none"|"other" } | null,
 *   classes: ["sorcerer", "wizard"], subclasses: ["lore"] }
 *
 * ── monsters.json (server-side only) ──────────────────────────────────────────────────────────
 * { index, name, size, sizeCells (1 Tiny-Medium, 2 Large, 3 Huge, 4 Gargantuan), type, subtype, alignment,
 *   ac, acDesc, hp, hitDice: "2d6", hpRoll: "2d6", speed: { walk: 30, fly: 60, swim, climb, burrow, hover: true },
 *   abilities: { str, dex, con, int, wis, cha }, saves: { dex: 6 }, skills: { stealth: 6 },
 *   senses: { darkvision: 60, blindsight, tremorsense, truesight, passivePerception: 9 },
 *   languages, cr: 0.25, crText: "1/4", xp, prof,
 *   resistances: [..], immunities: [..], vulnerabilities: [..], conditionImmunities: ["poisoned"],
 *   traits: [{ name, desc, usage? }], spellcasting?: { ability, dc, attack, level, slots: { "1": 4 }, spells: [index], atWill: [index], perDay: { "1": [index] } },
 *   actions: [Action], bonusActions?: [Action], reactions: [Action], legendary: [Action], legendaryDesc? }
 * Action = { name, desc, kind: "melee"|"ranged"|"save"|"multiattack"|"other",
 *            attackBonus | null, damage: [{ dice: "1d6+2", type: "slashing" }], damageAlt?: [[...]],
 *            reachFt | null, rangeFt: { normal, long } | null,
 *            dc: { ability, value, success: "half"|"none" } | null, area?: { type, size },
 *            multiattack?: [{ name, count }], multiattackAlt?: [[{ name, count }]],
 *            options?: [{ name, dc, damage, area }]  (breath weapon / roar variants),
 *            usage?: { type: "recharge", min: 5 } | { type: "perDay", times: 3 } | { type: "perRest" }, cost? (legendary) }
 *
 * ── equipment.json ───────────────────────────────────────────────────────────────────────────
 * { index, name, type: "weapon"|"armor"|"gear"|"tool"|"pack"|"mount"|"vehicle", categories: ["martial-weapons", ...],
 *   cost (gp), weight, desc?,
 *   // weapons:  category: "simple"|"martial", range: "melee"|"ranged", damage: "1d8", damageType, versatile?: "1d10",
 *   //           properties: ["versatile", ...], reachFt: 5|10, rangeFt: { normal, long } | null, throwFt?: { normal, long }, special?
 *   // armor:    armorType: "light"|"medium"|"heavy"|"shield", ac, dexBonus: bool, maxDex: 2 | null, strMin, stealthDisadvantage
 *   // gear:     gearCategory: "standard-gear"|"ammunition"|"holy-symbols"|"arcane-foci"|"druidic-foci"|"kits"|"equipment-packs",
 *   //           bundle?: 20 (units sold together for `cost`), contents?: [{ index, name, qty }] (packs)
 *   // tools:    toolCategory: "artisans-tools"|"gaming-sets"|"musical-instruments"|"other-tools"
 *   // mounts:   speed, capacity }
 *
 * ── features.json ── { index, name, class, subclass | null, level, desc, parent?, choose?, options?: [index], stringOptions?, expertise? }
 * ── conditions.json ── { index, name, desc }
 * ── skills.json ── { index: "animal-handling", key: "animalHandling", name, ability, desc }
 * ── magic-items.json ── { index, name, rarity, type: "Wondrous Items", typeLine, desc, attunement: bool,
 *                          attunementNote?, variants?: [index], variantOf? }
 * ── languages.json ── { index, name, type: "Standard"|"Exotic", script, speakers: [..] }
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RAW = path.join(ROOT, "data-src", "srd-raw");
const OUT = path.join(ROOT, "shared", "srd");

const load = (name) => JSON.parse(fs.readFileSync(path.join(RAW, `5e-SRD-${name}.json`), "utf8"));

const raw = {
  classes: load("Classes"),
  subclasses: load("Subclasses"),
  levels: load("Levels"),
  features: load("Features"),
  races: load("Races"),
  subraces: load("Subraces"),
  traits: load("Traits"),
  backgrounds: load("Backgrounds"),
  spells: load("Spells"),
  monsters: load("Monsters"),
  equipment: load("Equipment"),
  proficiencies: load("Proficiencies"),
  conditions: load("Conditions"),
  skills: load("Skills"),
  magicItems: load("Magic-Items"),
  languages: load("Languages"),
};

const by = (list) => new Map(list.map((x) => [x.index, x]));
const featById = by(raw.features);
const equipById = by(raw.equipment);
const profById = by(raw.proficiencies);
const traitById = by(raw.traits);
const spellById = by(raw.spells);
const langById = by(raw.languages);

const joinDesc = (d) => (Array.isArray(d) ? d.join("\n") : d || "").replace(/’/g, "'").trim();
const camel = (s) => s.toLowerCase().replace(/[^a-z0-9]+(.)/g, (_, c) => c.toUpperCase());
const cleanDice = (s) => (s == null ? s : String(s).replace(/\s+/g, ""));
const ABILITY_KEYS = ["str", "dex", "con", "int", "wis", "cha"];

// ─── skills ────────────────────────────────────────────────────────────────────────────────
const skillKeyByIndex = new Map(); // "animal-handling" -> "animalHandling"
const skills = raw.skills.map((s) => {
  const key = camel(s.name);
  skillKeyByIndex.set(s.index, key);
  return { index: s.index, key, name: s.name, ability: s.ability_score.index, desc: joinDesc(s.desc) };
});
const skillFromProf = (profIndex) => skillKeyByIndex.get(profIndex.replace(/^skill-/, ""));

// ─── proficiency helpers ───────────────────────────────────────────────────────────────────
const PROF_TYPE = {
  Armor: "armor", Weapons: "weapons", "Artisan's Tools": "tools", "Gaming Sets": "tools",
  "Musical Instruments": "tools", Other: "tools", Vehicles: "tools", Skills: "skills", "Saving Throws": "saves",
};
function profEntry(index) {
  const p = profById.get(index);
  if (!p) return null;
  return { type: PROF_TYPE[p.type] || "tools", name: p.name, index };
}
function sortProfs(list) {
  const out = { armor: [], weapons: [], tools: [], skills: [] };
  for (const ref of list) {
    if (ref.index === "all-armor") { out.armor.push("Light Armor", "Medium Armor", "Heavy Armor"); continue; }
    const p = profEntry(ref.index);
    if (!p || p.type === "saves") continue;
    if (p.type === "skills") out.skills.push(skillFromProf(p.index));
    else out[p.type].push(p.name);
  }
  return out;
}

// ─── equipment ─────────────────────────────────────────────────────────────────────────────
const toGp = (c) => {
  if (!c) return 0;
  const mult = { cp: 0.01, sp: 0.1, ep: 0.5, gp: 1, pp: 10 }[c.unit] ?? 1;
  return Math.round(c.quantity * mult * 100) / 100;
};
const TOOL_CAT = {
  "Artisan's Tools": "artisans-tools", "Gaming Sets": "gaming-sets",
  "Musical Instrument": "musical-instruments", "Other Tools": "other-tools",
};
const categoryItems = new Map(); // category index -> [equipment index]
const addCat = (cat, idx) => {
  if (!categoryItems.has(cat)) categoryItems.set(cat, []);
  categoryItems.get(cat).push(idx);
};

const equipment = raw.equipment.map((e) => {
  const cat = e.equipment_category.index;
  const o = { index: e.index, name: e.name };
  const cats = [cat];
  if (cat === "weapon") {
    const wc = e.weapon_category.toLowerCase();
    const wr = e.weapon_range.toLowerCase();
    o.type = "weapon";
    o.category = wc;
    o.range = wr;
    o.damage = e.damage ? cleanDice(e.damage.damage_dice) : null;
    o.damageType = e.damage ? e.damage.damage_type.index : null;
    if (e.two_handed_damage) o.versatile = cleanDice(e.two_handed_damage.damage_dice);
    o.properties = (e.properties || []).map((p) => p.index);
    o.reachFt = wr === "melee" ? (o.properties.includes("reach") ? 10 : 5) : null;
    o.rangeFt = wr === "ranged" && e.range ? { normal: e.range.normal, long: e.range.long ?? null } : null;
    if (e.throw_range) o.throwFt = { normal: e.throw_range.normal, long: e.throw_range.long ?? null };
    if (e.special) o.special = joinDesc(e.special);
    cats.push(`${wc}-weapons`, `${wc}-${wr}-weapons`, `${wr}-weapons`);
  } else if (cat === "armor") {
    o.type = "armor";
    o.armorType = e.armor_category.toLowerCase();
    o.ac = e.armor_class.base;
    o.dexBonus = !!e.armor_class.dex_bonus;
    o.maxDex = e.armor_class.max_bonus ?? null;
    o.strMin = e.str_minimum || 0;
    o.stealthDisadvantage = !!e.stealth_disadvantage;
    cats.push(o.armorType === "shield" ? "shields" : `${o.armorType}-armor`);
  } else if (cat === "adventuring-gear") {
    o.type = e.gear_category?.index === "equipment-packs" ? "pack" : "gear";
    o.gearCategory = e.gear_category?.index || "standard-gear";
    cats.push(o.gearCategory);
    if (e.quantity && e.quantity > 1) o.bundle = e.quantity;
    if (e.contents) o.contents = e.contents.map((c) => ({ index: c.item.index, name: c.item.name, qty: c.quantity }));
  } else if (cat === "tools") {
    o.type = "tool";
    o.toolCategory = TOOL_CAT[e.tool_category] || "other-tools";
    cats.push(o.toolCategory);
  } else if (cat === "mounts-and-vehicles") {
    o.type = /Mounts/.test(e.vehicle_category) ? "mount" : "vehicle";
    if (e.speed) o.speed = `${e.speed.quantity} ${e.speed.unit}`;
    if (e.capacity) o.capacity = e.capacity;
  } else {
    o.type = "gear";
  }
  o.categories = [...new Set(cats)];
  for (const c of o.categories) addCat(c, e.index);
  o.cost = toGp(e.cost);
  if (e.weight != null) o.weight = e.weight;
  if (e.desc && e.desc.length) o.desc = joinDesc(e.desc);
  return o;
});
const eqCompiled = by(equipment);
const itemRef = (index, qty = 1) => ({ index, name: eqCompiled.get(index)?.name ?? index, qty });
const expandCategory = (cat) => (categoryItems.get(cat) || []).map((i) => itemRef(i, 1));

// ─── features ──────────────────────────────────────────────────────────────────────────────
const PLACEHOLDER = / feature$/i; // "Path feature", "Divine Domain feature": filled in by the subclass
const EXPERTISE = { "rogue-expertise-1": 2, "rogue-expertise-2": 2, "bard-expertise-1": 2, "bard-expertise-2": 2 };
function featureOptions(f) {
  const fs_ = f.feature_specific;
  if (!fs_) return {};
  const out = {};
  if (fs_.subfeature_options) {
    out.choose = fs_.subfeature_options.choose;
    out.options = fs_.subfeature_options.from.options.map((o) => {
      const sub = featById.get(o.item.index);
      return { index: o.item.index, name: o.item.name, desc: sub ? joinDesc(sub.desc) : "" };
    });
  }
  if (fs_.invocations) {
    out.choose = null; // number known comes from the class table (specific.invocationsKnown)
    out.options = fs_.invocations.map((o) => {
      const sub = featById.get(o.index);
      return { index: o.index, name: o.name, desc: sub ? joinDesc(sub.desc) : "" };
    });
  }
  for (const k of ["enemy_type_options", "terrain_type_options"]) {
    if (fs_[k]) out.stringOptions = { choose: fs_[k].choose, from: fs_[k].from.options };
  }
  return out;
}
function compileFeatureRef(ref) {
  const f = featById.get(ref.index);
  const o = { index: ref.index, name: f?.name ?? ref.name, desc: f ? joinDesc(f.desc) : "" };
  if (PLACEHOLDER.test(o.name)) o.placeholder = true;
  if (f) Object.assign(o, featureOptions(f));
  if (EXPERTISE[ref.index]) o.expertise = EXPERTISE[ref.index];
  return o;
}
const features = raw.features.map((f) => {
  const o = {
    index: f.index, name: f.name, class: f.class?.index ?? null, subclass: f.subclass?.index ?? null,
    level: f.level, desc: joinDesc(f.desc),
  };
  if (f.parent) o.parent = f.parent.index;
  const opts = featureOptions(f);
  if (opts.options) { o.choose = opts.choose; o.options = opts.options.map((x) => x.index); }
  if (opts.stringOptions) o.stringOptions = opts.stringOptions;
  if (EXPERTISE[f.index]) o.expertise = EXPERTISE[f.index];
  return o;
});

// ─── classes ───────────────────────────────────────────────────────────────────────────────
const CLASS_META = {
  barbarian: { primary: "str", wealth: "2d4x10" },
  bard: { primary: "cha", wealth: "5d4x10", cast: "full", mode: "known" },
  cleric: { primary: "wis", wealth: "5d4x10", cast: "full", mode: "prepared", prepared: "level" },
  druid: { primary: "wis", wealth: "2d4x10", cast: "full", mode: "prepared", prepared: "level" },
  fighter: { primary: "str", wealth: "5d4x10", asi: [4, 6, 8, 12, 14, 16, 19] },
  monk: { primary: "dex", wealth: "5d4" },
  paladin: { primary: "str", wealth: "5d4x10", cast: "half", mode: "prepared", prepared: "half" },
  ranger: { primary: "dex", wealth: "5d4x10", cast: "half", mode: "known" },
  rogue: { primary: "dex", wealth: "4d4x10", asi: [4, 8, 10, 12, 16, 19] },
  sorcerer: { primary: "cha", wealth: "3d4x10", cast: "full", mode: "known" },
  warlock: { primary: "cha", wealth: "4d4x10", cast: "pact", mode: "pact" },
  wizard: { primary: "int", wealth: "4d4x10", cast: "full", mode: "spellbook", prepared: "level" },
};
const FOCUS = {
  bard: "musical instrument", cleric: "holy symbol", druid: "druidic focus", paladin: "holy symbol",
  ranger: null, sorcerer: "arcane focus", warlock: "arcane focus", wizard: "arcane focus",
};
const RITUAL = new Set(["bard", "cleric", "druid", "wizard"]);

function compileItemsFromOption(opt, acc) {
  // acc: { items: [], picks: [] }
  if (opt.option_type === "counted_reference") {
    acc.items.push(itemRef(opt.of.index, opt.count));
  } else if (opt.option_type === "reference") {
    acc.items.push(itemRef(opt.item.index, 1));
  } else if (opt.option_type === "multiple") {
    for (const it of opt.items) compileItemsFromOption(it, acc);
  } else if (opt.option_type === "choice") {
    const ch = opt.choice;
    acc.picks.push({ desc: ch.desc, choose: ch.choose, from: compileFrom(ch.from) });
  }
  return acc;
}
function compileFrom(from) {
  if (from.option_set_type === "equipment_category") return expandCategory(from.equipment_category.index);
  const list = [];
  for (const o of from.options || []) {
    if (o.option_type === "counted_reference") list.push(itemRef(o.of.index, o.count));
    else if (o.option_type === "reference") list.push(itemRef(o.item.index, 1));
    else if (o.option_type === "choice") list.push(...compileFrom(o.choice.from));
  }
  return list;
}
function labelFor(acc) {
  const parts = acc.items.map((i) => (i.qty > 1 ? `${i.qty} ${i.name}` : i.name));
  for (const p of acc.picks) parts.push(p.desc);
  return parts.join(", ");
}
function splitLabels(desc) {
  // "(a) a martial weapon and a shield or (b) two martial weapons" -> ["a martial weapon and a shield", "two martial weapons"]
  if (!/\([a-c]\)/.test(desc)) return null;
  return desc
    .split(/\([a-c]\)/)
    .slice(1)
    .map((s) => s.replace(/,?\s*(or)?\s*$/i, "").trim());
}
function compileEquipmentOptionSet(set) {
  const desc = (set.desc || "").replace(/’/g, "'");
  let options;
  if (set.from.option_set_type === "equipment_category") {
    options = [{ label: desc, items: [], picks: [{ desc, choose: set.choose, from: compileFrom(set.from) }] }];
    return { desc, choose: 1, options };
  }
  const labels = splitLabels(desc);
  options = set.from.options.map((opt, i) => {
    const acc = compileItemsFromOption(opt, { items: [], picks: [] });
    let label = labels && labels.length === set.from.options.length ? labels[i] : labelFor(acc);
    const o = { label, items: acc.items, picks: acc.picks };
    if (/if proficient/i.test(label)) {
      o.label = label.replace(/\s*\(if proficient\)/i, "");
      o.note = "if proficient";
    }
    return o;
  });
  return { desc, choose: set.choose, options };
}

function compileProfChoices(pcs) {
  const skillChoices = [];
  const toolChoices = [];
  for (const pc of pcs || []) {
    const flat = [];
    const walk = (from) => {
      for (const o of from.options || []) {
        if (o.option_type === "reference") flat.push(o.item.index);
        else if (o.option_type === "choice") walk(o.choice.from);
      }
    };
    walk(pc.from);
    if (flat.every((i) => i.startsWith("skill-"))) {
      skillChoices.push({ choose: pc.choose, from: flat.map(skillFromProf) });
    } else {
      toolChoices.push({
        desc: (pc.desc || "").replace(/’/g, "'"), choose: pc.choose,
        from: flat.map((i) => profById.get(i)?.name ?? i),
      });
    }
  }
  return { skillChoices, toolChoices };
}

const SPECIFIC_RENAME = { rage_damage_bonus: "rageDamage", channel_divinity_charges: "channelDivinity" };
function compileSpecific(cs) {
  if (!cs) return {};
  const out = {};
  for (const [k, v] of Object.entries(cs)) {
    if (k === "creating_spell_slots") continue;
    const key = SPECIFIC_RENAME[k] || camel(k);
    if (v && typeof v === "object" && "dice_count" in v) out[key] = `${v.dice_count}d${v.dice_value}`;
    else out[key] = v;
  }
  return out;
}

const classLevels = new Map(); // class -> [level rows]
const subclassLevels = new Map();
for (const l of raw.levels) {
  if (l.subclass) {
    if (!subclassLevels.has(l.subclass.index)) subclassLevels.set(l.subclass.index, []);
    subclassLevels.get(l.subclass.index).push(l);
  } else {
    if (!classLevels.has(l.class.index)) classLevels.set(l.class.index, []);
    classLevels.get(l.class.index).push(l);
  }
}

const classes = raw.classes.map((c) => {
  const meta = CLASS_META[c.index];
  const asiLevels = meta.asi || [4, 8, 12, 16, 19];
  const { skillChoices, toolChoices } = compileProfChoices(c.proficiency_choices);
  const profs = sortProfs(c.proficiencies);
  const levels = (classLevels.get(c.index) || [])
    .sort((a, b) => a.level - b.level)
    .map((l) => {
      const sc = l.spellcasting;
      const slots = sc ? Array.from({ length: 9 }, (_, i) => sc[`spell_slots_level_${i + 1}`] || 0) : null;
      const row = {
        level: l.level,
        prof: l.prof_bonus,
        asi: asiLevels.includes(l.level),
        features: l.features.map(compileFeatureRef),
        cantrips: sc?.cantrips_known ?? null,
        spellsKnown: sc?.spells_known ?? null,
        slots,
        pact: null,
        specific: compileSpecific(l.class_specific),
      };
      if (c.index === "warlock" && slots) {
        const lvl = slots.findIndex((n) => n > 0);
        row.pact = lvl >= 0 ? { slots: slots[lvl], level: lvl + 1 } : null;
      }
      if (c.index === "paladin") row.specific.channelDivinity = l.level >= 3 ? 1 : 0;
      if (c.index === "druid") row.specific.wildShapeUses = l.level >= 2 ? 2 : 0;
      return row;
    });

  const subclasses = (c.subclasses || []).map((ref) => {
    const s = raw.subclasses.find((x) => x.index === ref.index);
    const rows = (subclassLevels.get(ref.index) || []).sort((a, b) => a.level - b.level);
    const feats = [];
    for (const r of rows) for (const f of r.features) feats.push({ level: r.level, ...compileFeatureRef(f) });
    const spells = (s.spells || []).map((sp) => {
      const lvlPre = sp.prerequisites.find((p) => p.type === "level");
      const featPre = sp.prerequisites.find((p) => p.type === "feature");
      const o = { level: lvlPre ? Number(lvlPre.index.split("-").pop()) : 1, index: sp.spell.index, name: sp.spell.name };
      if (featPre) o.requires = featPre.index;
      return o;
    });
    return {
      index: s.index, name: s.name, flavor: s.subclass_flavor, desc: joinDesc(s.desc),
      level: rows.length ? rows[0].level : 3, features: feats, spells,
    };
  });

  let spellcasting = null;
  if (c.spellcasting) {
    spellcasting = {
      ability: c.spellcasting.spellcasting_ability.index,
      level: c.spellcasting.level,
      type: meta.cast,
      mode: meta.mode,
      prepared: meta.prepared || null,
      focus: FOCUS[c.index] ?? null,
      ritual: RITUAL.has(c.index),
      info: c.spellcasting.info.map((i) => ({ name: i.name, desc: joinDesc(i.desc) })),
    };
  }

  // multiclassing
  const mc = c.multi_classing || {};
  let prereq = [];
  let prereqMode = "all";
  if (mc.prerequisites) prereq = mc.prerequisites.map((p) => ({ ability: p.ability_score.index, min: p.minimum_score }));
  if (mc.prerequisite_options) {
    prereqMode = "any";
    prereq = mc.prerequisite_options.from.options.map((p) => ({ ability: p.ability_score.index, min: p.minimum_score }));
  }
  const mcProfs = sortProfs(mc.proficiencies || []);
  const mcChoices = compileProfChoices(mc.proficiency_choices);

  return {
    index: c.index,
    name: c.name,
    hitDie: c.hit_die,
    primaryAbility: meta.primary,
    saves: c.saving_throws.map((s) => s.index),
    proficiencies: { armor: profs.armor, weapons: profs.weapons, tools: profs.tools },
    skillChoices: skillChoices[0] || { choose: 0, from: [] },
    toolChoices,
    startingEquipment: (c.starting_equipment || []).map((e) => itemRef(e.equipment.index, e.quantity)),
    equipmentOptions: (c.starting_equipment_options || []).map(compileEquipmentOptionSet),
    startingWealth: meta.wealth,
    spellcasting,
    multiclass: {
      prereq, prereqMode,
      proficiencies: { armor: mcProfs.armor, weapons: mcProfs.weapons, tools: mcProfs.tools },
      skillChoices: mcChoices.skillChoices[0] || null,
      toolChoices: mcChoices.toolChoices,
    },
    subclassLevel: subclasses[0]?.level ?? 3,
    subclassFlavor: subclasses[0]?.flavor ?? null,
    asiLevels,
    levels,
    subclasses,
  };
});

// ─── races ─────────────────────────────────────────────────────────────────────────────────
const bonusesObj = (list) => {
  const o = {};
  for (const b of list || []) o[b.ability_score.index] = (o[b.ability_score.index] || 0) + b.bonus;
  return o;
};
const langNames = (list) => (list || []).map((l) => langById.get(l.index)?.name ?? l.name);
const langChoices = (lo) =>
  lo ? { choose: lo.choose, from: lo.from.option_set_type === "options_array" ? lo.from.options.map((o) => o.item.name) : "any" } : null;
const RACE_RESIST = { dwarf: ["poison"], tiefling: ["fire"] };

function compileTraits(refs) {
  const traits = [];
  const profs = { armor: [], weapons: [], tools: [], skills: [] };
  const profChoices = [];
  let darkvision = 0;
  let languageChoices = null;
  let cantripChoice = null;
  for (const ref of refs || []) {
    const t = traitById.get(ref.index);
    if (!t) continue;
    const desc = joinDesc(t.desc);
    traits.push({ index: t.index, name: t.name, desc });
    if (t.index === "darkvision" || /superior darkvision/i.test(t.name)) {
      const m = desc.match(/within (\d+) feet/);
      darkvision = Math.max(darkvision, m ? Number(m[1]) : 60);
    }
    const sp = sortProfs(t.proficiencies || []);
    for (const k of Object.keys(profs)) profs[k].push(...sp[k]);
    if (t.proficiency_choices) {
      const flat = t.proficiency_choices.from.options.map((o) => o.item.index);
      const isSkill = flat.every((i) => i.startsWith("skill-"));
      profChoices.push({
        desc: t.name, choose: t.proficiency_choices.choose, type: isSkill ? "skills" : "tools",
        from: isSkill ? flat.map(skillFromProf) : flat.map((i) => profById.get(i)?.name ?? i),
      });
    }
    if (t.language_options) languageChoices = langChoices(t.language_options);
    if (t.trait_specific?.spell_options) {
      cantripChoice = {
        choose: t.trait_specific.spell_options.choose,
        ability: /Intelligence/.test(desc) ? "int" : "cha",
        from: t.trait_specific.spell_options.from.options.map((o) => o.item.index),
      };
    }
  }
  return { traits, profs, profChoices, darkvision, languageChoices, cantripChoice };
}

const races = raw.races.map((r) => {
  const t = compileTraits(r.traits);
  const startProfs = sortProfs(r.starting_proficiencies || []);
  for (const k of Object.keys(t.profs)) t.profs[k].push(...startProfs[k]);
  const subraces = (r.subraces || []).map((ref) => {
    const s = raw.subraces.find((x) => x.index === ref.index);
    const st = compileTraits(s.racial_traits);
    const sp = sortProfs(s.starting_proficiencies || []);
    for (const k of Object.keys(st.profs)) st.profs[k].push(...sp[k]);
    const o = {
      index: s.index, name: s.name, desc: joinDesc(s.desc), abilityBonuses: bonusesObj(s.ability_bonuses),
      proficiencies: st.profs, proficiencyChoices: st.profChoices,
      languageChoices: st.languageChoices || langChoices(s.language_options), traits: st.traits,
    };
    if (st.darkvision) o.darkvision = st.darkvision;
    if (st.cantripChoice) o.cantripChoice = st.cantripChoice;
    if (s.index === "hill-dwarf") o.hpPerLevel = 1;
    return o;
  });
  const out = {
    index: r.index, name: r.name, speed: r.speed, size: r.size, sizeDesc: r.size_description,
    age: r.age, alignment: r.alignment, languageDesc: r.language_desc,
    abilityBonuses: bonusesObj(r.ability_bonuses),
    bonusChoices: r.ability_bonus_options
      ? {
          choose: r.ability_bonus_options.choose,
          amount: r.ability_bonus_options.from.options[0].bonus,
          from: r.ability_bonus_options.from.options.map((o) => o.ability_score.index),
        }
      : null,
    darkvision: t.darkvision,
    resistances: RACE_RESIST[r.index] || [],
    languages: langNames(r.languages),
    languageChoices: langChoices(r.language_options),
    proficiencies: t.profs,
    proficiencyChoices: t.profChoices,
    traits: t.traits,
    subraces,
  };
  if (r.index === "dragonborn") {
    out.draconicAncestry = raw.traits
      .filter((x) => x.parent?.index === "draconic-ancestry")
      .map((x) => {
        const bw = x.trait_specific.breath_weapon;
        return {
          index: x.index,
          name: x.name.match(/\((.+)\)/)[1],
          damageType: x.trait_specific.damage_type.index,
          area: { type: bw.area_of_effect.type, size: bw.area_of_effect.size },
          save: bw.dc.dc_type.index,
        };
      });
    // the per-colour traits are folded into draconicAncestry; keep the parent trait only
    out.traits = out.traits.filter((x) => !x.index.startsWith("draconic-ancestry-"));
  }
  return out;
});

// ─── backgrounds ───────────────────────────────────────────────────────────────────────────
// Only Acolyte is in SRD 5.1. The others follow standard 5e background mechanics; feature
// descriptions and suggestion lists are original text written for Roleplay20.
const eq = (index, qty = 1, name) => ({ index, name: name || eqCompiled.get(index)?.name || index, qty });
const custom = (name, qty = 1) => ({ index: null, name, qty });
const ARTISAN = expandCategory("artisans-tools").map((i) => i.name);
const INSTRUMENTS = expandCategory("musical-instruments").map((i) => i.name);
const GAMING = expandCategory("gaming-sets").map((i) => i.name);

const BACKGROUNDS = [
  {
    index: "acolyte", name: "Acolyte", srd: true, skills: ["insight", "religion"],
    tools: [], toolChoices: [], languages: [], languageChoices: { choose: 2, from: "any" },
    equipment: [eq("clothes-common"), eq("pouch"), eq("vestments"), eq("block-of-incense", 5), custom("Prayer book")],
    equipmentChoices: [{ desc: "a holy symbol", choose: 1, from: expandCategory("holy-symbols") }],
    gold: 15,
    feature: { name: "Shelter of the Faithful", desc: null /* filled from SRD below */ },
    suggestions: {
      traits: ["I find a lesson from scripture in every small mishap.", "I greet strangers with a blessing, whether they want one or not.", "Silence makes me uneasy, so I fill it with quiet prayer.", "I keep a tally of every kindness I owe and every kindness I'm owed."],
      ideals: ["Devotion. My faith is the lantern I carry into dark places.", "Mercy. Every soul deserves a chance at redemption.", "Order. The temple's rites hold back chaos; I will keep them.", "Curiosity. The divine is a mystery I mean to understand."],
      bonds: ["The shrine that raised me is my true home, and I'd die to protect it.", "I carry a relic I swore to return to its rightful resting place.", "My old mentor vanished on pilgrimage, and I mean to find out why.", "The faithful of my village look to me; I won't let them down."],
      flaws: ["I'm quick to judge those who don't share my beliefs.", "I trust anyone who wears the vestments of my order, even when I shouldn't.", "I secretly doubt the miracles I preach about.", "I'd rather pray about a problem than act on it."],
    },
  },
  {
    index: "charlatan", name: "Charlatan", srd: false, skills: ["deception", "sleightOfHand"],
    tools: ["Disguise Kit", "Forgery Kit"], toolChoices: [], languages: [], languageChoices: null,
    equipment: [eq("clothes-fine"), eq("disguise-kit"), eq("pouch")],
    equipmentChoices: [{ desc: "tools of the con", choose: 1, from: [custom("Ten stoppered bottles of coloured water"), custom("Set of weighted dice"), custom("Deck of marked cards"), custom("Signet ring of an imaginary duke")] }],
    gold: 15,
    feature: { name: "False Identity", desc: "You keep a second, fully fleshed-out persona ready to wear, complete with papers, acquaintances and a believable history. You can also forge documents such as permits or letters of introduction, provided you have seen an example of the real thing." },
    suggestions: {
      traits: ["I can't resist sizing up every room for marks.", "I laugh a little too easily at other people's jokes.", "I collect names and titles and drop them whenever it helps.", "I tell a different story about my past to every person I meet."],
      ideals: ["Freedom. No chains, no masters, no fixed address.", "Fairness. I only swindle those who can afford to lose.", "Ambition. One big score and I'm set for life.", "Friendship. My crew is the only family I trust."],
      bonds: ["I owe a dangerous debt to the person who taught me the trade.", "A mark I ruined years ago haunts my conscience.", "I'm saving every coin to buy back my sibling's freedom.", "There's a noble I swear I'll humiliate someday."],
      flaws: ["I can't walk away from an easy mark, even when it's a trap.", "When cornered, I lie by reflex, even to friends.", "I spend money faster than I steal it.", "I'm convinced I'm the cleverest person in any room."],
    },
  },
  {
    index: "criminal", name: "Criminal", srd: false, skills: ["deception", "stealth"],
    tools: ["Thieves' Tools"], toolChoices: [{ desc: "one type of gaming set", choose: 1, from: GAMING }],
    languages: [], languageChoices: null,
    equipment: [eq("crowbar"), custom("Dark common clothes with a hood"), eq("pouch")],
    equipmentChoices: [],
    gold: 15,
    feature: { name: "Criminal Contact", desc: "You have a reliable go-between in the underworld who can pass messages to and from your old network. Through this contact you can reach fences, smugglers and informants in most places you have worked." },
    suggestions: {
      traits: ["I always sit facing the door.", "I keep a backup plan for my backup plan.", "I speak softly and say little, so people lean in to listen.", "I know the price of everything, and I can't help appraising it."],
      ideals: ["Honour among thieves. I never betray my crew.", "Survival. Rules are luxuries for people with full bellies.", "Redemption. I want to make up for the harm I've done.", "Greed. Gold is the only thing that's never lied to me."],
      bonds: ["I'm protecting someone who doesn't know what I really do.", "My old gang left me for dead, and I want answers.", "A guard captain once showed me mercy; I owe them.", "Somewhere out there is the job that went wrong, and I mean to finish it."],
      flaws: ["When I see something valuable, I start planning how to take it.", "I flee at the first sign that a plan is falling apart.", "I can't bring myself to trust anyone in uniform.", "I hold grudges long after everyone else has forgotten."],
    },
  },
  {
    index: "entertainer", name: "Entertainer", srd: false, skills: ["acrobatics", "performance"],
    tools: ["Disguise Kit"], toolChoices: [{ desc: "one type of musical instrument", choose: 1, from: INSTRUMENTS }],
    languages: [], languageChoices: null,
    equipment: [eq("clothes-costume"), custom("Favour of an admirer"), eq("pouch")],
    equipmentChoices: [{ desc: "a musical instrument", choose: 1, from: expandCategory("musical-instruments") }],
    gold: 15,
    feature: { name: "By Popular Demand", desc: "Wherever there is a stage, a tavern corner or a festival square, you can find a place to perform. In exchange for performing you get free modest lodging and food, and locals tend to recognise and warm to you." },
    suggestions: {
      traits: ["I turn every tavern into an audience.", "I hum when I'm nervous, which is most of the time.", "I remember every face from every crowd I've played to.", "I can't let a dull silence pass without a joke."],
      ideals: ["Beauty. Art makes the world worth saving.", "Fame. I want my name sung long after I'm gone.", "Joy. A good show can lift the heaviest heart.", "Honesty. My best performances tell the truth."],
      bonds: ["My old troupe is scattered, and I want to reunite them.", "I play a song written by someone I loved and lost.", "A rival stole my signature act, and I'll prove it was mine.", "I perform to raise coin for the orphanage that raised me."],
      flaws: ["I'll do almost anything for applause.", "I can't resist mocking pompous people to their faces.", "Bad reviews keep me up at night.", "I drink to steady my nerves before every show, and after."],
    },
  },
  {
    index: "folk-hero", name: "Folk Hero", srd: false, skills: ["animalHandling", "survival"],
    tools: ["Land Vehicles"], toolChoices: [{ desc: "one type of artisan's tools", choose: 1, from: ARTISAN }],
    languages: [], languageChoices: null,
    equipment: [eq("shovel"), eq("pot-iron"), eq("clothes-common"), eq("pouch")],
    equipmentChoices: [{ desc: "a set of artisan's tools", choose: 1, from: expandCategory("artisans-tools") }],
    gold: 10,
    feature: { name: "Rustic Hospitality", desc: "Ordinary country folk know your story and see you as one of their own. They will hide you, shelter you and feed you, as long as doing so doesn't put their own lives at risk." },
    suggestions: {
      traits: ["I judge people by their hands: calloused is honest.", "I tell the story of my great deed slightly differently every time.", "I'm uncomfortable being called a hero.", "I fix things that are broken, even when nobody asked."],
      ideals: ["Fairness. Nobody should be above the law.", "Courage. Somebody has to stand up first.", "Community. We look after our own.", "Destiny. I was meant for more than the fields."],
      bonds: ["My home village still counts on me.", "The tyrant I defied is still out there.", "I keep a token from the person I saved.", "I want to earn the legend people already tell about me."],
      flaws: ["I rush in before I've thought things through.", "I'm suspicious of nobles and their fine manners.", "Praise goes straight to my head.", "I can't admit when I'm out of my depth."],
    },
  },
  {
    index: "guild-artisan", name: "Guild Artisan", srd: false, skills: ["insight", "persuasion"],
    tools: [], toolChoices: [{ desc: "one type of artisan's tools", choose: 1, from: ARTISAN }],
    languages: [], languageChoices: { choose: 1, from: "any" },
    equipment: [custom("Letter of introduction from your guild"), eq("clothes-travelers"), eq("pouch")],
    equipmentChoices: [{ desc: "a set of artisan's tools", choose: 1, from: expandCategory("artisans-tools") }],
    gold: 15,
    feature: { name: "Guild Membership", desc: "Your guild offers you lodging and food if needed, legal help when you are accused of a crime, and introductions to powerful patrons. In return you pay modest monthly dues and must keep the guild's good name." },
    suggestions: {
      traits: ["I can't see shoddy work without offering to fix it.", "I measure everything twice, including people.", "I talk about my craft until someone changes the subject.", "I haggle out of habit, even when the price is fair."],
      ideals: ["Craft. Doing a thing well is its own reward.", "Prosperity. Hard work should lead to a full purse.", "Tradition. The guild's ways have kept us strong.", "Generosity. My skills should help those who can't pay."],
      bonds: ["My workshop is the one place I truly belong.", "I'm searching for a legendary tool once owned by my guild's founder.", "A rival guild ruined my mentor, and I'll set it right.", "I made something that was used for evil, and I must destroy it."],
      flaws: ["I'll do nearly anything to get my hands on a rare material.", "I'm quick to take offence at criticism of my work.", "I can't keep a secret about a good deal.", "I look down on people who don't have a trade."],
    },
  },
  {
    index: "hermit", name: "Hermit", srd: false, skills: ["medicine", "religion"],
    tools: ["Herbalism Kit"], toolChoices: [], languages: [], languageChoices: { choose: 1, from: "any" },
    equipment: [eq("case-map-or-scroll", 1, "Scroll case stuffed with notes"), eq("blanket", 1, "Winter blanket"), eq("clothes-common"), eq("herbalism-kit")],
    equipmentChoices: [],
    gold: 5,
    feature: { name: "Discovery", desc: "Your long seclusion led you to a unique and powerful insight: a hidden truth about the world, a lost secret, or a clue to something greater. Work out with the DM what it is and how it might shape the story." },
    suggestions: {
      traits: ["I talk to animals, plants and occasionally rocks.", "I'm unnervingly calm when others panic.", "I forget that most people find long silences awkward.", "I write down my dreams every morning."],
      ideals: ["Solitude. Clarity comes when the noise falls away.", "Knowledge. The truth I found must be understood.", "Compassion. Healing others is the purpose of my learning.", "Balance. Everything in nature has its place."],
      bonds: ["The secret I discovered could change everything.", "I left my retreat to stop a danger only I foresaw.", "I'm searching for the teacher who first sent me into isolation.", "My hermitage was destroyed, and I want to know who did it."],
      flaws: ["I'm hopeless with city manners and social cues.", "I'm convinced I'm right, because I've had years to think it through.", "I hoard herbs, scraps and notes compulsively.", "I keep people at arm's length, even friends."],
    },
  },
  {
    index: "noble", name: "Noble", srd: false, skills: ["history", "persuasion"],
    tools: [], toolChoices: [{ desc: "one type of gaming set", choose: 1, from: GAMING }],
    languages: [], languageChoices: { choose: 1, from: "any" },
    equipment: [eq("clothes-fine"), eq("signet-ring"), custom("Scroll of pedigree"), custom("Purse", 1)],
    equipmentChoices: [],
    gold: 25,
    feature: { name: "Position of Privilege", desc: "Your family name opens doors. People assume you have the right to be wherever you are, commoners try to accommodate you, and you can usually secure an audience with local nobility." },
    suggestions: {
      traits: ["I expect good service and say thank you when I get it.", "My manners are flawless, even in a sewer.", "I quote my family's motto far too often.", "I'm genuinely curious about how ordinary people live."],
      ideals: ["Responsibility. Privilege is a debt owed to those below me.", "Power. My family will rise, whatever it costs.", "Honour. A promise from my house is unbreakable.", "Independence. I want to prove myself without my name."],
      bonds: ["I will restore my family's lost lands and honour.", "I'm betrothed to someone I've never met.", "A servant who raised me is the person I trust most.", "My younger sibling is the heir, and I protect them fiercely."],
      flaws: ["I secretly believe I'm better than everyone else.", "I can't stand being told no.", "I spend money as if it will never run out.", "I hide a scandal that could ruin my family."],
    },
  },
  {
    index: "outlander", name: "Outlander", srd: false, skills: ["athletics", "survival"],
    tools: [], toolChoices: [{ desc: "one type of musical instrument", choose: 1, from: INSTRUMENTS }],
    languages: [], languageChoices: { choose: 1, from: "any" },
    equipment: [eq("quarterstaff", 1, "Staff (quarterstaff)"), eq("hunting-trap"), custom("Trophy from an animal you killed"), eq("clothes-travelers"), eq("pouch")],
    equipmentChoices: [],
    gold: 10,
    feature: { name: "Wanderer", desc: "You have an excellent memory for maps and terrain and can always recall the general layout of land, settlements and landmarks around you. In the wild you can find enough food and fresh water for yourself and up to five others each day, if the land offers any." },
    suggestions: {
      traits: ["I'm more comfortable under the stars than under a roof.", "I eat like every meal might be my last.", "I name every animal I meet.", "I stare too long at people, the way I'd watch a predator."],
      ideals: ["Nature. The wild is sacred and must be protected.", "Strength. The strong survive; I intend to be strong.", "Tribe. My people's ways guide everything I do.", "Discovery. There's always another valley to explore."],
      bonds: ["My tribe was scattered, and I'll find every survivor.", "A great beast took something from me; I'll hunt it down.", "I carry my ancestors' stories so they're never forgotten.", "The forest I grew up in is threatened by settlers."],
      flaws: ["I don't understand why city folk follow so many rules.", "I solve problems with my fists before my words.", "I distrust anything that comes out of a library.", "I'm slow to forgive any slight to my people."],
    },
  },
  {
    index: "sage", name: "Sage", srd: false, skills: ["arcana", "history"],
    tools: [], toolChoices: [], languages: [], languageChoices: { choose: 2, from: "any" },
    equipment: [eq("ink-1-ounce-bottle", 1, "Bottle of black ink"), eq("ink-pen", 1, "Quill"), eq("small-knife"), custom("Letter from a dead colleague with an unanswered question"), eq("clothes-common"), eq("pouch")],
    equipmentChoices: [],
    gold: 10,
    feature: { name: "Researcher", desc: "When you don't know a piece of lore, you usually know where to find it: a library, a scholar, a sage, or an archive. The DM may rule that some knowledge is guarded or lost, which can become an adventure of its own." },
    suggestions: {
      traits: ["I correct people's grammar without meaning to.", "I've read about almost everything and done almost nothing.", "I take notes during conversations.", "I get distracted by any book within reach."],
      ideals: ["Knowledge. Understanding is the path to power and peace.", "Truth. Lies and myths must be exposed.", "Legacy. My work should outlive me.", "Wonder. The universe is too fascinating to waste time on spite."],
      bonds: ["I'm chasing the answer to my late colleague's question.", "My academy's library burned, and I want to know why.", "I've sworn to protect a dangerous text from the wrong hands.", "My rival's theories are wrong, and I will prove it."],
      flaws: ["I overlook obvious danger when something interests me.", "I speak in long lectures without noticing the yawns.", "I'll trade almost anything for a rare book.", "I assume people who haven't studied can't be clever."],
    },
  },
  {
    index: "sailor", name: "Sailor", srd: false, skills: ["athletics", "perception"],
    tools: ["Navigator's Tools", "Water Vehicles"], toolChoices: [], languages: [], languageChoices: null,
    equipment: [eq("club", 1, "Belaying pin (club)"), eq("rope-silk-50-feet"), custom("Lucky charm"), eq("clothes-common"), eq("pouch")],
    equipmentChoices: [],
    gold: 10,
    feature: { name: "Ship's Passage", desc: "You can usually arrange free passage on a sailing ship for yourself and your companions, as long as you're willing to help crew it. The voyage happens on the captain's schedule, not yours." },
    suggestions: {
      traits: ["I have a sea shanty for every occasion.", "I tie knots in anything that sits still.", "I read the sky for weather every morning.", "I swear like a deckhand, even in temples."],
      ideals: ["Freedom. The open sea answers to no king.", "Crew. You never leave a shipmate behind.", "Mastery. I'll captain my own ship someday.", "Respect. The sea humbles everyone eventually."],
      bonds: ["My old ship went down, and I'm the only survivor.", "I owe my life to a captain who's now a wanted pirate.", "There's a sweetheart waiting in a port I can't return to.", "I'm hunting the sea monster that took my brother."],
      flaws: ["I follow orders, even when I shouldn't.", "I'll gamble my last coin on a dice game.", "I can't resist a challenge to drink someone under the table.", "I'm superstitious to the point of paralysis."],
    },
  },
  {
    index: "soldier", name: "Soldier", srd: false, skills: ["athletics", "intimidation"],
    tools: ["Land Vehicles"], toolChoices: [{ desc: "one type of gaming set", choose: 1, from: GAMING }],
    languages: [], languageChoices: null,
    equipment: [custom("Insignia of rank"), custom("Trophy taken from a fallen enemy"), eq("clothes-common"), eq("pouch")],
    equipmentChoices: [{ desc: "a set of bone dice or a deck of cards", choose: 1, from: [eq("dice-set"), eq("playing-card-set")] }],
    gold: 10,
    feature: { name: "Military Rank", desc: "You held rank in an army, and soldiers loyal to that organisation still recognise your authority. You can requisition simple equipment or horses for temporary use and usually gain access to friendly military camps and fortresses." },
    suggestions: {
      traits: ["I stand at attention when I'm nervous.", "I keep my gear spotless and judge those who don't.", "I've got a war story for everything, mostly true.", "I eat fast and sleep light."],
      ideals: ["Duty. I do what must be done.", "Protection. The weak shelter behind my shield.", "Glory. I want to be remembered for my deeds.", "Peace. I fight so others won't have to."],
      bonds: ["I'd lay down my life for the people I served with.", "I still carry the banner of my fallen company.", "An officer betrayed us, and I'll see justice done.", "I fight for the land and family I left behind."],
      flaws: ["I obey authority without question, even bad authority.", "I made a terrible mistake in battle that I can't talk about.", "I have little patience for those who've never fought.", "Loud noises put me right back on the battlefield."],
    },
  },
  {
    index: "urchin", name: "Urchin", srd: false, skills: ["sleightOfHand", "stealth"],
    tools: ["Disguise Kit", "Thieves' Tools"], toolChoices: [], languages: [], languageChoices: null,
    equipment: [eq("small-knife"), custom("Map of the city you grew up in"), custom("Pet mouse"), custom("Token to remember your parents by"), eq("clothes-common"), eq("pouch")],
    equipmentChoices: [],
    gold: 10,
    feature: { name: "City Secrets", desc: "You know the back alleys, rooftops and sewer runs of cities. Outside of combat, you and your companions can travel between any two places in a city about twice as fast as your speed would normally allow." },
    suggestions: {
      traits: ["I squirrel away food in my pockets.", "I sleep with my back to a wall.", "I bargain hard because I've never had enough.", "I'm fiercely loyal to anyone who's kind to me."],
      ideals: ["Community. Those of us who have nothing stick together.", "Change. Nobody should grow up the way I did.", "Independence. I've never needed anyone, and I never will.", "Opportunity. Every street corner hides a chance."],
      bonds: ["I'm saving up to give the street kids a real home.", "A shopkeeper who fed me once is a friend for life.", "I'm searching for the parent who abandoned me.", "My little sister is still on the streets, and I'll get her out."],
      flaws: ["I'll grab anything that isn't nailed down.", "I flinch when anyone raises a hand near me.", "I can't stand being in debt to anyone.", "I run first and ask questions later."],
    },
  },
];
{
  const srdAcolyte = raw.backgrounds.find((b) => b.index === "acolyte");
  const aco = BACKGROUNDS.find((b) => b.index === "acolyte");
  aco.feature = { name: srdAcolyte.feature.name, desc: joinDesc(srdAcolyte.feature.desc) };
  aco.skills = srdAcolyte.starting_proficiencies.map((p) => skillFromProf(p.index));
  aco.gold = srdAcolyte.starting_gold?.quantity ?? 15;
}
const backgrounds = BACKGROUNDS;

// ─── spells ────────────────────────────────────────────────────────────────────────────────
function rangeFt(r) {
  if (!r) return null;
  if (/^self/i.test(r)) return 0;
  if (/^touch/i.test(r)) return 5;
  let m = r.match(/^(\d+)\s*(feet|foot|ft)/i);
  if (m) return Number(m[1]);
  m = r.match(/^(\d+)\s*miles?/i);
  if (m) return Number(m[1]) * 5280;
  return null;
}
function cleanScaled(map, which /* 0 primary, else secondary */) {
  if (!map) return undefined;
  const out = {};
  let addMod = false;
  for (const [k, v] of Object.entries(map)) {
    let s = String(v);
    if (/MOD/.test(s)) { addMod = true; s = s.replace(/\s*\+\s*MOD/g, ""); }
    if (/ OR /.test(s)) {
      const parts = s.split(/\s+OR\s+/);
      s = which === 0 ? parts[parts.length - 1] : parts[0];
    }
    out[k] = cleanDice(s);
  }
  return { map: out, addMod };
}
const spells = raw.spells.map((s) => {
  const o = {
    index: s.index, name: s.name, level: s.level, school: s.school.index,
    castingTime: s.casting_time, range: s.range, rangeFt: rangeFt(s.range),
    components: s.components || [], material: s.material || null, duration: s.duration,
    concentration: !!s.concentration, ritual: !!s.ritual,
    desc: joinDesc(s.desc), higherLevel: joinDesc(s.higher_level) || null,
    attackType: s.attack_type || null,
    area: s.area_of_effect ? { type: s.area_of_effect.type, size: s.area_of_effect.size } : null,
    damage: null, heal: null,
    dc: s.dc ? { ability: s.dc.dc_type.index, success: s.dc.dc_success } : null,
    classes: (s.classes || []).map((c) => c.index),
    subclasses: (s.subclasses || []).map((c) => c.index),
  };
  const dmg = (s.damage || []).map((d, i) => {
    const slot = cleanScaled(d.damage_at_slot_level, i);
    const chr = cleanScaled(d.damage_at_character_level, i);
    const e = { type: d.damage_type?.index ?? null };
    if (slot) e.atSlot = slot.map;
    if (chr) e.atCharLevel = chr.map;
    if (slot?.addMod || chr?.addMod) e.addMod = true;
    return e;
  });
  if (s.index === "sleep") {
    // SRD data lists the affected hit points as "damage"; it isn't damage. 5d8 +2d8 per slot above 1st.
    const atSlot = {};
    for (let l = 1; l <= 9; l++) atSlot[l] = `${5 + 2 * (l - 1)}d8`;
    o.effectDice = { atSlot };
  } else if (dmg.length) {
    if (s.index === "prismatic-spray") dmg[0].type = "varies";
    o.damage = dmg[0];
    if (dmg.length > 1) o.extraDamage = dmg.slice(1);
  }
  if (s.heal_at_slot_level) {
    const h = cleanScaled(s.heal_at_slot_level, 0);
    o.heal = { atSlot: h.map };
    if (h.addMod) o.heal.addMod = true;
  }
  if (s.index === "false-life" || s.index === "aid") o.heal.temp = s.index === "false-life";
  return o;
});

// ─── monsters ──────────────────────────────────────────────────────────────────────────────
const SIZE_CELLS = { Tiny: 1, Small: 1, Medium: 1, Large: 2, Huge: 3, Gargantuan: 4 };
const ft = (s) => {
  const m = String(s).match(/(\d+)\s*ft/);
  return m ? Number(m[1]) : null;
};
const crText = (cr) => (cr === 0.125 ? "1/8" : cr === 0.25 ? "1/4" : cr === 0.5 ? "1/2" : String(cr));
function parseArea(desc) {
  let m = desc.match(/(\d+)-foot(?:-radius)?[- ](cone|line|cube|sphere|cylinder)/i);
  if (m) return { type: m[2].toLowerCase(), size: Number(m[1]) };
  m = desc.match(/(\d+)-foot[- ]radius/i);
  if (m) return { type: "sphere", size: Number(m[1]) };
  m = desc.match(/(?:each|every) creature within (\d+) (?:ft\.|feet) of (?:it|the \w+|itself)/i);
  if (m) return { type: "sphere", size: Number(m[1]), self: true };
  return null;
}
const dmgList = (list) => {
  const main = [];
  const alts = [];
  for (const d of list || []) {
    if (d.damage_dice) main.push({ dice: cleanDice(d.damage_dice), type: d.damage_type?.index ?? null });
    else if (d.from?.options) {
      const opts = d.from.options.filter((x) => x.damage_dice);
      if (opts.length) {
        main.push({ dice: cleanDice(opts[0].damage_dice), type: opts[0].damage_type?.index ?? null, ...(opts[0].notes ? { notes: opts[0].notes } : {}) });
        for (const x of opts.slice(1)) alts.push([{ dice: cleanDice(x.damage_dice), type: x.damage_type?.index ?? null, ...(x.notes ? { notes: x.notes } : {}) }]);
      }
    }
  }
  return { main, alts };
};
function dcOf(dc, desc) {
  if (!dc) return null;
  let success = dc.success_type || "none";
  if (/half as much damage/i.test(desc || "")) success = "half";
  return { ability: dc.dc_type.index, value: dc.dc_value, success };
}
function usageOf(u) {
  if (!u) return undefined;
  if (u.type === "recharge on roll") return { type: "recharge", min: u.min_value };
  if (u.type === "per day") return { type: "perDay", times: u.times };
  if (u.type === "recharge after rest") return { type: "perRest", rests: u.rest_types };
  if (u.type === "at will") return undefined;
  return { type: u.type };
}
function compileAction(a) {
  const desc = (a.desc || "").replace(/’/g, "'");
  const o = { name: a.name, desc };
  let kind = "other";
  if (a.multiattack_type || /^multiattack$/i.test(a.name)) kind = "multiattack";
  else if (/Melee (?:or Ranged )?(?:Weapon|Spell) Attack/i.test(desc)) kind = "melee";
  else if (/Ranged (?:Weapon|Spell) Attack/i.test(desc)) kind = "ranged";
  else if (a.dc || /DC \d+ \w+ saving throw/i.test(desc)) kind = "save";
  o.kind = kind;
  o.attackBonus = a.attack_bonus ?? null;
  const { main, alts } = dmgList(a.damage);
  o.damage = main;
  if (alts.length) o.damageAlt = alts;
  const reach = desc.match(/reach (\d+) ft/i);
  o.reachFt = reach ? Number(reach[1]) : kind === "melee" ? 5 : null;
  const range = desc.match(/range (\d+)(?:\/(\d+))? ft/i);
  o.rangeFt = range ? { normal: Number(range[1]), long: range[2] ? Number(range[2]) : null } : null;
  let dc = dcOf(a.dc, desc);
  if (!dc) {
    const m = desc.match(/DC (\d+) (Strength|Dexterity|Constitution|Intelligence|Wisdom|Charisma) saving throw/i);
    if (m) dc = { ability: m[2].slice(0, 3).toLowerCase(), value: Number(m[1]), success: /half as much damage/i.test(desc) ? "half" : "none" };
  }
  o.dc = dc;
  const area = parseArea(desc);
  if (area) o.area = area;
  if (kind === "multiattack") {
    if (a.actions?.length) o.multiattack = a.actions.map((x) => ({ name: x.action_name, count: Number(x.count) || 1 }));
    if (a.action_options?.from?.options) {
      const sets = a.action_options.from.options.map((opt) =>
        opt.option_type === "multiple"
          ? opt.items.map((x) => ({ name: x.action_name, count: Number(x.count) || 1 }))
          : [{ name: opt.action_name, count: Number(opt.count) || 1 }]
      );
      if (!o.multiattack) o.multiattack = sets[0];
      else sets.unshift(o.multiattack);
      const alt = sets.filter((s) => s !== o.multiattack);
      if (alt.length) o.multiattackAlt = alt;
    }
    if (!o.multiattack) o.multiattack = [];
  }
  const variants = a.options?.from?.options || a.attacks;
  if (variants?.length) {
    o.options = variants.map((v) => {
      const vd = dmgList(v.damage).main;
      const line = desc.split("\n").find((l) => l.startsWith(v.name)) || "";
      const vo = { name: v.name, dc: dcOf(v.dc, line), damage: vd };
      const ar = parseArea(line);
      if (ar) vo.area = ar;
      return vo;
    });
    if (o.kind === "other") o.kind = "save";
  }
  const usage = usageOf(a.usage);
  if (usage) o.usage = usage;
  const cost = a.name.match(/\(Costs (\d+) Actions\)/i);
  if (cost) o.cost = Number(cost[1]);
  return o;
}
function compileSpellcasting(abilities) {
  for (const sa of abilities || []) {
    const sc = sa.spellcasting;
    if (!sc) continue;
    const out = { name: sa.name, ability: sc.ability?.index ?? null, dc: sc.dc ?? null, attack: sc.modifier ?? null };
    if (sc.level) out.level = sc.level;
    if (sc.slots) out.slots = sc.slots;
    const idx = (sp) => (sp.url ? sp.url.split("/").pop() : camel(sp.name));
    const atWill = [];
    const perDay = {};
    const leveled = [];
    for (const sp of sc.spells || []) {
      const u = sp.usage;
      if (u?.type === "at will") atWill.push(idx(sp));
      else if (u?.type === "per day") (perDay[u.times] = perDay[u.times] || []).push(idx(sp));
      else leveled.push(idx(sp));
    }
    if (leveled.length) out.spells = leveled;
    if (atWill.length) out.atWill = atWill;
    if (Object.keys(perDay).length) out.perDay = perDay;
    return out;
  }
  return undefined;
}
const monsters = raw.monsters.map((m) => {
  const saves = {};
  const skillsM = {};
  for (const p of m.proficiencies || []) {
    const i = p.proficiency.index;
    if (i.startsWith("saving-throw-")) saves[i.slice(13)] = p.value;
    else if (i.startsWith("skill-")) skillsM[skillFromProf(i)] = p.value;
  }
  const speed = {};
  for (const [k, v] of Object.entries(m.speed || {})) {
    if (k === "hover") speed.hover = !!v;
    else { const n = ft(v); if (n != null) speed[k] = n; }
  }
  const senses = {};
  for (const [k, v] of Object.entries(m.senses || {})) {
    if (k === "passive_perception") senses.passivePerception = v;
    else { const n = ft(v); if (n != null) senses[k] = n; }
  }
  const acEntry = m.armor_class[0];
  let acDesc = acEntry.type === "armor" ? (acEntry.armor || []).map((a) => a.name.toLowerCase()).join(", ") : acEntry.type === "natural" ? "natural armor" : acEntry.type === "dex" ? "" : acEntry.type;
  if (acEntry.desc) acDesc = acEntry.desc;
  const o = {
    index: m.index, name: m.name, size: m.size, sizeCells: SIZE_CELLS[m.size] || 1,
    type: m.type, subtype: m.subtype || null, alignment: m.alignment,
    ac: acEntry.value, acDesc: acDesc || null,
    hp: m.hit_points, hitDice: m.hit_dice, hpRoll: cleanDice(m.hit_points_roll || m.hit_dice),
    speed,
    abilities: {
      str: m.strength, dex: m.dexterity, con: m.constitution, int: m.intelligence, wis: m.wisdom, cha: m.charisma,
    },
    saves, skills: skillsM, senses,
    languages: m.languages || "",
    cr: m.challenge_rating, crText: crText(m.challenge_rating), xp: m.xp, prof: m.proficiency_bonus,
    resistances: m.damage_resistances || [], immunities: m.damage_immunities || [],
    vulnerabilities: m.damage_vulnerabilities || [],
    conditionImmunities: (m.condition_immunities || []).map((c) => c.index),
    traits: (m.special_abilities || []).map((t) => {
      const tr = { name: t.name, desc: (t.desc || "").replace(/’/g, "'") };
      const u = usageOf(t.usage);
      if (u) tr.usage = u;
      return tr;
    }),
    actions: (m.actions || []).map(compileAction),
    reactions: (m.reactions || []).map(compileAction),
    legendary: (m.legendary_actions || []).map(compileAction),
  };
  const sc = compileSpellcasting(m.special_abilities);
  if (sc) o.spellcasting = sc;
  if (m.bonus_actions?.length) o.bonusActions = m.bonus_actions.map(compileAction);
  return o;
});

// ─── simple lists ──────────────────────────────────────────────────────────────────────────
const conditions = raw.conditions.map((c) => ({ index: c.index, name: c.name, desc: joinDesc(c.desc) }));
const languages = raw.languages.map((l) => ({
  index: l.index, name: l.name, type: l.type, script: l.script || null, speakers: l.typical_speakers || [],
}));

const variantParent = new Map();
for (const mi of raw.magicItems) for (const v of mi.variants || []) variantParent.set(v.index, mi.index);
const magicItems = raw.magicItems.map((mi) => {
  const typeLine = (mi.desc[0] || "").replace(/’/g, "'");
  const o = {
    index: mi.index, name: mi.name, rarity: mi.rarity?.name ?? "Varies", type: mi.equipment_category?.name ?? null,
    typeLine, desc: joinDesc(mi.desc.slice(1)), attunement: /requires attunement/i.test(typeLine),
  };
  const at = typeLine.match(/\(requires attunement([^)]*)\)/i);
  if (at && at[1].trim()) o.attunementNote = at[1].trim();
  if (mi.variants?.length) o.variants = mi.variants.map((v) => v.index);
  if (variantParent.has(mi.index)) o.variantOf = variantParent.get(mi.index);
  return o;
});

// ─── write ─────────────────────────────────────────────────────────────────────────────────
fs.mkdirSync(OUT, { recursive: true });
const outputs = {
  "classes.json": classes,
  "races.json": races,
  "backgrounds.json": backgrounds,
  "spells.json": spells,
  "monsters.json": monsters,
  "equipment.json": equipment,
  "features.json": features,
  "conditions.json": conditions,
  "skills.json": skills,
  "magic-items.json": magicItems,
  "languages.json": languages,
};
let total = 0;
for (const [file, data] of Object.entries(outputs)) {
  const json = JSON.stringify(data);
  fs.writeFileSync(path.join(OUT, file), json);
  total += Buffer.byteLength(json);
  console.log(`${file.padEnd(18)} ${String(data.length).padStart(4)} entries  ${(Buffer.byteLength(json) / 1024).toFixed(1).padStart(7)} KB`);
}
console.log(`total ${(total / 1024).toFixed(1)} KB -> ${path.relative(ROOT, OUT)}`);
