import React, { useMemo, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { api } from '../lib/api.js';
import { useUI } from '../table/ui.js';
import { deriveCharacter, abilityMod, ABILITIES, SKILLS, SKILL_NAMES, CONDITIONS, xpForLevel } from '../../../shared/rules.js';
import { Avatar, fmtMod, titleIndex, Markdown } from '../lib/format.jsx';
import LevelUp from './LevelUp.jsx';

const ABIL = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };

export function useCharacter() {
  const ch = useStore((s) => s.view?.myCharacter);
  const srd = useStore((s) => s.srd);
  const d = useMemo(() => { try { return ch && srd ? deriveCharacter(ch, srd) : null; } catch (e) { console.warn(e); return null; } }, [ch, srd]);
  return { ch, d, srd };
}

export async function saveChar(ch, patch) {
  try { await api(`characters/${ch.id}`, { method: 'PUT', body: patch }); }
  catch (e) { useStore.getState().toast(e.message, 'bad'); }
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
  const [dmg, setDmg] = useState('');
  const [showLevel, setShowLevel] = useState(false);
  if (!ch) return <div className="empty">You don't have a character in this campaign yet.</div>;
  if (!d) return <div className="empty">Loading rules…</div>;
  const hpPct = Math.max(0, Math.min(100, (ch.hp.current / Math.max(1, ch.hp.max)) * 100));
  const nextXp = xpForLevel ? xpForLevel(Math.min(20, ch.level + 1)) : null;

  const changeHp = (sign) => {
    const n = Math.abs(parseInt(dmg, 10));
    if (!n) return;
    const hp = { ...ch.hp };
    if (sign < 0) { let r = n; if (hp.temp) { const t = Math.min(hp.temp, r); hp.temp -= t; r -= t; } hp.current = Math.max(0, hp.current - r); }
    else hp.current = Math.min(hp.max, hp.current + n);
    saveChar(ch, { hp, ...(hp.current > 0 ? { deathSaves: { success: 0, fail: 0 }, conditions: ch.conditions.filter((c) => c !== 'unconscious') } : {}) });
    setDmg('');
  };
  const toggleCond = (c) => saveChar(ch, { conditions: ch.conditions.includes(c) ? ch.conditions.filter((x) => x !== c) : [...ch.conditions, c] });
  const torch = !!(ch.light?.bright);

  return (
    <div className="sheet">
      <div className="sheet-head">
        <Avatar size="lg" name={ch.name} color={ch.color} img={ch.portrait} />
        <div className="grow">
          <div className="sheet-name">{ch.name}</div>
          <div className="muted small">Level {ch.level} {titleIndex(ch.subrace || ch.race)} {(ch.classes || [{ class: ch.class, level: ch.level, subclass: ch.subclass }]).map((k) => `${titleIndex(k.class)}${k.subclass ? ` (${titleIndex(k.subclass)})` : ''}`).join(' / ')}</div>
          <div className="xpbar" title={`${ch.xp || 0} / ${nextXp} XP`}><i style={{ width: `${Math.min(100, ((ch.xp || 0) / Math.max(1, nextXp || 1)) * 100)}%` }} /></div>
        </div>
        <button className={`btn icon ${ch.inspiration ? 'active' : ''}`} title="Inspiration" onClick={() => saveChar(ch, { inspiration: !ch.inspiration })}>🌟</button>
      </div>
      {ch.pendingLevelUp && <button className="btn primary levelup-btn" onClick={() => setShowLevel(true)}>⬆ Level up to {ch.level + 1}!</button>}
      {showLevel && <LevelUp onClose={() => setShowLevel(false)} />}

      <div className="vitals">
        <div className={`hp-box ${ch.hp.current === 0 ? 'down' : ''}`}>
          <div className="hp-label">HIT POINTS</div>
          <div className="hp-nums"><b>{ch.hp.current}</b><span>/ {ch.hp.max}</span>{ch.hp.temp ? <em>+{ch.hp.temp}</em> : null}</div>
          <div className="hp-bar"><i style={{ width: `${hpPct}%`, background: hpPct > 50 ? 'var(--green)' : hpPct > 25 ? 'var(--gold)' : 'var(--red)' }} /></div>
          <div className="row" style={{ gap: 4, marginTop: 6 }}>
            <input className="input hp-in" inputMode="numeric" value={dmg} onChange={(e) => setDmg(e.target.value.replace(/[^0-9]/g, ''))} placeholder="#" />
            <button className="btn xs danger" onClick={() => changeHp(-1)} title="Take damage">−</button>
            <button className="btn xs" onClick={() => changeHp(1)} title="Heal" style={{ color: 'var(--green)' }}>+</button>
            <button className="btn xs ghost" title="Temporary HP" onClick={() => { const n = parseInt(dmg, 10); if (n >= 0) { saveChar(ch, { hp: { ...ch.hp, temp: n } }); setDmg(''); } }}>temp</button>
          </div>
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
      {ch.dead && <div className="death-saves bad"><b>💀 {ch.name} has died.</b></div>}

      <div className="row wrap" style={{ gap: 6, margin: '10px 0' }}>
        <span className="tiny muted">HIT DICE</span><span className="pill">{ch.hitDice.total - (ch.hitDice.used || 0)}/{ch.hitDice.total} d{ch.hitDice.die}</span>
        <span className="tiny muted" style={{ marginLeft: 6 }}>PASSIVE</span><span className="pill" title="Passive Perception">👁 {d.passive.perception}</span><span className="pill" title="Passive Insight">💭 {d.passive.insight}</span><span className="pill" title="Passive Investigation">🔎 {d.passive.investigation}</span>
        {ch.darkvision ? <span className="pill blue">Darkvision {ch.darkvision} ft</span> : null}
        <button className={`pill ${torch ? 'gold' : ''}`} style={{ cursor: 'pointer' }} onClick={() => saveChar(ch, { light: torch ? { bright: 0, dim: 0 } : { bright: 20, dim: 20 } })}>🔥 {torch ? 'Torch lit' : 'Light a torch'}</button>
        {ch.concentration && <span className="pill gold" title="Concentrating">◎ {titleIndex(ch.concentration)} <button className="btn ghost xs" onClick={() => saveChar(ch, { concentration: null })}>end</button></span>}
      </div>

      <div className="cond-row">
        {ch.conditions.map((c) => <button key={c} className="pill red" onClick={() => toggleCond(c)} title="Remove">{c} ✕</button>)}
        <select className="select cond-add" value="" onChange={(e) => e.target.value && toggleCond(e.target.value)}>
          <option value="">+ condition</option>
          {[...CONDITIONS, 'raging', 'dodging', 'blessed', 'hidden'].filter((c) => !ch.conditions.includes(c)).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
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
    </div>
  );
}
