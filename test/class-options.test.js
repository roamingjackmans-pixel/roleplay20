// Every class at every level offers the standard 5e options (Player's Handbook): subclasses, fighting styles,
// maneuvers, disciplines, invocations, metamagic, pact boons, favoured enemies and terrains, domains and their spells,
// Magical Secrets, Mystic Arcanum... and the level-up helper can't finish until every one of them is chosen.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCharacter, levelUpPlan, applyLevelUp, levelUpPools, levelUpProblems, creationFeatureChoices, spellOptions,
} from "../shared/charbuild.js";
import { deriveCharacter, byIndex, ABILITIES } from "../shared/rules.js";

const SRD_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "shared", "srd");
const load = (n) => JSON.parse(fs.readFileSync(path.join(SRD_DIR, `${n}.json`), "utf8"));
const srd = {
  classes: load("classes"), races: load("races"), backgrounds: load("backgrounds"), spells: load("spells"),
  equipment: load("equipment"), features: load("features"), conditions: load("conditions"), skills: load("skills"),
  languages: load("languages"),
};
const cls = (k) => byIndex(srd.classes).get(k);
const spell = (i) => byIndex(srd.spells).get(i);
const featIdx = (ch) => new Set(ch.features.map((f) => f.index));

// the Player's Handbook subclasses (SRD + the ones written for Roleplay20)
const PHB = {
  barbarian: ["berserker", "totem-warrior"],
  bard: ["lore", "valor"],
  cleric: ["life", "knowledge", "light", "nature", "tempest", "trickery", "war"],
  druid: ["land", "moon"],
  fighter: ["champion", "battle-master", "eldritch-knight"],
  monk: ["open-hand", "shadow", "four-elements"],
  paladin: ["devotion", "ancients", "vengeance"],
  ranger: ["hunter", "beast-master"],
  rogue: ["thief", "assassin", "arcane-trickster"],
  sorcerer: ["draconic", "wild-magic"],
  warlock: ["fiend", "archfey", "great-old-one"],
  wizard: ["evocation", "abjuration", "conjuration", "divination", "enchantment", "illusion", "necromancy", "transmutation"],
};

/** Every choice of the next level, made the way a player would (the first options offered). */
function pickAll(ch, classKey, subclass) {
  let plan = levelUpPlan(ch, srd, classKey);
  const sub = plan.subclassChoice ? subclass : undefined;
  plan = levelUpPlan(ch, srd, classKey, { subclass: sub });
  const path = plan.subclassOptions.find((s) => s.index === sub);
  const featureOptions = {};
  for (const fc of [...plan.featureChoices, ...(path?.featureChoices || [])]) featureOptions[fc.index] = fc.options.slice(0, fc.choose).map((o) => o.index);
  const pools = levelUpPools(ch, plan, srd, sub);
  const inSchool = (s) => !pools.schools || pools.schools.includes(s.school.toLowerCase());
  const spells = [...pools.spells.filter(inSchool), ...pools.spells.filter((s) => !inSchool(s)).slice(0, pools.offSchoolLeft)].slice(0, pools.spellNeed).map((s) => s.index);
  const has = (s) => Number(ch.skillProfs?.[s]) > 0;
  const skills = plan.multiclassSkills ? plan.multiclassSkills.from.filter((s) => !has(s)).slice(0, plan.multiclassSkills.choose)
    : plan.skillsToPick && sub === "lore" ? Object.keys(ch.skillProfs ? srd.skills.reduce((a, s) => ({ ...a, [s.key]: 1 }), {}) : {}).filter((s) => !has(s)).slice(0, 3) : [];
  const expertise = Object.keys(ch.skillProfs || {}).filter((s) => ch.skillProfs[s] === 1).slice(0, plan.expertiseToPick || 0);
  const best = ABILITIES.find((a) => (ch.abilities[a] || 0) <= 18) || "str";
  return {
    class: classKey, subclass: sub, featureOptions, skills, expertise,
    cantrips: pools.cantrips.slice(0, pools.cantripNeed).map((s) => s.index), spells,
    asi: plan.asi ? { [best]: 2 } : undefined,
  };
}

