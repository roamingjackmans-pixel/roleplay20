// Theme -> rendering style. Unknown theme strings map to the closest known theme.

export const THEMES = ['dungeon', 'cave', 'forest', 'tavern', 'street', 'road', 'swamp', 'crypt', 'camp', 'ruins', 'temple', 'mine', 'castle', 'ship', 'village', 'field'];

const ALIASES = [
  [/catacomb|tomb|grave|ossuar|mausole|necro|barrow/, 'crypt'],
  [/inn|tavern|pub|bar|alehouse|lodge|hall/, 'tavern'],
  [/wood|forest|grove|glade|jungle|thicket|copse/, 'forest'],
  [/market|street|city|town|alley|plaza|square|bazaar|docks?|harbou?r|port/, 'street'],
  [/cave|cavern|grotto|underdark|tunnel|lair/, 'cave'],
  [/mine|quarry|shaft/, 'mine'],
  [/swamp|marsh|bog|fen|mire|bayou/, 'swamp'],
  [/temple|shrine|church|chapel|cathedral|monaster|sanctum/, 'temple'],
  [/castle|keep|fort|citadel|palace|throne|manor|tower|bastion/, 'castle'],
  [/ship|boat|deck|galleon|vessel|barge/, 'ship'],
  [/village|hamlet|farmstead|homestead/, 'village'],
  [/field|meadow|plain|farm|grassland|steppe|hill/, 'field'],
  [/camp|bivouac|encampment|outpost/, 'camp'],
  [/ruin|abandon|ancient|collapsed/, 'ruins'],
  [/road|path|trail|pass|bridge|crossing/, 'road'],
  [/dungeon|prison|vault|sewer|labyrinth|cellar|basement|lab/, 'dungeon'],
];

export function normalizeTheme(t) {
  const s = String(t || '').toLowerCase().trim();
  if (THEMES.includes(s)) return s;
  for (const [re, th] of ALIASES) if (re.test(s)) return th;
  return 'dungeon';
}

const base = {
  grass: { base: '#57742f', light: '#7a9440', dark: '#3c5521', warm: '#8f8f3c', flowers: ['#f2efe0', '#f0d455', '#c9a6e6'] },
  dirt: { base: '#7a5d3e', light: '#94754f', dark: '#5a4229', pebble: '#8b8478' },
  stone: { base: '#6f6b64', light: '#88847b', dark: '#55514b', grout: '#2c2925', style: 'flags' },
  wood: { base: '#83552f', light: '#9f6c3e', dark: '#5f3b1f', gap: '#2a180c' },
  cobble: { base: '#7f796f', grout: '#3a3530', rural: false },
  sand: { base: '#c9b182', light: '#ddc79b', dark: '#a8905f' },
  water: { shallow: '#3e7f84', deep: '#1d4b66', bank: '#3b2d1d', foam: '#d8efe9' },
  diff: { style: 'rubble', base: '#6a645b', stones: ['#7d776e', '#6a655d', '#8d877c', '#5b5650'] },
  wall: { style: 'stone', top: '#7c766c', block: '#8a847a', mortar: '#2a2724', bedrock: '#1b1916', hatch: '#3a3530', rim: '#a39b8d' },
  voidColor: '#0c0b0a',
  grade: null, // optional tint applied over the whole base: [color, alpha, mode]
  outdoor: false,
};

const P = (o) => deepMerge(structuredClone(base), o);
function deepMerge(a, b) {
  for (const k of Object.keys(b)) {
    if (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && a[k] && typeof a[k] === 'object') deepMerge(a[k], b[k]);
    else a[k] = b[k];
  }
  return a;
}

