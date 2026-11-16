// UI-only state for the game table (which panel is open, targeting mode, roll prompts).
import { create } from 'zustand';

// When a panel is pinned, the panel beside it opens on its most useful partner (you can switch it from the rail).
export const PAIRS = { sheet: 'spells', spells: 'sheet', bag: 'sheet', notes: 'quests', maps: 'quests', quests: 'maps', npcs: 'quests', journal: 'quests', party: 'sheet', rules: 'sheet' };

export const useUI = create((set, get) => ({
  panelOpen: typeof window !== 'undefined' ? window.innerWidth > 1100 : true,
  panelTab: 'sheet',
  mapTab: 'tactical',            // tactical | area
  areaMapId: null,
  viewMapId: null,               // area map open in the full-screen viewer
  mapCollapsed: (() => { try { return localStorage.getItem('rp20.mapCollapsed') === '1'; } catch { return false; } })(),
  mode: 'select',                // select | measure | template | target | ping
  targeting: null,               // { kind: 'attack', attackId } | { kind: 'spell', spell, slotLevel } | null
  selectedTokenId: null,
  rollPrompt: null,              // { title, kind, key, label, onRoll(payload) } for manual dice entry
  nextAdv: 'none',
  rollMode: (() => { try { return localStorage.getItem('rp20.rollMode') || 'auto'; } catch { return 'auto'; } })(),
  damagePrompt: null,
  throwing: false,               // the Throw toggle on the turn panel: attacks throw the weapon (this turn only)
  dmOpen: false,
  // unsent text per campaign: { [campaignId]: { action, priv, chat } }. Switching between "Your action" and
  // "Table talk" keeps both; each box only sends its own text. Kept for this tab across reloads.
  drafts: (() => { try { return JSON.parse(sessionStorage.getItem('rp20.drafts') || '{}'); } catch { return {}; } })(),
  setDraft: (cid, patch) => set((s) => {
    const drafts = { ...s.drafts, [cid]: { ...(s.drafts[cid] || {}), ...patch } };
    try { sessionStorage.setItem('rp20.drafts', JSON.stringify(drafts)); } catch { /* private mode */ }
    return { drafts };
  }),
  setPanel: (tab) => set((s) => ({ panelTab: tab, panelOpen: s.panelTab === tab ? !s.panelOpen || true : true })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  // A second panel pinned beside the first (sheet + spells, quests + maps...). It takes the map's place, and the
  // story column stays open. Remembered on this device.
  pinnedTab: (() => { try { return localStorage.getItem('rp20.pinnedTab') || null; } catch { return null; } })(),
  mapBeforePin: null,
  pin: () => set((s) => {
    if (!s.panelOpen) return {};
    try { localStorage.setItem('rp20.pinnedTab', s.panelTab); localStorage.setItem('rp20.mapCollapsed', '1'); } catch { /* ignore */ }
    return { pinnedTab: s.panelTab, panelTab: PAIRS[s.panelTab] || 'sheet', panelOpen: true, mapBeforePin: s.mapCollapsed, mapCollapsed: true };
  }),
  unpin: () => set((s) => {
    const mapCollapsed = s.mapBeforePin ?? s.mapCollapsed;
    try { localStorage.removeItem('rp20.pinnedTab'); localStorage.setItem('rp20.mapCollapsed', mapCollapsed ? '1' : '0'); } catch { /* ignore */ }
    return { pinnedTab: null, mapBeforePin: null, mapCollapsed };
  }),
  set: (patch) => set(patch),
  setRollMode: (m) => { try { localStorage.setItem('rp20.rollMode', m); } catch { /* ignore */ } set({ rollMode: m }); },
  setMapCollapsed: (v) => { try { localStorage.setItem('rp20.mapCollapsed', v ? '1' : '0'); } catch { /* ignore */ } set({ mapCollapsed: !!v }); },
  takeAdv: () => { const a = get().nextAdv; if (a !== 'none') set({ nextAdv: 'none' }); return a; },
  startTargeting: (t) => set({ targeting: t, mode: t.kind === 'spell' && t.spell?.area ? 'template' : 'target', mapTab: 'tactical', mapCollapsed: false }),
  cancelTargeting: () => set({ targeting: null, mode: 'select' }),
}));

/**
 * Who the table is waiting for. The game only moves when every player (member with a character) is here:
 * before that people can look around and chat, but nobody can act or begin the session.
 */
export function tableStatus(view) {
  const players = view.members.filter((m) => m.characterId);
  const label = (m) => {
    const ch = view.party.find((p) => p.userId === m.userId);
    return ch ? `${m.displayName} (${ch.name.split(' ')[0]})` : m.displayName;
  };
  // away: the host carried on without them (they sit out, or the DM plays them); the table doesn't wait for them
  const absent = players.filter((m) => !m.online && !m.away);
  const missing = absent.map(label);
  const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const names = list(missing);
  const building = view.members.filter((m) => m.rebuilding).map((m) => m.displayName);
  const charName = (m) => view.party.find((p) => p.userId === m.userId)?.name.split(' ')[0] || m.displayName;
  return {
    players: players.map((m) => ({ label: label(m), online: m.online, away: m.away })),
    missing, names,
    missingPlayers: absent.map((m) => ({ userId: m.userId, label: label(m), char: charName(m), player: m.displayName })),
    building, buildingNames: list(building),
    allHere: players.length > 0 && !missing.length,
    ready: players.length > 0 && !missing.length && !building.length,
    paused: !!view.campaign.sessionActive && missing.length > 0,
    between: !view.campaign.sessionActive,
  };
}
