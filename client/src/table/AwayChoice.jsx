import React, { useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { tableStatus } from './ui.js';
import { Modal } from '../components/Toasts.jsx';

const QUICK = ['Sick in bed', 'Called away on an errand', 'Resting an old injury', 'Visiting family'];

/**
 * The host begins (or carries on) without players who aren't here. For each one they choose: the character sits this
 * session out, for a reason the host writes and the DM works into the story, or the DM plays them like an NPC.
 */
export default function AwayChoice({ mode, onClose }) {
  const view = useStore((s) => s.view);
  const st = tableStatus(view);
  const [picks, setPicks] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (u, v) => setPicks((p) => ({ ...p, [u]: { ...p[u], ...v } }));
  const done = (p) => p?.mode === 'npc' || (p?.mode === 'out' && p.reason?.trim());
  const ready = st.missingPlayers.every((m) => done(picks[m.userId]));

  async function go() {
    setBusy(true);
    const without = Object.fromEntries(st.missingPlayers.map((m) => [m.userId, picks[m.userId]]));
    const r = await emit(mode === 'start' ? 'session:start' : 'session:without', { without });
    setBusy(false);
    if (r?.ok) onClose();
  }

  return (
    <Modal title={mode === 'start' ? 'Begin without everyone?' : 'Carry on without them?'} onClose={onClose} wide>
      <p className="small muted" style={{ marginTop: 0 }}>
        {st.missingPlayers.length ? "Not everyone is at the table. Choose what happens with each missing player's character. Nobody will wait for them." : 'Everyone with a character is here.'}
      </p>
      {st.missingPlayers.map((m) => {
        const p = picks[m.userId] || {};
        return (
          <div key={m.userId} className="away-pick">
            <div className="away-who"><b>{m.char}</b> <span className="tiny muted">{m.player} isn't here</span></div>
            <div className="away-options">
              <button type="button" className={`away-opt ${p.mode === 'out' ? 'active' : ''}`} onClick={() => set(m.userId, { mode: 'out' })} aria-pressed={p.mode === 'out'}>
                <span className="away-ic" aria-hidden="true">🤒</span>
                <span className="away-txt"><b>Sits this one out</b><span className="tiny muted">{m.char} isn't in the story this session, for a reason you choose.</span></span>
              </button>
              <button type="button" className={`away-opt ${p.mode === 'npc' ? 'active' : ''}`} onClick={() => set(m.userId, { mode: 'npc' })} aria-pressed={p.mode === 'npc'}>
                <span className="away-ic" aria-hidden="true">🎭</span>
                <span className="away-txt"><b>The DM plays them</b><span className="tiny muted">{m.char} stays with the party, played like an NPC companion. No big choices are made for them.</span></span>
              </button>
            </div>
            {p.mode === 'out' && (
              <div className="away-reason">
                <label className="tiny muted" htmlFor={`why-${m.userId}`}>Why is {m.char} sitting this one out? The DM works it into the story.</label>
                <input id={`why-${m.userId}`} className="input" maxLength={200} autoFocus value={p.reason || ''} placeholder="e.g. Down with a fever at the inn" onChange={(e) => set(m.userId, { reason: e.target.value })} />
                <div className="away-quick">
                  {QUICK.map((q) => <button key={q} type="button" className={`btn xs ${p.reason === q ? 'active' : 'ghost'}`} onClick={() => set(m.userId, { reason: q })}>{q}</button>)}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {st.building.length > 0 && <p className="small muted">{st.buildingNames} {st.building.length > 1 ? 'are' : 'is'} still making a new character and will join as soon as it's ready.</p>}
      <p className="tiny muted">Anyone who joins later takes their character back straight away.</p>
      <div className="away-actions">
        <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
        <button type="button" className="btn primary" disabled={!ready || busy} onClick={go}>{mode === 'start' ? '▶ Begin without them' : '▶ Carry on without them'}</button>
      </div>
    </Modal>
  );
}
