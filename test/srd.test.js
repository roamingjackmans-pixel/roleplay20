import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRD_DIR = path.join(ROOT, "shared", "srd");
const FILES = ["classes", "races", "backgrounds", "spells", "monsters", "equipment", "features", "conditions", "skills", "magic-items", "languages"];
const data = Object.fromEntries(FILES.map((f) => [f, JSON.parse(fs.readFileSync(path.join(SRD_DIR, `${f}.json`), "utf8"))]));
const by = (f) => new Map(data[f].map((x) => [x.index, x]));
const SKILL_KEYS = new Set(data.skills.map((s) => s.key));
const ABILITIES = ["str", "dex", "con", "int", "wis", "cha"];

test("every file is an array of entries with unique indices", () => {
  for (const f of FILES) {
    assert.ok(Array.isArray(data[f]) && data[f].length > 0, f);
    const seen = new Set();
    for (const e of data[f]) {
      assert.equal(typeof e.index, "string", `${f}: index`);
      assert.ok(!seen.has(e.index), `${f}: duplicate ${e.index}`);
      seen.add(e.index);
      assert.ok(e.name, `${f}: ${e.index} has name`);
    }
  }
  assert.equal(data.classes.length, 12);
  assert.equal(data.races.length, 9);
  assert.equal(data.backgrounds.length, 13);
  assert.equal(data.skills.length, 18);
  assert.ok(data.spells.length >= 300);
  assert.ok(data.monsters.length >= 300);
});

test("shared/srd stays small and documented", () => {
  let total = 0;
  for (const f of fs.readdirSync(SRD_DIR)) total += fs.statSync(path.join(SRD_DIR, f)).size;
  assert.ok(total < 2.6 * 1024 * 1024, `shared/srd is ${(total / 1048576).toFixed(2)} MB`);
  const lic = fs.readFileSync(path.join(SRD_DIR, "LICENSE.md"), "utf8");
  assert.match(lic, /System Reference Document 5\.1/);
  assert.match(lic, /CC-BY-4\.0|Creative Commons Attribution 4\.0/);
  assert.match(lic, /5e-bits/);
  assert.match(lic, /MIT/);
  assert.ok(fs.existsSync(path.join(SRD_DIR, "README.md")));
});

test("classes: level tables, features, spellcasting", () => {
  for (const c of data.classes) {
    assert.equal(c.levels.length, 20, c.index);
    c.levels.forEach((l, i) => {
      assert.equal(l.level, i + 1);
      assert.equal(l.prof, 2 + Math.floor(i / 4), `${c.index} ${l.level} prof`);
      for (const f of l.features) assert.ok(f.index && f.name && typeof f.desc === "string", `${c.index} feature`);
    });
    assert.ok([6, 8, 10, 12].includes(c.hitDie));
    assert.equal(c.saves.length, 2);
    assert.ok(c.skillChoices.choose >= 2 && c.skillChoices.from.every((s) => SKILL_KEYS.has(s)), c.index);
    assert.ok(c.subclasses.length >= 1);
    for (const s of c.subclasses) assert.ok(s.features.length >= 1 && s.level >= 1);
    assert.ok(c.multiclass && Array.isArray(c.multiclass.prereq));
  }
  const C = by("classes");
  assert.equal(C.get("barbarian").levels[0].specific.rageCount, 2);
  assert.equal(C.get("monk").levels[4].specific.martialArts, "1d6");
  assert.equal(C.get("monk").levels[4].specific.kiPoints, 5);
  assert.equal(C.get("rogue").levels[4].specific.sneakAttack, "3d6");
  assert.equal(C.get("bard").levels[4].specific.bardicInspirationDie, 8);
  assert.equal(C.get("cleric").levels[1].specific.channelDivinity, 1);
  assert.equal(C.get("sorcerer").levels[2].specific.sorceryPoints, 3);
  assert.deepEqual(C.get("wizard").levels[2].slots, [4, 2, 0, 0, 0, 0, 0, 0, 0]);
  assert.equal(C.get("wizard").levels[0].cantrips, 3);
  assert.deepEqual(C.get("warlock").levels[4].pact, { slots: 2, level: 3 });
  assert.equal(C.get("wizard").spellcasting.mode, "spellbook");
  assert.equal(C.get("paladin").spellcasting.type, "half");
  assert.equal(C.get("paladin").spellcasting.level, 2);
  assert.equal(C.get("fighter").spellcasting, null);
  assert.deepEqual(C.get("fighter").asiLevels, [4, 6, 8, 12, 14, 16, 19]);
  assert.deepEqual(C.get("rogue").asiLevels, [4, 8, 10, 12, 16, 19]);
  assert.equal(C.get("rogue").levels[9].asi, true);
  assert.equal(C.get("cleric").subclassLevel, 1);
  assert.equal(C.get("wizard").subclassLevel, 2);
  assert.equal(C.get("fighter").subclassLevel, 3);
  const style = C.get("fighter").levels[0].features.find((f) => f.index === "fighter-fighting-style");
  assert.equal(style.choose, 1);
  assert.ok(style.options.some((o) => o.name === "Fighting Style: Defense" && o.desc.includes("+1 bonus to AC")));
  assert.ok(C.get("barbarian").levels[2].features.some((f) => f.placeholder === undefined));
  assert.deepEqual(C.get("cleric").subclasses[0].spells.slice(0, 2).map((s) => s.index), ["bless", "cure-wounds"]);
  assert.ok(C.get("cleric").proficiencies.armor.includes("Medium Armor"));
  assert.deepEqual(C.get("fighter").proficiencies.weapons, ["Simple Weapons", "Martial Weapons"]);
  assert.equal(C.get("bard").toolChoices[0].choose, 3);
});

