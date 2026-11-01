import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { buildArea, AW, AH } from './areaRenderer.js';
import { fbm, mulberry32 } from './rng.js';
import './map.css';

const INK = '#3b2a1a';
const INK_SOFT = 'rgba(59,42,26,0.55)';

// ------------------------------------------------------------------ parchment texture (generated once)
let PAPER = null;
function paperTexture() {
  if (PAPER || typeof document === 'undefined') return PAPER;
  const w = 600, h = 450;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  const img = x.createImageData(w, h);
  const r = mulberry32(1234);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const n = fbm(i / 90, j / 90, 7, 5) - 0.5;
      const m = fbm(i / 14, j / 30, 11, 2) - 0.5; // fibres
      const g = (r() - 0.5) * 10;
      const k = (j * w + i) * 4;
      img.data[k] = 234 + n * 46 + m * 10 + g;
      img.data[k + 1] = 215 + n * 46 + m * 9 + g;
      img.data[k + 2] = 172 + n * 50 + m * 7 + g;
      img.data[k + 3] = 255;
    }
  x.putImageData(img, 0, 0);
  PAPER = c.toDataURL('image/jpeg', 0.86);
  return PAPER;
}

// ------------------------------------------------------------------ icons (20x20, centred on 10,10)
const ICON = {
  tavern: 'M5 7h8v9H5z M13 9h2.2a1.6 1.6 0 0 1 0 4.4H13 M5 7c1-2.2 2.8-2.2 4 0 1.2-2.2 3-2.2 4 0',
  temple: 'M3 8L10 3.5 17 8z M5 8v7.5 M8.5 8v7.5 M11.5 8v7.5 M15 8v7.5 M3 16.2h14',
  shop: 'M5.5 8.5h9l1.5 8H4z M7.5 8.5V7a2.5 2.5 0 0 1 5 0v1.5',
  smithy: 'M3.5 8h9.5l-2 3H9.5v2.5h3V16H6.5v-2.5h3V11H7.5z M13 8c1.5 0 3 .6 3.5 2',
  guild: 'M10 3l6 2v5c0 4-3 6.2-6 7.2-3-1-6-3.2-6-7.2V5z M10 6v8 M7 9h6',
  castle: 'M4 16.5V7h2v2h2V7h4v2h2V7h2v9.5z M8.6 16.5v-3.2a1.4 1.4 0 0 1 2.8 0v3.2',
  gate: 'M3.5 16.5V6h13v10.5 M6.5 16.5v-5a3.5 3.5 0 0 1 7 0v5 M3.5 6V4h2v2 M14.5 6V4h2v2',
  dock: 'M10 5.5v11 M6 13a4 4 0 0 0 8 0 M7 8h6 M10 5.5a1.4 1.4 0 1 0 0-.01',
  well: 'M5 9.5h10v6.5H5z M4 9.5l6-4.5 6 4.5 M10 5v4.5',
  square: 'M10 3.5l1.9 4.6h4.8l-3.9 2.9 1.5 4.7L10 12.8l-4.3 2.9 1.5-4.7-3.9-2.9h4.8z',
  tower: 'M7 17V7.5L10 3.5l3 4V17z M9 10h2 M9 13h2',
  ruins: 'M5 16.5V8.5l1.5-1 M8.5 16.5v-5 M12 16.5V6.5l1.2 1.2 M15.5 16.5v-4 M3.5 16.7h13',
  cave: 'M3 16.5c0-6 3-10.5 7-10.5s7 4.5 7 10.5z M7.3 16.5c0-3 1.3-5 2.7-5s2.7 2 2.7 5',
  camp: 'M3 16.5L10 5l7 11.5z M8 16.5l2-4.5 2 4.5',
  farm: 'M10 17V6 M10 9c-2-1-3-3.2-3-3.2s2.2 0 3 2c.8-2 3-2 3-2S12 8 10 9 M10 13c-2-1-3-3.2-3-3.2s2.2 0 3 2c.8-2 3-2 3-2S12 12 10 13',
  mill: 'M10 9.5L5 4.5 M10 9.5l5-5 M10 9.5l5 5 M10 9.5l-5 5 M8 17l2-7.5 2 7.5z',
  graveyard: 'M6 16.5V9a4 4 0 0 1 8 0v7.5z M10 10v4 M8.4 11.6h3.2',
  stable: 'M6 5v5a4 4 0 0 0 8 0V5 M6 7h1.6 M12.4 7H14',
  library: 'M4 5h5a1 1 0 0 1 1 1v10.5a1 1 0 0 0-1-1H4z M16 5h-5a1 1 0 0 0-1 1v10.5a1 1 0 0 1 1-1h5z',
  barracks: 'M4.5 4.5l11 11 M15.5 4.5l-11 11 M4 13.5l2.5 2.5 M13.5 16l2.5-2.5',
  jail: 'M5 4h10v12.5H5z M8.3 4v12.5 M11.7 4v12.5',
  house: 'M4 10.5l6-5.5 6 5.5 M5.5 9.2v7.3h9V9.2 M8.8 16.5v-3.5h2.4v3.5',
  dungeon: 'M5 9a5 5 0 0 1 10 0v3l-1.8 1v3H6.8v-3L5 12z M8 9.5h.01 M12 9.5h.01 M9 13.5v1.5 M11 13.5v1.5',
  room: 'M5 5h10v10H5z',
  settlement: 'M3 12.5l3-3 3 3v4H3z M9 10.5l4-4 4 4v6H9z',
  forest: 'M10 3l5 7.5h-3l3.5 5H4.5L8 10.5H5z M10 15.5v2',
  mountain: 'M2.5 16.5l5.5-10 3 5.2 2-3.2 4.5 8z',
  lake: 'M3 8c2-2 4 2 6 0s4 2 6 0 M3 12c2-2 4 2 6 0s4 2 6 0',
  bridge: 'M3 8.5h14 M3 12.5h14 M5 12.5c0-2.6 2.2-4 5-4s5 1.4 5 4',
  crossroads: 'M10 17V4 M10 5.5h5l1.5 1.5L15 8.5h-5 M10 10H5l-1.5 1.5L5 13h5',
  mine: 'M5 16.5L13 8.5 M8 4.5c4 0 7.8 2 8.8 6.8C14 8.4 11 7.4 8 4.5z',
  portal: 'M10 4a6 6 0 1 0 .01 0z M10 7a3 3 0 1 1-3 3',
  landmark: 'M10 3.5l1.9 4.6h4.8l-3.9 2.9 1.5 4.7L10 12.8l-4.3 2.9 1.5-4.7-3.9-2.9h4.8z',
};
const KIND_ICON = {
  tavern: 'tavern', inn: 'tavern', temple: 'temple', shrine: 'temple', shop: 'shop', market: 'shop', smithy: 'smithy', guild: 'guild',
  manor: 'castle', castle: 'castle', keep: 'castle', gate: 'gate', dock: 'dock', well: 'well', square: 'square', tower: 'tower',
  ruins: 'ruins', cave: 'cave', camp: 'camp', farm: 'farm', mill: 'mill', graveyard: 'graveyard', stable: 'stable', library: 'library',
  barracks: 'barracks', jail: 'jail', house: 'house', landmark: 'landmark', dungeon: 'dungeon', room: 'room', town: 'settlement',
  city: 'settlement', village: 'settlement', forest: 'forest', mountain: 'mountain', lake: 'lake', bridge: 'bridge',
  crossroads: 'crossroads', mine: 'mine', portal: 'portal',
};

