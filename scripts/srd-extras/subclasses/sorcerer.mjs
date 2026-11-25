// Sorcerous origins from the Player's Handbook that the SRD lacks, summarised in our own words for Roleplay20.

// The d100 Wild Magic Surge table, one line per result.
const SURGE_TABLE = [
  "01-02: For the next minute, roll on this table at the start of each of your turns (ignore this result if it comes up again during that minute).",
  "03-04: For 1 minute, you can see any invisible creature you have line of sight to.",
  "05-06: A modron appears in an unoccupied space within 5 feet of you; the DM picks and controls it, and it vanishes after 1 minute.",
  "07-08: You cast fireball as a 3rd-level spell, centred on yourself.",
  "09-10: You cast magic missile as a 5th-level spell.",
  "11-12: Roll a d10 and change your height by that many inches: shorter on an odd roll, taller on an even roll.",
  "13-14: You cast confusion, centred on yourself.",
  "15-16: For 1 minute, you regain 5 hit points at the start of each of your turns.",
  "17-18: You sprout a long beard of feathers that stays until you sneeze, when the feathers burst off your face.",
  "19-20: You cast grease, centred on yourself.",
  "21-22: If you cast a spell that calls for a saving throw within the next minute, every save against the first such spell is made with disadvantage.",
  "23-24: Your skin turns a vivid blue; a remove curse spell ends this.",
  "25-26: For 1 minute an extra eye opens on your forehead, giving you advantage on Wisdom (Perception) checks that rely on sight.",
  "27-28: For 1 minute, every spell you cast that normally takes 1 action takes 1 bonus action instead.",
  "29-30: You teleport up to 60 feet to an unoccupied space you can see.",
  "31-32: You are whisked to the Astral Plane until the end of your next turn, then return to the space you left (or the nearest unoccupied space if it is taken).",
  "33-34: The next damaging spell you cast within 1 minute deals maximum damage.",
  "35-36: Roll a d10 and change your age by that many years: younger on an odd roll (never below 1 year old), older on an even roll.",
  "37-38: 1d6 flumphs appear in unoccupied spaces within 60 feet of you, controlled by the DM and frightened of you; they vanish after 1 minute.",
  "39-40: You regain 2d10 hit points.",
  "41-42: You become a potted plant until the start of your next turn: incapacitated and vulnerable to all damage. If you drop to 0 hit points, the pot breaks and you return to your own form.",
  "43-44: For 1 minute, you can teleport up to 20 feet as a bonus action on each of your turns.",
  "45-46: You cast levitate on yourself.",
  "47-48: A unicorn controlled by the DM appears within 5 feet of you and vanishes after 1 minute.",
  "49-50: For 1 minute you can't speak; pink bubbles drift out of your mouth whenever you try.",
  "51-52: For 1 minute a ghostly shield floats beside you, giving you +2 AC and immunity to magic missile.",
  "53-54: For the next 5d6 days, alcohol can't make you drunk.",
  "55-56: All your hair falls out; it grows back within 24 hours.",
  "57-58: For 1 minute, any flammable object you touch catches fire, unless another creature is wearing or carrying it.",
  "59-60: You regain your lowest-level expended spell slot.",
  "61-62: For 1 minute, you can only speak by shouting.",
  "63-64: You cast fog cloud, centred on yourself.",
  "65-66: Up to three creatures of your choice within 30 feet of you take 4d10 lightning damage.",
  "67-68: You are frightened of the nearest creature until the end of your next turn.",
  "69-70: For 1 minute, every creature within 30 feet of you is invisible; a creature's invisibility ends when it attacks or casts a spell.",
  "71-72: For 1 minute, you have resistance to all damage.",
  "73-74: A random creature within 60 feet of you is poisoned for 1d4 hours.",
  "75-76: For 1 minute you shed bright light in a 30-foot radius; any creature that ends its turn within 5 feet of you is blinded until the end of its next turn.",
  "77-78: You cast polymorph on yourself; if you fail the saving throw, you become a sheep for the spell's duration.",
  "79-80: For 1 minute, illusory butterflies and flower petals drift through the air within 10 feet of you.",
  "81-82: You can take one extra action right away.",
  "83-84: Each creature within 30 feet of you takes 1d10 necrotic damage, and you regain hit points equal to the total necrotic damage dealt.",
  "85-86: You cast mirror image.",
  "87-88: You cast fly on a random creature within 60 feet of you.",
  "89-90: For 1 minute you are invisible and other creatures can't hear you; the invisibility ends if you attack or cast a spell.",
  "91-92: If you die within the next minute, you come straight back to life as if by the reincarnate spell.",
  "93-94: For 1 minute, you are one size category larger.",
  "95-96: For 1 minute, you and every creature within 30 feet of you have vulnerability to piercing damage.",
  "97-98: For 1 minute, faint otherworldly music plays around you.",
  "99-00: You regain all your expended sorcery points.",
];

export default [
  {
    index: "wild-magic",
    name: "Wild Magic",
    flavor: "Sorcerous Origin",
    srd: false,
    desc: "Your power springs from raw, untamed chaos rather than any orderly bloodline, and it does not always do what you ask of it.",
    level: 1,
    features: [
      {
        level: 1,
        index: "wild-magic-surge",
        name: "Wild Magic Surge",
        desc:
          "Your spells can set off bursts of untamed magic. Once per turn, right after you cast a sorcerer spell of 1st " +
          "level or higher, the DM can have you roll a d20. On a 1, roll a d100 on the table below and that effect " +
          "happens. If the effect is a spell, Metamagic can't change it, and it needs no concentration: it simply lasts " +
          "its full duration.\n" +
          "Wild Magic Surge table (d100):\n" +
          SURGE_TABLE.join("\n"),
      },
      {
        level: 1,
        index: "wild-magic-tides-of-chaos",
        name: "Tides of Chaos",
        desc:
          "You can give yourself advantage on one attack roll, ability check or saving throw. Once you do, you can't do " +
          "it again until you finish a long rest. Until then, the DM can have you roll on the Wild Magic Surge table " +
          "right after you cast a sorcerer spell of 1st level or higher; if that happens, you get this use back.",
      },
      {
        level: 6,
        index: "wild-magic-bend-luck",
        name: "Bend Luck",
        desc:
          "When a creature you can see makes an attack roll, ability check or saving throw, you can use your reaction " +
          "and spend 2 sorcery points to roll a d4 and add it to or subtract it from that roll (your choice). You can do " +
          "this after the roll but before any of its effects happen.",
      },
      {
        level: 14,
        index: "wild-magic-controlled-chaos",
        name: "Controlled Chaos",
        desc: "Whenever you roll on the Wild Magic Surge table, you roll twice and choose which of the two results happens.",
      },
      {
        level: 18,
        index: "wild-magic-spell-bombardment",
        name: "Spell Bombardment",
        desc:
          "Once per turn, when you roll damage for a spell and one or more dice show their highest possible number, pick " +
          "one of those dice, roll it again and add the new roll to the damage.",
      },
    ],
  },
];