test("classes: equipment option sets use concrete items", () => {
  const E = by("equipment");
  for (const c of data.classes) {
    for (const it of c.startingEquipment) assert.ok(E.has(it.index), `${c.index} ${it.index}`);
    for (const set of c.equipmentOptions) {
      assert.ok(set.options.length >= 1);
      for (const o of set.options) {
        for (const it of o.items) assert.ok(E.has(it.index) && it.qty >= 1, `${c.index}: ${it.index}`);
        for (const p of o.picks) {
          assert.ok(p.choose >= 1 && p.from.length >= 1, `${c.index}: ${p.desc}`);
          for (const it of p.from) assert.ok(E.has(it.index), `${c.index}: pick ${it.index}`);
        }
      }
    }
  }
  const simple = data.classes.find((c) => c.index === "warlock").equipmentOptions.find((s) => /any simple weapon/.test(s.desc) && s.options.length === 1);
  assert.equal(simple.options[0].picks[0].from.length, 14);
});

test("races: traits, darkvision, bonuses, subraces", () => {
  const R = by("races");
  assert.equal(R.get("dwarf").darkvision, 60);
  assert.equal(R.get("human").darkvision, 0);
  assert.equal(R.get("dwarf").speed, 25);
  assert.deepEqual(R.get("dwarf").abilityBonuses, { con: 2 });
  assert.deepEqual(R.get("dwarf").subraces[0].abilityBonuses, { wis: 1 });
  assert.equal(R.get("dwarf").subraces[0].hpPerLevel, 1);
  assert.deepEqual(R.get("half-elf").bonusChoices, { choose: 2, amount: 1, from: ["str", "dex", "con", "int", "wis"] });
  assert.equal(R.get("half-elf").proficiencyChoices[0].type, "skills");
  assert.ok(R.get("elf").proficiencies.skills.includes("perception"));
  assert.equal(R.get("elf").subraces[0].cantripChoice.ability, "int");
  assert.equal(R.get("dragonborn").draconicAncestry.length, 10);
  assert.deepEqual(R.get("dragonborn").draconicAncestry.find((a) => a.name === "Red"), { index: "draconic-ancestry-red", name: "Red", damageType: "fire", area: { type: "cone", size: 15 }, save: "dex" });
  for (const r of data.races) {
    assert.ok(r.languages.includes("Common"));
    for (const t of r.traits) assert.ok(t.name && t.desc, `${r.index} trait`);
    for (const k of Object.keys(r.abilityBonuses)) assert.ok(ABILITIES.includes(k));
  }
});

