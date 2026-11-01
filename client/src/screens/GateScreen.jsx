// Shown only if the app is opened without passing the public gate first (or the gate token expired).
import React, { useState } from 'react';
import { api, cfg, setGate, store } from '../lib/api.js';
import { D20Icon } from '../lib/format.jsx';

export default function GateScreen({ onPass }) {
  const [pw, setPw] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  let device = cfg.device || store.get('rp20.device');
  if (!device) { device = Math.random().toString(16).slice(2) + Date.now().toString(16); store.set('rp20.device', device); }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await fetch(cfg.server + 'api/gate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, device }) }).then((x) => x.json());
      if (r.ok) { setGate(r.token); onPass(); return; }
      if (r.locked) setMsg(`Locked until ${new Date(r.lockedUntil).toLocaleString()}.`);
      else setMsg(r.error && r.remaining == null ? r.error : `Wrong password. ${r.remaining} attempt${r.remaining === 1 ? '' : 's'} left before a 24-hour lockout.`);
    } catch {
      setMsg("Can't reach the game server.");
    }
    setPw('');
    setBusy(false);
  }
  void api;
  return (
    <div className="auth-wrap">
      <form className="card auth-card col" onSubmit={submit} style={{ gap: 14, textAlign: 'center' }}>
        <div className="center"><D20Icon size={72} /></div>
        <h1 className="title" style={{ margin: 0 }}>Roleplay<span className="gold">20</span></h1>
        <p className="story muted" style={{ margin: 0, fontSize: 17 }}>Speak the password, friend, and enter.</p>
        <input className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" autoFocus />
        <button className="btn primary lg" disabled={busy || !pw}>Enter</button>
        {msg && <div className="error-text">{msg}</div>}
      </form>
    </div>
  );
}
