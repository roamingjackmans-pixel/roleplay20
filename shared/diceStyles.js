// The looks a player can give their d20 (picked at the bottom of the character sheet). Shared by the server, which
// checks a choice is real, and the client, which draws the die.

// a = light end of the gradient, b = dark end, edge = outline, ink = the number's default color
export const DICE_COLORS = {
  gold: { name: 'Dragon Gold', a: '#ffe2a0', b: '#9a6416', edge: '#2b1a08', ink: '#1d1206' },
  ruby: { name: 'Ruby', a: '#ff9a9a', b: '#8a0f1f', edge: '#2a0508', ink: '#fff4f0' },
  sapphire: { name: 'Sapphire', a: '#a8ccff', b: '#123b8a', edge: '#06142e', ink: '#f0f6ff' },
  emerald: { name: 'Emerald', a: '#a4f5c0', b: '#0d6a3a', edge: '#032312', ink: '#f0fff5' },
  amethyst: { name: 'Amethyst', a: '#ddbaff', b: '#5a1f8f', edge: '#1c0630', ink: '#fbf5ff' },
  obsidian: { name: 'Obsidian', a: '#605e6e', b: '#0b0a10', edge: '#000000', ink: '#ece7f4' },
  pearl: { name: 'Pearl', a: '#ffffff', b: '#cdc3d8', edge: '#6a6070', ink: '#2a2230' },
  bone: { name: 'Bone', a: '#f6eed6', b: '#b4a074', edge: '#4a3c22', ink: '#2a1f0e' },
  copper: { name: 'Copper', a: '#ffc7a0', b: '#8a3f17', edge: '#2a1206', ink: '#1e0d04' },
  silver: { name: 'Silver', a: '#f6f8fc', b: '#7a8494', edge: '#2a2f38', ink: '#151a22' },
  frost: { name: 'Frost', a: '#eefcff', b: '#5ab4d6', edge: '#123a4a', ink: '#0c2a36' },
  jade: { name: 'Jade', a: '#ccf2d4', b: '#3e8a5c', edge: '#14321f', ink: '#0d2416' },
  rose: { name: 'Rose Quartz', a: '#ffdbe9', b: '#d76c97', edge: '#5a1f36', ink: '#3a0f22' },
  sunset: { name: 'Sunset', a: '#ffd36e', b: '#e2456b', edge: '#3a0d1e', ink: '#2a0812' },
  deepsea: { name: 'Deep Sea', a: '#86ece4', b: '#123f6e', edge: '#051a2e', ink: '#effcff' },
  lava: { name: 'Lava', a: '#ffd25e', b: '#c21f0b', edge: '#2a0400', ink: '#fff7e0' },
  toxic: { name: 'Toxic', a: '#eaff7a', b: '#3e9a0d', edge: '#102a04', ink: '#0d1c02' },
  midnight: { name: 'Midnight', a: '#6878ff', b: '#0b0f3a', edge: '#02041a', ink: '#e8ecff' },
  candy: { name: 'Cotton Candy', a: '#bdf3ff', b: '#ff9ad5', edge: '#5a2a4a', ink: '#3a1030' },
  forest: { name: 'Forest', a: '#bddc84', b: '#2f4f1c', edge: '#121f08', ink: '#f4ffe8' },
  bloodmoon: { name: 'Blood Moon', a: '#d0473a', b: '#2a0306', edge: '#000000', ink: '#ffdcd2' },
  storm: { name: 'Storm', a: '#c7d2e0', b: '#3a4658', edge: '#141a24', ink: '#0e131b' },
  honey: { name: 'Honey', a: '#fff0a6', b: '#d18a0e', edge: '#3a2402', ink: '#2a1a02' },
  peacock: { name: 'Peacock', a: '#5ef0c8', b: '#3a2a9a', edge: '#0c0a2e', ink: '#f2fffb' },
  rainbow: { name: 'Rainbow', a: '#ff6b6b', b: '#6b5bff', edge: '#2a1a3a', ink: '#ffffff', stops: ['#ff5e7a', '#ffb24d', '#fff06b', '#6bf28e', '#5ec8ff', '#a77bff'] },
  dragonfire: { name: 'Dragonfire', a: '#fff3a0', b: '#7a0a0a', edge: '#200000', ink: '#fffbe8', stops: ['#fff3a0', '#ff9a2e', '#e8320e', '#7a0a0a'] },
  aurora: { name: 'Aurora', a: '#7affc8', b: '#3a1a6e', edge: '#0a0820', ink: '#ffffff', stops: ['#9affd8', '#4ad6ff', '#8a5cff', '#ff6ad5'] },
};

export const DICE_STYLES = {
  classic: { name: 'Classic', hint: 'smooth and polished' },
  marble: { name: 'Marble', hint: 'swirled stone' },
  galaxy: { name: 'Galaxy', hint: 'stars and nebulae' },
  glass: { name: 'Glass', hint: 'see-through, with a shine' },
  metal: { name: 'Metal', hint: 'brushed metal bands' },
  gem: { name: 'Gemstone', hint: 'sharp sparkling facets' },
  glitter: { name: 'Glitter', hint: 'full of sparkles' },
  neon: { name: 'Neon', hint: 'glowing outline on black' },
  wood: { name: 'Wood', hint: 'carved, with a grain' },
};

export const DICE_INKS = {
  auto: { name: 'Best match', color: null },
  black: { name: 'Black', color: '#120c06' },
  white: { name: 'White', color: '#fffaf0' },
  gold: { name: 'Gold', color: '#ffd56b' },
  silver: { name: 'Silver', color: '#e6ebf2' },
  red: { name: 'Red', color: '#ff4a3d' },
};

export const DEFAULT_DICE = { color: 'gold', style: 'classic', ink: 'auto' };

/** A clean dice look from anything (unknown values fall back to the defaults). */
export function diceLook(x) {
  const v = x && typeof x === 'object' ? x : {};
  return {
    color: Object.hasOwn(DICE_COLORS, v.color) ? v.color : DEFAULT_DICE.color,
    style: Object.hasOwn(DICE_STYLES, v.style) ? v.style : DEFAULT_DICE.style,
    ink: Object.hasOwn(DICE_INKS, v.ink) ? v.ink : DEFAULT_DICE.ink,
  };
}

/** Is this exactly a valid look? (The server refuses anything else.) */
export function validDiceLook(x) {
  if (!x || typeof x !== 'object') return false;
  const keys = Object.keys(x);
  return keys.every((k) => ['color', 'style', 'ink'].includes(k)) &&
    Object.hasOwn(DICE_COLORS, x.color) && Object.hasOwn(DICE_STYLES, x.style) && Object.hasOwn(DICE_INKS, x.ink);
}
