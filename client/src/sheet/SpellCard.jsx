import React from 'react';
import { Markdown, cap } from '../lib/format.jsx';

export default function SpellCard({ spell, compact = false }) {
  if (!spell) return null;
  const lvl = spell.level ? `${ord(spell.level)}-level ${spell.school}` : `${cap(spell.school)} cantrip`;
  return (
    <div className="spell-card">
      <div className="spell-card-head">
        <div className="display" style={{ fontSize: 18 }}>{spell.name}</div>
        <div className="story muted" style={{ fontStyle: 'italic' }}>{lvl}{spell.ritual ? ' (ritual)' : ''}</div>
      </div>
      <div className="spell-meta">
        <div><span>Casting time</span>{spell.castingTime}</div>
        <div><span>Range</span>{spell.range}{spell.area ? ` (${spell.area.size}-ft ${spell.area.type})` : ''}</div>
        <div><span>Components</span>{(spell.components || []).join(', ')}{spell.material ? ` (${spell.material})` : ''}</div>
        <div><span>Duration</span>{spell.concentration ? 'Concentration, ' : ''}{spell.duration}</div>
      </div>
      {!compact && <Markdown text={spell.desc} className="prose spell-desc" />}
      {!compact && spell.higherLevel && <Markdown text={`**At higher levels.** ${spell.higherLevel}`} className="prose spell-desc" />}
    </div>
  );
}

function ord(n) { return n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`; }
