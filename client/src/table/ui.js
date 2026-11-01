// UI-only state for the game table (which panel is open, targeting mode, roll prompts).
import { create } from 'zustand';

export const useUI = create((set, get) => ({
  panelOpen: typeof window !== 'undefined' ? window.innerWidth > 1100 : true,
  panelTab: 'sheet',
  mapTab: 'tactical',            // tactical | area
  areaMapId: null,
  viewMapId: null,               // area map open in the full-screen viewer
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
  takeAdv: () => { const a = get().nextAdv; if (a !== 'none') set({ nextAdv: 'none' }); return a; },
  startTargeting: (t) => set({ targeting: t, mode: t.kind === 'spell' && t.spell?.area ? 'template' : 'target', mapTab: 'tactical' }),
  cancelTargeting: () => set({ targeting: null, mode: 'select' }),
}));