// ------------------------------------------------------------------ static layer
function Defs({ uid, dungeon }) {
  return (
    <defs>
      <radialGradient id={`${uid}vig`} cx="50%" cy="50%" r="70%">
        <stop offset="55%" stopColor="#5a3a14" stopOpacity="0" />
        <stop offset="100%" stopColor="#4a2c0c" stopOpacity="0.5" />
      </radialGradient>
      <radialGradient id={`${uid}stain`}>
        <stop offset="0%" stopColor="#7a5524" stopOpacity="0.0" />
        <stop offset="70%" stopColor="#7a5524" stopOpacity="0.5" />
        <stop offset="100%" stopColor="#7a5524" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={`${uid}hole`}>
        <stop offset="0%" stopColor="#000" />
        <stop offset="55%" stopColor="#000" />
        <stop offset="100%" stopColor="#fff" />
      </radialGradient>
      <pattern id={`${uid}hatch`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <line x1="0" y1="0" x2="0" y2="7" stroke={INK} strokeWidth="1.3" strokeOpacity="0.75" />
      </pattern>
      {[0, 45, 90, 135].map((a) => (
        <pattern key={a} id={`${uid}field${a}`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform={`rotate(${a})`}>
          <line x1="0" y1="0" x2="0" y2="5" stroke="#6b5a2a" strokeWidth="0.8" strokeOpacity="0.45" />
        </pattern>
      ))}
      <pattern id={`${uid}graph`} width="18" height="18" patternUnits="userSpaceOnUse">
        <path d="M18 0H0V18" fill="none" stroke="#6d8da6" strokeWidth="0.6" strokeOpacity="0.35" />
      </pattern>
      <pattern id={`${uid}floor`} width="12" height="12" patternUnits="userSpaceOnUse">
        <path d="M12 0H0V12" fill="none" stroke={INK} strokeWidth="0.4" strokeOpacity="0.28" />
      </pattern>
      <pattern id={`${uid}cobble`} width="6" height="6" patternUnits="userSpaceOnUse">
        <circle cx="3" cy="3" r="1.1" fill={INK} fillOpacity="0.22" />
      </pattern>
      {/* forest & terrain glyphs */}
      {[
        ['#93a465', '#7d8f52'],
        ['#a3ad6c', '#86934f'],
        ['#86985b', '#6f8148'],
      ].map(([a, b], i) => (
        <symbol key={i} id={`${uid}tree${i}`} viewBox="-10 -10 20 20" overflow="visible">
          <ellipse cx="2" cy="5.5" rx="7" ry="3" fill={INK} fillOpacity="0.18" />
          <path
            d={['M-7 1c-2-3 1-7 4-6 1-3 6-3 7 0 3-1 5 3 3 6 2 3-1 6-4 5-1 2-6 2-7 0-3 1-5-3-3-5z', 'M-7 2c-2-4 2-7 5-6 2-3 6-2 7 1 3 0 4 4 2 6 1 3-2 5-5 4-2 2-6 1-7-1-3 0-4-3-2-4z', 'M-6 2c-3-3 0-8 4-7 1-2 5-2 6 1 4-1 5 4 3 6 1 3-2 5-5 4-1 2-6 2-6-1-2 0-3-2-2-3z'][i]}
            fill={a}
            stroke={INK}
            strokeWidth="0.9"
          />
          <path d="M-3 -1.5c1-1 3-1.2 4 0" fill="none" stroke={b} strokeWidth="1" />
          <path d="M0 6v3" stroke={INK} strokeWidth="1" />
        </symbol>
      ))}
      <symbol id={`${uid}pine`} viewBox="-10 -10 20 20" overflow="visible">
        <ellipse cx="2" cy="6.5" rx="5" ry="2.2" fill={INK} fillOpacity="0.18" />
        <path d="M0 -9l4 6h-2l4 5h-2.5l3.5 4.5h-14l3.5-4.5h-2.5l4-5h-2z" fill="#6f8551" stroke={INK} strokeWidth="0.9" strokeLinejoin="round" />
        <path d="M0 6.5v2.5" stroke={INK} strokeWidth="1" />
      </symbol>
      <symbol id={`${uid}hill`} viewBox="-12 -10 24 20" overflow="visible">
        <path d="M-11 6c3-9 9-12 14-7 2 2 4 4 8 7" fill="#d9c391" stroke={INK} strokeWidth="1.1" />
        <path d="M2 -1l-2 6 M5 1l-2 4.5 M8 3.5l-1.5 2.5" stroke={INK} strokeWidth="0.8" strokeOpacity="0.7" />
      </symbol>
      <symbol id={`${uid}mtn`} viewBox="-14 -16 28 24" overflow="visible">
        <path d="M-13 7L-2 -14 3 -6 6 -9 13 7z" fill="#e7d6ad" stroke={INK} strokeWidth="1.1" strokeLinejoin="round" />
        <path d="M-2 -14L1 -2 -1 3 2 7 M6 -9l1 6 3 2" fill="none" stroke={INK} strokeWidth="0.8" />
        <path d="M1 -2l2 2.5 M0 2l3 2 M3 -6l1.5 2 M8 0l2 3 M-1 3l1.5 3 M4 5l2 2" stroke={INK} strokeWidth="0.75" strokeOpacity="0.8" />
        <path d="M-2 -14l-3 6 2-1 1 2 1-3z" fill="#fbf4e2" />
      </symbol>
      {Object.entries(ICON).map(([k, d]) => (
        <symbol key={k} id={`${uid}i-${k}`} viewBox="0 0 20 20">
          <path d={d} fill="none" stroke={INK} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
      ))}
      {dungeon && null}
    </defs>
  );
}

function Compass({ x, y, r, uid }) {
  const pts = (rot, long, short) => {
    const out = [];
    for (let i = 0; i < 4; i++) {
      const a = rot + (i * Math.PI) / 2;
      out.push([Math.cos(a - Math.PI / 2) * long, Math.sin(a - Math.PI / 2) * long, a]);
    }
    return out.map(([px, py, a]) => {
      const l = [Math.cos(a - Math.PI / 2 - Math.PI / 4) * short, Math.sin(a - Math.PI / 2 - Math.PI / 4) * short];
      const rr = [Math.cos(a - Math.PI / 2 + Math.PI / 4) * short, Math.sin(a - Math.PI / 2 + Math.PI / 4) * short];
      return { tip: [px, py], l, r: rr };
    });
  };
  const main = pts(0, r, r * 0.2);
  const minor = pts(Math.PI / 4, r * 0.62, r * 0.14);
  const tri = (p, side) => `M0 0L${p[side][0].toFixed(1)} ${p[side][1].toFixed(1)}L${p.tip[0].toFixed(1)} ${p.tip[1].toFixed(1)}Z`;
  return (
    <g transform={`translate(${x} ${y})`} pointerEvents="none">
      <circle r={r * 0.8} fill="none" stroke={INK} strokeWidth="1" strokeOpacity="0.8" />
      <circle r={r * 0.72} fill="none" stroke={INK} strokeWidth="0.6" strokeOpacity="0.6" strokeDasharray="2 3" />
      {minor.map((p, i) => (
        <g key={`m${i}`}>
          <path d={tri(p, 'l')} fill="#f3e6c6" stroke={INK} strokeWidth="0.8" />
          <path d={tri(p, 'r')} fill={INK} stroke={INK} strokeWidth="0.8" />
        </g>
      ))}
      {main.map((p, i) => (
        <g key={`M${i}`}>
          <path d={tri(p, 'l')} fill="#f3e6c6" stroke={INK} strokeWidth="0.9" />
          <path d={tri(p, 'r')} fill={i === 0 ? '#8a2a1a' : INK} stroke={INK} strokeWidth="0.9" />
        </g>
      ))}
      <circle r={r * 0.09} fill="#f3e6c6" stroke={INK} strokeWidth="1" />
      <text y={-r - 6} textAnchor="middle" className="rp-map-area-title" fontSize={r * 0.36} fontWeight="700" fill={INK}>
        N
      </text>
    </g>
  );
}

function Title({ t, dungeon }) {
  const { x, y, w, text, sub } = t;
  const h = sub ? 70 : 54;
  const x0 = x - w / 2, y0 = y - 30;
  const curl = 16;
  return (
    <g pointerEvents="none">
      <path
        d={`M${x0 + curl} ${y0}H${x0 + w - curl}c${curl * 0.8} 0 ${curl} ${h * 0.25} ${curl * 0.4} ${h * 0.5}c${curl * 0.6} ${h * 0.25} ${curl * 0.4} ${h * 0.5} -${curl * 0.4} ${h * 0.5}H${x0 + curl}c-${curl * 0.8} 0 -${curl} -${h * 0.25} -${curl * 0.4} -${h * 0.5}c-${curl * 0.6} -${h * 0.25} -${curl * 0.4} -${h * 0.5} ${curl * 0.4} -${h * 0.5}z`}
        fill={dungeon ? '#efe4c8' : '#f2e3bd'}
        stroke={INK}
        strokeWidth="1.6"
      />
      <path d={`M${x0 + curl + 8} ${y0 + 6}H${x0 + w - curl - 8} M${x0 + curl + 8} ${y0 + h - 6}H${x0 + w - curl - 8}`} stroke={INK} strokeWidth="0.7" strokeOpacity="0.6" />
      <text x={x} y={y0 + 34} textAnchor="middle" className="rp-map-area-title" fontSize="27" fontWeight="700" fill={INK} letterSpacing="1.5">
        {text}
      </text>
      {sub && (
        <text x={x} y={y0 + 56} textAnchor="middle" className="rp-map-area-italic" fontSize="14.5" fill="#5a4128">
          {sub.length > 60 ? sub.slice(0, 58) + '…' : sub}
        </text>
      )}
    </g>
  );
}

function StaticLayer({ s, uid }) {
  const paper = paperTexture();
  const dungeon = s.style === 'dungeon';
  const region = s.style === 'region';
  return (
    <g>
      {/* paper */}
      <rect x="-200" y="-200" width={AW + 400} height={AH + 400} fill="#e7d3a7" />
      {paper && <image href={paper} x="0" y="0" width={AW} height={AH} preserveAspectRatio="none" />}
      {dungeon && <rect x="0" y="0" width={AW} height={AH} fill={`url(#${uid}graph)`} />}
      {s.stains.map((st, i) => (
        <circle key={i} cx={st.x} cy={st.y} r={st.r} fill={`url(#${uid}stain)`} opacity={st.o * 2.2} />
      ))}

      {/* water */}
      {s.sea && (
        <g>
          <path d={s.sea.d} fill="#9cb7b3" fillOpacity="0.72" />
          {s.sea.ripples.map((r, i) => (
            <path key={i} d={r.d} fill="none" stroke="#3d5a5c" strokeOpacity={r.o} strokeWidth="1" strokeDasharray={i > 1 ? '6 5' : undefined} />
          ))}
          <path d={s.sea.coast} fill="none" stroke={INK} strokeWidth="2.2" />
        </g>
      )}
      {s.lakes.map((l, i) => (
        <g key={i}>
          <path d={l.d} fill="#9cb7b3" fillOpacity="0.8" stroke={INK} strokeWidth="1.6" />
          {l.ripples.map((d, k) => (
            <path key={k} d={d} fill="none" stroke="#3d5a5c" strokeOpacity={0.35 - k * 0.1} strokeWidth="1" />
          ))}
        </g>
      ))}

      {/* fields */}
      {s.fields.map((f, i) => (
        <g key={i}>
          <path d={f.d} fill={f.tone < 0.5 ? '#d6c48a' : '#c3bd84'} fillOpacity="0.7" stroke={INK_SOFT} strokeWidth="0.9" />
          <path d={f.d} fill={`url(#${uid}field${[0, 45, 90, 135][Math.floor(f.tone * 4) % 4]})`} />
        </g>
      ))}

      {/* rivers */}
      {s.rivers.map((r, i) => (
        <g key={i}>
          <path d={r.d} fill="#8fb1b4" stroke={INK} strokeWidth="1.5" strokeLinejoin="round" />
          <path d={r.center} fill="none" stroke="#d6ebe8" strokeOpacity="0.5" strokeWidth={Math.max(1, r.w * 0.12)} strokeDasharray="14 18" />
        </g>
      ))}

      {/* hills & mountains & forests (behind roads in region maps they sit beside roads anyway) */}
      {s.hills.map((h, i) => (
        <use key={`h${i}`} href={`#${uid}hill`} x={h.x - h.s} y={h.y - (h.s * 20) / 24} width={h.s * 2} height={(h.s * 2 * 20) / 24} />
      ))}
      {s.mountains.map((m, i) => (
        <use key={`m${i}`} href={`#${uid}mtn`} x={m.x - m.s} y={m.y - (m.s * 2 * 24) / 28 * 0.66} width={m.s * 2} height={(m.s * 2 * 24) / 28} />
      ))}

      {/* plazas */}
      {s.plazas.map((p, i) => (
        <g key={i}>
          <path d={p.d} fill={p.green ? '#b5bb82' : '#e6d4a8'} stroke={INK_SOFT} strokeWidth="1" />
          {!p.green && <path d={p.d} fill={`url(#${uid}cobble)`} />}
        </g>
      ))}

      {/* roads: ink edges first, then fills so junctions merge */}
      {!region &&
        s.roads.map((r, i) => <path key={`re${i}`} d={r.d} fill="none" stroke="#5b4330" strokeOpacity="0.85" strokeWidth={r.w + 2.6} strokeLinecap="round" strokeLinejoin="round" />)}
      {!region && s.roads.map((r, i) => <path key={`rf${i}`} d={r.d} fill="none" stroke="#e8d6aa" strokeWidth={r.w} strokeLinecap="round" strokeLinejoin="round" />)}
      {region &&
        s.roads.map((r, i) => (
          <g key={`rr${i}`}>
            <path d={r.d} fill="none" stroke="#f1e2bb" strokeWidth="5" strokeLinecap="round" />
            <path d={r.d} fill="none" stroke="#7a5532" strokeWidth="1.8" strokeDasharray="7 4" strokeLinecap="round" />
          </g>
        ))}

      {/* bridges */}
      {s.bridges.map((b, i) => (
        <g key={i} transform={`translate(${b.x} ${b.y}) rotate(${b.a})`}>
          <rect x={-b.len / 2} y={-b.w / 2} width={b.len} height={b.w} fill="#d8c294" stroke={INK} strokeWidth="1.3" />
          <path d={`M${-b.len / 2} ${-b.w / 2 - 1.5}H${b.len / 2} M${-b.len / 2} ${b.w / 2 + 1.5}H${b.len / 2}`} stroke={INK} strokeWidth="1.2" />
        </g>
      ))}

      {/* graveyards */}
      {s.graves.map((g, i) => (
        <g key={i} transform={`translate(${g.x} ${g.y}) rotate(${g.a})`}>
          <rect x={-g.w / 2} y={-g.h / 2} width={g.w} height={g.h} fill="#c9bd8e" fillOpacity="0.6" stroke={INK} strokeWidth="1" strokeDasharray="3 2" />
          {Array.from({ length: 8 }, (_, k) => (
            <path key={k} d={`M${-g.w / 2 + 8 + (k % 4) * ((g.w - 16) / 3)} ${-g.h / 4 + Math.floor(k / 4) * (g.h / 2) - 3}v6 M${-g.w / 2 + 6 + (k % 4) * ((g.w - 16) / 3)} ${-g.h / 4 + Math.floor(k / 4) * (g.h / 2) - 1}h4`} stroke={INK} strokeWidth="1" />
          ))}
        </g>
      ))}

      {/* buildings */}
      {s.buildings.map((b, i) => (
        <Building key={i} b={b} />
      ))}

      {/* town walls */}
      {s.walls && (
        <g>
          {s.walls.paths.map((d, i) => (
            <g key={i}>
              <path d={d} fill="none" stroke={INK} strokeWidth="7.5" strokeLinejoin="round" strokeLinecap="round" />
              <path d={d} fill="none" stroke="#cdb98e" strokeWidth="4" strokeLinejoin="round" strokeLinecap="round" />
            </g>
          ))}
          {s.walls.gates.map((g, i) => (
            <g key={`g${i}`} transform={`translate(${g.x} ${g.y}) rotate(${g.a})`}>
              <rect x="-9" y="-9" width="18" height="18" fill="#e8d6aa" stroke="none" />
              <rect x="-11" y="-12" width="6" height="7" fill="#cdb98e" stroke={INK} strokeWidth="1.3" />
              <rect x="-11" y="5" width="6" height="7" fill="#cdb98e" stroke={INK} strokeWidth="1.3" />
            </g>
          ))}
          {s.walls.towers.map(([x, y], i) => (
            <circle key={`t${i}`} cx={x} cy={y} r="6.5" fill="#cdb98e" stroke={INK} strokeWidth="1.6" />
          ))}
        </g>
      )}

      {/* trees */}
      {s.trees.map((t, i) => (
        <use key={`t${i}`} href={t.pine ? `#${uid}pine` : `#${uid}tree${t.v}`} x={t.x - t.s} y={t.y - t.s} width={t.s * 2} height={t.s * 2} />
      ))}

      {/* region settlements */}
      {s.settlements.map((st) => (
        <g key={st.id}>
          {st.walled && <circle cx={st.x} cy={st.y} r={st.r} fill="#e9d7ab" stroke={INK} strokeWidth="2.4" />}
          {st.walled && <circle cx={st.x} cy={st.y} r={st.r - 3} fill="none" stroke={INK} strokeWidth="0.8" />}
          {st.houses.map((h, k) => (
            <g key={k} transform={`translate(${h.x} ${h.y}) rotate(${h.a})`}>
              <rect x={-h.w / 2 + 1} y={-h.h / 2 + 1} width={h.w} height={h.h} fill={INK} fillOpacity="0.25" />
              <rect x={-h.w / 2} y={-h.h / 2} width={h.w} height={h.h} fill={h.church ? '#d2bb90' : '#b98d64'} stroke={INK} strokeWidth="0.9" />
              {h.church && <circle cx={h.w / 2} cy="0" r="2.6" fill="#d2bb90" stroke={INK} strokeWidth="0.9" />}
            </g>
          ))}
        </g>
      ))}

      {/* dungeon */}
      {dungeon && <DungeonLayer s={s} uid={uid} />}

      {/* vignette + frame */}
      <rect x="0" y="0" width={AW} height={AH} fill={`url(#${uid}vig)`} pointerEvents="none" />
    </g>
  );
}

function Building({ b }) {
  const { w, h, special } = b;
  const tone = b.shade;
  const fill = special ? '#c9a97a' : tone < 0.33 ? '#bb8a62' : tone < 0.66 ? '#b49577' : '#a58c74';
  const long = w >= h;
  const ridge = long ? `M${-w / 2 + 2} 0H${w / 2 - 2}` : `M0 ${-h / 2 + 2}V${h / 2 - 2}`;
  let body;
  if (special === 'temple') {
    body = (
      <>
        <rect x={-w / 2 + 1.5} y={-h / 2 + 1.5} width={w} height={h} fill={INK} fillOpacity="0.28" />
        <path d={`M${-w / 2} ${-h / 4}h${w}v${h / 2}h${-w}z M${-w / 6} ${-h / 2}h${w / 3}v${h}h${-w / 3}z`} fill={fill} stroke={INK} strokeWidth="1.3" />
        <path d={`M${-w / 2} 0H${w / 2} M0 ${-h / 2}V${h / 2}`} stroke={INK} strokeWidth="0.8" />
        <circle cx={w / 2 - 3} cy="0" r="3" fill={fill} stroke={INK} strokeWidth="1" />
      </>
    );
  } else if (special === 'castle') {
    body = (
      <>
        <rect x={-w / 2 + 2} y={-h / 2 + 2} width={w} height={h} fill={INK} fillOpacity="0.28" />
        <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#cbb48c" stroke={INK} strokeWidth="1.8" />
        <rect x={-w / 4} y={-h / 4} width={w / 2} height={h / 2} fill="#b39a74" stroke={INK} strokeWidth="1.3" />
        {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], i) => (
          <circle key={i} cx={(sx * w) / 2} cy={(sy * h) / 2} r={Math.min(w, h) * 0.14} fill="#cbb48c" stroke={INK} strokeWidth="1.5" />
        ))}
      </>
    );
  } else if (special === 'tower') {
    body = (
      <>
        <circle cx="1.5" cy="1.5" r={w / 2} fill={INK} fillOpacity="0.28" />
        <circle r={w / 2} fill="#cbb48c" stroke={INK} strokeWidth="1.5" />
        <circle r={w / 4} fill="none" stroke={INK} strokeWidth="0.8" />
      </>
    );
  } else if (special === 'mill') {
    body = (
      <>
        <circle cx="1.5" cy="1.5" r={w / 2} fill={INK} fillOpacity="0.28" />
        <circle r={w / 2} fill={fill} stroke={INK} strokeWidth="1.3" />
        <path d={`M${-w} ${-w}L${w} ${w} M${w} ${-w}L${-w} ${w}`} stroke={INK} strokeWidth="1.6" />
      </>
    );
  } else if (special === 'dock') {
    body = (
      <>
        <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="#c8ad80" stroke={INK} strokeWidth="1.2" />
        {[-w / 4, 0, w / 4].map((x, i) => (
          <path key={i} d={`M${x} ${-h / 2}V${h / 2}`} stroke={INK} strokeWidth="0.6" />
        ))}
      </>
    );
  } else {
    body = (
      <>
        <rect x={-w / 2 + 1.5} y={-h / 2 + 1.5} width={w} height={h} fill={INK} fillOpacity="0.28" />
        <rect x={-w / 2} y={-h / 2} width={w} height={h} fill={fill} stroke={INK} strokeWidth={special ? 1.5 : 1.1} />
        <path d={ridge} stroke={INK} strokeWidth="0.8" strokeOpacity="0.8" />
        {special === 'hall' && <rect x={-w / 2 + 2.5} y={-h / 2 + 2.5} width={w - 5} height={h - 5} fill="none" stroke={INK} strokeWidth="0.6" />}
        {special === 'farm' && <rect x={w / 2 + 2} y={-h / 2} width={w * 0.6} height={h * 1.2} fill="none" stroke={INK} strokeWidth="0.8" strokeDasharray="2 2" />}
      </>
    );
  }
  return <g transform={`translate(${b.x.toFixed(1)} ${b.y.toFixed(1)}) rotate(${b.a.toFixed(1)})`}>{body}</g>;
}

