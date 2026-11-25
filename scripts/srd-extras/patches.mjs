// Fixes and additions to the SRD's own classes: choices the SRD data describes in words but doesn't offer, and the
// spellcasting tables of the two subclasses that cast (Eldritch Knight, Arcane Trickster). Text is our own.

const LANDS = [
  ["arctic", "Arctic", "frozen plains, glaciers and tundra"],
  ["coast", "Coast", "shores, cliffs and tidal flats"],
  ["desert", "Desert", "dunes, badlands and scrub"],
  ["forest", "Forest", "deep woods and old groves"],
  ["grassland", "Grassland", "prairies, steppes and savannah"],
  ["mountain", "Mountain", "peaks, passes and high crags"],
  ["swamp", "Swamp", "bogs, marshes and fens"],
  ["underdark", "Underdark", "the caverns and tunnels far below the surface"],
];
// the eighth land of the circle (the SRD lists seven): its circle spells at druid levels 3, 5, 7, 9
const UNDERDARK_SPELLS = [[3, "spider-climb"], [3, "web"], [5, "gaseous-form"], [5, "stinking-cloud"], [7, "greater-invisibility"], [7, "stone-shape"], [9, "cloudkill"], [9, "insect-plague"]];

// Eldritch Knight and Arcane Trickster: a third of a wizard's casting, from the wizard list (Intelligence)
const THIRD_KNOWN = { 3: 3, 4: 4, 7: 5, 8: 6, 10: 7, 11: 8, 13: 9, 14: 10, 16: 11, 19: 12, 20: 13 };
const CASTING = {
  "eldritch-knight": { list: "wizard", ability: "int", type: "third", mode: "known", from: 3, schools: ["abjuration", "evocation"], anySchoolAt: [3, 8, 14, 20], cantrips: { 3: 2, 10: 3 }, known: THIRD_KNOWN },
  "arcane-trickster": { list: "wizard", ability: "int", type: "third", mode: "known", from: 3, schools: ["enchantment", "illusion"], anySchoolAt: [3, 8, 14, 20], cantrips: { 3: 2, 10: 3 }, known: THIRD_KNOWN },
};

const feat = (cls, level, index) => cls.levels[level - 1]?.features?.find((f) => f.index === index);

