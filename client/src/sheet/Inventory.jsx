import React, { useState } from 'react';
import { useCharacter, saveChar } from './CharacterSheet.jsx';
import { titleIndex } from '../lib/format.jsx';

const COINS = [['pp', 'Platinum'], ['gp', 'Gold'], ['ep', 'Electrum'], ['sp', 'Silver'], ['cp', 'Copper']];

export default function Inventory() {
  const { ch, srd } = useCharacter();
  const [name, setName] = useState('');
  if (!ch) return <div className="empty">No character yet.</div>;
  const items = ch.equipment || [];
  const set = (equipment) => saveChar(ch, { equipment });
  const upd = (id, patch) => set(items.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const add = () => {
    const n = name.trim();
    if (!n) return;
    const ref = srd?.equipment?.find?.((e) => e.name.toLowerCase() === n.toLowerCase());
    set([...items, { id: `it_${Math.random().toString(36).slice(2, 8)}`, name: ref?.name || n, index: ref?.index || null, qty: 1, equipped: false, attuned: false, notes: '' }]);
    setName('');
  };
  const weight = items.reduce((s, i) => s + (srd?.by?.equipment?.get(i.index)?.weight || 0) * (i.qty || 1), 0);
  const cap = (ch.abilities?.str || 10) * 15;

  return (
    <div className="sheet">
      <div className="sub-h">Coins</div>
      <div className="coins">
        {COINS.map(([k, label]) => (
          <label key={k} className={`coin ${k}`} title={label}><span>{k.toUpperCase()}</span>
            <input className="input" inputMode="numeric" value={ch.currency?.[k] ?? 0} onChange={(e) => saveChar(ch, { currency: { ...ch.currency, [k]: Math.max(0, parseInt(e.target.value || '0', 10) || 0) } })} />
          </label>
        ))}
      </div>
      <div className="sub-h row">Equipment <span className="spacer" /><span className="tiny muted">{Math.round(weight)} / {cap} lb</span></div>
      <div className="inv">
        {items.map((i) => {
          const ref = srd?.by?.equipment?.get(i.index);
          const equippable = ref && (ref.type === 'weapon' || ref.type === 'armor');
          return (
            <div key={i.id} className={`inv-row ${i.equipped ? 'eq' : ''}`}>
              {equippable ? <button className={`btn xs ${i.equipped ? 'active' : ''}`} onClick={() => upd(i.id, { equipped: !i.equipped })} title="Equip / unequip">{i.equipped ? '✓ worn' : 'equip'}</button> : <span className="inv-dot" />}
              <div className="grow">
                <b>{i.name}</b>
                <div className="tiny muted">{ref ? [ref.damage && `${ref.damage} ${ref.damageType}`, ref.armorType && `AC ${ref.ac}${ref.dexBonus ? ' + Dex' : ''}${ref.maxDex ? ` (max ${ref.maxDex})` : ''}`, ref.properties?.length && ref.properties.join(', '), titleIndex(ref.gearCategory || '')].filter(Boolean).join(' · ') : i.notes || ''}</div>
              </div>
              <div className="row" style={{ gap: 2 }}>
                <button className="btn xs ghost" onClick={() => (i.qty > 1 ? upd(i.id, { qty: i.qty - 1 }) : set(items.filter((x) => x.id !== i.id)))}>−</button>
                <span className="small" style={{ minWidth: 20, textAlign: 'center' }}>{i.qty}</span>
                <button className="btn xs ghost" onClick={() => upd(i.id, { qty: (i.qty || 1) + 1 })}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <input className="input" list="eq-list" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} placeholder="Add an item (e.g. Potion of Healing)" />
        <datalist id="eq-list">{(srd?.equipment || []).slice(0, 400).map((e) => <option key={e.index} value={e.name} />)}<option value="Potion of Healing" /></datalist>
        <button className="btn sm" onClick={add}>Add</button>
      </div>
      <p className="tiny muted">The Dungeon Master adds loot and purchases here automatically. Equip armor and weapons to update your AC and attacks.</p>
    </div>
  );
}
