import React, { useMemo, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { api } from '../lib/api.js';
import { useUI, tableStatus } from '../table/ui.js';
import { Modal } from '../components/Toasts.jsx';
import { deriveCharacter, ABILITIES, SKILLS, SKILL_NAMES, xpForLevel } from '../../../shared/rules.js';
import { Avatar, fmtMod, titleIndex, Markdown } from '../lib/format.jsx';
import LevelUp from './LevelUp.jsx';
import DicePicker from './DicePicker.jsx';

const ABIL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

export function useCharacter() {
  const ch = useStore((s) => s.view?.myCharacter);
  const srd = useStore((s) => s.srd);
  const d = useMemo(() => { try { return ch && srd ? deriveCharacter(ch, srd) : null; } catch (e) { console.warn(e); return null; } }, [ch, srd]);
  return { ch, d, srd };
}

export async function saveChar(ch, patch) {
  try { await api(`characters/${ch.id}`, { method: 'PUT', body: patch }); return true; }
  catch (e) { useStore.getState().toast(e.message, 'bad'); return false; }
}

/**
 * Can the sheet change right now? Only during a session with everyone at the table. Stats themselves never change from
 * the sheet: the DM, the rules engine and the level-up wizard do that.
 */
export function useLive() {
  const view = useStore((s) => s.view);
  if (!view) return { live: false, inCombat: false, why: '' };
  const st = tableStatus(view);
  const live = !st.between && !st.paused;
  return { live, inCombat: !!view.combat, why: st.between ? 'Between sessions the sheet is read-only.' : st.paused ? `Paused: waiting for ${st.names}.` : '' };
}

/** Roll from the sheet: automatically, or ask the player to type what they rolled at the table. */
export function sheetRoll(p) {
  const ui = useUI.getState();
  const advantage = ui.takeAdv();
  if (ui.rollMode === 'manual') { ui.set({ rollPrompt: { ...p, advantage } }); return; }
  emit('roll:free', { ...p, advantage, mode: 'auto' });
}

export default function CharacterSheet() {
  const { ch, d } = useCharacter();
  const view = useStore((s) => s.view);
  const { live, inCombat, why } = useLive();
  const [showLevel, setShowLevel] = useState(false);
  const [retiring, setRetiring] = useState(false);
  if (!ch) {
    return (
      <div className="empty col" style={{ gap: 10, alignItems: 'center' }}>
        <span>You don't have a character in this campaign{view?.formerParty?.some((p) => p.userId === view.me?.userId) ? ' right now' : ' yet'}.</span>
        {view?.campaign && <button className="btn primary sm" onClick={() => useStore.getState().go(`#/c/${view.campaign.id}/create`)}>✦ Make your character (level {view.joinLevel || 1})</button>}
      </div>
    );
  }
  if (!d) return <div className="empty">Loading rules…</div>;
  const hpPct = Math.max(0, Math.min(100, (ch.hp.current / Math.max(1, ch.hp.max)) * 100));
  const nextXp = xpForLevel ? xpForLevel(Math.min(20, ch.level + 1)) : null;

  const torch = !!(ch.light?.bright);
  const canLevel = live && !inCombat && !ch.dead;

  return (
    <div className="sheet">
      <div className="sheet-head">
        <PortraitPicker ch={ch} />
        <div className="grow">
          <div className="sheet-name">{ch.name}</div>
          <div className="muted small">Level {ch.level} {titleIndex(ch.subrace || ch.race)} {(ch.classes || [{ class: ch.class, level: ch.level, subclass: ch.subclass }]).map((k) => `${titleIndex(k.class)}${k.subclass ? ` (${titleIndex(k.subclass)})` : ''}`).join(' / ')}</div>
          <div className="xpbar" title={`${ch.xp || 0} / ${nextXp} XP`}><i style={{ width: `${Math.min(100, ((ch.xp || 0) / Math.max(1, nextXp || 1)) * 100)}%` }} /></div>
        </div>
        <span className={`insp-badge ${ch.inspiration ? 'on' : ''}`} title={ch.inspiration ? 'You have Inspiration. Tell the DM in your action when you use it (advantage on one roll).' : 'No Inspiration. The DM awards it for great roleplay and heroics.'}>🌟</span>
      </div>
      {!live && <div className="sheet-lock">🔒 {why} Only your picture can change.</div>}
      {ch.pendingLevelUp && !ch.dead && (
        <>
          <button className="btn primary levelup-btn" disabled={!canLevel} onClick={() => setShowLevel(true)}>⬆ Level up to {ch.level + 1}!</button>
          {!canLevel && <div className="tiny muted center">{inCombat ? 'Level up after the fight.' : 'You can level up once the session begins.'}</div>}
        </>
      )}
      {showLevel && <LevelUp onClose={() => setShowLevel(false)} />}

      <div className="vitals">
        <div className={`hp-box ${ch.hp.current === 0 ? 'down' : ''}`}>
          <div className="hp-label">HIT POINTS</div>
          <div className="hp-nums"><b>{ch.hp.current}</b><span>/ {ch.hp.max}</span>{ch.hp.temp ? <em>+{ch.hp.temp}</em> : null}</div>
          <div className="hp-bar"><i style={{ width: `${hpPct}%`, background: hpPct > 50 ? 'var(--green)' : hpPct > 25 ? 'var(--gold)' : 'var(--red)' }} /></div>
          <div className="tiny faint" style={{ marginTop: 4 }}>The DM tracks your hit points: damage, healing and rests.</div>
        </div>
        <div className="vital"><b>{d.ac}</b><span>AC</span></div>
        <button className="vital click" onClick={() => sheetRoll({ kind: 'initiative', key: 'dex', label: 'Initiative' })}><b>{fmtMod(d.initiative)}</b><span>INIT</span></button>
        <div className="vital"><b>{d.speed}</b><span>SPEED</span></div>
        <div className="vital"><b>+{d.prof}</b><span>PROF</span></div>
      </div>

      {ch.hp.current === 0 && !ch.dead && (
        <div className="death-saves">
          <b>Death saves</b>
          <span>✔ {[0, 1, 2].map((i) => <i key={i} className={i < (ch.deathSaves?.success || 0) ? 'on good' : ''} />)}</span>
          <span>✖ {[0, 1, 2].map((i) => <i key={i} className={i < (ch.deathSaves?.fail || 0) ? 'on bad' : ''} />)}</span>
          {ch.stable && <span className="pill green">stable</span>}
        </div>
      )}
      {ch.dead && (
        <div className="fallen">
          <b>💀 {ch.name} has died.</b>
          <span className="small">Their story is over, but it stays in the journal. Lay {ch.name} to rest to make a new character, who joins at level {view?.joinLevel || ch.level}.</span>
          <button className="btn danger sm" onClick={() => setRetiring(true)}>Lay {ch.name} to rest and make a new character</button>
        </div>
      )}

      <div className="row wrap" style={{ gap: 6, margin: '10px 0' }}>
        <span className="tiny muted">HIT DICE</span><span className="pill">{ch.hitDice.total - (ch.hitDice.used || 0)}/{ch.hitDice.total} d{ch.hitDice.die}</span>
        <span className="tiny muted" style={{ marginLeft: 6 }}>PASSIVE</span><span className="pill" title="Passive Perception">👁 {d.passive.perception}</span><span className="pill" title="Passive Insight">💭 {d.passive.insight}</span><span className="pill" title="Passive Investigation">🔎 {d.passive.investigation}</span>
        {ch.darkvision ? <span className="pill blue">Darkvision {ch.darkvision} ft</span> : null}
        <button className={`pill ${torch ? 'gold' : ''}`} style={{ cursor: live ? 'pointer' : 'default' }} disabled={!live || ch.dead} title={live ? '' : 'Only during a session'} onClick={() => saveChar(ch, { light: torch ? { bright: 0, dim: 0 } : { bright: 20, dim: 20 } })}>🔥 {torch ? 'Torch lit' : 'Light a torch'}</button>
        {ch.concentration && <span className="pill gold" title="Concentrating">◎ {titleIndex(ch.concentration)} {live && <button className="btn ghost xs" onClick={() => saveChar(ch, { concentration: null })}>end</button>}</span>}
      </div>

      <div className="cond-row">
        {ch.conditions.map((c) => <span key={c} className="pill red" title="The DM and the rules add and remove conditions">{c}</span>)}
        {ch.exhaustion ? <span className="pill red">exhaustion {ch.exhaustion}</span> : null}
      </div>

      <div className="abil-row">
        {ABILITIES.map((a) => (
          <div key={a} className="abil">
            <button className="abil-main" onClick={() => sheetRoll({ kind: 'ability', key: a, label: `${ABIL[a]} check` })} title={`${ABIL[a]} check`}>
              <span>{a.toUpperCase()}</span><b>{fmtMod(d.mods[a])}</b><i>{ch.abilities[a]}</i>
            </button>
            <button className={`abil-save ${ch.saveProfs?.includes(a) ? 'prof' : ''}`} onClick={() => sheetRoll({ kind: 'save', key: a, label: `${ABIL[a]} save` })} title={`${ABIL[a]} saving throw`}>save {fmtMod(d.saves[a])}</button>
          </div>
        ))}
      </div>

      <div className="sheet-cols">
        <div className="skills">
          <div className="sub-h">Skills</div>
          {Object.keys(SKILL_NAMES).map((s) => {
            const p = ch.skillProfs?.[s] || 0;
            return (
              <button key={s} className="skill-row" onClick={() => sheetRoll({ kind: 'skill', key: s, label: `${SKILL_NAMES[s]} check` })}>
                <span className={`prof-dot p${p}`} /><span className="grow">{SKILL_NAMES[s]} <i>{SKILLS[s]?.toUpperCase?.() || ''}</i></span><b>{fmtMod(d.skills[s])}</b>
              </button>
            );
          })}
        </div>
        <div className="col" style={{ gap: 10, minWidth: 0 }}>
          <div className="sub-h">Attacks</div>
          {d.attacks.map((a) => (
            <div key={a.id} className="attack-row">
              <div className="grow"><b>{a.name}</b><div className="tiny muted">{a.kind === 'ranged' ? `${a.rangeFt?.normal}/${a.rangeFt?.long} ft` : `reach ${a.reachFt || 5} ft`}{a.properties?.length ? ` · ${a.properties.join(', ')}` : ''}</div></div>
              <button className="btn xs" onClick={() => sheetRoll({ kind: 'custom', key: `1d20${fmtMod(a.bonus)}`, expr: `1d20${fmtMod(a.bonus)}`, label: `${a.name} attack` })}>{fmtMod(a.bonus)}</button>
              <button className="btn xs" onClick={() => sheetRoll({ kind: 'custom', key: a.damage, expr: a.damage, label: `${a.name} damage (${a.damageType})` })}>{a.damage}</button>
            </div>
          ))}
          <div className="tiny muted">In a fight, attack from the Turn panel to target enemies on the map.</div>
          <div className="sub-h" style={{ marginTop: 8 }}>Proficiencies</div>
          <div className="small muted">
            <div><b>Armor:</b> {(ch.otherProfs?.armor || []).join(', ') || 'none'}</div>
            <div><b>Weapons:</b> {(ch.otherProfs?.weapons || []).join(', ') || 'none'}</div>
            <div><b>Tools:</b> {(ch.otherProfs?.tools || []).join(', ') || 'none'}</div>
            <div><b>Languages:</b> {(ch.otherProfs?.languages || []).join(', ') || 'Common'}</div>
          </div>
        </div>
      </div>

      <div className="sub-h">Features & traits</div>
      <div className="features">
        {(ch.features || []).map((f, i) => (
          <details key={i} className="feature"><summary><b>{f.name}</b> <span className="tiny faint">{f.source}{f.level > 1 ? ` · L${f.level}` : ''}</span></summary><Markdown text={f.desc} className="prose small-prose" /></details>
        ))}
      </div>

      <div className="sub-h">Who you are</div>
      <div className="small personality">
        {['traits', 'ideals', 'bonds', 'flaws'].map((k) => ch.personality?.[k] ? <p key={k}><b>{titleIndex(k)}.</b> {ch.personality[k]}</p> : null)}
        {ch.appearance && <p><b>Appearance.</b> {ch.appearance}</p>}
        {ch.backstory && <details><summary><b>Backstory</b></summary><Markdown text={ch.backstory} className="prose small-prose" /></details>}
      </div>

      <DicePicker ch={ch} />

      {!ch.dead && (
        <div className="retire-zone">
          <div className="grow">
            <b>Retire {ch.name}</b>
            <div className="tiny muted">Ready for someone new? {ch.name} leaves the party for good, but their story stays. Your new character joins at level {view?.joinLevel || ch.level}.</div>
          </div>
          <button className="btn danger sm" disabled={inCombat} title={inCombat ? 'Finish the fight first' : ''} onClick={() => setRetiring(true)}>Retire…</button>
        </div>
      )}
      {retiring && <RetireModal ch={ch} joinLevel={view?.joinLevel || ch.level} onClose={() => setRetiring(false)} />}
    </div>
  );
}

/** Retire a character (or lay a fallen one to rest), then go and make the next one. */
function RetireModal({ ch, joinLevel, onClose }) {
  const [farewell, setFarewell] = useState('');
  const [busy, setBusy] = useState(false);
  const died = !!ch.dead;
  async function retire() {
    setBusy(true);
    try {
      await api(`characters/${ch.id}/retire`, { method: 'POST', body: { farewell } });
      useStore.getState().toast(died ? `${ch.name} is laid to rest.` : `${ch.name} retires from the party.`, 'good');
      useStore.getState().go(`#/c/${ch.campaignId}/create`);
    } catch (e) { useStore.getState().toast(e.message, 'bad'); setBusy(false); }
  }
  return (
    <Modal title={died ? `Lay ${ch.name} to rest` : `Retire ${ch.name}?`} onClose={onClose} actions={<><button className="btn ghost sm" onClick={onClose}>{died ? 'Not yet' : `Keep playing ${ch.name}`}</button><button className="btn danger sm" disabled={busy} onClick={retire}>{died ? 'Lay to rest' : `Retire ${ch.name}`}</button></>}>
      <div className="col" style={{ gap: 10 }}>
        <p className="small" style={{ margin: 0 }}>{ch.name} leaves play for good: their sheet is frozen and they can't be played again. Their story stays: the journal, the session logs and the DM remember them{died ? '' : ', and they may still turn up in the world'}.</p>
        <p className="small" style={{ margin: 0 }}>Next you'll make a new character, who joins at <b>level {joinLevel}</b> to match the party. The next session can't begin until they're ready.</p>
        <label className="small muted">{died ? 'A last word for them (optional)' : 'How do they leave? (optional)'}
          <textarea className="input" rows={2} maxLength={400} value={farewell} onChange={(e) => setFarewell(e.target.value)} placeholder={died ? 'They held the bridge so the rest of us could cross.' : 'Gone home to look after the family mill.'} />
        </label>
      </div>
    </Modal>
  );
}

/** Your picture in this campaign: click it to choose a new one (it's cropped square and kept small). */
function PortraitPicker({ ch }) {
  const input = React.useRef(null);
  const [busy, setBusy] = useState(false);
  async function pick(file) {
    if (!file) return;
    if (!/^image\//.test(file.type)) { useStore.getState().toast('Pick an image file.', 'bad'); return; }
    setBusy(true);
    try {
      const url = await squareImage(file, 320);
      if (await saveChar(ch, { portrait: url })) useStore.getState().toast('Picture updated.', 'good');
    } catch { useStore.getState().toast("Couldn't read that image.", 'bad'); }
    setBusy(false);
  }
  return (
    <button className={`portrait-pick ${busy ? 'busy' : ''}`} title="Change your picture for this campaign" onClick={() => input.current?.click()}>
      <Avatar size="lg" name={ch.name} color={ch.color} img={ch.portrait} />
      <span className="portrait-edit">📷</span>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ''; }} />
    </button>
  );
}

function squareImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const src = URL.createObjectURL(file);
    img.onload = () => {
      const s = Math.min(img.width, img.height);
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      canvas.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(src);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = () => { URL.revokeObjectURL(src); reject(new Error('bad image')); };
    img.src = src;
  });
}
