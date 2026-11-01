import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from './ui.js';
import TacticalMapView from '../map/TacticalMapView.jsx';
import AreaMapView from '../map/AreaMapView.jsx';
import { reachableCells } from '../../../server/game/pathing.js';
import { templateLabel } from '../../../shared/templates.js';

export default function MapStage() {
  const view = useStore((s) => s.view);
  const pings = useStore((s) => s.pings);
  const toast = useStore((s) => s.toast);
  const ui = useUI();
  const mapRef = useRef(null);
  const areaRef = useRef(null);
  const tac = view.tactical;
  const areas = view.areaMaps || [];
  const tab = ui.mapTab === 'area' || !tac ? (areas.length ? 'area' : 'tactical') : 'tactical';
  const area = areas.find((a) => a.map.id === ui.areaMapId) || areas.find((a) => a.map.id === view.scene.areaMapId) || areas[0];
  const myTok = tac?.tokens.find((t) => t.isMine);
  const combat = view.combat;

  // centre on a party member when their pill is clicked
  useEffect(() => {
    if (!ui.focusCharacterId || !tac) return;
    const t = tac.tokens.find((x) => x.characterId === ui.focusCharacterId);
    if (t) mapRef.current?.centerOn?.(t.id);
    ui.set({ focusCharacterId: null });
  }, [ui.focusCharacterId]); // eslint-disable-line

  // movement overlay for my token on my turn
  const movement = useMemo(() => {
    if (!tac || !myTok || !combat?.myTurn || !combat.economy) return null;
    const left = combat.economy.left;
    if (left <= 0) return null;
    const hostile = new Set(tac.tokens.filter((t) => t.kind === 'enemy' && t.health !== 'dead').flatMap((t) => { const out = []; for (let dx = 0; dx < t.size; dx++) for (let dy = 0; dy < t.size; dy++) out.push(`${t.x + dx},${t.y + dy}`); return out; }));
    const fullMap = { ...tac.map, doors: tac.map.doors.map((d) => ({ ...d, secret: false })) };
    try { return { tokenId: myTok.id, cells: reachableCells(fullMap, { x: myTok.x, y: myTok.y }, left, { size: myTok.size, isBlocked: (x, y) => hostile.has(`${x},${y}`) }) }; } catch { return null; }
  }, [tac, myTok?.x, myTok?.y, combat?.myTurn, combat?.economy?.left]); // eslint-disable-line

  const t = ui.targeting;
  const template = t?.kind === 'spell' && t.spell.area ? { shape: t.spell.area.type, size: t.spell.area.size } : null;

  async function onMoveToken(tokenId, x, y) {
    const r = await emit('token:move', { tokenId, x, y });
    if (r?.ok && r.left != null) toast(`Moved ${r.feet} ft · ${r.left} ft left`, 'info', 1800);
  }
  async function onTarget(tokenId) {
    if (!t) return;
    const target = tac.tokens.find((x) => x.id === tokenId);
    if (t.kind === 'attack') {
      ui.cancelTargeting();
      const adv = ui.takeAdv();
      if (ui.rollMode === 'manual') {
        ui.set({ rollPrompt: { label: `${t.attackName || 'Attack'} vs ${target?.name}`, kind: 'attack', advantage: adv, onSubmit: (natural) => doAttack(t, tokenId, adv, 'manual', natural) } });
      } else doAttack(t, tokenId, adv, 'auto');
    } else if (t.kind === 'spell') {
      ui.cancelTargeting();
      await emit('cast', { spellIndex: t.spell.index, slotLevel: t.slotLevel, targets: [tokenId], advantage: ui.takeAdv() });
    }
  }
  async function doAttack(t, tokenId, advantage, mode, natural) {
    const r = await emit('combat:attack', { attackId: t.attackId, targetTokenId: tokenId, advantage, mode, natural });
    if (r?.hit && r.pendingId) ui.set({ damagePrompt: { pendingId: r.pendingId, damage: r.damage, damageType: r.damageType, crit: r.crit, options: r.options || [] } });
    else if (r?.ok && !r.hit && r.reasons?.length) toast(`Miss. (${r.reasons.join(', ')})`, 'info', 3500);
  }
  async function onTemplate({ target }) {
    if (!t) return;
    ui.cancelTargeting();
    await emit('cast', { spellIndex: t.spell.index, slotLevel: t.slotLevel, template: { target } });
  }

  if (ui.mapCollapsed) {
    const name = tab === 'tactical' && tac ? tac.map.name : area?.map.name || view.scene.location || '';
    return (
      <div className="map-collapsed">
        <button className="btn sm map-expand" onClick={() => ui.setMapCollapsed(false)} title="Show the map again">
          🗺 <span className="mc-label">Show map{name ? ` · ${name}` : ''}</span>
        </button>
      </div>
    );
  }

  const hideBtn = <button className="btn icon map-hide" title="Hide map" aria-label="Hide map" onClick={() => ui.setMapCollapsed(true)}>−</button>;

  return (
    <div className="map-stage">
      {(tac || areas.length > 0) && (
        // one dropdown for every map, so fifty maps fit as easily as two
        <div className="map-tabs map-picker">
          <select className="select map-select" aria-label="Choose a map" value={tab === 'tactical' ? 'tactical' : `area:${area?.map.id}`}
            onChange={(e) => (e.target.value === 'tactical' ? ui.set({ mapTab: 'tactical' }) : ui.set({ mapTab: 'area', areaMapId: e.target.value.slice(5) }))}>
            {tac && <optgroup label="Battle map"><option value="tactical">⚔ {tac.map.name}</option></optgroup>}
            {areas.length > 0 && (
              <optgroup label={`Maps (${areas.length})`}>
                {[...areas].sort((a, b) => a.map.name.localeCompare(b.map.name)).map((a) => (
                  <option key={a.map.id} value={`area:${a.map.id}`}>
                    🗺 {a.map.name}{a.map.id === view.scene.areaMapId ? ' · you are here' : ''}{!a.knowledge.owned ? ' (sketch)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {tab === 'area' && area && <span className="tiny muted map-picker-note">{area.knowledge.owned ? 'you have this map' : 'only the places you have found'}</span>}
        </div>
      )}
      {t && (
        <div className="targeting-banner">
          <span>🎯 {t.kind === 'attack' ? `Click an enemy to attack with ${t.attackName}` : template ? `Aim ${t.spell.name} (${templateLabel(template)}) - click to cast` : `Click a target for ${t.spell.name}`}</span>
          <button className="btn xs" onClick={ui.cancelTargeting}>Cancel (Esc)</button>
        </div>
      )}
      <div className="map-canvas-wrap" onKeyDown={(e) => e.key === 'Escape' && ui.cancelTargeting()} tabIndex={-1}>
        {tab === 'tactical' && tac && (
          // battle maps: tokens and a grid scale, so moving and measuring make sense
          <div className="map-tools-overlay">
            {[['select', '🖐', 'Select & move'], ['measure', '📏', 'Measure distance'], ['ping', '📍', 'Ping the map: everyone sees where you point']].map(([m, ic, tip]) => (
              <button key={m} className={`btn icon ${ui.mode === m && !t ? 'active' : ''}`} title={tip} onClick={() => { ui.cancelTargeting(); ui.set({ mode: m }); }}>{ic}</button>
            ))}
            {myTok && <button className="btn icon" title="Find my token" onClick={() => mapRef.current?.centerOn?.(myTok.id)}>◎</button>}
            <button className="btn icon" title="Fit the whole map" onClick={() => mapRef.current?.fit?.()}>⤢</button>
            {hideBtn}
          </div>
        )}
        {tab === 'area' && area && (
          // town and region maps: no tokens or scale, so no move or measure tools
          <div className="map-tools-overlay">
            <button className={`btn icon ${ui.mode === 'ping' ? 'active' : ''}`} title={ui.mode === 'ping' ? 'Stop pinging' : 'Ping the map: everyone sees where you point'} onClick={() => ui.set({ mode: ui.mode === 'ping' ? 'select' : 'ping' })}>📍</button>
            {area.knowledge.current && <button className="btn icon" title="Find where you are" onClick={() => areaRef.current?.centerOnCurrent?.()}>◎</button>}
            <button className="btn icon" title="Fit the whole map" onClick={() => areaRef.current?.fit?.()}>⤢</button>
            <button className="btn icon" title="Open this map full screen" onClick={() => ui.set({ viewMapId: area.map.id })}>⛶</button>
            {hideBtn}
          </div>
        )}
        {tab === 'tactical' && tac && (
          <TacticalMapView
            ref={mapRef}
            map={tac.map}
            vis={tac.vis}
            explored={tac.explored}
            tokens={tac.tokens}
            selectedId={ui.selectedTokenId || myTok?.id}
            activeId={tac.tokens.find((x) => x.isTurn)?.id}
            mode={t ? (template ? 'template' : 'target') : ui.mode}
            template={template}
            movement={movement}
            pings={pings.filter((pg) => !pg.mapId)}
            onMoveToken={onMoveToken}
            onSelectToken={(id) => ui.set({ selectedTokenId: id })}
            onTarget={onTarget}
            onTemplate={onTemplate}
            onPing={(x, y) => emit('ping', { x, y })}
            onCellClick={() => {}}
          />
        )}
        {tab === 'area' && area && (
          <div className="area-wrap">
            <AreaMapView ref={areaRef} map={area.map} knowledge={area.knowledge} mode={ui.mode === 'ping' ? 'ping' : 'select'}
              pings={pings.filter((pg) => pg.mapId === area.map.id)} onPing={(x, y) => emit('ping', { x, y, mapId: area.map.id })}
              onLocationClick={(loc) => toast(`${loc.name}${loc.description ? ` - ${loc.description}` : ''}`, 'info', 5000)} />
            {!area.knowledge.owned && <div className="area-note">You don't have a map of {area.map.name} - only the places you've found. Ask around town, buy one, or keep exploring.</div>}
          </div>
        )}
        {!tac && !areas.length && <div className="map-tools-overlay">{hideBtn}</div>}
        {!tac && !areas.length && <EmptyStage />}
      </div>
    </div>
  );
}

function EmptyStage() {
  const view = useStore((s) => s.view);
  return (
    <div className="empty-stage">
      <div className="empty-stage-inner">
        <div className="display" style={{ fontSize: 22 }}>{view.scene.location || 'The map is blank'}</div>
        <p className="story muted">{view.campaign.sessionActive ? 'The Dungeon Master will lay out the battle map when positions matter, and town maps appear as you discover them.' : 'Maps appear here once the adventure begins.'}</p>
      </div>
    </div>
  );
}
