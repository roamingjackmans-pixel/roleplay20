import React from 'react';

export const fmtMod = (n) => (n == null || Number.isNaN(n) ? '—' : n >= 0 ? `+${n}` : `${n}`);
export const cap = (s) => String(s || '').replace(/(^|[\s-])(\w)/g, (m, a, b) => a + b.toUpperCase());
export const titleIndex = (s) => cap(String(s || '').replace(/-/g, ' '));

export function timeAgo(ts) {
  if (!ts) return '';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(ts).toLocaleDateString();
}

function inline(text, key = 0) {
  // **bold**, *italic*, `code` - escaped by React
  const out = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\n]+\*|_[^_\n]+_|`[^`]+`)/g;
  let last = 0, m, i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (t.startsWith('**')) out.push(<strong key={`${key}-${i++}`}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={`${key}-${i++}`}>{t.slice(1, -1)}</code>);
    else out.push(<em key={`${key}-${i++}`}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
export { inline };

/** A small, safe markdown renderer (headings, lists, paragraphs, bold/italic). */
export function Markdown({ text, className = 'prose' }) {
  const lines = String(text || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let list = null, para = [];
  const flushPara = () => { if (para.length) { blocks.push(<p key={blocks.length}>{inline(para.join(' '), blocks.length)}</p>); para = []; } };
  const flushList = () => { if (list) { blocks.push(<ul key={blocks.length}>{list.map((l, i) => <li key={i}>{inline(l, i)}</li>)}</ul>); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*[-*•]\s+(.*)$/.exec(line) || /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushList(); const L = Math.min(3, h[1].length); const Tag = `h${L}`; blocks.push(<Tag key={blocks.length}>{inline(h[2], blocks.length)}</Tag>); }
    else if (li) { flushPara(); (list ||= []).push(li[1]); }
    else if (!line.trim()) { flushPara(); flushList(); }
    else if (/^---+$/.test(line.trim())) { flushPara(); flushList(); blocks.push(<hr key={blocks.length} className="hr" />); }
    else { flushList(); para.push(line.trim()); }
  }
  flushPara(); flushList();
  return <div className={className}>{blocks}</div>;
}

export function initials(name) {
  return String(name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}

export function Avatar({ name, color, img, size = '', title }) {
  return (
    <div className={`avatar ${size}`} style={{ background: img ? '#000' : color || '#7a6a8a' }} title={title || name}>
      {img ? <img src={img} alt="" /> : initials(name)}
    </div>
  );
}

export const D20Icon = ({ size = 22 }) => (
  <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden="true">
    <defs><linearGradient id="d20g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#f6d58a" /><stop offset="1" stopColor="#a8741f" /></linearGradient></defs>
    <polygon points="60,6 107,33 107,87 60,114 13,87 13,33" fill="none" stroke="url(#d20g)" strokeWidth="7" />
    <polygon points="60,24 90,76 30,76" fill="none" stroke="url(#d20g)" strokeWidth="6" />
  </svg>
);
