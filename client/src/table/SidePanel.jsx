import React, { useEffect, useRef, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from './ui.js';
import CharacterSheet from '../sheet/CharacterSheet.jsx';
import SpellsPage from '../sheet/SpellsPage.jsx';
import Inventory from '../sheet/Inventory.jsx';
import { Avatar, Markdown, titleIndex, timeAgo } from '../lib/format.jsx';
import { previewVoice, voiceLabel } from '../lib/tts.js';

const TABS = [
  ['sheet', '🛡', 'Sheet'], ['spells', '✨', 'Spells & abilities'], ['bag', '🎒', 'Bag'], ['notes', '📝', 'My notes'],
  ['maps', '🗺', 'Maps & handouts'], ['quests', '📌', 'Quests'], ['npcs', '🎭', 'People'], ['journal', '📖', 'Journal'],
  ['party', '👥', 'Party'], ['rules', '⚖', 'Rules'],
];

export default function SidePanel() {
  const ui = useUI();
  const view = useStore((s) => s.view);
  const questN = view.quests.filter((q) => q.status === 'active').length;
  return (
    <>
      <nav className="panel-rail">
        {TABS.map(([k, icon, label]) => (
          <button key={k} className={`rail-btn ${ui.panelOpen && ui.panelTab === k ? 'on' : ''}`} title={label} onClick={() => (ui.panelOpen && ui.panelTab === k ? ui.set({ panelOpen: false }) : ui.set({ panelOpen: true, panelTab: k }))}>
            <span>{icon}</span>
            {k === 'quests' && questN > 0 && <i className="badge">{questN}</i>}
            {k === 'sheet' && view.myCharacter?.pendingLevelUp && <i className="badge gold">↑</i>}
          </button>
        ))}
      </nav>
      {ui.panelOpen && (
        <section className="side-panel fade-in">
          <div className="sp-head"><b className="display">{TABS.find((t) => t[0] === ui.panelTab)?.[2]}</b><div className="spacer" /><button className="btn ghost icon" onClick={() => ui.set({ panelOpen: false })}>✕</button></div>
          <div className="sp-body">
            {ui.panelTab === 'sheet' && <CharacterSheet />}
            {ui.panelTab === 'spells' && <SpellsPage />}
            {ui.panelTab === 'bag' && <Inventory />}
            {ui.panelTab === 'notes' && <Notes />}
            {ui.panelTab === 'maps' && <MapsTab />}
            {ui.panelTab === 'quests' && <Quests />}
            {ui.panelTab === 'npcs' && <People />}
            {ui.panelTab === 'journal' && <Journal />}
            {ui.panelTab === 'party' && <Party />}
            {ui.panelTab === 'rules' && <Rules />}
          </div>
        </section>
      )}
    </>
  );
}

function Notes() {
  const notes = useStore((s) => s.view.notes);
  const [t, setT] = useState(notes || '');
  const [saved, setSaved] = useState(true);
  const timer = useRef(null);
  useEffect(() => { setT(notes || ''); }, []); // eslint-disable-line
  const change = (v) => {
    setT(v);
    setSaved(false);
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => { await emit('notes', { text: v }, { quiet: true }); setSaved(true); }, 700);
  };
  return (
    <div className="col" style={{ height: '100%' }}>
      <div className="tiny muted">Private: only you can see these. Clues, suspicions, names, debts, plans.</div>
      <textarea className="textarea notes-area" value={t} onChange={(e) => change(e.target.value)} placeholder="The innkeeper flinched when we mentioned the lighthouse…" />
      <div className="tiny faint">{saved ? 'Saved' : 'Saving…'}</div>
    </div>
  );
}

