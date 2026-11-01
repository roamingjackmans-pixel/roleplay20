import React, { useEffect, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI, tableStatus } from './ui.js';
import { Avatar } from '../lib/format.jsx';

export default function Composer() {
  const view = useStore((s) => s.view);
  const [tab, setTab] = useState('act');
  const myChar = view.myCharacter;
  const inCombat = !!view.combat;
  useEffect(() => { if (inCombat) setTab('chat'); else setTab('act'); }, [inCombat]);
  return (
    <div className="composer">
      <RollRequests />
      <div className="composer-tabs">
        <button className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')} disabled={!myChar}>{inCombat ? '⚔ Combat' : '✒ Your action'}</button>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>💬 Table talk</button>
      </div>
      {tab === 'act' ? (inCombat ? <CombatHint /> : <ActionBox />) : <ChatBox />}
    </div>
  );
}

function CombatHint() {
  const view = useStore((s) => s.view);
  const c = view.combat;
  return <div className="composer-body muted small">{c.myTurn ? "It's your turn - use the Turn panel over the map." : `Waiting for ${c.currentName}…`}</div>;
}

function ActionBox() {
  const view = useStore((s) => s.view);
  const [text, setText] = useState('');
  const [priv, setPriv] = useState(false);
  const [busy, setBusy] = useState(false);
  const me = view.me;
  const phase = view.phase;
  const mine = view.round.myAction;
  const isOwner = me.role === 'owner';
  const name = view.myCharacter?.name?.split(' ')[0] || 'your character';
  const waitingOn = view.members.filter((m) => m.required && !m.submitted);

  const st = tableStatus(view);
  if (!view.myCharacter) return <div className="composer-body muted small">Create a character to take part. You can still watch and chat.</div>;
  if (!view.campaign.sessionActive) return <div className="composer-body muted small">{st.allHere ? `Everyone is here. Press "▶ ${view.campaign.sessionNumber ? `Begin session ${view.campaign.sessionNumber + 1}` : 'Begin the adventure'}" (top right) to start.` : `The session begins when everyone is at the table. Waiting for ${st.names}.`}</div>;
  if (st.paused) return <div className="composer-body muted small">⏸ Waiting for {st.names} to join the table. Nobody can act until everyone is here.</div>;
  if (phase === 'thinking') return <div className="composer-body row muted"><span className="spinner" /> The Dungeon Master is narrating…</div>;
  if (phase === 'rolls') return <div className="composer-body muted small">🎲 Waiting for dice: {view.rolls.waiting.map((w) => w.characterName).join(', ')}{isOwner ? <button className="btn xs ghost" onClick={() => emit('force')}>skip</button> : null}</div>;
  if (phase === 'manual' || phase === 'failed') {
    return (
      <div className="composer-body col">
        <span className="small muted">{phase === 'manual' ? "The AI DM isn't connected. The host can narrate from the DM Screen." : 'The Dungeon Master stumbled.'}</span>
        <div className="row"><button className="btn sm primary" onClick={() => emit('dm:retry')}>↻ Try again</button>{isOwner && <button className="btn sm" onClick={() => useUI.getState().set({ dmOpen: true })}>🎭 DM Screen</button>}</div>
      </div>
    );
  }

  if (mine) {
    return (
      <div className="composer-body col">
        <div className="submitted">
          <div className="tiny muted">You declared{mine.private ? ' (privately)' : ''}:</div>
          <div className="story">{mine.text}</div>
        </div>
        <div className="row">
          <ReadyRow view={view} />
          <div className="spacer" />
          <button className="btn xs ghost" onClick={() => { setText(mine.text); setPriv(mine.private); emit('action:withdraw'); }}>Change</button>
        </div>
        {waitingOn.length > 0 && isOwner && <button className="btn xs ghost" onClick={() => emit('force')}>Continue without {waitingOn.map((m) => m.displayName).join(', ')}</button>}
      </div>
    );
  }

  async function submit() {
    if (!text.trim()) return;
    setBusy(true);
    const r = await emit('action', { text, private: priv });
    if (r.ok) setText('');
    setBusy(false);
  }
  return (
    <div className="composer-body col">
      <textarea className="textarea action-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`What does ${name} do? Say it, try it, ask it…`} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }} rows={3} />
      <div className="row">
        <label className="check small" title="Only the DM sees this action; other players see only what's outwardly visible"><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private</label>
        <ReadyRow view={view} />
        <div className="spacer" />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={submit}>Ready ✓</button>
      </div>
    </div>
  );
}

