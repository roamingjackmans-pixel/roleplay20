// Paladin sacred oaths from the Player's Handbook (2014) that the SRD lacks, written in our own words for
// Roleplay20. See ../README.md for the format. Channel Divinity: one use per short or long rest; its saves use your
// paladin spell save DC.

export default [
  {
    index: "ancients",
    name: "Ancients",
    flavor: "Sacred Oath",
    srd: false,
    desc: "Paladins sworn to protect light, life and beauty against everything that would wither them, often marked by leaves, antlers or blossoms worked into their armour.",
    level: 3,
    features: [
      {
        level: 3,
        index: "ancients-tenets",
        name: "Tenets of the Ancients",
        desc: "Kindle the Light: spread hope through mercy, kindness and forgiveness. Shelter the Light: stand guard over goodness, beauty, love and laughter, and over every place where life flourishes. Preserve Your Own Light: keep your own joy alive through song, art and delight, or you will have none left to share. Be the Light: let your courage and gladness be a beacon to everyone lost in despair.",
      },
      {
        level: 3,
        index: "ancients-natures-wrath",
        name: "Channel Divinity: Nature's Wrath",
        desc: "As an action, spend your Channel Divinity to make spectral vines lunge at a creature you can see within 10 feet of you. It makes a Strength or Dexterity save (its choice) against your spell save DC or is restrained. While restrained, it repeats the save at the end of each of its turns; on a success it breaks free and the vines vanish.",
      },
      {
        level: 3,
        index: "ancients-turn-the-faithless",
        name: "Channel Divinity: Turn the Faithless",
        desc: "As an action, present your holy symbol and spend your Channel Divinity. Each fey and fiend within 30 feet of you that can hear you makes a Wisdom save against your spell save DC. On a failure it is turned for 1 minute or until it takes damage: it must spend its turns moving as far from you as it can, can't willingly move within 30 feet of you, can't take reactions, and for its action can only Dash or try to escape something stopping it from moving (or Dodge if it has nowhere to go). While turned, a creature hiding its true form behind an illusion, shapechange or similar effect is revealed.",
      },
      {
        level: 7,
        index: "ancients-aura-of-warding",
        name: "Aura of Warding",
        desc: "You and friendly creatures within 10 feet of you take half damage from spells (resistance to spell damage). From 18th level the aura extends to 30 feet.",
      },
      {
        level: 15,
        index: "ancients-undying-sentinel",
        name: "Undying Sentinel",
        desc: "Once per long rest, if something would drop you to 0 hit points without killing you outright, you can stay standing at 1 hit point instead. In addition, old age no longer weakens you, and magic can't age you.",
      },
      {
        level: 20,
        index: "ancients-elder-champion",
        name: "Elder Champion",
        desc: "As an action, take on the form of an ancient force of nature (you choose its look) for 1 minute. While transformed: you regain 10 hit points at the start of each of your turns; you can cast a paladin spell with a casting time of 1 action as a bonus action instead; and enemy creatures within 10 feet of you have disadvantage on saving throws against your paladin spells and Channel Divinity options. Once used, you can't use it again until you finish a long rest.",
      },
    ],
    spells: [
      { level: 3, index: "ensnaring-strike", name: "Ensnaring Strike" },
      { level: 3, index: "speak-with-animals", name: "Speak with Animals" },
      { level: 5, index: "moonbeam", name: "Moonbeam" },
      { level: 5, index: "misty-step", name: "Misty Step" },
      { level: 9, index: "plant-growth", name: "Plant Growth" },
      { level: 9, index: "protection-from-energy", name: "Protection From Energy" },
      { level: 13, index: "ice-storm", name: "Ice Storm" },
      { level: 13, index: "stoneskin", name: "Stoneskin" },
      { level: 17, index: "commune-with-nature", name: "Commune With Nature" },
      { level: 17, index: "tree-stride", name: "Tree Stride" },
    ],
  },
  {
    index: "vengeance",
    name: "Vengeance",
    flavor: "Sacred Oath",
    srd: false,
    desc: "Paladins sworn to hunt down those who commit great wrongs, setting aside mercy and their own comfort until the guilty are brought low.",
    level: 3,
    features: [
      {
        level: 3,
        index: "vengeance-tenets",
        name: "Tenets of Vengeance",
        desc: "Fight the Greater Evil: when you must choose, go after the worse evil rather than the lesser one. No Mercy for the Wicked: ordinary foes may earn your mercy, but your sworn enemies never do. By Any Means Necessary: don't let your scruples stop you from destroying your foes. Restitution: when your foes ruin lives, you share the blame for not stopping them, so you help the people they have harmed.",
      },
      {
        level: 3,
        index: "vengeance-abjure-enemy",
        name: "Channel Divinity: Abjure Enemy",
        desc: "As an action, present your holy symbol and spend your Channel Divinity to denounce one creature you can see within 60 feet. Unless it is immune to being frightened, it makes a Wisdom save against your spell save DC (fiends and undead have disadvantage). On a failure it is frightened for 1 minute or until it takes any damage, and while frightened its speed is 0 and can't be increased. On a success its speed is halved for 1 minute or until it takes any damage.",
      },
      {
        level: 3,
        index: "vengeance-vow-of-enmity",
        name: "Channel Divinity: Vow of Enmity",
        desc: "Use a bonus action and your Channel Divinity to swear vengeance on a creature you can see within 10 feet. For 1 minute, or until it drops to 0 hit points or falls unconscious, your attack rolls against it have advantage.",
      },
      {
        level: 7,
        index: "vengeance-relentless-avenger",
        name: "Relentless Avenger",
        desc: "Landing an opportunity attack lets you give chase: as part of that same reaction, you can move up to half your speed right away, and this movement provokes no opportunity attacks.",
      },
      {
        level: 15,
        index: "vengeance-soul-of-vengeance",
        name: "Soul of Vengeance",
        desc: "Whenever the target of your Vow of Enmity makes an attack, you can answer with your reaction: one melee weapon attack against it, if it is within your reach.",
      },
      {
        level: 20,
        index: "vengeance-avenging-angel",
        name: "Avenging Angel",
        desc: "As an action, transform for 1 hour: wings grow from your back, giving you a flying speed of 60 feet, and you radiate a menacing aura in a 30-foot radius. The first time an enemy enters the aura or starts its turn in it during a battle, it makes a Wisdom save against your spell save DC or is frightened of you for 1 minute or until it takes any damage. Attack rolls against a creature frightened this way have advantage. Once used, you can't use it again until you finish a long rest.",
      },
    ],
    spells: [
      { level: 3, index: "bane", name: "Bane" },
      { level: 3, index: "hunters-mark", name: "Hunter's Mark" },
      { level: 5, index: "hold-person", name: "Hold Person" },
      { level: 5, index: "misty-step", name: "Misty Step" },
      { level: 9, index: "haste", name: "Haste" },
      { level: 9, index: "protection-from-energy", name: "Protection From Energy" },
      { level: 13, index: "banishment", name: "Banishment" },
      { level: 13, index: "dimension-door", name: "Dimension Door" },
      { level: 17, index: "hold-monster", name: "Hold Monster" },
      { level: 17, index: "scrying", name: "Scrying" },
    ],
  },
];
