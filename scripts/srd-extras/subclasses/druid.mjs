// Player's Handbook druid circles the SRD lacks, summarised in our own words for Roleplay20.
export default [
  {
    index: "moon",
    name: "Moon",
    flavor: "Druid Circle",
    srd: false,
    desc: "Druids of the Moon guard the deepest wilds and change shape as readily as the moon changes phase, fighting in the bodies of great beasts and, in time, living elements.",
    level: 2,
    features: [
      {
        level: 2,
        index: "moon-combat-wild-shape",
        name: "Combat Wild Shape",
        desc: "You can use Wild Shape as a bonus action instead of an action. While transformed by Wild Shape, you can use a bonus action to expend a spell slot and regain 1d8 hit points per level of the slot spent.",
      },
      {
        level: 2,
        index: "moon-circle-forms",
        name: "Circle Forms",
        desc: "Your Wild Shape can turn you into a beast with a challenge rating as high as 1, ignoring the Max. CR column of the Beast Shapes table. Its other limits still apply: no swimming speed before 4th level and no flying speed before 8th. From 6th level, the highest challenge rating you can take is your druid level divided by 3, rounded down.",
      },
      {
        level: 6,
        index: "moon-primal-strike",
        name: "Primal Strike",
        desc: "Your attacks in beast form count as magical for overcoming resistance and immunity to nonmagical attacks and damage.",
      },
      {
        level: 10,
        index: "moon-elemental-wild-shape",
        name: "Elemental Wild Shape",
        desc: "You can spend two uses of Wild Shape at once to transform into an air elemental, earth elemental, fire elemental or water elemental.",
      },
      {
        level: 14,
        index: "moon-thousand-forms",
        name: "Thousand Forms",
        desc: "You can cast alter self at will, without expending a spell slot.",
        grants: { spells: ["alter-self"] },
      },
    ],
  },
];
