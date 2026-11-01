import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TacticalMapView } from './TacticalMapView.jsx';
import { AreaMapView } from './AreaMapView.jsx';
import { FIXTURE_MAPS, sampleTokens, AREA_FIXTURES } from './fixtures.js';
import { THEMES } from './themes.js';
import { peekBase } from './baseRender.js';

// Other agents' browser-safe modules: used when present, otherwise the demo falls back to fixtures.
const MAPGEN = Object.values(import.meta.glob('../../../server/game/mapgen.js', { eager: true }))[0] || null;
const VISION = Object.values(import.meta.glob('../../../server/game/vision.js', { eager: true }))[0] || null;
const PATHING = Object.values(import.meta.glob('../../../server/game/pathing.js', { eager: true }))[0] || null;

const MODES = [
  ['select', 'Select / move'],
  ['measure', 'Measure'],
  ['tpl-sphere', 'Sphere 20 ft'],
  ['tpl-cone', 'Cone 15 ft'],
  ['tpl-line', 'Line 30 ft'],
  ['target', 'Target'],
  ['ping', 'Ping'],
];
const TEMPLATES = { 'tpl-sphere': { shape: 'sphere', size: 20 }, 'tpl-cone': { shape: 'cone', size: 15 }, 'tpl-line': { shape: 'line', size: 30, width: 5 } };

function usePersist(key, init) {
  const [v, setV] = useState(() => {
    try {
      const s = localStorage.getItem(`rpdemo.${key}`);
      return s != null ? JSON.parse(s) : init;
    } catch {
      return init;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(`rpdemo.${key}`, JSON.stringify(v));
    } catch {}
  }, [key, v]);
  return [v, setV];
}

function simpleVis(map, viewer) {
  // fallback when vision.js is missing: everything within 12 cells is visible & bright
  let s = '';
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) s += Math.max(Math.abs(x - viewer.x), Math.abs(y - viewer.y)) <= 12 ? '3' : '0';
  return s;
}

