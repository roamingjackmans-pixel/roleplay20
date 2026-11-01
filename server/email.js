// Sending email: sign-in codes, password-reset links and account notices.
// Uses Resend (https://resend.com) when RESEND_API_KEY and EMAIL_FROM are set; "file" writes each email to
// <data>/outbox for tests; "off" sends nothing (and the features that need email stay switched off).
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

export function emailReady() {
  if (config.emailProvider === 'file') return true;
  return config.emailProvider === 'resend' && !!config.resendKey && !!config.emailFrom;
}

export function emailStatus() {
  return { ready: emailReady(), provider: emailReady() ? config.emailProvider : 'off' };
}

const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

/** A plain, readable email in the Roleplay20 style. `code` is shown big; `link` becomes a button. */
export function renderEmail({ heading, lines = [], code = null, link = null, linkText = 'Open', footer = '' }) {
  const text = [heading, '', ...lines, code ? `\nYour code: ${code}\n` : '', link ? `\n${linkText}: ${link}\n` : '', footer].filter((x) => x !== '').join('\n');
  const html = `<!doctype html><html><body style="margin:0;background:#15111a;padding:24px;font-family:Georgia,serif;color:#efe6d6">
<div style="max-width:520px;margin:0 auto;background:#1e1826;border:1px solid #3a3040;border-radius:12px;padding:24px">
<div style="font-size:22px;font-weight:bold;letter-spacing:.04em;margin-bottom:6px">Roleplay<span style="color:#e0b354">20</span></div>
<h2 style="font-size:18px;margin:12px 0">${esc(heading)}</h2>
${lines.map((l) => `<p style="font-size:15px;line-height:1.5;margin:8px 0">${esc(l)}</p>`).join('\n')}
${code ? `<div style="font-family:Consolas,monospace;font-size:34px;letter-spacing:10px;font-weight:bold;text-align:center;background:#2a2230;border-radius:10px;padding:14px;margin:16px 0;color:#f2c76e">${esc(code)}</div>` : ''}
${link ? `<p style="text-align:center;margin:20px 0"><a href="${esc(link)}" style="background:#d9a441;color:#1d140a;text-decoration:none;font-weight:bold;padding:12px 22px;border-radius:8px;display:inline-block">${esc(linkText)}</a></p><p style="font-size:12px;color:#a89cb0;word-break:break-all">${esc(link)}</p>` : ''}
${footer ? `<p style="font-size:12px;color:#a89cb0;margin-top:18px">${esc(footer)}</p>` : ''}
</div></body></html>`;
  return { text, html };
}

/** Send one email. Throws with a short reason if it can't be sent. */
export async function sendEmail({ to, subject, text, html }) {
  if (!emailReady()) throw new Error('Email is not set up on this server.');
  if (config.emailProvider === 'file') {
    const dir = path.join(config.dataDir, 'outbox');
    fs.mkdirSync(dir, { recursive: true });
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
    fs.writeFileSync(path.join(dir, name), JSON.stringify({ to, subject, text, html, at: Date.now() }, null, 2));
    return { ok: true, id: name };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: config.emailFrom, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* not JSON */ }
    console.error('[email] Resend refused the email:', msg);
    throw new Error("The email couldn't be sent. Try again in a minute.");
  }
  const j = await res.json().catch(() => ({}));
  return { ok: true, id: j.id };
}
