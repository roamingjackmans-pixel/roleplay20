// Every choice in the character creator and the level-up wizard has a description for its hover tip.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALIGNMENTS, buildCharacter, creationFeatureChoices, levelUpPlan, applyLevelUp } from "../shared/charbuild.js";
import { ABILITIES, SKILLS, byIndex } from "../shared/rules.js";
import {
  describeRace, describeSubrace, describeClass, describeSubclass, describeBackground, describeAlignment, describeCharacterQuestion,
  describeNameIdea, describeAbility, describeAbilityMethod, describeBonusChoice, describeSkill, describeExpertise, describeSpell,
  describeFeatureOption, describeStringOption, describeChoiceOption, describeItem, describeEquipmentOption, itemSummary,
  describeHpMethod, describeAsiMode, describeAsiAbility, describeClassLevel, optionName, brief, ABILITY_METHOD_INFO,
} from "../shared/choiceinfo.js";

const SRD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shared", "srd");
const load = (n) => JSON.parse(fs.readFileSync(path.join(SRD_DIR, `${n}.json`), "utf8"));
const srd = {
  classes: load("classes"), races: load("races"), backgrounds: load("backgrounds"), spells: load("spells"),
  equipment: load("equipment"), features: load("features"), skills: load("skills"), languages: load("languages"),
};

let checked = 0;
/** A usable tip: a title, and text that says something (no "undefined" or "[object Object]" leaking in). */
function described(d, label) {
  checked++;
  assert.ok(d, `${label}: no description`);
  assert.equal(typeof d.title, "string", `${label}: title`);
  assert.ok(d.title.trim(), `${label}: empty title`);
  assert.equal(typeof d.text, "string", `${label}: text`);
  assert.ok(d.text.trim().length >= 12, `${label}: empty text`);
  const all = `${d.title} ${d.meta || ""} ${d.text}`;
  assert.ok(!/\b(undefined|null|NaN)\b|\[object Object\]/.test(all), `${label}: a missing value leaked into ${JSON.stringify(d).slice(0, 300)}`);
  return d;
}

test("races and subraces", () => {
  for (const r of srd.races) {
    described(describeRace(r, srd), `race ${r.index}`);
    for (const s of r.subraces || []) described(describeSubrace(s, r, srd), `subrace ${s.index}`);
  }
  const dwarf = describeRace(byIndex(srd.races).get("dwarf"), srd);
  assert.match(dwarf.text, /Constitution \+2/);
  assert.match(dwarf.text, /Dwarven Resilience/);
  assert.match(describeSubrace(byIndex(srd.races).get("elf").subraces.find((s) => s.index === "high-elf"), byIndex(srd.races).get("elf"), srd).text, /wizard cantrip/);
});

test("classes, subclasses and what each class level gives", () => {
  for (const c of srd.classes) {
    const d = described(describeClass(c, srd), `class ${c.index}`);
    assert.match(d.text, new RegExp(`d${c.hitDie}`));
    for (const s of c.subclasses || []) {
      described(describeSubclass(s, c, c.subclassLevel || 3), `subclass ${s.index} at ${c.subclassLevel}`);
      described(describeSubclass(s, c, 20), `subclass ${s.index} at 20`);
    }
    for (let l = 1; l <= 20; l++) {
      for (const s of [null, ...(c.subclasses || []).map((x) => x.index)]) described(describeClassLevel(c, l, s), `${c.index} ${l} ${s}`);
    }
  }
  const champ = describeSubclass(byIndex(srd.classes).get("fighter").subclasses[0], byIndex(srd.classes).get("fighter"), 3);
  assert.match(champ.text, /Improved Critical/);
  assert.match(champ.text, /\*\*Later:\*\* Remarkable Athlete/, "features above your level are listed as later");
  const mc = describeClassLevel(byIndex(srd.classes).get("rogue"), 1, null, { prereqText: "Dexterity 13", problems: ["Rogue needs Dexterity 13"] });
  assert.match(mc.text, /Multiclassing:\*\* needs Dexterity 13/);
  assert.match(mc.text, /Not yet:\*\* Rogue needs Dexterity 13/);
});

test("backgrounds, alignments, campaign questions and name ideas", () => {
  for (const b of srd.backgrounds) {
    const d = described(describeBackground(b, srd), `background ${b.index}`);
    if (b.feature) assert.ok(d.text.includes(b.feature.name), `${b.index} names its feature`);
  }
  assert.equal(ALIGNMENTS.length, 9);
  const texts = new Set();
  for (const a of ALIGNMENTS) texts.add(described(describeAlignment(a), `alignment ${a}`).text);
  assert.equal(texts.size, 9, "each alignment has its own summary");
  described(describeCharacterQuestion("What did you leave behind in the drowned city?"), "campaign question");
  described(describeNameIdea("Brindle Ashvale"), "name idea");
});

