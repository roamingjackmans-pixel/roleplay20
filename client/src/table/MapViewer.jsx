// Full-screen viewer for a town or region map, opened from the Maps & handouts panel (or the map stage).
// Shows only what this player knows: the whole map if they own it, otherwise just the places they've found.
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { useUI } from './ui.js';
import AreaMapView from '../map/AreaMapView.jsx';
import { Modal } from '../components/Toasts.jsx';

const KIND_ICON = { tavern: '🍺', inn: '🛏', temple: '⛪', shrine: '🕯', shop: '🛍', market: '🧺', smithy: '⚒', tower: '🗼', square: '⛲', dock: '⚓', mill: '🌾', farm: '🌾', forest: '🌲', mountain: '⛰', lake: '💧', castle: '🏰', keep: '🏰', gate: '🚪', cave: '🕳', dungeon: '🕳', ruins: '🏚', city: '🏙', town: '🏘', village: '🏡', house: '🏠', camp: '⛺', graveyard: '🪦', landmark: '📍' };

export default function MapViewer() {
  const ui = useUI();
  const areas = useStore((s) => s.view?.areaMaps || []);
  const entry = ui.viewMapId ? areas.find((a) => a.map.id === ui.viewMapId) : null;
  const [sel, setSel] = useState(null);
  const canvasRef = useRef(null);
  const close = () => { ui.set({ viewMapId: null }); setSel(null); };
  // picking a place from the list lights it up on the map and brings the map back into view
  const pickFromList = (id) => { setSel(id); canvasRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };

  useEffect(() => {
    if (!entry) return undefined;
    const onKey = (e) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [entry?.map.id]); // eslint-disable-line

  if (!entry) return null;
  const { map, knowledge } = entry;
  const places = map.locations.slice().sort((a, b) => (a.id === knowledge.current ? -1 : b.id === knowledge.current ? 1 : a.name.localeCompare(b.name)));
  const picked = sel && map.locations.find((l) => l.id === sel);

  return (
    <Modal title={`🗺 ${map.name}`} onClose={close} wide>
      <div className="map-viewer">
        <div className="map-viewer-canvas" ref={canvasRef}>
          <AreaMapView map={map} knowledge={knowledge} highlightId={sel} onLocationClick={(loc) => setSel(loc.id)} />
        </div>
        <div className="tiny muted" style={{ marginTop: 8 }}>
          {knowledge.owned ? 'You have this map.' : `A sketch: you don't have a map of ${map.name}, only the places you've found. Ask around, buy one, or keep exploring.`} Drag to pan, scroll or pinch to zoom.
        </div>
        {map.description && <p className="story" style={{ margin: '10px 0 4px' }}>{map.description}</p>}
        {picked && (
          <div className="map-viewer-pick fade-in">
            <b>{KIND_ICON[picked.kind] || '📍'} {picked.name}</b>{picked.id === knowledge.current && <span className="pill">you are here</span>}
            {picked.description && <div className="story">{picked.description}</div>}
          </div>
        )}
        <div className="sub-h" style={{ marginTop: 12 }}>Places you know ({places.length})</div>
        {!places.length && <div className="tiny muted">None yet.</div>}
        <div className="map-viewer-places">
          {places.map((l) => (
            <button key={l.id} className={`list-card ${sel === l.id ? 'on' : ''}`} onClick={() => pickFromList(l.id)}>
              <b>{KIND_ICON[l.kind] || '📍'} {l.name}{l.id === knowledge.current ? ' · you are here' : ''}</b>
              {l.description && <span className="tiny muted">{l.description}</span>}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
