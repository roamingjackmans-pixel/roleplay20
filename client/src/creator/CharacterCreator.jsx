import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useStore } from '../lib/store.js';
import { TopNav, Splash } from '../App.jsx';
import { Avatar, fmtMod, titleIndex, Markdown } from '../lib/format.jsx';
import { STANDARD_ARRAY, POINT_BUY_COSTS, POINT_BUY_BUDGET, ALIGNMENTS, CLASS_COLORS, pointBuyCost, racialBonuses, startingEquipmentOptions, spellOptions, buildCharacter } from '../../../shared/charbuild.js';
import { deriveCharacter, abilityMod, ABILITIES, SKILL_NAMES } from '../../../shared/rules.js';
import { rollDice } from '../../../shared/dice.js';
import SpellCard from '../sheet/SpellCard.jsx';

const ABIL_NAMES = { str: 'Strength', dex: 'Dexterity', con: 'Constitution', int: 'Intelligence', wis: 'Wisdom', cha: 'Charisma' };
const CLASS_BLURB = {
  barbarian: 'A storm of fury and muscle. Rages to shrug off blows and hit harder.',
  bard: 'A performer whose words and music are literal magic. Inspires allies, charms foes.',
  cleric: 'A chosen servant of a god. Heals, protects, and smites with divine power.',
  druid: 'A keeper of the wild who wields nature magic and takes the shapes of beasts.',
  fighter: 'A master of weapons and armor. Reliable, versatile, and hard to kill.',
  monk: 'A disciplined martial artist who channels ki into blinding speed and strikes.',
  paladin: 'A holy knight bound by an oath. Heavy armor, healing hands, radiant smites.',
  ranger: 'A hunter and tracker of the wilds, deadly with bow and blade.',
  rogue: 'A sneak, a scout, a specialist. Strikes precisely when the foe is distracted.',
  sorcerer: 'Magic flows in your blood. Fewer spells, but you can bend them to your will.',
  warlock: 'Power bargained from an otherworldly patron. Eldritch blasts and dark gifts.',
  wizard: 'A scholar of the arcane with a spellbook full of world-shaping magic.',
};
const STEPS = ['Concept', 'Abilities', 'Skills', 'Spells', 'Gear', 'Personality', 'Review'];
const CLASS_PRIORITY = {
  barbarian: ['str', 'con', 'dex', 'wis', 'cha', 'int'], bard: ['cha', 'dex', 'con', 'wis', 'int', 'str'], cleric: ['wis', 'con', 'str', 'dex', 'cha', 'int'],
  druid: ['wis', 'con', 'dex', 'int', 'cha', 'str'], fighter: ['str', 'con', 'dex', 'wis', 'cha', 'int'], monk: ['dex', 'wis', 'con', 'str', 'int', 'cha'],
  paladin: ['str', 'cha', 'con', 'wis', 'dex', 'int'], ranger: ['dex', 'wis', 'con', 'str', 'int', 'cha'], rogue: ['dex', 'con', 'int', 'wis', 'cha', 'str'],
  sorcerer: ['cha', 'con', 'dex', 'wis', 'int', 'str'], warlock: ['cha', 'con', 'dex', 'wis', 'int', 'str'], wizard: ['int', 'con', 'dex', 'wis', 'cha', 'str'],
};
/** Re-arrange the current scores so the class's important abilities get the best ones. */
function arrangeFor(cls, base) {
  const order = CLASS_PRIORITY[cls] || ABILITIES;
  const vals = Object.values(base).sort((a, b) => b - a);
  const out = {};
  order.forEach((a, i) => { out[a] = vals[i]; });
  return out;
}

export default function CharacterCreator({ campaignId }) {
  const srd = useStore((s) => s.srd);
  const go = useStore((s) => s.go);
  const toast = useStore((s) => s.toast);
  const user = useStore((s) => s.user);
  const [camp, setCamp] = useState(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [ch, setCh] = useState({
    name: '', race: 'human', subrace: null, class: 'fighter', subclass: null, background: 'soldier', alignment: 'Neutral Good',
    abilityMethod: 'standard', base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 }, rolled: null, bonusChoices: [],
    skills: [], expertise: [], equipment: [], cantrips: [], spells: [], hpMethod: 'average',
    personality: { traits: '', ideals: '', bonds: '', flaws: '' }, appearance: '', backstory: '', portrait: null, color: null, prompt: '',
  });
  const up = (patch) => setCh((c) => ({ ...c, ...patch }));

  useEffect(() => { api(`campaigns/${campaignId}`).then(setCamp).catch(() => {}); }, [campaignId]);
  if (!srd || !camp) return <Splash text="Unrolling the character sheet…" />;

  // new characters join at the party's level (the server decides it)
  const level = Math.max(1, Math.min(20, Number(camp.startLevel || 1)));
  const current = camp.campaign?.members?.find((m) => m.userId === user.id)?.character;
  if (current) {
    return (
      <>
        <TopNav><button className="btn ghost sm" onClick={() => go(`#/c/${campaignId}`)}>← {camp.world?.title || camp.campaign.name}</button></TopNav>
        <div className="page"><div className="page-inner"><div className="card" style={{ maxWidth: 560 }}>
          <h2 className="section">You already play {current.name}</h2>
          <p className="muted">To start someone new, open your character sheet at the table and choose <b>Retire</b> at the bottom. {current.name}'s story stays in the journal, and your new character joins at the party's level.</p>
          <button className="btn primary" onClick={() => go(`#/c/${campaignId}/play`)}>Go to the table</button>
        </div></div></div>
      </>
    );
  }
  const joining = (camp.campaign?.members || []).some((m) => m.character && m.userId !== user.id);
  return (
    <CreatorBody {...{ srd, camp, ch, up, step, setStep, busy, setBusy, go, toast, campaignId, user, startLevel: level, joining }} />
  );
}

