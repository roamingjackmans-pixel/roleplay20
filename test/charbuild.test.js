import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STANDARD_ARRAY, POINT_BUY_COSTS, pointBuyCost, racialBonuses, buildCharacter, startingEquipmentOptions,
  spellOptions, levelUpPlan, applyLevelUp, resolveStartingEquipment, ALIGNMENTS,
} from "../shared/charbuild.js";
import { deriveCharacter, byIndex, xpForLevel } from "../shared/rules.js";

const SRD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shared", "srd");
const load = (n) => JSON.parse(fs.readFileSync(path.join(SRD_DIR, `${n}.json`), "utf8"));
const srd = {
  classes: load("classes"), races: load("races"), backgrounds: load("backgrounds"), spells: load("spells"),
  equipment: load("equipment"), features: load("features"), conditions: load("conditions"), skills: load("skills"),
  magicItems: load("magic-items"), languages: load("languages"),
};
const race = (i) => byIndex(srd.races).get(i);
const names = (ch) => ch.features.map((f) => f.name);
const equippedNames = (ch) => ch.equipment.filter((i) => i.equipped).map((i) => i.name);

const CHARACTER_KEYS = ["id", "ownerId", "campaignId", "name", "playerName", "race", "subrace", "class", "subclass", "level", "xp",
  "classes", "background", "alignment", "abilities", "abilityMethod", "skillProfs", "saveProfs", "otherProfs", "hp", "hitDice",
  "deathSaves", "acOverride", "speed", "darkvision", "equipment", "currency", "spellcasting", "resources", "features",
  "conditions", "exhaustion", "inspiration", "concentration", "personality", "appearance", "backstory", "portrait", "color", "light"];

test("ability score helpers", () => {
  assert.deepEqual(STANDARD_ARRAY, [15, 14, 13, 12, 10, 8]);
  assert.equal(POINT_BUY_COSTS[15], 9);
  assert.equal(POINT_BUY_COSTS[8], 0);
  assert.equal(pointBuyCost({ str: 15, dex: 15, con: 15, int: 8, wis: 8, cha: 8 }), 27);
  assert.equal(pointBuyCost({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }), 9 + 7 + 5 + 4 + 2);
  assert.equal(pointBuyCost({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }), Infinity);
  assert.equal(ALIGNMENTS.length, 9);
});

test("racialBonuses", () => {
  assert.deepEqual(racialBonuses(race("dwarf"), "hill-dwarf", null, srd), { con: 2, wis: 1 });
  assert.deepEqual(racialBonuses("elf", "high-elf", null, srd), { dex: 2, int: 1 });
  assert.deepEqual(racialBonuses(race("human"), null), { str: 1, dex: 1, con: 1, int: 1, wis: 1, cha: 1 });
  assert.deepEqual(racialBonuses(race("half-elf"), null, ["dex", "con"]), { cha: 2, dex: 1, con: 1 });
  assert.deepEqual(racialBonuses(race("half-elf"), null, { bonusChoices: ["str", "str", "wis"] }), { cha: 2, str: 1, wis: 1 });
  assert.deepEqual(racialBonuses(race("half-elf"), null, { int: 1, wis: 1 }), { cha: 2, int: 1, wis: 1 });
  assert.deepEqual(racialBonuses(race("half-elf"), null, ["cha", "dex"]), { cha: 2, dex: 1 }, "cha is not a valid half-elf choice");
});

