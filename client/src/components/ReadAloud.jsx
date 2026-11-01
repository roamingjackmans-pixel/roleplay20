// "Read this to me" button for any page of text: the journal recap, session logs, the world bible, handouts.
import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import { speakText, stopSpeaking, onSpeaking, ttsSupported, othersCanHear } from '../lib/tts.js';

export default function ReadAloud({ text, id, label = 'Read aloud', inline = false, isPrivate = false }) {
  const prefs = useStore((s) => s.prefs);
  const [current, setCurrent] = useState(null);
  useEffect(() => onSpeaking((u) => setCurrent(u?.entryId || null)), []);
  if (!text || !ttsSupported()) return null;
  if (isPrivate && othersCanHear(prefs)) {
    const quiet = { className: 'btn xs ghost read-aloud', title: 'Private: not read aloud while others can hear (change it in ⚙ Voices & sound)', 'aria-disabled': true };
    return inline ? <span {...quiet}>🔇 Private</span> : <button type="button" disabled {...quiet}>🔇 Private</button>;
  }
  const playing = current === id;
  const toggle = (e) => { e.preventDefault(); e.stopPropagation(); if (playing) stopSpeaking(); else speakText(text, prefs, id); };
  const props = { className: `btn xs ghost read-aloud ${playing ? 'active' : ''}`, title: playing ? 'Stop reading' : 'Read this to me', onClick: toggle };
  const body = playing ? '⏹ Stop' : `🔊 ${label}`;
  // inside another clickable card a <button> isn't allowed, so use a focusable span there
  if (inline) return <span role="button" tabIndex={0} {...props} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && toggle(e)}>{body}</span>;
  return <button type="button" {...props}>{body}</button>;
}
