// A d20 drawn in SVG in any of the looks from shared/diceStyles.js: a color, a finish (marble, galaxy, glass,
// metal, gemstone, glitter, neon, wood) and a number color. Used by the big rolling die and the dice picker.
import React, { useId } from 'react';
import { DICE_COLORS, DICE_INKS, diceLook } from '../../../shared/diceStyles.js';

// the die's outline (a hexagon) and the triangular face in front
const T = [60, 4], UR = [110, 32], LR = [110, 88], B = [60, 116], LL = [10, 88], UL = [10, 32];
const I1 = [60, 22], I2 = [94, 80], I3 = [26, 80];
const pts = (...p) => p.map((x) => x.join(',')).join(' ');
const HEX = pts(T, UR, LR, B, LL, UL);
// the ten visible facets, with how much light each catches (+ lighter, - darker): light comes from the top left
const FACETS = [
  [[T, UL, I1], 0.22], [[T, UR, I1], 0.12], [[UL, I1, I3], 0.1], [[UR, I1, I2], -0.04], [[UL, LL, I3], 0.02],
  [[UR, LR, I2], -0.14], [[LL, B, I3], -0.1], [[LR, B, I2], -0.22], [[B, I2, I3], -0.16], [[I1, I2, I3], 0.08],
];
const EDGES = 'M60 4 60 22 M110 32 94 80 M10 32 26 80 M60 116 26 80 M60 116 94 80 M10 88 26 80 M110 88 94 80 M10 32 60 22 M110 32 60 22';

// fixed "random" sprinkles so every die of a style looks the same everywhere
function sprinkle(n, seed) {
  let s = seed;
  const r = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
  return Array.from({ length: n }, () => ({ x: 8 + r() * 104, y: 6 + r() * 108, r: r(), k: r() }));
}
const STARS = sprinkle(60, 7);
const GLITTER = sprinkle(70, 31);

function gradientStops(c) {
  const stops = c.stops || [c.a, c.b];
  return stops.map((col, i) => <stop key={i} offset={stops.length === 1 ? 0 : i / (stops.length - 1)} stopColor={col} />);
}

