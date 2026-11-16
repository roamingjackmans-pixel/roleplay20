import React, { useEffect, useState } from 'react';
import { throwProfile } from '../../../shared/rules.js';
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
  // the Throw toggle lasts for your turn only, so you never throw your sword by accident next round
  useEffect(() => { if (!c.myTurn && useUI.getState().throwing) useUI.getState().set({ throwing: false }); }, [c.myTurn]);
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
        {c.ready && !c.pending?.length && <ReadyAttack r={c.ready} />}
        {c.pending?.length > 0 && !ui.damagePrompt && (
          <div className="tp-row">
            {c.pending.map((p) => <button key={p.id} className="btn sm primary" onClick={() => ui.set({ damagePrompt: { pendingId: p.id, damage: p.dice, damageType: p.type, crit: p.crit, options: p.options || [] } })}>🎲 Roll damage for {p.label}</button>)}
          </div>
        )}
        <div className="tp-row">
          {d.attacks.map((a) => {
            const tp = ui.throwing ? throwProfile(a, d) : null;
            if (ui.throwing && !tp) return <button key={a.id} className="btn sm" disabled title="That can't be thrown">⚔ {a.name}</button>;
            return (
              <button key={a.id} className={`btn sm ${ui.targeting?.attackId === a.id ? 'active' : ''}`} disabled={actionUsed}
                title={tp ? `Throw your ${a.name.toLowerCase()}: ${tp.range.normal} ft (up to ${tp.range.long} ft with disadvantage)${tp.improvised ? '. It isn\'t made for throwing, so it\'s an improvised throw: 1d4, no proficiency bonus.' : ''}` : undefined}
                onClick={() => ui.startTargeting({ kind: 'attack', attackId: a.id, attackName: tp ? `${a.name} (thrown)` : a.name, thrown: !!tp })}>
                {tp ? '🎯' : '⚔'} {a.name}{tp ? ' (throw)' : ''} <span className="faint">{fmtMod(tp ? tp.bonus : a.bonus)} · {tp ? tp.damage : a.damage}{tp ? ` · ${tp.range.normal}/${tp.range.long} ft${tp.improvised ? ', improvised' : ''}` : ''}</span>
              </button>
            );
          })}
          <button className={`btn sm throw-toggle ${ui.throwing ? 'active' : ''}`} aria-pressed={ui.throwing} disabled={actionUsed}
            title="Throw your weapon instead of swinging it. Throwing weapons (daggers, javelins, handaxes, spears) use their own range; anything else is an improvised throw: 1d4, 20/60 ft, no proficiency bonus. Switches off when your turn ends."
            onClick={() => ui.set({ throwing: !ui.throwing })}>🎯 Throw: {ui.throwing ? 'on' : 'off'}</button>
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

/** The attack the player described to the DM ("I run over and stab the goblin"): their token has moved; now they roll. */
function ReadyAttack({ r }) {
  const ui = useUI();
  const [adv, setAdv] = useState(ui.nextAdv || 'none');
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  const valid = Number(n) >= 1 && Number(n) <= 20;
  async function go(mode) {
    setBusy(true);
    const res = await emit('combat:attack', { attackId: r.attackId, targetTokenId: r.targetTokenId, advantage: adv, mode, natural: mode === 'manual' ? Number(n) : undefined, thrown: !!r.thrown });
    setBusy(false);
    if (adv === ui.nextAdv) ui.takeAdv();
    if (res?.hit && res.pendingId) ui.set({ damagePrompt: { pendingId: res.pendingId, damage: res.damage, damageType: res.damageType, crit: res.crit, options: res.options || [] } });
  }
  return (
    <div className="roll-req ready-attack fade-in">
      <div className="rr-head"><span className="rr-die">⚔</span><div className="grow"><b>Roll to hit: {r.attackName} vs {r.targetName}</b> <span className="pill">{fmtMod(r.bonus)}</span><div className="small muted">If it hits, you roll damage next.</div></div>
        <button className="btn xs ghost" title="Do something else instead" onClick={() => emit('combat:unready')}>✕</button>
      </div>
      <div className="row wrap" style={{ gap: 6 }}>
        <div className="tabs adv-tabs">{[['dis', 'Disadv.'], ['none', 'Normal'], ['adv', 'Adv.']].map(([k, l]) => <button key={k} className={adv === k ? 'on' : ''} onClick={() => setAdv(k)}>{l}</button>)}</div>
        <button className="btn primary sm" disabled={busy} onClick={() => go('auto')}>🎲 Roll for me</button>
        <span className="tiny muted">or</span>
        <input className="input rr-input" inputMode="numeric" placeholder="d20" value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))} onKeyDown={(e) => e.key === 'Enter' && valid && go('manual')} title="Type the number your real d20 shows (the app adds your bonus)" />
        <button className="btn sm" disabled={busy || !valid} onClick={() => go('manual')}>I rolled it</button>
      </div>
    </div>
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
