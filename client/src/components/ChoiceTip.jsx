import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Markdown } from '../lib/format.jsx';

/*
 * Tips that say what a choice is (character creator, level-up wizard). Spread tip(info) onto any choice element:
 *   <button {...tip(() => describeSpell(s))} onClick={...}>
 * info = { title, meta, text } (text is markdown) or a function returning it, so long descriptions are only
 * built when shown. Mouse: shows after a short hover. Keyboard: on focus. Touch (no hover): press and hold; the
 * tap that ends the hold doesn't select, and tapping anywhere else closes it. One tip at a time, drawn by
 * <ChoiceTipLayer /> (mounted once in App).
 */
const HOVER_MS = 300;
const HOLD_MS = 450;
const TIP_ID = 'choice-tip';
const bus = { show: null, hide: null };
let hoverTimer = 0;
let holdTimer = 0;
let holdAt = null;
let swallowClick = false;

/** True on touch screens, where nothing can hover. */
export const touchOnly = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: none)').matches;

export function tip(info) {
  if (!info) return {};
  const open = (el, pinned, x) => {
    let i = null;
    try { i = typeof info === 'function' ? info() : info; } catch { i = null; }
    if (i && (i.text || i.meta)) bus.show?.({ el, info: i, pinned, x });
  };
  const stopHold = () => { clearTimeout(holdTimer); holdAt = null; };
  return {
    'data-tip': '',
    onPointerEnter(e) {
      if (e.pointerType !== 'mouse') return;
      const el = e.currentTarget;
      const x = e.clientX;
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => open(el, false, x), HOVER_MS);
    },
    onPointerLeave(e) {
      if (e.pointerType !== 'mouse') return;
      clearTimeout(hoverTimer);
      bus.hide?.();
    },
    onPointerDown(e) {
      swallowClick = false;
      stopHold();
      if (e.pointerType === 'mouse') return;
      const el = e.currentTarget;
      const x = e.clientX;
      holdAt = { x: e.clientX, y: e.clientY };
      holdTimer = setTimeout(() => {
        holdAt = null;
        swallowClick = true;
        open(el, true, x);
        try { navigator.vibrate?.(8); } catch { /* no vibration */ }
      }, HOLD_MS);
    },
    onPointerMove(e) {
      if (holdAt && Math.hypot(e.clientX - holdAt.x, e.clientY - holdAt.y) > 10) stopHold();
    },
    onPointerUp: stopHold,
    onPointerCancel: stopHold,
    onClickCapture(e) {
      if (!swallowClick) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    onContextMenu(e) {
      if (holdAt || swallowClick) e.preventDefault();
    },
    onFocus(e) {
      const el = e.currentTarget;
      if (el.matches?.(':focus-visible')) open(el, false, null);
    },
    onBlur() { bus.hide?.(true); },
  };
}

/** One line telling players how to read about a choice on this device. */
export function TipHint({ className = 'tiny muted' }) {
  return <span className={className}>{touchOnly() ? 'Press and hold any choice to read what it is.' : 'Hover over any choice to read what it is.'}</span>;
}

export function ChoiceTipLayer() {
  const [st, setSt] = useState(null);
  const [pos, setPos] = useState(null);
  const [scrolls, setScrolls] = useState(false);
  const boxRef = useRef(null);
  const hideTimer = useRef(0);

  useEffect(() => {
    bus.show = (s) => { clearTimeout(hideTimer.current); setSt(s); };
    bus.hide = (now) => {
      clearTimeout(hideTimer.current);
      hideTimer.current = setTimeout(() => setSt((s) => (s?.pinned ? s : null)), now ? 0 : 140);
    };
    return () => { bus.show = null; bus.hide = null; clearTimeout(hideTimer.current); };
  }, []);

  // screen readers: the choice is described by the tip while it shows
  useEffect(() => {
    const el = st?.el;
    if (!el) return undefined;
    el.setAttribute('aria-describedby', TIP_ID);
    return () => el.removeAttribute('aria-describedby');
  }, [st]);

  useEffect(() => {
    if (!st) return undefined;
    const close = () => setSt(null);
    const inBox = (t) => boxRef.current?.contains(t);
    const onDown = (e) => { if (!inBox(e.target) && (st.pinned || !st.el.contains(e.target))) close(); };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    const onScroll = (e) => { if (!inBox(e.target)) close(); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [st]);

  // below the choice if it fits, otherwise above; never off screen
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!st || !box) { setPos(null); return; }
    if (!st.el.isConnected) { setSt(null); return; }
    const r = st.el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const m = 8;
    const gap = 6;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    let top = r.bottom + gap;
    if (top + h > vh - m) top = r.top - gap - h >= m ? r.top - gap - h : Math.max(m, vh - m - h);
    const cx = r.width > 420 && st.x != null ? st.x : r.left + r.width / 2;
    setPos({ top, left: Math.min(Math.max(m, cx - w / 2), vw - m - w) });
    setScrolls(box.scrollHeight > box.clientHeight + 1);
  }, [st]);

  if (!st) return null;
  const { info, pinned } = st;
  return createPortal(
    <div ref={boxRef} id={TIP_ID} role="tooltip" className={`choice-tip ${pinned || scrolls ? 'live' : ''}`}
      style={pos ? { top: pos.top, left: pos.left } : { top: 0, left: 0, visibility: 'hidden' }}
      onPointerEnter={() => clearTimeout(hideTimer.current)} onPointerLeave={(e) => { if (e.pointerType === 'mouse') bus.hide?.(); }}>
      <div className="choice-tip-title">{info.title}</div>
      {info.meta && <div className="choice-tip-meta">{info.meta}</div>}
      {info.text && <Markdown text={info.text} className="prose choice-tip-text" />}
      {pinned && <button type="button" className="btn ghost xs choice-tip-close" onClick={() => setSt(null)}>Close</button>}
    </div>,
    document.body,
  );
}
