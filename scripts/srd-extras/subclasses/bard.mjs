// Player's Handbook bard colleges the SRD lacks, summarised in our own words for Roleplay20.
export default [
  {
    index: "valor",
    name: "Valor",
    flavor: "Bard College",
    srd: false,
    desc: "Bards of Valor are battlefield skalds who fight beside heroes, keep their deeds alive in song and spur their companions to match them.",
    level: 3,
    features: [
      {
        level: 3,
        index: "valor-bonus-proficiencies",
        name: "Bonus Proficiencies",
        desc: "You become proficient with medium armor, shields and martial weapons.",
        grants: { armor: ["Medium Armor", "Shields"], weapons: ["Martial Weapons"] },
      },
      {
        level: 3,
        index: "valor-combat-inspiration",
        name: "Combat Inspiration",
        desc: "A creature holding one of your Bardic Inspiration dice can also spend it in combat. Right after rolling damage for a weapon attack, it can roll the die and add the result to that damage. Or, when an attack roll is made against it, it can use its reaction to roll the die and add the result to its AC against that one attack, deciding after the attack is rolled but before knowing whether it hits.",
      },
      {
        level: 6,
        index: "valor-extra-attack",
        name: "Extra Attack",
        desc: "When you take the Attack action on your turn, you make two attacks instead of one.",
      },
      {
        level: 14,
        index: "valor-battle-magic",
        name: "Battle Magic",
        desc: "When you use your action to cast a bard spell, you can make one weapon attack as a bonus action.",
      },
    ],
  },
];
