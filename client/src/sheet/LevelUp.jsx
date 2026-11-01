import React, { useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { useCharacter } from './CharacterSheet.jsx';
import { levelUpPlan, spellOptions } from '../../../shared/charbuild.js';
import { ABILITIES } from '../../../shared/rules.js';
import { rollDice } from '../../../shared/dice.js';
import { Modal } from '../components/Toasts.jsx';
import { Markdown, titleIndex } from '../lib/format.jsx';

export default function LevelUp({ onClose }) {
  const { ch, srd } = useCharacter();
  const toast = useStore((s) => s.toast);
  const plan = useMemo(() => { try { return levelUpPlan(ch, srd); } catch (e) { return { error: e.message }; } }, [ch, srd]);
  const [hpMode, setHpMode] = useState('average');
  const [hpRoll, setHpRoll] = useState(null);
  const [asi, setAsi] = useState({ mode: 'two', a: plan.classKey === 'wizard' ? 'int' : 'str', b: 'con' });
  const [subclass, setSubclass] = useState(plan.subclassOptions?.[0]?.index || null);
  const [feat, setFeat] = useState({});
  const [cantrips, setCantrips] = useState([]);
  const [spells, setSpells] = useState([]);
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => { try { return spellOptions(plan.classKey, plan.classLevel, srd, { abilities: ch.abilities, subclass }); } catch { return null; } }, [plan, srd, ch, subclass]);
  if (plan.error) return <Modal title="Level up" onClose={onClose}><p className="error-text">{plan.error}</p></Modal>;

  const known = new Set([...(ch.spellcasting?.cantrips || []), ...(ch.spellcasting?.known || []), ...(ch.spellcasting?.prepared || [])]);
  const hp = hpMode === 'average' ? plan.hpAverage : hpRoll;

  async function apply() {
    setBusy(true);
    const choices = {
      class: plan.classKey, hp: Math.max(1, (hp || plan.hpAverage)), hpMethod: hpMode,
      asi: plan.asi ? (asi.mode === 'one' ? { [asi.a]: 2 } : { [asi.a]: 1, [asi.b]: 1 }) : undefined,
      subclass: plan.subclassChoice ? subclass : undefined, cantrips, spells, featureOptions: feat,
    };
    try {
      await api(`characters/${ch.id}/level-up`, { method: 'POST', body: choices });
      toast(`${ch.name} is now level ${plan.newLevel}!`, 'good');
      onClose();
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  }

  return (
    <Modal title={`${ch.name} reaches level ${plan.newLevel}`} onClose={onClose} actions={<button className="btn primary sm" disabled={busy || (hpMode === 'roll' && !hpRoll)} onClick={apply}>Level up!</button>}>
      <div className="col" style={{ gap: 16 }}>
        <div>
          <div className="sub-h">Hit points</div>
          <div className="row wrap">
            <div className="tabs" style={{ width: 260 }}><button className={hpMode === 'average' ? 'on' : ''} onClick={() => setHpMode('average')}>Take {plan.hpAverage}</button><button className={hpMode === 'roll' ? 'on' : ''} onClick={() => setHpMode('roll')}>Roll d{plan.hpDie}</button></div>
            {hpMode === 'roll' && <button className="btn" onClick={() => setHpRoll(rollDice(`1d${plan.hpDie}`).total)}>🎲 {hpRoll ? `Rolled ${hpRoll}` : 'Roll'}</button>}
            <span className="muted small">+ {plan.conMod} Constitution = <b>{Math.max(1, (hp || 0) + plan.conMod)}</b> more HP</span>
          </div>
        </div>
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
          </div>
        )}
        <div className="tiny muted">Proficiency bonus becomes +{plan.profBonus}. {plan.slots?.some(Boolean) ? `Spell slots: ${plan.slots.map((n, i) => (n ? `L${i + 1}×${n}` : '')).filter(Boolean).join(', ')}.` : ''} {titleIndex(plan.classKey)} level {plan.classLevel}.</div>
      </div>
    </Modal>
  );
}