test("ability scores: abilities, methods, racial picks, improvements", () => {
  for (const a of ABILITIES) {
    described(describeAbility(a, srd), `ability ${a}`);
    described(describeBonusChoice(a, 1, srd), `+1 ${a}`);
    for (const add of [1, 2]) for (const score of [8, 13, 15, 19, 20]) described(describeAsiAbility(a, score, add, srd), `asi ${a} ${score}+${add}`);
  }
  assert.match(describeAbility("wis", srd).text, /Perception/);
  for (const m of Object.keys(ABILITY_METHOD_INFO)) described(describeAbilityMethod(m), `method ${m}`);
  assert.deepEqual(Object.keys(ABILITY_METHOD_INFO).sort(), ["manual", "pointbuy", "roll", "standard"]);
  assert.equal(describeAsiAbility("str", 15, 1, srd).meta, "15 → 16, modifier +2 → +3");
  assert.match(describeAsiAbility("str", 20, 2, srd).meta, /Already 20/);
  for (const m of ["one", "two"]) described(describeAsiMode(m), `asi mode ${m}`);
  for (const m of ["average", "max", "roll"]) for (const die of [6, 8, 10, 12]) described(describeHpMethod(m, die), `hp ${m} d${die}`);
  assert.match(describeHpMethod("average", 10).text, /6/);
});

test("skills and expertise", () => {
  for (const k of Object.keys(SKILLS)) {
    const d = described(describeSkill(k, srd), `skill ${k}`);
    assert.ok(d.meta, `${k} names its ability`);
    assert.match(described(describeExpertise(k, srd), `expertise ${k}`).text, /doubles your proficiency bonus/);
  }
});

test("every spell and cantrip", () => {
  assert.ok(srd.spells.length > 300);
  for (const s of srd.spells) {
    const d = described(describeSpell(s), `spell ${s.index}`);
    assert.ok(d.text.includes(s.desc.slice(0, 40)), `${s.index}: the SRD text, not a summary`);
  }
  assert.equal(describeSpell(byIndex(srd.spells).get("fire-bolt")).meta, "evocation cantrip");
  assert.equal(describeSpell(byIndex(srd.spells).get("fireball")).meta, "3rd-level evocation");
});

test("every class feature option: fighting styles, metamagic, invocations, pact boons, favoured enemies, terrains", () => {
  let options = 0;
  let words = 0;
  for (const c of srd.classes) {
    const feats = [...c.levels.flatMap((l) => l.features), ...c.subclasses.flatMap((s) => s.features)];
    for (const f of feats) {
      for (const o of f.options || []) {
        const d = described(describeFeatureOption(o, f), `${f.index} / ${o.index}`);
        assert.equal(d.text, o.desc, "option text comes from the SRD");
        described(describeChoiceOption(o, f), `choice ${o.index}`);
        options++;
      }
      for (const w of f.stringOptions?.from || []) {
        const d = described(describeStringOption(w, f), `${f.index} / ${w}`);
        assert.ok(!/as your favoured (enemy|terrain)/.test(d.text), `${w}: a written summary, not the fallback`);
        described(describeChoiceOption({ index: w, name: w, desc: "" }, f), `choice ${w}`);
        words++;
      }
    }
  }
  assert.ok(options > 60, `options checked: ${options}`);
  assert.ok(words >= 21, `enemy and terrain words checked: ${words}`);
  assert.equal(optionName("Fighting Style: Great Weapon Fighting"), "Great Weapon Fighting");
  assert.equal(optionName("Dragon Ancestor: Black - Acid Damage"), "Black (Acid Damage)");
  assert.equal(optionName("Pact of the Blade"), "Pact of the Blade");
  const archery = byIndex(srd.classes).get("fighter").levels[0].features[0].options[0];
  assert.equal(describeFeatureOption(archery, { name: "Fighting Style" }).title, "Archery");
  assert.match(describeStringOption("undead", { index: "favored-enemy-1-type", name: "Favored Enemy" }).text, /skeletons/);
  assert.match(describeStringOption("swamp", { index: "natural-explorer-1-terrain-type", name: "Natural Explorer" }).text, /Marshes/);
});

