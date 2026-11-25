# Class options beyond the SRD

The SRD (`data-src/srd-raw`, compiled by `scripts/build-srd.mjs` into `shared/srd/*.json`) has one subclass per class
and leaves out about forty Player's Handbook spells. The standard options it lacks live here, **written in our own words
for Roleplay20** (never copied from any book), and `build-srd.mjs` merges them into `shared/srd/classes.json` and
`shared/srd/spells.json` with `srd: false`.

- `subclasses/<class>.mjs`: `export default [ Subclass, ... ]` (the class's Player's Handbook subclasses the SRD lacks)
- `spells.mjs`: `export default [ Spell, ... ]` (Player's Handbook spells the SRD lacks)
- `patches.mjs`: fixes and additions to the SRD's own classes and subclasses (choices it leaves out)

## Subclass

```js
{
  index: "battle-master",            // kebab-case, unique within the class
  name: "Battle Master",
  flavor: "Martial Archetype",       // the class's subclass word, same as the SRD subclass of that class
  srd: false,
  desc: "One or two sentences of flavour, in our own words.",
  level: 3,                          // class level the subclass is chosen (same as the SRD subclass of that class)
  features: [Feature, ...],          // every subclass feature at every level, in level order
  spells: [{ level: 1, index: "bless", name: "Bless" }, ...],
      // clerics, paladins, druids: spells always prepared from that class level; warlocks: the patron's expanded spell
      // list (added to the warlock spells they may learn). `level` is the CLASS level (cleric 1, 3, 5, 7, 9;
      // paladin 3, 5, 9, 13, 17; warlock 1, 3, 5, 7, 9 for spell levels 1-5). Omit for other classes.
}
```

### Feature

```js
{
  level: 3,
  index: "battle-master-combat-superiority",   // globally unique: start with the subclass index
  name: "Combat Superiority",
  desc: "What it does, in our own words, with all the numbers a player needs (dice, ranges, uses, recharge).",
  // optional: the player chooses among options (fighting styles, maneuvers, totems, disciplines...)
  choose: 3,
  options: [{ index: "maneuver-trip-attack", name: "Maneuver: Trip Attack", desc: "..." }, ...],
  // optional: what the feature (or an option, which can carry its own `grants`) gives the character's sheet
  grants: {
    armor: ["Heavy Armor"],          // proficiency names as the SRD writes them: "Light Armor", "Medium Armor",
    weapons: ["Martial Weapons"],    //   "Heavy Armor", "Shields", "Simple Weapons", "Martial Weapons"
    tools: ["Disguise Kit"],
    skills: ["arcana"],              // camelCase skill keys (animalHandling, sleightOfHand...)
    expertise: ["arcana"],           // double proficiency
    languages: ["Draconic"],
    cantrips: ["light"],             // spell indexes (shared/srd/spells.json or spells.mjs): always known, don't count
    spells: ["speak-with-animals"],  // always prepared / known, don't count against the class's number
    saves: ["wis"],
  },
  // optional: a choice the app builds from its own lists at level-up time instead of fixed options
  pick: { type: "skill", choose: 2, from: ["arcana", "history", "nature", "religion"], expertise: true },
      // type "skill"    { choose, from: [skill keys], expertise? }
      // type "language" { choose }                         any standard or exotic language not known yet
      // type "tool"     { choose, from: "artisans-tools" | "musical-instruments" | "gaming-sets" | [tool names] }
      // type "cantrip"  { choose, list: "druid" }           a cantrip from that class's list
      // type "spell"    { choose, lists: ["wizard"] | "any", level: 3 | maxLevel: "castable" (+ minLevel), schools?: [...],
      //                   from?: "known" (a spell the character already has), countsAsKnown? (part of the class's
      //                   spells known, like Magical Secrets) }
}
```

A feature that is a choice (`options` or `pick`) shows up as a choice in the character creator and the level-up
helper, and the player has to make it. Additional picks at later levels (Battle Master maneuvers at 7, 10 and 15,
Four Elements disciplines at 6, 11 and 17) are their own features with their own `choose`, offering the same options;
the app hides options the character already has.

An option can say when it becomes available: `requires: { level: 6 }` (class level), `{ pact: "pact-of-the-blade" }`,
`{ cantrip: "eldritch-blast" }`, `{ feature: "<feature or option index>" }` (several keys = all of them). Options it
doesn't meet yet are left out of the list.

Non-spellcasting classes (barbarian, monk, rogue and fighter outside Eldritch Knight / Arcane Trickster) must not use
`grants.spells` or `grants.cantrips`: describe ritual or ki-cast spells in the text instead.

Option `index` values must be unique across the whole class (prefix them: `maneuver-`, `discipline-`, `totem-bear-`...).
Option names use "Prefix: Name" (e.g. "Maneuver: Riposte"): the app shows the part after the colon where it lists
options under their feature.

## Spell

The shape of `shared/srd/spells.json` (see the header of `scripts/build-srd.mjs` and the `dissonant-whispers` entry
there), plus `srd: false`. `desc` and `higherLevel` in our own words; the numbers (damage dice, save, range, area,
duration) follow the standard rules so the app's automation works.
