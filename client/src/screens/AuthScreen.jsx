import React, { useState } from 'react';
import { api, setToken } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { D20Icon } from '../lib/format.jsx';

export default function AuthScreen() {
  const setUser = useStore((s) => s.setUser);
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ username: '', password: '', displayName: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api(mode === 'login' ? 'auth/login' : 'auth/signup', { method: 'POST', body: f });
      setToken(r.token);
      setUser(r.user);
    } catch (x) {
      setErr(x.message);
    }
    setBusy(false);
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card col fade-in" onSubmit={submit} style={{ gap: 14 }}>
        <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
          <D20Icon size={40} />
          <div className="brand" style={{ fontSize: 26, cursor: 'default' }}>Roleplay<b>20</b></div>
        </div>
        <p className="story muted" style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 17 }}>
          {mode === 'login' ? 'Welcome back, adventurer.' : 'Every legend starts with a name.'}
        </p>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
          <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => setMode('signup')}>Create account</button>
        </div>
        <label className="field"><span>Username</span><input className="input" value={f.username} onChange={up('username')} autoComplete="username" autoFocus /></label>
        {mode === 'signup' && <label className="field"><span>Display name (what the table calls you)</span><input className="input" value={f.displayName} onChange={up('displayName')} placeholder="e.g. Joe" /></label>}
        <label className="field"><span>Password</span><input className="input" type="password" value={f.password} onChange={up('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {err && <div className="error-text">{err}</div>}
        <button className="btn primary lg" disabled={busy || !f.username || !f.password}>{busy ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create my account'}</button>
      </form>
    </div>
  );
}
