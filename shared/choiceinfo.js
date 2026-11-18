// shared/choiceinfo.js - what each choice in the character creator and the level-up wizard is, for hover tips.
// Pure ESM, no I/O. Every describe* returns { title, meta, text } (text is the app's small markdown) or null when
// the thing itself is missing. Descriptions come from the SRD data the app ships; where the SRD has no text for a
// choice (alignments, ability scores, ability-score methods, favoured enemy types, terrains, some plain gear), the
// short summaries below say what the choice does under the 5e rules.

import { SKILLS, byIndex } from "./rules.js";

export const ABILITY_LONG = { str: "Strength", dex: "Dexterity", con: "Constitution", int: "Intelligence", wis: "Wisdom", cha: "Charisma" };

export const CLASS_BLURB = {
  barbarian: "A storm of fury and muscle. Rages to shrug off blows and hit harder.",
  bard: "A performer whose words and music are literal magic. Inspires allies, charms foes.",
  cleric: "A chosen servant of a god. Heals, protects, and smites with divine power.",
  druid: "A keeper of the wild who wields nature magic and takes the shapes of beasts.",
  fighter: "A master of weapons and armor. Reliable, versatile, and hard to kill.",
  monk: "A disciplined martial artist who channels ki into blinding speed and strikes.",
  paladin: "A holy knight bound by an oath. Heavy armor, healing hands, radiant smites.",
  ranger: "A hunter and tracker of the wilds, deadly with bow and blade.",
  rogue: "A sneak, a scout, a specialist. Strikes precisely when the foe is distracted.",
  sorcerer: "Magic flows in your blood. Fewer spells, but you can bend them to your will.",
  warlock: "Power bargained from an otherworldly patron. Eldritch blasts and dark gifts.",
  wizard: "A scholar of the arcane with a spellbook full of world-shaping magic.",
};

export const ABILITY_INFO = {
  str: "Physical power: melee weapon attacks and damage, lifting, pushing, climbing, jumping and grappling. Heavy armor needs a minimum Strength or it slows you down.",
  dex: "Agility, reflexes and balance: ranged and finesse weapon attacks, Armor Class in light or medium armor (or none), and initiative in a fight.",
  con: "Health and stamina: your Constitution modifier is added to your hit points at every level, and it keeps your concentration on a spell when you get hurt.",
  int: "Memory, reasoning and study: recalling lore, spotting clues and working out puzzles. Wizards cast their spells with it.",
  wis: "Awareness and intuition: noticing danger, reading people and surviving in the wild. Clerics, druids and rangers cast their spells with it.",
  cha: "Force of personality: persuading, deceiving, intimidating and performing. Bards, paladins, sorcerers and warlocks cast their spells with it.",
};

export const ALIGNMENT_INFO = {
  "Lawful Good": "Does the right thing the way society expects: honour, duty and compassion together.",
  "Neutral Good": "Does the most good they can, helping others as needs arise, without being bound by rules or rebelling against them.",
  "Chaotic Good": "Follows their own conscience with little regard for what others expect: kind-hearted and free-spirited.",
  "Lawful Neutral": "Acts by law, tradition or a personal code, whatever the outcome.",
  Neutral: "Avoids taking sides on moral questions and does what seems best at the time.",
  "Chaotic Neutral": "Follows their whims and puts their own freedom above everything else.",
  "Lawful Evil": "Methodically takes what they want, within the limits of a code, a tradition or a loyalty.",
  "Neutral Evil": "Does whatever they can get away with, without compassion or second thoughts.",
  "Chaotic Evil": "Acts with arbitrary violence, driven by greed, hatred or bloodlust.",
};

