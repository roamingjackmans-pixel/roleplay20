// Roguish archetypes from the Player's Handbook that the SRD lacks, summarised in our own words for Roleplay20.
export default [
  {
    index: "assassin",
    name: "Assassin",
    flavor: "Roguish Archetype",
    srd: false,
    desc: "A specialist in disguise, poison and the perfect opening, who ends a fight before the target realises it has begun.",
    level: 3,
    features: [
      {
        level: 3,
        index: "assassin-bonus-proficiencies",
        name: "Bonus Proficiencies",
        desc: "You become proficient with the disguise kit and the poisoner's kit.",
        grants: { tools: ["Disguise Kit", "Poisoner's Kit"] },
      },
      {
        level: 3,
        index: "assassin-assassinate",
        name: "Assassinate",
        desc:
          "You have advantage on attack rolls against any creature that hasn't taken a turn yet in the current combat. " +
          "Every hit you land on a surprised creature is a critical hit.",
      },
      {
        level: 9,
        index: "assassin-infiltration-expertise",
        name: "Infiltration Expertise",
        desc:
          "By spending 7 days and 25 gp you can set up a dependable false identity: a history, a profession and contacts, " +
          "backed by fitting clothes, official-looking papers and letters of introduction. It has to be a new persona; you " +
          "can't take over a real person's identity this way.\n" +
          "Whenever you wear that persona as a disguise, other creatures accept you as that person unless something " +
          "obviously gives you away.",
      },
      {
        level: 13,
        index: "assassin-impostor",
        name: "Impostor",
        desc:
          "After spending at least 3 hours studying a person (listening to them talk, examining their handwriting and " +
          "watching their mannerisms), you can copy their voice, writing and behaviour flawlessly. Casual observers can't " +
          "see through it; if a wary creature suspects something is off, you have advantage on Charisma (Deception) " +
          "checks to keep from being found out.",
      },
      {
        level: 17,
        index: "assassin-death-strike",
        name: "Death Strike",
        desc:
          "When you hit a surprised creature with an attack, it makes a Constitution saving throw against DC 8 + your " +
          "Dexterity modifier + your proficiency bonus. On a failure, the damage of that attack against it is doubled.",
      },
    ],
  },
  {
    index: "arcane-trickster",
    name: "Arcane Trickster",
    flavor: "Roguish Archetype",
    srd: false,
    desc: "A rogue who adds a measure of wizardry to the trade, clouding minds with enchantment and illusion and lifting what fingers can't reach with an unseen hand.",
    level: 3,
    features: [
      {
        level: 3,
        index: "arcane-trickster-spellcasting",
        name: "Spellcasting",
        desc:
          "You cast spells from the wizard spell list, with Intelligence as your spellcasting ability (spell save DC = 8 + " +
          "your proficiency bonus + your Intelligence modifier; spell attack bonus = your proficiency bonus + your " +
          "Intelligence modifier). You have 1st-level slots from 3rd level, 2nd-level slots from 7th, 3rd-level from 13th " +
          "and 4th-level from 19th, and you regain expended slots on a long rest.\n" +
          "Cantrips: you know mage hand plus two other wizard cantrips of your choice, and you learn one more wizard " +
          "cantrip at 10th level.\n" +
          "Spells known: you start with three 1st-level wizard spells and learn more as you gain levels (your sheet shows " +
          "how many). They must be enchantment or illusion spells, except for one spell of any school you choose at 3rd " +
          "level and one more each at 8th, 14th and 20th level.\n" +
          "Whenever you gain a rogue level, you can swap one wizard spell you know for another of a level you have slots " +
          "for. The new spell must be enchantment or illusion, unless it replaces one of your any-school spells.",
        grants: { cantrips: ["mage-hand"] },
      },
      {
        level: 3,
        index: "arcane-trickster-mage-hand-legerdemain",
        name: "Mage Hand Legerdemain",
        desc:
          "When you cast mage hand, you can make the spectral hand invisible, and it can do three extra things: slip an " +
          "object it holds into a container another creature is wearing or carrying, take an object out of such a " +
          "container, or use thieves' tools at a distance to pick a lock or disarm a trap.\n" +
          "To do one of these without a creature noticing, win a Dexterity (Sleight of Hand) check against that " +
          "creature's Wisdom (Perception) check. You can also control the hand with the bonus action from Cunning Action.",
      },
      {
        level: 9,
        index: "arcane-trickster-magical-ambush",
        name: "Magical Ambush",
        desc:
          "If you are hidden from a creature when you cast a spell on it, that creature has disadvantage on any saving " +
          "throw it makes against the spell this turn.",
      },
      {
        level: 13,
        index: "arcane-trickster-versatile-trickster",
        name: "Versatile Trickster",
        desc:
          "As a bonus action, choose a creature within 5 feet of your mage hand's spectral hand. You have advantage on " +
          "attack rolls against that creature until the end of the turn.",
      },
      {
        level: 17,
        index: "arcane-trickster-spell-thief",
        name: "Spell Thief",
        desc:
          "Right after a creature casts a spell that targets you or includes you in its area, you can use your reaction " +
          "to force it to make a saving throw with its spellcasting ability modifier against your spell save DC. On a " +
          "failure, the spell has no effect on you, and if it is 1st level or higher and of a level you can cast, you " +
          "steal it: for the next 8 hours you know the spell (even if it isn't a wizard spell) and can cast it with your " +
          "own spell slots, and the creature can't cast it until those 8 hours are up.\n" +
          "Once you use this feature, you can't use it again until you finish a long rest.",
      },
    ],
  },
];
