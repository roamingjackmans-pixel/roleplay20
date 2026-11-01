import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  const [subclass, setSubclass] = useState(null);
  const [feat, setFeat] = useState({});
  const [cantrips, setCantrips] = useState([]);
  const [spells, setSpells] = useState([]);
  const [skills, setSkills] = useState([]);
  const [expertise, setExpertise] = useState([]);
  const [busy, setBusy] = useState(false);
  const opts = useMemo(() => { try { return spellOptions(plan.classKey, plan.classLevel, srd, { abilities: ch.abilities, subclass }); } catch { return null; } }, [plan, srd, ch, subclass]);
  if (plan.error) return <Modal title="Level up" onClose={onClose}><p className="error-text">{plan.error}</p></Modal>;

  const known = new Set([...(ch.spellcasting?.cantrips || []), ...(ch.spellcasting?.known || []), ...(ch.spellcasting?.prepared || [])]);
  const hp = hpMode === 'average' ? plan.hpAverage : hpRoll;
  const haveSkill = (s) => (ch.skillProfs?.[s] || 0) > 0;

  // everything to choose this level, and how many of each (all of it is required)
  const mcSkills = plan.multiclassSkills;
  const loreSkills = plan.classKey === 'bard' && plan.classLevel === 3 && (plan.subclassChoice ? subclass === 'lore' : ch.classes?.find((k) => k.class === 'bard')?.subclass === 'lore');
  const skillPool = mcSkills ? mcSkills.from.filter((s) => !haveSkill(s)) : loreSkills ? Object.keys(SKILL_NAMES).filter((s) => !haveSkill(s)) : [];
  const skillNeed = Math.min(mcSkills ? mcSkills.choose : loreSkills ? 3 : 0, skillPool.length);
  const expertPool = Object.keys(ch.skillProfs || {}).filter((s) => ch.skillProfs[s] === 1);
  const expertNeed = Math.min(plan.expertiseToPick || 0, expertPool.length);
  const maxSpell = plan.classMaxSpellLevel || plan.maxSpellLevel;
  const cantripPool = (opts?.cantrips || []).filter((s) => !known.has(s.index));
  const spellPool = (opts?.spells || []).filter((s) => !known.has(s.index) && s.level <= maxSpell);
  const cantripNeed = Math.min(plan.cantripsToPick || 0, cantripPool.length);
  const spellNeed = Math.min(plan.spellsToPick || 0, spellPool.length);
  const featNeed = (fc) => Math.min(Number(fc.choose) || 1, fc.options.length);
  const asiOk = !plan.asi || asi.mode === 'one' || asi.a !== asi.b;

  const missing = [
    hpMode === 'roll' && !hpRoll && 'roll your hit points',
    plan.subclassChoice && !subclass && 'your path',
    ...(plan.featureChoices || []).filter((fc) => (feat[fc.index] || []).length < featNeed(fc)).map((fc) => fc.name),
    !asiOk && 'two different abilities for +1 / +1',
    skills.length < skillNeed && `${skillNeed - skills.length} more skill${skillNeed - skills.length === 1 ? '' : 's'}`,
    expertise.length < expertNeed && `${expertNeed - expertise.length} more expertise`,
    cantrips.length < cantripNeed && `${cantripNeed - cantrips.length} more cantrip${cantripNeed - cantrips.length === 1 ? '' : 's'}`,
    spells.length < spellNeed && `${spellNeed - spells.length} more spell${spellNeed - spells.length === 1 ? '' : 's'}`,
  ].filter(Boolean);

  // pick one: switch; pick several: add until full, then ask to unpick one first
  function toggle(list, set, value, need, what) {
    if (list.includes(value)) { set(list.filter((x) => x !== value)); return; }
    if (need === 1) { set([value]); return; }
    if (list.length >= need) { toast(`You can choose ${need} ${what}. Unselect one to pick another.`, 'info'); return; }
    set([...list, value]);
  }

  async function apply() {
    if (missing.length) return;
    setBusy(true);
    const choices = {
      class: plan.classKey, hp: Math.max(1, (hp || plan.hpAverage)), hpMethod: hpMode,
      asi: plan.asi ? (asi.mode === 'one' ? { [asi.a]: 2 } : { [asi.a]: 1, [asi.b]: 1 }) : undefined,
      subclass: plan.subclassChoice ? subclass : undefined, cantrips, spells, featureOptions: feat, skills, expertise,
    };
    try {
      const r = await api(`characters/${ch.id}/level-up`, { method: 'POST', body: choices });
      toast(`${ch.name} is now level ${plan.newLevel}${plan.multiclass ? ` (${titleIndex(plan.classKey)} 1)` : ''}!`, 'good');
      if (r.character?.pendingLevelUp) onAgain(); else onClose();
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  }

  const count = (have, need) => <span className={`lu-count ${have >= need ? 'done' : ''}`}>{have} of {need} chosen</span>;

  return (
    <Modal title={`${ch.name}: ${titleIndex(plan.classKey)} level ${plan.classLevel}`} onClose={onClose} wide
      actions={(
        <>
          <button className="btn ghost sm" onClick={onBack}>← Back</button>
          <button className="btn primary sm" disabled={busy || missing.length > 0} onClick={apply}>Level up!</button>
        </>
      )}>
      <div className="col" style={{ gap: 18 }}>
        <div className="small muted">Step 2 of 2: character level {plan.newLevel}{plan.multiclass ? `, your first level as a ${titleIndex(plan.classKey)}` : ''}. Every choice below is needed before you can level up.</div>

        <section>
          <div className="sub-h">Hit points</div>
          <div className="row wrap">
            <div className="tabs" style={{ width: 260 }}><button className={hpMode === 'average' ? 'on' : ''} onClick={() => setHpMode('average')}>Take {plan.hpAverage}</button><button className={hpMode === 'roll' ? 'on' : ''} onClick={() => setHpMode('roll')}>Roll d{plan.hpDie}</button></div>
            {hpMode === 'roll' && <button className="btn" disabled={!!hpRoll} onClick={() => setHpRoll(rollDice(`1d${plan.hpDie}`).total)}>🎲 {hpRoll ? `Rolled ${hpRoll}` : 'Roll'}</button>}
            <span className="muted small">+ {plan.conMod} Constitution = <b>{Math.max(1, (hp || 0) + plan.conMod)}</b> more HP</span>
          </div>
        </section>

        {plan.multiclass && plan.multiclassProficiencies && (
          <div className="tiny muted">You also gain: {['armor', 'weapons', 'tools'].flatMap((k) => plan.multiclassProficiencies[k] || []).join(', ') || 'no new proficiencies'}.</div>
        )}

        {plan.features?.length > 0 && (
          <section><div className="sub-h">New features</div>{plan.features.map((f, i) => <details key={i} className="feature" open={i < 2}><summary><b>{f.name}</b></summary><Markdown text={f.desc} className="prose small-prose" /></details>)}</section>
        )}

        {plan.subclassChoice && (
          <section>
            <div className="sub-h row">Choose your path <span className="spacer" />{count(subclass ? 1 : 0, 1)}</div>
            <div className="lu-cards">
              {plan.subclassOptions.map((s) => (
                <OptionCard key={s.index} on={subclass === s.index} onClick={() => setSubclass(subclass === s.index ? null : s.index)} title={s.name}
                  meta={s.features?.length ? `At this level: ${s.features.filter((f) => f.level <= plan.classLevel).map((f) => f.name).join(', ')}` : ''} text={s.desc} />
              ))}
            </div>
          </section>
        )}

        {plan.featureChoices?.map((fc) => {
          const need = featNeed(fc);
          const list = feat[fc.index] || [];
          return (
            <section key={fc.index}>
              <div className="sub-h row">{fc.name} <span className="spacer" />{count(list.length, need)}</div>
              <div className="lu-cards">
                {fc.options.map((o) => (
                  <OptionCard key={o.index} on={list.includes(o.index)} title={o.name.replace(/^.*?:\s*/, '')} text={o.desc}
                    onClick={() => toggle(list, (v) => setFeat({ ...feat, [fc.index]: v }), o.index, need, 'options')} />
                ))}
              </div>
            </section>
          );
        })}

        {plan.asi && (
          <section>
            <div className="sub-h">Ability score improvement</div>
            <div className="row wrap">
              <div className="tabs" style={{ width: 240 }}><button className={asi.mode === 'two' ? 'on' : ''} onClick={() => setAsi({ ...asi, mode: 'two' })}>+1 / +1</button><button className={asi.mode === 'one' ? 'on' : ''} onClick={() => setAsi({ ...asi, mode: 'one' })}>+2 to one</button></div>
              <select className="select" style={{ width: 'auto' }} value={asi.a} onChange={(e) => setAsi({ ...asi, a: e.target.value })}>{ABILITIES.map((a) => <option key={a} value={a} disabled={ch.abilities[a] >= 20}>{a.toUpperCase()} ({ch.abilities[a]})</option>)}</select>
              {asi.mode === 'two' && <select className="select" style={{ width: 'auto' }} value={asi.b} onChange={(e) => setAsi({ ...asi, b: e.target.value })}>{ABILITIES.map((a) => <option key={a} value={a} disabled={ch.abilities[a] >= 20}>{a.toUpperCase()} ({ch.abilities[a]})</option>)}</select>}
            </div>
            {!asiOk && <div className="tiny error-text">Pick two different abilities for +1 / +1 (or use +2 to one).</div>}
          </section>
        )}

        {skillNeed > 0 && (
          <section>
            <div className="sub-h row">{mcSkills ? 'New skill' : 'Bonus skills (College of Lore)'} <span className="spacer" />{count(skills.length, skillNeed)}</div>
            <div className="lu-cards two">
              {skillPool.map((s) => <OptionCard key={s} on={skills.includes(s)} title={SKILL_NAMES[s] || titleIndex(s)} meta={SKILL_ABILITY[s] || ''} onClick={() => toggle(skills, setSkills, s, skillNeed, 'skills')} />)}
            </div>
          </section>
        )}

        {expertNeed > 0 && (
          <section>
            <div className="sub-h row">Expertise <span className="spacer" />{count(expertise.length, expertNeed)}</div>
            <div className="tiny muted" style={{ marginBottom: 6 }}>Your proficiency bonus is doubled for these skills.</div>
            <div className="lu-cards two">
              {expertPool.map((s) => <OptionCard key={s} on={expertise.includes(s)} title={SKILL_NAMES[s] || titleIndex(s)} meta={SKILL_ABILITY[s] || ''} onClick={() => toggle(expertise, setExpertise, s, expertNeed, 'skills')} />)}
            </div>
          </section>
        )}

        {cantripNeed > 0 && (
          <section>
            <div className="sub-h row">New cantrips <span className="spacer" />{count(cantrips.length, cantripNeed)}</div>
            <div className="lu-cards">{cantripPool.map((s) => <SpellOption key={s.index} spell={s} on={cantrips.includes(s.index)} onClick={() => toggle(cantrips, setCantrips, s.index, cantripNeed, 'cantrips')} />)}</div>
          </section>
        )}

        {spellNeed > 0 && (
          <section>
            <div className="sub-h row">New spells <span className="tiny muted">&nbsp;up to level {maxSpell}</span><span className="spacer" />{count(spells.length, spellNeed)}</div>
            <div className="lu-cards">{spellPool.map((s) => <SpellOption key={s.index} spell={s} on={spells.includes(s.index)} onClick={() => toggle(spells, setSpells, s.index, spellNeed, 'spells')} />)}</div>
          </section>
        )}

        <div className="tiny muted">Proficiency bonus becomes +{plan.profBonus}. {plan.slots?.some(Boolean) ? `Spell slots: ${plan.slots.map((n, i) => (n ? `L${i + 1}×${n}` : '')).filter(Boolean).join(', ')}.` : ''}</div>
        <div className={`lu-footer ${missing.length ? '' : 'ready'}`}>
          <span>{missing.length ? <>Still to choose: <b>{missing.join(', ')}</b></> : 'All set.'}</span>
          <button className="btn primary sm" disabled={busy || missing.length > 0} onClick={apply}>Level up!</button>
        </div>
      </div>
    </Modal>
  );
}