export const ABILITY_METHOD_INFO = {
  standard: { title: "Standard array", text: "Use six fixed scores - 15, 14, 13, 12, 10 and 8 - and give each one to an ability. Quick, fair, and every hero starts equally strong." },
  pointbuy: { title: "Point buy", text: "Every score starts at 8 and you spend 27 points to raise them, up to 15 before racial bonuses. Higher scores cost more, so you shape exactly the hero you want." },
  roll: { title: "Roll 4d6", text: "Roll four six-sided dice six times, keep the best three each time, then place the results. Could be heroic, could be humble: the dice decide." },
  manual: { title: "Enter my own", text: "Type in scores you already have, for example ones you rolled at the table with your group watching." },
};

const FAVORED_ENEMY_INFO = {
  aberrations: "Utterly alien creatures from beyond the natural world, such as aboleths, chuuls, cloakers and otyughs.",
  beasts: "Ordinary animals and their giant kin: wolves, bears, great cats, giant spiders and the like.",
  celestials: "Beings of the upper planes, such as angels (devas, planetars), pegasi and unicorns.",
  constructs: "Things that were made, not born: golems, animated armor, flying swords and shield guardians.",
  dragons: "Dragons of every colour and metal, from young wyrmlings to ancient wyrms, plus wyverns.",
  elementals: "Living elements: air, earth, fire and water elementals, azers, salamanders, xorn and invisible stalkers.",
  fey: "Magical beings tied to nature and the realm of faerie: dryads, satyrs, sprites and hags.",
  fiends: "Creatures of the lower planes: demons, devils, hell hounds, night hags and rakshasas.",
  giants: "Hill, stone, frost, fire, cloud and storm giants, plus ogres, trolls and ettins.",
  monstrosities: "Unnatural beasts and frightening hybrids: owlbears, manticores, chimeras, basilisks and griffons.",
  oozes: "Shapeless, often acidic blobs: gelatinous cubes, black puddings, gray oozes and ochre jellies.",
  plants: "Living plants and fungi that move or fight: shambling mounds, treants, awakened trees and violet fungi.",
  undead: "Once-living creatures raised by dark magic: skeletons, zombies, ghouls, wights, wraiths and vampires.",
  humanoids: "Instead of a whole creature type, you pick two humanoid peoples (such as gnolls and orcs). Tell your DM which two.",
};
const FAVORED_ENEMY_RULE = "You have advantage on Wisdom (Survival) checks to track them and on Intelligence checks to recall information about them, and you learn one language they speak, if they have one.";

const TERRAIN_INFO = {
  arctic: "Frozen tundra, ice fields and snowbound wastes.",
  coast: "Shorelines, sea cliffs, beaches and tidal flats.",
  desert: "Sand seas, rocky badlands and scorching wastes.",
  forest: "Woodland of every kind, from light groves to deep, tangled forest.",
  grassland: "Open plains, prairies, steppes and rolling meadows.",
  mountain: "Peaks, passes, ridges and high foothills.",
  swamp: "Marshes, bogs, fens and mangrove swamps.",
};
const TERRAIN_RULE = "Here your proficiency bonus is doubled on Intelligence and Wisdom checks about the terrain (with a skill you're proficient in). Travelling there for an hour or more, difficult terrain doesn't slow your group, you can't get lost except by magic, you stay alert to danger, and you forage twice as much food.";

const GEAR_INFO = {
  "clothes-common": "Plain, sturdy everyday clothes.",
  "clothes-fine": "Fine clothes for court, feasts and impressing people.",
  "clothes-costume": "A costume for performing or for disguise.",
  "clothes-travelers": "Hard-wearing clothes for the road.",
  shovel: "A sturdy shovel for digging.",
  "pot-iron": "An iron cooking pot.",
  blanket: "A warm blanket for cold nights.",
  "signet-ring": "A ring bearing your family's or your house's seal.",
  "ink-1-ounce-bottle": "A small bottle of ink.",
  "ink-pen": "A pen for writing.",
  backpack: "A leather pack that carries most of your gear.",
  bedroll: "A padded roll to sleep on.",
  waterskin: "Holds about half a gallon of water.",
};

