import React, { useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from './ui.js';
import { useCharacter } from '../sheet/CharacterSheet.jsx';
import { fmtMod } from '../lib/format.jsx';
import { Modal } from '../components/Toasts.jsx';

export function InitiativeBar() {
  const view = useStore((s) => s.view);
  const c = view.combat;
  return (
    <div className="init-bar">
      <span className="init-round">Round {c.round || '–'}</span>
      <div className="init-list">
        {c.state === 'initiative' && <span className="muted small">Rolling initiative…</span>}
        {c.order.map((x) => (
          <div key={x.id} className={`init-chip ${x.current ? 'current' : ''} ${x.dead ? 'dead' : ''} ${x.kind}`} style={{ '--c': x.color }} title={`${x.name} · initiative ${x.init ?? '?'}${x.health ? ` · ${x.health}` : ''}`}>
            <span className="init-num">{x.init ?? '·'}</span>
            <span className="init-name">{x.name}</span>
            {x.health && x.health !== 'unhurt' && <span className={`hp-tier ${x.health}`} />}
          </div>
        ))}
      </div>
      {c.state === 'enemy' && <span className="pill red pulse">enemies acting</span>}
      {view.canRetry && <button className="btn xs primary" onClick={() => emit('dm:retry')}>↻ Enemies: try again</button>}
    </div>
  );
}

export function TurnPanel() {
  const view = useStore((s) => s.view);
  const ui = useUI();
  const { ch, d } = useCharacter();
  const [ask, setAsk] = useState('');
  const c = view.combat;
  const eco = c.economy;
  if (!c.myTurn || !ch || !d) {
    return ui.damagePrompt ? <DamagePrompt /> : null;
  }
  const res = (k) => d.resources?.find((r) => r.key === k);
  const left = (k) => { const r = res(k); return r && r.max != null ? r.max - (r.used || 0) : 0; };
  const actionUsed = eco?.action && !(eco?.attacksLeft > 0);
  const act = (type, extra = {}) => emit('combat:action', { type, ...extra });
  return (
    <>
      <div className="turn-panel fade-in">
        <div className="tp-head">
          <b className="display">Your turn</b>
          <span className={`eco ${actionUsed ? 'used' : ''}`}>Action{eco?.attacksLeft > 0 ? ` (${eco.attacksLeft} attack${eco.attacksLeft > 1 ? 's' : ''} left)` : ''}</span>
          <span className={`eco ${eco?.bonus ? 'used' : ''}`}>Bonus</span>
          <span className={`eco ${eco?.reaction ? 'used' : ''}`}>Reaction</span>
          <span className="eco move">🦶 {eco?.left ?? 0} ft</span>
          <div className="spacer" />
          <button className="btn primary sm" onClick={() => emit('combat:endTurn')}>End turn ⏭</button>
        </div>
        {c.pending?.length > 0 && !ui.damagePrompt && (
          <div className="tp-row">
            {c.pending.map((p) => <button key={p.id} className="btn sm primary" onClick={() => ui.set({ damagePrompt: { pendingId: p.id, damage: p.dice, damageType: p.type, crit: p.crit, options: p.options || [] } })}>🎲 Roll damage for {p.label}</button>)}
          </div>
        )}
        <div className="tp-row">
          {d.attacks.map((a) => (
            <button key={a.id} className={`btn sm ${ui.targeting?.attackId === a.id ? 'active' : ''}`} disabled={actionUsed} onClick={() => ui.startTargeting({ kind: 'attack', attackId: a.id, attackName: a.name })}>
              ⚔ {a.name} <span className="faint">{fmtMod(a.bonus)} · {a.damage}</span>
            </button>
          ))}
          <button className="btn sm" onClick={() => ui.set({ panelOpen: true, panelTab: 'spells' })} disabled={!ch.spellcasting}>✨ Spells</button>
        </div>
        <div className="tp-row">
          <button className="btn xs" disabled={actionUsed} onClick={() => act('dash')}>💨 Dash</button>
          <button className="btn xs" disabled={actionUsed} onClick={() => act('dodge')}>🛡 Dodge</button>
          <button className="btn xs" disabled={actionUsed} onClick={() => act('disengage')}>↩ Disengage</button>
          <button className="btn xs" disabled={actionUsed} onClick={() => act('hide', { mode: 'auto' })}>👤 Hide</button>
          <button className="btn xs" disabled={actionUsed} onClick={() => act('help')}>🤝 Help</button>
          {res('secondWind') && <button className="btn xs" disabled={eco?.bonus || left('secondWind') <= 0} onClick={() => act('second_wind')}>❤ Second Wind</button>}
          {res('actionSurge') && <button className="btn xs" disabled={left('actionSurge') <= 0} onClick={() => act('action_surge')}>⚡ Action Surge</button>}
          {res('rage') && !ch.conditions.includes('raging') && <button className="btn xs" disabled={eco?.bonus || left('rage') <= 0} onClick={() => act('rage')}>🔥 Rage ({left('rage')})</button>}
          {ch.equipment.some((i) => /potion of healing/i.test(i.name)) && <button className="btn xs" disabled={actionUsed} onClick={() => act('potion')}>🧪 Potion</button>}
        </div>
        <div className="tp-row">
          <input className="input" value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="Something else? (shove, grapple, swing from the chandelier…)" onKeyDown={(e) => { if (e.key === 'Enter' && ask.trim()) { emit('combat:ask', { text: ask }); setAsk(''); } }} />
          <button className="btn sm" disabled={!ask.trim()} onClick={() => { emit('combat:ask', { text: ask }); setAsk(''); }}>Ask the DM</button>
        </div>
      </div>
      {ui.damagePrompt && <DamagePrompt />}
    </>
  );
}

function DamagePrompt() {
  const ui = useUI();
  const p = ui.damagePrompt;
  const [opts, setOpts] = useState(() => (p.options || []).filter((o) => o.auto).map((o) => o.key));
  const [total, setTotal] = useState('');
  const [twoHanded, setTwo] = useState(false);
  const [smite, setSmite] = useState(1);
  const close = () => ui.set({ damagePrompt: null });
  async function go(mode) {
    const r = await emit('combat:damage', { pendingId: p.pendingId, mode, total: mode === 'manual' ? Number(total) : undefined, options: opts, smiteLevel: smite, twoHanded });
    if (r.ok || r.error) close();
  }
  return (
    <Modal title={p.crit ? '💥 Critical hit! Roll damage' : 'Hit! Roll damage'} onClose={close}>
      <div className="col" style={{ gap: 12 }}>
        <div className="story" style={{ fontSize: 18 }}>{p.damage} {p.damageType}{p.crit ? ' - dice are doubled' : ''}</div>
        {p.options?.map((o) => (
          <label key={o.key} className="check"><input type="checkbox" checked={opts.includes(o.key)} onChange={(e) => setOpts(e.target.checked ? [...opts, o.key] : opts.filter((x) => x !== o.key))} /> {o.label}
            {o.key === 'smite' && opts.includes('smite') && <select className="select" style={{ width: 90, marginLeft: 8 }} value={smite} onChange={(e) => setSmite(Number(e.target.value))}>{[1, 2, 3, 4, 5].map((l) => <option key={l} value={l}>slot L{l}</option>)}</select>}
          </label>
        ))}
        <label className="check small"><input type="checkbox" checked={twoHanded} onChange={(e) => setTwo(e.target.checked)} /> Two-handed (versatile weapons)</label>
        <div className="row wrap">
          <button className="btn primary" onClick={() => go('auto')}>🎲 Roll for me</button>
          <span className="muted small">or I rolled a total of</span>
          <input className="input rr-input" inputMode="numeric" value={total} onChange={(e) => setTotal(e.target.value.replace(/[^0-9]/g, ''))} onKeyDown={(e) => e.key === 'Enter' && total && go('manual')} />
          <button className="btn" disabled={!total} onClick={() => go('manual')}>Apply</button>
        </div>
      </div>
    </Modal>
  );
}