const SKILL_ABILITY = {
  acrobatics: 'Dexterity', animalHandling: 'Wisdom', arcana: 'Intelligence', athletics: 'Strength', deception: 'Charisma', history: 'Intelligence',
  insight: 'Wisdom', intimidation: 'Charisma', investigation: 'Intelligence', medicine: 'Wisdom', nature: 'Intelligence', perception: 'Wisdom',
  performance: 'Charisma', persuasion: 'Charisma', religion: 'Intelligence', sleightOfHand: 'Dexterity', stealth: 'Dexterity', survival: 'Wisdom',
};

/** A full-width choice card: a check, the name, a short line of details and the description, all in the bubble. */
function OptionCard({ on, onClick, title, meta, text, children }) {
  const [more, setMore] = useState(false);
  const [cut, setCut] = useState(false);
  const ref = useRef(null);
  // "Read more" only when the description really is cut off
  useLayoutEffect(() => { const el = ref.current; if (el && !more) setCut(el.scrollHeight > el.clientHeight + 2); }, [text, more]);
  const long = cut || more;
  return (
    <div role="button" tabIndex={0} aria-pressed={on} className={`lu-card ${on ? 'on' : ''}`} onClick={onClick} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick())}>
      <span className="lu-check">{on ? '✓' : ''}</span>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="lu-title">{title}</div>
        {meta && <div className="lu-meta">{meta}</div>}
        {children}
        {text && <div ref={ref} className={`lu-text ${more ? '' : 'clamp'}`}><Markdown text={text} className="prose small-prose" /></div>}
        {long && <button type="button" className="btn ghost xs lu-more" onClick={(e) => { e.stopPropagation(); setMore(!more); }}>{more ? 'Show less' : 'Read more'}</button>}
      </div>
    </div>
  );
}

