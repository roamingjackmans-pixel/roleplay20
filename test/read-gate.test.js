// The host's Read button: the DM's narration waits on screen until the host presses Read (so whoever is talking can
// finish), then it's read on every device at once and story time mutes every mic in the voice chat until it's done.
import { test, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-readgate-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const C = await import('../server/game/campaign.js');
const E = await import('../server/game/engine.js');
const V = await import('../server/game/voice.js');
const RG = await import('../server/game/readgate.js');
const { buildView } = await import('../server/game/views.js');

V.configureVoice({ toSocket: () => {} });
let n = 0;
function table() {
  const c = C.newCampaign({ id: 'u_host' }, { name: `Read ${++n}` });
  c.members.push({ userId: 'u_p', role: 'player', characterId: null });
  E.setOnline(c, 'u_host', `s_host${n}`, true);
  E.setOnline(c, 'u_p', `s_p${n}`, true);
  return c;
}
const narrate = (c, text = 'The bell tolls once, low and wrong.', to = 'all') => E.addLog(c, { kind: 'narration', to, parts: [{ speaker: 'narrator', text }] });

beforeEach(() => { V._reset(); RG._resetReadGate(); });

test('new narration waits for the host, and everyone can see it is waiting', () => {
  const c = table();
  const a = narrate(c);
  const b = narrate(c, 'Only you hear the whisper.', ['u_p']);
  const hidden = narrate(c, 'Nobody sees this.', []);
  const chat = E.addLog(c, { kind: 'chat', text: 'brb' });
  assert.equal(a.held, true);
  assert.equal(b.held, true, 'private narration waits too');
  assert.ok(!hidden.held && !chat.held, 'nothing to read: never waits');
  assert.deepEqual(RG.waitingNarration(c), [a.id, b.id]);
  assert.deepEqual(buildView(c, 'u_p').readWaiting, [a.id, b.id]);
  assert.equal(buildView(c, 'u_host').campaign.settings.hostStartsReading, true, 'on by default');
});

test('pressing Read releases everything waiting, oldest first, and starts story time for the call', () => {
  const c = table();
  V.join(c, 'u_host', 's_h');
  V.join(c, 'u_p', 's_p');
  const heard = [];
  const off = E.onNarrationRead((camp, entries) => { heard.push(entries.map((e) => e.id)); V.startStoryTime(camp, entries); });
  const a = narrate(c);
  const b = narrate(c, 'The door groans open.');
  assert.equal(V.hushState(c).on, false, 'mics stay on while it waits: people can finish talking');
  const r = E.readWaitingNarration(c);
  off();
  assert.deepEqual(r.ids, [a.id, b.id]);
  assert.deepEqual(heard, [[a.id, b.id]]);
  assert.deepEqual(RG.waitingNarration(c), [], 'nothing waiting any more');
  assert.deepEqual(V.hushState(c), { on: true, waiting: ['u_host', 'u_p'] }, 'every mic is off now');
  for (const u of ['u_host', 'u_p']) V.readDone(c, u, a.id);
  assert.equal(V.hushState(c).on, true, 'still reading the second part');
  V.readDone(c, 'u_host', b.id);
  assert.deepEqual(V.hushState(c).waiting, ['u_p'], 'waits for the slower device');
  V.readDone(c, 'u_p', b.id);
  assert.equal(V.hushState(c).on, false, 'mics come back when it has finished for everyone');
  assert.deepEqual(E.readWaitingNarration(c).ids, [], 'pressing Read again does nothing');
});

test('without the host at the table (or with the setting off) narration is read straight away', () => {
  const c = table();
  E.setOnline(c, 'u_host', `s_host${n}`, false);
  assert.ok(!narrate(c).held, 'host away');
  E.setOnline(c, 'u_host', `s_host${n}`, true);
  c.settings.hostStartsReading = false;
  assert.ok(!narrate(c).held, 'setting off');
});

test('if the host leaves (or turns it off) with narration waiting, it is read without them', () => {
  const c = table();
  const a = narrate(c);
  assert.deepEqual(E.releaseNarrationIfUnheld(c).ids, [], 'the host is still here: it keeps waiting');
  E.setOnline(c, 'u_host', `s_host${n}`, false);
  assert.deepEqual(E.releaseNarrationIfUnheld(c).ids, [a.id]);
  const c2 = table();
  const b = narrate(c2);
  c2.settings.hostStartsReading = false;
  assert.deepEqual(E.releaseNarrationIfUnheld(c2).ids, [b.id]);
});

test('story time for several parts allows time for all of them, one after another', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const c = { id: 'c_story_timers' };
    V.join(c, 'u_a', 's_a');
    const long = { id: 'l_1', kind: 'narration', to: 'all', parts: [{ speaker: 'narrator', text: 'x'.repeat(400) }] };
    const short = { id: 'l_2', kind: 'narration', to: 'all', parts: [{ speaker: 'narrator', text: 'Then silence.' }] };
    V.startStoryTime(c, [long, short]);
    mock.timers.tick(V.readingAllowanceMs(long) + 10);
    assert.deepEqual(V.hushState(c).on, true, 'the second part has its own time after the first');
    mock.timers.tick(V.readingAllowanceMs(short));
    assert.equal(V.hushState(c).on, false, 'a device that never reports back still cannot hold the table');
  } finally { mock.timers.reset(); }
});
