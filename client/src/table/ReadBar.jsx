// The host's Read button. The DM's narration waits on screen until the host presses Read, so whoever is talking can
// finish first. Then it's read aloud on every device at once and, in the voice chat, every mic is off until it has
// finished for everyone. The players see that it's coming.
import React, { useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useVoice } from '../lib/voice.js';

export default function ReadBar() {
  const view = useStore((s) => s.view);
  const log = useStore((s) => s.log);
  const inCall = useVoice((s) => s.joined);
  const [busy, setBusy] = useState(false);
  const waiting = view?.readWaiting || [];
  if (!waiting.length) return null;
  const isOwner = view.me.role === 'owner';
  const mine = waiting.filter((id) => log.some((e) => e.id === id)).length;
  if (!isOwner && !mine) return null;
  const read = async () => {
    setBusy(true);
    await emit('narration:read');
    setBusy(false);
  };
  if (!isOwner) {
    return (
      <div className="read-bar fade-in" role="status">
        <span className="rb-icon" aria-hidden="true">📖</span>
        <div className="rb-text"><b>New story text</b><span className="tiny muted">The host will start reading it aloud when everyone has finished talking.</span></div>
      </div>
    );
  }
  return (
    <div className="read-bar host fade-in" role="status">
      <span className="rb-icon" aria-hidden="true">📖</span>
      <div className="rb-text">
        <b>The DM's reply is ready{mine > 1 ? ` (${mine} parts)` : ''}</b>
        <span className="tiny muted">Let everyone finish talking, then read it to the table.{inCall || view.voice?.length ? ' Every mic switches off until it has finished for everyone.' : ''}</span>
      </div>
      <button className="btn primary" disabled={busy} onClick={read} title="Read the DM's reply aloud on every device now">▶ Read</button>
    </div>
  );
}
