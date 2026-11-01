import React, { useMemo, useState } from 'react';
import { useStore, emit } from '../lib/store.js';
import { useUI } from '../table/ui.js';
import { useCharacter, saveChar } from './CharacterSheet.jsx';
import { spellOptions } from '../../../shared/charbuild.js';
import { fmtMod, titleIndex } from '../lib/format.jsx';
import SpellCard from './SpellCard.jsx';
import { Modal } from '../components/Toasts.jsx';

function Pips({ max, used, onUse, onRestore, color = 'var(--gold)' }) {
  return (
    <span className="pips">
      {Array.from({ length: max }).map((_, i) => {
        const spent = i >= max - used;
        return <button key={i} className={`pip ${spent ? 'spent' : ''}`} style={{ '--pip': color }} onClick={() => (spent ? onRestore() : onUse())} title={spent ? 'Restore one' : 'Use one'} />;
      })}
    </span>
  );
}

export default function SpellsPage() {
  const { ch, d, srd } = useCharacter();
  const view = useStore((s) => s.view);
  const ui = useUI();
  const [open, setOpen] = useState(null);
  const [castSlot, setCastSlot] = useState({});
  const [preparing, setPreparing] = useState(false);
  const [hd, setHd] = useState(1);
  const [healTarget, setHealTarget] = useState(null);
  if (!ch) return <div className="empty">No character yet.</div>;
  if (!d) return <div className="empty">Loading…</div>;
  const sc = d.spellcasting;
  const used = ch.spellcasting?.slotsUsed || [0, 0, 0, 0, 0, 0, 0, 0, 0];
  const inCombat = !!view?.combat;

  const setUsed = (lvl, n) => {
    const arr = [...used];
    arr[lvl - 1] = Math.max(0, Math.min(sc.slots[lvl - 1], n));
    saveChar(ch, { spellcasting: { slotsUsed: arr } });
  };
  const setRes = (key, n, max) => saveChar(ch, { resources: { ...(ch.resources || {}), [key]: { ...(ch.resources?.[key] || {}), used: Math.max(0, Math.min(max, n)) } } });

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

  async function cast(spell, ritual = false) {
    const lvl = spell.level ? (castSlot[spell.index] || availableLevels(spell.level)[0]) : 0;
    if (spell.level && !lvl && !ritual) { useStore.getState().toast(`No spell slots of level ${spell.level}+ left.`, 'bad'); return; }
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
            ? <Pips max={r.max} used={r.used || 0} onUse={() => setRes(r.key, (r.used || 0) + 1, r.max)} onRestore={() => setRes(r.key, (r.used || 0) - 1, r.max)} color="var(--purple)" />
            : <span className="row"><button className="btn xs" onClick={() => setRes(r.key, (r.used || 0) + 1, r.max)}>−</button><b>{r.max - (r.used || 0)}</b>/{r.max}<button className="btn xs" onClick={() => setRes(r.key, (r.used || 0) - 1, r.max)}>+</button></span>}
        </div>
      )) : <div className="tiny muted">No limited-use class abilities at this level.</div>}

      {sc && (
        <>
          <div className="sub-h" style={{ marginTop: 14 }}>Spellcasting <span className="tiny muted">({titleIndex(sc.ability)}) · save DC <b className="gold">{sc.dc}</b> · attack <b className="gold">{fmtMod(sc.attack)}</b></span></div>
          <div className="slots">
            {sc.slots.map((max, i) => max ? (
              <div key={i} className="slot-row"><span className="slot-lvl">L{i + 1}</span><Pips max={max} used={used[i] || 0} onUse={() => setUsed(i + 1, (used[i] || 0) + 1)} onRestore={() => setUsed(i + 1, (used[i] || 0) - 1)} /><span className="tiny muted">{max - (used[i] || 0)} left</span></div>
            ) : null)}
            {sc.pact && <div className="slot-row"><span className="slot-lvl">Pact L{sc.pact.level}</span><Pips max={sc.pact.slots} used={ch.spellcasting?.pactUsed || 0} onUse={() => saveChar(ch, { spellcasting: { pactUsed: (ch.spellcasting?.pactUsed || 0) + 1 } })} onRestore={() => saveChar(ch, { spellcasting: { pactUsed: Math.max(0, (ch.spellcasting?.pactUsed || 0) - 1) } })} color="var(--purple)" /><span className="tiny muted">short rest</span></div>}
          </div>

          {sc.mode === 'prepared' || sc.mode === 'spellbook' ? <button className="btn sm" style={{ margin: '8px 0' }} onClick={() => setPreparing(true)}>📖 Change prepared spells ({(ch.spellcasting?.prepared || []).length}{sc.preparedMax ? `/${sc.preparedMax}` : ''})</button> : null}

          {cantrips.length > 0 && <SpellGroup title="Cantrips" list={cantrips.map((i) => srd.by.spells.get(i)).filter(Boolean)} onCast={cast} onOpen={setOpen} />}
          {Object.entries(byLevel).map(([lvl, list]) => (
            <SpellGroup key={lvl} title={`Level ${lvl}`} list={list} onCast={cast} onOpen={setOpen} slots={(s) => availableLevels(s.level)} castSlot={castSlot} setCastSlot={setCastSlot} />
          ))}
        </>
      )}

      <div className="sub-h" style={{ marginTop: 14 }}>Rest</div>
      <div className="row wrap" style={{ gap: 8 }}>
        <span className="small muted">Spend</span>
        <select className="select" style={{ width: 70 }} value={hd} onChange={(e) => setHd(Number(e.target.value))}>{Array.from({ length: Math.max(1, ch.hitDice.total - (ch.hitDice.used || 0)) + 1 }).map((_, i) => <option key={i} value={i}>{i}</option>)}</select>
        <span className="small muted">hit dice and</span>
        <button className="btn sm" disabled={inCombat} onClick={() => emit('sheet:rest', { kind: 'short', hitDice: hd })}>☕ Short rest</button>
        <button className="btn sm" disabled={inCombat} onClick={() => { if (confirm('Take a long rest (8 hours)? Tell the DM in your action too, so the world can react.')) emit('sheet:rest', { kind: 'long' }); }}>🌙 Long rest</button>
      </div>

      {open && <Modal title={open.name} onClose={() => setOpen(null)}><SpellCard spell={open} /></Modal>}
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

function SpellGroup({ title, list, onCast, onOpen, slots, castSlot, setCastSlot }) {
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
            {s.level > 0 && lv.length > 1 && (
              <select className="select slot-sel" value={castSlot?.[s.index] || lv[0]} onChange={(e) => setCastSlot({ ...castSlot, [s.index]: Number(e.target.value) })} title="Cast at slot level">
                {lv.map((l) => <option key={l} value={l}>L{l}</option>)}
              </select>
            )}
            {s.ritual && <button className="btn xs ghost" title="Cast as a ritual (10 min longer, no slot)" onClick={() => onCast(s, true)}>ritual</button>}
            <button className="btn xs primary" disabled={s.level > 0 && !lv.length && !s.ritual} onClick={() => onCast(s)}>Cast</button>
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
