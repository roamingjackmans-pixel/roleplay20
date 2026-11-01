import React, { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { useCharacter } from './CharacterSheet.jsx';
import { levelUpPlan, levelUpOptions, spellOptions } from '../../../shared/charbuild.js';
import { ABILITIES, SKILL_NAMES } from '../../../shared/rules.js';
import { rollDice } from '../../../shared/dice.js';
import { Modal } from '../components/Toasts.jsx';
import { Markdown, titleIndex } from '../lib/format.jsx';

/**
 * The level-up wizard. Step 1: which class gains the level - one you already have, or a new one (multiclassing, if
 * your ability scores allow it). Step 2: hit points, features, subclass, ability scores and spells for that level.
 * If more levels are waiting, it starts again for the next one.
 */
export default function LevelUp({ onClose }) {
  const { ch, srd } = useCharacter();
  const options = useMemo(() => { try { return levelUpOptions(ch, srd); } catch { return []; } }, [ch, srd]);
  const [classKey, setClassKey] = useState(null);
  const [step, setStep] = useState(1);
  if (!ch) return null;
  const pick = classKey || options[0]?.classKey;
  if (step === 1) {
    return <ChooseClass ch={ch} options={options} pick={pick} setPick={setClassKey} onNext={() => setStep(2)} onClose={onClose} />;
  }
  return <LevelDetails key={`${pick}-${ch.level}`} ch={ch} srd={srd} classKey={pick} onBack={() => setStep(1)} onClose={onClose} onAgain={() => { setClassKey(null); setStep(1); }} />;
}

function ChooseClass({ ch, options, pick, setPick, onNext, onClose }) {
  const mine = options.filter((o) => !o.multiclass);
  const others = options.filter((o) => o.multiclass);
  const [showAll, setShowAll] = useState(!!options.find((o) => o.classKey === pick)?.multiclass);
  const chosen = options.find((o) => o.classKey === pick);
  const card = (o) => (
    <button key={o.classKey} className={`pick wide lvl-class ${pick === o.classKey ? 'on' : ''}`} disabled={!o.allowed} onClick={() => setPick(o.classKey)}>
      <b>{o.name} {o.multiclass ? <span className="pill">new class</span> : <span className="muted small">level {o.current} → {o.next}</span>}</b>
      <span className="small">d{o.hitDie} hit die{o.asi ? ' · ability score increase' : ''}{o.subclassAt ? ' · choose your subclass' : ''}</span>
      {o.features.length > 0 && <span className="tiny muted">Gain: {o.features.join(', ')}</span>}
      {o.multiclass && <span className={`tiny ${o.allowed ? 'muted' : 'error-text'}`}>{o.allowed ? `Needs ${o.prereqText}: you have it.` : `Not yet: ${o.problems.join('; ')}.`}</span>}
    </button>
  );
  return (
    <Modal title={`${ch.name} reaches level ${ch.level + 1}`} onClose={onClose} actions={<button className="btn primary sm" disabled={!chosen?.allowed} onClick={onNext}>Continue with {chosen?.name || '…'} →</button>}>
      <div className="col" style={{ gap: 10 }}>
        <div className="small muted">Step 1 of 2: which class gains the level?</div>
        {mine.map(card)}
        <button className="btn ghost sm" onClick={() => setShowAll(!showAll)}>{showAll ? '▾' : '▸'} Multiclass into a new class instead</button>
        {showAll && (
          <>
            <div className="tiny muted">Multiclassing gives you level 1 of another class (its features and some of its proficiencies) alongside what you have. You need the ability scores for the new class and for the classes you already have.</div>
            <div className="lvl-grid">{others.map(card)}</div>
          </>
        )}
      </div>
    </Modal>
  );
}

function LevelDetails({ ch, srd, classKey, onBack, onClose, onAgain }) {
  const toast = useStore((s) => s.toast);
  const plan = useMemo(() => { try { return levelUpPlan(ch, srd, classKey); } catch (e) { return { error: e.message }; } }, [ch, srd, classKey]);
  const [hpMode, setHpMode] = useState('average');
  const [hpRoll, setHpRoll] = useState(null);
  const [asi, setAsi] = useState({ mode: 'two', a: bestAbility(ch, classKey), b: 'con' });
  const [subclass, setSubclass] = useState(plan.subclassOptions?.[0]?.index || null);
  const [feat, setFeat] = useState({});
  const [cantrips, setCantrips] = useState([]);
  const [spells, setSpells] = useState([]);
  const [skills, setSkills] = useState([]);
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => { try { return spellOptions(plan.classKey, plan.classLevel, srd, { abilities: ch.abilities, subclass }); } catch { return null; } }, [plan, srd, ch, subclass]);
  if (plan.error) return <Modal title="Level up" onClose={onClose}><p className="error-text">{plan.error}</p></Modal>;

  const known = new Set([...(ch.spellcasting?.cantrips || []), ...(ch.spellcasting?.known || []), ...(ch.spellcasting?.prepared || [])]);
  const hp = hpMode === 'average' ? plan.hpAverage : hpRoll;
  const mcSkills = plan.multiclassSkills;
  const haveSkill = (s) => (ch.skillProfs?.[s] || 0) > 0;
  const mcAvail = mcSkills ? mcSkills.from.filter((s) => !haveSkill(s)) : [];
  const mcNeed = mcSkills ? Math.min(mcSkills.choose, mcAvail.length) : 0;

  async function apply() {
    setBusy(true);
    const choices = {
      class: plan.classKey, hp: Math.max(1, (hp || plan.hpAverage)), hpMethod: hpMode,
      asi: plan.asi ? (asi.mode === 'one' ? { [asi.a]: 2 } : { [asi.a]: 1, [asi.b]: 1 }) : undefined,
      subclass: plan.subclassChoice ? subclass : undefined, cantrips, spells, featureOptions: feat, skills,
    };
    try {
      const r = await api(`characters/${ch.id}/level-up`, { method: 'POST', body: choices });
      toast(`${ch.name} is now level ${plan.newLevel}${plan.multiclass ? ` (${titleIndex(plan.classKey)} 1)` : ''}!`, 'good');
      if (r.character?.pendingLevelUp) onAgain(); else onClose();
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  }

  return (
    <Modal title={`${ch.name}: ${titleIndex(plan.classKey)} level ${plan.classLevel}`} onClose={onClose}
      actions={<><button className="btn ghost sm" onClick={onBack}>← Back</button><button className="btn primary sm" disabled={busy || (hpMode === 'roll' && !hpRoll) || skills.length < mcNeed} onClick={apply}>Level up!</button></>}>
      <div className="col" style={{ gap: 16 }}>
        <div className="small muted">Step 2 of 2: character level {plan.newLevel}{plan.multiclass ? `, your first level as a ${titleIndex(plan.classKey)}` : ''}.</div>
        <div>
          <div className="sub-h">Hit points</div>
          <div className="row wrap">
            <div className="tabs" style={{ width: 260 }}><button className={hpMode === 'average' ? 'on' : ''} onClick={() => setHpMode('average')}>Take {plan.hpAverage}</button><button className={hpMode === 'roll' ? 'on' : ''} onClick={() => setHpMode('roll')}>Roll d{plan.hpDie}</button></div>
            {hpMode === 'roll' && <button className="btn" disabled={!!hpRoll} onClick={() => setHpRoll(rollDice(`1d${plan.hpDie}`).total)}>🎲 {hpRoll ? `Rolled ${hpRoll}` : 'Roll'}</button>}
            <span className="muted small">+ {plan.conMod} Constitution = <b>{Math.max(1, (hp || 0) + plan.conMod)}</b> more HP</span>
          </div>
        </div>
        {plan.multiclass && plan.multiclassProficiencies && (
          <div className="tiny muted">You also gain: {['armor', 'weapons', 'tools'].flatMap((k) => plan.multiclassProficiencies[k] || []).join(', ') || 'no new proficiencies'}.</div>
        )}
        {mcNeed > 0 && (
          <div><div className="sub-h">New skill (choose {mcSkills.choose})</div>
            <div className="chips">{mcAvail.map((s) => <button key={s} className={`chip ${skills.includes(s) ? 'on' : ''}`} onClick={() => setSkills(skills.includes(s) ? skills.filter((x) => x !== s) : [...skills, s].slice(-mcSkills.choose))}>{SKILL_NAMES[s] || titleIndex(s)}</button>)}</div>
          </div>
        )}
        {plan.features?.length > 0 && (
          <div><div className="sub-h">New features</div>{plan.features.map((f, i) => <details key={i} className="feature" open={i < 2}><summary><b>{f.name}</b></summary><Markdown text={f.desc} className="prose small-prose" /></details>)}</div>
        )}
        {plan.subclassChoice && (
          <div><div className="sub-h">Choose your path</div>
            {plan.subclassOptions.map((s) => <button key={s.index} className={`pick wide ${subclass === s.index ? 'on' : ''}`} onClick={() => setSubclass(s.index)}><b>{s.name}</b><span className="small muted">{String(s.desc || '').slice(0, 220)}</span></button>)}
          </div>
        )}
        {plan.featureChoices?.map((fc) => (
          <div key={fc.index}><div className="sub-h">{fc.name} (choose {fc.choose || 1})</div>
            <div className="chips">{fc.options.map((o) => {
              const on = (feat[fc.index] || []).includes(o.index);
              return <button key={o.index} className={`chip ${on ? 'on' : ''}`} title={o.desc} onClick={() => setFeat({ ...feat, [fc.index]: on ? feat[fc.index].filter((x) => x !== o.index) : [...(feat[fc.index] || []), o.index].slice(-(fc.choose || 1)) })}>{o.name}</button>;
            })}</div>
          </div>
        ))}
        {plan.asi && (
          <div><div className="sub-h">Ability score improvement</div>
            <div className="row wrap">
              <div className="tabs" style={{ width: 240 }}><button className={asi.mode === 'two' ? 'on' : ''} onClick={() => setAsi({ ...asi, mode: 'two' })}>+1 / +1</button><button className={asi.mode === 'one' ? 'on' : ''} onClick={() => setAsi({ ...asi, mode: 'one' })}>+2 to one</button></div>
              <select className="select" style={{ width: 'auto' }} value={asi.a} onChange={(e) => setAsi({ ...asi, a: e.target.value })}>{ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()} ({ch.abilities[a]})</option>)}</select>
              {asi.mode === 'two' && <select className="select" style={{ width: 'auto' }} value={asi.b} onChange={(e) => setAsi({ ...asi, b: e.target.value })}>{ABILITIES.map((a) => <option key={a} value={a}>{a.toUpperCase()} ({ch.abilities[a]})</option>)}</select>}
            </div>
          </div>
        )}
        {(plan.cantripsToPick > 0 || plan.spellsToPick > 0) && opts && (
          <div><div className="sub-h">New spells</div>
            {plan.cantripsToPick > 0 && <><div className="tiny muted">Cantrips ({cantrips.length}/{plan.cantripsToPick})</div><div className="chips" style={{ marginBottom: 8 }}>{opts.cantrips.filter((s) => !known.has(s.index)).map((s) => <button key={s.index} className={`chip ${cantrips.includes(s.index) ? 'on' : ''}`} onClick={() => setCantrips(cantrips.includes(s.index) ? cantrips.filter((x) => x !== s.index) : [...cantrips, s.index].slice(-plan.cantripsToPick))}>{s.name}</button>)}</div></>}
            {plan.spellsToPick > 0 && <><div className="tiny muted">Spells ({spells.length}/{plan.spellsToPick}, up to level {plan.classMaxSpellLevel || plan.maxSpellLevel})</div><div className="chips">{opts.spells.filter((s) => !known.has(s.index) && s.level <= (plan.classMaxSpellLevel || plan.maxSpellLevel)).map((s) => <button key={s.index} className={`chip ${spells.includes(s.index) ? 'on' : ''}`} onClick={() => setSpells(spells.includes(s.index) ? spells.filter((x) => x !== s.index) : [...spells, s.index].slice(-plan.spellsToPick))}>{s.name} <span className="faint">L{s.level}</span></button>)}</div></>}
            <div className="tiny faint">Anything you leave unpicked is filled in with good defaults.</div>
          </div>
        )}
        <div className="tiny muted">Proficiency bonus becomes +{plan.profBonus}. {plan.slots?.some(Boolean) ? `Spell slots: ${plan.slots.map((n, i) => (n ? `L${i + 1}×${n}` : '')).filter(Boolean).join(', ')}.` : ''}</div>
      </div>
    </Modal>
  );
}

const PRIMARY = { barbarian: 'str', bard: 'cha', cleric: 'wis', druid: 'wis', fighter: 'str', monk: 'dex', paladin: 'str', ranger: 'dex', rogue: 'dex', sorcerer: 'cha', warlock: 'cha', wizard: 'int' };
function bestAbility(ch, classKey) {
  return PRIMARY[classKey] || ABILITIES.reduce((a, b) => ((ch.abilities?.[b] || 0) > (ch.abilities?.[a] || 0) ? b : a), 'str');
}
