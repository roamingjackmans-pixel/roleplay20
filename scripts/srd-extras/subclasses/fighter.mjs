// Fighter martial archetypes from the Player's Handbook (2014) that the SRD lacks, written in our own words for
// Roleplay20. See ../README.md for the format.

// The sixteen maneuvers. Every superiority die spent is one die from your pool; one maneuver per attack.
const MANEUVERS = [
  {
    index: "maneuver-commanders-strike",
    name: "Maneuver: Commander's Strike",
    desc: "When you take the Attack action, give up one of your attacks and use your bonus action to spend a superiority die. A friendly creature that can see or hear you may immediately use its reaction to make one weapon attack, adding the die to its damage roll.",
  },
  {
    index: "maneuver-disarming-attack",
    name: "Maneuver: Disarming Attack",
    desc: "On a hit with a weapon attack, spend a superiority die and add it to the damage. The target makes a Strength save against your maneuver save DC; on a failure it drops one item of your choice that it is holding, which lands at its feet.",
  },
  {
    index: "maneuver-distracting-strike",
    name: "Maneuver: Distracting Strike",
    desc: "On a hit with a weapon attack, spend a superiority die and add it to the damage. The next attack roll against that target by anyone other than you has advantage, as long as it is made before the start of your next turn.",
  },
  {
    index: "maneuver-evasive-footwork",
    name: "Maneuver: Evasive Footwork",
    desc: "As you move, you can spend a superiority die: roll it and add the result to your AC for the rest of that movement.",
  },
  {
    index: "maneuver-feinting-attack",
    name: "Maneuver: Feinting Attack",
    desc: "As a bonus action on your turn, spend a superiority die to feint at one creature within 5 feet of you. You have advantage on your next attack roll against it this turn, and if that attack hits, add the die to the damage.",
  },
  {
    index: "maneuver-goading-attack",
    name: "Maneuver: Goading Attack",
    desc: "On a hit with a weapon attack, spend a superiority die and add it to the damage. The target makes a Wisdom save against your maneuver save DC; on a failure it has disadvantage on attack rolls against anyone other than you until the end of your next turn.",
  },
  {
    index: "maneuver-lunging-attack",
    name: "Maneuver: Lunging Attack",
    desc: "When you make a melee weapon attack on your turn, spend a superiority die to give that attack 5 extra feet of reach. On a hit, add the die to the damage.",
  },
  {
    index: "maneuver-maneuvering-attack",
    name: "Maneuver: Maneuvering Attack",
    desc: "On a hit with a weapon attack, spend a superiority die and add it to the damage. Choose a friendly creature that can see or hear you: it can use its reaction to move up to half its speed without provoking opportunity attacks from your target.",
  },
  {
    index: "maneuver-menacing-attack",
    name: "Maneuver: Menacing Attack",
    desc: "On a hit with a weapon attack, spend a superiority die and add it to the damage. The target makes a Wisdom save against your maneuver save DC or is frightened of you until the end of your next turn.",
  },
  {
    index: "maneuver-parry",
    name: "Maneuver: Parry",
    desc: "If a creature's melee attack deals you damage, you can react by spending a superiority die: the damage drops by the die roll + your Dexterity modifier.",
  },
  {
    index: "maneuver-precision-attack",
    name: "Maneuver: Precision Attack",
    desc: "When you make a weapon attack roll against a creature, spend a superiority die and add it to the attack roll. You can decide before or after rolling, but before the attack's effects are applied.",
  },
  {
    index: "maneuver-pushing-attack",
    name: "Maneuver: Pushing Attack",
    desc: "On a hit with a weapon attack, spend a superiority die and add it to the damage. If the target is Large or smaller, it makes a Strength save against your maneuver save DC or is pushed up to 15 feet away from you.",
  },
  {
    index: "maneuver-rally",
    name: "Maneuver: Rally",
    desc: "On your turn, use a bonus action and spend a superiority die. A friendly creature that can see or hear you gains temporary hit points equal to the die roll + your Charisma modifier.",
  },
  {
    index: "maneuver-riposte",
    name: "Maneuver: Riposte",
    desc: "If a creature misses you with a melee attack, you can react by spending a superiority die to strike back with a melee weapon attack; on a hit, the die is added to the damage.",
  },
  {
    index: "maneuver-sweeping-attack",
    name: "Maneuver: Sweeping Attack",
    desc: "When you hit a creature with a melee weapon attack, spend a superiority die to carry the blow into a second creature within 5 feet of the first and within your reach. If your original attack roll would also hit the second creature, it takes damage equal to the die roll, of the same type as the original attack.",
  },
  {
    index: "maneuver-trip-attack",
    name: "Maneuver: Trip Attack",
    desc: "On a hit with a weapon attack, spend a superiority die and add it to the damage. If the target is Large or smaller, it makes a Strength save against your maneuver save DC or is knocked prone.",
  },
];
const maneuvers = () => MANEUVERS.map((o) => ({ ...o }));

