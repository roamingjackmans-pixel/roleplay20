// Searching the Journal (session write-ups, the story so far, the world bible).
//
// A query is words and "quoted words". A plain word matches anywhere inside a word ("hand" finds hand, handle,
// secondhand); a quoted word or phrase matches whole words only ("hand" finds hand and hand's, not handle).
// Case never matters. With several terms a passage has to mention all of them.
//
//   parseQuery('"hand" mill')     -> [{ text: 'hand', whole: true }, { text: 'mill', whole: false }]
//   findMatches(text, terms)      -> [[start, end], ...] every place a term appears, sorted, never overlapping
//   passageMatches(text, terms)   -> true when every term appears
//   splitPassages(markdown)       -> [{ text, heading }] paragraphs, list items and headings, each with the heading
//                                    above it
//   searchMarkdown(markdown, q)   -> the passages that match, in order

const WORD = /[\p{L}\p{N}]/u;

/** Split a search box's text into terms: "quoted words" match whole words, other words match inside words. */
export function parseQuery(q) {
  const terms = [];
  const src = String(q ?? "");
  const re = /"([^"]*)"?|(\S+)/g;
  let m;
  while ((m = re.exec(src))) {
    if (m[1] !== undefined) {
      const text = m[1].trim().replace(/\s+/g, " ");
      if (text) terms.push({ text: text.toLowerCase(), whole: true });
    } else {
      const text = m[2].replace(/"/g, "");
      if (text) terms.push({ text: text.toLowerCase(), whole: false });
    }
  }
  // the same term twice adds nothing
  const seen = new Set();
  return terms.filter((t) => {
    const k = `${t.whole ? "w" : "p"}:${t.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const isWordChar = (ch) => !!ch && WORD.test(ch);

/** Every [start, end] where one term appears in text (whole-word terms only at word edges). */
function termMatches(text, term) {
  const out = [];
  const hay = String(text ?? "").toLowerCase();
  const needle = term.text;
  if (!needle) return out;
  let from = 0;
  for (;;) {
    const i = hay.indexOf(needle, from);
    if (i < 0) break;
    const end = i + needle.length;
    // a whole word: no letter or digit right before or after (so "hand" isn't found in "handle" or "shand")
    const startOk = !isWordChar(needle[0]) || !isWordChar(hay[i - 1]);
    const endOk = !isWordChar(needle[needle.length - 1]) || !isWordChar(hay[end]);
    if (!term.whole || (startOk && endOk)) out.push([i, end]);
    from = i + 1;
  }
  return out;
}

/** All matches of all terms, sorted, with overlapping ones merged (for highlighting). */
export function findMatches(text, terms) {
  const all = [];
  for (const t of terms || []) all.push(...termMatches(text, t));
  all.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const merged = [];
  for (const r of all) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return merged;
}

/** Does the text mention every term? */
export function passageMatches(text, terms) {
  if (!terms?.length) return false;
  return terms.every((t) => termMatches(text, t).length > 0);
}

/**
 * Markdown -> passages: each paragraph, each list item and each heading on its own, remembering the nearest heading
 * above it so a match can say which part of the write-up it's from.
 */
export function splitPassages(markdown) {
  const out = [];
  let heading = "";
  let para = [];
  const flush = () => {
    if (para.length) out.push({ text: para.join("\n"), heading, kind: "p" });
    para = [];
  };
  for (const raw of String(markdown ?? "").replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*([-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (h) {
      flush();
      heading = h[2].trim();
      out.push({ text: line, heading: "", kind: "h" });
    } else if (li) {
      flush();
      out.push({ text: line.trim(), heading, kind: "li" });
    } else if (!line.trim() || /^---+$/.test(line.trim())) {
      flush();
    } else {
      para.push(line.trim());
    }
  }
  flush();
  return out;
}

/** The passages of a markdown text that mention every term of the query (none when the query is empty). */
export function searchMarkdown(markdown, query) {
  const terms = Array.isArray(query) ? query : parseQuery(query);
  if (!terms.length) return [];
  return splitPassages(markdown).filter((p) => passageMatches(p.text.replace(/^#{1,4}\s+/, ""), terms));
}

/** Split text into plain and highlighted pieces: [{ text, hit }]. */
export function highlightPieces(text, terms) {
  const s = String(text ?? "");
  const ranges = findMatches(s, terms);
  if (!ranges.length) return [{ text: s, hit: false }];
  const out = [];
  let at = 0;
  for (const [a, b] of ranges) {
    if (a > at) out.push({ text: s.slice(at, a), hit: false });
    out.push({ text: s.slice(a, b), hit: true });
    at = b;
  }
  if (at < s.length) out.push({ text: s.slice(at), hit: false });
  return out;
}
