import React, { useEffect, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from './ui.js';
import { Splash } from '../App.jsx';
import { Avatar, D20Icon } from '../lib/format.jsx';
import { stopSpeaking, onSpeaking } from '../lib/tts.js';
import { setSoundsEnabled } from '../lib/sound.js';
import MapStage from './MapStage.jsx';
import StoryFeed from './StoryFeed.jsx';
import Composer from './Composer.jsx';
import SidePanel from './SidePanel.jsx';
import { InitiativeBar, TurnPanel } from './TurnPanel.jsx';
import { DiceOverlay, RollPromptModal, DiceTray } from './Dice.jsx';
import MapViewer from './MapViewer.jsx';
import DMScreen from './DMScreen.jsx';
import VoiceSettings from './VoiceSettings.jsx';

export default function GameTable({ id }) {
  const { view, joining, joinCampaign, leaveCampaign, connected } = useStore();
  const srd = useStore((s) => s.srd);
  useEffect(() => { joinCampaign(id); return () => { leaveCampaign(); stopSpeaking(); }; }, [id]); // eslint-disable-line
  if (!view || !srd) return <Splash text={joining ? 'Pulling up a chair at the table…' : 'Connecting…'} />;
  return (
    <div className={`table-root ${view.combat ? 'in-combat' : ''}`}>
      <TopBar />
      <div className="table-body">
        <SidePanel />
        <main className="stage">
          {view.combat && <InitiativeBar />}
          <MapStage />
          {view.combat && <TurnPanel />}
          <DiceTray />
        </main>
        <aside className="story-col">
          <StoryFeed />
          <Composer />
        </aside>
      </div>
      {!connected && <div className="offline-banner">Reconnecting to the table…</div>}
      <DiceOverlay />
      <RollPromptModal />
      <MapViewer />
      <DMScreen />
    </div>
  );
}

function TopBar() {
  const view = useStore((s) => s.view);
  const go = useStore((s) => s.go);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const ui = useUI();
  const [speaking, setSpeaking] = useState(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  useEffect(() => onSpeaking(setSpeaking), []);
  const isOwner = view.me.role === 'owner';
  const sc = view.scene;
  return (
    <header className="table-top">
      <button className="btn ghost icon" title="Back to campaign" onClick={() => go(`#/c/${view.campaign.id}`)}>←</button>
      <button className="btn ghost icon" title="Documents panel" onClick={ui.togglePanel}>☰</button>
      <div className="table-title">
        <div className="tt-name"><D20Icon size={16} /> {view.campaign.title || view.campaign.name}</div>
        <div className="tt-scene">{[sc.location, sc.timeOfDay, sc.weather].filter(Boolean).join(' · ') || (view.campaign.sessionActive ? 'The story begins…' : 'Between sessions')}</div>
      </div>
      <div className="party-pills">
        {view.party.map((p) => {
          const pct = Math.max(0, Math.min(100, (p.hp.current / Math.max(1, p.hp.max)) * 100));
          const m = view.members.find((x) => x.userId === p.userId);
          return (
            <button key={p.id} className={`party-pill ${p.hp.current === 0 ? 'down' : ''}`} title={`${p.name} (${p.playerName}) ${p.hp.current}/${p.hp.max} HP · AC ${p.ac}`} onClick={() => ui.set({ selectedTokenId: null, focusCharacterId: p.id, mapTab: 'tactical' })}>
              <Avatar name={p.name} color={p.color} img={p.portrait} />
              <span className="pp-meta"><b>{p.name.split(' ')[0]}</b><i className="pp-hp"><em style={{ width: `${pct}%`, background: pct > 50 ? 'var(--green)' : pct > 25 ? 'var(--gold)' : 'var(--red)' }} /></i></span>
              <span className={`dot ${m?.online ? 'on' : ''} ${m?.submitted ? 'ready' : ''}`} />
            </button>
          );
        })}
      </div>
      <div className="spacer" />
      {speaking && <button className="btn sm speaking" onClick={stopSpeaking} title="Stop reading">🔊 <span className="small">stop</span></button>}
      <button className={`btn icon ${prefs.readAloud !== false ? 'active' : ''}`} title={prefs.readAloud !== false ? 'Read-aloud is on' : 'Read-aloud is off'} onClick={() => { const on = prefs.readAloud === false; setPrefs({ readAloud: on }); if (!on) stopSpeaking(); }}>{prefs.readAloud !== false ? '🔊' : '🔇'}</button>
      <button className="btn icon" title="Voices & sound" onClick={() => setVoiceOpen(true)}>⚙</button>
      {isOwner && <button className="btn sm" onClick={() => ui.set({ dmOpen: true })}>🎭 DM Screen</button>}
      {isOwner && !view.campaign.sessionActive && <button className="btn primary sm" onClick={() => emit('session:start')}>▶ {view.campaign.sessionNumber ? `Start session ${view.campaign.sessionNumber + 1}` : 'Begin the adventure'}</button>}
      {isOwner && view.campaign.sessionActive && !view.combat && <button className="btn sm" onClick={() => { if (confirm('End this session? The DM will write up the session log.')) emit('session:end'); }}>⏹ End session</button>}
      {voiceOpen && <VoiceSettings onClose={() => setVoiceOpen(false)} onSounds={(v) => { setPrefs({ sounds: v }); setSoundsEnabled(v); }} />}
    </header>
  );
}
