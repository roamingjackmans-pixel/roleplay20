// "Your dice" on the character sheet: one compact row with your die and a button that opens the picker (a color,
// a finish and a number color for your d20). It's saved on your character (any time, even between sessions) and
// everyone sees it when you roll.
import React, { useEffect, useState } from 'react';
import { useStore } from '../lib/store.js';
import D20 from '../components/D20.jsx';
import { Modal } from '../components/Toasts.jsx';
import { DICE_COLORS, DICE_STYLES, DICE_INKS, diceLook } from '../../../shared/diceStyles.js';
import { saveChar } from './CharacterSheet.jsx';

const pickOne = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
const same = (a, b) => a.color === b.color && a.style === b.style && a.ink === b.ink;

export default function DicePicker({ ch }) {
  const [open, setOpen] = useState(false);
  const look = diceLook(ch.dice);
  return (
    <>
      <button type="button" className="dice-row" onClick={() => setOpen(true)} title="Choose how your d20 looks">
        <D20 look={look} face={20} size={36} />
        <span className="grow">
          <b>Your dice</b>
          <span className="tiny muted">{DICE_COLORS[look.color].name} · {DICE_STYLES[look.style].name}</span>
        </span>
        <span className="btn sm">🎨 Customize</span>
      </button>
      {open && <DicePickerModal ch={ch} onClose={() => setOpen(false)} />}
    </>
  );
}

function DicePickerModal({ ch, onClose }) {
  const saved = diceLook(ch.dice);
  const [pending, setPending] = useState(null); // shown right away while the choice saves
  const look = pending || saved;
  useEffect(() => { if (pending && same(pending, saved)) setPending(null); }, [ch.dice]); // eslint-disable-line

  async function choose(patch) {
    const next = { ...look, ...patch };
    setPending(next);
    if (!(await saveChar(ch, { dice: next }))) setPending(null);
  }
  function rollIt() {
    const n = 1 + Math.floor(Math.random() * 20);
    useStore.setState({ dice: { key: `try-${Date.now()}`, name: ch.name, characterId: ch.id, label: 'Trying out your dice', look, result: { natural: n, total: n } } });
  }

  return (
    <Modal title="Your dice" onClose={onClose} actions={<button className="btn primary sm" onClick={onClose}>Done</button>}>
      <div className="dice-picker">
        <div className="dp-top">
          <button className="dp-preview" onClick={rollIt} title="Roll it to see it tumble"><D20 look={look} face={20} size={92} /></button>
          <div className="col" style={{ gap: 6 }}>
            <b>{DICE_COLORS[look.color].name} · {DICE_STYLES[look.style].name}</b>
            <span className="tiny muted">Everyone sees your die when you roll. Changes save as you pick them.</span>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn sm" onClick={rollIt}>🎲 Roll it</button>
              <button className="btn sm ghost" onClick={() => choose({ color: pickOne(DICE_COLORS), style: pickOne(DICE_STYLES), ink: 'auto' })}>✨ Surprise me</button>
            </div>
          </div>
        </div>

        <div className="tiny muted dp-h">Color</div>
        <div className="dp-grid">
          {Object.entries(DICE_COLORS).map(([k, c]) => (
            <button key={k} className={`dp-swatch ${look.color === k ? 'on' : ''}`} title={c.name} aria-label={c.name} aria-pressed={look.color === k} onClick={() => choose({ color: k })}>
              <D20 look={{ ...look, color: k }} face={20} size={44} title={c.name} />
            </button>
          ))}
        </div>

        <div className="tiny muted dp-h">Finish</div>
        <div className="dp-chips">
          {Object.entries(DICE_STYLES).map(([k, s]) => (
            <button key={k} className={`dp-chip ${look.style === k ? 'on' : ''}`} title={s.hint} aria-pressed={look.style === k} onClick={() => choose({ style: k })}>
              <D20 look={{ ...look, style: k }} face={20} size={30} title={s.name} /><span>{s.name}</span>
            </button>
          ))}
        </div>

        <div className="tiny muted dp-h">Number</div>
        <div className="dp-chips">
          {Object.entries(DICE_INKS).map(([k, i]) => (
            <button key={k} className={`dp-chip ${look.ink === k ? 'on' : ''}`} aria-pressed={look.ink === k} onClick={() => choose({ ink: k })}>
              <i className="dp-ink" style={{ background: i.color || `linear-gradient(135deg, ${DICE_COLORS[look.color].ink} 50%, ${DICE_COLORS[look.color].a} 50%)` }} /><span>{i.name}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
