// Account settings: your email and password. Changing either first needs a code sent to your current email, so
// someone using your signed-in account can't take it over without your inbox. A new email is confirmed with a code.
import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { Modal } from '../components/Toasts.jsx';
import CodeEntry from '../components/CodeEntry.jsx';

const post = (path, body) => api(path, { method: 'POST', body });
const resend = async (ch) => (await post('auth/resend', { challengeId: ch.id })).challenge;

export default function AccountSettings({ onClose }) {
  const user = useStore((s) => s.user);
  const [emailOn, setEmailOn] = useState(false);
  const [open, setOpen] = useState(null); // 'email' | 'password'
  useEffect(() => { api('auth/options').then((o) => setEmailOn(!!o.email)).catch(() => {}); }, []);
  if (!user) return null;
  const secure = emailOn && user.email && user.emailVerified;

  return (
    <Modal title="Account" onClose={onClose}>
      <div className="col" style={{ gap: 16 }}>
        <div className="acct-row"><span className="tiny muted">Username</span><b>{user.username}</b><span className="tiny muted">Shown at the table as {user.displayName}</span></div>

        <div className="acct-row">
          <span className="tiny muted">Email</span>
          <div className="row wrap" style={{ gap: 8 }}>
            <b>{user.email || 'No email yet'}</b>
            {user.email && (user.emailVerified ? <span className="pill green">confirmed</span> : <span className="pill">not confirmed yet</span>)}
            <span className="spacer" />
            {open !== 'email' && <button className="btn sm" onClick={() => setOpen('email')}>{user.email ? 'Change email' : 'Add email'}</button>}
          </div>
          {!user.email && <span className="tiny muted">Add one so you can reset a forgotten password and confirm new devices.</span>}
          {open === 'email' && <EmailChange secure={secure} emailOn={emailOn} onDone={() => setOpen(null)} />}
        </div>

        <div className="acct-row">
          <span className="tiny muted">Password</span>
          <div className="row" style={{ gap: 8 }}>
            <b>••••••••</b><span className="spacer" />
            {open !== 'password' && <button className="btn sm" onClick={() => setOpen('password')}>Change password</button>}
          </div>
          {open === 'password' && <PasswordChange secure={secure} onDone={() => setOpen(null)} />}
        </div>

        {!emailOn && <div className="tiny muted">Email isn't switched on for this server yet, so sign-in codes and reset links aren't sent. You can still save your email now.</div>}
      </div>
    </Modal>
  );
}