test("the choices each tool actually offers all have descriptions (creation 1-20, level-up plans)", () => {
  for (const c of srd.classes) {
    for (const sub of [null, ...c.subclasses.map((s) => s.index)]) {
      for (let l = 1; l <= 20; l++) {
        for (const fc of creationFeatureChoices(c.index, sub, l, srd)) {
          assert.ok(fc.options.length && fc.choose >= 1, `${fc.index} has options`);
          for (const o of fc.options) described(describeChoiceOption(o, fc), `create ${c.index} ${l} ${fc.index}/${o.index}`);
        }
      }
    }
    // walk a character of this class up to 20, describing every choice the wizard shows on the way
    let ch = buildCharacter({ race: "human", class: c.index, baseAbilities: { str: 15, dex: 15, con: 14, int: 13, wis: 13, cha: 13 } }, srd);
    for (let l = 2; l <= 20; l++) {
      const plan = levelUpPlan(ch, srd, c.index);
      for (const fc of plan.featureChoices) for (const o of fc.options) described(describeChoiceOption(o, fc), `level-up ${c.index} ${l} ${fc.index}/${o.index}`);
      for (const s of plan.subclassOptions) described(describeSubclass(s, c, plan.classLevel), `level-up subclass ${s.index}`);
      ch = applyLevelUp(ch, { class: c.index }, srd);
    }
  }
});

test("starting equipment: every option and every item you can pick", () => {
  const seen = new Set();
  for (const c of srd.classes) {
    for (const set of c.equipmentOptions || []) {
      for (const o of set.options) {
        const d = described(describeEquipmentOption(o, srd), `${c.index} gear ${o.label}`);
        for (const it of o.items) {
          assert.ok(d.text.includes(byIndex(srd.equipment).get(it.index)?.name || it.name), `${o.label} lists ${it.name}`);
          described(describeItem(it, srd), `item ${it.index}`);
        }
        for (const p of o.picks) {
          for (const it of p.from) {
            seen.add(it.index);
            described(describeItem(it, srd), `pick ${it.index}`);
            const e = byIndex(srd.equipment).get(it.index);
            if (e?.type === "weapon" || e?.type === "armor") assert.ok(itemSummary(it, srd), `${it.index} has stats for the dropdown`);
          }
        }
      }
    }
  }
  assert.ok(seen.size > 30);
  for (const e of srd.equipment) described(describeItem({ index: e.index, name: e.name, qty: 1 }, srd), `equipment ${e.index}`);
  described(describeItem({ index: null, name: "Trophy taken from a fallen enemy", qty: 1 }, srd), "flavour item");
  assert.equal(itemSummary({ index: "longsword" }, srd), "1d8 slashing, versatile (1d10)");
  assert.equal(itemSummary({ index: "chain-mail" }, srd), "AC 16, heavy armor");
  assert.equal(itemSummary({ index: "scale-mail" }, srd), "AC 14 + Dex (max 2), medium armor");
});

test("creator: class feature picks reach the built character", () => {
  const fs1 = creationFeatureChoices("fighter", null, 1, srd);
  assert.deepEqual(fs1.map((f) => f.index), ["fighter-fighting-style"]);
  assert.equal(fs1[0].choose, 1);
  assert.equal(fs1[0].options.length, 6);
  const archer = buildCharacter({ race: "human", class: "fighter", featureOptions: { "fighter-fighting-style": ["fighter-fighting-style-archery"] } }, srd);
  const idx = archer.features.map((f) => f.index);
  assert.ok(idx.includes("fighter-fighting-style-archery"));
  assert.ok(!idx.includes("fighter-fighting-style-defense"), "the pick replaces the default");

  const ranger = creationFeatureChoices("ranger", null, 1, srd);
  assert.deepEqual(ranger.map((f) => [f.index, f.words]), [["favored-enemy-1-type", true], ["natural-explorer-1-terrain-type", true]]);
  const r = buildCharacter({ race: "human", class: "ranger", featureOptions: { "favored-enemy-1-type": ["undead"], "natural-explorer-1-terrain-type": ["swamp"] } }, srd);
  assert.match(r.features.find((f) => f.index === "favored-enemy-1-type").desc, /Chosen: undead$/);
  assert.match(r.features.find((f) => f.index === "natural-explorer-1-terrain-type").desc, /Chosen: swamp$/);

  const lock = creationFeatureChoices("warlock", "fiend", 3, srd).map((f) => [f.index, f.choose]);
  assert.deepEqual(lock, [["eldritch-invocations", 2], ["pact-boon", 1]]);
  const sorc = creationFeatureChoices("sorcerer", "draconic", 3, srd).map((f) => [f.index, f.choose]);
  assert.deepEqual(sorc, [["dragon-ancestor", 1], ["metamagic-1", 2]]);
  assert.deepEqual(creationFeatureChoices("wizard", "evocation", 5, srd), [], "no feature choices for a wizard");
  assert.deepEqual(creationFeatureChoices("fighter", "champion", 2, srd).map((f) => f.index), ["fighter-fighting-style"], "subclass features wait for the subclass level");
});

test("brief() keeps whole sentences", () => {
  assert.equal(brief("Short.", 50), "Short.");
  assert.equal(brief("One sentence here. Another sentence that is quite long indeed.", 40), "One sentence here.");
  assert.match(brief("word ".repeat(80), 60), /…$/);
});

test("described everything", () => {
  assert.ok(checked > 2000, `descriptions checked: ${checked}`);
});