function CreatorBody({ srd, camp, ch, up, step, setStep, busy, setBusy, go, toast, campaignId, user, startLevel, joining }) {
  const cls = srd.by.classes.get(ch.class);
  const race = srd.by.races.get(ch.race);
  const sub = race?.subraces?.find((s) => s.index === ch.subrace) || race?.subraces?.[0] || null;
  const bg = srd.by.backgrounds.get(ch.background);
  const level = Number(startLevel) || 1;
  const needsSubclass = cls && level >= (cls.subclassLevel || 3);
  const spellInfo = useMemo(() => {
    try { return spellOptions(ch.class, level, srd, { abilities: finalAbilities(), subclass: ch.subclass }); } catch { return null; }
  }, [ch.class, level, ch.subclass, ch.base, ch.race, ch.subrace, ch.bonusChoices]); // eslint-disable-line
  const isCaster = !!(spellInfo && (spellInfo.cantripsToPick || spellInfo.spellsToPick));

  function bonuses() {
    try { return racialBonuses(race, sub, ch.bonusChoices, srd); } catch { return {}; }
  }
  function finalAbilities() {
    const b = bonuses();
    const out = {};
    for (const a of ABILITIES) out[a] = Math.min(20, (Number(ch.base[a]) || 10) + (b[a] || 0));
    return out;
  }
  function choices() {
    return {
      name: ch.name.trim() || 'Nameless', race: ch.race, subrace: sub?.index || null, class: ch.class, subclass: needsSubclass ? ch.subclass || cls?.subclasses?.[0]?.index : null,
      background: ch.background, alignment: ch.alignment, level, baseAbilities: ch.base, abilityMethod: ch.abilityMethod, bonusChoices: ch.bonusChoices,
      skills: ch.skills, expertise: ch.expertise, equipment: ch.equipment, cantrips: ch.cantrips, spells: ch.spells, prepared: ch.spells, hpMethod: ch.hpMethod,
      personality: ch.personality, appearance: ch.appearance, backstory: ch.backstory, portrait: ch.portrait, color: ch.color || CLASS_COLORS[ch.class], playerName: user.displayName,
    };
  }
  const preview = useMemo(() => {
    try { const c = buildCharacter(choices(), srd); return { c, d: deriveCharacter(c, srd) }; } catch (e) { return { err: e.message }; }
  }, [ch, level]); // eslint-disable-line

  const visibleSteps = STEPS.filter((s) => s !== 'Spells' || isCaster);
  const cur = visibleSteps[Math.min(step, visibleSteps.length - 1)];
  const canNext = cur !== 'Concept' || ch.name.trim();

  async function create() {
    setBusy(true);
    try {
      await api(`campaigns/${campaignId}/characters`, { method: 'POST', body: { choices: choices() } });
      toast(`${ch.name || 'Your hero'} is ready for adventure!`, 'good');
      go(`#/c/${campaignId}/play`);
    } catch (e) { toast(e.message, 'bad'); setBusy(false); }
  }

  return (
    <>
      <TopNav><button className="btn ghost sm" onClick={() => go(`#/c/${campaignId}`)}>← {camp.world?.title || camp.campaign.name}</button></TopNav>
      <div className="page">
        <div className="page-inner creator">
          <div className="creator-head">
            <div>
              <h1 className="title" style={{ marginBottom: 2 }}>Create your character</h1>
              <div className="muted">Level {level} · for <b>{camp.world?.title || camp.campaign.name}</b>{joining && level > 1 ? ` · joining at level ${level} to match the party` : ''}</div>
            </div>
            <div className="stepper">
              {visibleSteps.map((s, i) => (
                <button key={s} className={`step ${i === step ? 'on' : ''} ${i < step ? 'done' : ''}`} onClick={() => (i <= step || canNext) && setStep(i)}>
                  <span>{i < step ? '✓' : i + 1}</span>{s}
                </button>
              ))}
            </div>
          </div>

          <div className="creator-grid">
            <div className="card pad creator-main fade-in" key={cur}>
              {cur === 'Concept' && <ConceptStep {...{ srd, ch, up, cls, race, sub, bg, needsSubclass, camp }} />}
              {cur === 'Abilities' && <AbilitiesStep {...{ ch, up, race, sub, bonuses: bonuses(), final: finalAbilities(), cls }} />}
              {cur === 'Skills' && <SkillsStep {...{ srd, ch, up, cls, bg, race, sub, level }} />}
              {cur === 'Spells' && <SpellsStep {...{ ch, up, spellInfo, cls }} />}
              {cur === 'Gear' && <GearStep {...{ srd, ch, up, cls, bg }} />}
              {cur === 'Personality' && <PersonalityStep {...{ ch, up, bg, campaignId, toast, camp, choices }} />}
              {cur === 'Review' && <ReviewStep {...{ preview, ch, up, srd }} />}
              <div className="row" style={{ marginTop: 22 }}>
                {step > 0 && <button className="btn" onClick={() => setStep(step - 1)}>← Back</button>}
                <div className="spacer" />
                {cur !== 'Review'
                  ? <button className="btn primary" disabled={!canNext} onClick={() => setStep(step + 1)}>Next: {visibleSteps[step + 1]} →</button>
                  : <button className="btn primary lg" disabled={busy || !!preview.err} onClick={create}>{busy ? <span className="spinner" /> : '✦ Begin the adventure'}</button>}
              </div>
            </div>
            <aside className="creator-side">
              <PreviewCard preview={preview} ch={ch} />
            </aside>
          </div>
        </div>
      </div>
    </>
  );
}

