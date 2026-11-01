import React, { useEffect, useState } from 'react';
import { api, setToken, getDevice } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { D20Icon } from '../lib/format.jsx';
import CodeEntry from '../components/CodeEntry.jsx';

/**
 * Sign in, create an account (with an email), get a 6-digit code by email when the device is new or hasn't signed in
 * for 30 days, or ask for a password-reset link.
 */
export default function AuthScreen() {
  const setUser = useStore((s) => s.setUser);
  const [mode, setMode] = useState('login'); // login | signup | forgot
  const [f, setF] = useState({ username: '', password: '', displayName: '', email: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [emailOn, setEmailOn] = useState(false);
  const [challenge, setChallenge] = useState(null);
  const [sent, setSent] = useState('');
  const [fixing, setFixing] = useState(false);
  const [fixEmail, setFixEmail] = useState('');
  const up = (k) => (e) => setF({ ...f, [k]: e.target.value });
  useEffect(() => { api('auth/options').then((o) => setEmailOn(!!o.email)).catch(() => {}); }, []);

  const finish = (r) => { setToken(r.token); setUser(r.user); };

  async function submit(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      const r = await api(mode === 'login' ? 'auth/login' : 'auth/signup', { method: 'POST', body: { ...f, device: getDevice() } });
      if (r.challenge) setChallenge(r.challenge); else finish(r);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }

  async function forgot(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try { setSent((await api('auth/forgot', { method: 'POST', body: { login: f.username } })).message); } catch (x) { setErr(x.message); }
    setBusy(false);
  }

  async function fixAddress() {
    setErr('');
    try {
      const r = await api('auth/signup-email', { method: 'POST', body: { challengeId: challenge.id, email: fixEmail } });
      setChallenge(r.challenge);
      setFixing(false);
    } catch (x) { setErr(x.message); }
  }

  const head = (
    <div className="row" style={{ justifyContent: 'center', gap: 12 }}>
      <D20Icon size={40} />
      <div className="brand" style={{ fontSize: 26, cursor: 'default' }}>Roleplay<b>20</b></div>
    </div>
  );

  if (challenge) {
    const confirming = challenge.purpose === 'verify_email';
    return (
      <div className="auth-wrap">
        <div className="card auth-card col fade-in" style={{ gap: 14 }}>
          {head}
          <h3 style={{ margin: 0, textAlign: 'center' }}>{confirming ? 'Confirm your email' : 'Check your email'}</h3>
          {!confirming && <p className="small muted" style={{ margin: 0, textAlign: 'center' }}>This device hasn't signed in for a while, so we sent a code to make sure it's you.</p>}
          <CodeEntry
            challenge={challenge}
            onChange={setChallenge}
            submit={async (code, ch) => finish(await api('auth/verify', { method: 'POST', body: { challengeId: ch.id, code, device: getDevice() } }))}
            resend={async (ch) => (await api('auth/resend', { method: 'POST', body: { challengeId: ch.id } })).challenge}
            label={confirming ? 'Confirm and sign in' : 'Sign in'}
          >
            {confirming && (fixing ? (
              <div className="row" style={{ gap: 6 }}>
                <input className="input" type="email" placeholder="your correct email" value={fixEmail} onChange={(e) => setFixEmail(e.target.value)} />
                <button type="button" className="btn sm" disabled={!fixEmail} onClick={fixAddress}>Send it there</button>
              </div>
            ) : <button type="button" className="btn ghost xs" style={{ alignSelf: 'flex-start' }} onClick={() => setFixing(true)}>Wrong email? Fix it</button>)}
          </CodeEntry>
          {err && <div className="error-text small">{err}</div>}
          <button className="btn ghost sm" onClick={() => { setChallenge(null); setFixing(false); setErr(''); }}>← Back to sign in</button>
        </div>
      </div>
    );
  }

  if (mode === 'forgot') {
    return (
      <div className="auth-wrap">
        <form className="card auth-card col fade-in" onSubmit={forgot} style={{ gap: 14 }}>
          {head}
          <h3 style={{ margin: 0, textAlign: 'center' }}>Forgot your password?</h3>
          {sent ? <div className="success-note small">{sent}</div> : (
            <>
              <p className="small muted" style={{ margin: 0 }}>Enter your username or email. If the account has a confirmed email, we'll send it a link to choose a new password.</p>
              <label className="field"><span>Username or email</span><input className="input" value={f.username} onChange={up('username')} autoFocus /></label>
              {err && <div className="error-text">{err}</div>}
              <button className="btn primary lg" disabled={busy || !f.username.trim()}>{busy ? <span className="spinner" /> : 'Email me a reset link'}</button>
            </>
          )}
          <button type="button" className="btn ghost sm" onClick={() => { setMode('login'); setSent(''); setErr(''); }}>← Back to sign in</button>
        </form>
      </div>
    );
  }

  return (
    <div className="auth-wrap">
      <form className="card auth-card col fade-in" onSubmit={submit} style={{ gap: 14 }}>
        {head}
        <p className="story muted" style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 17 }}>
          {mode === 'login' ? 'Welcome back, adventurer.' : 'Every legend starts with a name.'}
        </p>
        <div className="tabs">
          <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => { setMode('login'); setErr(''); }}>Sign in</button>
          <button type="button" className={mode === 'signup' ? 'on' : ''} onClick={() => { setMode('signup'); setErr(''); }}>Create account</button>
        </div>
        <label className="field"><span>Username</span><input className="input" value={f.username} onChange={up('username')} autoComplete="username" autoFocus /></label>
        {mode === 'signup' && <label className="field"><span>Display name (what the table calls you)</span><input className="input" value={f.displayName} onChange={up('displayName')} placeholder="e.g. Joe" /></label>}
        {mode === 'signup' && (
          <label className="field"><span>Email{emailOn ? '' : ' (optional for now)'}</span>
            <input className="input" type="email" value={f.email} onChange={up('email')} autoComplete="email" placeholder="you@example.com" />
            <span className="tiny muted" style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>For sign-in codes on new devices and resetting a forgotten password. Only you see it.</span>
          </label>
        )}
        <label className="field"><span>Password</span><input className="input" type="password" value={f.password} onChange={up('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} /></label>
        {err && <div className="error-text">{err}</div>}
        <button className="btn primary lg" disabled={busy || !f.username || !f.password || (mode === 'signup' && emailOn && !f.email)}>{busy ? <span className="spinner" /> : mode === 'login' ? 'Sign in' : 'Create my account'}</button>
        {mode === 'login' && <button type="button" className="btn ghost sm" onClick={() => { setMode('forgot'); setErr(''); }}>Forgot password?</button>}
      </form>
    </div>
  );
}
