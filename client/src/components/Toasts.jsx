import React from 'react';
import { useStore } from '../lib/store.js';

export default function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>)}
    </div>
  );
}

export function Modal({ title, onClose, children, wide = false, actions = null }) {
  return (
    <div className="modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={`card modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <div className="spacer" />
          {actions}
          {onClose && <button className="btn ghost icon" onClick={onClose} aria-label="Close">✕</button>}
        </div>
        <div className="pad">{children}</div>
      </div>
    </div>
  );
}