function PreviewCard({ preview, ch }) {
  const { c, d, err } = preview;
  if (err) return <div className="card pad small error-text">{err}</div>;
  if (!c) return null;
  return (
    <div className="card pad preview-card">
      <div className="row" style={{ gap: 12 }}>
        <Avatar size="lg" name={c.name} color={c.color} img={c.portrait} />
        <div className="grow">
          <div className="display" style={{ fontSize: 18 }}>{ch.name || 'Nameless hero'}</div>
          <div className="muted small">Level {c.level} {titleIndex(c.subrace || c.race)} {titleIndex(c.class)}{c.subclass ? ` (${titleIndex(c.subclass)})` : ''}</div>
        </div>
      </div>
      <div className="mini-stats">
        <div><b>{d.ac}</b><span>AC</span></div>
        <div><b>{c.hp.max}</b><span>HP</span></div>
        <div><b>{fmtMod(d.initiative)}</b><span>Init</span></div>
        <div><b>{d.speed}</b><span>Speed</span></div>
      </div>
      <div className="mini-abils">
        {ABILITIES.map((a) => <div key={a}><span>{a.toUpperCase()}</span><b>{c.abilities[a]}</b><i>{fmtMod(abilityMod(c.abilities[a]))}</i></div>)}
      </div>
      {d.attacks?.length > 0 && <div className="tiny muted" style={{ marginTop: 10 }}>⚔ {d.attacks.slice(0, 3).map((a) => `${a.name} ${fmtMod(a.bonus)} (${a.damage})`).join(' · ')}</div>}
      {d.spellcasting && <div className="tiny muted" style={{ marginTop: 6 }}>✨ Spell save DC {d.spellcasting.dc}, attack {fmtMod(d.spellcasting.attack)}</div>}
    </div>
  );
}