export default [
  {
    index: "battle-master",
    name: "Battle Master",
    flavor: "Martial Archetype",
    srd: false,
    desc: "A student of tactics who reads every fight like a puzzle, spending bursts of drilled technique to trip, disarm, shove and outmanoeuvre the enemy while steering allies into the right place.",
    level: 3,
    features: [
      {
        level: 3,
        index: "battle-master-combat-superiority",
        name: "Combat Superiority",
        desc: "You learn three maneuvers of your choice and gain four superiority dice, which are d8s. Using a maneuver spends one superiority die, with no more than one maneuver per attack. You regain all spent superiority dice when you finish a short or long rest. You gain a fifth die at 7th level and a sixth at 15th, and you learn two more maneuvers at 7th, 10th and 15th level; whenever you learn new maneuvers you may also swap one maneuver you know for a different one. When a maneuver calls for a saving throw, the DC is your maneuver save DC: 8 + your proficiency bonus + your Strength or Dexterity modifier (your choice).",
        choose: 3,
        options: maneuvers(),
      },
      {
        level: 3,
        index: "battle-master-student-of-war",
        name: "Student of War",
        desc: "Pick one type of artisan's tools: you are now proficient with it.",
        pick: { type: "tool", choose: 1, from: "artisans-tools" },
      },
      {
        level: 7,
        index: "battle-master-know-your-enemy",
        name: "Know Your Enemy",
        desc: "If you spend at least 1 minute watching or dealing with a creature outside combat, you can size it up against yourself. Pick two of the following and the DM tells you whether the creature is your equal, your superior or your inferior in each: Strength score, Dexterity score, Constitution score, Armor Class, current hit points, total class levels (if any), or fighter levels (if any).",
      },
      {
        level: 7,
        index: "battle-master-maneuvers-7",
        name: "Additional Maneuvers",
        desc: "You learn two more maneuvers of your choice, and you may swap one maneuver you already know for a different one. You also gain a fifth superiority die.",
        choose: 2,
        options: maneuvers(),
      },
      {
        level: 10,
        index: "battle-master-improved-combat-superiority",
        name: "Improved Combat Superiority",
        desc: "Your superiority dice become d10s. At 18th level they become d12s.",
      },
      {
        level: 10,
        index: "battle-master-maneuvers-10",
        name: "Additional Maneuvers",
        desc: "You learn two more maneuvers of your choice, and you may swap one maneuver you already know for a different one.",
        choose: 2,
        options: maneuvers(),
      },
      {
        level: 15,
        index: "battle-master-relentless",
        name: "Relentless",
        desc: "If you have no superiority dice left when you roll initiative, one die comes back to you.",
      },
      {
        level: 15,
        index: "battle-master-maneuvers-15",
        name: "Additional Maneuvers",
        desc: "You learn two more maneuvers of your choice, and you may swap one maneuver you already know for a different one. You also gain a sixth superiority die.",
        choose: 2,
        options: maneuvers(),
      },
      {
        level: 18,
        index: "battle-master-improved-combat-superiority-18",
        name: "Improved Combat Superiority (d12)",
        desc: "Your superiority dice become d12s.",
      },
    ],
  },
  {
    index: "eldritch-knight",
    name: "Eldritch Knight",
    flavor: "Martial Archetype",
    srd: false,
    desc: "A warrior who studies wizardry to guard and sharpen their swordwork, weaving wards and bursts of force between blows and calling a bonded weapon back to hand at will.",
    level: 3,
    features: [
      {
        level: 3,
        index: "eldritch-knight-spellcasting",
        name: "Spellcasting",
        desc: "You learn wizard spells and cast them with Intelligence: your spell save DC is 8 + your proficiency bonus + your Intelligence modifier, and your spell attack modifier is your proficiency bonus + your Intelligence modifier. You know two wizard cantrips of your choice, and a third at 10th level. At 3rd level you know three 1st-level wizard spells, two of which must be abjuration or evocation. Every spell you learn later must also be abjuration or evocation, except the ones you learn at 8th, 14th and 20th level, which can come from any school; each must be of a level you have spell slots for (your slots follow the Eldritch Knight third-caster table, reaching 4th-level spells at 19th level). You don't prepare spells: you cast the ones you know. Whenever you gain a fighter level, you may replace one wizard spell you know with another of a level you have slots for, which must be abjuration or evocation unless it replaces one of your any-school spells.",
      },
      {
        level: 3,
        index: "eldritch-knight-weapon-bond",
        name: "Weapon Bond",
        desc: "Through a 1-hour ritual (which you can perform during a short rest), with the weapon within your reach the whole time, you bond yourself to a weapon you touch. While bonded, you can't be disarmed of it unless you are incapacitated, and if it is on the same plane of existence as you, you can use a bonus action on your turn to make it teleport instantly into your hand. You can have up to two bonded weapons but summon only one per bonus action; to bond a third, you must first break the bond with one of the other two.",
      },
      {
        level: 7,
        index: "eldritch-knight-war-magic",
        name: "War Magic",
        desc: "Casting a cantrip with your action lets you make one weapon attack as a bonus action that turn.",
      },
      {
        level: 10,
        index: "eldritch-knight-eldritch-strike",
        name: "Eldritch Strike",
        desc: "A creature you hit with a weapon attack is left open to your magic: until the end of your next turn, it makes its next saving throw against one of your spells with disadvantage.",
      },
      {
        level: 15,
        index: "eldritch-knight-arcane-charge",
        name: "Arcane Charge",
        desc: "When you use Action Surge, you can also teleport up to 30 feet to an unoccupied space you can see, either before or after the extra action.",
      },
      {
        level: 18,
        index: "eldritch-knight-improved-war-magic",
        name: "Improved War Magic",
        desc: "Casting any spell with your action, cantrip or leveled, lets you make one weapon attack as a bonus action that turn.",
      },
    ],
  },
];