// ─── helpers ─────────────────────────────────────────────────────────────────────────────
const list = (a) => a.filter(Boolean).join(", ");
const sentence = (s) => (s ? String(s)[0].toUpperCase() + String(s).slice(1) : "");
const cap = (s) => String(s || "").replace(/(^|[\s-])(\w)/g, (m, a, b) => a + b.toUpperCase());
const titled = (s) => cap(String(s || "").replace(/-/g, " "));
const ord = (n) => (n === 1 ? "1st" : n === 2 ? "2nd" : n === 3 ? "3rd" : `${n}th`);
const find = (srd, coll, idx) => (idx == null ? undefined : byIndex(srd?.[coll]).get(idx));
const bonusText = (o) => Object.entries(o || {}).map(([k, v]) => `${ABILITY_LONG[k] || k} +${v}`).join(", ");
const para = (...parts) => parts.filter(Boolean).join("\n\n");
const bullets = (items) => items.filter(Boolean).map((x) => `- ${x}`).join("\n");

/** Shorten text to about `max` characters, ending on a sentence (or a word, with an ellipsis). */
export function brief(text, max = 240) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (stop > max * 0.3) return cut.slice(0, stop + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ") > 0 ? cut.lastIndexOf(" ") : max).replace(/[,;:]$/, "")}…`;
}

/** "Fighting Style: Archery" -> "Archery" (the name of an option without its feature's prefix). */
export function optionName(name) {
  const n = String(name || "").replace(/^[^:]+:\s*/, "");
  const m = /^(.*?)\s+-+\s+(.*)$/.exec(n);
  return m ? `${m[1]} (${m[2]})` : n;
}

function skillName(key, srd) {
  const s = (srd?.skills || []).find?.((x) => x.key === key);
  return s?.name || titled(String(key).replace(/([A-Z])/g, " $1"));
}

// ─── creator: concept ────────────────────────────────────────────────────────────────────
export function describeRace(race, srd) {
  if (!race) return null;
  const profs = race.proficiencies || {};
  const choiceBits = (race.proficiencyChoices || []).map((p) => `${p.choose} ${p.type === "skills" ? "skill" : "tool"}${p.choose > 1 ? "s" : ""} of your choice`);
  const profList = list([...(profs.armor || []), ...(profs.weapons || []), ...(profs.tools || []), ...(profs.skills || []).map((s) => skillName(s, srd)), ...choiceBits]);
  const facts = [
    `**Ability scores:** ${list([bonusText(race.abilityBonuses), race.bonusChoices ? `+${race.bonusChoices.amount} to ${race.bonusChoices.choose} others of your choice` : ""]) || "none"}`,
    `**Size and speed:** ${race.size || "Medium"}, ${race.speed || 30} ft${race.darkvision ? `; darkvision ${race.darkvision} ft` : ""}`,
    (race.languages?.length || race.languageChoices) && `**Languages:** ${list([...(race.languages || []), race.languageChoices ? `${race.languageChoices.choose} more of your choice` : ""])}`,
    profList && `**Proficiencies:** ${profList}`,
    race.resistances?.length && `**Resistance:** ${race.resistances.join(", ")} damage`,
    race.draconicAncestry?.length && `**Draconic ancestry:** ${race.draconicAncestry.map((a) => `${a.name} (${a.damageType})`).join(", ")}`,
    race.subraces?.length && `**Subraces:** ${race.subraces.map((s) => s.name).join(", ")}`,
  ].filter(Boolean);
  const traits = (race.traits || []).map((t) => `**${t.name}.** ${brief(t.desc, 200)}`);
  return {
    title: race.name,
    meta: [race.size, `${race.speed} ft`, race.darkvision ? `darkvision ${race.darkvision} ft` : ""].filter(Boolean).join(" · "),
    text: para(bullets(facts), bullets(traits)),
  };
}

