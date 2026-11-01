import React, { useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { TopNav } from '../App.jsx';

const TONES = ['heroic', 'grim', 'comedic', 'mystery', 'horror', 'swashbuckling', 'political intrigue', 'wondrous', 'survival', 'romantic', 'epic'];
const IDEAS = [
  'A cursed river town where the drowned keep coming back',
  'A floating academy of magic falling slowly out of the sky',
  'Heist crew in a city ruled by dragons in human form',
  'A frontier caravan crossing a desert of living glass',
  'A haunted lighthouse at the edge of the known sea',
];

export default function NewCampaign() {
  const go = useStore((s) => s.go);
  const [f, setF] = useState({
    name: '', tone: ['heroic', 'mystery'], inspiration: '', premise: '', magicLevel: 'in between', lethality: 'balanced', shape: 'short season',
    startLevel: 1, pacing: 'balanced', lines: '', veils: '', model: 'claude-opus-5-5',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF({ ...f, [k]: v });
  const toggleTone = (t) => set('tone', f.tone.includes(t) ? f.tone.filter((x) => x !== t) : [...f.tone, t]);

  async function create() {
    setBusy(true);
    setErr('');
    try {
      const { name, ...settings } = f;
      const r = await api('campaigns', { method: 'POST', body: { name: name || 'Untitled Campaign', settings } });
      go(`#/c/${r.campaign.id}`);
    } catch (e) { setErr(e.message); setBusy(false); }
  }

  const Seg = ({ k, options }) => (
    <div className="tabs">{options.map((o) => <button key={o} type="button" className={f[k] === o ? 'on' : ''} onClick={() => set(k, o)}>{o}</button>)}</div>
  );

  return (
    <>
      <TopNav><button className="btn ghost sm" onClick={() => go('#/')}>← Back</button></TopNav>
      <div className="page">
        <div className="page-inner" style={{ maxWidth: 820 }}>
          <h1 className="title fade-in">Session Zero</h1>
          <p className="lede">Tell your Dungeon Master what kind of story you want. Claude will build the world, its secrets and its people. The players only see what their characters learn.</p>

          <div className="card pad col" style={{ gap: 18 }}>
            <label className="field"><span>Campaign name</span><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. The Saltmarsh Debt" /></label>
            <div className="field"><span>Tone</span><div className="chips">{TONES.map((t) => <button key={t} type="button" className={`chip ${f.tone.includes(t) ? 'on' : ''}`} onClick={() => toggleTone(t)}>{t}</button>)}</div></div>
            <label className="field"><span>What do you want to play? (premise, a vibe, a first scene - or leave blank to be surprised)</span>
              <textarea className="textarea" value={f.premise} onChange={(e) => set('premise', e.target.value)} placeholder={IDEAS[Math.floor(Date.now() / 86400000) % IDEAS.length]} />
            </label>
            <label className="field"><span>Inspiration (a film, show, book or game - tone and structure only)</span><input className="input" value={f.inspiration} onChange={(e) => set('inspiration', e.target.value)} placeholder="e.g. a little bit Princess Mononoke, a little bit Knives Out" /></label>
            <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
              <div className="field grow" style={{ minWidth: 240 }}><span>Magic</span><Seg k="magicLevel" options={['rare and feared', 'in between', 'everyday']} /></div>
              <div className="field grow" style={{ minWidth: 240 }}><span>Danger</span><Seg k="lethality" options={['forgiving', 'balanced', 'deadly']} /></div>
            </div>
            <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
              <div className="field grow" style={{ minWidth: 240 }}><span>Shape</span><Seg k="shape" options={['one-shot', 'short season', 'open sandbox']} /></div>
              <div className="field grow" style={{ minWidth: 240 }}><span>Pacing</span><Seg k="pacing" options={['roleplay', 'balanced', 'combat']} /></div>
            </div>
            <div className="row wrap" style={{ gap: 18 }}>
              <label className="field" style={{ width: 160 }}><span>Starting level</span>
                <select className="select" value={f.startLevel} onChange={(e) => set('startLevel', Number(e.target.value))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>Level {n}</option>)}</select>
              </label>
              <label className="field grow" style={{ minWidth: 260 }}><span>Dungeon Master brain</span>
                <select className="select" value={f.model} onChange={(e) => set('model', e.target.value)}>
                  <option value="claude-opus-5-5">Claude Opus 5.5 - richest storytelling (default)</option>
                  <option value="claude-sonnet-5-5">Claude Sonnet 5.5 - faster, about half the cost</option>
                  <option value="claude-haiku-5-5">Claude Haiku 5.5 - quickest and cheapest</option>
                </select>
              </label>
            </div>
            <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
              <label className="field grow" style={{ minWidth: 240 }}><span>Lines - never include</span><textarea className="textarea" style={{ minHeight: 60 }} value={f.lines} onChange={(e) => set('lines', e.target.value)} placeholder="e.g. harm to children, spiders" /></label>
              <label className="field grow" style={{ minWidth: 240 }}><span>Veils - fade to black</span><textarea className="textarea" style={{ minHeight: 60 }} value={f.veils} onChange={(e) => set('veils', e.target.value)} placeholder="e.g. torture, romance details" /></label>
            </div>
            {err && <div className="error-text">{err}</div>}
            <div className="row">
              <span className="muted small">World-building takes about a minute. You can invite friends while it works.</span>
              <div className="spacer" />
              <button className="btn primary lg" disabled={busy} onClick={create}>{busy ? <span className="spinner" /> : '✦ Build our world'}</button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