function ConceptStep({ srd, ch, up, cls, race, sub, bg, needsSubclass, camp }) {
  return (
    <div className="col" style={{ gap: 18 }}>
      <label className="field"><span>Name</span><input className="input" style={{ fontSize: 18, fontFamily: 'var(--display)' }} value={ch.name} onChange={(e) => up({ name: e.target.value })} placeholder="What do they call you?" autoFocus /></label>
      <div className="field"><span>Race</span>
        <div className="pick-grid">
          {srd.races.map((r) => (
            <button key={r.index} className={`pick ${ch.race === r.index ? 'on' : ''}`} onClick={() => up({ race: r.index, subrace: r.subraces?.[0]?.index || null, bonusChoices: [] })}>
              <b>{r.name}</b>
              <span>{Object.entries(r.abilityBonuses || {}).map(([k, v]) => `${k.toUpperCase()} +${v}`).join(', ')}{r.bonusChoices ? ` +${r.bonusChoices.amount} ×${r.bonusChoices.choose}` : ''}</span>
              <span>{r.speed} ft{r.darkvision ? ` · darkvision ${r.darkvision}` : ''}</span>
            </button>
          ))}
        </div>
      </div>
      {race?.subraces?.length > 0 && (
        <div className="field"><span>Subrace</span>
          <div className="chips">{race.subraces.map((s) => <button key={s.index} className={`chip ${sub?.index === s.index ? 'on' : ''}`} onClick={() => up({ subrace: s.index })}>{s.name}</button>)}</div>
        </div>
      )}
      {race && <details className="lore"><summary>{race.name} traits</summary>{[...(race.traits || []), ...(sub?.traits || [])].map((t) => <p key={t.index}><b>{t.name}.</b> {t.desc.slice(0, 400)}</p>)}</details>}
      <div className="field"><span>Class</span>
        <div className="pick-grid">
          {srd.classes.map((c) => (
            <button key={c.index} className={`pick ${ch.class === c.index ? 'on' : ''}`} onClick={() => up({ class: c.index, subclass: c.subclasses?.[0]?.index || null, skills: [], expertise: [], equipment: [], cantrips: [], spells: [], ...(ch.abilityMethod === 'manual' ? {} : { base: arrangeFor(c.index, ch.base) }) })} style={{ '--pc': CLASS_COLORS[c.index] }}>
              <b>{c.name}</b>
              <span>d{c.hitDie} · {(c.primaryAbility || '').toUpperCase()}{c.spellcasting ? ' · magic' : ''}</span>
              <span className="blurb">{CLASS_BLURB[c.index]}</span>
            </button>
          ))}
        </div>
      </div>
      {needsSubclass && cls?.subclasses?.length > 0 && (
        <div className="field"><span>{cls.subclassFlavor || 'Subclass'}</span>
          <div className="chips">{cls.subclasses.map((s) => <button key={s.index} className={`chip ${(ch.subclass || cls.subclasses[0].index) === s.index ? 'on' : ''}`} onClick={() => up({ subclass: s.index })}>{s.name}</button>)}</div>
        </div>
      )}
      <div className="row wrap" style={{ gap: 18, alignItems: 'flex-start' }}>
        <label className="field grow" style={{ minWidth: 220 }}><span>Background</span>
          <select className="select" value={ch.background} onChange={(e) => up({ background: e.target.value })}>
            {srd.backgrounds.map((b) => <option key={b.index} value={b.index}>{b.name} ({b.skills.map((s) => SKILL_NAMES[s]).join(', ')})</option>)}
          </select>
        </label>
        <label className="field grow" style={{ minWidth: 200 }}><span>Alignment</span>
          <select className="select" value={ch.alignment} onChange={(e) => up({ alignment: e.target.value })}>{ALIGNMENTS.map((a) => <option key={a}>{a}</option>)}</select>
        </label>
      </div>
      {bg?.feature && <div className="lore"><b>{bg.feature.name}.</b> {bg.feature.desc}</div>}
      {camp.world?.characterPrompts?.length > 0 && (
        <div className="field"><span>Answer one of the campaign's character questions (optional)</span>
          <div className="col">{camp.world.characterPrompts.map((p) => <button key={p} className={`pick wide ${ch.prompt === p ? 'on' : ''}`} onClick={() => up({ prompt: ch.prompt === p ? '' : p })}><span className="story" style={{ fontSize: 15.5 }}>✦ {p}</span></button>)}</div>
        </div>
      )}
    </div>
  );
}