export function describeSubrace(sub, race, srd) {
  if (!sub) return null;
  const profs = sub.proficiencies || {};
  const profList = list([...(profs.armor || []), ...(profs.weapons || []), ...(profs.tools || []), ...(profs.skills || []).map((s) => skillName(s, srd))]);
  const facts = [
    sub.abilityBonuses && Object.keys(sub.abilityBonuses).length && `**Ability scores:** ${bonusText(sub.abilityBonuses)} (on top of ${race?.name || "the race"}'s)`,
    sub.speed && sub.speed !== race?.speed && `**Speed:** ${sub.speed} ft`,
    sub.darkvision && sub.darkvision !== race?.darkvision && `**Darkvision:** ${sub.darkvision} ft`,
    profList && `**Proficiencies:** ${profList}`,
    sub.languageChoices && `**Languages:** ${sub.languageChoices.choose} extra of your choice`,
    sub.cantripChoice && `**Cantrip:** one wizard cantrip of your choice, cast with ${ABILITY_LONG[sub.cantripChoice.ability] || sub.cantripChoice.ability}`,
  ].filter(Boolean);
  const traits = (sub.traits || []).map((t) => `**${t.name}.** ${brief(t.desc, 200)}`);
  return {
    title: sub.name,
    meta: race ? `${race.name} subrace` : "Subrace",
    text: para(brief(sub.desc, 320), bullets(facts), bullets(traits)) || `A people of the ${race?.name || "race"}.`,
  };
}

const CAST_MODE = {
  prepared: "prepares spells each day from the whole class list",
  known: "knows a few spells by heart",
  spellbook: "copies spells into a spellbook and prepares them each day",
  pact: "casts with pact magic: few slots, always at full power, back after a short rest",
};

export function describeClass(cls, srd) {
  if (!cls) return null;
  const row1 = cls.levels?.[0];
  const feats1 = (row1?.features || []).filter((f) => !f.placeholder).map((f) => f.name);
  const sc = cls.spellcasting;
  const facts = [
    `**Hit points:** d${cls.hitDie} per level (${cls.hitDie} + Constitution at 1st level)`,
    cls.primaryAbility && `**Main ability:** ${ABILITY_LONG[cls.primaryAbility] || cls.primaryAbility}`,
    cls.saves?.length && `**Saving throws:** ${cls.saves.map((s) => ABILITY_LONG[s]).join(", ")}`,
    `**Armor:** ${list(cls.proficiencies?.armor || []) || "none"}`,
    `**Weapons:** ${list(cls.proficiencies?.weapons || []) || "none"}`,
    cls.skillChoices && `**Skills:** choose ${cls.skillChoices.choose} from ${cls.skillChoices.from.map((s) => skillName(s, srd)).join(", ")}`,
    sc && `**Magic:** casts with ${ABILITY_LONG[sc.ability] || sc.ability} from level ${sc.level || 1}; ${CAST_MODE[sc.mode] || "casts spells"}`,
    feats1.length && `**At 1st level:** ${feats1.join(", ")}`,
    cls.subclasses?.length && `**${cls.subclassFlavor || "Subclass"}** at level ${cls.subclassLevel || 3}: ${cls.subclasses.map((s) => s.name).join(", ")}`,
  ].filter(Boolean);
  return {
    title: cls.name,
    meta: [`d${cls.hitDie}`, ABILITY_LONG[cls.primaryAbility], sc ? "spellcaster" : ""].filter(Boolean).join(" · "),
    text: para(CLASS_BLURB[cls.index] || "", bullets(facts)),
  };
}

/** A subclass; `level` marks which of its features you'd have by then. */
export function describeSubclass(sub, cls, level = 20) {
  if (!sub) return null;
  const from = sub.level || cls?.subclassLevel || 3;
  const feats = (sub.features || []).filter((f) => !f.parent);
  const now = feats.filter((f) => f.level <= level).map((f) => `**${f.name}** (level ${f.level}). ${brief(f.desc, 170)}`);
  const later = feats.filter((f) => f.level > level).map((f) => `${f.name} (${f.level})`);
  return {
    title: sub.name,
    meta: `${cls?.subclassFlavor || "Subclass"}${cls ? ` · ${cls.name}` : ""} · from level ${from}`,
    text: para(brief(sub.desc, 420), now.length ? bullets(now) : "", later.length ? `**Later:** ${later.join(", ")}` : "") || `A ${cls?.name || ""} path.`,
  };
}

