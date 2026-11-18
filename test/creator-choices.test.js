// The creator and the level-up wizard let the player make every 5e choice: each pick has to reach the built or
// levelled character (draconic ancestry, a high elf's cantrip, tools and languages, background gear, and the
// feature choices of a path chosen at level-up), and each has a hover tip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCharacter, creationProficiencyChoices, backgroundEquipmentPicks, levelUpPlan, applyLevelUp,
} from "../shared/charbuild.js";
import { deriveCharacter, byIndex, xpForLevel } from "../shared/rules.js";
import {
  describeDraconicAncestry, describeRaceCantrip, describeTool, describeLanguage, describeProficiencyChoice, describeItem, describeChoiceOption,
} from "../shared/choiceinfo.js";

const SRD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shared", "srd");
const load = (n) => JSON.parse(fs.readFileSync(path.join(SRD_DIR, `${n}.json`), "utf8"));
const srd = {
  classes: load("classes"), races: load("races"), backgrounds: load("backgrounds"), spells: load("spells"),
  equipment: load("equipment"), features: load("features"), skills: load("skills"), languages: load("languages"),
};
const race = (i) => byIndex(srd.races).get(i);
const bg = (i) => byIndex(srd.backgrounds).get(i);
const itemNames = (ch) => ch.equipment.map((i) => i.name);