function BattleDemo() {
  const sources = useMemo(() => [...(MAPGEN ? THEMES.map((t) => `generate: ${t}`) : []), ...Object.keys(FIXTURE_MAPS)], []);
  const [source0, setSource] = usePersist('source', sources[0]);
  const source = sources.includes(source0) ? source0 : sources[0];
  const [seed, setSeed] = usePersist('seed', 1234);
  const [size, setSize] = usePersist('size', 'medium');
  const [timeOfDay, setTimeOfDay] = usePersist('tod', 'day');
  const [dm, setDm] = usePersist('dm', false);
  const [fog, setFog] = usePersist('fog', true);
  const [grid, setGrid] = usePersist('grid', true);
  const [mode, setMode] = usePersist('mode', 'select');
  const [tokens, setTokens] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [pings, setPings] = useState([]);
  const [doors, setDoors] = useState(null);
  const [log, setLog] = useState([]);
  const exploredRef = useRef({ key: '', cells: null });
  const mapRef = useRef(null);
  const say = useCallback((m) => setLog((l) => [`${new Date().toLocaleTimeString()}  ${m}`, ...l].slice(0, 40)), []);

  const baseMap = useMemo(() => {
    const t0 = performance.now();
    let m;
    try {
      if (source.startsWith('generate: ')) m = MAPGEN.generateTacticalMap({ theme: source.slice(10), seed, size, timeOfDay });
      else m = FIXTURE_MAPS[source]();
    } catch (e) {
      console.error(e);
      m = FIXTURE_MAPS['fixture: village']();
    }
    m._genMs = Math.round(performance.now() - t0);
    return m;
  }, [source, seed, size, timeOfDay]);

  useEffect(() => {
    setTokens(sampleTokens(baseMap));
    setDoors(null);
    setSelectedId('pc_mira');
    exploredRef.current = { key: '', cells: null };
  }, [baseMap]);

  const map = useMemo(() => (doors ? { ...baseMap, doors } : baseMap), [baseMap, doors]);
  const me = tokens.find((t) => t.isMine);

  const vis = useMemo(() => {
    if (dm || !me) return null;
    if (!fog) return '3'.repeat(map.w * map.h);
    if (VISION) {
      const light = VISION.computeLight(map, [{ x: me.x, y: me.y, bright: 0, dim: 0 }]);
      return VISION.encodeCells(VISION.computeVisibility(map, { x: me.x, y: me.y, size: me.size || 1, darkvision: 60 }, light));
    }
    return simpleVis(map, me);
  }, [map, me?.x, me?.y, dm, fog]);

  const explored = useMemo(() => {
    if (!vis) return null;
    const ex = exploredRef.current;
    if (ex.key !== map.id || !ex.cells) exploredRef.current = { key: map.id, cells: new Uint8Array(map.w * map.h) };
    const cells = exploredRef.current.cells;
    for (let i = 0; i < cells.length; i++) if (vis.charCodeAt(i) > 48) cells[i] = 1;
    let s = '';
    for (let i = 0; i < cells.length; i++) s += cells[i] ? '1' : '0';
    return s;
  }, [vis, map.id]);

  // what the server would send this player
  const viewTokens = useMemo(() => {
    if (!vis) return tokens;
    return tokens
      .filter((t) => !t.hidden)
      .map((t) => {
        const seen = vis.charCodeAt(t.y * map.w + t.x) > 48;
        if (t.kind === 'pc' || t.kind === 'ally') return { ...t, outOfSight: !t.isMine && !seen };
        return seen ? { ...t, outOfSight: false } : null;
      })
      .filter(Boolean);
  }, [tokens, vis, map.w]);

  const movement = useMemo(() => {
    const sel = tokens.find((t) => t.id === selectedId);
    if (!sel || !sel.isMine || mode !== 'select') return null;
    const occupied = new Set(tokens.filter((t) => t.id !== sel.id && t.health !== 'dead').map((t) => `${t.x},${t.y}`));
    if (PATHING) {
      const cells = PATHING.reachableCells(map, { x: sel.x, y: sel.y }, 30, { size: sel.size || 1, isBlocked: (x, y) => occupied.has(`${x},${y}`) && tokens.find((t) => t.x === x && t.y === y)?.kind === 'enemy', isOccupied: (x, y) => occupied.has(`${x},${y}`) });
      return { tokenId: sel.id, cells };
    }
    const cells = new Map();
    for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) cells.set(`${sel.x + dx},${sel.y + dy}`, Math.max(Math.abs(dx), Math.abs(dy)) * 5);
    return { tokenId: sel.id, cells };
  }, [tokens, selectedId, map, mode]);

  const onMoveToken = useCallback(
    (id, x, y) => {
      const ok = !movement || movement.tokenId !== id || movement.cells.has(`${x},${y}`);
      if (!ok) {
        say(`✗ move ${id} → (${x},${y}) rejected (out of reach)`);
        // simulate the server refusing: tokens prop unchanged
        setTokens((ts) => ts.slice());
        return;
      }
      // simulate a short server round-trip
      setTimeout(() => setTokens((ts) => ts.map((t) => (t.id === id ? { ...t, x, y } : t))), 120);
      say(`move ${id} → (${x},${y}) ${movement?.cells.get(`${x},${y}`) ?? '?'} ft`);
    },
    [movement, say],
  );

  const tokenNames = Object.fromEntries(tokens.map((t) => [t.id, t.name]));
  const base = peekBase(map);
  const tpl = TEMPLATES[mode];
  const rendererMode = tpl ? 'template' : mode;

  const cycleDoor = () => {
    const ds = (map.doors || []).map((d, i) => (i % 3 === 0 ? { ...d, open: !d.open } : i % 3 === 1 ? { ...d, locked: !d.locked, open: false } : d));
    setDoors(ds);
  };

  return (
    <div className="demo">
      <aside className="demo-side">
        <h1>Roleplay20 maps</h1>
        <div className="demo-hint">Wheel = zoom · drag = pan · drag Mira (gold) to move · Alt+click = ping · keys + − 0</div>
        <h2>Map</h2>
        <select value={source} onChange={(e) => setSource(e.target.value)}>
          {sources.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </select>
        {source.startsWith('generate') && (
          <>
            <div className="demo-row" style={{ marginTop: 6 }}>
              <input type="number" value={seed} onChange={(e) => setSeed(Number(e.target.value) || 0)} />
              <button onClick={() => setSeed(Math.floor(Math.random() * 1e6))} title="New seed">🎲</button>
            </div>
            <div className="demo-row" style={{ marginTop: 6 }}>
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                <option>small</option>
                <option>medium</option>
                <option>large</option>
              </select>
              <select value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)}>
                <option>day</option>
                <option>dusk</option>
                <option>night</option>
              </select>
            </div>
          </>
        )}
        <h2>View</h2>
        <label>
          <input type="checkbox" checked={dm} onChange={(e) => setDm(e.target.checked)} /> DM view (vis = null)
        </label>
        <label>
          <input type="checkbox" checked={fog} disabled={dm} onChange={(e) => setFog(e.target.checked)} /> Fog of war
        </label>
        <label>
          <input type="checkbox" checked={grid} onChange={(e) => setGrid(e.target.checked)} /> Grid
        </label>
        <div className="demo-btns" style={{ marginTop: 6 }}>
          <button onClick={() => mapRef.current?.fit()}>Fit</button>
          <button onClick={() => mapRef.current?.centerOn('pc_mira')}>Center on Mira</button>
          <button onClick={cycleDoor}>Toggle doors</button>
        </div>
        <h2>Mode</h2>
        <div className="demo-btns">
          {MODES.map(([k, label]) => (
            <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>
              {label}
            </button>
          ))}
        </div>
        <h2>Events</h2>
        <div className="demo-log">{log.join('\n') || '—'}</div>
        <div className="demo-stat">
          {map.name} · {map.theme} · {map.w}×{map.h} · ambient {map.ambient}
          <br />
          gen {map._genMs} ms{base ? ` · paint ${Math.round(base.ms)} ms · ${base.S}px/cell` : ''}
          <br />
          {VISION ? 'vision.js' : 'fallback vision'} · {PATHING ? 'pathing.js' : 'fallback movement'} · {MAPGEN ? 'mapgen.js' : 'fixtures only'}
        </div>
      </aside>
      <main className="demo-main">
        <TacticalMapView
          ref={mapRef}
          map={map}
          vis={vis}
          explored={explored}
          tokens={viewTokens}
          selectedId={selectedId}
          activeId={'pc_mira'}
          mode={rendererMode}
          template={tpl}
          movement={movement}
          pings={pings}
          showGrid={grid}
          debugLabels={source === 'fixture: object gallery'}
          onSelectToken={(id) => {
            setSelectedId(id);
            if (id) say(`select ${tokenNames[id] || id}`);
          }}
          onMoveToken={onMoveToken}
          onTarget={(id) => say(`target ${tokenNames[id] || id}`)}
          onTemplate={({ origin, target, cells }) => say(`template ${tpl?.shape} from (${origin.x},${origin.y}) at (${target.x},${target.y}): ${cells.length} cells`)}
          onPing={(x, y) => {
            setPings((p) => [...p.filter((q) => Date.now() - q.at < 3000), { x, y, color: '#ffd166', at: Date.now() }]);
            say(`ping (${x},${y})`);
          }}
          onCellClick={(x, y) => say(`cell (${x},${y}) '${map.tiles[y * map.w + x]}'`)}
        />
      </main>
    </div>
  );
}

