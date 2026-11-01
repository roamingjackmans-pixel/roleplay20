import React, { useMemo, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from '../table/ui.js';
import { useCharacter, saveChar, useLive } from './CharacterSheet.jsx';
import { spellOptions } from '../../../shared/charbuild.js';
import { fmtMod, titleIndex } from '../lib/format.jsx';
import SpellCard from './SpellCard.jsx';
import { Modal } from '../components/Toasts.jsx';

/** Uses you have left (read-only: casting through the app or the DM spends them; rests bring them back). */
function Pips({ max, used, color = 'var(--gold)' }) {
  return (
    <span className="pips" title={`${Math.max(0, max - used)} of ${max} left`}>
      {Array.from({ length: max }).map((_, i) => <i key={i} className={`pip ${i >= max - used ? 'spent' : ''}`} style={{ '--pip': color }} />)}
    </span>
  );
}

export default function SpellsPage() {
  const { ch, d, srd } = useCharacter();
  const view = useStore((s) => s.view);
  const ui = useUI();
  const { live, inCombat: fighting } = useLive();
  const [open, setOpen] = useState(null);
  const [chooseLevel, setChooseLevel] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [healTarget, setHealTarget] = useState(null);
  if (!ch) return <div className="empty">No character yet.</div>;
  if (!d) return <div className="empty">Loading…</div>;
  const sc = d.spellcasting;
  const used = ch.spellcasting?.slotsUsed || [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const inCombat = !!view?.combat;

  // out of a fight, spells are cast while actions are open; in a fight, on your turn
  const castBlock = !live ? 'You can cast once the session begins.' : ch.dead ? `${ch.name} has died.` : !fighting && view?.phase !== 'actions' ? 'Cast while actions are open.' : null;

  const known = [...new Set([...(ch.spellcasting?.prepared?.length ? ch.spellcasting.prepared : ch.spellcasting?.known || []), ...(ch.spellcasting?.alwaysPrepared || [])])];
  const cantrips = ch.spellcasting?.cantrips || [];
  const spells = known.map((i) => srd.by.spells.get(i)).filter(Boolean).sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
  const byLevel = {};
  for (const s of spells) (byLevel[s.level] ||= []).push(s);
  const availableLevels = (lvl) => {
    const out = [];
    for (let l = lvl; l <= 9; l++) if ((sc?.slots?.[l - 1] || 0) - (used[l - 1] || 0) > 0) out.push(l);
    if (sc?.pact && sc.pact.level >= lvl && (sc.pact.slots - (ch.spellcasting?.pactUsed || 0)) > 0 && !out.includes(sc.pact.level)) out.push(sc.pact.level);
    return out.sort((a, b) => a - b);
  };

  // Casting a leveled spell always asks which slot level to use; that slot is the one spent.
  function cast(spell, ritual = false) {
    if (castBlock) { useStore.getState().toast(castBlock, 'bad'); return; }
    if (spell.level > 0 && !ritual) {
      if (!availableLevels(spell.level).length) { useStore.getState().toast(`No spell slots of level ${spell.level} or higher left.`, 'bad'); return; }
      setChooseLevel(spell);
      return;
    }
    castAt(spell, 0, ritual);
  }

  async function castAt(spell, lvl, ritual = false) {
    setChooseLevel(null);
    if (inCombat) {
      if (!view.combat.myTurn) { useStore.getState().toast("Wait for your turn to cast in combat.", 'bad'); return; }
      const needsTarget = spell.attackType || spell.dc || spell.heal || spell.index === 'magic-missile';
      if (needsTarget) { ui.startTargeting({ kind: 'spell', spell, slotLevel: lvl }); useStore.getState().toast(spell.area ? `Aim ${spell.name}: click the map to place the ${spell.area.size}-ft ${spell.area.type}.` : `Choose ${spell.name}'s target on the map.`); return; }
      await emit('cast', { spellIndex: spell.index, slotLevel: lvl });
      return;
    }
    if (spell.heal) { setHealTarget({ spell, lvl }); return; }
    await emit('cast', { spellIndex: spell.index, slotLevel: lvl, ritual });
  }

  return (
    <div className="sheet">
      <div className="sub-h">Abilities with limited uses</div>
      {d.resources?.length ? d.resources.map((r) => (
        <div key={r.key} className="res-row">
          <div className="grow"><b>{r.name}</b><div className="tiny muted">{r.recharge === 'short' ? 'recharges on a short or long rest' : r.recharge === 'dawn' ? 'recharges at dawn' : 'recharges on a long rest'}{r.desc ? ` · ${r.desc}` : ''}</div></div>
          {r.max == null ? <span className="pill">always on</span> : r.max <= 12
            ? <Pips max={r.max} used={r.used || 0} color="var(--purple)" />
            : <span className="row"><b>{r.max - (r.used || 0)}</b>/{r.max}</span>}
        </div>
      )) : <div className="tiny muted">No limited-use class abilities at this level.</div>}
      {d.resources?.some((r) => r.max != null) && <div className="tiny faint">Use an ability from the Turn panel in a fight, or say so in your action: the DM marks it used.</div>}

      {sc && (
        <>
          <div className="sub-h" style={{ marginTop: 14 }}>Spellcasting <span className="tiny muted">({titleIndex(sc.ability)}) · save DC <b className="gold">{sc.dc}</b> · attack <b className="gold">{fmtMod(sc.attack)}</b></span></div>
          <div className="slots">
            {sc.slots.map((max, i) => max ? (
              <div key={i} className="slot-row"><span className="slot-lvl">L{i + 1}</span><Pips max={max} used={used[i] || 0} /><span className="tiny muted">{max - (used[i] || 0)} left</span></div>
            ) : null)}
            {sc.pact && <div className="slot-row"><span className="slot-lvl">Pact L{sc.pact.level}</span><Pips max={sc.pact.slots} used={ch.spellcasting?.pactUsed || 0} color="var(--purple)" /><span className="tiny muted">short rest</span></div>}
          </div>
          <div className="tiny faint">Cast from this page and the slot is spent for you (or tell the DM in your action). Slots come back when the DM gives the party a rest.</div>
          {castBlock && <div className="tiny muted">{castBlock}</div>}

          {sc.mode === 'prepared' || sc.mode === 'spellbook' ? (
            ch.mayPrepare && live
              ? <button className="btn sm primary" style={{ margin: '8px 0' }} onClick={() => setPreparing(true)}>📖 You've rested: change prepared spells ({(ch.spellcasting?.prepared || []).length}{sc.preparedMax ? `/${sc.preparedMax}` : ''})</button>
              : <div className="tiny muted" style={{ margin: '8px 0' }}>📖 {(ch.spellcasting?.prepared || []).length}{sc.preparedMax ? `/${sc.preparedMax}` : ''} spells prepared. You can change them right after a long rest.</div>
          ) : null}

          {cantrips.length > 0 && <SpellGroup title="Cantrips" list={cantrips.map((i) => srd.by.spells.get(i)).filter(Boolean)} onCast={cast} onOpen={setOpen} blocked={castBlock} />}
          {Object.entries(byLevel).map(([lvl, list]) => (
            <SpellGroup key={lvl} title={`Level ${lvl}`} list={list} onCast={cast} onOpen={setOpen} blocked={castBlock} slots={(s) => availableLevels(s.level)} />
          ))}
        </>
      )}

      <div className="sub-h" style={{ marginTop: 14 }}>Rest</div>
      <div className="small muted">
        Hit Dice: <b>{ch.hitDice.total - (ch.hitDice.used || 0)}/{ch.hitDice.total}</b> d{ch.hitDice.die}. To rest, say so in your action ("we make camp for the night", "we take an hour to patch up").
        The DM decides if it's safe and restores your hit points, slots and abilities. In a short rest, tell the DM how many Hit Dice you spend to heal.
      </div>

      {open && <Modal title={open.name} onClose={() => setOpen(null)}><SpellCard spell={open} /></Modal>}
      {chooseLevel && (
        <Modal title={`Cast ${chooseLevel.name} at which level?`} onClose={() => setChooseLevel(null)}>
          <div className="col">
            {Array.from({ length: 10 - chooseLevel.level }, (_, i) => chooseLevel.level + i).filter((l) => sc.slots[l - 1] > 0).map((l) => {
              const left = sc.slots[l - 1] - (used[l - 1] || 0);
              return (
                <button key={l} className={`btn cast-level ${l === chooseLevel.level ? 'primary' : ''}`} disabled={left <= 0} onClick={() => castAt(chooseLevel, l)}>
                  <b>Level {l}</b>{l > chooseLevel.level ? <span className="tiny"> (upcast)</span> : null}<span className="spacer" /><span className="small">{left} of {sc.slots[l - 1]} left</span>
                </button>
              );
            })}
            {sc.pact && sc.pact.level >= chooseLevel.level && (
              <button className="btn cast-level" disabled={sc.pact.slots - (ch.spellcasting?.pactUsed || 0) <= 0} onClick={() => castAt(chooseLevel, sc.pact.level)}>
                <b>Pact slot (level {sc.pact.level})</b><span className="spacer" /><span className="small">{sc.pact.slots - (ch.spellcasting?.pactUsed || 0)} of {sc.pact.slots} left</span>
              </button>
            )}
            {chooseLevel.ritual && !inCombat && <button className="btn ghost" onClick={() => castAt(chooseLevel, 0, true)}>Cast as a ritual (no slot, takes 10 minutes longer)</button>}
            {chooseLevel.higherLevel && <div className="tiny muted" style={{ marginTop: 6 }}><b>At higher levels:</b> {chooseLevel.higherLevel}</div>}
          </div>
        </Modal>
      )}
      {preparing && <PrepareModal ch={ch} d={d} srd={srd} onClose={() => setPreparing(false)} />}
      {healTarget && (
        <Modal title={`Cast ${healTarget.spell.name} on…`} onClose={() => setHealTarget(null)}>
          <div className="col">
            {(view?.party || []).map((p) => (
              <button key={p.id} className="btn" onClick={async () => { await emit('cast', { spellIndex: healTarget.spell.index, slotLevel: healTarget.lvl, targetCharacterId: p.id, mode: useUI.getState().rollMode === 'manual' ? 'auto' : 'auto' }); setHealTarget(null); }}>
                {p.name} <span className="muted small">{p.hp.current}/{p.hp.max} HP</span>
              </button>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}

function SpellGroup({ title, list, onCast, onOpen, slots, blocked }) {
  return (
    <div className="spell-group">
      <div className="tiny muted spell-group-h">{title}</div>
      {list.map((s) => {
        const lv = slots ? slots(s) : [];
        return (
          <div key={s.index} className="spell-row">
            <button className="grow spell-name" onClick={() => onOpen(s)}>
              <b>{s.name}</b>
              <span className="tiny muted">{s.castingTime}{s.concentration ? ' · ◎ conc.' : ''}{s.ritual ? ' · ritual' : ''}{s.area ? ` · ${s.area.size}ft ${s.area.type}` : ''}{s.damage ? ` · ${s.damage.type}` : ''}{s.heal ? ' · heal' : ''}</span>
            </button>
            {s.ritual && <button className="btn xs ghost" disabled={!!blocked} title="Cast as a ritual (10 min longer, no slot)" onClick={() => onCast(s, true)}>ritual</button>}
            <button className="btn xs primary" disabled={blocked || (s.level > 0 && !lv.length && !s.ritual)} title={blocked || ''} onClick={() => onCast(s)}>Cast</button>
          </div>
        );
      })}
    </div>
  );
}

function PrepareModal({ ch, d, srd, onClose }) {
  const info = useMemo(() => { try { return spellOptions(ch.class, ch.level, srd, { abilities: ch.abilities, subclass: ch.subclass }); } catch { return null; } }, [ch, srd]);
  const book = ch.spellcasting?.known?.length && d.spellcasting?.mode === 'spellbook' ? ch.spellcasting.known : null;
  const pool = (book ? book.map((i) => srd.by.spells.get(i)).filter(Boolean) : info?.spells || []).filter((s) => s.level >= 1);
  const [sel, setSel] = useState(ch.spellcasting?.prepared || []);
  const max = d.spellcasting?.preparedMax || info?.spellsToPick || 99;
  const [q, setQ] = useState('');
  return (
    <Modal title={`Prepare spells (${sel.length}/${max})`} onClose={onClose} actions={<button className="btn primary sm" onClick={() => { saveChar(ch, { spellcasting: { prepared: sel } }); onClose(); }}>Save</button>}>
      <input className="input" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ marginBottom: 10 }} />
      <div className="spell-pick-grid">
        {pool.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase())).map((s) => {
          const on = sel.includes(s.index);
          return (
            <div key={s.index} className={`spell-pick ${on ? 'on' : ''}`}>
              <button className="spell-pick-main" onClick={() => setSel(on ? sel.filter((x) => x !== s.index) : sel.length < max ? [...sel, s.index] : sel)}>
                <span className="dot" /><span className="grow"><b>{s.name}</b><span className="tiny muted">L{s.level} · {s.school}</span></span>
              </button>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
