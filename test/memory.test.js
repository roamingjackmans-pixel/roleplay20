// Long campaigns: after 100 sessions the DM's prompt stays a bounded size, yet details from session 3 come back as
// soon as the players bring them up, because everything is archived and indexed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-memory-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const M = await import('../server/game/memory.js');
const { turnPrompt } = await import('../server/game/context.js');

// a deterministic "random" so the fake campaign is the same every run
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SYL = ['bar', 'del', 'fen', 'gor', 'hal', 'ist', 'jor', 'kel', 'lun', 'mor', 'nim', 'ost', 'pell', 'quin', 'rax', 'sel', 'tor', 'ulm', 'vex', 'wyn', 'yar', 'zed'];
const word = () => pick(SYL) + pick(SYL) + (rnd() < 0.5 ? pick(SYL) : '');
const cap = (w) => w[0].toUpperCase() + w.slice(1);
const VERBS = ['argued with', 'traded with', 'chased', 'rescued', 'questioned', 'followed', 'bribed', 'escaped from', 'helped', 'warned'];
const THINGS = ['a silver locket', 'a torn map', 'the ferry toll', 'a sealed letter', 'a cracked lantern', 'three gold crowns', 'a bone flute', 'an iron ring'];
const PCS = ['Yorgy', 'Julie', 'Lorax', 'Nylian'];

function bigCampaign() {
  const c = C.newCampaign({ id: 'u_a' }, { name: 'Hundred sessions' });
  // 400 people met along the way
  const npcs = [];
  for (let i = 0; i < 400; i++) {
    const name = `${cap(word())} ${cap(word())}`;
    const id = `npc_${i}`;
    c.npcs[id] = { id, name, role: pick(['innkeeper', 'smith', 'priest', 'guard captain', 'merchant', 'sage', 'thief', 'farmer']), description: `A ${pick(['tall', 'stooped', 'cheerful', 'scarred'])} ${pick(['dwarf', 'gnome', 'human', 'elf'])}.`, location: '', status: 'alive', attitude: 'neutral', voice: {}, lastSeenSession: 1 + Math.floor(i / 4), firstSeen: i };
    npcs.push(c.npcs[id]);
  }
  c.npcs.npc_marrow = { id: 'npc_marrow', name: 'Marrow Quillfeather', role: 'fence', description: 'A soft-spoken halfling fence who works out of the Drowned Lantern and never forgets a debt.', location: 'the Drowned Lantern, Saltmere', status: 'alive', attitude: 'wary', voice: {}, lastSeenSession: 5, firstSeen: 1 };
  // 30 area maps of 10 places each
  for (let m = 0; m < 30; m++) {
    const id = `area_${m}`;
    c.maps.area[id] = { id, name: cap(word()), style: 'town', locations: Array.from({ length: 10 }, (_, k) => ({ id: `${id}_l${k}`, name: `${cap(word())} ${pick(['Inn', 'Temple', 'Gate', 'Market', 'Mill', 'Tower'])}`, kind: 'house', x: rnd(), y: rnd(), description: `A ${pick(['busy', 'quiet', 'ruined', 'grand'])} place.` })) };
  }
  c.maps.area.area_0.locations.push({ id: 'oldbrook_mill', name: 'Oldbrook Mill', kind: 'mill', x: 0.5, y: 0.5, description: 'A mill on the brook with a sealed iron vault beneath it.' });
  c.scene.areaMapId = 'area_29';
  c.scene.location = 'the market square of the last town';
  // 150 quests, most of them long finished
  for (let q = 0; q < 150; q++) c.quests.push({ id: `q${q}`, title: `The ${cap(word())} affair`, status: q < 130 ? 'completed' : 'active', summary: `Something about ${pick(THINGS)} and ${pick(npcs).name}.`, giver: pick(npcs).name, updates: [] });

  // 100 sessions of play, archived as they happen
  let turn = 0;
  for (let s = 1; s <= 100; s++) {
    c.sessionNumber = s;
    const sess = { n: s, startedAt: s * 1000, endedAt: s * 1000 + 500, logEntry: '', recap: '' };
    c.sessions.push(sess);
    for (let t = 0; t < 40; t++) {
      turn++;
      const a = pick(npcs), b = pick(PCS);
      let summary = `${b} ${pick(VERBS)} ${a.name} over ${pick(THINGS)} near ${pick(c.maps.area[pick(Object.keys(c.maps.area))].locations).name}.`;
      if (s === 5 && t === 12) summary = 'Julie bargained with Marrow Quillfeather at the Drowned Lantern in Saltmere, trading the bone key for passage north and a favour owed.';
      M.rememberTurn(c, { n: turn, summary, location: 'somewhere' });
      if (s === 100) c.chronicle.turns.push({ n: turn, at: Date.now(), kind: 'actions', actions: [{ name: b, text: 'does a thing' }], rolls: [], narration: [{ to: 'all', parts: [{ speaker: 'narrator', text: summary }] }], summary });
    }
    for (let k = 0; k < 8; k++) M.rememberNote(c, `${pick(npcs).name} secretly ${pick(['owes', 'hates', 'spies on', 'protects'])} ${pick(npcs).name}; the ${pick(['vault', 'shrine', 'cellar'])} key is with them.`);
    if (s === 3) M.rememberNote(c, "PUZZLE ANSWER: the iron vault beneath Oldbrook Mill opens only when a Fernwhistle speaks the word 'Thistledown' at moonrise.");
    sess.logEntry = `## Session ${s}\n\nThe party travelled and ${pick(VERBS)} ${pick(npcs).name}. ${pick(PCS)} found ${pick(THINGS)}.`;
    M.rememberSession(c, sess, { headline: `${pick(PCS)} and the ${cap(word())} business` });
  }
  c.world.dmNotes = Array.from({ length: 80 }, (_, i) => `recent note ${i}`);
  c.chronicle.summary = 'A long road of adventures across thirty towns.';
  return c;
}