const ORD = (n) => (n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

/** A spell as a full-width card: level and school, casting time, range, components, duration, and what it does. */
function SpellOption({ spell: s, on, onClick }) {
  const kind = s.level ? `${ORD(s.level)}-level ${String(s.school || '').toLowerCase()}` : `${String(s.school || '').toLowerCase()} cantrip`;
  const meta = [kind + (s.ritual ? ' (ritual)' : ''), s.castingTime, s.range + (s.area ? ` (${s.area.size}-ft ${s.area.type})` : ''), (s.components || []).join(', '), `${s.concentration ? 'concentration, ' : ''}${s.duration || ''}`].filter(Boolean).join(' · ');
  const text = [s.desc, s.higherLevel && `**At higher levels.** ${s.higherLevel}`].filter(Boolean).join('\n\n');
  return <OptionCard on={on} onClick={onClick} title={s.name} meta={meta} text={text} />;
}

const PRIMARY = { barbarian: 'str', bard: 'cha', cleric: 'wis', druid: 'wis', fighter: 'str', monk: 'dex', paladin: 'str', ranger: 'dex', rogue: 'dex', sorcerer: 'cha', warlock: 'cha', wizard: 'int' };
function bestAbility(ch, classKey) {
  return PRIMARY[classKey] || ABILITIES.reduce((a, b) => ((ch.abilities?.[b] || 0) > (ch.abilities?.[a] || 0) ? b : a), 'str');
}