/** A usable tip: a title, and text that says something (no "undefined" or "[object Object]" leaking in). */
function described(d, label) {
  assert.ok(d, `${label}: no description`);
  assert.ok(typeof d.title === "string" && d.title.trim(), `${label}: title`);
  assert.ok(typeof d.text === "string" && d.text.trim().length >= 12, `${label}: text`);
  const all = `${d.title} ${d.meta || ""} ${d.text}`;
  assert.ok(!/\b(undefined|null|NaN)\b|\[object Object\]/.test(all), `${label}: a missing value leaked into ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

test("dragonborn: the chosen draconic ancestry sets the breath weapon and resistance", () => {
  const dragonborn = race("dragonborn");
  for (const a of dragonborn.draconicAncestry) {
    const ch = buildCharacter({ race: "dragonborn", class: "fighter", draconicAncestry: a.index }, srd);
    assert.equal(ch.draconicAncestry, a.name.toLowerCase(), `${a.name}: stored on the character`);
    assert.ok(ch.features.some((f) => f.name === `Draconic Ancestry (${a.name})`), `${a.name}: feature`);
    const d = deriveCharacter(ch, srd);
    assert.ok(d.resistances.includes(a.damageType), `${a.name}: resists ${a.damageType}`);
    assert.match(d.resources.find((r) => r.key === "breathWeapon").desc, new RegExp(a.damageType));
    const tipText = described(describeDraconicAncestry(a, dragonborn), `ancestry ${a.name}`);
    assert.match(tipText.text, new RegExp(`resistance|half damage from ${a.damageType}`));
  }
  // with no pick, the first one is suggested
  assert.equal(buildCharacter({ race: "dragonborn", class: "fighter" }, srd).draconicAncestry, "black");
  assert.equal(buildCharacter({ race: "dragonborn", class: "fighter", draconicAncestry: "Gold" }, srd).draconicAncestry, "gold", "by name too");
});

test("high elf: the chosen wizard cantrip is the one they know", () => {
  const elf = race("elf");
  const high = elf.subraces.find((s) => s.index === "high-elf");
  for (const idx of high.cantripChoice.from) {
    const ch = buildCharacter({ race: "elf", subrace: "high-elf", class: "fighter", raceCantrip: idx }, srd);
    assert.deepEqual(ch.spellcasting.cantrips, [idx], `${idx}: the fighter knows it`);
    assert.deepEqual(ch.spellcasting.innate.map((i) => [i.spell, i.ability, i.source]), [[idx, "int", "High Elf"]]);
    described(describeRaceCantrip(byIndex(srd.spells).get(idx), high), `cantrip ${idx}`);
  }
  assert.match(describeRaceCantrip(byIndex(srd.spells).get("light"), high).meta, /High Elf cantrip, cast with Intelligence/);
  // a high elf wizard: the racial cantrip comes on top of the class's three
  const wiz = buildCharacter({ race: "elf", subrace: "high-elf", class: "wizard", raceCantrip: "mage-hand", cantrips: ["fire-bolt", "light", "ray-of-frost"] }, srd);
  assert.deepEqual(wiz.spellcasting.cantrips, ["fire-bolt", "light", "ray-of-frost", "mage-hand"]);
});

test("tool and language choices: one group per choice, picks reach the character", () => {
  const pc = creationProficiencyChoices({ race: "dwarf", class: "bard", background: "entertainer" }, srd);
  assert.deepEqual(pc.tools.map((g) => [g.key, g.source, g.sourceName, g.choose]), [
    ["class-0", "class", "Bard", 3], ["race-0", "race", "Dwarf", 1], ["background-0", "background", "Entertainer", 1],
  ]);
  assert.deepEqual(pc.fixedTools, ["Disguise Kit"]);
  assert.deepEqual(pc.languages, [], "a dwarf entertainer has no language to choose");
  for (const g of pc.tools) assert.equal(g.picked.length, g.choose, `${g.key}: suggestions fill the choice`);

  const tools = { "class-0": ["Lute", "Lyre", "Viol"], "race-0": ["Mason's Tools"], "background-0": ["Drum"] };
  const ch = buildCharacter({ race: "dwarf", class: "bard", background: "entertainer", tools }, srd);
  for (const t of ["Lute", "Lyre", "Viol", "Mason's Tools", "Drum", "Disguise Kit"]) assert.ok(ch.otherProfs.tools.includes(t), `has ${t}`);
  assert.equal(ch.otherProfs.tools.length, 6, "nothing else");

  // picking another choice's suggestion: that choice gives way and suggests something else
  const swap = creationProficiencyChoices({ race: "dwarf", class: "bard", background: "entertainer", tools: { "background-0": ["Bagpipes"] } }, srd);
  assert.deepEqual(swap.tools.find((g) => g.key === "background-0").picked, ["Bagpipes"]);
  assert.ok(!swap.tools.find((g) => g.key === "class-0").picked.includes("Bagpipes"));

  // languages: race, subrace and background choices, each from its own list
  const sage = creationProficiencyChoices({ race: "human", class: "wizard", background: "sage" }, srd);
  assert.deepEqual(sage.languages.map((g) => [g.key, g.choose]), [["race-0", 1], ["background-0", 2]]);
  assert.ok(sage.languages[1].from.includes("Undercommon"), "a background's 'any' means every language");
  const human = buildCharacter({ race: "human", class: "wizard", background: "sage", languages: { "race-0": ["Orc"], "background-0": ["Draconic", "Sylvan"] } }, srd);
  assert.deepEqual(human.otherProfs.languages, ["Common", "Orc", "Draconic", "Sylvan"]);
  const elf = buildCharacter({ race: "elf", subrace: "high-elf", class: "rogue", background: "noble", languages: { "subrace-0": ["Giant"], "background-0": ["Infernal"] } }, srd);
  assert.deepEqual(elf.otherProfs.languages, ["Common", "Elvish", "Thieves' Cant", "Giant", "Infernal"]);
  const druid = buildCharacter({ race: "dwarf", class: "druid", background: "folk-hero", tools: { "race-0": ["Brewer's Supplies"], "background-0": ["Cook's utensils"] } }, srd);
  assert.deepEqual(druid.otherProfs.tools, ["Herbalism Kit", "Land Vehicles", "Brewer's Supplies", "Cook's utensils"]);
  assert.ok(druid.otherProfs.languages.includes("Druidic"));

  // a plain list still works (older callers): each choice takes the names it offers
  const flat = buildCharacter({ race: "human", class: "monk", background: "soldier", tools: ["Playing Card Set", "Flute"], languages: ["Celestial"] }, srd);
  assert.ok(flat.otherProfs.tools.includes("Flute") && flat.otherProfs.tools.includes("Playing Card Set"));
  assert.ok(flat.otherProfs.languages.includes("Celestial"));
});

test("every tool and language on offer has a tip", () => {
  let tools = 0;
  let langs = 0;
  for (const c of srd.classes) {
    for (const r of srd.races) {
      for (const s of [null, ...(r.subraces || [])]) {
        for (const b of srd.backgrounds) {
          const pc = creationProficiencyChoices({ race: r.index, subrace: s?.index, class: c.index, background: b.index }, srd);
          for (const g of [...pc.tools, ...pc.languages]) {
            described(describeProficiencyChoice(g), `${g.key} of ${c.index}/${r.index}/${b.index}`);
            assert.equal(g.picked.length, Math.min(g.choose, g.from.length), `${g.key}: filled`);
            assert.ok(g.picked.every((x) => !pc.fixedTools.includes(x) && !pc.fixedLanguages.includes(x)), `${g.key}: no repeats of what's fixed`);
          }
          const all = [...pc.tools, ...pc.languages].flatMap((g) => g.picked);
          assert.equal(new Set(all).size, all.length, `${c.index}/${r.index}/${b.index}: no pick twice`);
        }
      }
    }
  }
  const allTools = new Set([...srd.classes.flatMap((c) => [...(c.proficiencies?.tools || []), ...(c.toolChoices || []).flatMap((g) => g.from)]),
    ...srd.races.flatMap((r) => [r, ...(r.subraces || [])]).flatMap((r) => (r.proficiencyChoices || []).filter((p) => p.type === "tools").flatMap((p) => p.from)),
    ...srd.backgrounds.flatMap((b) => [...(b.tools || []), ...(b.toolChoices || []).flatMap((g) => g.from)])]);
  for (const t of allTools) { described(describeTool(t, srd), `tool ${t}`); tools++; }
  assert.match(describeTool("Smith's Tools", srd).text, /metal/);
  assert.match(describeTool("Lute", srd).meta, /Musical instrument/);
  for (const l of [...srd.languages.map((x) => x.name), "Druidic", "Thieves' Cant"]) { described(describeLanguage(l, srd), `language ${l}`); langs++; }
  assert.match(describeLanguage("Draconic", srd).text, /Dragonborn/);
  assert.ok(tools >= 30 && langs >= 18);
});

