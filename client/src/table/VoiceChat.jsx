// The voice chat controls in the top bar: join, mute, who is in the call (glowing while they talk), each person's
// volume on this device, and "Story time" while the narration is read and every mic is off.
import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../lib/store.js';
import { useVoice, joinVoice, leaveVoice, setMuted, setVolume, micLive } from '../lib/voice.js';

export default function VoiceChat() {
  const view = useStore((s) => s.view);
  const v = useVoice();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [open]);
  const supported = typeof window !== 'undefined' && !!window.RTCPeerConnection && !!navigator.mediaDevices;
  if (!supported) return null;
  const nameOf = (uid) => view.party.find((p) => p.userId === uid)?.name?.split(' ')[0] || view.members.find((m) => m.userId === uid)?.displayName || 'Someone';
  const colorOf = (uid) => view.party.find((p) => p.userId === uid)?.color || '#888';
  const skip = !!view.campaign.settings?.allowSkipNarration;

  if (!v.joined) {
    return (
      <div className="voice-chat">
        <button className="btn sm" disabled={v.joining} onClick={joinVoice} title="Talk to the table here instead of another app. While the story is read aloud, every mic switches off until it has finished for everyone, so nothing echoes.">
          🎙 {v.joining ? 'Connecting…' : 'Join voice'}{view.voice?.length ? ` · ${view.voice.length} in` : ''}
        </button>
        {v.error && <span className="tiny error-text" title={v.error}>⚠</span>}
      </div>
    );
  }

  const others = v.members.filter((m) => m.userId !== view.me.userId);
  const waitingNames = v.hush.waiting.map(nameOf);
  const live = micLive(v);
  return (
    <div className="voice-chat joined" ref={ref}>
      {v.hush.on && (
        <span className="pill story-time" title={`Story time: every mic is off while the story is read${waitingNames.length ? ` (still reading for: ${waitingNames.join(', ')})` : ''}. Mics come back on by themselves.${skip ? ' The host lets players skip it.' : ''}`}>
          📖 Story time
        </span>
      )}
      <button className={`btn sm icon mic ${live ? 'live' : ''} ${v.talking.me ? 'talking' : ''}`} disabled={v.listenOnly}
        title={v.listenOnly ? 'No microphone: you can listen, but the others cannot hear you' : v.muted ? 'You are muted: click to talk' : v.hush.on ? 'Your mic is off for story time' : 'Click to mute yourself'}
        onClick={() => setMuted(!v.muted)}>
        {v.listenOnly ? '🎧' : v.muted || v.hush.on || v.privateReading ? '🔇' : '🎙'}
      </button>
      <button className="voice-people" onClick={() => setOpen(!open)} title="Who is in the voice chat (click for volumes)">
        {others.length === 0 && <span className="tiny muted">just you</span>}
        {others.map((m) => (
          <span key={m.userId} className={`vc-dot ${v.talking[m.userId] ? 'talking' : ''} ${m.muted ? 'muted' : ''} ${v.peers[m.userId] || 'connecting'}`} style={{ '--c': colorOf(m.userId) }} title={`${nameOf(m.userId)}${m.muted ? ' (muted)' : ''}${v.peers[m.userId] === 'failed' ? ' (could not connect)' : v.peers[m.userId] !== 'connected' ? ' (connecting…)' : ''}`}>
            {nameOf(m.userId).slice(0, 1)}
          </span>
        ))}
      </button>
      {open && (
        <div className="voice-pop fade-in">
          <div className="small"><b>Voice chat</b>{v.listenOnly ? <span className="muted"> · listening only (no microphone)</span> : null}</div>
          {others.length === 0 && <div className="tiny muted">Nobody else has joined yet.</div>}
          {others.map((m) => (
            <label key={m.userId} className="vc-row">
              <span className="vc-name" style={{ color: colorOf(m.userId) }}>{nameOf(m.userId)}{m.muted ? ' 🔇' : ''}{v.peers[m.userId] === 'failed' ? ' ⚠' : ''}</span>
              <input type="range" min="0" max="1" step="0.05" value={v.volumes[m.userId] ?? 1} onChange={(e) => setVolume(m.userId, Number(e.target.value))} title="Their volume on this device" />
            </label>
          ))}
          {others.some((m) => v.peers[m.userId] === 'failed') && <div className="tiny muted">⚠ Couldn't connect to someone. Their network may block direct calls; the host can add a relay (Cloudflare TURN) to the server.</div>}
          <div className="tiny muted">While the story is read aloud, every mic is off until it has finished for everyone{skip ? '; the host lets players skip it' : ", and it can't be skipped (the host can allow that on the DM Screen)"}.</div>
          <button className="btn xs danger" onClick={() => { setOpen(false); leaveVoice(); }}>Leave voice</button>
        </div>
      )}
    </div>
  );
}
