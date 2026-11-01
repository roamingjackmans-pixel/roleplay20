import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { speakEntry, stopSpeaking, onSpeaking } from '../lib/tts.js';
import { inline } from '../lib/format.jsx';

export default function StoryFeed() {
  const log = useStore((s) => s.log);
  const view = useStore((s) => s.view);
  const ref = useRef(null);
  const [stick, setStick] = useState(true);
  const [speakingId, setSpeakingId] = useState(null);
  useEffect(() => onSpeaking((u) => setSpeakingId(u?.entryId || null)), []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (el && stick) el.scrollTop = el.scrollHeight;
  }, [log.length, stick, view?.thinking]);

  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setStick(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  return (
    <div className="feed" ref={ref} onScroll={onScroll}>
      {log.length === 0 && <div className="empty">The story hasn't started yet.{view.me.role === 'owner' ? ' Press "Begin the adventure" when your friends are here.' : ' Waiting for the host to begin.'}</div>}
      {log.map((e) => <Entry key={e.id} e={e} view={view} speaking={speakingId === e.id} />)}
      {view.thinking && <Thinking t={view.thinking} />}
      {!stick && <button className="btn sm jump-latest" onClick={() => setStick(true)}>↓ Latest</button>}
    </div>
  );
}

function Thinking({ t }) {
  const [s, setS] = useState(0);
  useEffect(() => { const i = setInterval(() => setS(Math.floor((Date.now() - t.since) / 1000)), 500); return () => clearInterval(i); }, [t.since]);
  return (
    <div className="entry thinking fade-in">
      <div className="quill">✒️</div>
      <div><div className="story">{t.label}</div><div className="tiny faint">{s}s</div></div>
    </div>
  );
}

function Entry({ e, view, speaking }) {
  const prefs = useStore((st) => st.prefs);
  const priv = Array.isArray(e.to);
  switch (e.kind) {
    case 'narration': {
      const voices = view.voices || {};
      return (
        <div className={`entry narration fade-in ${priv ? 'private' : ''} ${e.enemy ? 'enemy' : ''} ${speaking ? 'speaking' : ''}`}>
          {priv && <div className="private-tag">{e.to.length === 1 && e.to[0] === view.me.userId ? 'only you' : 'private'}</div>}
          {e.parts.map((p, i) => {
            if (p.speaker === 'narrator') return <p key={i} className="narr">{inline(p.text, i)}</p>;
            const v = voices[p.speaker];
            const name = v?.name || p.speakerName || 'Someone';
            const sound = /^\*[^*]+\*$/.test(p.text.trim());
            if (sound) return <div key={i} className="dialogue sound" style={{ '--npc': v?.color || '#a05050' }}><div className="speaker">{name}</div><div className="line">{p.text.trim().slice(1, -1)}</div></div>;
            return (
              <div key={i} className="dialogue" style={{ '--npc': v?.color || '#c9a35c' }}>
                <div className="speaker">{name}{v?.voice?.style ? <span className="voice-hint">{v.voice.style}</span> : null}</div>
                <div className="line">“{inline(p.text.replace(/^["“]|["”]$/g, ''), i)}”</div>
              </div>
            );
          })}
          <button className="replay" title="Read aloud" onClick={() => { stopSpeaking(); speakEntry(e, view.voices || {}, { ...prefs, readAloud: true }); }}>🔊</button>
        </div>
      );
    }
    case 'dice': {
      const r = e.result || {};
      const tone = e.tone || (r.isCrit || r.natural === 20 ? 'crit' : r.isFumble || r.natural === 1 ? 'miss' : '');
      return (
        <div className={`entry dice fade-in ${tone} ${priv ? 'private' : ''}`}>
          <div className="die-badge" data-n={r.natural ?? ''}>{r.total ?? '?'}</div>
          <div className="grow">
            <div className="dice-label"><b>{e.name}</b> · {e.label}{e.advantage && e.advantage !== 'none' ? <span className={`pill ${e.advantage === 'adv' ? 'green' : 'red'}`}>{e.advantage === 'adv' ? 'advantage' : 'disadvantage'}</span> : null}{r.manual ? <span className="pill" title="Rolled with real dice">✍ table roll</span> : null}</div>
            <div className="tiny muted dice-text">{r.text}</div>
          </div>
          {e.outcome && <div className={`outcome ${tone}`}>{e.outcome}</div>}
          {e.success != null && e.dc ? <div className={`outcome ${e.success ? 'hit' : 'miss'}`}>{e.success ? 'Success' : 'Fail'} <span className="tiny">DC {e.dc}</span></div> : null}
        </div>
      );
    }
    case 'action':
      return (
        <div className={`entry action fade-in ${priv ? 'private' : ''}`} style={{ '--pc': view.party.find((p) => p.id === e.characterId)?.color || '#888' }}>
          <div className="speaker">{e.name}{e.private ? <span className="private-tag inline">private to the DM</span> : null}</div>
          <div className="line">{e.text}</div>
        </div>
      );
    case 'chat':
      return <div className="entry chat fade-in"><b style={{ color: e.color }}>{e.name}</b> <span className="tiny faint">(table talk)</span> {e.text}</div>;
    case 'roll_request':
      return <div className="entry sys fade-in">🎲 The DM asks <b>{e.characterName}</b> for a <b>{e.label}</b>{e.reason ? <span className="muted"> - {e.reason}</span> : null}</div>;
    case 'session':
      return <div className="entry session fade-in"><span>Session {e.n}</span></div>;
    case 'session_end':
      return <div className="entry session end fade-in"><span>{e.text}</span></div>;
    case 'turn':
      return <div className="entry turn fade-in">{e.text}</div>;
    case 'combat':
      return <div className={`entry combat fade-in ${e.tone || ''}`}>{e.text}</div>;
    case 'cast':
      return <div className="entry cast fade-in">{e.text}</div>;
    default:
      return <div className={`entry sys fade-in ${e.tone || ''} ${priv ? 'private' : ''}`}>{inline(e.text || '', 0)}</div>;
  }
}