function AbilitiesStep({ ch, up, race, sub, bonuses, final, cls }) {
  const method = ch.abilityMethod;
  const setBase = (a, v) => up({ base: { ...ch.base, [a]: v } });
  const cost = method === 'pointbuy' ? pointBuyCost(ch.base) : 0;
  const used = (v, a) => method === 'standard' && Object.entries(ch.base).some(([k, x]) => k !== a && x === v);
  const pool = method === 'roll' && ch.rolled ? ch.rolled : STANDARD_ARRAY;

  function roll() {
    const vals = ABILITIES.map(() => rollDice('4d6kh3').total).sort((a, b) => b - a);
    const order = [...ABILITIES].sort((a, b) => (cls?.primaryAbility === a ? -1 : cls?.primaryAbility === b ? 1 : 0));
    const base = {};
    order.forEach((a, i) => { base[a] = vals[i]; });
    up({ rolled: vals, base });
  }
  function setMethod(m) {
    if (m === 'standard') up({ abilityMethod: m, base: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 } });
    else if (m === 'pointbuy') up({ abilityMethod: m, base: { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 } });
    else if (m === 'roll') { up({ abilityMethod: m }); setTimeout(roll, 0); }
    else up({ abilityMethod: m });
  }
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="tabs">
        {[['standard', 'Standard array'], ['pointbuy', 'Point buy'], ['roll', 'Roll 4d6'], ['manual', 'Enter my own']].map(([k, l]) => <button key={k} className={method === k ? 'on' : ''} onClick={() => setMethod(k)}>{l}</button>)}
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {method === 'standard' && 'Assign 15, 14, 13, 12, 10 and 8 - each once.'}
        {method === 'pointbuy' && `Spend up to ${POINT_BUY_BUDGET} points (scores 8-15). Points left: ${POINT_BUY_BUDGET - cost}.`}
        {method === 'roll' && 'Roll four d6 for each score and keep the best three. Feeling lucky?'}
        {method === 'manual' && 'Rolled at the table? Type your scores in.'}
      </p>
      {method === 'roll' && <div className="row"><button className="btn" onClick={roll}>🎲 Reroll all</button><span className="muted small">Rolled: {(ch.rolled || []).join(', ')}</span></div>}
      {race?.bonusChoices && (
        <div className="field"><span>{race.name}: choose {race.bonusChoices.choose} abilities for +{race.bonusChoices.amount}</span>
          <div className="chips">{race.bonusChoices.from.map((a) => {
            const on = ch.bonusChoices.includes(a);
            return <button key={a} className={`chip ${on ? 'on' : ''}`} onClick={() => up({ bonusChoices: on ? ch.bonusChoices.filter((x) => x !== a) : [...ch.bonusChoices, a].slice(-race.bonusChoices.choose) })}>{ABIL_NAMES[a]}</button>;
          })}</div>
        </div>
      )}
      <div className="abil-grid">
        {ABILITIES.map((a) => (
          <div key={a} className={`abil-box ${cls?.primaryAbility === a ? 'primary' : ''}`}>
            <div className="abil-name">{ABIL_NAMES[a]}</div>
            {method === 'pointbuy' ? (
              <div className="row" style={{ justifyContent: 'center' }}>
                <button className="btn xs" disabled={ch.base[a] <= 8} onClick={() => setBase(a, ch.base[a] - 1)}>−</button>
                <b className="abil-base">{ch.base[a]}</b>
                <button className="btn xs" disabled={ch.base[a] >= 15 || cost + (POINT_BUY_COSTS[ch.base[a] + 1] - POINT_BUY_COSTS[ch.base[a]]) > POINT_BUY_BUDGET} onClick={() => setBase(a, ch.base[a] + 1)}>+</button>
              </div>
            ) : method === 'manual' ? (
              <input className="input" type="number" min={3} max={20} value={ch.base[a]} onChange={(e) => setBase(a, Math.max(3, Math.min(20, Number(e.target.value) || 10)))} style={{ textAlign: 'center' }} />
            ) : (
              <select className="select" value={ch.base[a]} onChange={(e) => {
                const v = Number(e.target.value);
                const other = Object.entries(ch.base).find(([k, x]) => k !== a && x === v)?.[0];
                const base = { ...ch.base, [a]: v };
                if (other && method === 'standard') base[other] = ch.base[a];
                up({ base });
              }}>
                {[...new Set(pool)].map((v, i) => <option key={i} value={v} disabled={false}>{v}{used(v, a) ? ' (swap)' : ''}</option>)}
              </select>
            )}
            <div className="abil-final"><b>{final[a]}</b><span>{fmtMod(abilityMod(final[a]))}</span></div>
            {bonuses[a] ? <div className="tiny gold">+{bonuses[a]} {sub?.abilityBonuses?.[a] ? sub.name : race?.name}</div> : <div className="tiny faint">&nbsp;</div>}
          </div>
        ))}
      </div>
      {cls && <p className="muted small" style={{ margin: 0 }}>{cls.name}s rely on <b>{ABIL_NAMES[cls.primaryAbility] || 'their best ability'}</b>{cls.spellcasting ? ` and cast with ${ABIL_NAMES[cls.spellcasting.ability]}` : ''}. Constitution adds hit points.</p>}
    </div>
  );
}

