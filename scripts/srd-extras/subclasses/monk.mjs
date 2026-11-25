// Monk monastic traditions from the Player's Handbook (2014) that the SRD lacks, written in our own words for
// Roleplay20. See ../README.md for the format. Monks are not spellcasters here: ki-cast spells are described in the
// text, never granted.

// The seventeen elemental disciplines. Saves use your ki save DC (8 + proficiency bonus + Wisdom modifier).
const DISCIPLINES = [
  {
    index: "discipline-breath-of-winter",
    name: "Discipline: Breath of Winter",
    desc: "Spend 6 ki points to cast cone of cold: each creature in a 60-foot cone from you makes a Constitution save, taking 8d8 cold damage on a failure or half on a success. A creature it kills is left a frozen statue.",
    requires: { level: 17 },
  },
  {
    index: "discipline-clench-of-the-north-wind",
    name: "Discipline: Clench of the North Wind",
    desc: "Spend 3 ki points to cast hold person: a humanoid you can see within 60 feet makes a Wisdom save or is paralyzed for up to 1 minute (concentration), repeating the save at the end of each of its turns. Each extra ki point (up to your maximum) raises the spell level by one and adds a target.",
    requires: { level: 6 },
  },
  {
    index: "discipline-elemental-attunement",
    name: "Discipline: Elemental Attunement",
    desc: "No ki cost. As an action, you briefly command the elements nearby to do one of these: make a harmless, instantaneous sensory effect of air, earth, fire or water (a spray of sparks, a puff of breeze, a fine mist, a low rumble of stone); instantly light or put out a candle, torch or small campfire; chill or warm up to 1 pound of nonliving material for up to 1 hour; or make earth, fire, water or mist that fits in a 1-foot cube hold a crude shape you choose for 1 minute.",
  },
  {
    index: "discipline-eternal-mountain-defense",
    name: "Discipline: Eternal Mountain Defense",
    desc: "Spend 5 ki points to cast stoneskin on yourself: you have resistance to nonmagical bludgeoning, piercing and slashing damage for up to 1 hour (concentration).",
    requires: { level: 17 },
  },
  {
    index: "discipline-fangs-of-the-fire-snake",
    name: "Discipline: Fangs of the Fire Snake",
    desc: "When you take the Attack action on your turn, spend 1 ki point to wreathe your fists and feet in lashing flame: for that action and the rest of the turn your unarmed strikes gain 10 feet of reach and deal fire damage instead of bludgeoning. When one of these strikes hits, you can spend 1 more ki point to add 1d10 fire damage.",
  },
  {
    index: "discipline-fist-of-four-thunders",
    name: "Discipline: Fist of Four Thunders",
    desc: "Spend 2 ki points to cast thunderwave: each creature in a 15-foot cube starting from you makes a Constitution save, taking 2d8 thunder damage and being pushed 10 feet away on a failure, or half damage and no push on a success. Unsecured objects in the area are pushed too, and the boom is audible 300 feet away. Each extra ki point (up to your maximum) raises the spell level by one for +1d8 damage.",
  },
  {
    index: "discipline-fist-of-unbroken-air",
    name: "Discipline: Fist of Unbroken Air",
    desc: "As an action, spend 2 ki points and pick a creature within 30 feet of you. It makes a Strength save. On a failure it takes 3d10 bludgeoning damage, plus 1d10 for each extra ki point you spend (up to your maximum), and you can push it up to 20 feet away from you and knock it prone. On a success it takes half damage and is neither pushed nor knocked prone.",
  },
  {
    index: "discipline-flames-of-the-phoenix",
    name: "Discipline: Flames of the Phoenix",
    desc: "Spend 4 ki points to cast fireball: a 20-foot-radius burst at a point you choose within 150 feet. Each creature in it makes a Dexterity save, taking 8d6 fire damage on a failure or half on a success, and unattended flammable objects catch fire. Each extra ki point (up to your maximum) raises the spell level by one for +1d6 damage.",
    requires: { level: 11 },
  },
  {
    index: "discipline-gong-of-the-summit",
    name: "Discipline: Gong of the Summit",
    desc: "Spend 3 ki points to cast shatter: a ringing blast fills a 10-foot-radius sphere at a point within 60 feet. Each creature in it makes a Constitution save, taking 3d8 thunder damage on a failure or half on a success; creatures of stone, crystal or metal save with disadvantage, and unattended nonmagical objects there take the damage too. Each extra ki point (up to your maximum) raises the spell level by one for +1d8 damage.",
    requires: { level: 6 },
  },
  {
    index: "discipline-mist-stance",
    name: "Discipline: Mist Stance",
    desc: "Spend 4 ki points to cast gaseous form on yourself: for up to 1 hour (concentration) you become a drifting cloud with a 10-foot flying speed. You can slip through tiny cracks and enter other creatures' spaces, have resistance to nonmagical damage and advantage on Strength, Dexterity and Constitution saves, but you can't talk, handle objects, attack or cast spells.",
    requires: { level: 11 },
  },
  {
    index: "discipline-ride-the-wind",
    name: "Discipline: Ride the Wind",
    desc: "Spend 4 ki points to cast fly on yourself: you gain a flying speed of 60 feet for up to 10 minutes (concentration). If it ends while you are aloft, you fall.",
    requires: { level: 11 },
  },
  {
    index: "discipline-river-of-hungry-flame",
    name: "Discipline: River of Hungry Flame",
    desc: "Spend 5 ki points to cast wall of fire: an opaque wall of flame within 120 feet, either straight (up to 60 feet long, 20 feet high, 1 foot thick) or a ring (up to 20 feet across, 20 feet high), lasting up to 1 minute (concentration). Creatures in its space when it appears make a Dexterity save, taking 5d8 fire damage or half on a success. One side of your choice burns: a creature that ends its turn within 10 feet of that side or inside the wall takes 5d8 fire damage, as does a creature entering the wall for the first time on a turn. An extra ki point (if your maximum allows) raises the spell level for +1d8 damage.",
    requires: { level: 17 },
  },
  {
    index: "discipline-rush-of-the-gale-spirits",
    name: "Discipline: Rush of the Gale Spirits",
    desc: "Spend 2 ki points to cast gust of wind: a line of strong wind 60 feet long and 10 feet wide blasts from you for up to 1 minute (concentration). A creature that starts its turn in the line makes a Strength save or is pushed 15 feet away from you along it, and moving toward you through it costs double movement. It scatters gas and fog and snuffs out candles, torches and other unprotected flames. As a bonus action on later turns you can change the line's direction.",
  },
  {
    index: "discipline-shape-the-flowing-river",
    name: "Discipline: Shape the Flowing River",
    desc: "As an action, spend 1 ki point and choose an area of water or ice no more than 30 feet on a side within 120 feet of you. You can turn water into ice and ice into water there, and reshape the ice as you like: raise or lower it, dig or fill a trench, raise or flatten a wall, or form a pillar. No change can exceed half the area's largest dimension (a 30-foot square allows up to 15 feet of height or depth). You can't use it to trap or harm a creature in the area.",
  },
  {
    index: "discipline-sweeping-cinder-strike",
    name: "Discipline: Sweeping Cinder Strike",
    desc: "Spend 2 ki points to cast burning hands: each creature in a 15-foot cone from you makes a Dexterity save, taking 3d6 fire damage on a failure or half on a success, and unattended flammable objects in the cone catch fire. Each extra ki point (up to your maximum) raises the spell level by one for +1d6 damage.",
  },
  {
    index: "discipline-water-whip",
    name: "Discipline: Water Whip",
    desc: "As a bonus action, spend 2 ki points to lash a creature you can see within 30 feet with a whip of water. It makes a Dexterity save. On a failure it takes 3d10 bludgeoning damage, plus 1d10 for each extra ki point you spend (up to your maximum), and you either knock it prone or pull it up to 25 feet toward you. On a success it takes half damage and is neither pulled nor knocked prone.",
  },
  {
    index: "discipline-wave-of-rolling-earth",
    name: "Discipline: Wave of Rolling Earth",
    desc: "Spend 6 ki points to cast wall of stone: a nonmagical stone wall rises at a point within 120 feet, built from up to ten connected 10-by-10-foot panels 6 inches thick (or 10-by-20-foot panels 3 inches thick), lasting up to 10 minutes (concentration) and becoming permanent if you concentrate for the full duration. Each panel has AC 15 and 30 hit points per inch of thickness. A creature caught where the wall forms is pushed to one side (your choice), and if it would be enclosed it can make a Dexterity save to escape first.",
    requires: { level: 17 },
  },
];
const disciplines = () => DISCIPLINES.map((o) => ({ ...o, ...(o.requires ? { requires: { ...o.requires } } : {}) }));