function MapsTab() {
  const view = useStore((s) => s.view);
  const ui = useUI();
  const [open, setOpen] = useState(null);
  return (
    <div className="col">
      <div className="sub-h">Maps</div>
      {!view.areaMaps.length && <div className="tiny muted">No maps yet. Towns and regions appear here as you discover them; a proper map you have to find, buy or be given.</div>}
      {view.areaMaps.map((a) => (
        <button key={a.map.id} className="list-card" onClick={() => ui.set({ viewMapId: a.map.id, mapTab: 'area', areaMapId: a.map.id })}>
          <b>🗺 {a.map.name}</b>
          <span className="tiny muted">{titleIndex(a.map.style)} · {a.knowledge.owned ? 'you have the map' : `${a.knowledge.discovered.length} place${a.knowledge.discovered.length === 1 ? '' : 's'} found`}</span>
        </button>
      ))}
      <div className="sub-h" style={{ marginTop: 12 }}>Handouts</div>
      {!view.handouts.length && <div className="tiny muted">Letters, posters and notes you pick up will be kept here.</div>}
      {view.handouts.slice().reverse().map((h) => (
        <button key={h.id} className="list-card" onClick={() => setOpen(open === h.id ? null : h.id)}>
          <b>📜 {h.title}</b><span className="tiny muted">{titleIndex(h.kind)} · {timeAgo(h.at)}</span>
          {open === h.id && <div className="handout"><Markdown text={h.content} className="prose handout-prose" /></div>}
        </button>
      ))}
    </div>
  );
}

