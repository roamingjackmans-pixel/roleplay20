import React, { useEffect, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI, tableStatus } from './ui.js';
import { Avatar } from '../lib/format.jsx';
import { useDictation, appendWords } from '../lib/dictation.js';

/** This campaign's unsent drafts (kept when you switch between "Your action" and "Table talk"). */
function useDraft() {
  const cid = useStore((s) => s.view?.campaign?.id);
  const draft = useUI((s) => s.drafts[cid]) || {};
  const setDraft = (patch) => useUI.getState().setDraft(cid, patch);
  return [draft, setDraft];
}

/** Voice typing: press to talk, press again to stop. Spoken words are added to the box; nothing is sent. */
function MicButton({ dict, small }) {
  if (!dict.supported) return null;
  return (
    <button type="button" className={`btn ${small ? 'sm' : ''} mic-btn ${dict.listening ? 'listening' : ''}`} onClick={dict.toggle}
      title={dict.listening ? 'Stop voice typing (everything else on this device is silent until you do)' : 'Voice typing: speak and your words appear in the box. While you speak, the read-aloud voice, the other players and sound effects go quiet on this device.'} aria-pressed={dict.listening}>
      {dict.listening ? '● Stop' : '🎤'}
    </button>
  );
}

export default function Composer() {
  const view = useStore((s) => s.view);
  const [draft] = useDraft();
  const [tab, setTab] = useState('act');
  const myChar = view.myCharacter;
  const inCombat = !!view.combat;
  useEffect(() => { if (inCombat) setTab((t) => (t === 'dm' ? t : 'chat')); else setTab((t) => (t === 'dm' ? t : 'act')); }, [inCombat]);
  const dmState = useDmChatState();
  return (
    <div className="composer">
      <RollRequests />
      <div className="composer-tabs">
        <button className={tab === 'act' ? 'on' : ''} onClick={() => setTab('act')} disabled={!myChar}>{inCombat ? '⚔ Combat' : '✒ Your action'}{tab !== 'act' && !inCombat && draft.action?.trim() ? <i className="draft-dot" title="Unsent action" /> : null}</button>
        <button className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>💬 Table talk{tab !== 'chat' && draft.chat?.trim() ? <i className="draft-dot" title="Unsent message" /> : null}</button>
        <button className={tab === 'dm' ? 'on' : ''} onClick={() => setTab('dm')} title="Ask the DM something privately: only you see the question and the answer">
          🧙 DM chat{tab !== 'dm' && (draft.dm?.trim() || dmState.unread) ? <i className={`draft-dot ${dmState.unread ? 'reply' : ''}`} title={dmState.unread ? 'The DM answered' : 'Unsent question'} /> : null}
        </button>
      </div>
      {tab === 'act' ? (inCombat ? <CombatHint /> : <ActionBox />) : tab === 'dm' ? <DmChatBox state={dmState} /> : <ChatBox />}
    </div>
  );
}

/** Your private chat with the DM, from the log: whether an answer is on its way, and whether one came in unseen. */
function useDmChatState() {
  const log = useStore((s) => s.log);
  const me = useStore((s) => s.view?.me?.userId);
  const mine = log.filter((e) => e.kind === 'dmchat');
  const lastQ = [...mine].reverse().find((e) => e.role === 'player' && e.userId === me);
  const waiting = !!lastQ && !mine.some((e) => e.role === 'dm' && e.replyTo === lastQ.id);
  const lastA = [...mine].reverse().find((e) => e.role === 'dm');
  const [seen, setSeen] = useState(null);
  return { waiting, lastQ, lastA, unread: !!lastA && lastA.recvAt && lastA.id !== seen, markSeen: () => lastA && setSeen(lastA.id) };
}