test("background gear: the chosen item is packed", () => {
  const acolyte = buildCharacter({ race: "human", class: "cleric", background: "acolyte", backgroundEquipment: ["reliquary"] }, srd);
  assert.ok(itemNames(acolyte).includes("Reliquary"));
  assert.ok(!itemNames(acolyte).includes("Emblem"));
  // items with no SRD entry are picked by name
  const con = buildCharacter({ race: "human", class: "rogue", background: "charlatan", backgroundEquipment: ["Set of weighted dice"] }, srd);
  assert.ok(itemNames(con).includes("Set of weighted dice"));
  assert.ok(!itemNames(con).includes("Ten stoppered bottles of coloured water"));
  const soldier = buildCharacter({ race: "human", class: "fighter", background: "soldier", backgroundEquipment: ["playing-card-set"] }, srd);
  assert.ok(itemNames(soldier).includes("Playing Card Set") && !itemNames(soldier).includes("Dice Set"));
  // no pick: the first is suggested
  assert.deepEqual(backgroundEquipmentPicks(bg("acolyte"), []).map((i) => i.name), ["Amulet"]);
  assert.deepEqual(backgroundEquipmentPicks(bg("sage"), ["x"]), [], "no gear choice");
  for (const b of srd.backgrounds) for (const g of b.equipmentChoices || []) for (const f of g.from) described(describeItem(f, srd), `${b.index} gear ${f.name}`);
});

test("level-up: a path chosen at a level with its own choice offers it (ranger 3, Hunter's Prey)", () => {
  let ranger = buildCharacter({ race: "human", class: "ranger", background: "outlander", level: 2 }, srd);
  ranger = { ...ranger, xp: xpForLevel(3) };
  const plan = levelUpPlan(ranger, srd);
  assert.equal(plan.subclassChoice, true);
  assert.deepEqual(plan.featureChoices, [], "nothing to choose until a path is picked");
  const hunter = plan.subclassOptions.find((s) => s.index === "hunter");
  assert.deepEqual(hunter.featureChoices.map((f) => [f.index, f.choose]), [["hunters-prey", 1]]);
  const prey = hunter.featureChoices[0];
  assert.deepEqual(prey.options.map((o) => o.index), ["hunters-prey-colossus-slayer", "hunters-prey-giant-killer", "hunters-prey-horde-breaker"]);
  for (const o of prey.options) described(describeChoiceOption(o, prey), `prey ${o.index}`);

  for (const o of prey.options) {
    const up = applyLevelUp(ranger, { subclass: "hunter", featureOptions: { "hunters-prey": [o.index] } }, srd);
    const got = up.features.filter((f) => f.index?.startsWith("hunters-prey-")).map((f) => f.index);
    assert.deepEqual(got, [o.index], `${o.index} is the one gained`);
    assert.equal(up.subclass, "hunter");
  }

  // a sorcerer's first level (by multiclassing) picks the path and its dragon ancestor together
  let fighter = buildCharacter({ race: "human", class: "fighter", level: 3, baseAbilities: { str: 15, dex: 12, con: 14, int: 8, wis: 10, cha: 13 } }, srd);
  fighter = { ...fighter, xp: xpForLevel(4) };
  const mc = levelUpPlan(fighter, srd, "sorcerer");
  assert.equal(mc.subclassChoice, true);
  assert.deepEqual(mc.subclassOptions.find((s) => s.index === "draconic").featureChoices.map((f) => f.index), ["dragon-ancestor"]);
  const sorc = applyLevelUp(fighter, { class: "sorcerer", subclass: "draconic", featureOptions: { "dragon-ancestor": ["dragon-ancestor-silver---cold-damage"] } }, srd);
  const anc = sorc.features.filter((f) => f.index?.startsWith("dragon-ancestor-")).map((f) => f.index);
  assert.equal(anc.length, 1);
  assert.match(anc[0], /silver/);
});
