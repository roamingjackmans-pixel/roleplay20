// Every campaign had a Pip, a Hollow-something and a Lantern-something. No data crossed between campaigns: the DM's own
// instructions carried example names from the first campaign into every world, and the AI reaches for the same stock
// names anyway. Examples are now placeholders, stock names are off limits, and each world gets its own naming style.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rp20-names-'));
process.env.TUNNEL = 'off';
process.env.AI_PROVIDER = 'off';
const P = await import('../server/ai/prompts.js');
const C = await import('../server/game/campaign.js');
const { cachedCampaignContext } = await import('../server/game/context.js');
const { NAMING_STYLES, pickNamingStyle } = await import('../server/game/naming.js');

// every instruction text in prompts.js (the avoid-list itself is short, so it isn't one of them)
const everyPrompt = () => Object.entries(P).filter(([, v]) => typeof v === 'string' && v.length > 600);

test("no instruction the AI reads carries a name from a real campaign's story", () => {
  const removed = ['Grandmother Pip', 'river Lilt', 'Drowned Lantern', 'Marrow', 'Yorgy', 'Julie', 'Lorax', 'Dawnmark', "Bell's heart", 'Silent soldier', 'Dragon egg'];
  for (const [name, text] of everyPrompt()) {
    // stock names only ever appear inside the list of names to avoid
    const rest = text.split(P.STOCK_NAMES).join('');
    for (const r of removed) assert.ok(!rest.includes(r), `${name} still mentions "${r}"`);
    for (const stock of ['Pip', 'Thimble', 'Hollow', 'Lantern']) assert.doesNotMatch(rest, new RegExp(`\\b${stock}`), `${name} uses "${stock}" outside the avoid-list`);
  }
});

test('the world builder, the DM and character help steer clear of stock names', () => {
  assert.match(P.GENESIS_CORE, /Never use the stock names fantasy writing leans on: Pip, Pippa, Thimble/);
  assert.match(P.DM_CORE, /follow the campaign's NAMING STYLE .* steer clear of stock fantasy names \(Pip/);
  assert.match(P.DM_CORE, /Names already established in this campaign stay as they are/);
  assert.match(P.CHARACTER_ASSIST_CORE, /never stock fantasy names like Pip/);
});

test('each new campaign gets a naming style of its own, picked at random; older campaigns are left as they were', () => {
  assert.ok(NAMING_STYLES.length >= 15);
  for (const s of NAMING_STYLES) assert.doesNotMatch(s, /"[A-Z]/, 'styles describe sounds, never example names');
  assert.equal(pickNamingStyle(() => 0), NAMING_STYLES[0]);
  assert.equal(pickNamingStyle(() => 0.9999), NAMING_STYLES.at(-1));
  const c = C.newCampaign({ id: 'u_host' }, { name: 'Fresh' });
  assert.ok(NAMING_STYLES.includes(c.settings.namingStyle));
  assert.ok(cachedCampaignContext(c).includes(`NAMING STYLE for new names: ${c.settings.namingStyle}`), 'the DM sees it every turn');
  const styles = new Set(Array.from({ length: 30 }, () => C.newCampaign({ id: 'u_host' }, { name: 'Another' }).settings.namingStyle));
  assert.ok(styles.size >= 5, 'new worlds sound different from each other');
  delete c.settings.namingStyle; // a campaign made before naming styles existed
  assert.doesNotMatch(cachedCampaignContext(c), /NAMING STYLE/);
});