function DungeonLayer({ s, uid }) {
  const CW = 18;
  return (
    <g>
      {/* hatched surround */}
      {s.corridors.map((c, i) => (
        <path key={`ch${i}`} d={c.d} fill="none" stroke={`url(#${uid}hatch)`} strokeWidth={CW + 30} strokeLinecap="square" strokeLinejoin="miter" />
      ))}
      {s.rooms.map((r) => (
        <path key={`rh${r.id}`} d={r.d} fill={`url(#${uid}hatch)`} stroke={`url(#${uid}hatch)`} strokeWidth="30" />
      ))}
      {/* ink walls */}
      {s.corridors.map((c, i) => (
        <path key={`ci${i}`} d={c.d} fill="none" stroke={INK} strokeWidth={CW + 5} strokeLinecap="square" strokeDasharray={c.secret ? '10 6' : undefined} />
      ))}
      {s.rooms.map((r) => (
        <path key={`ri${r.id}`} d={r.d} fill="none" stroke={INK} strokeWidth="5" strokeDasharray={r.secret ? '12 6' : undefined} />
      ))}
      {/* floors */}
      {s.corridors.map((c, i) => (
        <path key={`cf${i}`} d={c.d} fill="none" stroke="#f1e6c9" strokeWidth={CW} strokeLinecap="square" />
      ))}
      {s.rooms.map((r) => (
        <g key={`rf${r.id}`}>
          <path d={r.d} fill="#f1e6c9" />
          <path d={r.d} fill={`url(#${uid}floor)`} />
        </g>
      ))}
      {s.corridors.map((c, i) => (
        <path key={`cg${i}`} d={c.d} fill="none" stroke={`url(#${uid}floor)`} strokeWidth={CW} strokeLinecap="butt" />
      ))}
      {/* doors */}
      {s.doors.map((d, i) => (
        <rect key={i} x={d.x - (d.v ? 3.5 : 8)} y={d.y - (d.v ? 8 : 3.5)} width={d.v ? 7 : 16} height={d.v ? 16 : 7} fill="#c9a774" stroke={INK} strokeWidth="1.3" />
      ))}
      {s.entrance && (
        <g transform={`translate(${s.entrance.x} ${s.entrance.y})`}>
          {[0, 1, 2, 3].map((k) => (
            <path key={k} d={s.entrance.v ? `M-8 ${k * 4 - 6}h16` : `M${k * 4 - 6} -8v16`} stroke={INK} strokeWidth="1.2" />
          ))}
        </g>
      )}
      {/* room furniture */}
      {s.rooms.flatMap((r) =>
        r.feats.map((f, i) => {
          const k = `${r.id}f${i}`;
          if (f.t === 'pillar') return <circle key={k} cx={f.x} cy={f.y} r="4" fill={INK} />;
          if (f.t === 'coffin') return <path key={k} d={`M${f.x - 4} ${f.y - 10}h8l3 6-2 14h-10l-2-14z`} fill="#d7c39a" stroke={INK} strokeWidth="1" />;
          if (f.t === 'altar') return <rect key={k} x={f.x - 16} y={f.y - 6} width="32" height="12" fill="#d7c39a" stroke={INK} strokeWidth="1.3" />;
          if (f.t === 'cell') return <path key={k} d={`M${f.x} ${f.y}v18 M${f.x + f.w} ${f.y}v18 M${f.x} ${f.y + 18}h${f.w} M${f.x + f.w / 3} ${f.y + 18}v-6 M${f.x + (2 * f.w) / 3} ${f.y + 18}v-6`} stroke={INK} strokeWidth="1.2" fill="none" />;
          if (f.t === 'well')
            return (
              <g key={k}>
                <circle cx={f.x} cy={f.y} r="14" fill="#9cb7b3" stroke={INK} strokeWidth="1.6" />
                <circle cx={f.x} cy={f.y} r="9" fill="#3d5a5c" fillOpacity="0.6" />
              </g>
            );
          if (f.t === 'portal')
            return (
              <g key={k}>
                <circle cx={f.x} cy={f.y} r="18" fill="none" stroke="#5a3a7a" strokeWidth="2" />
                <circle cx={f.x} cy={f.y} r="11" fill="#7a5a9a" fillOpacity="0.35" stroke="#5a3a7a" strokeWidth="1" strokeDasharray="3 2" />
              </g>
            );
          if (f.t === 'rubble') return <path key={k} d={`M${f.x} ${f.y}l4 -3 3 4 -2 3z M${f.x + 7} ${f.y + 4}l3 -2 2 3z M${f.x - 6} ${f.y + 3}l3 1 -1 3z`} fill="#b5a27c" stroke={INK} strokeWidth="0.8" />;
          return null;
        }),
      )}
      {/* legend */}
      {s.legendBox && (
        <g pointerEvents="none">
          <rect x={s.legendBox.x} y={s.legendBox.y} width={s.legendBox.w} height={s.legendBox.h} fill="#f3e8cc" fillOpacity="0.92" stroke={INK} strokeWidth="1.5" />
          <rect x={s.legendBox.x + 4} y={s.legendBox.y + 4} width={s.legendBox.w - 8} height={s.legendBox.h - 8} fill="none" stroke={INK} strokeWidth="0.6" />
          <text x={s.legendBox.x + s.legendBox.w / 2} y={s.legendBox.y + 22} textAnchor="middle" className="rp-map-area-title" fontSize="14" fontWeight="700" fill={INK}>
            Key
          </text>
          {s.legend.map((l, i) => (
            <text key={l.n} x={s.legendBox.x + 16} y={s.legendBox.y + 42 + i * 19} className="rp-map-area-italic" fontSize="14" fill={l.secret ? '#7a1f14' : INK}>
              {`${l.n}.  ${l.name}${l.secret ? ' (secret)' : ''}`}
            </text>
          ))}
        </g>
      )}
    </g>
  );
}