/** DM chat: ask the DM privately. It doesn't use your turn; the question and the answer show in the story for you only. */
function DmChatBox({ state }) {
  const view = useStore((s) => s.view);
  const [draft, setDraft] = useDraft();
  const t = draft.dm || '';
  const [busy, setBusy] = useState(false);
  const dict = useDictation((words) => setDraft({ dm: appendWords(useUI.getState().drafts[view.campaign.id]?.dm, words) }));
  useEffect(() => { state.markSeen(); }, [state.lastA?.id]); // eslint-disable-line
  const send = async () => {
    if (!t.trim() || busy || state.waiting) return;
    dict.stop();
    setBusy(true);
    const r = await emit('dm:ask', { text: t });
    setBusy(false);
    if (r?.ok) setDraft({ dm: '' });
  };
  return (
    <div className="composer-body col" style={{ gap: 6 }}>
      <div className="row">
        <input className="input" value={t} onChange={(e) => setDraft({ dm: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder="Ask the DM privately (a rule, your character, what you know…)" />
        <MicButton dict={dict} small />
        <button className="btn sm" disabled={!t.trim() || busy || state.waiting} onClick={send}>Ask</button>
      </div>
      {dict.listening && <div className="dictating small">🎤 Listening… {dict.interim ? <i>{dict.interim}</i> : <span className="muted">speak now</span>}</div>}
      <div className="tiny muted">{state.waiting ? '🧙 The DM is thinking about your question…' : 'Only you see this chat, and it never uses your turn. To do something, use Your action.'}</div>
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
  const [draft, setDraft] = useDraft();
  const text = draft.action || '';
  const priv = !!draft.priv;
  const setText = (v) => setDraft({ action: v });
  const setPriv = (v) => setDraft({ priv: v });
  const [busy, setBusy] = useState(false);
  const dict = useDictation((words) => setDraft({ action: appendWords(useUI.getState().drafts[view.campaign.id]?.action, words) }));
  const me = view.me;
  const phase = view.phase;
  const mine = view.round.myAction;
  // the DM asked this player to fit their action into one turn: bring their words back to edit
  const rev = view.round.myRevision;
  useEffect(() => { if (rev) setDraft({ action: rev.text || '', priv: !!rev.private }); }, [rev?.question]); // eslint-disable-line
  const isOwner = me.role === 'owner';
  const name = view.myCharacter?.name?.split(' ')[0] || 'your character';
  // a directed question or one-on-one conversation waits only for the player(s) the DM asked
  const asked = view.round.waitFor || [];
  const askedNames = asked.map((u) => view.party.find((p) => p.userId === u)?.name?.split(' ')[0]).filter(Boolean);
  const waitingOn = (asked.length ? view.members.filter((m) => asked.includes(m.userId)) : view.members.filter((m) => m.required && !view.party.find((p) => p.userId === m.userId)?.dead)).filter((m) => !m.submitted);

  const st = tableStatus(view);
  if (!view.myCharacter) {
    return (
      <div className="composer-body muted small row wrap" style={{ gap: 10 }}>
        <span>{view.me && view.members.find((m) => m.userId === view.me.userId)?.rebuilding ? 'Make your new character to join the story. You can still watch and chat.' : 'Create a character to take part. You can still watch and chat.'}</span>
        <button className="btn primary sm" onClick={() => useStore.getState().go(`#/c/${view.campaign.id}/create`)}>✦ Make your character</button>
      </div>
    );
  }
  if (view.myCharacter.dead) return <div className="composer-body muted small">💀 {view.myCharacter.name} has died. Open your character sheet to lay them to rest and make a new character. You can still watch and chat.</div>;
  const host = view.me.role === 'owner';
  if (!view.campaign.sessionActive) return <div className="composer-body muted small">{st.allHere ? `Everyone is here. Press "▶ ${view.campaign.sessionNumber ? `Begin session ${view.campaign.sessionNumber + 1}` : 'Begin the adventure'}" (top right) to start.` : `The session begins when everyone is at the table. Waiting for ${st.names}.${host ? ' As the host you can begin without them.' : ' The host can also begin without them.'}`}</div>;
  if (st.paused) return <div className="composer-body muted small">⏸ Waiting for {st.names} to join the table. Nobody can act until everyone is here{host ? ', or you carry on without them (above the story).' : ', or the host carries on without them.'}</div>;
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

  if (mine?.watch) {
    // "Just watch": ready for this round without doing anything; unticking it goes back to writing an action
    return (
      <div className="composer-body col">
        <div className="submitted">
          <div className="story">👀 {name} is just watching this round.</div>
          <div className="tiny muted">You're ready. The DM won't have {name} do anything or ask you anything. Untick "Just watch" to act after all.</div>
        </div>
        <div className="row">
          <label className="check small" title="Untick to write an action instead"><input type="checkbox" checked onChange={() => emit('action:withdraw')} /> 👀 Just watch</label>
          <ReadyRow view={view} />
        </div>
        {waitingOn.length > 0 && isOwner && <button className="btn xs ghost" onClick={() => emit('force')}>Continue without {waitingOn.map((m) => m.displayName).join(', ')}</button>}
      </div>
    );
  }

  if (mine) {
    return (
      <div className="composer-body col">
        <div className="submitted">
          <div className="tiny muted">You declared{mine.private ? ' (privately)' : ''}:</div>
          <div className="story">{mine.text}</div>
          {mine.private && <div className="tiny muted">Everyone else sees 👀 by your name, the same as Just watch, so nobody can tell you're up to something.</div>}
        </div>
        <div className="row">
          <ReadyRow view={view} />
          <div className="spacer" />
          <button className="btn xs ghost" onClick={() => { setDraft({ action: mine.text, priv: !!mine.private }); emit('action:withdraw'); }}>Change</button>
        </div>
        {waitingOn.length > 0 && isOwner && <button className="btn xs ghost" onClick={() => emit('force')}>Continue without {waitingOn.map((m) => m.displayName).join(', ')}</button>}
      </div>
    );
  }

  async function submit() {
    if (!text.trim()) return;
    dict.stop();
    setBusy(true);
    const r = await emit('action', { text, private: priv });
    if (r.ok) setDraft({ action: '', priv: false });
    setBusy(false);
  }
  // ready up without doing anything: whatever is in the box stays there for later
  async function watch() {
    dict.stop();
    setBusy(true);
    await emit('action', { watch: true });
    setBusy(false);
  }
  return (
    <div className="composer-body col">
      {asked.length > 0 && !rev && (
        <div className={`asked-note ${asked.includes(me.userId) ? 'mine' : ''}`}>
          {asked.includes(me.userId)
            ? <b>💬 The DM is waiting for your answer.</b>
            : <span>💬 The DM is waiting for {askedNames.join(' and ')} to answer and carries on as soon as {askedNames.length > 1 ? 'they reply' : 'they do'}. You can still add something {name} does.</span>}
        </div>
      )}
      {rev && (
        <div className="revise-note">
          <b>🎲 The DM asks you <span className="tiny muted">(only you can see this)</span></b>
          <div className="story">{rev.question}</div>
          <span className="tiny muted">Change your action below and press Ready. Everyone else's actions are waiting for yours.</span>
        </div>
      )}
      <textarea className="textarea action-input" value={text} onChange={(e) => setText(e.target.value)} placeholder={`What does ${name} do? Say it, try it, ask it…${dict.supported ? ' (or press 🎤 and speak)' : ''}`} onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit(); }} rows={3} />
      {dict.listening && <div className="dictating small">🎤 Listening… {dict.interim ? <i>{dict.interim}</i> : <span className="muted">speak now</span>}</div>}
      <div className="row wrap action-opts">
        <MicButton dict={dict} small />
        <label className="check small" title="Only you and the DM see this action. Use it for things your character can do unnoticed; everyone else sees what's outwardly visible. Until the DM answers, the others see 👀 by your name, the same as Just watch."><input type="checkbox" checked={priv} onChange={(e) => setPriv(e.target.checked)} /> Private</label>
        <label className="check small" title={`Ready up without doing anything: ${name} just watches and listens this round. The DM won't ask you anything.`}><input type="checkbox" checked={false} disabled={busy} onChange={(e) => e.target.checked && watch()} /> 👀 Just watch</label>
        <ReadyRow view={view} />
        <div className="spacer" />
        <button className="btn primary" disabled={busy || !text.trim()} onClick={submit}>{rev ? 'Send revised action ✓' : 'Ready ✓'}</button>
      </div>
    </div>
  );
}

function ReadyRow({ view }) {
  const asked = view.round.waitFor || [];
  const req = view.members.filter((m) => (asked.length ? asked.includes(m.userId) : m.required) || m.submitted);
  return (
    <div className="ready-row" title="Who has declared an action">
      {req.map((m) => {
        const p = view.party.find((x) => x.userId === m.userId);
        // 👀 is "Just watch" or a Private action: the table can't tell which
        const mePrivate = m.userId === view.me.userId && view.round.myAction?.private;
        const how = m.watching ? 'watching, or doing something private' : mePrivate ? 'ready (others see 👀)' : m.submitted ? 'ready' : 'thinking…';
        return <span key={m.userId} className={`ready-av ${m.submitted ? 'done' : ''} ${m.watching ? 'watching' : ''}`}><Avatar name={p?.name || m.displayName} color={p?.color || m.color} img={p?.portrait} title={`${m.displayName}: ${how}`} />{m.watching && <i className="ready-eye" aria-label="watching, or doing something private">👀</i>}</span>;
      })}
      <span className="tiny muted">{view.round.submittedCount}/{Math.max(view.round.requiredCount, view.round.submittedCount)} ready</span>
    </div>
  );
}

function ChatBox() {
  const view = useStore((s) => s.view);
  const [draft, setDraft] = useDraft();
  const t = draft.chat || '';
  // to everyone, or privately to one other player who is at the table right now
  const others = view.members.filter((m) => m.userId !== view.me.userId && m.online);
  const toId = others.some((m) => m.userId === draft.chatTo) ? draft.chatTo : '';
  const to = others.find((m) => m.userId === toId);
  const nameOf = (m) => { const ch = view.party.find((p) => p.userId === m.userId); return ch ? `${m.displayName} (${ch.name.split(' ')[0]})` : m.displayName; };
  const dict = useDictation((words) => setDraft({ chat: appendWords(useUI.getState().drafts[view.campaign.id]?.chat, words) }));
  const send = async () => {
    if (!t.trim()) return;
    dict.stop();
    const r = await emit('chat', { text: t, to: toId || undefined });
    if (!r?.error) setDraft({ chat: '' });
  };
  return (
    <div className="composer-body col" style={{ gap: 6 }}>
      <div className="row">
        <select className="select chat-to" value={toId} onChange={(e) => setDraft({ chatTo: e.target.value })} title="Send to everyone, or privately to one player who is here">
          <option value="">To everyone</option>
          {others.map((m) => <option key={m.userId} value={m.userId}>To {nameOf(m)} only</option>)}
        </select>
      </div>
      <div className="row">
        <input className="input" value={t} onChange={(e) => setDraft({ chat: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && send()} placeholder={to ? `Private message to ${to.displayName} (only you two see it)` : 'Out-of-character chat (the DM ignores this)'} />
        <MicButton dict={dict} small />
        <button className="btn sm" disabled={!t.trim()} onClick={send}>Send</button>
      </div>
      {dict.listening && <div className="dictating small">🎤 Listening… {dict.interim ? <i>{dict.interim}</i> : <span className="muted">speak now</span>}</div>}
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

// how the DM wants a roll made: shown on the card, never changeable by the player
const ROLL_MODES = {
  adv: { label: 'Advantage', cls: 'green', how: 'roll two d20 and keep the higher', manual: 'Roll two d20s and type the higher one' },
  dis: { label: 'Disadvantage', cls: 'red', how: 'roll two d20 and keep the lower', manual: 'Roll two d20s and type the lower one' },
  none: { label: 'Normal roll', cls: '', how: 'roll one d20', manual: 'Type the number your real d20 shows' },
};

export function RollModeBadge({ r }) {
  const mode = ROLL_MODES[r.mode] ? r.mode : ROLL_MODES[r.advantage] ? r.advantage : 'none';
  const m = ROLL_MODES[mode];
  const why = r.modeWhy?.length ? r.modeWhy.join(', ') : '';
  // conditions can change (or cancel) what the DM asked for: say why
  const note = why ? (mode === 'none' && r.advantage !== 'none' ? ` (${r.advantage === 'adv' ? 'advantage' : 'disadvantage'} cancelled out by ${why})` : ` (${why})`) : '';
  const title = `${m.label}: ${m.how}${note}. The DM decides this; it can't be changed here.`;
  return <span className={`pill roll-mode ${m.cls}`} title={title} aria-label={title}>{mode === 'adv' ? '▲ ' : mode === 'dis' ? '▼ ' : ''}{m.label}{note && <span className="tiny"> {note.trim()}</span>}</span>;
}

function RollRequestCard({ r, locked = false }) {
  const [n, setN] = useState('');
  const [busy, setBusy] = useState(false);
  // "custom" rolls are plain dice like 1d4+3 (healing, damage): the player types their total, not a d20
  const isDice = r.kind === 'custom' || r.kind === 'damage';
  const label = r.kind === 'death' ? 'Death saving throw' : r.kind === 'initiative' ? 'Initiative' : r.kind === 'skill' ? `${titleSkill(r.key)} check` : r.kind === 'save' ? `${r.key.toUpperCase()} saving throw` : r.kind === 'ability' ? `${r.key.toUpperCase()} check` : r.label || (isDice ? `Roll ${r.key}` : 'Roll');
  const valid = isDice ? Number(n) >= 1 : Number(n) >= 1 && Number(n) <= 20;
  async function go(mode) {
    setBusy(true);
    const manual = mode === 'manual';
    await emit('roll:respond', { requestId: r.id, mode, natural: manual && !isDice ? Number(n) : undefined, total: manual && isDice ? Number(n) : undefined });
    setBusy(false);
  }
  return (
    <div className="roll-req fade-in">
      <div className="rr-head"><span className="rr-die">🎲</span><div className="grow"><b>{label}</b>{r.dc ? <span className="pill">DC {r.dc}</span> : null}{r.kind !== 'death' && !isDice && <RollModeBadge r={r} />}<div className="small story">{r.reason}</div>{r.contestWith?.length > 0 && <div className="contest-note tiny">⚔ Contest against {r.contestWith.join(' and ')}: the higher total wins, and the story tells you who.</div>}</div></div>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn primary sm" disabled={busy || locked} onClick={() => go('auto')}>Roll for me</button>
        <span className="tiny muted">or</span>
        <input className="input rr-input" inputMode="numeric" disabled={locked} placeholder={isDice ? 'total' : 'd20'} value={n} onChange={(e) => setN(e.target.value.replace(/[^0-9]/g, '').slice(0, isDice ? 3 : 2))} onKeyDown={(e) => e.key === 'Enter' && valid && !locked && go('manual')} title={isDice ? `Roll ${r.key} with your own dice and type the total` : `${(ROLL_MODES[r.mode] || ROLL_MODES.none).manual} (the app adds your modifier)`} />
        <button className="btn sm" disabled={busy || !valid || locked} onClick={() => go('manual')}>I rolled it</button>
        {locked && <span className="tiny muted">Waiting for everyone to be at the table.</span>}
      </div>
    </div>
  );
}

function titleSkill(k) {
  return String(k || '').replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
}