function SkillsStep({ srd, ch, up, cls, bg, race, sub }) {
  const fixed = new Set([...(bg?.skills || []), ...(race?.proficiencies?.skills || []), ...(sub?.proficiencies?.skills || [])]);
  const n = cls?.skillChoices?.choose || 2;
  const from = cls?.skillChoices?.from || [];
  const picked = ch.skills.filter((s) => !fixed.has(s));
  const toggle = (s) => {
    if (fixed.has(s)) return;
    const on = ch.skills.includes(s);
    up({ skills: on ? ch.skills.filter((x) => x !== s) : picked.length < n ? [...ch.skills, s] : ch.skills });
  };
  const expertiseN = ch.class === 'rogue' ? 2 : 0;
  const profs = [...new Set([...fixed, ...ch.skills])];
  return (
    <div className="col" style={{ gap: 16 }}>
      <div><b>Choose {n} {cls?.name} skills</b> <span className="muted small">({picked.length}/{n})</span></div>
      <div className="skill-grid">
        {Object.keys(SKILL_NAMES).map((s) => {
          const isFixed = fixed.has(s);
          const allowed = from.includes(s);
          const on = isFixed || ch.skills.includes(s);
          const skill = srd.skills.find?.((x) => x.key === s);
          return (
            <button key={s} className={`skill-pick ${on ? 'on' : ''} ${isFixed ? 'fixed' : ''}`} disabled={!isFixed && !allowed} onClick={() => toggle(s)} title={skill?.desc}>
              <span className="dot" />{SKILL_NAMES[s]} <i>{skill?.ability?.toUpperCase()}</i>
              {isFixed && <em>{bg?.skills?.includes(s) ? bg.name : 'race'}</em>}
            </button>
          );
        })}
      </div>
      {expertiseN > 0 && (
        <>
          <div><b>Expertise:</b> <span className="muted small">pick {expertiseN} of your proficient skills to double your proficiency bonus</span></div>
          <div className="chips">{profs.map((s) => {
            const on = ch.expertise.includes(s);
            return <button key={s} className={`chip ${on ? 'on' : ''}`} onClick={() => up({ expertise: on ? ch.expertise.filter((x) => x !== s) : [...ch.expertise, s].slice(-expertiseN) })}>{SKILL_NAMES[s]}</button>;
          })}</div>
        </>
      )}
      <p className="muted small" style={{ margin: 0 }}>Tools and languages from your race, class and background are added automatically.</p>
    </div>
  );
}

function SpellsStep({ ch, up, spellInfo, cls }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  if (!spellInfo) return null;
  const toggle = (key, idx, max) => {
    const list = ch[key];
    up({ [key]: list.includes(idx) ? list.filter((x) => x !== idx) : list.length < max ? [...list, idx] : list });
  };
  const filt = (arr) => arr.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase()));
  const mode = spellInfo.mode;
  const verb = mode === 'prepared' ? 'Prepare' : mode === 'spellbook' ? 'Write in your spellbook' : 'Learn';
  return (
    <div className="col" style={{ gap: 14 }}>
      <input className="input" placeholder="Search spells…" value={q} onChange={(e) => setQ(e.target.value)} />
      {spellInfo.cantripsToPick > 0 && (
        <>
          <div><b>Cantrips</b> <span className="muted small">({ch.cantrips.length}/{spellInfo.cantripsToPick}) - cast at will, forever</span></div>
          <div className="spell-pick-grid">{filt(spellInfo.cantrips).map((s) => <SpellPick key={s.index} s={s} on={ch.cantrips.includes(s.index)} onToggle={() => toggle('cantrips', s.index, spellInfo.cantripsToPick)} onInfo={() => setOpen(s)} />)}</div>
        </>
      )}
      {spellInfo.spellsToPick > 0 && (
        <>
          <div><b>{verb} {spellInfo.spellsToPick} spells</b> <span className="muted small">({ch.spells.length}/{spellInfo.spellsToPick}) - up to level {spellInfo.maxSpellLevel}{mode === 'prepared' ? '. You can change prepared spells after a long rest.' : ''}</span></div>
          <div className="spell-pick-grid">{filt(spellInfo.spells).map((s) => <SpellPick key={s.index} s={s} on={ch.spells.includes(s.index)} onToggle={() => toggle('spells', s.index, spellInfo.spellsToPick)} onInfo={() => setOpen(s)} />)}</div>
        </>
      )}
      {spellInfo.alwaysPrepared?.length > 0 && <p className="muted small">Always prepared from your {cls?.subclassFlavor || 'subclass'}: {spellInfo.alwaysPrepared.map(titleIndex).join(', ')}</p>}
      <p className="muted small" style={{ margin: 0 }}>Leave any empty and your Dungeon Master's recommendations are used.</p>
      {open && <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && setOpen(null)}><div className="card modal pad"><SpellCard spell={open} /><div className="row" style={{ marginTop: 12 }}><div className="spacer" /><button className="btn" onClick={() => setOpen(null)}>Close</button></div></div></div>}
    </div>
  );
}

function SpellPick({ s, on, onToggle, onInfo }) {
  return (
    <div className={`spell-pick ${on ? 'on' : ''}`}>
      <button className="spell-pick-main" onClick={onToggle}>
        <span className="dot" />
        <span className="grow"><b>{s.name}</b><span className="tiny muted">{s.level ? `L${s.level}` : 'cantrip'} · {s.school}{s.concentration ? ' · conc.' : ''}{s.ritual ? ' · ritual' : ''}{s.damage ? ` · ${s.damage.type}` : ''}{s.heal ? ' · healing' : ''}</span></span>
      </button>
      <button className="btn ghost xs" onClick={onInfo} title="Read spell">?</button>
    </div>
  );
}