test("startingEquipmentOptions expands categories into concrete choices", () => {
  const opts = startingEquipmentOptions("fighter", srd);
  assert.equal(opts.length, 4);
  for (const set of opts) {
    assert.ok(set.desc && set.choose === 1 && set.options.length >= 1);
    for (const o of set.options) {
      assert.ok(typeof o.label === "string" && Array.isArray(o.items) && Array.isArray(o.picks));
      for (const it of o.items) assert.ok(it.index && it.name && it.qty >= 1);
    }
  }
  const [shieldOpt, twoOpt] = opts[1].options;
  assert.deepEqual(shieldOpt.items.map((i) => i.index), ["shield"]);
  assert.equal(shieldOpt.picks[0].choose, 1);
  assert.equal(shieldOpt.picks[0].from.length, 23);
  assert.ok(shieldOpt.picks[0].from.some((i) => i.index === "longsword"));
  assert.equal(twoOpt.picks[0].choose, 2);
  assert.deepEqual(opts[0].options[1].items.map((i) => `${i.qty}x${i.index}`), ["1xleather-armor", "1xlongbow", "20xarrow"]);
  // every class: every option resolvable to real equipment
  for (const cls of srd.classes) {
    const sets = startingEquipmentOptions(cls.index, srd);
    for (const s of sets) for (const o of s.options) {
      for (const it of [...o.items, ...o.picks.flatMap((p) => p.from)]) assert.ok(byIndex(srd.equipment).get(it.index), `${cls.index}: ${it.index}`);
      for (const p of o.picks) assert.ok(p.from.length >= 1, `${cls.index}: empty pick ${p.desc}`);
    }
  }
  // the cleric's chain mail is flagged
  const cleric = startingEquipmentOptions("cleric", srd);
  assert.equal(cleric[1].options[2].note, "if proficient");
  assert.deepEqual(startingEquipmentOptions("nope", srd), []);
});

test("resolveStartingEquipment honours selections", () => {
  const items = resolveStartingEquipment("fighter", [1, { option: 1, picks: [["rapier", "scimitar"]] }, 1, 0], srd);
  const idx = items.map((i) => i.index);
  assert.deepEqual(idx, ["leather-armor", "longbow", "arrow", "rapier", "scimitar", "handaxe", "dungeoneers-pack"]);
  assert.equal(items.find((i) => i.index === "handaxe").qty, 2);
});

