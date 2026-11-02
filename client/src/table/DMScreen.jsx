import React, { useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from './ui.js';
import { Modal } from '../components/Toasts.jsx';
import { Markdown } from '../lib/format.jsx';

export default function DMScreen() {
  const ui = useUI();
  const view = useStore((s) => s.view);
  const [text, setText] = useState('');
  const [to, setTo] = useState('all');
  const [npc, setNpc] = useState('');
  if (!ui.dmOpen || view.me.role !== 'owner') return null;
  const s = view.campaign.settings;
  const u = view.ai.usage || {};
  const set = (patch) => emit('dm:settings', patch);
  const close = () => ui.set({ dmOpen: false });
  // the brain every AI call in this campaign uses, as the server sees it
  const brain = view.ai.brain || { model: s.model, effort: s.effort };
  const modelName = (id) => (view.ai.models.find((m) => m.id === id)?.label || id || '').replace(/\s*\(.*\)\s*$/, '');
  const setBrain = async (patch) => {
    const r = await emit('dm:settings', patch);
    if (r?.ok && r.brain) useStore.getState().toast(`The DM now uses ${modelName(r.brain.model)} at ${r.brain.effort} effort, from the very next reply.`, 'good');
  };
  return (
    <Modal title="🎭 Dungeon Master's Screen" onClose={close} wide>
      <div className="dm-grid">
        <div className="col" style={{ gap: 12 }}>
          <div className="sub-h">The AI Dungeon Master</div>
          <div className={`ai-status ${view.ai.configured ? 'ok' : 'off'}`}>
            {view.ai.configured ? <>● Connected ({view.ai.provider})</> : <>○ Not connected. Add <code>ANTHROPIC_API_KEY</code> to the server's <code>.env</code> and restart it.</>}
          </div>
          <label className="field"><span>Brain</span>
            <select className="select" value={brain.model} onChange={(e) => setBrain({ model: e.target.value })}>{view.ai.models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
          </label>
          <label className="field"><span>Thinking effort</span>
            <div className="tabs">{['low', 'medium', 'high'].map((e) => <button key={e} className={brain.effort === e ? 'on' : ''} onClick={() => setBrain({ effort: e })}>{e}</button>)}</div>
          </label>
          <div className="tiny muted">Every AI call in this campaign uses this brain: the story, enemy turns, session write-ups and character help.</div>
          {u.lastModel && (
            <div className="tiny brain-last">
              Last reply came from <b>{modelName(u.lastModel)}</b>
              {u.lastTask ? ` (${{ turn: 'the story', combat: 'enemy turns', session_end: 'session write-up', genesis: 'world building', character: 'character help' }[u.lastTask] || u.lastTask})` : ''}
              {u.lastAt ? `, ${new Date(u.lastAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
              {u.lastAsked && u.lastAsked !== u.lastModel ? `, after ${modelName(u.lastAsked)} declined that request` : ''}
              {u.lastModel !== brain.model && (!u.lastAsked || u.lastAsked === u.lastModel) ? `. That was before the switch to ${modelName(brain.model)}.` : '.'}
            </div>
          )}
          <label className="field"><span>Enemy tactics in combat</span>
            <div className="tabs"><button className={s.enemyTactics === 'ai' ? 'on' : ''} onClick={() => set({ enemyTactics: 'ai' })}>Claude plays them</button><button className={s.enemyTactics === 'quick' ? 'on' : ''} onClick={() => set({ enemyTactics: 'quick' })}>Quick (instant)</button></div>
          </label>
          <div className="usage">
            <div><b>{u.calls || 0}</b><span>DM calls</span></div>
            <div><b>${(u.costUsd || 0).toFixed(2)}</b><span>API cost so far</span></div>
            <div><b>{u.lastMs ? `${(u.lastMs / 1000).toFixed(1)}s` : '–'}</b><span>last reply</span></div>
          </div>
          <div className="sub-h">Table controls</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <button className="btn sm" onClick={() => emit('dm:retry')}>↻ Retry the DM</button>
            <button className="btn sm" onClick={() => emit('force')}>⏩ Resolve actions now</button>
            {view.combat && <button className="btn sm" onClick={() => emit('combat:skip')}>⏭ Skip current turn</button>}
            {view.combat && <button className="btn sm danger" onClick={() => { if (confirm('End the fight now?')) emit('combat:end', { outcome: 'victory' }); }}>🏁 End combat</button>}
          </div>
          <label className="check" title="Shows every hidden token, secret and private message. Spoilers!">
            <input type="checkbox" checked={!!s.dmView} onChange={(e) => set({ dmView: e.target.checked })} /> God view (see everything - spoilers!)
          </label>
        </div>
        <div className="col" style={{ gap: 12 }}>
          <div className="sub-h">Narrate by hand</div>
          <div className="tiny muted">Step in as the DM: correct a ruling, add a detail, or run the game yourself when Claude isn't connected.</div>
          <div className="row wrap" style={{ gap: 6 }}>
            <select className="select" style={{ width: 'auto' }} value={to} onChange={(e) => setTo(e.target.value)}>
              <option value="all">To everyone</option>
              {view.party.map((p) => <option key={p.id} value={p.id}>Only {p.name}</option>)}
            </select>
            <select className="select" style={{ width: 'auto' }} value={npc} onChange={(e) => setNpc(e.target.value)}>
              <option value="">As the narrator</option>
              {(view.dm?.allNpcs || view.npcs).map((n) => <option key={n.id} value={n.id}>As {n.name}</option>)}
            </select>
          </div>
          <textarea className="textarea" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="The lantern gutters. Somewhere below, water drips…" />
          <div className="row"><div className="spacer" /><button className="btn primary sm" disabled={!text.trim()} onClick={async () => { const r = await emit('dm:narrate', { text, to: [to], npcId: npc || null }); if (r.ok) setText(''); }}>Send narration</button></div>
          {view.dm && (
            <>
              <details><summary className="sub-h" style={{ cursor: 'pointer' }}>DM secrets (spoilers)</summary><Markdown text={view.dm.secrets} /></details>
              <details><summary className="sub-h" style={{ cursor: 'pointer' }}>Story arc (spoilers)</summary><Markdown text={view.dm.arc} /></details>
              <details><summary className="sub-h" style={{ cursor: 'pointer' }}>DM notes</summary><ul className="small">{view.dm.notes.map((n, i) => <li key={i}>{n}</li>)}</ul></details>
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