test("backgrounds: 13 with full 5e mechanics and suggestions", () => {
  const expected = ["acolyte", "charlatan", "criminal", "entertainer", "folk-hero", "guild-artisan", "hermit", "noble", "outlander", "sage", "sailor", "soldier", "urchin"];
  assert.deepEqual(data.backgrounds.map((b) => b.index).sort(), expected);
  const E = by("equipment");
  for (const b of data.backgrounds) {
    assert.equal(b.skills.length, 2, b.index);
    for (const s of b.skills) assert.ok(SKILL_KEYS.has(s), `${b.index} skill ${s}`);
    const profCount = b.tools.length + b.toolChoices.reduce((a, t) => a + t.choose, 0) + (b.languageChoices?.choose || 0);
    assert.equal(profCount, 2, `${b.index}: two tool/language proficiencies`);
    assert.ok(b.gold > 0);
    assert.ok(b.feature.name && b.feature.desc && b.feature.desc.length > 40, b.index);
    for (const k of ["traits", "ideals", "bonds", "flaws"]) {
      assert.ok(b.suggestions[k].length >= 3 && b.suggestions[k].length <= 4, `${b.index} ${k}`);
    }
    for (const it of b.equipment) if (it.index) assert.ok(E.has(it.index), `${b.index}: ${it.index}`);
    for (const g of b.equipmentChoices) for (const it of g.from) if (it.index) assert.ok(E.has(it.index), `${b.index}: ${it.index}`);
  }
  assert.equal(data.backgrounds.find((b) => b.index === "acolyte").srd, true);
  assert.equal(data.backgrounds.find((b) => b.index === "criminal").feature.name, "Criminal Contact");
});

test("spells: normalised ranges, damage, healing, areas", () => {
  const S = by("spells");
  const fb = S.get("fireball");
  assert.equal(fb.rangeFt, 150);
  assert.deepEqual(fb.area, { type: "sphere", size: 20 });
  assert.deepEqual(fb.dc, { ability: "dex", success: "half" });
  assert.equal(fb.damage.type, "fire");
  assert.equal(fb.damage.atSlot["3"], "8d6");
  assert.equal(S.get("fire-bolt").attackType, "ranged");
  assert.equal(S.get("fire-bolt").damage.atCharLevel["5"], "2d10");
  assert.equal(S.get("cure-wounds").rangeFt, 5);
  assert.equal(S.get("cure-wounds").heal.atSlot["1"], "1d8");
  assert.equal(S.get("cure-wounds").heal.addMod, true);
  assert.equal(S.get("shield").rangeFt, 0);
  assert.equal(S.get("hold-person").concentration, true);
  assert.equal(S.get("detect-magic").ritual, true);
  assert.ok(S.get("magic-missile").classes.includes("wizard"));
  assert.equal(S.get("sleep").damage, null);
  for (const s of data.spells) {
    assert.ok(s.level >= 0 && s.level <= 9);
    assert.equal(typeof s.desc, "string");
    assert.ok(s.rangeFt === null || Number.isFinite(s.rangeFt), s.index);
    if (s.damage?.atSlot) for (const v of Object.values(s.damage.atSlot)) assert.match(v, /^\d+d\d+([+-]\d+)?$|^\d+$/, s.index);
  }
});

test("monsters: stats and actions are normalised", () => {
  const M = by("monsters");
  const g = M.get("goblin");
  assert.equal(g.ac, 15);
  assert.equal(g.hp, 7);
  assert.deepEqual(g.speed, { walk: 30 });
  assert.deepEqual(g.abilities, { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 });
  assert.deepEqual(g.skills, { stealth: 6 });
  assert.deepEqual(g.senses, { darkvision: 60, passivePerception: 9 });
  assert.equal(g.cr, 0.25);
  assert.equal(g.xp, 50);
  assert.equal(g.sizeCells, 1);
  const sc = g.actions.find((a) => a.name === "Scimitar");
  assert.equal(sc.kind, "melee");
  assert.equal(sc.attackBonus, 4);
  assert.deepEqual(sc.damage, [{ dice: "1d6+2", type: "slashing" }]);
  assert.equal(sc.reachFt, 5);
  const bow = g.actions.find((a) => a.name === "Shortbow");
  assert.equal(bow.kind, "ranged");
  assert.deepEqual(bow.rangeFt, { normal: 80, long: 320 });
  const d = M.get("adult-red-dragon");
  assert.equal(d.sizeCells, 3);
  assert.deepEqual(d.saves, { dex: 6, con: 13, wis: 7, cha: 11 });
  assert.ok(d.immunities.includes("fire"));
  assert.equal(d.speed.fly, 80);
  const multi = d.actions.find((a) => a.kind === "multiattack");
  assert.deepEqual(multi.multiattack, [{ name: "Frightful Presence", count: 1 }, { name: "Bite", count: 1 }, { name: "Claw", count: 2 }]);
  const breath = d.actions.find((a) => a.name === "Fire Breath");
  assert.equal(breath.kind, "save");
  assert.deepEqual(breath.dc, { ability: "dex", value: 21, success: "half" });
  assert.deepEqual(breath.area, { type: "cone", size: 60 });
  assert.deepEqual(breath.usage, { type: "recharge", min: 5 });
  assert.equal(d.legendary.find((a) => /Wing Attack/.test(a.name)).cost, 2);
  const bite = d.actions.find((a) => a.name === "Bite");
  assert.equal(bite.reachFt, 10);
  assert.equal(bite.damage.length, 2);
  const cap = M.get("bandit-captain");
  assert.ok(cap.multiattackAlt === undefined);
  assert.deepEqual(cap.actions[0].multiattackAlt, [[{ name: "Dagger", count: 2 }]]);
  const mage = M.get("mage");
  assert.equal(mage.spellcasting.dc, 14);
  assert.ok(mage.spellcasting.spells.includes("fireball"));
  for (const m of data.monsters) {
    assert.ok(Number.isFinite(m.ac) && m.hp > 0 && Number.isFinite(m.cr), m.index);
    for (const k of ABILITIES) assert.ok(Number.isFinite(m.abilities[k]), `${m.index} ${k}`);
    for (const a of [...m.actions, ...m.reactions, ...m.legendary]) {
      assert.ok(["melee", "ranged", "save", "multiattack", "other"].includes(a.kind), `${m.index}: ${a.name}`);
      assert.ok(Array.isArray(a.damage));
      for (const dm of a.damage) assert.match(dm.dice, /^\d+d\d+([+-]\d+)?$|^\d+$/, `${m.index}: ${a.name}`);
      if (a.kind === "melee" || a.kind === "ranged") assert.ok(Number.isFinite(a.attackBonus), `${m.index}: ${a.name}`);
      if (a.kind === "multiattack") assert.ok(Array.isArray(a.multiattack));
    }
  }
});

