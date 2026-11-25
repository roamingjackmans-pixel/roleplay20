import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { Modal } from '../components/Toasts.jsx';
import { availableVoices, previewVoice, ttsSupported, naturalVoiceCount } from '../lib/tts.js';
import AccountSettings from '../screens/AccountSettings.jsx';
import {
  useAudioDevices, refreshDevices, allowDeviceNames, chooseMic, chooseSpeaker, openMic, outputPickSupported, inputPickSupported,
} from '../lib/audioDevices.js';
import { testSpeaker } from '../lib/sound.js';

const HINT = { textTransform: 'none', letterSpacing: 0, fontWeight: 400 };

/** Speaker and microphone for this browser: e.g. Bluetooth headphones for the sound, the computer's own mic for your voice. */
function DeviceSettings() {
  const d = useAudioDevices();
  const [testing, setTesting] = useState(false);
  const [levelPct, setLevelPct] = useState(0);
  const [micError, setMicError] = useState('');
  const stopTest = useRef(null);
  useEffect(() => { refreshDevices(); return () => stopTest.current?.(); }, []);
  const savedMic = d.saved.mic?.label;
  const savedSpeaker = d.saved.speaker?.label;

  async function testMic() {
    if (testing) { stopTest.current?.(); return; }
    setMicError('');
    let stream;
    try { stream = await openMic(); } catch { setMicError('The microphone is blocked. Allow it for this site (the icon in the address bar), then try again.'); return; }
    refreshDevices(); // names show up once the mic is allowed
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const an = ctx.createAnalyser();
    an.fftSize = 512;
    ctx.createMediaStreamSource(stream).connect(an);
    const buf = new Uint8Array(an.fftSize);
    setTesting(true);
    const iv = setInterval(() => {
      an.getByteTimeDomainData(buf);
      let sum = 0;
      for (const v of buf) sum += ((v - 128) / 128) ** 2;
      setLevelPct(Math.min(100, Math.round(Math.sqrt(sum / buf.length) * 400)));
    }, 80);
    const end = setTimeout(() => stopTest.current?.(), 8000);
    stopTest.current = () => {
      clearInterval(iv); clearTimeout(end);
      for (const t of stream.getTracks()) t.stop();
      ctx.close().catch(() => {});
      stopTest.current = null;
      setTesting(false); setLevelPct(0);
    };
  }

  if (!inputPickSupported && !outputPickSupported) return null;
  return (
    <div className="col device-settings" style={{ gap: 10 }}>
      <div className="sub-h">Speaker and microphone</div>
      {!d.named && (
        <div className="row small">
          <span className="grow muted">Your browser shows device names once the microphone is allowed for this site.</span>
          <button className="btn sm" onClick={allowDeviceNames}>Show names</button>
        </div>
      )}
      {outputPickSupported ? (
        <label className="field"><span>Speaker (sound effects and voice chat)</span>
          <div className="row">
            <select className="select" value={d.saved.speaker?.id && !d.speakerMissing ? d.speakerId : ''} onChange={(e) => chooseSpeaker(e.target.value)} aria-label="Speaker">
              <option value="">Computer's default</option>
              {d.outputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button className="btn sm" onClick={testSpeaker}>🔊 Test</button>
          </div>
          {d.speakerMissing && <div className="tiny warn-text" style={HINT}>{savedSpeaker || 'Your speaker'} isn't connected, so the default is playing. It switches back by itself when it's connected.</div>}
        </label>
      ) : (
        <div className="tiny muted">This browser always plays sound on your computer's default speaker. Chrome, Edge or Firefox can pick another one here.</div>
      )}
      {inputPickSupported && (
        <label className="field"><span>Microphone (voice chat)</span>
          <div className="row">
            <select className="select" value={d.saved.mic?.id && !d.micMissing ? d.micId : ''} onChange={(e) => chooseMic(e.target.value)} aria-label="Microphone">
              <option value="">Computer's default</option>
              {d.inputs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <button className={`btn sm ${testing ? 'primary' : ''}`} onClick={testMic}>{testing ? '■ Stop' : '🎤 Test'}</button>
          </div>
          {testing && <div className="mic-meter" aria-label="Microphone level"><i style={{ width: `${levelPct}%` }} /></div>}
          {testing && <div className="tiny muted" style={HINT}>Say something: the bar moves when this mic hears you.</div>}
          {micError && <div className="tiny error-text" style={HINT}>{micError}</div>}
          {d.micMissing && <div className="tiny warn-text" style={HINT}>{savedMic || 'Your microphone'} isn't connected, so the default mic is used. It switches back by itself when it's connected.</div>}
        </label>
      )}
      <div className="tiny muted">Using Bluetooth headphones? Pick your computer's own mic here: talking through the headphones' mic switches them into a low-quality "headset" mode.</div>
      <div className="tiny muted voice-tip">The read-aloud voices (narrator and NPCs) always play on your computer's default speaker: browsers don't let a page send them anywhere else. To hear them in your headphones too, make the headphones your computer's default output (Windows: Settings → System → Sound → Output). Voice typing (🎤 in the action box) is the same: it listens on the computer's default microphone.</div>
    </div>
  );
}

export default function VoiceSettings({ onClose, onSounds }) {
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const [voices, setVoices] = useState(availableVoices());
  useEffect(() => { const t = setTimeout(() => setVoices(availableVoices()), 400); return () => clearTimeout(t); }, []);
  const [account, setAccount] = useState(false);
  const natural = voices.length ? naturalVoiceCount() : 0;
  return (
    <Modal title="Voices & sound" onClose={onClose}>
      <div className="col" style={{ gap: 14 }}>
        {!ttsSupported() && <div className="error-text">This browser can't read aloud.</div>}
        <div className="small muted">The narrator and every NPC are read aloud with your browser's built-in voices. {natural ? `You have ${natural} natural-sounding voices, so each character can get a lifelike voice of their own.` : null}</div>
        {ttsSupported() && !natural && (
          <div className="small voice-tip">This browser only has a few basic voices, so many characters share one and some sound robotic. For lifelike voices with real accents, open Roleplay20 in <b>Microsoft Edge</b> (it has dozens of natural voices). On a Mac or iPhone, download "Enhanced" voices in Settings → Accessibility → Spoken Content → Voices.</div>
        )}
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
        <DeviceSettings />
        <div className="row" style={{ borderTop: '1px solid var(--line)', paddingTop: 12 }}>
          <span className="small muted grow">Your email and password</span>
          <button className="btn sm" onClick={() => setAccount(true)}>👤 Account settings</button>
        </div>
        {account && <AccountSettings onClose={() => setAccount(false)} />}
      </div>
    </Modal>
  );
}
