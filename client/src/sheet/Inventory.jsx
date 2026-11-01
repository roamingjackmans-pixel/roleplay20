import React from 'react';
import { useCharacter, saveChar, useLive } from './CharacterSheet.jsx';
import { titleIndex } from '../lib/format.jsx';

const COINS = [['pp', 'Platinum'], ['gp', 'Gold'], ['ep', 'Electrum'], ['sp', 'Silver'], ['cp', 'Copper']];

/**
 * Coins and items are the DM's to change: buying, selling, loot and using things up all happen through the story.
 * During a session (outside a fight) you choose what you wear and wield.
 */
export default function Inventory() {
  const { ch, srd } = useCharacter();
  const { live, inCombat } = useLive();
  if (!ch) return <div className="empty">No character yet.</div>;
  const items = ch.equipment || [];
  const canEquip = live && !inCombat && !ch.dead;
  const toggle = (id) => saveChar(ch, { equipment: items.map((i) => (i.id === id ? { ...i, equipped: !i.equipped } : i)) });
  const weight = items.reduce((s, i) => s + (srd?.by?.equipment?.get(i.index)?.weight || 0) * (i.qty || 1), 0);
  const cap = (ch.abilities?.str || 10) * 15;

  return (
    <div className="sheet">
      <div className="sub-h">Coins</div>
      <div className="coins">
        {COINS.map(([k, label]) => (
          <div key={k} className={`coin ${k}`} title={label}><span>{k.toUpperCase()}</span><b className="coin-n">{ch.currency?.[k] ?? 0}</b></div>
        ))}
      </div>
      <div className="sub-h row">Equipment <span className="spacer" /><span className="tiny muted">{Math.round(weight)} / {cap} lb</span></div>
      <div className="inv">
        {items.map((i) => {
          const ref = srd?.by?.equipment?.get(i.index);
          const equippable = ref && (ref.type === 'weapon' || ref.type === 'armor');
          return (
            <div key={i.id} className={`inv-row ${i.equipped ? 'eq' : ''}`}>
              {equippable
                ? <button className={`btn xs ${i.equipped ? 'active' : ''}`} disabled={!canEquip} onClick={() => toggle(i.id)} title={canEquip ? 'Equip / unequip' : inCombat ? 'Change gear after the fight' : 'Only during a session'}>{i.equipped ? '✓ worn' : 'equip'}</button>
                : <span className="inv-dot" />}
              <div className="grow">
                <b>{i.name}</b>
                <div className="tiny muted">{ref ? [ref.damage && `${ref.damage} ${ref.damageType}`, ref.armorType && `AC ${ref.ac}${ref.dexBonus ? ' + Dex' : ''}${ref.maxDex ? ` (max ${ref.maxDex})` : ''}`, ref.properties?.length && ref.properties.join(', '), titleIndex(ref.gearCategory || '')].filter(Boolean).join(' · ') : i.notes || ''}</div>
              </div>
              {i.qty > 1 && <span className="small muted">×{i.qty}</span>}
            </div>
          );
        })}
        {!items.length && <div className="tiny muted">Nothing yet.</div>}
      </div>
      <p className="tiny muted">The DM keeps your coins and items up to date: say what you buy, sell, give away or use in your action and it happens here. {canEquip ? 'Equip armor and weapons to update your AC and attacks.' : 'You can change what you wear and wield during a session, outside a fight.'}</p>
    </div>
  );
}