export default [
  {
    index: "shadow",
    name: "Shadow",
    flavor: "Monastic Tradition",
    srd: false,
    desc: "Monks of a quiet, secretive order who train in stealth and silence, wrapping themselves in darkness to strike unseen and vanish before the alarm is raised.",
    level: 3,
    features: [
      {
        level: 3,
        index: "shadow-shadow-arts",
        name: "Shadow Arts",
        desc: "As an action, you can spend 2 ki points to cast darkness, darkvision, pass without trace or silence, without needing material components. These spells otherwise follow their normal rules, including concentration. You also know the minor illusion cantrip (nothing changes if you already knew it).",
      },
      {
        level: 6,
        index: "shadow-shadow-step",
        name: "Shadow Step",
        desc: "As a bonus action while you stand in dim light or darkness, you can teleport up to 60 feet to an unoccupied space you can see that is also dimly lit or dark. Your first melee attack before the turn ends has advantage.",
      },
      {
        level: 11,
        index: "shadow-cloak-of-shadows",
        name: "Cloak of Shadows",
        desc: "In dim light or darkness, you can spend your action to turn invisible. The invisibility ends as soon as you attack, cast a spell, or are in bright light.",
      },
      {
        level: 17,
        index: "shadow-opportunist",
        name: "Opportunist",
        desc: "If someone other than you hits a creature that is within 5 feet of you, you can use your reaction to make a melee attack against that creature.",
      },
    ],
  },
  {
    index: "four-elements",
    name: "Four Elements",
    flavor: "Monastic Tradition",
    srd: false,
    desc: "Monks who bend their ki into the raw forces of air, earth, fire and water, hurling flame from their fists, shaping ice and riding the wind.",
    level: 3,
    features: [
      {
        // every monk of the tradition knows it; the choice below is the one other discipline
        level: 3,
        ...DISCIPLINES.find((d) => d.index === "discipline-elemental-attunement"),
      },
      {
        level: 3,
        index: "four-elements-disciple-of-the-elements",
        name: "Disciple of the Elements",
        desc: "You learn elemental disciplines, techniques powered by ki. Every monk of this tradition knows Elemental Attunement; pick one other discipline here. You learn one more discipline at 6th, 11th and 17th level, and whenever you learn one you may also swap a discipline you know for another. Disciplines that copy a spell use that spell's casting time and normal rules but need no material components, and any saving throw uses your ki save DC (8 + proficiency bonus + Wisdom modifier). If such a spell gets stronger when cast at a higher level, you can spend extra ki to raise its level by one per extra ki point. The most ki you can spend on one discipline, base cost included, depends on your monk level: 2 at 3rd-4th, 3 at 5th-8th, 4 at 9th-12th, 5 at 13th-16th, and 6 at 17th-20th.",
        choose: 1,
        options: disciplines().filter((d) => d.index !== "discipline-elemental-attunement"),
      },
      {
        level: 6,
        index: "four-elements-discipline-6",
        name: "Elemental Discipline",
        desc: "You learn one more elemental discipline, and you may swap one you already know for another. You can now spend up to 3 ki points on a single discipline (4 from 9th level).",
        choose: 1,
        options: disciplines(),
      },
      {
        level: 11,
        index: "four-elements-discipline-11",
        name: "Elemental Discipline",
        desc: "You learn one more elemental discipline, and you may swap one you already know for another. You can now spend up to 4 ki points on a single discipline (5 from 13th level).",
        choose: 1,
        options: disciplines(),
      },
      {
        level: 17,
        index: "four-elements-discipline-17",
        name: "Elemental Discipline",
        desc: "You learn one more elemental discipline, and you may swap one you already know for another. You can now spend up to 6 ki points on a single discipline.",
        choose: 1,
        options: disciplines(),
      },
    ],
  },
];
