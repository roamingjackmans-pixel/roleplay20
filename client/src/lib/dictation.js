// Voice typing with the browser's own speech recognition (Chrome, Edge and Safari; not Firefox).
// The words you say are added to whatever box you're typing in; nothing is sent until you press the button.
import { useEffect, useRef, useState } from 'react';
import { stopSpeaking } from './tts.js';
import { useStore } from './store.js';

const Recognition = typeof window !== 'undefined' ? (window.SpeechRecognition || window.webkitSpeechRecognition) : null;
export const dictationSupported = !!Recognition;

/** useDictation(onWords): start/stop listening; onWords(text) gets each finished phrase. */
export function useDictation(onWords) {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const rec = useRef(null);
  const cb = useRef(onWords);
  cb.current = onWords;
  useEffect(() => () => { try { rec.current?.abort(); } catch { /* already stopped */ } }, []);

  function start() {
    if (!Recognition || rec.current) return;
    stopSpeaking(); // don't let the read-aloud voice end up in your text
    const r = new Recognition();
    r.lang = navigator.language || 'en-US';
    r.continuous = true;
    r.interimResults = true;
    r.onresult = (e) => {
      let done = '';
      let partial = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) done += t; else partial += t;
      }
      if (done.trim()) cb.current(done.trim());
      setInterim(partial.trim());
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') useStore.getState().toast('The microphone is blocked. Allow it for this site in the browser (the icon in the address bar), then try again.', 'bad');
      else if (e.error === 'no-speech') useStore.getState().toast("Didn't hear anything. Press the mic and speak.", 'info');
      else if (e.error !== 'aborted') useStore.getState().toast(`Voice typing stopped (${e.error}).`, 'bad');
    };
    r.onend = () => { rec.current = null; setListening(false); setInterim(''); };
    rec.current = r;
    try { r.start(); setListening(true); } catch { rec.current = null; }
  }
  function stop() { try { rec.current?.stop(); } catch { /* already stopped */ } }
  return { supported: dictationSupported, listening, interim, start, stop, toggle: () => (rec.current ? stop() : start()) };
}

/** Add spoken words to a draft with sensible spacing and a capital at the start of a sentence. */
export function appendWords(draft, words) {
  const d = String(draft || '');
  let w = String(words || '').trim();
  if (!w) return d;
  const startOfSentence = !d.trim() || /[.!?]\s*$/.test(d);
  if (startOfSentence) w = w.charAt(0).toUpperCase() + w.slice(1);
  return d && !/\s$/.test(d) ? `${d} ${w}` : d + w;
}