export function describeBackground(bg, srd) {
  if (!bg) return null;
  const items = list([...(bg.equipment || []).map((i) => `${i.qty > 1 ? `${i.qty} ` : ""}${i.name}`), ...(bg.equipmentChoices || []).map((g) => g.desc), bg.gold ? `${bg.gold} gp` : ""]);
  const facts = [
    bg.skills?.length && `**Skills:** ${bg.skills.map((s) => skillName(s, srd)).join(", ")}`,
    (bg.tools?.length || bg.toolChoices?.length) && `**Tools:** ${list([...(bg.tools || []), ...(bg.toolChoices || []).map((t) => t.desc)])}`,
    (bg.languages?.length || bg.languageChoices) && `**Languages:** ${list([...(bg.languages || []), bg.languageChoices ? `${bg.languageChoices.choose} of your choice` : ""])}`,
    items && `**Equipment:** ${items}`,
  ].filter(Boolean);
  return {
    title: bg.name,
    meta: bg.skills?.length ? bg.skills.map((s) => skillName(s, srd)).join(", ") : "Background",
    text: para(bullets(facts), bg.feature ? `**${bg.feature.name}.** ${brief(bg.feature.desc, 420)}` : ""),
  };
}

export function describeAlignment(name) {
  if (!name) return null;
  return {
    title: name,
    meta: "Alignment",
    text: para(ALIGNMENT_INFO[name] || "How your character tends to act.", "Alignment is a guide to how you roleplay your character; it doesn't change any of your numbers."),
  };
}

/** A campaign's character question (creator, optional). */
export function describeCharacterQuestion(q) {
  return {
    title: "A question from your campaign",
    meta: "Optional",
    text: para(String(q || ""), "Choose it and it stays in view on the Personality step; **Draft for me** answers it in your backstory."),
  };
}

export function describeNameIdea(name) {
  return { title: name, meta: "Name idea", text: "Use this as your character's name. You can still change it on the Concept step." };
}

// ─── abilities ───────────────────────────────────────────────────────────────────────────
export function describeAbility(key, srd) {
  if (!ABILITY_LONG[key]) return null;
  const skills = Object.entries(SKILLS).filter(([, a]) => a === key).map(([k]) => skillName(k, srd));
  return {
    title: ABILITY_LONG[key],
    meta: key.toUpperCase(),
    text: para(ABILITY_INFO[key], skills.length ? `**Skills:** ${skills.join(", ")}` : ""),
  };
}

export function describeAbilityMethod(method) {
  const m = ABILITY_METHOD_INFO[method];
  return m ? { title: m.title, meta: "Ability scores", text: m.text } : null;
}

/** A racial +N choice (half-elf). */
export function describeBonusChoice(key, amount, srd) {
  const a = describeAbility(key, srd);
  return a && { ...a, meta: `+${amount} ${a.meta}` };
}

// ─── skills ──────────────────────────────────────────────────────────────────────────────
export function describeSkill(key, srd) {
  const s = (srd?.skills || []).find?.((x) => x.key === key);
  const ability = s?.ability || SKILLS[key];
  if (!s && !ability) return null;
  return {
    title: s?.name || skillName(key, srd),
    meta: ABILITY_LONG[ability] || "",
    text: s?.desc || `A ${ABILITY_LONG[ability]} skill: your proficiency bonus is added to checks that use it.`,
  };
}

export function describeExpertise(key, srd) {
  const s = describeSkill(key, srd);
  return s && { ...s, meta: `Expertise · ${s.meta}`, text: para("**Expertise** doubles your proficiency bonus for checks with this skill.", s.text) };
}

