import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  abilityMod, profBonus, SKILLS, SKILL_NAMES, ABILITIES, CONDITIONS, deriveCharacter, classResources, spellSlots,
  spellDamage, spellHealing, monsterSaveBonus, monsterSkillBonus, monsterInitiative, xpForLevel, levelForXp, byIndex,
  normName, encounterDifficulty, crToXp,
} from "../shared/rules.js";

const SRD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shared", "srd");
const load = (n) => JSON.parse(fs.readFileSync(path.join(SRD_DIR, `${n}.json`), "utf8"));
const srd = {
  classes: load("classes"), races: load("races"), backgrounds: load("backgrounds"), spells: load("spells"),
  equipment: load("equipment"), features: load("features"), conditions: load("conditions"), skills: load("skills"),
  magicItems: load("magic-items"), languages: load("languages"), monsters: load("monsters"),
};
const spell = (i) => byIndex(srd.spells).get(i);
const monster = (i) => byIndex(srd.monsters).get(i);

let n = 0;
const item = (index, extra = {}) => ({ id: `it_t${n++}`, name: byIndex(srd.equipment).get(index)?.name ?? index, index, qty: 1, equipped: true, attuned: false, notes: "", ...extra });
const mk = (o) => ({
  race: "human", subrace: null, abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
  skillProfs: {}, saveProfs: [], otherProfs: { armor: [], weapons: [], tools: [], languages: [] },
  equipment: [], features: [], resources: {}, conditions: [], speed: 30, ...o,
  classes: o.classes || [{ class: o.class || "fighter", subclass: o.subclass ?? null, level: o.level || 1 }],
});

test("abilityMod and profBonus", () => {
  const mods = { 1: -5, 3: -4, 8: -1, 9: -1, 10: 0, 11: 0, 12: 1, 15: 2, 18: 4, 20: 5, 30: 10 };
  for (const [s, m] of Object.entries(mods)) assert.equal(abilityMod(Number(s)), m, `score ${s}`);
  const pb = [2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6, 6, 6, 6];
  pb.forEach((p, i) => assert.equal(profBonus(i + 1), p, `level ${i + 1}`));
});

test("constants", () => {
  assert.deepEqual(ABILITIES, ["str", "dex", "con", "int", "wis", "cha"]);
  assert.equal(Object.keys(SKILLS).length, 18);
  assert.equal(SKILLS.sleightOfHand, "dex");
  assert.equal(SKILLS.animalHandling, "wis");
  assert.equal(SKILL_NAMES.sleightOfHand, "Sleight of Hand");
  for (const k of Object.keys(SKILLS)) assert.ok(SKILL_NAMES[k]);
  assert.ok(CONDITIONS.includes("prone") && CONDITIONS.includes("unconscious"));
  // skill keys match compiled SRD skills
  assert.deepEqual(Object.keys(SKILLS).sort(), srd.skills.map((s) => s.key).sort());
  for (const s of srd.skills) assert.equal(SKILLS[s.key], s.ability);
});

test("normName matches proficiency names leniently", () => {
  assert.equal(normName("Crossbows, light"), normName("Crossbow, light"));
  assert.equal(normName("Hand Crossbows"), normName("Crossbow, hand"));
  assert.equal(normName("Longswords"), normName("Longsword +1"));
  assert.equal(normName("Battleaxes"), normName("battleaxe"));
});

