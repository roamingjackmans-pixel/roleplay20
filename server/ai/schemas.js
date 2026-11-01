// JSON schemas for every Dungeon Master task (Messages API structured outputs).
// Structured outputs need `additionalProperties: false` on every object and don't support min/max constraints, so every
// field is required and "nothing" is expressed as "" / 0 / [] (the engine treats those as "no change").

const S = { type: 'string' };
const I = { type: 'integer' };
const N = { type: 'number' };
const B = { type: 'boolean' };
const arr = (items) => ({ type: 'array', items });
const en = (...values) => ({ type: 'string', enum: values });
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

export const EFFECT_TYPES = [
  'damage', 'heal', 'temp_hp', 'condition_add', 'condition_remove', 'item_add', 'item_remove', 'gold',
  'xp', 'level_up', 'rest_short', 'rest_long', 'inspiration', 'spend_slot', 'spend_resource',
  'give_map', 'discover_location', 'move_party', 'reveal_token', 'hide_token', 'remove_token',
  'door_open', 'door_close', 'door_lock', 'door_unlock', 'ambient', 'exhaustion', 'npc_join_party', 'npc_leave_party',
];

const narration = arr(obj({
  to: arr(S),                        // ["all"] or character ids
  parts: arr(obj({ speaker: S, text: S })), // speaker "narrator" or an npc id
}));

const npc = obj({
  id: S, name: S, role: S, description: S,
  gender: en('female', 'male', 'neutral'),
  age: en('child', 'young', 'adult', 'old', 'ancient'),
  accent: en('american', 'british', 'scottish', 'irish', 'australian', 'indian', 'southafrican', 'any'),
  pitch: N, rate: N, voiceStyle: S,
  attitude: en('friendly', 'neutral', 'wary', 'hostile', 'unknown'),
  location: S, status: S, notes: S,
});

const rollRequest = obj({
  characterId: S,
  kind: en('skill', 'save', 'ability', 'attack', 'initiative', 'custom'),
  key: S,           // skill key (perception, sleightOfHand...) or ability key (str, dex...) or custom dice like "1d6"
  dc: I,            // 0 = no fixed DC (opposed / DM interprets)
  advantage: en('none', 'adv', 'dis'),
  reason: S,        // shown to the player: "Your fingertips find the edge of a hidden panel - make an Investigation check"
  secret: B,        // true = only the roller (and DM) see the result
});

// effect.type is one of EFFECT_TYPES (listed in the system prompt; validated by the engine, kept as a plain string so the
// turn schema stays small enough to compile for structured outputs)
const effect = obj({ type: S, target: S, amount: I, text: S, mapId: S, locationId: S });

const areaLocation = obj({
  id: S, name: S,
  kind: S, // tavern, inn, temple, shrine, shop, market, smithy, guild, manor, castle, keep, gate, dock, well, square, tower, ruins, cave, camp, farm, mill, graveyard, stable, library, barracks, jail, house, landmark, dungeon, room, town, city, village, forest, mountain, lake, bridge, crossroads, mine, portal
  x: N, y: N, description: S, secret: B,
});

const areaMap = obj({
  id: S, style: en('town', 'city', 'village', 'region', 'dungeon'), name: S, description: S,
  river: en('ns', 'ew', 'none'), coast: en('n', 's', 'e', 'w', 'none'), walls: B, forest: N, hills: N,
  roads: arr(en('n', 's', 'e', 'w')),
  locations: arr(areaLocation),
  connections: arr(arr(S)),
  ownedBy: arr(S),                   // character ids that already have this map (usually [] - they must find/buy it)
  price: S,                          // what a copy costs in this world, e.g. "5 gp from the cartographer"
});

const sceneMap = obj({
  theme: S, name: S, size: en('small', 'medium', 'large'), ambient: en('bright', 'dim', 'dark'),
  timeOfDay: en('day', 'dusk', 'night'), features: arr(S),
  partyPlacement: en('entrance', 'center', 'near_npcs'),   // where the party stands when the map is laid out
  npcsPresent: arr(obj({ npcId: S, placement: en('npc', 'near', 'far', 'center', 'hidden') })),
});