function Frame() {
  return (
    <g pointerEvents="none">
      <rect x="14" y="14" width={AW - 28} height={AH - 28} fill="none" stroke={INK} strokeWidth="2.2" />
      <rect x="20" y="20" width={AW - 40} height={AH - 40} fill="none" stroke={INK} strokeWidth="0.8" />
      {[
        [14, 14],
        [AW - 14, 14],
        [14, AH - 14],
        [AW - 14, AH - 14],
      ].map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y})`}>
          <rect x="-7" y="-7" width="14" height="14" fill="#efe0b8" stroke={INK} strokeWidth="1.6" transform="rotate(45)" />
          <circle r="2.2" fill={INK} />
        </g>
      ))}
    </g>
  );
}

// ------------------------------------------------------------------ component
/**
 * Parchment overview map (town / city / village / region / dungeon).
 * Props: map (AreaMap), knowledge ({ owned, discovered, current } | null = DM: everything), onLocationClick(loc).
 */
export function AreaMapView({ map, knowledge = null, onLocationClick, highlightId = null, className = '', style }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '') + 'a';
  const scene = useMemo(() => (map ? buildArea(map, knowledge) : null), [map, knowledge]);
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [vb, setVb] = useState({ x: 0, y: 0, w: AW, h: AH });
  const vbRef = useRef(vb);
  vbRef.current = vb;
  const [tip, setTip] = useState(null);
  const drag = useRef(null);
  const pointers = useRef(new Map());

  useEffect(() => {
    setVb({ x: 0, y: 0, w: AW, h: AH });
  }, [map?.id]);

  const toSvg = useCallback((cx, cy) => {
    const svg = svgRef.current;
    if (!svg) return [0, 0];
    const pt = svg.createSVGPoint();
    pt.x = cx;
    pt.y = cy;
    const m = svg.getScreenCTM();
    if (!m) return [0, 0];
    const p = pt.matrixTransform(m.inverse());
    return [p.x, p.y];
  }, []);

  const clampVb = (v) => {
    const w = Math.min(AW * 1.1, Math.max(AW / 7, v.w));
    const h = (w * AH) / AW;
    const x = Math.min(AW - w * 0.35, Math.max(-w * 0.65, v.x));
    const y = Math.min(AH - h * 0.35, Math.max(-h * 0.65, v.y));
    return { x, y, w, h };
  };
  const zoomAt = useCallback(
    (sx, sy, f) => {
      const v = vbRef.current;
      const w = Math.min(AW * 1.1, Math.max(AW / 7, v.w / f));
      const k = w / v.w;
      setVb(clampVb({ x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k, w, h: (w * AH) / AW }));
    },
    [],
  );

  // wheel needs a non-passive listener
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      const [sx, sy] = toSvg(e.clientX, e.clientY);
      let dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      dy = Math.max(-250, Math.min(250, dy));
      zoomAt(sx, sy, Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0018)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [toSvg, zoomAt]);

  const onPointerDown = (e) => {
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const mid = toSvg((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      drag.current = { pinch: true, d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, vb0: vbRef.current, mid };
      return;
    }
    drag.current = { x: e.clientX, y: e.clientY, vb0: vbRef.current, moved: false, target: e.target };
  };
  const onPointerMove = (e) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, [e.clientX, e.clientY]);
    const d = drag.current;
    if (!d) return;
    if (d.pinch) {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
      const w = Math.min(AW * 1.1, Math.max(AW / 7, (d.vb0.w * d.d0) / dist));
      const k = w / d.vb0.w;
      setVb(clampVb({ x: d.mid[0] - (d.mid[0] - d.vb0.x) * k, y: d.mid[1] - (d.mid[1] - d.vb0.y) * k, w, h: (w * AH) / AW }));
      return;
    }
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.max(d.vb0.w / rect.width, d.vb0.h / rect.height);
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) > 4) {
      d.moved = true;
      setTip(null);
      svgRef.current.classList.add('rp-map-dragging');
    }
    if (d.moved) setVb(clampVb({ ...d.vb0, x: d.vb0.x - dx * scale, y: d.vb0.y - dy * scale }));
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    svgRef.current?.classList.remove('rp-map-dragging');
    if (d && !d.pinch && !d.moved) {
      const g = d.target && d.target.closest && d.target.closest('[data-loc]');
      if (g && onLocationClick) {
        const loc = (map.locations || []).find((l) => l.id === g.getAttribute('data-loc'));
        if (loc) onLocationClick(loc);
      }
    }
    if (!pointers.current.size) drag.current = null;
  };

  const showTip = (m, e) => {
    const r = wrapRef.current.getBoundingClientRect();
    setTip({ m, x: e.clientX - r.left, y: e.clientY - r.top });
  };

  const staticLayer = useMemo(() => (scene ? <StaticLayer s={scene} uid={uid} /> : null), [scene, uid]);

  const markers = useMemo(() => {
    if (!scene) return null;
    const dungeon = scene.style === 'dungeon';
    return scene.markers.map((m) => {
      const l = m.loc;
      const icon = KIND_ICON[l.kind] || 'landmark';
      const settlementGlyph = scene.style === 'region' && !m.r;
      return (
        <g
          key={l.id}
          data-loc={l.id}
          className="rp-map-area-loc"
          tabIndex={0}
          role="button"
          aria-label={l.name}
          onPointerEnter={(e) => showTip(m, e)}
          onPointerLeave={() => setTip(null)}
          onFocus={() => setTip({ m, x: 0, y: 0, focus: true })}
          onBlur={() => setTip(null)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ' ') && onLocationClick) {
              e.preventDefault();
              onLocationClick(map.locations.find((x) => x.id === l.id) || l);
            }
          }}
        >
          {m.current && (
            <circle cx={m.x} cy={m.y} r="16" fill="none" stroke="#a3281e" strokeWidth="2.5">
              <animate attributeName="r" values="14;30;14" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="0.9;0;0.9" dur="2.4s" repeatCount="indefinite" />
            </circle>
          )}
          {dungeon ? (
            <g className="rp-map-area-marker">
              <circle cx={m.x} cy={m.y} r="12" fill="#fbf4e2" stroke={l.secret ? '#7a1f14' : INK} strokeWidth="1.8" strokeDasharray={l.secret && m.dm ? '3 2' : undefined} />
              <text x={m.x} y={m.y + 5} textAnchor="middle" className="rp-map-area-title" fontSize="14" fontWeight="700" fill={INK}>
                {l.room ? l.room.n : '?'}
              </text>
            </g>
          ) : settlementGlyph ? (
            <circle className="rp-map-area-marker" cx={m.x} cy={m.y} r={l.kind === 'city' ? 30 : 20} fill="#fff" fillOpacity="0.001" stroke="none" />
          ) : (
            <g className="rp-map-area-marker">
              <circle cx={m.x} cy={m.y} r="12.5" fill="#f6ead0" stroke={l.secret ? '#7a1f14' : INK} strokeWidth="1.6" strokeDasharray={l.secret && m.dm ? '3 2' : undefined} />
              <use href={`#${uid}i-${icon}`} x={m.x - 9} y={m.y - 9} width="18" height="18" />
            </g>
          )}
          {!dungeon && (
            <text x={m.label.x} y={m.label.y} textAnchor={m.label.anchor} className="rp-map-area-label" fontSize={m.label.size} strokeWidth={m.label.size * 0.28} fill={l.secret ? '#7a1f14' : '#2a1c0e'} fontWeight={settlementGlyph ? 700 : 400}>
              {m.label.text}
            </text>
          )}
          {m.current && (
            <g pointerEvents="none" transform={`translate(${m.x} ${m.y - (dungeon ? 12 : 12)})`}>
              <path d="M0 0V-38" stroke={INK} strokeWidth="2" />
              <path d="M0 -38h24l-6 7 6 7H0z" fill="#a3281e" stroke="#5a1208" strokeWidth="1.2" />
              <path d="M3 -35h14" stroke="#e8b84a" strokeWidth="1" />
              <circle cx="0" cy="-39" r="2.4" fill="#e8b84a" stroke={INK} strokeWidth="0.8" />
            </g>
          )}
        </g>
      );
    });
  }, [scene, uid, onLocationClick, map]);

  // the place picked from a list lights up: a warm glow and a pulsing ring around its marker
  const hl = highlightId && scene ? scene.markers.find((m) => m.loc.id === highlightId) : null;
  const hlR = hl ? (scene.style === 'region' && !hl.r ? (hl.loc.kind === 'city' ? 30 : 20) : 12.5) : 0;
  useEffect(() => {
    if (!hl) return;
    const v = vbRef.current;
    const inside = hl.x > v.x + v.w * 0.08 && hl.x < v.x + v.w * 0.92 && hl.y > v.y + v.h * 0.08 && hl.y < v.y + v.h * 0.92;
    if (!inside) setVb(clampVb({ x: hl.x - v.w / 2, y: hl.y - v.h / 2, w: v.w, h: v.h }));
  }, [highlightId, map?.id]); // eslint-disable-line

  if (!scene) return <div className={`rp-map-area ${className}`} style={style} />;
  const fog = scene.fog;
  return (
    <div ref={wrapRef} className={`rp-map-area ${className}`} style={style}>
      <svg
        ref={svgRef}
        className="rp-map-area-svg"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        role="img"
        aria-label={`${scene.style} map: ${scene.name}`}
      >
        <Defs uid={uid} dungeon={scene.style === 'dungeon'} />
        {staticLayer}
        {fog && (
          <>
            <mask id={`${uid}fog`}>
              <rect x="-50" y="-50" width={AW + 100} height={AH + 100} fill="#fff" />
              {fog.holes.map((h, i) => (
                <circle key={i} cx={h.x} cy={h.y} r={h.r} fill={`url(#${uid}hole)`} />
              ))}
            </mask>
            <g mask={`url(#${uid}fog)`} pointerEvents="none">
              <rect x="0" y="0" width={AW} height={AH} fill="#e9d6aa" />
              {paperTexture() && <image href={paperTexture()} x="0" y="0" width={AW} height={AH} preserveAspectRatio="none" opacity="0.9" />}
              <text x={AW / 2} y={AH * 0.82} textAnchor="middle" className="rp-map-area-italic" fontSize="22" fill={INK} fillOpacity="0.28" letterSpacing="6">
                ~ unmapped ~
              </text>
              <rect x="0" y="0" width={AW} height={AH} fill={`url(#${uid}vig)`} />
            </g>
          </>
        )}
        {hl && (
          <g pointerEvents="none" className="rp-map-area-highlight">
            <circle cx={hl.x} cy={hl.y} r={hlR + 14} fill="#ffd25e" fillOpacity="0.35" />
            <circle cx={hl.x} cy={hl.y} r={hlR + 5} fill="none" stroke="#e39b12" strokeWidth="4.5" />
            <circle cx={hl.x} cy={hl.y} r={hlR + 5} fill="none" stroke="#ffcc3d" strokeWidth="3">
              <animate attributeName="r" values={`${hlR + 5};${hlR + 30};${hlR + 5}`} dur="1.6s" repeatCount="indefinite" />
              <animate attributeName="stroke-opacity" values="1;0;1" dur="1.6s" repeatCount="indefinite" />
            </circle>
          </g>
        )}
        {markers}
        <Compass {...scene.compass} uid={uid} />
        <Title t={scene.title} dungeon={scene.style === 'dungeon'} />
        <Frame />
      </svg>
      {tip && !tip.focus && (
        <div className="rp-map-area-tip" style={{ left: tip.x, top: tip.y }}>
          <b>{tip.m.loc.name}</b>
          <i>
            {tip.m.loc.kind}
            {tip.m.loc.secret ? ' · secret' : ''}
            {tip.m.current ? ' · you are here' : ''}
          </i>
          {tip.m.loc.description ? <div>{tip.m.loc.description}</div> : null}
        </div>
      )}
      <div className="rp-map-area-controls">
        <button type="button" aria-label="Zoom in" onClick={() => zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, 1.35)}>
          +
        </button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomAt(vb.x + vb.w / 2, vb.y + vb.h / 2, 1 / 1.35)}>
          −
        </button>
        <button type="button" aria-label="Reset view" onClick={() => setVb({ x: 0, y: 0, w: AW, h: AH })}>
          ⟲
        </button>
      </div>
    </div>
  );
}

export default AreaMapView;
