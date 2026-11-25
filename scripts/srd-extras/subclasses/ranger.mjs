// Ranger archetypes from the Player's Handbook (2014) that the SRD lacks, written in our own words for Roleplay20.
// See ../README.md for the format. Companion stats come from the SRD stat blocks in shared/srd/monsters.json (the
// part of an option index after "companion-" is the monster index).

export default [
  {
    index: "beast-master",
    name: "Beast Master",
    flavor: "Ranger Archetype",
    srd: false,
    desc: "A ranger bound to a loyal animal partner, the two of them scouting, hunting and fighting as a single, well-drilled team.",
    level: 3,
    features: [
      {
        level: 3,
        index: "beast-master-rangers-companion",
        name: "Ranger's Companion",
        desc: "You gain a beast companion: a beast no larger than Medium with a challenge rating of 1/4 or lower. Your proficiency bonus is added to its AC, attack rolls and damage rolls, and to any saves and skills it is proficient in. Its hit point maximum is the higher of its normal maximum and four times your ranger level, and like any creature it can spend Hit Dice during a short rest. It shares your initiative count and only takes an action when you command one. On your turn you can tell it where to move (no action needed), and you can use your action to command it to take the Attack, Dash, Disengage, Dodge or Help action; once you have Extra Attack, you can also make one weapon attack yourself when you command it to Attack. It uses its reaction (an opportunity attack, say) without waiting for your command. When you are incapacitated or not around, it decides for itself, putting your safety and its own first. When only the two of you are crossing your favored terrain, you can travel stealthily at a normal pace. If it dies, you can bond with a new beast (the same kind or another) that isn't hostile to you by spending 8 hours bonding with it magically.",
      },
      {
        level: 3,
        index: "beast-master-companion-beast",
        name: "Companion Beast",
        desc: "Choose your animal companion. The numbers below are the beast's ordinary stat block: add your proficiency bonus to its AC, attack rolls and damage rolls, and its hit point maximum is the higher of the listed value and four times your ranger level. With the DM's agreement you can pick another beast of Medium size or smaller and CR 1/4 or lower.",
        choose: 1,
        options: [
          {
            index: "companion-wolf",
            name: "Companion: Wolf",
            desc: "Medium beast, CR 1/4. AC 13, 11 HP (2d8), speed 40 ft. Bite: +4 to hit, 2d4 + 2 piercing, and a creature it hits makes a DC 11 Strength save or is knocked prone. Keen hearing and smell (advantage on Perception that relies on them); Pack Tactics (advantage on attacks when an ally of the wolf is within 5 feet of the target). Perception +3, Stealth +4.",
          },
          {
            index: "companion-panther",
            name: "Companion: Panther",
            desc: "Medium beast, CR 1/4. AC 12, 13 HP (3d8), speed 50 ft, climb 40 ft. Bite: +4 to hit, 1d6 + 2 piercing. Claw: +4 to hit, 1d4 + 2 slashing. Pounce: if it moves at least 20 feet straight at a creature and then hits with a claw that turn, the target makes a DC 12 Strength save or is knocked prone, and the panther can bite a prone target as a bonus action. Keen smell. Perception +4, Stealth +6.",
          },
          {
            index: "companion-mastiff",
            name: "Companion: Mastiff",
            desc: "Medium beast, CR 1/8. AC 12, 5 HP (1d8), speed 40 ft. Bite: +3 to hit, 1d6 + 1 piercing, and a creature it hits makes a DC 11 Strength save or is knocked prone. Keen hearing and smell. Perception +3.",
          },
          {
            index: "companion-boar",
            name: "Companion: Boar",
            desc: "Medium beast, CR 1/4. AC 11, 11 HP (2d8), speed 40 ft. Tusk: +3 to hit, 1d6 + 1 slashing. Charge: if it moves at least 20 feet straight at a target and then hits with its tusk that turn, it deals an extra 1d6 slashing and a creature makes a DC 11 Strength save or is knocked prone. Relentless (once per short or long rest): if 7 damage or less would drop it to 0 hit points, it drops to 1 instead.",
          },
          {
            index: "companion-giant-badger",
            name: "Companion: Giant Badger",
            desc: "Medium beast, CR 1/4. AC 10, 13 HP (2d8), speed 30 ft, burrow 10 ft. Bite: +3 to hit, 1d6 + 1 piercing. Claws: +3 to hit, 2d4 + 1 slashing. Multiattack (bite and claws) once Bestial Fury lets it use that action. Keen smell, darkvision 30 ft.",
          },
          {
            index: "companion-giant-weasel",
            name: "Companion: Giant Weasel",
            desc: "Medium beast, CR 1/8. AC 13, 9 HP (2d8), speed 40 ft. Bite: +5 to hit, 1d4 + 3 piercing. Keen hearing and smell, darkvision 60 ft. Perception +3, Stealth +5.",
          },
          {
            index: "companion-giant-wolf-spider",
            name: "Companion: Giant Wolf Spider",
            desc: "Medium beast, CR 1/4. AC 13, 11 HP (2d8), speed 40 ft, climb 40 ft. Bite: +3 to hit, 1d6 + 1 piercing, and the target makes a DC 11 Constitution save, taking 2d6 poison damage on a failure or half on a success; if the poison drops it to 0 hit points, it is stable but poisoned and paralyzed for 1 hour. Climbs walls and ceilings freely, senses creatures touching its web, ignores webbing. Blindsight 10 ft, darkvision 60 ft. Perception +3, Stealth +7.",
          },
          {
            index: "companion-giant-poisonous-snake",
            name: "Companion: Giant Poisonous Snake",
            desc: "Medium beast, CR 1/4. AC 14, 11 HP (2d8), speed 30 ft, swim 30 ft. Bite: +6 to hit, reach 10 ft, 1d4 + 4 piercing, and the target makes a DC 11 Constitution save, taking 3d6 poison damage on a failure or half on a success. Blindsight 10 ft. Perception +2.",
          },
          {
            index: "companion-giant-crab",
            name: "Companion: Giant Crab",
            desc: "Medium beast, CR 1/8. AC 15, 13 HP (3d8), speed 30 ft, swim 30 ft. Claw: +3 to hit, 1d6 + 1 bludgeoning, and the target is grappled (escape DC 11); it has two claws, each able to grapple one target. Breathes air and water. Blindsight 30 ft. Stealth +4.",
          },
          {
            index: "companion-giant-frog",
            name: "Companion: Giant Frog",
            desc: "Medium beast, CR 1/4. AC 11, 18 HP (4d8), speed 30 ft, swim 30 ft. Bite: +3 to hit, 1d6 + 1 piercing, and the target is grappled (escape DC 11) and restrained while grappled; the frog can't bite anyone else meanwhile. Swallow (its own action): a bite against a grappled Small or smaller creature swallows it (blinded, restrained, 2d4 acid at the start of each of the frog's turns). Breathes air and water; standing long jump 20 ft, high jump 10 ft. Darkvision 30 ft. Perception +2, Stealth +3.",
          },
          {
            index: "companion-flying-snake",
            name: "Companion: Flying Snake",
            desc: "Tiny beast, CR 1/8. AC 14, 5 HP (2d4), speed 30 ft, fly 60 ft, swim 30 ft. Bite: +6 to hit, 1 piercing plus 3d4 poison. Flyby (no opportunity attacks when it flies out of reach). Blindsight 10 ft.",
          },
          {
            index: "companion-hawk",
            name: "Companion: Hawk",
            desc: "Tiny beast, CR 0. AC 13, 1 HP (1d4), speed 10 ft, fly 60 ft. Talons: +5 to hit, 1 slashing. Keen sight. Perception +4.",
          },
          {
            index: "companion-blood-hawk",
            name: "Companion: Blood Hawk",
            desc: "Small beast, CR 1/8. AC 12, 7 HP (2d6), speed 10 ft, fly 60 ft. Beak: +4 to hit, 1d4 + 2 piercing. Keen sight; Pack Tactics (advantage on attacks when an ally of the hawk is within 5 feet of the target). Perception +4.",
          },
          {
            index: "companion-owl",
            name: "Companion: Owl",
            desc: "Tiny beast, CR 0. AC 11, 1 HP (1d4), speed 5 ft, fly 60 ft. Talons: +3 to hit, 1 slashing. Flyby (no opportunity attacks when it flies out of reach); keen hearing and sight. Darkvision 120 ft. Perception +3, Stealth +3.",
          },
          {
            index: "companion-giant-rat",
            name: "Companion: Giant Rat",
            desc: "Small beast, CR 1/8. AC 12, 7 HP (2d6), speed 30 ft. Bite: +4 to hit, 1d4 + 2 piercing. Keen smell; Pack Tactics (advantage on attacks when an ally of the rat is within 5 feet of the target). Darkvision 60 ft.",
          },
        ],
      },
      {
        level: 7,
        index: "beast-master-exceptional-training",
        name: "Exceptional Training",
        desc: "If your companion doesn't attack on one of your turns, you can spend a bonus action to have it Dash, Disengage, Dodge or Help on its turn. Its attacks now count as magical for getting past resistance and immunity to nonmagical attacks and damage.",
      },
      {
        level: 11,
        index: "beast-master-bestial-fury",
        name: "Bestial Fury",
        desc: "Your companion now attacks twice when you command it to take the Attack action (or it can use its Multiattack instead, if it has one).",
      },
      {
        level: 15,
        index: "beast-master-share-spells",
        name: "Share Spells",
        desc: "When a spell you cast targets you, you can extend it to your companion as well, provided the beast is within 30 feet of you.",
      },
    ],
  },
];
