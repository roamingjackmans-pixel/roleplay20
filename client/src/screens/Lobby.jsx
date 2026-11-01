import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { Avatar, timeAgo } from '../lib/format.jsx';
import { TopNav } from '../App.jsx';

export default function Lobby() {
  const go = useStore((s) => s.go);
  const user = useStore((s) => s.user);
  const [list, setList] = useState(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api('campaigns').then((r) => setList(r.campaigns)).catch((e) => setErr(e.message));
  }, []);

  async function join(e) {
    e.preventDefault();
    setErr('');
    try {
      const r = await api('campaigns/join', { method: 'POST', body: { code } });
      go(`#/c/${r.campaign.id}`);
    } catch (x) { setErr(x.message); }
  }

  return (
    <>
      <TopNav />
      <div className="page">
        <div className="page-inner">
          <h1 className="title fade-in">Well met, {user.displayName}.</h1>
          <p className="lede">Choose a campaign to play, start a new world, or join your friends with an invite code.</p>

          <div className="row wrap" style={{ gap: 12, marginBottom: 8 }}>
            <button className="btn primary lg" onClick={() => go('#/new')}>✦ Start a new campaign</button>
            <form className="row" onSubmit={join} style={{ gap: 8 }}>
              <input className="input" style={{ width: 200, textTransform: 'uppercase', letterSpacing: '.15em', fontWeight: 600 }} placeholder="INVITE CODE" value={code} maxLength={6} onChange={(e) => setCode(e.target.value.toUpperCase())} />
              <button className="btn lg" disabled={code.length < 6}>Join</button>
            </form>
          </div>
          {err && <p className="error-text">{err}</p>}

          <h2 className="section">Your campaigns</h2>
          {!list && <div className="row muted"><span className="spinner" /> Loading…</div>}
          {list && !list.length && <div className="card pad empty">No campaigns yet. Start one, or ask a friend for their invite code.</div>}
          <div className="grid-cards">
            {(list || []).map((c) => (
              <div key={c.id} className="card camp-card fade-in" onClick={() => go(`#/c/${c.id}`)}>
                <div className="row" style={{ marginBottom: 6 }}>
                  <span className={`pill ${c.status === 'active' ? 'green' : c.status === 'genesis' ? 'gold' : ''}`}>{c.status === 'genesis' ? 'building world…' : c.status === 'active' ? `session ${c.sessionNumber}` : c.status === 'ready' ? 'ready to begin' : c.status}</span>
                  {c.sessionActive && <span className="pill red">● live</span>}
                  <div className="spacer" />
                  <span className="tiny faint">{c.role === 'owner' ? 'you run this' : 'player'}</span>
                </div>
                <h3>{c.title || c.name}</h3>
                <div className="tag">{c.tagline || (c.title && c.title !== c.name ? c.name : '')}</div>
                <div className="row" style={{ marginTop: 14 }}>
                  <div className="avatars">
                    {c.members.map((m) => <Avatar key={m.userId} name={m.character?.name || m.displayName} color={m.character?.color || m.color} img={m.character?.portrait} title={`${m.displayName}${m.character ? ` as ${m.character.name}` : ''}`} />)}
                  </div>
                  <div className="spacer" />
                  <span className="tiny faint">{c.lastPlayedAt ? `played ${timeAgo(c.lastPlayedAt)}` : `created ${timeAgo(c.createdAt)}`}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