function GearStep({ srd, ch, up, cls, bg }) {
  const sets = useMemo(() => { try { return startingEquipmentOptions(ch.class, srd); } catch { return []; } }, [ch.class, srd]);
  const sel = (i) => ch.equipment[i] ?? { option: 0, picks: [] };
  const setSel = (i, v) => { const e = [...ch.equipment]; while (e.length < sets.length) e.push({ option: 0, picks: [] }); e[i] = v; up({ equipment: e }); };
  return (
    <div className="col" style={{ gap: 16 }}>
      {(cls?.startingEquipment || []).length > 0 && <div className="muted small">Always: {cls.startingEquipment.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join(', ')}</div>}
      {sets.map((set, i) => {
        const s = sel(i);
        return (
          <div key={i} className="gear-set">
            <div className="tiny muted" style={{ marginBottom: 6 }}>{set.desc}</div>
            <div className="chips">
              {set.options.map((o, oi) => <button key={oi} className={`chip ${s.option === oi ? 'on' : ''}`} onClick={() => setSel(i, { option: oi, picks: [] })}>{o.label}{o.note ? ` (${o.note})` : ''}</button>)}
            </div>
            {set.options[s.option]?.picks?.map((p, pi) => (
              <div key={pi} className="row wrap" style={{ marginTop: 8, gap: 6 }}>
                <span className="small muted">{p.desc}:</span>
                {Array.from({ length: p.choose }).map((_, k) => (
                  <select key={k} className="select" style={{ width: 'auto', minWidth: 160 }} value={s.picks?.[pi]?.[k] || ''} onChange={(e) => {
                    const picks = (s.picks || []).map((x) => [...(x || [])]);
                    while (picks.length <= pi) picks.push([]);
                    picks[pi][k] = e.target.value;
                    setSel(i, { ...s, picks });
                  }}>
                    <option value="">(recommended)</option>
                    {p.from.map((f) => <option key={f.index} value={f.index}>{f.name}</option>)}
                  </select>
                ))}
              </div>
            ))}
          </div>
        );
      })}
      {bg && <div className="muted small">From your background ({bg.name}): {(bg.equipment || []).map((i) => i.name).join(', ')}{bg.gold ? `, ${bg.gold} gp` : ''}</div>}
    </div>
  );
}

function PersonalityStep({ ch, up, bg, campaignId, toast, camp, choices }) {
  const [asking, setAsking] = useState(false);
  const [names, setNames] = useState([]);
  const sug = bg?.suggestions || {};
  const setP = (k, v) => up({ personality: { ...ch.personality, [k]: v } });
  const rand = (arr) => (arr?.length ? arr[Math.floor(Math.random() * arr.length)] : '');
  async function ask() {
    setAsking(true);
    try {
      const c = choices();
      const r = await api(`campaigns/${campaignId}/character-assist`, { method: 'POST', body: { ...c, portrait: undefined, prompt: ch.prompt, concept: { traits: ch.personality, appearance: ch.appearance, backstory: ch.backstory } } });
      const s = r.suggestion;
      up({
        personality: { traits: ch.personality.traits || s.traits, ideals: ch.personality.ideals || s.ideals, bonds: ch.personality.bonds || s.bonds, flaws: ch.personality.flaws || s.flaws },
        appearance: ch.appearance || s.appearance, backstory: ch.backstory || `${s.backstory}${s.worldConnections ? `\n\n${s.worldConnections}` : ''}`,
      });
      setNames(s.names || []);
    } catch (e) { toast(e.message, 'bad'); }
    setAsking(false);
  }
  function portrait(e) {
    const f = e.target.files?.[0];
    if (!f) return;
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const s = Math.min(img.width, img.height);
      cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, 256, 256);
      up({ portrait: cv.toDataURL('image/jpeg', 0.85) });
    };
    img.src = URL.createObjectURL(f);
  }
  const Field = ({ k, label }) => (
    <label className="field"><span className="row">{label}<span className="spacer" />{sug[k]?.length > 0 && <button type="button" className="btn ghost xs" onClick={() => setP(k, rand(sug[k]))}>🎲 suggest</button>}</span>
      <textarea className="textarea" style={{ minHeight: 56 }} value={ch.personality[k]} onChange={(e) => setP(k, e.target.value)} />
    </label>
  );
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="assist-banner">
        <div className="grow"><b>Stuck? Ask the Dungeon Master.</b><div className="muted small">Claude reads the campaign world{ch.prompt ? ' and your chosen question' : ''}, then drafts a personality and backstory tied into it. You can edit everything.</div></div>
        <button className="btn primary" onClick={ask} disabled={asking}>{asking ? <span className="spinner" /> : '✨ Draft for me'}</button>
      </div>
      {names.length > 0 && <div className="row wrap"><span className="small muted">Name ideas:</span>{names.map((n) => <button key={n} className="chip" onClick={() => up({ name: n })}>{n}</button>)}</div>}
      {ch.prompt && <div className="lore story">✦ {ch.prompt}</div>}
      <div className="two-col">
        <Field k="traits" label="Personality traits" />
        <Field k="ideals" label="Ideals" />
        <Field k="bonds" label="Bonds" />
        <Field k="flaws" label="Flaws" />
      </div>
      <label className="field"><span>Appearance</span><textarea className="textarea" style={{ minHeight: 56 }} value={ch.appearance} onChange={(e) => up({ appearance: e.target.value })} /></label>
      <label className="field"><span>Backstory</span><textarea className="textarea" style={{ minHeight: 150 }} value={ch.backstory} onChange={(e) => up({ backstory: e.target.value })} placeholder="Where do you come from? What do you want? Who do you owe?" /></label>
      <div className="row wrap" style={{ gap: 14 }}>
        <label className="btn">🖼 Upload portrait<input type="file" accept="image/*" hidden onChange={portrait} /></label>
        {ch.portrait && <button className="btn ghost sm" onClick={() => up({ portrait: null })}>Remove portrait</button>}
        <span className="small muted">Token colour</span>
        <input type="color" value={ch.color || CLASS_COLORS[ch.class] || '#d9a441'} onChange={(e) => up({ color: e.target.value })} style={{ width: 44, height: 32, border: 0, background: 'none' }} />
      </div>
    </div>
  );
}

