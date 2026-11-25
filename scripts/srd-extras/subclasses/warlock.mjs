// Otherworldly patrons from the Player's Handbook that the SRD lacks, summarised in our own words for Roleplay20.
export default [
  {
    index: "archfey",
    name: "Archfey",
    flavor: "Otherworldly Patron",
    srd: false,
    desc: "Your patron is a ruler of the fey, a being of moonlit beauty and fickle moods who repays service with glamour, trickery and the occasional cruel jest.",
    level: 1,
    features: [
      {
        level: 1,
        index: "archfey-fey-presence",
        name: "Fey Presence",
        desc:
          "As an action, you let a flash of fey majesty spill out of you: each creature in a 10-foot cube starting from " +
          "you makes a Wisdom saving throw against your spell save DC. Every creature that fails is charmed or " +
          "frightened by you (your choice) until the end of your next turn.\n" +
          "Once you use this feature, you can't use it again until you finish a short or long rest.",
      },
      {
        level: 6,
        index: "archfey-misty-escape",
        name: "Misty Escape",
        desc:
          "When you take damage, you can use your reaction to turn invisible and teleport up to 60 feet to an unoccupied " +
          "space you can see. You stay invisible until the start of your next turn or until you attack or cast a spell.\n" +
          "Once you use this feature, you can't use it again until you finish a short or long rest.",
      },
      {
        level: 10,
        index: "archfey-beguiling-defenses",
        name: "Beguiling Defenses",
        desc:
          "You can't be charmed. When another creature tries to charm you, you can use your reaction to turn the charm " +
          "back on it: it must succeed on a Wisdom saving throw against your spell save DC or be charmed by you for " +
          "1 minute or until it takes any damage.",
      },
      {
        level: 14,
        index: "archfey-dark-delirium",
        name: "Dark Delirium",
        desc:
          "As an action, choose a creature you can see within 60 feet of you. It makes a Wisdom saving throw against " +
          "your spell save DC. On a failure, it is charmed or frightened by you (your choice) for 1 minute or until your " +
          "concentration breaks (you concentrate as if on a spell); the effect also ends early if the creature takes any " +
          "damage. While it lasts, the creature believes it is lost in a misty dream-realm whose look you decide, and it " +
          "can see and hear only itself, you and the illusion.\n" +
          "Once you use this feature, you can't use it again until you finish a short or long rest.",
      },
    ],
    spells: [
      { level: 1, index: "faerie-fire", name: "Faerie Fire" },
      { level: 1, index: "sleep", name: "Sleep" },
      { level: 3, index: "calm-emotions", name: "Calm Emotions" },
      { level: 3, index: "phantasmal-force", name: "Phantasmal Force" },
      { level: 5, index: "blink", name: "Blink" },
      { level: 5, index: "plant-growth", name: "Plant Growth" },
      { level: 7, index: "dominate-beast", name: "Dominate Beast" },
      { level: 7, index: "greater-invisibility", name: "Greater Invisibility" },
      { level: 9, index: "dominate-person", name: "Dominate Person" },
      { level: 9, index: "seeming", name: "Seeming" },
    ],
  },
  {
    index: "great-old-one",
    name: "Great Old One",
    flavor: "Otherworldly Patron",
    srd: false,
    desc: "You are bound to something vast and unknowable from beyond the stars or the deep dark, whose thoughts seep into yours as strange insight and quiet dread.",
    level: 1,
    features: [
      {
        level: 1,
        index: "great-old-one-awakened-mind",
        name: "Awakened Mind",
        desc:
          "You can speak telepathically to any creature you can see within 30 feet of you. You don't need a shared " +
          "language, but the creature has to understand at least one language to follow you.",
      },
      {
        level: 6,
        index: "great-old-one-entropic-ward",
        name: "Entropic Ward",
        desc:
          "When a creature makes an attack roll against you, you can use your reaction to give that roll disadvantage. " +
          "If the attack misses, you have advantage on your next attack roll against that creature, as long as you make " +
          "it before the end of your next turn.\n" +
          "Once you use this feature, you can't use it again until you finish a short or long rest.",
      },
      {
        level: 10,
        index: "great-old-one-thought-shield",
        name: "Thought Shield",
        desc:
          "Telepathy and other means can't read your thoughts unless you allow it. You have resistance to psychic " +
          "damage, and whenever a creature deals psychic damage to you, it takes the same amount of damage that you do.",
      },
      {
        level: 14,
        index: "great-old-one-create-thrall",
        name: "Create Thrall",
        desc:
          "As an action, you touch an incapacitated humanoid and taint its mind with your patron's alien magic. It is " +
          "charmed by you until a remove curse spell is cast on it, the charmed condition is removed from it, or you use " +
          "this feature again. While you and it are on the same plane of existence, you can communicate with it " +
          "telepathically.",
      },
    ],
    spells: [
      { level: 1, index: "dissonant-whispers", name: "Dissonant Whispers" },
      { level: 1, index: "hideous-laughter", name: "Hideous Laughter" },
      { level: 3, index: "detect-thoughts", name: "Detect Thoughts" },
      { level: 3, index: "phantasmal-force", name: "Phantasmal Force" },
      { level: 5, index: "clairvoyance", name: "Clairvoyance" },
      { level: 5, index: "sending", name: "Sending" },
      { level: 7, index: "dominate-beast", name: "Dominate Beast" },
      { level: 7, index: "black-tentacles", name: "Black Tentacles" },
      { level: 9, index: "dominate-person", name: "Dominate Person" },
      { level: 9, index: "telekinesis", name: "Telekinesis" },
    ],
  },
];
