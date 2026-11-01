// UI-only state for the game table (which panel is open, targeting mode, roll prompts).
import { create } from 'zustand';

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
  dmOpen: false,
  setPanel: (tab) => set((s) => ({ panelTab: tab, panelOpen: s.panelTab === tab ? !s.panelOpen || true : true })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
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
  const missing = players.filter((m) => !m.online).map(label);
  const list = (a) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`);
  const names = list(missing);
  const building = view.members.filter((m) => m.rebuilding).map((m) => m.displayName);
  return {
    players: players.map((m) => ({ label: label(m), online: m.online })),
    missing, names,
    building, buildingNames: list(building),
    allHere: players.length > 0 && !missing.length,
    ready: players.length > 0 && !missing.length && !building.length,
    paused: !!view.campaign.sessionActive && missing.length > 0,
    between: !view.campaign.sessionActive,
  };
}
