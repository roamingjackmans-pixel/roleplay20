// The page a password-reset email links to: choose a new password (the link works once, for 30 minutes).
import React, { useState } from 'react';
import { api, setToken, getDevice } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { D20Icon } from '../lib/format.jsx';

export default function ResetScreen({ token }) {
  const setUser = useStore((s) => s.setUser);
  const go = useStore((s) => s.go);
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    if (p1 !== p2) { setErr("The two passwords don't match."); return; }
    setBusy(true);
    setErr('');
    try {
      const r = await api('auth/reset', { method: 'POST', body: { token, password: p1, device: getDevice() } });
      setToken(r.token);
      setUser(r.user);
      useStore.getState().toast('Your password is changed. Other devices were signed out.', 'good');
      go('#/');
    } catch (x) { setErr(x.message); setBusy(false); }
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card col fade-in" onSubmit={submit} style={{ gap: 14 }}>
        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          <D20Icon size={40} />
          <div className="brand" style={{ fontSize: 26, cursor: 'default' }}>Roleplay<b>20</b></div>
        </div>
        <h3 style={{ margin: 0, textAlign: 'center' }}>Choose a new password</h3>
        {!token ? <div className="error-text">This link is missing its code. Open the link from the email again.</div> : (
          <>
            <label className="field"><span>New password</span><input className="input" type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" autoFocus /></label>
            <label className="field"><span>Type it again</span><input className="input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></label>
            {err && <div className="error-text">{err}</div>}
            <button className="btn primary lg" disabled={busy || p1.length < 6 || !p2}>{busy ? <span className="spinner" /> : 'Save and sign in'}</button>
            <div className="tiny muted">At least 6 characters. Saving signs out every other device.</div>
          </>
        )}
        <button type="button" className="btn ghost sm" onClick={() => go('#/')}>← Back to sign in</button>
      </form>
    </div>
  );
}