test("spellSlots: single-class tables", () => {
  const s = (cls, level) => spellSlots([{ class: cls, level }], srd);
  assert.deepEqual(s("wizard", 1).slots, [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("wizard", 3).slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("cleric", 5).slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("wizard", 20).slots, [4, 3, 3, 3, 3, 2, 2, 1, 1]);
  assert.deepEqual(s("paladin", 1).slots, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("paladin", 2).slots, [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("ranger", 3).slots, [3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("paladin", 5).slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("paladin", 9).slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(s("fighter", 5).slots, [0, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(s("fighter", 5).pact, null);
  // single-class tables agree with the compiled class tables for every caster and level
  for (const cls of ["bard", "cleric", "druid", "paladin", "ranger", "sorcerer", "wizard"]) {
    const table = byIndex(srd.classes).get(cls).levels;
    for (let l = 1; l <= 20; l++) assert.deepEqual(s(cls, l).slots, table[l - 1].slots, `${cls} ${l}`);
  }
});

test("spellSlots: warlock pact magic is separate", () => {
  assert.deepEqual(spellSlots([{ class: "warlock", level: 1 }], srd), { slots: [0, 0, 0, 0, 0, 0, 0, 0, 0], pact: { level: 1, slots: 1 } });
  assert.deepEqual(spellSlots([{ class: "warlock", level: 5 }], srd).pact, { level: 3, slots: 2 });
  assert.deepEqual(spellSlots([{ class: "warlock", level: 11 }], srd).pact, { level: 5, slots: 3 });
  const mc = spellSlots([{ class: "warlock", level: 2 }, { class: "wizard", level: 3 }], srd);
  assert.deepEqual(mc.slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(mc.pact, { level: 1, slots: 2 });
});

test("spellSlots: multiclass caster table", () => {
  // paladin 2 (half -> 1) + sorcerer 3 = caster level 4 -> 4/3
  assert.deepEqual(spellSlots([{ class: "paladin", level: 2 }, { class: "sorcerer", level: 3 }], srd).slots, [4, 3, 0, 0, 0, 0, 0, 0, 0]);
  // wizard 3 + cleric 2 = 5 -> 4/3/2
  assert.deepEqual(spellSlots([{ class: "wizard", level: 3 }, { class: "cleric", level: 2 }], srd).slots, [4, 3, 2, 0, 0, 0, 0, 0, 0]);
  // paladin 3 + ranger 3 = 1 + 1 = 2 -> 3
  assert.deepEqual(spellSlots([{ class: "paladin", level: 3 }, { class: "ranger", level: 3 }], srd).slots, [3, 0, 0, 0, 0, 0, 0, 0, 0]);
  // fighter levels don't count
  assert.deepEqual(spellSlots([{ class: "fighter", level: 5 }, { class: "wizard", level: 1 }], srd).slots, [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  // a paladin 1 can't cast, so a paladin 1 / wizard 3 uses the wizard table alone
  assert.deepEqual(spellSlots([{ class: "paladin", level: 1 }, { class: "wizard", level: 3 }], srd).slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  // works without srd
  assert.deepEqual(spellSlots([{ class: "bard", level: 4 }, { class: "druid", level: 4 }]).slots, [4, 3, 3, 2, 0, 0, 0, 0, 0]);
});

test("deriveCharacter: hill dwarf life cleric in chain mail + shield = AC 18", () => {
  const ch = mk({
    race: "dwarf", subrace: "hill-dwarf", class: "cleric", subclass: "life", level: 1,
    abilities: { str: 14, dex: 8, con: 15, int: 10, wis: 16, cha: 12 }, saveProfs: ["wis", "cha"],
    skillProfs: { insight: 1, religion: 1, medicine: 1, history: 1 }, speed: 25,
    otherProfs: { armor: ["Light Armor", "Medium Armor", "Heavy Armor", "Shields"], weapons: ["Simple Weapons", "Warhammers"], tools: [], languages: [] },
    equipment: [item("chain-mail"), item("shield"), item("warhammer"), item("mace", { equipped: false })],
    spellcasting: { ability: "wis", cantrips: ["sacred-flame"], known: [], prepared: ["bless"], slotsUsed: [1, 0, 0, 0, 0, 0, 0, 0, 0], pactUsed: 0 },
  });
  const d = deriveCharacter(ch, srd);
  assert.equal(d.ac, 18);
  assert.equal(d.speed, 25, "dwarves ignore the heavy armor Strength requirement");
  assert.equal(d.prof, 2);
  assert.equal(d.saves.wis, 5);
  assert.equal(d.saves.dex, -1);
  assert.equal(d.skills.insight, 5);
  assert.equal(d.passive.perception, 13);
  assert.equal(d.initiative, -1);
  assert.equal(d.hitDie, 8);
  assert.equal(d.spellcasting.dc, 13);
  assert.equal(d.spellcasting.attack, 5);
  assert.deepEqual(d.spellcasting.slots, [2, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(d.spellcasting.cantripsKnown, 3);
  assert.equal(d.spellcasting.preparedMax, 4);
  assert.equal(d.spellcasting.spellsKnown, null);
  assert.equal(d.spellcasting.mode, "prepared");
  const wh = d.attacks.find((a) => a.name === "Warhammer");
  assert.equal(wh.bonus, 4);
  assert.equal(wh.damage, "1d8+2");
  assert.equal(wh.versatile, "1d10+2");
  assert.equal(wh.kind, "melee");
  assert.equal(wh.reachFt, 5);
  assert.ok(!d.attacks.some((a) => a.name === "Mace"), "unequipped weapons are not attacks");
  assert.ok(d.attacks.some((a) => a.id === "unarmed"));
  assert.ok(d.resistances.includes("poison"));
});

test("deriveCharacter: armor rules (light, medium cap, heavy Str, shield, override)", () => {
  const dex18 = { str: 10, dex: 18, con: 10, int: 10, wis: 10, cha: 10 };
  assert.equal(deriveCharacter(mk({ abilities: dex18, equipment: [item("leather-armor")] }), srd).ac, 15);
  assert.equal(deriveCharacter(mk({ abilities: dex18, equipment: [item("hide-armor")] }), srd).ac, 14);
  assert.equal(deriveCharacter(mk({ abilities: dex18, equipment: [item("half-plate-armor"), item("shield")] }), srd).ac, 19);
  const heavy = deriveCharacter(mk({ abilities: { ...dex18, str: 12 }, equipment: [item("plate-armor")] }), srd);
  assert.equal(heavy.ac, 18);
  assert.equal(heavy.speed, 20, "Str below 15 in plate: -10 ft");
  assert.equal(deriveCharacter(mk({ abilities: { ...dex18, str: 15 }, equipment: [item("plate-armor")] }), srd).speed, 30);
  assert.equal(deriveCharacter(mk({ abilities: dex18 }), srd).ac, 14);
  assert.equal(deriveCharacter(mk({ abilities: dex18, equipment: [item("leather-armor", { equipped: false })] }), srd).ac, 14);
  assert.equal(deriveCharacter(mk({ abilities: dex18, acOverride: 21 }), srd).ac, 21);
  assert.equal(deriveCharacter(mk({ equipment: [item("chain-mail", { name: "Chain Mail +1" })] }), srd).ac, 17);
  assert.equal(deriveCharacter(mk({ features: [{ name: "Fighting Style: Defense" }], equipment: [item("chain-mail")] }), srd).ac, 17);
  assert.equal(deriveCharacter(mk({ features: [{ name: "Fighting Style: Defense" }] }), srd).ac, 10, "Defense needs armor");
  // item found by name when it has no index
  assert.equal(deriveCharacter(mk({ equipment: [{ id: "x", name: "Scale Mail", index: null, qty: 1, equipped: true }] }), srd).ac, 14);
  // Ring of Protection (attuned)
  assert.equal(deriveCharacter(mk({ equipment: [{ id: "r", name: "Ring of Protection", index: null, qty: 1, equipped: true, attuned: true }] }), srd).ac, 11);
});

test("deriveCharacter: unarmored defence (barbarian, monk, draconic sorcerer)", () => {
  const ab = { str: 16, dex: 14, con: 16, int: 8, wis: 14, cha: 10 };
  assert.equal(deriveCharacter(mk({ class: "barbarian", abilities: ab }), srd).ac, 15);
  assert.equal(deriveCharacter(mk({ class: "barbarian", abilities: ab, equipment: [item("shield")] }), srd).ac, 17);
  assert.equal(deriveCharacter(mk({ class: "barbarian", abilities: ab, equipment: [item("chain-shirt")] }), srd).ac, 15);
  assert.equal(deriveCharacter(mk({ class: "monk", abilities: ab }), srd).ac, 14);
  assert.equal(deriveCharacter(mk({ class: "monk", abilities: ab, equipment: [item("shield")] }), srd).ac, 14, "monk + shield: 10 + dex + shield");
  assert.equal(deriveCharacter(mk({ class: "sorcerer", subclass: "draconic", abilities: ab }), srd).ac, 15);
  assert.equal(deriveCharacter(mk({ class: "sorcerer", subclass: null, abilities: ab }), srd).ac, 12);
  assert.equal(deriveCharacter(mk({ class: "wizard", abilities: ab, mageArmor: true }), srd).ac, 15);
});

test("deriveCharacter: speed modifiers", () => {
  assert.equal(deriveCharacter(mk({ class: "monk", level: 2 }), srd).speed, 40);
  assert.equal(deriveCharacter(mk({ class: "monk", level: 6 }), srd).speed, 45);
  assert.equal(deriveCharacter(mk({ class: "monk", level: 2, equipment: [item("leather-armor")] }), srd).speed, 30);
  assert.equal(deriveCharacter(mk({ class: "barbarian", level: 5 }), srd).speed, 40);
  assert.equal(deriveCharacter(mk({ conditions: ["grappled"] }), srd).speed, 0);
  assert.equal(deriveCharacter(mk({ exhaustion: 2 }), srd).speed, 15);
  assert.equal(deriveCharacter(mk({ speed: null, race: "halfling" }), srd).speed, 25);
});

test("deriveCharacter: weapon attacks", () => {
  const ab = { str: 16, dex: 14, con: 10, int: 10, wis: 10, cha: 10 };
  const ch = mk({
    class: "fighter", level: 5, abilities: ab,
    otherProfs: { armor: [], weapons: ["Simple Weapons", "Martial Weapons"], tools: [], languages: [] },
    equipment: [item("longsword"), item("rapier"), item("longbow"), item("handaxe"), item("dagger", { name: "Dagger +1" }), item("net")],
  });
  const d = deriveCharacter(ch, srd);
  const at = Object.fromEntries(d.attacks.map((a) => [a.name, a]));
  assert.equal(at.Longsword.bonus, 6);
  assert.equal(at.Longsword.damage, "1d8+3");
  assert.equal(at.Longsword.versatile, "1d10+3");
  assert.equal(at.Rapier.bonus, 6, "finesse uses the better of Str/Dex");
  assert.equal(at.Longbow.kind, "ranged");
  assert.equal(at.Longbow.bonus, 5);
  assert.equal(at.Longbow.damage, "1d8+2");
  assert.deepEqual(at.Longbow.rangeFt, { normal: 150, long: 600 });
  assert.equal(at.Longbow.reachFt, null);
  assert.equal(at.Handaxe.kind, "melee");
  assert.deepEqual(at.Handaxe.rangeFt, { normal: 20, long: 60 }, "thrown range");
  assert.equal(at["Dagger +1"].bonus, 7);
  assert.equal(at["Dagger +1"].damage, "1d4+4");
  assert.equal(at.Net.damage, "");
  assert.equal(at["Unarmed Strike"].damage, "4");
  assert.equal(at["Unarmed Strike"].bonus, 6);
  assert.equal(d.attacksPerAction, 2);
  for (const a of d.attacks) {
    for (const k of ["id", "name", "kind", "bonus", "damage", "damageType", "rangeFt", "reachFt", "properties", "itemId"]) assert.ok(k in a, `${a.name} has ${k}`);
  }
  // not proficient: no proficiency bonus
  const wiz = deriveCharacter(mk({ class: "wizard", abilities: ab, otherProfs: { armor: [], weapons: [], tools: [], languages: [] }, equipment: [item("longsword")] }), srd);
  assert.equal(wiz.attacks[0].bonus, 3);
  assert.equal(wiz.attacks[0].proficient, false);
  // wizard proficiency comes from the class even if otherProfs is empty
  const wiz2 = deriveCharacter(mk({ class: "wizard", abilities: ab, otherProfs: {}, equipment: [item("dagger")] }), srd);
  assert.equal(wiz2.attacks[0].bonus, 5);
  // fighting styles
  const arch = deriveCharacter(mk({ ...ch, features: [{ name: "Fighting Style: Archery" }], equipment: [item("longbow")] }), srd);
  assert.equal(arch.attacks[0].bonus, 7);
  const duel = deriveCharacter(mk({ ...ch, features: [{ name: "Fighting Style: Dueling" }], equipment: [item("longsword")] }), srd);
  assert.equal(duel.attacks[0].damage, "1d8+5");
  assert.equal(duel.attacks[0].versatile, "1d10+3");
  // champion crit range
  assert.equal(deriveCharacter(mk({ ...ch, classes: [{ class: "fighter", subclass: "champion", level: 3 }] }), srd).attacks[0].critRange, 19);
});

test("deriveCharacter: monk martial arts", () => {
  const ab = { str: 10, dex: 16, con: 12, int: 10, wis: 14, cha: 8 };
  const d = deriveCharacter(mk({ class: "monk", level: 5, abilities: ab, equipment: [item("quarterstaff"), item("shortsword"), item("greatclub")] }), srd);
  const at = Object.fromEntries(d.attacks.map((a) => [a.name, a]));
  assert.equal(at["Unarmed Strike"].damage, "1d6+3");
  assert.equal(at["Unarmed Strike"].bonus, 6);
  assert.equal(at.Quarterstaff.damage, "1d6+3", "monk weapon uses Dex and the martial arts die");
  assert.equal(at.Quarterstaff.versatile, "1d8+3");
  assert.equal(at.Shortsword.damage, "1d6+3");
  assert.equal(at.Greatclub.damage, "1d8", "two-handed weapons are not monk weapons");
  assert.equal(d.attacksPerAction, 2);
  const l1 = deriveCharacter(mk({ class: "monk", level: 1, abilities: ab }), srd);
  assert.equal(l1.attacks.find((a) => a.id === "unarmed").damage, "1d4+3");
});

test("deriveCharacter: skills, expertise, Jack of All Trades, Remarkable Athlete", () => {
  const ab = { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 14 };
  const rogue = deriveCharacter(mk({ class: "rogue", level: 2, abilities: ab, skillProfs: { stealth: 2, perception: 2, acrobatics: 1 } }), srd);
  assert.equal(rogue.skills.stealth, 7);
  assert.equal(rogue.skills.perception, 5);
  assert.equal(rogue.passive.perception, 15);
  assert.equal(rogue.skills.acrobatics, 5);
  assert.equal(rogue.skills.arcana, 1);
  const bard = deriveCharacter(mk({ class: "bard", level: 2, abilities: ab, skillProfs: { performance: 1 } }), srd);
  assert.equal(bard.skills.performance, 4);
  assert.equal(bard.skills.arcana, 2, "JoAT adds half proficiency");
  assert.equal(bard.initiative, 4, "JoAT applies to initiative");
  const bard1 = deriveCharacter(mk({ class: "bard", level: 1, abilities: ab }), srd);
  assert.equal(bard1.skills.arcana, 1);
  const champ = deriveCharacter(mk({ classes: [{ class: "fighter", subclass: "champion", level: 7 }], abilities: ab }), srd);
  assert.equal(champ.skills.athletics, 0 + 2, "remarkable athlete ceil(3/2)");
  assert.equal(champ.skills.arcana, 1);
  assert.equal(champ.initiative, 5);
});

test("deriveCharacter: spellcasting modes", () => {
  const ab = { str: 8, dex: 14, con: 12, int: 16, wis: 12, cha: 16 };
  const wiz = deriveCharacter(mk({ class: "wizard", level: 3, abilities: ab }), srd).spellcasting;
  assert.equal(wiz.mode, "spellbook");
  assert.deepEqual(wiz.slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(wiz.preparedMax, 6);
  assert.equal(wiz.dc, 13);
  assert.equal(wiz.cantripsKnown, 3);
  const pal = deriveCharacter(mk({ class: "paladin", level: 5, abilities: ab }), srd).spellcasting;
  assert.equal(pal.preparedMax, 3 + 2, "CHA mod + half paladin level");
  assert.equal(pal.cantripsKnown, 0);
  assert.equal(deriveCharacter(mk({ class: "paladin", level: 1, abilities: ab }), srd).spellcasting, null);
  const war = deriveCharacter(mk({ class: "warlock", level: 5, abilities: ab }), srd).spellcasting;
  assert.equal(war.mode, "pact");
  assert.deepEqual(war.pact, { level: 3, slots: 2 });
  assert.equal(war.spellsKnown, 6);
  assert.equal(war.cantripsKnown, 3);
  assert.equal(war.maxSpellLevel, 3);
  const sor = deriveCharacter(mk({ class: "sorcerer", level: 3, abilities: ab }), srd).spellcasting;
  assert.equal(sor.mode, "known");
  assert.equal(sor.spellsKnown, 4);
  assert.equal(sor.cantripsKnown, 4);
  const mc = deriveCharacter(mk({ abilities: ab, classes: [{ class: "paladin", level: 2 }, { class: "sorcerer", level: 3 }] }), srd).spellcasting;
  assert.deepEqual(mc.slots, [4, 3, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(mc.classes.length, 2);
  assert.equal(mc.spellsKnown, 4);
  assert.equal(mc.preparedMax, 4);
  assert.equal(deriveCharacter(mk({ class: "fighter", level: 5 }), srd).spellcasting, null);
  const innate = deriveCharacter(mk({ class: "fighter", abilities: ab, spellcasting: { ability: "int", cantrips: ["light"], known: [], prepared: [], slotsUsed: [], pactUsed: 0, innate: [{ spell: "light", ability: "int" }] } }), srd).spellcasting;
  assert.equal(innate.mode, "innate");
  assert.equal(innate.dc, 13);
});

test("classResources: per-class limited uses", () => {
  const ch = mk({ abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 14, cha: 16 } });
  const r = (cls, lvl) => Object.fromEntries(classResources(cls, lvl, { ...ch, classes: [{ class: cls, level: lvl }] }).map((x) => [x.key, x]));
  assert.equal(r("barbarian", 1).rage.max, 2);
  assert.equal(r("barbarian", 3).rage.max, 3);
  assert.match(r("barbarian", 9).rage.desc, /\+3 damage/);
  assert.equal(r("barbarian", 20).rage.max, null);
  assert.equal(r("bard", 1).bardicInspiration.max, 3);
  assert.equal(r("bard", 1).bardicInspiration.recharge, "long");
  assert.equal(r("bard", 5).bardicInspiration.recharge, "short");
  assert.match(r("bard", 5).bardicInspiration.name, /d8/);
  assert.equal(r("cleric", 1).channelDivinity, undefined);
  assert.equal(r("cleric", 2).channelDivinity.max, 1);
  assert.equal(r("cleric", 6).channelDivinity.max, 2);
  assert.equal(r("druid", 2).wildShape.max, 2);
  assert.equal(r("fighter", 1).secondWind.max, 1);
  assert.equal(r("fighter", 1).actionSurge, undefined);
  assert.equal(r("fighter", 2).actionSurge.recharge, "short");
  assert.equal(r("fighter", 9).indomitable.max, 1);
  assert.equal(r("monk", 1).ki, undefined);
  assert.equal(r("monk", 5).ki.max, 5);
  assert.match(r("monk", 5).ki.desc, /DC 13/);
  assert.equal(r("paladin", 4).layOnHands.max, 20);
  assert.equal(r("paladin", 1).divineSense.max, 4);
  assert.equal(r("paladin", 2).channelDivinity, undefined);
  assert.equal(r("paladin", 3).channelDivinity.max, 1);
  assert.match(r("rogue", 5).sneakAttack.name, /3d6/);
  assert.equal(r("rogue", 5).sneakAttack.max, null);
  assert.equal(r("sorcerer", 1).sorceryPoints, undefined);
  assert.equal(r("sorcerer", 4).sorceryPoints.max, 4);
  assert.equal(r("wizard", 1).arcaneRecovery.max, 1);
  assert.deepEqual(Object.keys(r("ranger", 1)), []);
  assert.deepEqual(Object.keys(r("warlock", 5)), []);
});

test("deriveCharacter: resources carry `used` from char.resources", () => {
  const ch = mk({ class: "fighter", level: 2, resources: { secondWind: { used: 1 }, actionSurge: { used: 9 } } });
  const res = Object.fromEntries(deriveCharacter(ch, srd).resources.map((r) => [r.key, r]));
  assert.equal(res.secondWind.used, 1);
  assert.equal(res.actionSurge.used, 1, "clamped to max");
  for (const r of Object.values(res)) for (const k of ["key", "name", "max", "recharge", "used", "desc"]) assert.ok(k in r);
  // cleric + paladin channel divinity merges
  const mc = deriveCharacter(mk({ classes: [{ class: "cleric", level: 6 }, { class: "paladin", level: 3 }] }), srd).resources;
  assert.equal(mc.filter((r) => r.key === "channelDivinity").length, 1);
  assert.equal(mc.find((r) => r.key === "channelDivinity").max, 2);
  // racial
  const db = deriveCharacter(mk({ race: "dragonborn", draconicAncestry: "red", abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 10, cha: 12 } }), srd);
  const bw = db.resources.find((r) => r.key === "breathWeapon");
  assert.match(bw.desc, /2d6 fire/);
  assert.match(bw.desc, /DC 12/);
  assert.ok(db.resistances.includes("fire"));
});

test("spellDamage and spellHealing", () => {
  assert.deepEqual(spellDamage(spell("fireball"), { slotLevel: 3 }), { dice: "8d6", type: "fire" });
  assert.deepEqual(spellDamage(spell("fireball"), { slotLevel: 5 }), { dice: "10d6", type: "fire" });
  assert.deepEqual(spellDamage(spell("fireball")), { dice: "8d6", type: "fire" });
  assert.deepEqual(spellDamage(spell("fire-bolt"), { casterLevel: 1 }), { dice: "1d10", type: "fire" });
  assert.deepEqual(spellDamage(spell("fire-bolt"), { casterLevel: 5 }), { dice: "2d10", type: "fire" });
  assert.deepEqual(spellDamage(spell("fire-bolt"), { casterLevel: 12 }), { dice: "3d10", type: "fire" });
  assert.equal(spellDamage(spell("magic-missile"), { slotLevel: 2 }).dice, "4d4+4");
  const sw = spellDamage(spell("spiritual-weapon"), { slotLevel: 2, mod: 3 });
  assert.equal(sw.dice, "1d8+3");
  const ice = spellDamage(spell("ice-storm"), { slotLevel: 4 });
  assert.equal(ice.type, "bludgeoning");
  assert.deepEqual(ice.extra, [{ dice: "4d6", type: "cold" }]);
  assert.equal(spellDamage(spell("shield")), null);
  assert.equal(spellDamage(null), null);
  assert.equal(spellHealing(spell("cure-wounds"), { slotLevel: 1 }), "1d8");
  assert.equal(spellHealing(spell("cure-wounds"), { slotLevel: 2 }), "2d8");
  assert.equal(spellHealing(spell("cure-wounds"), { slotLevel: 3, mod: 3 }), "3d8+3");
  assert.equal(spellHealing(spell("healing-word")), "1d4");
  assert.equal(spellHealing(spell("heal"), { slotLevel: 7 }), "80");
  assert.equal(spellHealing(spell("fireball")), null);
});

test("monster helpers", () => {
  const gob = monster("goblin");
  assert.equal(monsterInitiative(gob), 2);
  assert.equal(monsterSaveBonus(gob, "dex"), 2);
  assert.equal(monsterSkillBonus(gob, "stealth"), 6);
  assert.equal(monsterSkillBonus(gob, "perception"), -1);
  const drag = monster("adult-red-dragon");
  assert.equal(monsterSaveBonus(drag, "con"), 13);
  assert.equal(monsterSaveBonus(drag, "str"), 8);
  assert.equal(monsterSkillBonus(drag, "perception"), 13);
  assert.equal(monsterInitiative(drag), 0);
});

test("XP helpers and encounter difficulty", () => {
  assert.equal(xpForLevel(1), 0);
  assert.equal(xpForLevel(2), 300);
  assert.equal(xpForLevel(5), 6500);
  assert.equal(xpForLevel(20), 355000);
  assert.equal(levelForXp(0), 1);
  assert.equal(levelForXp(299), 1);
  assert.equal(levelForXp(300), 2);
  assert.equal(levelForXp(6500), 5);
  assert.equal(levelForXp(1e7), 20);
  assert.equal(crToXp(0.25), 50);
  const e = encounterDifficulty([1, 1, 1, 1], [{ cr: 0.25 }, { cr: 0.25 }, { cr: 0.25 }]);
  assert.equal(e.totalXp, 150);
  assert.equal(e.multiplier, 2);
  assert.equal(e.adjustedXp, 300);
  assert.equal(e.difficulty, "hard");
});

test("deriveCharacter tolerates sparse characters and missing srd", () => {
  const d = deriveCharacter({ class: "wizard", level: 2, abilities: { int: 16 } });
  assert.equal(d.prof, 2);
  assert.equal(d.ac, 10);
  assert.deepEqual(d.spellcasting.slots, [3, 0, 0, 0, 0, 0, 0, 0, 0]);
  assert.ok(d.attacks.length >= 1);
  assert.doesNotThrow(() => deriveCharacter({}, {}));
});