// ─── spells ──────────────────────────────────────────────────────────────────────────────
export function describeSpell(s) {
  if (!s) return null;
  const kind = s.level ? `${ord(s.level)}-level ${String(s.school || "").toLowerCase()}` : `${String(s.school || "").toLowerCase()} cantrip`;
  const facts = [
    `**Casting time:** ${s.castingTime || "1 action"}`,
    `**Range:** ${s.range || "Self"}${s.area ? ` (${s.area.size}-ft ${s.area.type})` : ""}`,
    `**Components:** ${(s.components || []).join(", ") || "none"}${s.material ? ` (${s.material})` : ""}`,
    `**Duration:** ${s.concentration ? "Concentration, " : ""}${s.duration || "Instantaneous"}`,
  ];
  return {
    title: s.name,
    meta: kind + (s.ritual ? " (ritual)" : ""),
    text: para(facts.join(" · "), s.desc, s.higherLevel ? `**At higher levels.** ${s.higherLevel}` : ""),
  };
}

// ─── class feature options ───────────────────────────────────────────────────────────────
/** One option of a class feature: a fighting style, metamagic, invocation, pact boon, hunter's prey, ... */
export function describeFeatureOption(opt, feature) {
  if (!opt) return null;
  return {
    title: optionName(opt.name) || titled(opt.index),
    meta: feature?.name || "",
    text: opt.desc || brief(feature?.desc, 400) || `${optionName(opt.name)}: one of the ${feature?.name || "feature"} options.`,
  };
}

/** A ranger's favoured enemy type or favoured terrain (the SRD only lists the words, so these are summaries). */
export function describeStringOption(value, feature) {
  const key = String(value || "").toLowerCase();
  const enemy = /enemy|enemies/i.test(feature?.index || feature?.name || "") || key in FAVORED_ENEMY_INFO;
  if (enemy) {
    return { title: cap(key), meta: feature?.name || "Favored Enemy", text: para(FAVORED_ENEMY_INFO[key] || `${cap(key)} as your favoured enemy.`, FAVORED_ENEMY_RULE) };
  }
  return { title: cap(key), meta: feature?.name || "Favored Terrain", text: para(TERRAIN_INFO[key] || `${cap(key)} as your favoured terrain.`, TERRAIN_RULE) };
}

/** Any feature-choice option: `option` is { index, name, desc } (desc is empty for a ranger's enemy/terrain words). */
export function describeChoiceOption(option, feature) {
  if (!option) return null;
  const key = String(option.index || "").toLowerCase();
  const isWord = !option.desc && (key in FAVORED_ENEMY_INFO || key in TERRAIN_INFO || /favored-enemy|natural-explorer/.test(feature?.index || ""));
  return isWord ? describeStringOption(option.index, feature) : describeFeatureOption(option, feature);
}

// ─── equipment ───────────────────────────────────────────────────────────────────────────
/** One line of stats: "1d8 slashing, versatile (1d10)", "AC 16, heavy armor", "" for plain gear. */
export function itemSummary(ref, srd) {
  const e = find(srd, "equipment", ref?.index);
  if (!e) return "";
  if (e.type === "weapon") return list([e.damage ? `${e.damage} ${e.damageType}` : "no damage", e.versatile ? `versatile (${e.versatile})` : "", ...(e.properties || []).filter((p) => !["versatile", "monk", "ammunition"].includes(p)), e.range === "ranged" && e.rangeFt ? `range ${e.rangeFt.normal}/${e.rangeFt.long} ft` : ""]);
  if (e.type === "armor") return e.armorType === "shield" ? `+${e.ac} AC` : `AC ${e.ac}${e.dexBonus ? (e.maxDex != null ? ` + Dex (max ${e.maxDex})` : " + Dex") : ""}, ${e.armorType} armor`;
  if (e.type === "pack") return `${(e.contents || []).length} items`;
  return "";
}