export function patchClasses(classes, { spellName = (i) => i } = {}) {
  const C = (k) => classes.find((c) => c.index === k);

  // ── table errors in the SRD data: invocations known go up at 5th and 7th (not 4th and 6th), and the third
  // metamagic option comes at 17th (not 16th) ──
  const INVOCATIONS = [0, 2, 2, 2, 3, 3, 4, 4, 5, 5, 5, 6, 6, 6, 7, 7, 7, 8, 8, 8];
  const METAMAGIC = [0, 0, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 3, 3, 4, 4, 4, 4];
  C("warlock")?.levels.forEach((r, i) => { r.specific = { ...(r.specific || {}), invocationsKnown: INVOCATIONS[i] }; });
  C("sorcerer")?.levels.forEach((r, i) => { r.specific = { ...(r.specific || {}), metamagicKnown: METAMAGIC[i] }; });

  // ── warlock: more invocations as the class table grows (the SRD offers the choice only at 2nd level) ──
  const warlock = C("warlock");
  if (warlock) {
    const first = feat(warlock, 2, "eldritch-invocations");
    if (first) {
      first.choose = warlock.levels[1].specific?.invocationsKnown ?? 2;
      for (let l = 3; l <= 20; l++) {
        const now = warlock.levels[l - 1].specific?.invocationsKnown ?? 0;
        const before = warlock.levels[l - 2].specific?.invocationsKnown ?? 0;
        if (now > before && !feat(warlock, l, `eldritch-invocations-${l}`)) {
          warlock.levels[l - 1].features.push({
            index: `eldritch-invocations-${l}`, name: "Eldritch Invocations",
            desc: `You learn ${now - before === 1 ? "one more invocation" : `${now - before} more invocations`} (${now} in all). Ones whose requirements you don't meet yet aren't offered.`,
            choose: now - before, options: first.options,
          });
        }
      }
    }
    // Mystic Arcanum: the spell itself is a choice
    for (const [l, sl] of [[11, 6], [13, 7], [15, 8], [17, 9]]) {
      const f = feat(warlock, l, `mystic-arcanum-${sl}th-level`);
      if (f) f.pick = { type: "spell", choose: 1, lists: ["warlock"], level: sl, label: `Mystic Arcanum (${sl}th level)` };
    }
  }

  // ── bard: Magical Secrets picks (they're part of the bard's spells known) and Lore's extra secrets at 6th ──
  const bard = C("bard");
  if (bard) {
    for (const [l, i] of [[10, "magical-secrets-1"], [14, "magical-secrets-2"], [18, "magical-secrets-3"]]) {
      const f = feat(bard, l, i);
      if (f) f.pick = { type: "spell", choose: 2, lists: "any", maxLevel: "castable", minLevel: 1, countsAsKnown: true, label: "Magical Secrets" };
    }
    const lore = bard.subclasses.find((s) => s.index === "lore");
    const extra = lore?.features.find((f) => f.level === 6 && /magical secrets/i.test(f.name));
    if (extra) extra.pick = { type: "spell", choose: 2, lists: "any", maxLevel: "castable", minLevel: 1, label: "Additional Magical Secrets" };
  }

  // ── wizard: Spell Mastery (a 1st- and a 2nd-level spell) and Signature Spells (two 3rd-level spells) ──
  const wizard = C("wizard");
  if (wizard) {
    const m = feat(wizard, 18, "spell-mastery");
    if (m) {
      m.pick = { type: "spell", choose: 1, from: "known", level: 1, label: "Spell Mastery (1st level)" };
      if (!feat(wizard, 18, "spell-mastery-2nd")) {
        wizard.levels[17].features.push({ index: "spell-mastery-2nd", name: "Spell Mastery (2nd level)", desc: "Your second mastered spell: a 2nd-level spell from your spellbook that you can cast at its lowest level without a slot, as often as you like, while you have it prepared.",
          pick: { type: "spell", choose: 1, from: "known", level: 2, label: "Spell Mastery (2nd level)" } });
      }
    }
    const s = feat(wizard, 20, "signature-spell");
    if (s) s.pick = { type: "spell", choose: 2, from: "known", level: 3, label: "Signature Spells" };
  }

  // ── druid, Circle of the Land: pick the land (its circle spells follow) and the bonus cantrip ──
  const druid = C("druid");
  const land = druid?.subclasses.find((s) => s.index === "land");
  if (land) {
    if (!land.features.some((f) => f.index === "circle-of-the-land")) {
      const at = land.features.findIndex((f) => f.level === 2);
      land.features.splice(Math.max(0, at), 0, {
        level: 2, index: "circle-of-the-land", name: "Circle Spells: your land",
        desc: "Your circle is bound to one kind of land. It decides the circle spells you always have prepared at 3rd, 5th, 7th and 9th level.",
        choose: 1,
        options: LANDS.map(([k, name, what]) => ({ index: `circle-of-the-land-${k}`, name: `Land: ${name}`, desc: `Your magic is rooted in ${what}.` })),
      });
    }
    const bonus = land.features.find((f) => f.index === "bonus-cantrip");
    if (bonus) bonus.pick = { type: "cantrip", choose: 1, list: "druid", label: "Bonus Cantrip" };
    for (const [l, i] of UNDERDARK_SPELLS) {
      if (!land.spells.some((s) => s.index === i && s.requires === "circle-of-the-land-underdark")) land.spells.push({ level: l, index: i, name: spellName(i), requires: "circle-of-the-land-underdark" });
    }
  }

  // ── cleric, Life Domain: its heavy armor proficiency as data (the app used to special-case it) ──
  const life = C("cleric")?.subclasses.find((s) => s.index === "life");
  const prof = life?.features.find((f) => f.index === "bonus-proficiency");
  if (prof) prof.grants = { armor: ["Heavy Armor"] };

  // ── spellcasting subclasses ──
  for (const c of classes) for (const s of c.subclasses) if (CASTING[s.index]) s.casting = CASTING[s.index];
}
