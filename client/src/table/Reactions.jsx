import React, { useEffect, useRef, useState } from 'react';
import { emit } from '../lib/store.js';
import { REACTIONS } from '../../../shared/reactions.js';

/**
 * Reactions on a player's action or table talk, like in Messenger: the reactions so far (hover one to see who), and on
 * someone else's message a ☺+ button with ❤️ 😆 😮 😢 😠 👍. One reaction each: pick another to swap, the same to take it back.
 */
export default function Reactions({ e, view }) {
  const me = view.me.userId;
  const own = e.userId === me;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (ev) => { if (!ref.current?.contains(ev.target)) setOpen(false); };
    const esc = (ev) => { if (ev.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const r = e.reactions || {};
  const nameOf = (uid) => (uid === me ? 'You' : view.members.find((m) => m.userId === uid)?.displayName || 'Someone');
  const groups = REACTIONS.map((x) => ({ ...x, who: Object.keys(r).filter((u) => r[u] === x.emoji) })).filter((g) => g.who.length);
  if (own && !groups.length) return null;
  const pick = (emoji) => { setOpen(false); emit('react', { entryId: e.id, emoji }); };

  return (
    <div className={`reactions ${groups.length ? '' : 'empty'}`} ref={ref}>
      {groups.map((g) => {
        const label = `${g.label}: ${g.who.map(nameOf).join(', ')}`;
        const body = <><span className="emo">{g.emoji}</span>{g.who.length > 1 ? <span className="n">{g.who.length}</span> : null}</>;
        return own
          ? <span key={g.emoji} className="react-chip" title={label}>{body}</span>
          : <button key={g.emoji} type="button" className={`react-chip ${r[me] === g.emoji ? 'mine' : ''}`} onClick={() => pick(g.emoji)} title={r[me] === g.emoji ? `${label} (click to take yours back)` : label}>{body}</button>;
      })}
      {!own && <button type="button" className="react-add" onClick={() => setOpen((o) => !o)} title="React" aria-label="React" aria-expanded={open}>☺+</button>}
      {open && (
        <div className="react-picker fade-in" role="menu">
          {REACTIONS.map((x) => (
            <button key={x.emoji} type="button" role="menuitem" className={r[me] === x.emoji ? 'on' : ''} title={x.label} aria-label={x.label} onClick={() => pick(x.emoji)}>{x.emoji}</button>
          ))}
        </div>
      )}
    </div>
  );
}