export const STYLES = {
  dungeon: P({ grade: ['#2a3550', 0.1, 'multiply'] }),
  crypt: P({
    stone: { base: '#64666a', light: '#7b7d80', dark: '#4c4e52', grout: '#26272a' },
    wall: { top: '#6c6e70', block: '#77797b', bedrock: '#16171a', hatch: '#33353a', rim: '#9a9c9e' },
    dirt: { base: '#5a5045', light: '#6d6154', dark: '#433b32' },
    grade: ['#4a5a78', 0.16, 'multiply'],
  }),
  castle: P({ stone: { base: '#77726a', light: '#8e897f', dark: '#5c5850' }, wall: { block: '#8f897d', top: '#827c71' } }),
  temple: P({
    stone: { base: '#b7ae9d', light: '#d0c8b8', dark: '#988f7e', grout: '#5d564b', style: 'marble' },
    wall: { top: '#c9c0ae', block: '#d4ccbb', mortar: '#6b6457', bedrock: '#26231f', hatch: '#4b463e', rim: '#efe8d8' },
  }),
  ruins: P({
    outdoor: true,
    stone: { base: '#7d786d', light: '#958f82', dark: '#615c53' },
    wall: { style: 'stone', block: '#8c8579', top: '#7d776c', bedrock: '#4a4741', hatch: '#5a564e', ruined: true },
    diff: { style: 'rubble' },
  }),
  cave: P({
    stone: { base: '#7a6c58', light: '#8f806a', dark: '#5c5143', style: 'cave' },
    dirt: { base: '#6a5640', light: '#7d684e', dark: '#4f3f2e' },
    wall: { style: 'rock', top: '#3d3935', rim: '#6c6760', bedrock: '#1b1918' },
    water: { shallow: '#2f6670', deep: '#173c52' },
    grade: ['#3a3040', 0.12, 'multiply'],
  }),
  mine: P({
    stone: { base: '#7c6b55', light: '#927f66', dark: '#5e5040', style: 'cave' },
    dirt: { base: '#6e5840', light: '#836a4f', dark: '#52412f' },
    wall: { style: 'rock', top: '#423b34', rim: '#736a5e', bedrock: '#1d1a17' },
  }),
  forest: P({
    outdoor: true,
    grass: { base: '#4e6b2b', light: '#6f8b3a', dark: '#354d1d' },
    dirt: { base: '#6e5236', light: '#86684a', dark: '#523b26' },
    wall: { style: 'rock', top: '#6a655c', rim: '#958e82', bedrock: '#3d3a35' },
    diff: { style: 'undergrowth' },
    cobble: { rural: true },
  }),
  road: P({
    outdoor: true,
    grass: { base: '#5d7a33', light: '#7f9a44', dark: '#405a24' },
    wall: { style: 'rock', top: '#6d685f', rim: '#99928a', bedrock: '#403d38' },
    diff: { style: 'undergrowth' },
    cobble: { rural: true },
  }),
  field: P({
    outdoor: true,
    grass: { base: '#67853a', light: '#8aa34c', dark: '#4a6427', warm: '#a49d4a' },
    wall: { style: 'rock', top: '#6d685f', rim: '#99928a', bedrock: '#403d38' },
    diff: { style: 'undergrowth' },
    cobble: { rural: true },
  }),
  camp: P({
    outdoor: true,
    grass: { base: '#58732f', light: '#78913f', dark: '#3e5622' },
    wall: { style: 'rock', top: '#6a655c', rim: '#958e82', bedrock: '#3d3a35' },
    diff: { style: 'undergrowth' },
    cobble: { rural: true },
  }),
  swamp: P({
    outdoor: true,
    grass: { base: '#525d33', light: '#6c7642', dark: '#3a4424', warm: '#7d7a3e', flowers: ['#e8e2c8', '#c9c070'] },
    dirt: { base: '#4f402b', light: '#625136', dark: '#3a2f20' },
    water: { shallow: '#4a5e45', deep: '#2b3d33', bank: '#2e2618', foam: '#c7d1b0' },
    wall: { style: 'rock', top: '#5a564b', rim: '#857f70', bedrock: '#36332d' },
    diff: { style: 'mud' },
    grade: ['#4d6040', 0.14, 'multiply'],
    cobble: { rural: true },
  }),
  tavern: P({
    wood: { base: '#7c4f2b', light: '#97653a', dark: '#5a381c' },
    wall: { style: 'timber', top: '#5e3c22', block: '#3b2515', mortar: '#140c06', bedrock: '#140d08', hatch: '#2a1c12', rim: '#9a7048' },
    stone: { base: '#77706a' },
    grade: ['#ffb070', 0.07, 'soft-light'],
  }),
  village: P({
    outdoor: true,
    wall: { style: 'timber', top: '#6a4628', block: '#40291a', mortar: '#160d06', bedrock: '#3a2a1c', hatch: '#4a3624', rim: '#9a7048' },
    cobble: { rural: true },
    diff: { style: 'undergrowth' },
  }),
  street: P({
    outdoor: true,
    wall: { style: 'stone', block: '#8a8276', top: '#7c7469', bedrock: '#3b3631', hatch: '#4f4a43', roof: true },
    diff: { style: 'rubble' },
  }),
  ship: P({
    wood: { base: '#8e6239', light: '#a87849', dark: '#6a4524' },
    wall: { style: 'hull', top: '#5a3a20', block: '#6b4628', mortar: '#24170c', bedrock: '#2a1b0f', hatch: '#3a2817', rim: '#9a6e44' },
    voidColor: '#133047',
    seaVoid: true,
  }),
};

export function styleFor(theme) {
  return STYLES[normalizeTheme(theme)] || STYLES.dungeon;
}
