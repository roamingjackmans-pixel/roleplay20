// Player's Handbook barbarian paths the SRD lacks, summarised in our own words for Roleplay20.
export default [
  {
    index: "totem-warrior",
    name: "Totem Warrior",
    flavor: "Primal Path",
    srd: false,
    desc: "These barbarians bind themselves to a beast spirit that guides and guards them, and every rage carries some of that animal's strength, senses or instincts.",
    level: 3,
    features: [
      {
        level: 3,
        index: "totem-warrior-spirit-seeker",
        name: "Spirit Seeker",
        desc: "You can cast beast sense and speak with animals, but only as rituals: each takes 10 minutes longer than its normal casting time and needs no spell slot. Beast sense lets you touch a willing beast and share its sight and hearing for up to 1 hour (concentration), during which you are blind and deaf to your own surroundings. Speak with animals lets you understand and talk with beasts for 10 minutes. You don't otherwise know or prepare these spells.",
      },
      {
        level: 3,
        index: "totem-warrior-totem-spirit",
        name: "Totem Spirit",
        desc: "Pick a totem animal and gain the benefit below. You also make or find a physical totem (an amulet, charm or similar token) that includes a piece of that animal, such as fur, a feather, a claw or a tooth, and you may pick up small physical traits that recall it.",
        choose: 1,
        options: [
          {
            index: "totem-spirit-bear",
            name: "Totem Spirit: Bear",
            desc: "While raging, you have resistance to every damage type except psychic.",
          },
          {
            index: "totem-spirit-eagle",
            name: "Totem Spirit: Eagle",
            desc: "While raging and not wearing heavy armor, opportunity attacks against you are made with disadvantage, and you can take the Dash action as a bonus action on your turn.",
          },
          {
            index: "totem-spirit-wolf",
            name: "Totem Spirit: Wolf",
            desc: "While you are raging, your allies have advantage on melee attack rolls against any creature hostile to you that is within 5 feet of you.",
          },
        ],
      },
      {
        level: 6,
        index: "totem-warrior-aspect-of-the-beast",
        name: "Aspect of the Beast",
        desc: "Pick a totem animal, the same one you chose before or a different one, and gain the benefit below. These benefits work all the time, not only while raging.",
        choose: 1,
        options: [
          {
            index: "aspect-of-the-beast-bear",
            name: "Aspect of the Beast: Bear",
            desc: "Your carrying capacity, including the most you can push, drag or lift, is doubled, and you have advantage on Strength checks to push, pull, lift or break objects.",
          },
          {
            index: "aspect-of-the-beast-eagle",
            name: "Aspect of the Beast: Eagle",
            desc: "You see clearly out to 1 mile, making out fine details as if they were no more than 100 feet away. Dim light doesn't give you disadvantage on Wisdom (Perception) checks.",
          },
          {
            index: "aspect-of-the-beast-wolf",
            name: "Aspect of the Beast: Wolf",
            desc: "You can track creatures while traveling at a fast pace, and you can move stealthily while traveling at a normal pace (normally stealth needs a slow pace).",
          },
        ],
      },
      {
        level: 10,
        index: "totem-warrior-spirit-walker",
        name: "Spirit Walker",
        desc: "You can cast commune with nature, but only as a ritual (10 minutes longer than its 1-minute casting time, no spell slot). It tells you up to three facts about the land within 3 miles of you (300 feet underground), such as terrain, water, plants, animals, people, powerful creatures or the influence of other planes. The answers are delivered by a spirit form of one of the animals you chose for Totem Spirit or Aspect of the Beast.",
      },
      {
        level: 14,
        index: "totem-warrior-totemic-attunement",
        name: "Totemic Attunement",
        desc: "Pick a totem animal, whichever you chose before, and gain the benefit below.",
        choose: 1,
        options: [
          {
            index: "totemic-attunement-bear",
            name: "Totemic Attunement: Bear",
            desc: "While you are raging, each hostile creature within 5 feet of you has disadvantage on attack rolls against any target other than you or another creature with this feature. A creature is unaffected if it can't see or hear you or can't be frightened.",
          },
          {
            index: "totemic-attunement-eagle",
            name: "Totemic Attunement: Eagle",
            desc: "While raging, you have a flying speed equal to your current walking speed. You can only fly in short bursts: if you end your turn in the air with nothing else holding you up, you fall.",
          },
          {
            index: "totemic-attunement-wolf",
            name: "Totemic Attunement: Wolf",
            desc: "While raging, when you hit a Large or smaller creature with a melee weapon attack, you can use a bonus action on your turn to knock it prone.",
          },
        ],
      },
    ],
  },
];
