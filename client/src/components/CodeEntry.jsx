// Enter the 6-digit code from an email. Three wrong tries and it's used up: then send a new code.
import React, { useEffect, useRef, useState } from 'react';

/**
 * challenge: { id, to, resendIn } from the server. submit(code) resolves when it's accepted or throws the server's
 * error (with data.triesLeft / data.expired). resend() resolves to a fresh challenge.
 */
export default function CodeEntry({ challenge, submit, resend, onChange, label = 'Verify', children }) {
  const [ch, setCh] = useState(challenge);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [expired, setExpired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(challenge?.resendIn || 30);
  const input = useRef(null);
  useEffect(() => { setCh(challenge); setWait(challenge?.resendIn || 30); setExpired(false); setErr(''); setCode(''); }, [challenge?.id]);
  useEffect(() => { if (wait <= 0) return undefined; const t = setTimeout(() => setWait((w) => w - 1), 1000); return () => clearTimeout(t); }, [wait]);
  useEffect(() => { input.current?.focus(); }, [ch?.id]);

  async function go(e) {
    e?.preventDefault();
    if (code.length !== 6 || busy || expired) return;
    setBusy(true);
    setErr('');
    try { await submit(code, ch); } catch (x) {
      setErr(x.message);
      if (x.data?.expired) setExpired(true);
      if (x.data) setCode(''); // a wrong code is cleared; a typo elsewhere keeps it
    }
    setBusy(false);
  }
  async function again() {
    setBusy(true);
    setErr('');
    try {
      const next = await resend(ch);
      setCh(next);
      onChange?.(next);
      setExpired(false);
      setCode('');
      setWait(next?.resendIn || 30);
    } catch (x) { setErr(x.message); }
    setBusy(false);
  }

  return (
    <form className="col code-entry" style={{ gap: 10 }} onSubmit={go}>
      <div className="small">We sent a 6-digit code to <b>{ch?.to}</b>. It works for 10 minutes.</div>
      <input ref={input} className="input code-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
        value={code} disabled={expired} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} aria-label="6-digit code" />
      {err && <div className="error-text small">{err}</div>}
      {children}
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="btn primary" disabled={busy || expired || code.length !== 6}>{busy ? <span className="spinner" /> : label}</button>
        <button type="button" className={`btn ${expired ? 'primary' : 'ghost'} sm`} disabled={busy || wait > 0} onClick={again}>
          {wait > 0 ? `Send a new code (${wait}s)` : 'Send a new code'}
        </button>
      </div>
      <div className="tiny muted">Check your spam folder if it doesn't arrive in a minute.</div>
    </form>
  );
}
