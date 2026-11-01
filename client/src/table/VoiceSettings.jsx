import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { Modal } from '../components/Toasts.jsx';
import { availableVoices, previewVoice, ttsSupported } from '../lib/tts.js';

export default function VoiceSettings({ onClose, onSounds }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const [voices, setVoices] = useState(availableVoices());
  useEffect(() => { const t = setTimeout(() => setVoices(availableVoices()), 400); return () => clearTimeout(t); }, []);
  const natural = voices.filter((v) => /natural|neural|online/i.test(v.name)).length;
  return (
    <Modal title="Voices & sound" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        {!ttsSupported() && <div className="error-text">This browser can't read aloud.</div>}
        <div className="small muted">The narrator and every NPC are read aloud with your browser's built-in voices. {natural ? `You have ${natural} natural-sounding voices.` : 'For the best voices, open Roleplay20 in Microsoft Edge (it has dozens of natural voices) or Chrome.'}</div>
        <label className="check"><input type="checkbox" checked={prefs.readAloud !== false} onChange={(e) => setPrefs({ readAloud: e.target.checked })} /> Read the story aloud</label>
        <label className="field"><span>Who can hear this device?</span>
          <div className="tabs"><button className={prefs.alone !== false ? 'on' : ''} onClick={() => setPrefs({ alone: true })}>🎧 Just me</button><button className={prefs.alone === false ? 'on' : ''} onClick={() => setPrefs({ alone: false })}>👥 Others are here</button></div>
          <div className="tiny muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>{prefs.alone !== false ? 'Everything is read aloud, including private moments and things only you can see.' : "Only what the whole table knows is read aloud. Anything private or marked 'only you' stays on your screen, silently."}</div>
        </label>
        <label className="field"><span>What to read</span>
          <div className="tabs"><button className={prefs.readMode !== 'dialogue' ? 'on' : ''} onClick={() => setPrefs({ readMode: 'all' })}>Narration + dialogue</button><button className={prefs.readMode === 'dialogue' ? 'on' : ''} onClick={() => setPrefs({ readMode: 'dialogue' })}>NPC dialogue only</button></div>
        </label>
        <label className="field"><span>Narrator voice</span>
          <div className="row">
            <select className="select" value={prefs.narratorVoice || ''} onChange={(e) => setPrefs({ narratorVoice: e.target.value })}>
              <option value="">Automatic (deep British storyteller)</option>
              {voices.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{v.name} ({v.lang})</option>)}
            </select>
            <button className="btn sm" onClick={() => previewVoice({}, 'narrator', 'The torchlight trembles as the door groans open. Something waits in the dark.', prefs)}>Hear</button>
          </div>
        </label>
        <label className="field"><span>Speaking speed ({(prefs.rate || 1).toFixed(2)}×)</span>
          <input type="range" min="0.7" max="1.4" step="0.05" value={prefs.rate || 1} onChange={(e) => setPrefs({ rate: Number(e.target.value) })} />
        </label>
        <label className="check"><input type="checkbox" checked={prefs.sounds !== false} onChange={(e) => onSounds(e.target.checked)} /> Sound effects (dice, turn chime)</label>
      </div>
    </Modal>
  );
}
