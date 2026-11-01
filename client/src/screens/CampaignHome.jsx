import React, { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { Avatar, Markdown, titleIndex } from '../lib/format.jsx';
import { TopNav } from '../App.jsx';

export default function CampaignHome({ id }) {
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const user = useStore((s) => s.user);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    let stop = false;
    let t;
    const load = () => api(`campaigns/${id}`).then((r) => {
      if (stop) return;
      setData(r);
      if (r.status === 'genesis' || r.status === 'new') t = setTimeout(load, 2500);
    }).catch((e) => setErr(e.message));
    load();
    return () => { stop = true; clearTimeout(t); };
  }, [id]);

  if (err) return <><TopNav /><div className="page"><div className="page-inner"><p className="error-text">{err}</p><button className="btn" onClick={() => go('#/')}>Back</button></div></div></>;
  if (!data) return <><TopNav /><div className="page"><div className="page-inner row muted"><span className="spinner" /> Loading…</div></div></>;

  const c = data.campaign;
  const isOwner = c.role === 'owner';
  const building = data.status === 'genesis' || data.status === 'new';
  const myChar = c.members.find((m) => m.userId === user.id)?.character;

  async function regenerate() {
    if (!confirm('Throw this world away and build a new one from the same brief?')) return;
    await api(`campaigns/${id}/regenerate`, { method: 'POST' });
    setData({ ...data, status: 'genesis' });
    setTimeout(() => location.reload(), 300);
  }
  async function remove() {
    if (!confirm('Delete this campaign for everyone? This cannot be undone.')) return;
    await api(`campaigns/${id}`, { method: 'DELETE' });
    go('#/');
  }
  const copy = () => { navigator.clipboard?.writeText(c.inviteCode); toast(`Invite code ${c.inviteCode} copied`); };

  return (
    <>
      <TopNav><button className="btn ghost sm" onClick={() => go('#/')}>← Campaigns</button></TopNav>
      <div className="page">
        <div className="page-inner">
          <div className="row wrap" style={{ alignItems: 'flex-end', gap: 16 }}>
            <div className="grow">
              <div className="muted small display" style={{ letterSpacing: '.12em' }}>{c.name.toUpperCase()}</div>
              <h1 className="title fade-in">{data.world.title || c.name}</h1>
              {data.world.tagline && <p className="lede" style={{ margin: 0 }}>{data.world.tagline}</p>}
            </div>
            <div className="col" style={{ alignItems: 'flex-end' }}>
              <span className="tiny muted">Invite code</span>
              <button className="btn lg" onClick={copy} title="Copy" style={{ letterSpacing: '.25em', fontFamily: 'var(--display)' }}>{c.inviteCode}</button>
            </div>
          </div>

          {building && (
            <div className="card pad row fade-in" style={{ marginTop: 20, gap: 14 }}>
              <span className="spinner" />
              <div>
                <div className="display" style={{ fontSize: 16 }}>The Dungeon Master is building your world…</div>
                <div className="muted small">Geography, factions, secrets, NPCs with their own voices, a starting town map. About a minute.</div>
              </div>
            </div>
          )}
          {data.genesisError === 'no-ai' && <div className="card pad" style={{ marginTop: 16, borderColor: '#7a5a20' }}><b>The AI Dungeon Master isn't connected yet.</b> <span className="muted">Add an Anthropic API key to the server's <code>.env</code> file and restart it, then press "Rebuild world".</span></div>}
          {data.genesisError && data.genesisError !== 'no-ai' && <div className="card pad error-text" style={{ marginTop: 16 }}>World building failed: {data.genesisError}</div>}

          <div className="row wrap" style={{ marginTop: 22, gap: 10 }}>
            {!myChar && !building && <button className="btn primary lg" onClick={() => go(`#/c/${id}/create`)}>✦ Create your character</button>}
            {myChar && <button className="btn primary lg" onClick={() => go(`#/c/${id}/play`)}>⚔ Enter the table</button>}
            {!myChar && !building && <button className="btn lg" onClick={() => go(`#/c/${id}/play`)}>Watch the table</button>}
            {isOwner && c.sessionNumber === 0 && !building && <button className="btn" onClick={regenerate}>↻ Rebuild world</button>}
            <div className="spacer" />
            {isOwner && <button className="btn danger sm" onClick={remove}>Delete campaign</button>}
            {!isOwner && <button className="btn ghost sm" onClick={async () => { await api(`campaigns/${id}/leave`, { method: 'POST' }); go('#/'); }}>Leave campaign</button>}
          </div>

          <h2 className="section">The party</h2>
          <div className="grid-cards">
            {c.members.map((m) => (
              <div key={m.userId} className="card pad row" style={{ gap: 14 }}>
                <Avatar size="lg" name={m.character?.name || m.displayName} color={m.character?.color || m.color} img={m.character?.portrait} />
                <div className="grow">
                  <div className="display" style={{ fontSize: 16 }}>{m.character?.name || <span className="muted">No character yet</span>}</div>
                  {m.character && <div className="muted small">Level {m.character.level} {titleIndex(m.character.race)} {titleIndex(m.character.class)}</div>}
                  <div className="tiny faint">played by {m.displayName}{m.role === 'owner' ? ' · host' : ''}</div>
                </div>
              </div>
            ))}
          </div>

          {data.world.characterPrompts?.length > 0 && (
            <>
              <h2 className="section">Questions for your character</h2>
              <div className="card pad col">
                {data.world.characterPrompts.map((p, i) => <div key={i} className="story" style={{ fontSize: 17 }}>✦ {p}</div>)}
              </div>
            </>
          )}

          {data.world.bible && (
            <>
              <h2 className="section">World bible</h2>
              <div className="card pad"><Markdown text={data.world.bible} /></div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