function Quests() {
  const quests = useStore((s) => s.view.quests);
  const groups = [['active', 'Active'], ['rumor', 'Rumours & leads'], ['completed', 'Completed'], ['failed', 'Failed']];
  if (!quests.length) return <div className="empty">No quests yet. Talk to people.</div>;
  return (
    <div className="col">
      {groups.map(([k, label]) => {
        const list = quests.filter((q) => q.status === k);
        if (!list.length) return null;
        return (
          <div key={k}>
            <div className="sub-h">{label}</div>
            {list.map((q) => (
              <div key={q.id} className={`quest ${k}`}>
                <b>{q.title}</b>{q.giver && <span className="tiny muted"> · from {q.giver}</span>}
                <div className="small">{q.summary}</div>
                {q.updates?.length > 0 && <ul className="tiny muted">{q.updates.map((u, i) => <li key={i}>{u}</li>)}</ul>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function People() {
  const view = useStore((s) => s.view);
  const prefs = useStore((s) => s.prefs);
  if (!view.npcs.length) return <div className="empty">You haven't met anyone worth remembering yet.</div>;
  return (
    <div className="col">
      <div className="tiny muted">Everyone you've met. Each keeps their own voice all campaign.</div>
      {view.npcs.map((n) => (
        <div key={n.id} className="npc-card" style={{ '--npc': n.color }}>
          <div className="row">
            <div className="npc-dot" />
            <div className="grow"><b>{n.name}</b>{n.ally && <span className="pill green">ally</span>}<div className="tiny muted">{n.role}{n.location ? ` · ${n.location}` : ''}</div></div>
            <span className={`pill ${n.attitude === 'friendly' ? 'green' : n.attitude === 'hostile' ? 'red' : ''}`}>{n.attitude}</span>
          </div>
          {n.description && <div className="small">{n.description}</div>}
          <div className="row tiny muted" style={{ marginTop: 4 }}>
            <span className="grow">🗣 {[n.voice?.age, n.voice?.gender, n.voice?.accent !== 'any' ? n.voice?.accent : ''].filter(Boolean).join(', ')}{n.voice?.style ? ` - ${n.voice.style}` : ''} · <i>{voiceLabel(n.voice || {}, n.id, prefs)}</i></span>
            <button className="btn xs" onClick={() => previewVoice(n.voice || {}, n.id, `I am ${n.name}. ${n.role ? `${n.role}, at your service... or not.` : ''}`, prefs)}>Hear</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Journal() {
  const j = useStore((s) => s.view.journal);
  const [tab, setTab] = useState(j.sessions.some((s) => s.logEntry) ? 'log' : 'world');
  return (
    <div className="col">
      <div className="tabs"><button className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>Sessions</button><button className={tab === 'world' ? 'on' : ''} onClick={() => setTab('world')}>World bible</button></div>
      {tab === 'world' && <Markdown text={j.worldBible || '_No world bible yet._'} />}
      {tab === 'log' && (
        <div className="col">
          {!j.sessions.length && <div className="empty">Session logs are written when the host ends a session.</div>}
          {j.sessions.slice().reverse().map((s) => (
            <details key={s.n} className="session-log" open={s.n === j.sessions.length}>
              <summary><b className="display">Session {s.n}</b> <span className="tiny muted">{new Date(s.startedAt).toLocaleDateString()}</span></summary>
              {s.recap && <div className="recap story">“{s.recap}”</div>}
              {s.logEntry ? <Markdown text={s.logEntry} /> : <div className="tiny muted">{s.endedAt ? 'No log was written.' : 'In progress…'}</div>}
              {s.partyState && <details><summary className="small">Party state at the end</summary><Markdown text={s.partyState} /></details>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function Party() {
  const view = useStore((s) => s.view);
  return (
    <div className="col">
      {view.party.map((p) => {
        const m = view.members.find((x) => x.userId === p.userId);
        return (
          <div key={p.id} className="party-card">
            <Avatar size="lg" name={p.name} color={p.color} img={p.portrait} />
            <div className="grow">
              <b>{p.name}</b> <span className={`dot ${m?.online ? 'on' : ''}`} />
              <div className="tiny muted">L{p.level} {titleIndex(p.subrace || p.race)} {titleIndex(p.class)} · {p.playerName}{m?.away ? ' (away)' : ''}</div>
              <div className="row small" style={{ gap: 8 }}><span>❤ {p.hp.current}/{p.hp.max}</span><span>🛡 {p.ac}</span><span>👁 {p.passivePerception}</span></div>
              {p.conditions.length > 0 && <div className="row wrap" style={{ gap: 4 }}>{p.conditions.map((c) => <span key={c} className="pill red">{c}</span>)}</div>}
            </div>
          </div>
        );
      })}
      <div className="sub-h">Players</div>
      {view.members.map((m) => (
        <div key={m.userId} className="row small"><span className={`dot ${m.online ? 'on' : ''}`} /> <b style={{ color: m.color }}>{m.displayName}</b> <span className="muted">{m.role === 'owner' ? 'host' : ''}{m.characterId ? '' : ' · no character'}</span></div>
      ))}
      <div className="tiny muted" style={{ marginTop: 8 }}>Invite code: <b className="kbd">{view.campaign.inviteCode}</b></div>
    </div>
  );
}

function Rules() {
  const srd = useStore((s) => s.srd);
  return (
    <div className="col">
      <div className="sub-h">On your turn</div>
      <ul className="small rules-list">
        <li><b>Move</b> up to your speed (drag your token). Difficult terrain costs double. You can split movement around your action.</li>
        <li><b>Action:</b> attack, cast a spell, Dash, Dodge, Disengage, Help, Hide, or anything creative ("Ask the DM").</li>
        <li><b>Bonus action</b> only if a feature or spell says so. One <b>reaction</b> per round.</li>
        <li><b>Advantage:</b> roll two d20, keep the higher. Disadvantage: keep the lower. They cancel out.</li>
        <li>A natural 20 on an attack is a critical hit (double the damage dice). A natural 1 always misses.</li>
        <li>At 0 HP you fall unconscious and make <b>death saves</b> (10+ succeeds; three of either decides your fate).</li>
        <li><b>Concentration:</b> one concentration spell at a time; taking damage forces a CON save (DC 10 or half the damage).</li>
      </ul>
      <div className="sub-h">Conditions</div>
      {(srd?.conditions || []).map((c) => (
        <details key={c.index} className="feature"><summary><b>{c.name}</b></summary><Markdown text={c.desc} className="prose small-prose" /></details>
      ))}
      <div className="tiny faint" style={{ marginTop: 10 }}>Rules text from the System Reference Document 5.1 by Wizards of the Coast LLC, licensed under CC-BY-4.0.</div>
    </div>
  );
}