test("equipment: weapons, armor, packs", () => {
  const E = by("equipment");
  assert.deepEqual(
    (({ type, category, range, damage, damageType, versatile, properties, reachFt, rangeFt, cost, weight }) => ({ type, category, range, damage, damageType, versatile, properties, reachFt, rangeFt, cost, weight }))(E.get("longsword")),
    { type: "weapon", category: "martial", range: "melee", damage: "1d8", damageType: "slashing", versatile: "1d10", properties: ["versatile"], reachFt: 5, rangeFt: null, cost: 15, weight: 3 }
  );
  assert.deepEqual(E.get("longbow").rangeFt, { normal: 150, long: 600 });
  assert.deepEqual(E.get("dagger").throwFt, { normal: 20, long: 60 });
  assert.equal(E.get("glaive").reachFt, 10);
  assert.equal(E.get("javelin").cost, 0.5);
  const cm = E.get("chain-mail");
  assert.equal(cm.armorType, "heavy");
  assert.equal(cm.ac, 16);
  assert.equal(cm.strMin, 13);
  assert.equal(cm.stealthDisadvantage, true);
  assert.equal(E.get("hide-armor").maxDex, 2);
  assert.equal(E.get("leather-armor").maxDex, null);
  assert.equal(E.get("shield").armorType, "shield");
  const pack = E.get("explorers-pack");
  assert.equal(pack.type, "pack");
  assert.ok(pack.contents.some((c) => c.index === "torch" && c.qty === 10));
  assert.equal(E.get("arrow").bundle, 20);
  assert.equal(E.get("lute").toolCategory, "musical-instruments");
  assert.equal(data.equipment.filter((e) => e.categories.includes("martial-weapons")).length, 23);
  assert.equal(data.equipment.filter((e) => e.categories.includes("simple-weapons")).length, 14);
});

test("features, conditions, skills, magic items, languages", () => {
  const F = by("features");
  assert.equal(F.get("second-wind").class, "fighter");
  assert.equal(F.get("second-wind").level, 1);
  assert.ok(F.get("fighter-fighting-style").options.includes("fighter-fighting-style-defense"));
  assert.ok(data.conditions.some((c) => c.index === "prone" && c.desc.length > 20));
  const sk = data.skills.find((s) => s.key === "sleightOfHand");
  assert.equal(sk.ability, "dex");
  assert.equal(sk.index, "sleight-of-hand");
  const MI = by("magic-items");
  assert.equal(MI.get("bag-of-holding").rarity, "Uncommon");
  assert.equal(MI.get("bag-of-holding").attunement, false);
  assert.ok(MI.get("ammunition").variants.includes("ammunition-1"));
  assert.equal(MI.get("ammunition-1").variantOf, "ammunition");
  assert.ok(data["magic-items"].some((m) => m.attunement));
  assert.ok(data.languages.some((l) => l.name === "Elvish" && l.type === "Standard"));
});