test("buildCharacter: L1 hill dwarf life cleric with chain mail + shield (AC 18)", () => {
  const ch = buildCharacter({
    name: "Brom", race: "dwarf", subrace: "hill-dwarf", class: "cleric", subclass: "life", background: "acolyte",
    baseAbilities: { str: 14, dex: 8, con: 13, int: 10, wis: 15, cha: 12 }, abilityMethod: "standard",
    equipment: [1, 2, 0, 0, 0], skills: ["medicine", "history"], cantrips: ["sacred-flame", "guidance", "spare-the-dying"],
    spells: ["guiding-bolt", "healing-word", "shield-of-faith", "sanctuary"], tools: ["Brewer's Supplies"], languages: ["Elvish", "Celestial"],
    personality: { traits: "Calm" },
  }, srd);
  for (const k of CHARACTER_KEYS) assert.ok(k in ch, `character has ${k}`);
  assert.deepEqual(ch.classes, [{ class: "cleric", subclass: "life", level: 1 }]);
  assert.deepEqual(ch.abilities, { str: 14, dex: 8, con: 15, int: 10, wis: 16, cha: 12 });
  assert.equal(ch.hp.max, 8 + 2 + 1, "max hit die + Con + dwarven toughness");
  assert.deepEqual(ch.hitDice, { die: 8, total: 1, used: 0 });
  assert.deepEqual(ch.saveProfs, ["wis", "cha"]);
  assert.deepEqual(Object.keys(ch.skillProfs).sort(), ["history", "insight", "medicine", "religion"]);
  assert.equal(ch.speed, 25);
  assert.equal(ch.darkvision, 60);
  assert.ok(ch.otherProfs.armor.includes("Heavy Armor"), "Life domain bonus proficiency");
  assert.ok(ch.otherProfs.weapons.includes("Warhammers"));
  assert.ok(ch.otherProfs.tools.includes("Brewer's Supplies"));
  assert.deepEqual(ch.otherProfs.languages, ["Common", "Dwarvish", "Elvish", "Celestial"]);
  assert.ok(equippedNames(ch).includes("Chain Mail"));
  assert.ok(equippedNames(ch).includes("Shield"));
  assert.ok(ch.equipment.every((i) => /^it_[a-z0-9]{8}$/.test(i.id)));
  assert.ok(ch.equipment.some((i) => i.name === "Torch" || i.name === "Candle"), "packs are expanded");
  assert.equal(ch.currency.gp, 15);
  assert.ok(names(ch).includes("Disciple of Life"));
  assert.ok(names(ch).includes("Dwarven Toughness"));
  assert.ok(names(ch).includes("Shelter of the Faithful"));
  assert.ok(ch.features.every((f) => f.name && f.source && f.level >= 1 && typeof f.desc === "string"));
  assert.deepEqual(ch.spellcasting.cantrips, ["sacred-flame", "guidance", "spare-the-dying"]);
  assert.deepEqual(ch.spellcasting.alwaysPrepared, ["bless", "cure-wounds"]);
  assert.deepEqual(ch.spellcasting.prepared, ["bless", "cure-wounds", "guiding-bolt", "healing-word", "shield-of-faith", "sanctuary"]);
  assert.deepEqual(ch.spellcasting.slotsUsed, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(ch.personality.traits, "Calm");
  assert.equal(ch.color, "#e5c07b");
  const d = deriveCharacter(ch, srd);
  assert.equal(d.ac, 18);
  assert.equal(d.spellcasting.preparedMax, 4);
});

test("buildCharacter: L3 high-elf wizard has 4/2 slots and a 10-spell spellbook", () => {
  const ch = buildCharacter({ name: "Ilyra", race: "elf", subrace: "high-elf", class: "wizard", subclass: "evocation", background: "sage", level: 3,
    baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 10 }, raceCantrip: "light", hpMethod: "average" }, srd);
  const d = deriveCharacter(ch, srd);
  assert.deepEqual(d.spellcasting.slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(d.spellcasting.mode, "spellbook");
  assert.equal(ch.spellcasting.known.length, 10);
  assert.equal(ch.spellcasting.prepared.length, 3 + 3);
  assert.equal(ch.spellcasting.cantrips.length, 4, "3 wizard cantrips + high elf cantrip");
  assert.ok(ch.spellcasting.cantrips.includes("light"));
  assert.deepEqual(ch.spellcasting.innate, [{ spell: "light", ability: "int", source: "High Elf", level: 0 }]);
  assert.ok(ch.spellcasting.known.some((s) => byIndex(srd.spells).get(s).level === 2), "has 2nd-level spells at 3rd level");
  assert.equal(ch.hp.max, 6 + 1 + 2 * (4 + 1));
  assert.equal(ch.subclass, "evocation");
  assert.ok(names(ch).includes("Sculpt Spells"));
  assert.ok(ch.skillProfs.perception, "Keen Senses");
  assert.equal(d.spellcasting.dc, 13);
  assert.equal(ch.equipment.find((i) => i.index === "spellbook")?.qty, 1);
});

test("buildCharacter: L5 human champion fighter", () => {
  const ch = buildCharacter({ name: "Aldric", race: "human", class: "fighter", subclass: "champion", background: "soldier", level: 5,
    baseAbilities: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, fightingStyle: "defense",
    equipment: [0, { option: 0, picks: [["longsword"]] }, 0, 1], asi: [{ str: 2 }], hpMethod: "max" }, srd);
  assert.equal(ch.abilities.str, 18);
  assert.equal(ch.hp.max, (10 + 2) * 5);
  const d = deriveCharacter(ch, srd);
  assert.equal(d.ac, 19);
  assert.equal(d.prof, 3);
  assert.equal(d.attacksPerAction, 2);
  const ls = d.attacks.find((a) => a.name === "Longsword");
  assert.equal(ls.bonus, 7);
  assert.equal(ls.damage, "1d8+4");
  assert.equal(ls.critRange, 19);
  assert.ok(names(ch).includes("Extra Attack"));
  assert.ok(names(ch).includes("Fighting Style: Defense"));
  assert.ok(!names(ch).includes("Ability Score Improvement"));
  const res = Object.fromEntries(d.resources.map((r) => [r.key, r]));
  assert.equal(res.secondWind.max, 1);
  assert.equal(res.actionSurge.max, 1);
  assert.deepEqual(Object.keys(ch.resources).sort(), ["actionSurge", "secondWind"]);
});

test("buildCharacter: L2 lightfoot halfling rogue with expertise", () => {
  const ch = buildCharacter({ name: "Pip", race: "halfling", class: "rogue", background: "urchin", level: 2,
    baseAbilities: { str: 8, dex: 15, con: 14, int: 12, wis: 10, cha: 13 },
    skills: ["perception", "acrobatics", "investigation", "deception"], expertise: ["stealth", "perception"] }, srd);
  assert.equal(ch.subrace, "lightfoot-halfling", "only subrace is the default");
  assert.equal(ch.skillProfs.stealth, 2);
  assert.equal(ch.skillProfs.perception, 2);
  assert.equal(ch.skillProfs.sleightOfHand, 1);
  const d = deriveCharacter(ch, srd);
  assert.equal(d.skills.stealth, 3 + 4);
  assert.equal(d.passive.perception, 14);
  assert.equal(d.ac, 14);
  assert.equal(d.speed, 25);
  assert.ok(d.attacks.find((a) => a.name === "Rapier" || a.name === "Shortsword").sneakAttack);
  assert.ok(names(ch).includes("Cunning Action"));
  assert.ok(ch.otherProfs.languages.includes("Thieves' Cant"));
  assert.equal(ch.hp.max, 8 + 2 + 5 + 2);
});

test("multiclass paladin 2 / sorcerer 3 via applyLevelUp uses the multiclass table", () => {
  let ch = buildCharacter({ name: "Seren", race: "half-elf", class: "paladin", background: "noble", level: 2,
    baseAbilities: { str: 15, dex: 10, con: 13, int: 8, wis: 12, cha: 15 }, bonusChoices: ["str", "con"] }, srd);
  const plan = levelUpPlan(ch, srd, "sorcerer");
  assert.equal(plan.multiclass, true);
  assert.equal(plan.prereqOk, true);
  assert.equal(plan.subclassChoice, true, "sorcerers pick an origin at 1st level");
  assert.equal(plan.cantripsToPick, 4);
  assert.equal(plan.spellsToPick, 2);
  ch = applyLevelUp(ch, { class: "sorcerer", subclass: "draconic", featureOptions: { "dragon-ancestor": "red" } }, srd);
  ch = applyLevelUp(ch, { class: "sorcerer", hp: 6 }, srd);
  ch = applyLevelUp(ch, { class: "sorcerer" }, srd);
  assert.equal(ch.level, 5);
  assert.deepEqual(ch.classes.map((c) => `${c.class}${c.level}`), ["paladin2", "sorcerer3"]);
  assert.equal(ch.class, "paladin");
  const d = deriveCharacter(ch, srd);
  assert.deepEqual(d.spellcasting.slots, [4, 3, 0, 0, 0, 0, 0, 0, 0], "caster level 1 + 3 = 4");
  assert.equal(d.prof, 3);
  assert.ok(names(ch).includes("Dragon Ancestor: Red - Fire Damage"));
  assert.ok(ch.spellcasting.cantrips.length >= 4);
  // Con 13 +1 (half-elf) = 14. HP: paladin 10+2, 6+2 ; sorcerer (4+2)+1, (6+2)+1, (4+2)+1 (draconic resilience)
  assert.equal(ch.abilities.con, 14);
  assert.equal(ch.hp.max, 12 + 8 + 7 + 9 + 7);
  assert.equal(d.saves.cha, 3 + 3, "multiclass doesn't add sorcerer saves");
  assert.ok(ch.resources.sorceryPoints);
});

test("multiclass prerequisites", () => {
  const ch = buildCharacter({ race: "human", class: "wizard", baseAbilities: { str: 8, dex: 14, con: 13, int: 15, wis: 12, cha: 8 } }, srd);
  assert.equal(levelUpPlan(ch, srd, "paladin").prereqOk, false);
  assert.equal(levelUpPlan(ch, srd, "rogue").prereqOk, true);
  assert.equal(levelUpPlan(ch, srd, "fighter").prereqOk, true, "fighter: Str OR Dex 13");
});

test("spellOptions", () => {
  const w = spellOptions("wizard", 1, srd);
  assert.equal(w.cantripsToPick, 3);
  assert.equal(w.spellsToPick, 6);
  assert.ok(w.cantrips.every((s) => s.level === 0 && s.classes.includes("wizard")));
  assert.ok(w.spells.every((s) => s.level === 1));
  assert.equal(spellOptions("wizard", 3, srd).maxSpellLevel, 2);
  assert.equal(spellOptions("bard", 1, srd).spellsToPick, 4);
  assert.equal(spellOptions("cleric", 1, srd, { abilities: { wis: 16 } }).spellsToPick, 4);
  assert.deepEqual(spellOptions("cleric", 3, srd, { subclass: "life" }).alwaysPrepared, ["bless", "cure-wounds", "lesser-restoration", "spiritual-weapon"]);
  assert.equal(spellOptions("paladin", 1, srd).spellsToPick, 0);
  assert.equal(spellOptions("paladin", 2, srd, { abilities: { cha: 16 } }).spellsToPick, 4);
  assert.equal(spellOptions("ranger", 2, srd).spellsToPick, 2);
  assert.equal(spellOptions("warlock", 1, srd).spellsToPick, 2);
  assert.equal(spellOptions("fighter", 5, srd).spellsToPick, 0);
});

test("levelUpPlan: ASI levels, subclass choice, new spells", () => {
  const at = (cls, level, extra = {}) => buildCharacter({ race: "human", class: cls, level, ...extra }, srd);
  assert.equal(levelUpPlan(at("fighter", 3), srd).asi, true);
  assert.equal(levelUpPlan(at("fighter", 5), srd).asi, true, "fighter 6");
  assert.equal(levelUpPlan(at("wizard", 5), srd).asi, false);
  assert.equal(levelUpPlan(at("fighter", 2), srd).subclassChoice, true);
  assert.equal(levelUpPlan(at("fighter", 3), srd).subclassChoice, false);
  assert.equal(levelUpPlan(at("wizard", 1), srd).subclassChoice, true);
  assert.equal(levelUpPlan(at("cleric", 1), srd).subclassChoice, false);
  const wiz3 = levelUpPlan(at("wizard", 3), srd);
  assert.equal(wiz3.cantripsToPick, 1);
  assert.equal(wiz3.spellsToPick, 2);
  const wiz4 = levelUpPlan(at("wizard", 4), srd);
  assert.equal(wiz4.maxSpellLevel, 3);
  assert.deepEqual(wiz4.slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.equal(levelUpPlan(at("bard", 2), srd).expertiseToPick, 2);
  assert.equal(levelUpPlan(at("bard", 2), srd).skillsToPick, 3, "college of lore bonus proficiencies");
  const pal = levelUpPlan(at("paladin", 1), srd);
  assert.ok(pal.featureChoices.some((f) => f.index === "paladin-fighting-style" && f.options.length === 4));
  assert.ok(pal.features.some((f) => f.name === "Divine Smite"));
  assert.equal(pal.hpDie, 10);
  assert.equal(pal.hpAverage, 6);
  const sorc = levelUpPlan(at("sorcerer", 2), srd);
  assert.ok(sorc.featureChoices.some((f) => f.index === "metamagic-1" && f.choose === 2));
  const lock = levelUpPlan(at("warlock", 1), srd);
  assert.ok(lock.featureChoices.some((f) => f.index === "eldritch-invocations" && f.choose === 2));
});

test("applyLevelUp: HP, ASI with retroactive Con, features, spells", () => {
  const f3 = buildCharacter({ race: "human", class: "fighter", level: 3, baseAbilities: { str: 15, dex: 13, con: 13, int: 8, wis: 12, cha: 10 } }, srd);
  assert.equal(f3.abilities.con, 14);
  const f4 = applyLevelUp(f3, { asi: { con: 2 }, hp: 7 }, srd);
  assert.equal(f4.abilities.con, 16);
  assert.equal(f4.hp.max, f3.hp.max + (7 + 3) + 3, "rolled 7 + new Con 3, plus +1 for each of the 3 earlier levels");
  assert.equal(f4.hp.current, f4.hp.max);
  assert.equal(f4.level, 4);
  assert.equal(f4.hitDice.total, 4);
  assert.equal(f3.level, 3, "input is not mutated");
  const f5 = applyLevelUp(f4, {}, srd);
  assert.ok(names(f5).includes("Extra Attack"));
  assert.equal(f5.hp.max, f4.hp.max + 6 + 3, "average");
  const asi = applyLevelUp(f3, { asi: ["str", "dex"] }, srd);
  assert.equal(asi.abilities.str, f3.abilities.str + 1);
  assert.equal(asi.abilities.dex, f3.abilities.dex + 1);
  // fighter 6 is another ASI level; with no choice the primary ability gets +2
  const f6 = applyLevelUp(applyLevelUp(asi, {}, srd), {}, srd);
  assert.equal(f6.abilities.str, asi.abilities.str + 2);
  // ASI caps at 20
  const strong = applyLevelUp({ ...f3, abilities: { ...f3.abilities, str: 19 } }, { asi: { str: 2 } }, srd);
  assert.equal(strong.abilities.str, 20);
  // wizard gains spells and a subclass
  const w1 = buildCharacter({ race: "human", class: "wizard", level: 1 }, srd);
  const w2 = applyLevelUp(w1, { subclass: "evocation", spells: ["magic-missile", "sleep"] }, srd);
  assert.equal(w2.subclass, "evocation");
  assert.ok(names(w2).includes("Evocation Savant"));
  assert.equal(w2.spellcasting.known.length, 8);
  // a cleric's prepared list grows with level
  const c1 = buildCharacter({ race: "human", class: "cleric", level: 1, baseAbilities: { str: 10, dex: 10, con: 10, int: 10, wis: 16, cha: 10 } }, srd);
  const c2 = applyLevelUp(c1, {}, srd);
  assert.equal(c2.spellcasting.prepared.filter((s) => !(c2.spellcasting.alwaysPrepared || []).includes(s)).length, 3 + 2);
  assert.ok(c2.resources.channelDivinity);
  // paladin starts casting at 2
  const p1 = buildCharacter({ race: "human", class: "paladin", level: 1 }, srd);
  assert.equal(p1.spellcasting, null);
  const p2 = applyLevelUp(p1, { fightingStyle: "dueling" }, srd);
  assert.ok(p2.spellcasting && p2.spellcasting.prepared.length >= 1);
  assert.ok(names(p2).includes("Fighting Style: Dueling"));
  assert.equal(p2.xp, p1.xp);
  assert.ok(xpForLevel(p2.level) >= 0);
});

test("buildCharacter defaults: every race x class x level 1-5 builds a valid character", () => {
  let n = 0;
  for (const r of srd.races) for (const c of srd.classes) for (let level = 1; level <= 5; level++) {
    const bg = srd.backgrounds[n++ % srd.backgrounds.length].index;
    const ch = buildCharacter({ race: r.index, class: c.index, background: bg, level }, srd);
    const d = deriveCharacter(ch, srd);
    const tag = `${r.index} ${c.index} ${level}`;
    assert.ok(ch.hp.max >= level, tag);
    assert.ok(d.ac >= 10 && d.ac <= 20, `${tag} ac ${d.ac}`);
    assert.ok(d.attacks.some((a) => a.id === "unarmed"), tag);
    assert.ok(d.attacks.every((a) => /^(\d+d\d+([+-]\d+)?|\d+|)$/.test(a.damage)), `${tag} damage`);
    assert.equal(ch.level, level);
    assert.equal(ch.hitDice.total, level);
    assert.ok(Object.keys(ch.skillProfs).length >= 4, `${tag} skills`);
    if (d.spellcasting?.spellsKnown) assert.equal(ch.spellcasting.known.length, d.spellcasting.spellsKnown, `${tag} known`);
    if (d.spellcasting?.cantripsKnown) {
      const classCantrips = ch.spellcasting.cantrips.filter((s) => !(ch.spellcasting.innate || []).some((i) => i.spell === s));
      assert.equal(classCantrips.length, d.spellcasting.cantripsKnown, `${tag} cantrips`);
    }
    if (c.index === "wizard") assert.equal(ch.spellcasting.known.length, 6 + 2 * (level - 1), `${tag} spellbook`);
    for (const s of [...(ch.spellcasting?.known || []), ...(ch.spellcasting?.cantrips || [])]) assert.ok(byIndex(srd.spells).get(s), `${tag} spell ${s}`);
  }
});

test("levelling 1 -> 5 matches building directly at 5 (average HP)", () => {
  for (const c of srd.classes) {
    let ch = buildCharacter({ race: "half-orc", class: c.index, background: "soldier", level: 1 }, srd);
    for (let l = 2; l <= 5; l++) ch = applyLevelUp(ch, {}, srd);
    const direct = buildCharacter({ race: "half-orc", class: c.index, background: "soldier", level: 5, subclass: ch.subclass }, srd);
    assert.equal(ch.hp.max, direct.hp.max, c.index);
    assert.deepEqual(new Set(names(ch)), new Set(names(direct)), c.index);
    assert.deepEqual(deriveCharacter(ch, srd).spellcasting?.slots, deriveCharacter(direct, srd).spellcasting?.slots, c.index);
  }
});