function ReviewStep({ preview, ch, up, srd }) {
  const { c, d, err } = preview;
  if (err) return <div className="error-text">{err}</div>;
  if (!c) return null;
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 16 }}>
        <Avatar size="xl" name={c.name} color={c.color} img={c.portrait} />
        <div>
          <div className="display" style={{ fontSize: 26 }}>{ch.name || 'Nameless'}</div>
          <div className="muted">Level {c.level} {titleIndex(c.subrace || c.race)} {titleIndex(c.class)}{c.subclass ? ` · ${titleIndex(c.subclass)}` : ''} · {titleIndex(c.background)} · {c.alignment}</div>
        </div>
      </div>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="pill gold">AC {d.ac}</span><span className="pill green">HP {c.hp.max}</span><span className="pill">Speed {d.speed} ft</span><span className="pill">Initiative {fmtMod(d.initiative)}</span><span className="pill">Passive Perception {d.passive?.perception}</span>{c.darkvision ? <span className="pill blue">Darkvision {c.darkvision} ft</span> : null}
      </div>
      {c.level > 1 && (
        <div className="row"><span className="small muted">Hit points per level after 1st:</span>
          <div className="tabs" style={{ width: 260 }}><button className={ch.hpMethod === 'average' ? 'on' : ''} onClick={() => up({ hpMethod: 'average' })}>Average</button><button className={ch.hpMethod === 'max' ? 'on' : ''} onClick={() => up({ hpMethod: 'max' })}>Max (generous)</button></div>
        </div>
      )}
      <div className="two-col">
        <div><div className="tiny muted">SKILLS</div><div className="small">{Object.keys(c.skillProfs || {}).map((s) => `${SKILL_NAMES[s]} ${fmtMod(d.skills[s])}${c.skillProfs[s] === 2 ? '★' : ''}`).join(' · ')}</div></div>
        <div><div className="tiny muted">ATTACKS</div><div className="small">{d.attacks.map((a) => `${a.name} ${fmtMod(a.bonus)} (${a.damage} ${a.damageType})`).join(' · ')}</div></div>
        <div><div className="tiny muted">EQUIPMENT</div><div className="small">{c.equipment.map((i) => `${i.qty > 1 ? `${i.qty}× ` : ''}${i.name}`).join(', ')} · {c.currency.gp} gp</div></div>
        {c.spellcasting && <div><div className="tiny muted">SPELLS</div><div className="small">{[...(c.spellcasting.cantrips || []), ...(c.spellcasting.prepared?.length ? c.spellcasting.prepared : c.spellcasting.known || [])].map((s) => srd.by.spells.get(s)?.name || s).join(', ')}</div></div>}
      </div>
      <div><div className="tiny muted">FEATURES</div><div className="small">{(c.features || []).map((f) => f.name).join(' · ')}</div></div>
      {c.backstory && <><div className="tiny muted">BACKSTORY</div><Markdown text={c.backstory} /></>}
    </div>
  );
}