const enemyGroup = obj({
  monster: S,          // SRD monster index (goblin, wolf, bandit, cult-fanatic...) or "custom"
  name: S,             // display name, e.g. "Ashfang Cultist" (reskin)
  count: I,
  hidden: B,           // starts hidden (ambush)
  placement: en('far', 'near', 'flank', 'surround', 'hidden', 'center'),
  // only for monster == "custom" (otherwise 0 / ""): a compact stat block
  customAc: I, customHp: I, customSpeed: I, customCr: N,
  customAttack: S,     // e.g. "Bone Claw +5 2d6+3 slashing reach 5" or "Spit +4 1d8 acid range 30"
});

const combatStart = obj({
  reason: S,
  useCurrentMap: B,    // true = fight on the scene's current battle map; false = the new "sceneMap" from this response
  enemies: arr(enemyGroup),
  allies: arr(S),      // npc ids fighting with the party
  surprise: B,         // party is surprised if they failed to notice the hidden enemies
});

const quest = obj({ id: S, title: S, status: en('active', 'completed', 'failed', 'rumor'), summary: S, giver: S, update: S });
const handout = obj({ id: S, title: S, kind: en('letter', 'note', 'poster', 'book', 'map', 'item', 'other'), content: S, to: arr(S) });

const scene = obj({ location: S, timeOfDay: S, weather: S, mood: S, areaMapId: S, areaLocationId: S });

export const TURN_SCHEMA = obj({
  narration,
  npcs: arr(npc),
  rollRequests: arr(rollRequest),
  effects: arr(effect),
  scene,
  areaMaps: arr(areaMap),
  sceneMap: arr(sceneMap),           // [] or one map to lay out the current scene on the battle grid
  combatStart: arr(combatStart),     // [] or one
  quests: arr(quest),
  handouts: arr(handout),
  // [] normally. When a player declared more than their turn allows: one private note per such character saying the
  // most they can do and asking which parts they want; everything else in the response is left empty.
  clarify: arr(obj({ characterId: S, message: S })),
  ruling: S,                         // "Judgment call: ..." disclosure, or ""
  dmNotes: S,                        // private continuity notes to remember (secrets, puzzle answers, plans) or ""
  summary: S,                        // 1-3 factual sentences for the campaign log
});

export const COMBAT_SCHEMA = obj({
  narration,
  enemyActions: arr(obj({
    combatantId: S,
    moveToX: I, moveToY: I,          // -1, -1 = don't move (the engine also auto-approaches for melee attacks)
    action: en('attack', 'save_ability', 'dash', 'dodge', 'disengage', 'hide', 'flee', 'help', 'surrender', 'other', 'none'),
    actionName: S,                   // the stat-block action used, e.g. "Scimitar", "Multiattack", "Fire Breath"
    targetId: S,                     // combatant id of the target ("" if none)
    onHit: S, onMiss: S,             // short narration used depending on the result (for saves: onHit = failed save)
    say: S,                          // a battle cry / taunt in character, or ""
  })),
  effects: arr(effect),
  endCombat: arr(obj({ outcome: en('victory', 'defeat', 'retreat', 'surrender', 'truce'), reason: S })),
  summary: S,
});

export const GENESIS_SCHEMA = obj({
  title: S, tagline: S,
  worldBible: S,           // markdown, player-facing
  dmSecrets: S,            // markdown, hidden
  storyArc: S,             // markdown, hidden
  characterPrompts: arr(S),
  npcs: arr(npc),
  areaMaps: arr(areaMap),
  quests: arr(quest),
  startingScene: scene,
  openingHook: S,          // what pulls the party together (player-facing)
});

export const SESSION_END_SCHEMA = obj({
  campaignLogEntry: S,     // markdown, chronological prose recap of this session
  recapBlurb: S,           // a spoken "Previously on..." paragraph for next time
  npcUpdates: arr(obj({ id: S, status: S, notes: S, attitude: en('friendly', 'neutral', 'wary', 'hostile', 'unknown') })),
  questUpdates: arr(quest),
  partyState: S,           // markdown snapshot
  dmSecrets: S,            // full updated markdown, or "" if unchanged
  storyArc: S,             // full updated markdown, or "" if unchanged
  chronicle: S,            // compressed story-so-far for future prompts
  storySoFar: S,           // player-facing quick recap of the whole campaign for the top of the journal (markdown)
});

export const CHARACTER_ASSIST_SCHEMA = obj({
  names: arr(S),
  traits: S, ideals: S, bonds: S, flaws: S,
  appearance: S,
  backstory: S,
  worldConnections: S,     // how this character ties into the campaign (player-facing)
  secretHook: S,           // DM-only hook for the story arc
});

export const RECAP_SCHEMA = obj({ narration });