const c = bigCampaign();

test('the archive keeps everything: 4,000 turns, 100 sessions, 800+ notes', () => {
  const stats = M.memoryStats(c);
  assert.equal(stats.turn, 4000);
  assert.equal(stats.session, 100);
  assert.ok(stats.note >= 801);
});

test('after 100 sessions the turn prompt stays a bounded size', () => {
  const p = turnPrompt(c, { text: 'Julie haggles with the spice seller in the market.' }, new Set());
  console.log(`  prompt: ${p.length} characters (~${Math.round(p.length / 4)} tokens)`);
  assert.ok(p.length < 90000, `prompt is ${p.length} characters`);
  assert.match(p, /# SESSION INDEX/);
  assert.match(p, /^S1: /m);
  assert.match(p, /^S100: /m);
  assert.match(p, /\.\.\.and \d+ more from long ago/);
});

test("a puzzle answer from session 3 comes back when the players return to the vault", () => {
  const p = turnPrompt(c, { text: 'Lorax returns to Oldbrook Mill and studies the iron vault door, trying to remember the word.' }, new Set());
  const recalled = p.split('# RECALLED FROM THE CAMPAIGN ARCHIVE')[1]?.split('\n# ')[0] || '';
  if (process.env.SHOW_RECALL) console.log(recalled);
  assert.match(recalled, /Thistledown/);
  assert.match(recalled, /Oldbrook Mill/);
});

test('an NPC last seen in session 5 is in full view when named, with what happened', () => {
  const p = turnPrompt(c, { text: 'Julie goes looking for Marrow Quillfeather to buy the bone key back.' }, new Set());
  assert.match(p, /npc_marrow: Marrow Quillfeather - fence/);
  const recalled = p.split('# RECALLED FROM THE CAMPAIGN ARCHIVE')[1] || '';
  assert.match(recalled, /bone key/);
});

test('searching 5,000+ memories is quick', () => {
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) M.searchMemory(c, 'Oldbrook Mill vault word Fernwhistle moonrise');
  const ms = (performance.now() - t0) / 5;
  console.log(`  search: ${ms.toFixed(1)} ms`);
  assert.ok(ms < 250, `${ms} ms`);
});

test('a campaign that started before the archive is seeded from what it already has', () => {
  const old = C.newCampaign({ id: 'u_b' }, { name: 'Older table' });
  old.sessions.push({ n: 1, startedAt: 1, endedAt: 2, logEntry: 'The party met Grandmother Pip at the Festival of Small Bells.' });
  old.chronicle.turns.push({ n: 1, at: 1, summary: 'Lorax tossed the Festival Pumpkin over the mill.' });
  old.world.dmNotes.push('The Bell heart is shaped like two clasped hands.');
  const hits = M.searchMemory(old, 'festival pumpkin bell heart');
  assert.ok(hits.some((h) => /Pumpkin/.test(h.text)));
  assert.ok(hits.some((h) => /clasped hands/.test(h.text)));
});
