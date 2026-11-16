// This page's version, stamped in when the app was built (see client/vite.config.js), and the server's, so players can
// check they are all on the same one and spot a page that needs reloading after an update.
/* global __RP20_VERSION__ */
import { useEffect, useState } from 'react';
import { api } from './api.js';

export const VERSION = typeof __RP20_VERSION__ !== 'undefined' ? __RP20_VERSION__ : { code: 'dev', hash: 'dev', builtAt: null };

/** The server's version code (null until it answers, or if it doesn't say). */
export function useServerVersion() {
  const [v, setV] = useState(null);
  useEffect(() => {
    let on = true;
    api('ping').then((r) => { if (on) setV(r.version || null); }).catch(() => {});
    return () => { on = false; };
  }, []);
  return v;
}

/** "16 Nov, 02:31" in the viewer's own time. */
export function builtLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(+d) ? '' : d.toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