export default function D20({ look, face = 20, size = 150, className = '', title }) {
  const raw = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = (k) => `d20${raw}${k}`;
  const L = diceLook(look);
  const c = DICE_COLORS[L.color];
  const style = L.style;
  const neon = style === 'neon';
  const ink = DICE_INKS[L.ink].color || (neon ? c.a : c.ink);
  const light = ['#fffaf0', '#ffd56b', '#e6ebf2', '#ffffff'].includes(ink) || /^#(?:f|e|d)/i.test(ink);
  const facetStrength = style === 'gem' ? 1.9 : style === 'glass' ? 0.7 : style === 'neon' ? 0 : 1;
  const big = String(face).length >= 2;

  return (
    <svg viewBox="0 0 120 120" width={size} height={size} className={`d20 d20-${style} ${className}`} role="img" aria-label={title || `d20 showing ${face}`}>
      <defs>
        <linearGradient id={id('g')} x1="0" y1="0" x2="1" y2="1">{gradientStops(c)}</linearGradient>
        <radialGradient id={id('sky')} cx="0.45" cy="0.4" r="0.75">
          <stop offset="0" stopColor={c.b} stopOpacity="0.9" /><stop offset="0.6" stopColor="#0a0616" /><stop offset="1" stopColor="#020108" />
        </radialGradient>
        <radialGradient id={id('neb')} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor={c.a} stopOpacity="0.75" /><stop offset="1" stopColor={c.a} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('metal')} x1="0" y1="0" x2="0" y2="1">
          {[0, 0.18, 0.32, 0.5, 0.64, 0.8, 1].map((o, i) => <stop key={i} offset={o} stopColor="#fff" stopOpacity={[0.05, 0.45, 0.02, 0.3, 0.0, 0.35, 0.05][i]} />)}
        </linearGradient>
        <clipPath id={id('clip')}><polygon points={HEX} /></clipPath>
        <filter id={id('glow')} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.4" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>

      <g clipPath={`url(#${id('clip')})`}>
        {/* body */}
        {style === 'galaxy' ? <rect width="120" height="120" fill={`url(#${id('sky')})`} />
          : neon ? <rect width="120" height="120" fill="#0b0912" />
            : <rect width="120" height="120" fill={`url(#${id('g')})`} opacity={style === 'glass' ? 0.62 : 1} />}

        {/* finish */}
        {style === 'galaxy' && (
          <>
            <ellipse cx="42" cy="46" rx="34" ry="20" fill={`url(#${id('neb')})`} transform="rotate(-25 42 46)" />
            <ellipse cx="80" cy="82" rx="28" ry="16" fill={`url(#${id('neb')})`} opacity="0.7" transform="rotate(20 80 82)" />
            {STARS.map((s, i) => <circle key={i} cx={s.x} cy={s.y} r={0.35 + s.r * 0.9} fill="#fff" opacity={0.45 + s.k * 0.55} />)}
          </>
        )}
        {style === 'marble' && (
          <g fill="none" strokeLinecap="round">
            <path d="M-5 30 C 25 10, 40 55, 70 35 S 110 20, 125 45" stroke="#fff" strokeWidth="4" opacity="0.38" />
            <path d="M-5 70 C 20 55, 45 95, 75 70 S 105 60, 125 85" stroke="#fff" strokeWidth="3" opacity="0.3" />
            <path d="M10 110 C 30 85, 55 115, 85 95 S 115 100, 125 115" stroke={c.edge} strokeWidth="2" opacity="0.28" />
            <path d="M15 5 C 35 30, 25 60, 50 80 S 70 110, 60 125" stroke={c.edge} strokeWidth="1.4" opacity="0.3" />
            <path d="M95 -5 C 80 25, 105 50, 85 75" stroke="#fff" strokeWidth="1.6" opacity="0.35" />
          </g>
        )}
        {style === 'wood' && (
          <g fill="none" stroke={c.edge} strokeLinecap="round">
            {Array.from({ length: 11 }, (_, i) => <path key={i} d={`M-5 ${8 + i * 11} C 25 ${2 + i * 11 + (i % 2 ? 7 : -5)}, 60 ${14 + i * 11}, 125 ${6 + i * 11 + (i % 3 ? 4 : -6)}`} strokeWidth={i % 3 ? 1 : 1.8} opacity={i % 3 ? 0.22 : 0.34} />)}
            <ellipse cx="78" cy="58" rx="9" ry="4.5" strokeWidth="1.2" opacity="0.35" />
            <ellipse cx="78" cy="58" rx="4" ry="2" strokeWidth="1" opacity="0.35" />
          </g>
        )}
        {style === 'metal' && <rect width="120" height="120" fill={`url(#${id('metal')})`} />}
        {style === 'glitter' && GLITTER.map((s, i) => (s.k > 0.86
          ? <path key={i} d={`M${s.x} ${s.y - 3} L${s.x + 0.8} ${s.y - 0.8} L${s.x + 3} ${s.y} L${s.x + 0.8} ${s.y + 0.8} L${s.x} ${s.y + 3} L${s.x - 0.8} ${s.y + 0.8} L${s.x - 3} ${s.y} L${s.x - 0.8} ${s.y - 0.8}Z`} fill="#fff" opacity="0.95" />
          : <circle key={i} cx={s.x} cy={s.y} r={0.4 + s.r * 0.9} fill={s.k > 0.5 ? '#fff' : c.a} opacity={0.55 + s.k * 0.45} />))}

        {/* light on the facets */}
        {facetStrength > 0 && FACETS.map(([p, v], i) => (
          <polygon key={i} points={pts(...p)} fill={v > 0 ? '#fff' : '#000'} opacity={Math.min(0.6, Math.abs(v) * facetStrength)} />
        ))}
        {style === 'glass' && <ellipse cx="38" cy="30" rx="26" ry="12" fill="#fff" opacity="0.4" transform="rotate(-28 38 30)" />}
        {style === 'gem' && <path d="M40 30 l3 -7 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3z" fill="#fff" opacity="0.85" />}
      </g>

      {/* outline, edges and the number */}
      <polygon points={HEX} fill="none" stroke={neon ? c.a : c.edge} strokeWidth={neon ? 2.6 : 2} filter={neon ? `url(#${id('glow')})` : undefined} strokeLinejoin="round" />
      <polygon points={pts(I1, I2, I3)} fill="none" stroke={neon ? c.a : c.edge} strokeWidth={neon ? 1.8 : 1.6} opacity={neon ? 0.9 : 1} filter={neon ? `url(#${id('glow')})` : undefined} strokeLinejoin="round" />
      <path d={EDGES} stroke={neon ? c.a : c.edge} strokeWidth="1.2" opacity={neon ? 0.55 : 0.6} />
      <text x="60" y={big ? 67 : 69} textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontWeight="900" fontSize={big ? 25 : 30}
        fill={ink} stroke={light && !neon ? c.edge : 'none'} strokeWidth={light && !neon ? 1.1 : 0} paintOrder="stroke"
        filter={neon ? `url(#${id('glow')})` : undefined}>{face}</text>
    </svg>
  );
}
