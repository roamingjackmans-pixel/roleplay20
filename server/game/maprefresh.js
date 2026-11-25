// Redraws a campaign's maps for where the party is right now, with the current map maker: the battle map of the spot
// they're in (rooms, alcoves and corridors, doors set in their walls) and their place on the area map (part of the way
// along a road when they're travelling). The DM is asked once, with the whole story so far in front of it.
// It runs once per campaign after the map maker improves (campaign.mapsVersion < MAPS_VERSION, when the server
// starts) and whenever the host asks for it in the DM Screen.
import { askClaude, NoAIError } from '../ai/client.js';
import { config } from '../config.js';
import { DM_CORE, MAP_REFRESH_TASK } from '../ai/prompts.js';
import { MAP_REFRESH_SCHEMA } from '../ai/schemas.js';
import { cachedCampaignContext, turnPromptParts } from './context.js';
import { getCampaign, allCampaignIds, saveCampaign, MAPS_VERSION } from './campaign.js';
import * as E from './engine.js';

const busy = new Set();

/**
 * Apply the DM's redraw: the party's position on the area maps (the whole truth: no destination = not on the road), and
 * a new battle map in place of the current one. A fight in progress keeps its map (the combatants stand on it).
 * Returns what changed.
 */
export function applyMapRefresh(c, data, { battle = true } = {}) {
  const out = { battleMap: false, position: false, putAway: false };
  const before = { map: c.scene.areaMapId, loc: c.scene.areaLocationId, tac: c.scene.tacticalMapId };
  const was = JSON.stringify([c.scene.areaMapId, c.scene.areaLocationId, c.scene.travel || null]);
  const pos = data?.position || {};
  if (pos.areaMapId || pos.areaLocationId || pos.headingTo) {
    if (pos.areaMapId && c.maps.area?.[pos.areaMapId]) E.moveParty(c, pos.areaMapId, pos.areaLocationId);
    else if (pos.areaLocationId && pos.areaLocationId !== 'none' && c.scene.areaMapId) E.moveParty(c, c.scene.areaMapId, pos.areaLocationId);
    if (pos.areaLocationId === 'none') c.scene.areaLocationId = '';
    if (!String(pos.headingTo || '').trim()) delete c.scene.travel;
    else E.updateTravel(c, { areaLocationId: pos.areaLocationId, headingTo: pos.headingTo, progress: pos.progress });
    out.position = was !== JSON.stringify([c.scene.areaMapId, c.scene.areaLocationId, c.scene.travel || null]);
  }
  const spec = Array.isArray(data?.sceneMap) ? data.sceneMap[0] : null;
  if (battle && !c.combat && c.scene.tacticalMapId) {
    if (spec && E.setSceneMap(c, spec)) out.battleMap = true;
    else if (out.position) {
      // no battle map where they are now, and the old one shows somewhere they've left
      E.putAwayOldBattleMap(c, before);
      out.putAway = !c.scene.tacticalMapId;
    }
  }
  return out;
}

/** Ask the DM to redraw this campaign's maps for where the party is now, and apply it. */
export async function refreshMaps(c, { ask = askClaude, by = 'upgrade' } = {}) {
  if (busy.has(c.id)) return { error: 'The maps are already being redrawn.' };
  if (!c.chronicle?.turns?.length) {
    c.mapsVersion = MAPS_VERSION; // nothing played yet: its maps will be made by the current map maker anyway
    saveCampaign(c);
    return { ok: true, skipped: 'no play yet' };
  }
  busy.add(c.id);
  try {
    const res = await ask({
      task: 'map_refresh', system: DM_CORE, cachedContext: cachedCampaignContext(c),
      prompt: turnPromptParts(c, { text: MAP_REFRESH_TASK }, E.onlineUsers(c)),
      schema: MAP_REFRESH_SCHEMA, ...E.dmBrain(c), maxTokens: 12000, campaignId: c.id,
    });
    E.trackUsage?.(c, res);
    // the table may have moved on while the DM thought: a fight or a turn in progress keeps its battle map
    const r = applyMapRefresh(c, res.data, { battle: !c.combat && !c.thinking });
    c.mapsVersion = MAPS_VERSION;
    if (r.battleMap || r.position || r.putAway) {
      const what = [r.battleMap && 'the battle map', r.position && 'where you are on the map'].filter(Boolean).join(' and ');
      E.system(c, `🗺️ ${by === 'host' ? 'The host had the DM redraw' : 'The DM has redrawn'} ${what || 'the maps'} with the new map maker.`, 'all', { tone: 'muted' });
    }
    console.log(`[maps] ${c.id} redrawn (${by}): battle map ${r.battleMap ? 'new' : r.putAway ? 'put away' : 'kept'}, position ${r.position ? 'updated' : 'unchanged'}`);
    E.pushViews(c);
    return { ok: true, ...r };
  } finally {
    busy.delete(c.id);
  }
}

/** The host's "Redraw the maps" in the DM Screen: runs in the background, the table is told when it's done. */
export function hostRefreshMaps(c, userId) {
  if (c.thinking) return { error: 'The Dungeon Master is busy. Try again in a moment.' };
  if (busy.has(c.id)) return { error: 'The maps are already being redrawn.' };
  refreshMaps(c, { by: 'host' }).then((r) => {
    if (r?.error) E.system(c, `🗺️ ${r.error}`, [userId], { tone: 'warn' });
    else if (r && !r.battleMap && !r.position && !r.putAway && !r.skipped) E.system(c, '🗺️ The DM looked again and the maps already match where you are.', [userId], { tone: 'muted' });
    E.pushViews(c);
  }).catch((e) => {
    const why = e instanceof NoAIError ? "the AI Dungeon Master isn't connected" : String(e.message || e).slice(0, 120);
    E.system(c, `🗺️ The maps couldn't be redrawn (${why}). Try again in a moment.`, [userId], { tone: 'warn' });
    E.pushViews(c);
  });
  return { ok: true };
}

/**
 * Once after the map maker improves: every campaign that has been played gets its current maps redrawn, one at a time,
 * shortly after the server starts. Only with the real AI (a local test server with --ai=file isn't flooded with
 * requests); the DM Screen button works everywhere.
 */
export async function upgradeAllMaps({ ask = askClaude, wait = 15000, force = false } = {}) {
  if (!force && config.aiProvider !== 'api') return [];
  if (wait) await new Promise((r) => setTimeout(r, wait));
  const done = [];
  for (const id of allCampaignIds()) {
    const c = getCampaign(id);
    if (!c || (c.mapsVersion || 0) >= MAPS_VERSION) continue;
    try {
      done.push({ id, ...(await refreshMaps(c, { ask })) });
    } catch (e) {
      console.error(`[maps] ${id} could not be redrawn:`, e.message || e);
      if (e instanceof NoAIError) break;
      done.push({ id, error: String(e.message || e) });
    }
  }
  return done;
}