function AreaDemo() {
  const keys = Object.keys(AREA_FIXTURES);
  const [key, setKey] = useState('town');
  const [view, setView] = useState('dm');
  const [seedOff, setSeedOff] = useState(0);
  const [picked, setPicked] = useState(null);
  const area = useMemo(() => ({ ...AREA_FIXTURES[key], seed: AREA_FIXTURES[key].seed + seedOff }), [key, seedOff]);
  const locs = area.locations;
  const knowledge = useMemo(() => {
    if (view === 'dm') return null;
    const discovered = locs.filter((_, i) => i % 3 !== 2).slice(0, 4).map((l) => l.id);
    return { owned: view === 'owned', discovered, current: discovered[0] || null };
  }, [view, locs]);
  return (
    <div className="demo">
      <aside className="demo-side">
        <h1>Area maps</h1>
        <div className="demo-hint">Wheel = zoom · drag = pan · click a location</div>
        <h2>Fixture</h2>
        <div className="demo-btns">
          {keys.map((k) => (
            <button key={k} className={k === key ? 'on' : ''} onClick={() => setKey(k)}>
              {k}
            </button>
          ))}
        </div>
        <h2>Seed</h2>
        <div className="demo-row">
          <input type="number" value={area.seed} onChange={(e) => setSeedOff(Number(e.target.value) - AREA_FIXTURES[key].seed)} />
          <button onClick={() => setSeedOff(Math.floor(Math.random() * 1e5))}>🎲</button>
        </div>
        <h2>Knowledge</h2>
        <div className="demo-btns">
          {[
            ['dm', 'DM (all)'],
            ['owned', 'Owns map'],
            ['partial', 'Not owned'],
          ].map(([k, l]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>
              {l}
            </button>
          ))}
        </div>
        <h2>Clicked</h2>
        <div className="demo-log">{picked ? `${picked.name} (${picked.kind})\n${picked.description || ''}` : '—'}</div>
      </aside>
      <main className="demo-main">
        <AreaMapView map={area} knowledge={knowledge} onLocationClick={setPicked} />
      </main>
    </div>
  );
}

function Demo() {
  const [tab, setTab] = useState(() => (location.hash === '#area' ? 'area' : 'battle'));
  useEffect(() => {
    location.hash = tab === 'area' ? 'area' : '';
  }, [tab]);
  return (
    <>
      <div className="demo-tabs">
        <button className={tab === 'battle' ? 'on' : ''} onClick={() => setTab('battle')}>
          Battle map
        </button>
        <button className={tab === 'area' ? 'on' : ''} onClick={() => setTab('area')}>
          Area map
        </button>
      </div>
      {tab === 'battle' ? <BattleDemo /> : <AreaDemo />}
    </>
  );
}

const rootEl = document.getElementById('root');
rootEl.__root ??= createRoot(rootEl);
rootEl.__root.render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
