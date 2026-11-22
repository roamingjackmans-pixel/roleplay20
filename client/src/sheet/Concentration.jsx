import React, { useState } from 'react';
import { concentrationLeft, timeLeftText } from '../../../shared/concentration.js';

/**
 * The spell a character is concentrating on, how long it has left, and a button to end it (asks once, since the spell
 * can't be got back). `banner` is the larger version for the Spells & Abilities page.
 */
export default function Concentration({ ch, srd, live, why = '', onEnd, banner = false }) {
  const [asking, setAsking] = useState(false);
  if (!ch?.concentration) return null;
  const spell = srd?.by?.spells?.get(ch.concentration);
  const name = spell?.name || ch.concentration;
  const left = timeLeftText(concentrationLeft(ch, spell));
  const end = async () => { setAsking(false); await onEnd(); };
  const button = !live
    ? <span className="tiny muted" title={why}>end it during the session</span>
    : asking
      ? <span className="conc-ask"><span className="tiny">End {name}?</span><button className="btn xs danger" onClick={end}>End it</button><button className="btn xs ghost" onClick={() => setAsking(false)}>Keep</button></span>
      : <button className="btn xs" onClick={() => setAsking(true)} title={`Stop concentrating: ${name} ends now`}>End concentration</button>;
  if (!banner) {
    return <span className="pill gold conc-pill" title={`Concentrating on ${name}${left ? `, ${left}` : ''}`}>◎ {name}{left ? <span className="tiny"> · {left}</span> : null} {button}</span>;
  }
  return (
    <div className="conc-banner">
      <div className="grow">
        <b>◎ Concentrating on {name}</b>{left ? <span className="tiny muted"> · {left}</span> : null}
        <div className="tiny muted">It ends when its time runs out, when you cast another concentration spell, at 0 hit points or on a failed Constitution save after taking damage. You can end it any time.</div>
      </div>
      {button}
    </div>
  );
}