function levelTo(classKey, subclass, to = 20) {
  let ch = buildCharacter({ race: "human", class: classKey, subclass, background: "acolyte", level: 1 }, srd);
  const seen = [];
  for (let l = 2; l <= to; l++) {
    const choices = pickAll(ch, classKey, subclass);
    assert.deepEqual(levelUpProblems(ch, choices, srd), [], `${classKey}/${subclass} level ${l}: every choice made`);
    ch = applyLevelUp(ch, choices, srd);
    seen.push(choices);
  }
  return { ch, seen };
}

test("every class has all of its Player's Handbook subclasses, with features at every subclass level", () => {
  for (const [k, subs] of Object.entries(PHB)) {
    const c = cls(k);
    assert.deepEqual(c.subclasses.map((s) => s.index).sort(), subs.slice().sort(), k);
    // the levels where the class table says "subclass feature"
    const levels = [c.subclassLevel, ...c.levels.map((r, i) => (r.features.some((f) => f.placeholder) ? i + 1 : 0)).filter(Boolean)];
    for (const s of c.subclasses) {
      assert.equal(s.level, c.subclassLevel, `${k}/${s.index} chosen at the class's level`);
      for (const l of levels) assert.ok(s.features.some((f) => f.level === l), `${k}/${s.index} has a feature at level ${l}`);
      for (const f of s.features) assert.ok(f.name && f.desc && f.desc.length > 20, `${k}/${s.index}/${f.index} described`);
      for (const sp of s.spells || []) assert.ok(spell(sp.index), `${k}/${s.index} spell ${sp.index} exists`);
      if (s.srd === false) assert.ok(!/Player's Handbook/i.test(JSON.stringify(s)), "no book references");
    }
  }
});

test("fighter 3 offers every martial archetype; fighting styles are complete for fighter, paladin and ranger", () => {
  const f2 = buildCharacter({ race: "human", class: "fighter", background: "soldier", level: 2 }, srd);
  assert.deepEqual(levelUpPlan(f2, srd).subclassOptions.map((s) => s.name).sort(), ["Battle Master", "Champion", "Eldritch Knight"]);
  const style = (k, l) => creationFeatureChoices(k, null, l, srd).find((f) => /fighting-style$/.test(f.index)).options.map((o) => o.name.replace(/^Fighting Style: /, ""));
  assert.deepEqual(style("fighter", 1).sort(), ["Archery", "Defense", "Dueling", "Great Weapon Fighting", "Protection", "Two-Weapon Fighting"]);
  assert.deepEqual(style("paladin", 2).sort(), ["Defense", "Dueling", "Great Weapon Fighting", "Protection"]);
  assert.deepEqual(style("ranger", 2).sort(), ["Archery", "Defense", "Dueling", "Two-Weapon Fighting"]);
  // and in the level-up helper
  const p1 = buildCharacter({ race: "human", class: "paladin", background: "acolyte", level: 1 }, srd);
  assert.equal(levelUpPlan(p1, srd).featureChoices.find((f) => f.index === "paladin-fighting-style").options.length, 4);
});

test("a choice never offers what the character already has (Champion's second style, metamagic, maneuvers)", () => {
  const { ch } = levelTo("fighter", "champion", 9);
  const first = ch.features.find((f) => /^fighter-fighting-style-/.test(f.index)).index;
  const plan = levelUpPlan(ch, srd);
  const second = plan.featureChoices.find((f) => f.index === "additional-fighting-style");
  assert.equal(second.options.length, 5);
  assert.ok(!second.options.some((o) => o.index === first));

  const bm = levelTo("fighter", "battle-master", 6).ch;
  const known = bm.features.filter((f) => /^maneuver-/.test(f.index)).map((f) => f.index);
  assert.equal(known.length, 3);
  const at7 = levelUpPlan(bm, srd).featureChoices.find((f) => f.index === "battle-master-maneuvers-7");
  assert.equal(at7.choose, 2);
  assert.equal(at7.options.length, 13);
  assert.ok(!at7.options.some((o) => known.includes(o.index)));

  const sorc = levelTo("sorcerer", "draconic", 9).ch;
  const meta = levelUpPlan(sorc, srd).featureChoices.find((f) => f.index === "metamagic-2");
  assert.equal(meta.options.length, 6, "8 metamagic options less the 2 known");
});

test("warlocks learn invocations at 2, 5, 7, 9, 12, 15 and 18, each only once its requirements are met", () => {
  const { ch, seen } = levelTo("warlock", "fiend", 20);
  const at = (l) => Object.entries(seen[l - 2].featureOptions).filter(([k]) => /^eldritch-invocations/.test(k)).flatMap(([, v]) => v).length;
  assert.deepEqual([2, 5, 7, 9, 12, 15, 18].map(at), [2, 1, 1, 1, 1, 1, 1]);
  assert.equal(ch.features.filter((f) => /^eldritch-invocation-/.test(f.index)).length, 8);
  // requirements: agonizing blast needs the eldritch blast cantrip, thirsting blade the pact of the blade and level 5
  const fresh = buildCharacter({ race: "human", class: "warlock", background: "acolyte", level: 1, cantrips: ["chill-touch", "minor-illusion"] }, srd);
  const inv = levelUpPlan(fresh, srd).featureChoices.find((f) => f.index === "eldritch-invocations").options.map((o) => o.index);
  assert.ok(!inv.includes("eldritch-invocation-agonizing-blast"));
  assert.ok(!inv.includes("eldritch-invocation-thirsting-blade"));
  const blade = levelTo("warlock", "fiend", 4);
  const pact = blade.ch.features.find((f) => /^pact-of-the-/.test(f.index)).index;
  const five = levelUpPlan(blade.ch, srd).featureChoices.find((f) => f.index === "eldritch-invocations-5").options.map((o) => o.index);
  assert.equal(five.includes("eldritch-invocation-thirsting-blade"), pact === "pact-of-the-blade");
  // Mystic Arcanum: the 6th-level spell is a choice
  const arc = levelTo("warlock", "fiend", 10).ch;
  const mystic = levelUpPlan(arc, srd).featureChoices.find((f) => f.index === "mystic-arcanum-6th-level");
  assert.ok(mystic.options.length >= 5 && mystic.options.every((o) => spell(o.spell).level === 6 && spell(o.spell).classes.includes("warlock")));
});

test("patrons add their expanded spells to what a warlock can learn", () => {
  const list = spellOptions("warlock", 5, srd, { subclass: "archfey" }).spells.map((s) => s.index);
  for (const i of ["faerie-fire", "sleep", "calm-emotions", "phantasmal-force", "blink", "plant-growth"]) assert.ok(list.includes(i), i);
  assert.ok(!spellOptions("warlock", 5, srd, { subclass: "fiend" }).spells.some((s) => s.index === "faerie-fire"));
  assert.ok(spellOptions("warlock", 5, srd, { subclass: "fiend" }).spells.some((s) => s.index === "fireball"), "the Fiend's own list");
});

test("domains: always-prepared spells, bonus proficiencies, Knowledge's languages and expert skills", () => {
  const tempest = buildCharacter({ race: "human", class: "cleric", subclass: "tempest", background: "acolyte", level: 5 }, srd);
  assert.ok(tempest.otherProfs.armor.includes("Heavy Armor") && tempest.otherProfs.weapons.includes("Martial Weapons"));
  for (const i of ["fog-cloud", "thunderwave", "gust-of-wind", "shatter", "call-lightning", "sleet-storm"]) assert.ok(tempest.spellcasting.prepared.includes(i), i);
  const know = buildCharacter({ race: "human", class: "cleric", subclass: "knowledge", background: "acolyte", level: 1 }, srd);
  const expert = Object.entries(know.skillProfs).filter(([, v]) => v === 2).map(([k]) => k);
  assert.equal(expert.length, 2);
  assert.ok(expert.every((s) => ["arcana", "history", "nature", "religion"].includes(s)));
  assert.ok(know.otherProfs.languages.length >= 4, "two more languages");
  const light = buildCharacter({ race: "human", class: "cleric", subclass: "light", background: "acolyte", level: 1 }, srd);
  assert.ok(light.spellcasting.cantrips.includes("light"));
  assert.equal(deriveCharacter(light, srd).spellcasting.cantripsKnown, light.spellcasting.cantrips.length, "the bonus cantrip counts on top");
});

test("Circle of the Land: the land picks the circle spells, and the bonus cantrip is a choice", () => {
  const d = buildCharacter({ race: "human", class: "druid", subclass: "land", background: "acolyte", level: 5,
    featureOptions: { "circle-of-the-land": ["circle-of-the-land-underdark"], "bonus-cantrip": ["bonus-cantrip--thorn-whip"] } }, srd);
  for (const i of ["spider-climb", "web", "gaseous-form", "stinking-cloud"]) assert.ok(d.spellcasting.prepared.includes(i), i);
  assert.ok(d.spellcasting.cantrips.includes("thorn-whip"));
  assert.equal(d.spellcasting.cantrips.length, 4, "three druid cantrips at 5th, plus the bonus one");
});

test("Eldritch Knight and Arcane Trickster cast wizard spells from their schools", () => {
  const f2 = buildCharacter({ race: "human", class: "fighter", background: "soldier", level: 2 }, srd);
  const plan = levelUpPlan(f2, srd, "fighter", { subclass: "eldritch-knight" });
  assert.equal(plan.cantripsToPick, 2);
  assert.equal(plan.spellsToPick, 3);
  const pools = levelUpPools(f2, plan, srd, "eldritch-knight");
  assert.deepEqual(pools.schools, ["abjuration", "evocation"]);
  assert.equal(pools.offSchoolLeft, 1);
  // three spells from outside the schools: refused; two in school and one from anywhere: fine
  const choice = (spells) => ({ subclass: "eldritch-knight", cantrips: ["fire-bolt", "light"], spells, asi: undefined, featureOptions: {} });
  assert.ok(levelUpProblems(f2, choice(["sleep", "charm-person", "disguise-self"]), srd).some((p) => /schools/.test(p)));
  assert.deepEqual(levelUpProblems(f2, choice(["shield", "magic-missile", "sleep"]), srd), []);
  const ek = applyLevelUp(f2, choice(["shield", "magic-missile", "sleep"]), srd);
  assert.deepEqual(ek.spellcasting.known.sort(), ["magic-missile", "shield", "sleep"]);
  const d = deriveCharacter(ek, srd);
  assert.equal(d.spellcasting.ability, "int");
  assert.equal(d.spellcasting.slots[0], 2);
  assert.equal(d.spellcasting.spellsKnown, 3);
  const r2 = buildCharacter({ race: "human", class: "rogue", background: "criminal", level: 2 }, srd);
  const atPlan = levelUpPlan(r2, srd, "rogue", { subclass: "arcane-trickster" });
  assert.ok(!levelUpPools(r2, atPlan, srd, "arcane-trickster").cantrips.some((s) => s.index === "mage-hand"), "mage hand comes free, so it isn't one of the picks");
  const at = buildCharacter({ race: "human", class: "rogue", subclass: "arcane-trickster", background: "criminal", level: 3 }, srd);
  assert.ok(at.spellcasting.cantrips.includes("mage-hand"));
  assert.equal(at.spellcasting.cantrips.length, 3);
});

test("bards: Magical Secrets come from any class and are part of the spells known; Valor gets Extra Attack", () => {
  const { ch } = levelTo("bard", "lore", 9);
  const plan = levelUpPlan(ch, srd);
  const secrets = plan.featureChoices.find((f) => f.index === "magical-secrets-1");
  assert.equal(secrets.choose, 2);
  assert.ok(secrets.options.some((o) => spell(o.spell)?.classes.includes("wizard") && !spell(o.spell).classes.includes("bard")), "other classes' spells");
  assert.ok(secrets.options.every((o) => spell(o.spell).level <= 5));
  assert.equal(plan.spellsToPick, 0, "the table's two new spells at 10th are the secrets");
  const ten = applyLevelUp(ch, pickAll(ch, "bard", "lore"), srd);
  assert.equal(ten.spellcasting.known.length, deriveCharacter(ten, srd).spellcasting.spellsKnown);
  const valor = levelTo("bard", "valor", 6).ch;
  assert.equal(deriveCharacter(valor, srd).attacksPerAction, 2);
  assert.ok(valor.otherProfs.weapons.includes("Martial Weapons"));
});

test("every class and subclass levels 1 to 20 through the helper with every choice made, and the sheet adds up", () => {
  for (const [k, subs] of Object.entries(PHB)) {
    for (const s of subs) {
      const { ch } = levelTo(k, s, 20);
      assert.equal(ch.level, 20, `${k}/${s}`);
      const idx = featIdx(ch);
      for (const f of cls(k).subclasses.find((x) => x.index === s).features) assert.ok(idx.has(f.index), `${k}/${s} has ${f.index}`);
      const d = deriveCharacter(ch, srd);
      if (d.spellcasting?.cantripsKnown) assert.equal(ch.spellcasting.cantrips.length, d.spellcasting.cantripsKnown, `${k}/${s} cantrips`);
      if (d.spellcasting?.spellsKnown != null && d.spellcasting.mode !== "spellbook") assert.equal(ch.spellcasting.known.length, d.spellcasting.spellsKnown, `${k}/${s} spells known`);
      if (d.spellcasting?.preparedMax && ["cleric", "druid", "paladin"].includes(k)) {
        const always = new Set(ch.spellcasting.alwaysPrepared || []);
        assert.equal(ch.spellcasting.prepared.filter((i) => !always.has(i)).length, d.spellcasting.preparedMax, `${k}/${s} prepared`);
      }
      for (const i of [...(ch.spellcasting?.known || []), ...(ch.spellcasting?.cantrips || [])]) assert.ok(spell(i), `${k}/${s} spell ${i}`);
    }
  }
});

test("a level-up can't go through with a choice missing", () => {
  const p1 = buildCharacter({ race: "human", class: "paladin", background: "acolyte", level: 1 }, srd);
  const need = levelUpPools(p1, levelUpPlan(p1, srd), srd).spellNeed;
  assert.ok(need >= 2, "a paladin prepares Charisma modifier + half their level at 2nd");
  assert.deepEqual(levelUpProblems(p1, {}, srd), ["Fighting Style", `${need} more spells`]);
  const c4 = levelTo("cleric", "life", 4).ch;
  // a prepared caster fills every place it has: the number it can prepare now, less the ones it has
  const plan = levelUpPlan(c4, srd);
  const d = deriveCharacter(c4, srd);
  const always = new Set(c4.spellcasting.alwaysPrepared || []);
  const have = c4.spellcasting.prepared.filter((i) => !always.has(i)).length;
  const newMax = Math.max(1, Math.floor((c4.abilities.wis - 10) / 2) + 5);
  assert.equal(plan.spellsToPick, newMax - have);
  assert.ok(levelUpProblems(c4, { ...pickAll(c4, "cleric"), spells: [] }, srd).some((p) => /more spell/.test(p)));
  assert.ok(d.spellcasting.preparedMax >= 1);
  // a pick for an option the feature doesn't offer doesn't count
  const f1 = buildCharacter({ race: "human", class: "fighter", background: "soldier", level: 2 }, srd);
  assert.deepEqual(levelUpProblems(f1, { subclass: "battle-master", featureOptions: { "battle-master-combat-superiority": ["maneuver-riposte", "nonsense", "maneuver-riposte"] } }, srd),
    ["Combat Superiority", "Student of War"]);
});

test("the class tables match the Player's Handbook (the SRD data had invocations and metamagic a level early)", () => {
  const T = {
    bard: { cantrips: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], known: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 15, 16, 18, 19, 19, 20, 22, 22, 22] },
    sorcerer: { cantrips: [4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6, 6], known: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 12, 13, 13, 14, 14, 15, 15, 15, 15] },
    warlock: { cantrips: [2, 2, 2, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4], known: [2, 3, 4, 5, 6, 7, 8, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 14, 15, 15] },
    ranger: { known: [0, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11] },
  };
  for (const [k, t] of Object.entries(T)) {
    if (t.cantrips) assert.deepEqual(cls(k).levels.map((r) => r.cantrips ?? 0), t.cantrips, `${k} cantrips`);
    assert.deepEqual(cls(k).levels.map((r) => r.spellsKnown ?? 0), t.known, `${k} spells known`);
  }
  assert.deepEqual(cls("warlock").levels.map((r) => r.specific.invocationsKnown), [0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8]);
  assert.deepEqual(cls("sorcerer").levels.map((r) => r.specific.metamagicKnown), [0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4]);
});