export function describeItem(ref, srd) {
  if (!ref) return null;
  const e = find(srd, "equipment", ref.index);
  const name = `${ref.qty > 1 ? `${ref.qty} × ` : ""}${e?.name || ref.name || titled(ref.index)}`;
  if (!e) return { title: name, meta: "Starting gear", text: "Part of your starting kit." };
  if (e.type === "weapon") {
    const facts = [
      e.damage ? `**Damage:** ${e.damage} ${e.damageType}${e.versatile ? ` (${e.versatile} with two hands)` : ""}` : "**Damage:** none",
      e.properties?.length && `**Properties:** ${e.properties.filter((p) => p !== "monk").join(", ")}`,
      e.rangeFt && `**Range:** ${e.rangeFt.normal}/${e.rangeFt.long} ft`,
      e.throwFt && `**Thrown:** ${e.throwFt.normal}/${e.throwFt.long} ft`,
      e.reachFt && e.reachFt > 5 && `**Reach:** ${e.reachFt} ft`,
      e.special && brief(e.special, 200),
    ].filter(Boolean);
    return { title: name, meta: `${cap(e.category)} ${e.range} weapon`, text: bullets(facts) };
  }
  if (e.type === "armor") {
    const ac = e.armorType === "shield" ? `+${e.ac} to your Armor Class while you carry it in one hand` : `Armor Class ${e.ac}${e.dexBonus ? (e.maxDex != null ? ` + your Dexterity modifier (max ${e.maxDex})` : " + your Dexterity modifier") : ""}`;
    const facts = [ac, e.strMin ? `Needs Strength ${e.strMin}, or your speed drops by 10 ft` : "", e.stealthDisadvantage ? "Disadvantage on Stealth checks" : ""].filter(Boolean);
    return { title: name, meta: e.armorType === "shield" ? "Shield" : `${cap(e.armorType)} armor`, text: bullets(facts) };
  }
  if (e.type === "pack") {
    return { title: name, meta: "Equipment pack", text: `**Contains:** ${(e.contents || []).map((c) => `${c.qty > 1 ? `${c.qty} ` : ""}${c.name}`).join(", ")}` };
  }
  if (e.gearCategory === "ammunition") {
    return { title: name, meta: "Ammunition", text: "Each shot uses one. After a fight you can spend a minute searching to recover half of what you fired." };
  }
  const meta = e.type === "tool" ? "Tool" : titled(e.gearCategory || "gear");
  return { title: name, meta, text: e.desc ? brief(e.desc, 360) : GEAR_INFO[e.index] || `Adventuring gear${e.cost ? ` worth ${e.cost} gp` : ""}${e.weight ? `, ${e.weight} lb` : ""}.` };
}

/** A starting-equipment option ("(a) chain mail"), with what each item is. */
export function describeEquipmentOption(opt, srd) {
  if (!opt) return null;
  const lines = (opt.items || []).map((it) => {
    const e = find(srd, "equipment", it.index);
    // weapons and armor: their stats; packs, tools and gear: the start of what they are
    const s = e?.type === "weapon" || e?.type === "armor" ? itemSummary(it, srd) : brief(String(describeItem(it, srd)?.text || "").replace(/\*\*/g, ""), 150);
    return `**${it.qty > 1 ? `${it.qty} × ` : ""}${e?.name || it.name}**${s ? `: ${s}` : ""}`;
  });
  for (const p of opt.picks || []) lines.push(`**${sentence(p.desc)}** of your choice (pick ${p.choose > 1 ? `${p.choose}` : "it"} below)`);
  const extra = (opt.items || []).filter((it) => find(srd, "equipment", it.index)?.type === "armor" && find(srd, "equipment", it.index)?.strMin)
    .map((it) => `${find(srd, "equipment", it.index).name} needs Strength ${find(srd, "equipment", it.index).strMin}, or your speed drops by 10 ft.`);
  return {
    // one plain item: its real name (some SRD labels are clipped, e.g. "leather arm")
    title: opt.items?.length === 1 && !opt.picks?.length ? (find(srd, "equipment", opt.items[0].index)?.name || opt.items[0].name) : sentence(opt.label),
    meta: opt.note ? `Starting equipment (${opt.note})` : "Starting equipment",
    text: para(bullets(lines) || "Nothing extra.", ...extra),
  };
}

