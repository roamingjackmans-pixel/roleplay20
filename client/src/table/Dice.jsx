import React, { useEffect, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from './ui.js';
import { sounds } from '../lib/sound.js';
import { Modal } from '../components/Toasts.jsx';
import D20 from '../components/D20.jsx';

/** A big tumbling d20 for your own rolls (and everyone's crits and fumbles). */
export function DiceOverlay() {
  const dice = useStore((s) => s.dice);
  const party = useStore((s) => s.view?.party);
  // each player's die keeps the look they picked on their sheet, on everyone's screen
  const look = dice?.look || party?.find((p) => p.id === dice?.characterId)?.dice || null;
  const [phase, setPhase] = useState('hidden');
  const [face, setFace] = useState(20);
  useEffect(() => {
    if (!dice) return;
    setPhase('rolling');
    let n = 0;
    const iv = setInterval(() => { setFace(1 + Math.floor(Math.random() * 20)); if (++n > 12) clearInterval(iv); }, 60);
    const t1 = setTimeout(() => {
      clearInterval(iv);
      setFace(dice.result?.natural ?? dice.result?.total);
      setPhase('landed');
      if (dice.result?.natural === 20) sounds.crit();
      if (dice.result?.natural === 1) sounds.fumble();
    }, 820);
    const t2 = setTimeout(() => setPhase('hidden'), 2600);
    return () => { clearInterval(iv); clearTimeout(t1); clearTimeout(t2); };
  }, [dice?.key]); // eslint-disable-line
  if (!dice || phase === 'hidden') return null;
  const nat = dice.result?.natural;
  const cls = nat === 20 ? 'nat20' : nat === 1 ? 'nat1' : '';
  return (
    <div className={`dice-overlay ${phase} ${cls}`} onClick={() => setPhase('hidden')}>
      <div className="d20-3d">
        <D20 look={look} face={face} size={150} />
      </div>
      {phase === 'landed' && (
        <div className="dice-result">
          <div className="dr-total">{dice.result?.total}</div>
          <div className="dr-label">{dice.name} · {dice.label}</div>
          {dice.outcome && <div className="dr-outcome">{dice.outcome}</div>}
          {nat === 20 && <div className="dr-flair">NATURAL 20!</div>}
          {nat === 1 && <div className="dr-flair bad">Natural 1…</div>}
        </div>
      )}
    </div>
  );
}

/** "Type what you rolled" dialog for players using real dice. */
export function RollPromptModal() {
  const ui = useUI();
  const p = ui.rollPrompt;
  const [v, setV] = useState('');
  useEffect(() => setV(''), [p]);
  if (!p) return null;
  const isD20 = !p.expr || /^1?d20/.test(p.expr);
  const close = () => ui.set({ rollPrompt: null });
  async function submit(mode) {
    if (p.onSubmit) { p.onSubmit(mode === 'manual' ? Number(v) : undefined); close(); return; }
    await emit('roll:free', { ...p, mode, natural: isD20 && mode === 'manual' ? Number(v) : undefined, total: !isD20 && mode === 'manual' ? Number(v) : undefined });
    close();
  }
  return (
    <Modal title={p.label || 'Roll'} onClose={close}>
      <div className="col" style={{ gap: 12 }}>
        <div className="muted">{isD20 ? 'Roll your d20 and type the number it shows. The app adds your modifier.' : `Roll ${p.expr} and type the total.`}{p.advantage && p.advantage !== 'none' ? ` (${p.advantage === 'adv' ? 'advantage: roll two, keep the higher' : 'disadvantage: roll two, keep the lower'})` : ''}</div>
        <div className="row">
          <input className="input" autoFocus inputMode="numeric" value={v} onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && v && submit('manual')} style={{ fontSize: 22, width: 110, textAlign: 'center' }} />
          <button className="btn primary" disabled={!v} onClick={() => submit('manual')}>Use my roll</button>
          <button className="btn" onClick={() => submit('auto')}>🎲 Roll for me</button>
        </div>
      </div>
    </Modal>
  );
}

/** Bottom-left dice tray: free rolls, advantage toggle, and real-dice mode. */
export function DiceTray() {
  const ui = useUI();
  const view = useStore((s) => s.view);
  const [open, setOpen] = useState(false);
  const [expr, setExpr] = useState('');
  const [priv, setPriv] = useState(false);
  if (!view?.myCharacter) return null;
  const roll = (e) => {
    if (ui.rollMode === 'manual' && e) { ui.set({ rollPrompt: { kind: 'custom', key: e, expr: e, label: e, private: priv } }); return; }
    emit('roll:free', { kind: 'custom', key: e, expr: e, label: `Rolls ${e}`, mode: 'auto', private: priv });
  };
  return (
    <div className={`dice-tray ${open ? 'open' : ''}`}>
      <button className="btn icon tray-toggle" onClick={() => setOpen(!open)} title="Dice tray">🎲</button>
      {open && (
        <div className="tray-body fade-in">
          <div className="row wrap" style={{ gap: 4 }}>
            {['1d4', '1d6', '1d8', '1d10', '1d12', '1d20', '1d100'].map((d) => <button key={d} className="btn xs" onClick={() => roll(d)}>{d.slice(1)}</button>)}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <input className="input" value={expr} onChange={(e) => setExpr(e.target.value)} placeholder="2d6+3" onKeyDown={(e) => e.key === 'Enter' && expr && roll(expr)} />
            <button className="btn xs" onClick={() => expr && roll(expr)}>Roll</button>
          </div>
          <div className="tabs adv-tabs" style={{ marginTop: 6 }} title="Applies to your next roll">
            {[['dis', 'Disadv.'], ['none', 'Normal'], ['adv', 'Adv.']].map(([k, l]) => <button key={k} className={ui.nextAdv === k ? 'on' : ''} onClick={() => ui.set({ nextAdv: k })}>{l}</button>)}
          </div>
          <label className="check small" style={{ marginTop: 6 }}><input type="checkbox" checked={ui.rollMode === 'manual'} onChange={(e) => ui.setRollMode(e.target.checked ? 'manual' : 'auto')} /> I roll real dice (type results)</label>
          <label className="check small"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Secret rolls</label>
        </div>
      )}
    </div>
  );
}
