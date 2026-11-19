// Every new campaign gets a naming style of its own, picked at random when it is made, so worlds don't all sound alike
// (left alone, the AI gives every world a Pip and a Hollow-something). The style describes sounds, never example names:
// an example would turn up in every campaign that drew the same style. The group's brief can always ask for another.

export const NAMING_STYLES = [
  'Norse-flavoured: hard consonants, family names built from a parent\'s name, places in -heim, -vik and -fjall',
  'Welsh-flavoured: ll, dd, ff and w or y as vowels, long descriptive place names beginning Aber-, Llan- or Pen-',
  'Byzantine Greek-flavoured: -os, -ios, -ene and -ia endings, titles and epithets, places in -polis and -ikon',
  'Persian-flavoured: soft s and sh sounds, -ar, -an and -eh endings, gardens and caravanserais in place names',
  'Finnish-flavoured: doubled vowels and consonants, -nen and -la endings, lakes and forests in place names',
  'Swahili-flavoured: open vowels, names that carry meanings, coastal trading towns',
  'Basque-flavoured: tx, tz, k and rr sounds, -ena, -eta and -aga endings',
  'Slavic-flavoured: zh, ch and sz sounds, family names in -ov and -ska, towns in -grad and -ograd',
  'Gaelic-flavoured: bh, mh and dh spellings, Mac and Nic family names, glens, duns and kils in place names',
  'Japanese-flavoured: open syllables, family name before given name, places in -mura, -yama and -kawa',
  'Andean-flavoured (Quechua sounds): k, q, ll and hu sounds, mountain passes and terraced valleys',
  'Arabic-flavoured: al- and son-of or daughter-of names, wells, oases and markets in place names',
  'Latin-flavoured: -us, -ia and -ium endings, three-part names, roads, forts and colonies',
  'Mongolian-flavoured: compound names joining two meaningful words, khans and clans, steppe and river names',
  'Hungarian-flavoured: sz, zs, cs and gy spellings, family name first, villages in -falva and castles in -vár',
  'Yoruba-flavoured: names that are whole phrases of meaning, flowing vowels, towns named for their founders',
  'Breton- and Cornish-flavoured: places beginning Ker-, Tre- and Pen-, -ec and -oc endings',
  'Invented, harsh and clipped: zk, vr and tch sounds, names of one or two syllables',
  'Invented, flowing and musical: many vowels and l, r and n sounds, names of three or four syllables',
  'Invented, old and formal: long names carrying clan and place titles, few short nicknames',
];

/** A naming style for a new campaign, chosen at random. */
export function pickNamingStyle(rng = Math.random) {
  return NAMING_STYLES[Math.floor(rng() * NAMING_STYLES.length) % NAMING_STYLES.length];
}