function ReadyRow({ view }) {
  const req = view.members.filter((m) => m.required || m.submitted);
  return (
    <div className="ready-row" title="Who has declared an action">
      {req.map((m) => {
        const p = view.party.find((x) => x.userId === m.userId);
        return <span key={m.userId} className={`ready-av ${m.submitted ? 'done' : ''}`}><Avatar name={p?.name || m.displayName} color={p?.color || m.color} img={p?.portrait} title={`${m.displayName}: ${m.submitted ? 'ready' : 'thinking…'}`} /></span>;
      })}
      <span className="tiny muted">{view.round.submittedCount}/{Math.max(view.round.requiredCount, view.round.submittedCount)} ready</span>
    </div>
  );
}

function ChatBox() {
  const [t, setT] = useState('');
  const send = () => { if (t.trim()) { emit('chat', { text: t }); setT(''); } };
  return (
    <div className="composer-body row">
      <input className="input" value={t} onChange={(e) => setT(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Out-of-character chat (the DM ignores this)" />
      <button className="btn sm" onClick={send}>Send</button>
    </div>
  );
}

function RollRequests() {
  const view = useStore((s) => s.view);
  const mine = view.rolls?.mine || [];
  if (!mine.length) return null;
  const st = tableStatus(view);
  const locked = st.paused || st.between;
  return <div className="roll-reqs">{mine.map((r) => <RollRequestCard key={r.id} r={r} locked={locked} />)}</div>;
}

function RollRequestCard({ r, locked = false }) {
  const [adv, setAdv] = useState(r.advantage || 'none');
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  // "custom" rolls are plain dice like 1d4+3 (healing, damage): the player types their total, not a d20
  const isDice = r.kind === 'custom' || r.kind === 'damage';
  const label = r.kind === 'death' ? 'Death saving throw' : r.kind === 'initiative' ? 'Initiative' : r.kind === 'skill' ? `${titleSkill(r.key)} check` : r.kind === 'save' ? `${r.key.toUpperCase()} saving throw` : r.kind === 'ability' ? `${r.key.toUpperCase()} check` : r.label || (isDice ? `Roll ${r.key}` : 'Roll');
  const valid = isDice ? Number(n) >= 1 : Number(n) >= 1 && Number(n) <= 20;
  async function go(mode) {
    setBusy(true);
    const manual = mode === 'manual';
    await emit('roll:respond', { requestId: r.id, mode, natural: manual && !isDice ? Number(n) : undefined, total: manual && isDice ? Number(n) : undefined, advantage: adv });
    setBusy(false);
  }
  return (
    <div className="roll-req fade-in">
      <div className="rr-head"><span className="rr-die">🎲</span><div className="grow"><b>{label}</b>{r.dc ? <span className="pill">DC {r.dc}</span> : null}<div className="small story">{r.reason}</div></div></div>
      <div className="row wrap" style={{ gap: 6 }}>
        {r.kind !== 'death' && !isDice && (
          <div className="tabs adv-tabs">{[['dis', 'Disadv.'], ['none', 'Normal'], ['adv', 'Adv.']].map(([k, l]) => <button key={k} className={adv === k ? 'on' : ''} onClick={() => setAdv(k)}>{l}</button>)}</div>
        )}
        <button className="btn primary sm" disabled={busy || locked} onClick={() => go('auto')}>Roll for me</button>
        <span className="tiny muted">or</span>
        <input className="input rr-input" inputMode="numeric" disabled={locked} placeholder={isDice ? 'total' : 'd20'} value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, '').slice(0, isDice ? 3 : 2))} onKeyDown={(e) => e.key === 'Enter' && valid && !locked && go('manual')} title={isDice ? `Roll ${r.key} with your own dice and type the total` : 'Type the number your real d20 shows (the app adds your modifier)'} />
        <button className="btn sm" disabled={busy || !valid || locked} onClick={() => go('manual')}>I rolled it</button>
        {locked && <span className="tiny muted">Waiting for everyone to be at the table.</span>}
      </div>
    </div>
  );
}

function titleSkill(k) {
  return String(k || '').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