// ─── hit points and ability score improvements ───────────────────────────────────────────
export function describeHpMethod(method, die) {
  const d = Number(die) || 8;
  const avg = Math.floor(d / 2) + 1;
  if (method === "roll") return { title: `Roll d${d}`, meta: "Hit points", text: `Roll your d${d} once and keep what comes up, from 1 to ${d}. Your Constitution modifier is added, and you always gain at least 1 hit point.` };
  if (method === "max") return { title: "Max (generous)", meta: "Hit points", text: "Take the full hit die for every level after 1st, plus your Constitution modifier. More generous than the standard rules." };
  return { title: die ? `Take ${avg}` : "Average", meta: "Hit points", text: `Take the fixed amount${die ? ` for a d${d}: ${avg}` : " (half the hit die, plus 1)"} plus your Constitution modifier for each new level. Steady, never unlucky. This is the standard rule.` };
}

export function describeAsiMode(mode) {
  return mode === "one"
    ? { title: "+2 to one", meta: "Ability score improvement", text: "Raise one ability score by 2 (no higher than 20). The quickest way to boost your main ability." }
    : { title: "+1 / +1", meta: "Ability score improvement", text: "Raise two different ability scores by 1 each (no higher than 20). Handy for odd scores: a modifier goes up at every even number." };
}

/** An ability for an ability score improvement: what changes if you add `add` to `score`. */
export function describeAsiAbility(key, score, add, srd) {
  const a = describeAbility(key, srd);
  if (!a) return null;
  const s = Number(score) || 10;
  const to = Math.min(20, s + (Number(add) || 0));
  const mod = (v) => { const m = Math.floor((v - 10) / 2); return m >= 0 ? `+${m}` : `${m}`; };
  const change = s >= 20 ? "Already 20, the most an improvement can reach." : `${s} → ${to}, modifier ${mod(s)} → ${mod(to)}`;
  return { ...a, meta: change };
}

// ─── level up: which class gets the level ────────────────────────────────────────────────
/** What a class gives at `level` (for "which class gains the level?"). */
export function describeClassLevel(cls, level, subclassKey, { problems = [], prereqText = "" } = {}) {
  if (!cls) return null;
  const row = cls.levels?.[level - 1];
  const sub = cls.subclasses?.find((s) => s.index === subclassKey);
  const feats = [...(row?.features || []).filter((f) => !f.placeholder), ...((sub?.features || []).filter((f) => f.level === level && !f.parent))]
    .filter((f, i, a) => a.findIndex((x) => x.name === f.name) === i)
    .map((f) => `**${f.name}.** ${brief(f.desc, 170)}`);
  const multi = level === 1 && cls.multiclass;
  const mcProfs = multi ? list(["armor", "weapons", "tools"].flatMap((k) => cls.multiclass.proficiencies?.[k] || [])) : "";
  return {
    title: `${cls.name} ${level}`,
    meta: `d${cls.hitDie} hit die${row?.asi || (cls.asiLevels || []).includes(level) ? " · ability score improvement" : ""}`,
    text: para(
      level === 1 ? CLASS_BLURB[cls.index] : "",
      feats.length ? bullets(feats) : "No new class features at this level, but you still gain hit points and a higher level.",
      multi && `**Multiclassing:** needs ${prereqText || "the class's ability scores"}${mcProfs ? `; you gain ${mcProfs}` : ""}${cls.multiclass.skillChoices ? ` and ${cls.multiclass.skillChoices.choose} skill` : ""}.`,
      problems.length ? `**Not yet:** ${problems.join("; ")}.` : "",
    ),
  };
}