/** With a confirmed email: a code to it first. Without one: your password. Then the new address gets its own code. */
function EmailChange({ secure, emailOn, onDone }) {
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState(secure ? 'ask' : 'form'); // ask -> code -> confirm | form -> confirm
  const [challenge, setChallenge] = useState(null);
  const [newEmail, setNewEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function sendFirst() {
    setBusy(true); setErr('');
    try { setChallenge((await post('auth/security/code', { purpose: 'change_email' })).challenge); setStep('code'); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  function afterStart(r) {
    if (r.saved) { setUser(r.user); toast('Email saved. It will be confirmed once email is switched on.', 'good'); onDone(); return; }
    setChallenge(r.challenge);
    setStep('confirm');
  }
  async function withPassword(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { afterStart(await post('auth/email', { newEmail, password })); } catch (x) { setErr(x.message); }
    setBusy(false);
  }

  return (
    <div className="acct-flow">
      {step === 'ask' && (
        <>
          <div className="small">To make sure it's you, we'll send a code to <b>{user.email}</b> first.</div>
          <div className="row" style={{ gap: 8 }}><button className="btn primary sm" disabled={busy} onClick={sendFirst}>Send the code</button><button className="btn ghost sm" onClick={onDone}>Cancel</button></div>
        </>
      )}
      {step === 'code' && (
        <CodeEntry challenge={challenge} onChange={setChallenge} resend={resend} label="Continue"
          submit={async (code, ch) => {
            if (!newEmail.trim()) throw new Error('Type your new email first.');
            afterStart(await post('auth/email', { challengeId: ch.id, code, newEmail }));
          }}>
          <label className="field"><span>New email</span><input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="new@example.com" /></label>
        </CodeEntry>
      )}
      {step === 'form' && (
        <form className="col" style={{ gap: 8 }} onSubmit={withPassword}>
          <label className="field"><span>{user.email ? 'New email' : 'Your email'}</span><input className="input" type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="you@example.com" autoFocus /></label>
          <label className="field"><span>Your current password</span><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
          <div className="row" style={{ gap: 8 }}><button className="btn primary sm" disabled={busy || !newEmail || !password}>{emailOn ? 'Send a code to it' : 'Save email'}</button><button type="button" className="btn ghost sm" onClick={onDone}>Cancel</button></div>
        </form>
      )}
      {step === 'confirm' && (
        <>
          <div className="small muted">Last step: confirm the new address.</div>
          <CodeEntry challenge={challenge} onChange={setChallenge} resend={resend} label="Confirm new email"
            submit={async (code, ch) => { const r = await post('auth/email/confirm', { challengeId: ch.id, code }); setUser(r.user); toast('Your email is changed.', 'good'); onDone(); }} />
        </>
      )}
      {err && <div className="error-text small">{err}</div>}
    </div>
  );
}

/** With a confirmed email: a code to it, then the new password. Without one: your current password. */
function PasswordChange({ secure, onDone }) {
  const user = useStore((s) => s.user);
  const toast = useStore((s) => s.toast);
  const [step, setStep] = useState(secure ? 'ask' : 'form');
  const [challenge, setChallenge] = useState(null);
  const [oldPassword, setOld] = useState('');
  const [p1, setP1] = useState('');
  const [p2, setP2] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const check = () => { if (p1.length < 6) throw new Error('The new password needs at least 6 characters.'); if (p1 !== p2) throw new Error("The two new passwords don't match."); };
  const done = () => { toast('Password changed. Your other devices were signed out.', 'good'); onDone(); };

  async function sendFirst() {
    setBusy(true); setErr('');
    try { setChallenge((await post('auth/security/code', { purpose: 'change_password' })).challenge); setStep('code'); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  async function withPassword(e) {
    e.preventDefault(); setBusy(true); setErr('');
    try { check(); await post('auth/password', { oldPassword, newPassword: p1 }); done(); } catch (x) { setErr(x.message); }
    setBusy(false);
  }
  const fields = (
    <>
      <label className="field"><span>New password</span><input className="input" type="password" value={p1} onChange={(e) => setP1(e.target.value)} autoComplete="new-password" /></label>
      <label className="field"><span>Type it again</span><input className="input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></label>
    </>
  );

  return (
    <div className="acct-flow">
      {step === 'ask' && (
        <>
          <div className="small">To make sure it's you, we'll send a code to <b>{user.email}</b> first.</div>
          <div className="row" style={{ gap: 8 }}><button className="btn primary sm" disabled={busy} onClick={sendFirst}>Send the code</button><button className="btn ghost sm" onClick={onDone}>Cancel</button></div>
        </>
      )}
      {step === 'code' && (
        <CodeEntry challenge={challenge} onChange={setChallenge} resend={resend} label="Change password"
          submit={async (code, ch) => { check(); await post('auth/password', { challengeId: ch.id, code, newPassword: p1 }); done(); }}>
          {fields}
        </CodeEntry>
      )}
      {step === 'form' && (
        <form className="col" style={{ gap: 8 }} onSubmit={withPassword}>
          <label className="field"><span>Current password</span><input className="input" type="password" value={oldPassword} onChange={(e) => setOld(e.target.value)} autoComplete="current-password" autoFocus /></label>
          {fields}
          <div className="row" style={{ gap: 8 }}><button className="btn primary sm" disabled={busy || !oldPassword || !p1}>Change password</button><button type="button" className="btn ghost sm" onClick={onDone}>Cancel</button></div>
        </form>
      )}
      {err && <div className="error-text small">{err}</div>}
    </div>
  );
}
