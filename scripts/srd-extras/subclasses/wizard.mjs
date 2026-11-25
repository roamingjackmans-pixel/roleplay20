// Arcane traditions (schools of magic) from the Player's Handbook that the SRD lacks, summarised in our own words
// for Roleplay20.

const savant = (school, label) => ({
  level: 2,
  index: `${school}-savant`,
  name: `${label} Savant`,
  desc: `The gold and time you spend copying a${/^[aeiou]/i.test(label) ? "n" : ""} ${school} spell into your spellbook are halved.`,
});

export default [
  {
    index: "abjuration",
    name: "Abjuration",
    flavor: "Arcane Tradition",
    srd: false,
    desc: "You study the magic of wards and barriers: shielding allies, banishing intruders and unravelling hostile spells before they land.",
    level: 2,
    features: [
      savant("abjuration", "Abjuration"),
      {
        level: 2,
        index: "abjuration-arcane-ward",
        name: "Arcane Ward",
        desc:
          "When you cast an abjuration spell of 1st level or higher, you can also wrap yourself in a magical ward that " +
          "lasts until you finish a long rest. You can create the ward only once per long rest.\n" +
          "The ward has a hit point maximum of twice your wizard level + your Intelligence modifier. When you take " +
          "damage, the ward takes it first; whatever is left after the ward drops to 0 hit points carries over to you. " +
          "At 0 hit points the ward absorbs nothing, but it still exists, and each time you cast an abjuration spell of " +
          "1st level or higher it regains hit points equal to twice the spell's level.",
      },
      {
        level: 6,
        index: "abjuration-projected-ward",
        name: "Projected Ward",
        desc:
          "When a creature you can see within 30 feet of you takes damage, you can use your reaction to have your Arcane " +
          "Ward absorb that damage instead. If the ward drops to 0 hit points, the creature takes whatever damage is left.",
      },
      {
        level: 10,
        index: "abjuration-improved-abjuration",
        name: "Improved Abjuration",
        desc:
          "When an abjuration spell has you make an ability check as part of casting it (counterspell and dispel magic, " +
          "for example), you add your proficiency bonus to that check.",
      },
      {
        level: 14,
        index: "abjuration-spell-resistance",
        name: "Spell Resistance",
        desc: "You have advantage on saving throws against spells, and you have resistance to damage from spells.",
      },
    ],
  },
  {
    index: "conjuration",
    name: "Conjuration",
    flavor: "Arcane Tradition",
    srd: false,
    desc: "You pull creatures and objects out of thin air and step from one place to another, mastering the magic of summoning and travel.",
    level: 2,
    features: [
      savant("conjuration", "Conjuration"),
      {
        level: 2,
        index: "conjuration-minor-conjuration",
        name: "Minor Conjuration",
        desc:
          "As an action, you create an inanimate, nonmagical object in your hand or in an unoccupied space you can see " +
          "within 10 feet of you. It must be something you have seen before, no more than 3 feet on a side and no heavier " +
          "than 10 pounds. It is obviously magical and sheds dim light within 5 feet. It disappears after 1 hour, when " +
          "you use this feature again, or as soon as it takes or deals any damage.",
      },
      {
        level: 6,
        index: "conjuration-benign-transposition",
        name: "Benign Transposition",
        desc:
          "As an action, you teleport up to 30 feet to an unoccupied space you can see, or trade places with a willing " +
          "Small or Medium creature within that range.\n" +
          "Once you use this feature, you can't use it again until you finish a long rest or cast a conjuration spell of " +
          "1st level or higher.",
      },
      {
        level: 10,
        index: "conjuration-focused-conjuration",
        name: "Focused Conjuration",
        desc: "Taking damage can't break your concentration on a conjuration spell.",
      },
      {
        level: 14,
        index: "conjuration-durable-summons",
        name: "Durable Summons",
        desc: "Every creature you summon or create with a conjuration spell has 30 temporary hit points.",
      },
    ],
  },
  {
    index: "divination",
    name: "Divination",
    flavor: "Arcane Tradition",
    srd: false,
    desc: "You read omens and glimpse what is hidden or still to come, and fate bends a little toward what you have foreseen.",
    level: 2,
    features: [
      savant("divination", "Divination"),
      {
        level: 2,
        index: "divination-portent",
        name: "Portent",
        desc:
          "Each time you finish a long rest, roll two d20s and note the results: these are your foretelling rolls. You " +
          "can replace an attack roll, saving throw or ability check made by you or by a creature you can see with one " +
          "of them. You must decide before the roll is made, you can do this only once per turn, and each foretelling " +
          "roll can be used only once. Any you haven't used are lost when you finish your next long rest.",
      },
      {
        level: 6,
        index: "divination-expert-divination",
        name: "Expert Divination",
        desc:
          "When you cast a divination spell of 2nd level or higher using a spell slot, you regain one expended spell " +
          "slot. The regained slot must be of a lower level than the spell you cast, and no higher than 5th level.",
      },
      {
        level: 10,
        index: "divination-the-third-eye",
        name: "The Third Eye",
        desc:
          "As an action, you sharpen your senses, choosing one of the benefits below each time you use this feature. It " +
          "lasts until you are incapacitated or you take a short or long rest, and you can't use the feature again until " +
          "you finish a short or long rest.\n" +
          "Darkvision: you gain darkvision out to 60 feet.\n" +
          "Ethereal Sight: you can see into the Ethereal Plane within 60 feet of you.\n" +
          "Greater Comprehension: you can read any language.\n" +
          "See Invisibility: you can see invisible creatures and objects within 10 feet of you that are in your line of sight.",
      },
      {
        level: 14,
        index: "divination-greater-portent",
        name: "Greater Portent",
        desc: "Your Portent now gives you three foretelling rolls (three d20s) after each long rest instead of two.",
      },
    ],
  },
  {
    index: "enchantment",
    name: "Enchantment",
    flavor: "Arcane Tradition",
    srd: false,
    desc: "You master magic that sways minds, turning enemies into friends and friends into followers with a glance and a word.",
    level: 2,
    features: [
      savant("enchantment", "Enchantment"),
      {
        level: 2,
        index: "enchantment-hypnotic-gaze",
        name: "Hypnotic Gaze",
        desc:
          "As an action, choose a creature you can see within 5 feet of you. If it can see or hear you, it must succeed " +
          "on a Wisdom saving throw against your spell save DC or be charmed by you until the end of your next turn. " +
          "While charmed this way, its speed is 0 and it is incapacitated and visibly dazed.\n" +
          "On later turns you can spend your action to extend the effect until the end of your next turn. It ends early " +
          "if you move more than 5 feet away from the creature, if it can neither see nor hear you, or if it takes " +
          "damage. Once the effect ends, or if the creature succeeds on its first save, you can't use this feature on " +
          "that creature again until you finish a long rest.",
      },
      {
        level: 6,
        index: "enchantment-instinctive-charm",
        name: "Instinctive Charm",
        desc:
          "When a creature you can see within 30 feet of you makes an attack roll against you, you can use your reaction " +
          "to try to redirect it, as long as another creature is within the attack's range. You decide before you know " +
          "whether the attack hits. The attacker makes a Wisdom saving throw against your spell save DC; on a failure it " +
          "must attack the creature closest to it other than you and itself (the attacker picks if several are equally " +
          "close). On a success, you can't use this feature on that attacker again until you finish a long rest. " +
          "Creatures that can't be charmed are immune.",
      },
      {
        level: 10,
        index: "enchantment-split-enchantment",
        name: "Split Enchantment",
        desc:
          "When you cast an enchantment spell of 1st level or higher that targets only one creature, you can have it " +
          "target a second creature as well.",
      },
      {
        level: 14,
        index: "enchantment-alter-memories",
        name: "Alter Memories",
        desc:
          "When you cast an enchantment spell that charms one or more creatures, you can make one of them unaware that it " +
          "is charmed. In addition, once before the spell ends, you can use your action to blur that creature's memory of " +
          "the time it spent charmed: it makes an Intelligence saving throw against your spell save DC or forgets up to " +
          "1 + your Charisma modifier hours (minimum 1). You may erase less, and never more than the spell's duration.",
      },
    ],
  },
  {
    index: "illusion",
    name: "Illusion",
    flavor: "Arcane Tradition",
    srd: false,
    desc: "You weave light, sound and suggestion into convincing falsehoods, until the line between what seems and what is wears thin.",
    level: 2,
    features: [
      savant("illusion", "Illusion"),
      {
        level: 2,
        index: "illusion-improved-minor-illusion",
        name: "Improved Minor Illusion",
        desc:
          "You learn the minor illusion cantrip (if you already know it, you learn another wizard cantrip of your choice " +
          "instead), and it doesn't count against your cantrips known. When you cast minor illusion, one casting can " +
          "create both a sound and an image.",
        grants: { cantrips: ["minor-illusion"] },
      },
      {
        level: 6,
        index: "illusion-malleable-illusions",
        name: "Malleable Illusions",
        desc:
          "While an illusion spell of yours with a duration of 1 minute or longer is active and you can see the illusion, " +
          "you can use your action to change it, within the spell's normal limits.",
      },
      {
        level: 10,
        index: "illusion-illusory-self",
        name: "Illusory Self",
        desc:
          "When a creature makes an attack roll against you, you can use your reaction to put an illusory double of " +
          "yourself in the way. The attack automatically misses you, and the double fades.\n" +
          "Once you use this feature, you can't use it again until you finish a short or long rest.",
      },
      {
        level: 14,
        index: "illusion-illusory-reality",
        name: "Illusory Reality",
        desc:
          "When you cast an illusion spell of 1st level or higher, you can pick one inanimate, nonmagical object that is " +
          "part of the illusion and make it real for 1 minute, using a bonus action on your turn while the spell lasts " +
          "(an illusory ladder your friends can actually climb, say). The object can't deal damage or directly harm anyone.",
      },
    ],
  },
  {
    index: "necromancy",
    name: "Necromancy",
    flavor: "Arcane Tradition",
    srd: false,
    desc: "You study the forces of life, death and undeath, drawing strength from the fallen and bending the dead to your will.",
    level: 2,
    features: [
      savant("necromancy", "Necromancy"),
      {
        level: 2,
        index: "necromancy-grim-harvest",
        name: "Grim Harvest",
        desc:
          "Once per turn, when a spell of 1st level or higher that you cast kills one or more creatures, you regain hit " +
          "points equal to twice the spell's level, or three times its level if it is a necromancy spell. Killing " +
          "constructs or undead gives you nothing.",
      },
      {
        level: 6,
        index: "necromancy-undead-thralls",
        name: "Undead Thralls",
        desc:
          "Animate dead goes into your spellbook if it isn't there already. When you cast it, you can target one extra " +
          "corpse or pile of bones, raising one more zombie or skeleton.\n" +
          "Every undead you create with a necromancy spell has its hit point maximum increased by your wizard level and " +
          "adds your proficiency bonus to its weapon damage rolls.",
        grants: { spells: ["animate-dead"] },
      },
      {
        level: 10,
        index: "necromancy-inured-to-undeath",
        name: "Inured to Undeath",
        desc: "You have resistance to necrotic damage, and your hit point maximum can't be reduced.",
      },
      {
        level: 14,
        index: "necromancy-command-undead",
        name: "Command Undead",
        desc:
          "As an action, choose an undead you can see within 60 feet of you. It makes a Charisma saving throw against " +
          "your spell save DC. On a success, you can never use this feature on it again. On a failure, it becomes " +
          "friendly to you and obeys your commands until you use this feature again.\n" +
          "Clever undead resist: one with Intelligence 8 or higher has advantage on the save, and one with Intelligence " +
          "12 or higher that fails can repeat the save at the end of every hour until it succeeds and breaks free.",
      },
    ],
  },
  {
    index: "transmutation",
    name: "Transmutation",
    flavor: "Arcane Tradition",
    srd: false,
    desc: "You reshape matter and flesh alike, turning one substance into another and chasing the alchemist's dream of perfect change.",
    level: 2,
    features: [
      savant("transmutation", "Transmutation"),
      {
        level: 2,
        index: "transmutation-minor-alchemy",
        name: "Minor Alchemy",
        desc:
          "You can temporarily turn a nonmagical object made entirely of wood, stone (not gemstones), iron, copper or " +
          "silver into a different one of those materials. Each 10 minutes of work transforms up to 1 cubic foot. The " +
          "change lasts 1 hour or until your concentration breaks (you concentrate as if on a spell), then the material " +
          "returns to what it was.",
      },
      {
        level: 6,
        index: "transmutation-transmuters-stone",
        name: "Transmuter's Stone",
        desc:
          "Over 8 hours you can craft a transmuter's stone. Whoever carries it (you, or someone you give it to) gains one " +
          "benefit you choose when you make it:\n" +
          "Darkvision out to 60 feet.\n" +
          "+10 feet of speed while unencumbered.\n" +
          "Proficiency in Constitution saving throws.\n" +
          "Resistance to acid, cold, fire, lightning or thunder damage (pick the type each time you choose this benefit).\n" +
          "While the stone is on you, you can switch its benefit each time you cast a transmutation spell of 1st level or " +
          "higher. If you make a new stone, the old one stops working.",
      },
      {
        level: 10,
        index: "transmutation-shapechanger",
        name: "Shapechanger",
        desc:
          "Polymorph goes into your spellbook if it isn't there already. You can cast it without using a spell slot, but " +
          "then it can target only you, and you must become a beast of challenge rating 1 or lower. After casting it this " +
          "way, you can't do so again until you finish a short or long rest; you can still cast it normally with a slot.",
        grants: { spells: ["polymorph"] },
      },
      {
        level: 14,
        index: "transmutation-master-transmuter",
        name: "Master Transmuter",
        desc:
          "As an action, you can release all the magic stored in your transmuter's stone at once for one of the effects " +
          "below. The stone is destroyed, and you can't make a new one until you finish a long rest.\n" +
          "Major Transformation: after 10 minutes of handling a nonmagical object no bigger than a 5-foot cube, you turn " +
          "it into another nonmagical object of similar size and mass and of equal or lower value.\n" +
          "Panacea: a creature you touch is cured of all curses, diseases and poisons and regains all its hit points.\n" +
          "Restore Life: you cast raise dead on a creature you touch with the stone, without using a spell slot or " +
          "needing the spell in your spellbook.\n" +
          "Restore Youth: a willing creature you touch with the stone becomes 3d10 years younger in appearance (minimum " +
          "13 years old); its lifespan is not extended.",
      },
    ],
  },
];
