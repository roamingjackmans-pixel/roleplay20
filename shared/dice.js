// shared/dice.js — dice expression parser + roller (pure ESM, browser + Node).
//
// Grammar (case-insensitive, whitespace ignored):
//   expr  := term (("+" | "-") term)*
//   term  := [N] "d" (M | "%") [("kh" | "kl" | "k") K]  |  integer
// Examples: "1d20+5", "2d6+1d4+3", "4d6kh3", "2d20kl1", "d%", "1d8-1", "3d6 + 2".
//
// Contract (docs/CONTRACTS.md):
//   parseDice(expr) -> { terms: [{ count, sides, keep?, keepCount?, sign? } | { mod }], valid }
//   rollDice(expr, { rng, advantage: "none"|"adv"|"dis", crit }) ->
//     { expr, total, terms: [{ sides, count, rolls, kept, sign? } | { mod }], natural, isCrit, isFumble, text, valid }
//   rollD20(mod, { advantage, rng }), manualD20(natural, mod)
// Extras: defaultRng, rollDie, diceAverage, diceMin, diceMax, formatMod, normalizeDice.

const MAX_COUNT = 1000;
const MAX_SIDES = 10000;

/** Default RNG: uniform float in [0, 1) from crypto.getRandomValues (falls back to Math.random). */
export function defaultRng() {
  const c = globalThis.crypto;
  if (c && typeof c.getRandomValues === "function") {
    const buf = new Uint32Array(1);
    c.getRandomValues(buf);
    return buf[0] / 4294967296;
  }
  return Math.random();
}

/** Roll one die with `sides` faces using rng() in [0,1). */
export function rollDie(sides, rng = defaultRng) {
  let r = rng();
  if (!(r >= 0)) r = 0;
  if (r >= 1) r = 0.999999999;
  return Math.floor(r * sides) + 1;
}

/** "+3", "-1", "" for 0 (or "+0" with `zero: true`). */
export function formatMod(mod, { zero = false } = {}) {
  const n = Number(mod) || 0;
  if (n === 0) return zero ? "+0" : "";
  return n > 0 ? `+${n}` : `${n}`;
}

const TERM_RE = /^(\d*)d(\d+|%)(?:(kh|kl|k)(\d*))?$/;

export function parseDice(expr) {
  const src = String(expr ?? "").toLowerCase().replace(/\s+/g, "").replace(/×/g, "x");
  if (!src) return { terms: [], valid: false };
  const parts = src.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join("") !== src) return { terms: [], valid: false };
  const terms = [];
  for (const raw of parts) {
    let sign = 1;
    let p = raw;
    if (p[0] === "+") p = p.slice(1);
    else if (p[0] === "-") { sign = -1; p = p.slice(1); }
    if (!p) return { terms: [], valid: false };
    if (/^\d+$/.test(p)) {
      terms.push({ mod: sign * Number(p) });
      continue;
    }
    const m = p.match(TERM_RE);
    if (!m) return { terms: [], valid: false };
    const count = m[1] === "" ? 1 : Number(m[1]);
    const sides = m[2] === "%" ? 100 : Number(m[2]);
    if (count < 1 || count > MAX_COUNT || sides < 1 || sides > MAX_SIDES) return { terms: [], valid: false };
    const t = { count, sides };
    if (m[3]) {
      t.keep = m[3] === "kl" ? "l" : "h";
      t.keepCount = m[4] === "" ? 1 : Number(m[4]);
      if (t.keepCount < 1) return { terms: [], valid: false };
      if (t.keepCount > count) t.keepCount = count;
    }
    if (sign < 0) t.sign = -1;
    terms.push(t);
  }
  return { terms, valid: terms.length > 0 };
}

/** Canonical string for parsed terms, e.g. "2d6+1d4+3". */
export function termsToString(terms) {
  let s = "";
  for (const t of terms) {
    let part;
    if ("mod" in t) part = String(Math.abs(t.mod));
    else part = `${t.count}d${t.sides}${t.keep ? `k${t.keep}${t.keepCount}` : ""}`;
    const neg = "mod" in t ? t.mod < 0 : t.sign === -1;
    s += s === "" ? (neg ? "-" : "") + part : (neg ? "-" : "+") + part;
  }
  return s;
}

export function normalizeDice(expr) {
  const p = parseDice(expr);
  return p.valid ? termsToString(p.terms) : null;
}

function keepIndices(rolls, keep, keepCount) {
  const order = rolls.map((v, i) => [v, i]).sort((a, b) => (keep === "l" ? a[0] - b[0] : b[0] - a[0]) || a[1] - b[1]);
  return new Set(order.slice(0, keepCount).map((x) => x[1]));
}

function fmtTermRolls(t) {
  if (!t.keepSet) return `[${t.rolls.join(", ")}]`;
  return `[${t.rolls.map((v, i) => (t.keepSet.has(i) ? String(v) : `~${v}~`)).join(", ")}]`;
}

/**
 * Roll an expression. Advantage/disadvantage affects the first d20 term only (rolls one extra d20 and keeps
 * the highest/lowest). `crit` doubles the number of dice in every dice term (keep counts double too).
 */
export function rollDice(expr, { rng = defaultRng, advantage = "none", crit = false } = {}) {
  const parsed = parseDice(expr);
  const exprStr = String(expr ?? "");
  if (!parsed.valid) {
    return {
      expr: exprStr, total: 0, terms: [], natural: null, isCrit: false, isFumble: false,
      text: `invalid dice expression: ${exprStr}`, valid: false,
    };
  }
  const adv = advantage === "adv" || advantage === "advantage" || advantage === true ? "adv"
    : advantage === "dis" || advantage === "disadvantage" ? "dis" : "none";
  let d20Done = false;
  let natural = null;
  let total = 0;
  const out = [];
  const textParts = [];
  for (const t of parsed.terms) {
    if ("mod" in t) {
      out.push({ mod: t.mod });
      total += t.mod;
      textParts.push({ neg: t.mod < 0, s: String(Math.abs(t.mod)) });
      continue;
    }
    let count = t.count;
    let keep = t.keep;
    let keepCount = t.keepCount;
    const isFirstD20 = t.sides === 20 && !d20Done;
    if (crit && !isFirstD20) {
      count *= 2;
      if (keep) keepCount *= 2;
    }
    if (isFirstD20 && adv !== "none" && !keep) {
      keep = adv === "adv" ? "h" : "l";
      keepCount = count;
      count += 1;
    }
    const rolls = [];
    for (let i = 0; i < count; i++) rolls.push(rollDie(t.sides, rng));
    let keepSet = null;
    let kept = rolls.slice();
    if (keep) {
      keepSet = keepIndices(rolls, keep, Math.min(keepCount, count));
      kept = rolls.filter((_, i) => keepSet.has(i));
    }
    const sum = kept.reduce((a, b) => a + b, 0);
    const sign = t.sign === -1 ? -1 : 1;
    total += sign * sum;
    if (isFirstD20) {
      d20Done = true;
      natural = kept[0];
    }
    const term = { sides: t.sides, count, rolls, kept };
    if (sign < 0) term.sign = -1;
    out.push(term);
    textParts.push({ neg: sign < 0, s: fmtTermRolls({ rolls, keepSet }) });
  }
  const label = termsToString(parsed.terms) + (adv === "adv" && d20Done ? " (adv)" : adv === "dis" && d20Done ? " (dis)" : "") + (crit ? " (crit)" : "");
  let body = "";
  textParts.forEach((p, i) => {
    if (i === 0) body += (p.neg ? "-" : "") + p.s;
    else body += (p.neg ? " - " : " + ") + p.s;
  });
  const hasD20 = natural != null;
  return {
    expr: exprStr,
    total,
    terms: out,
    natural,
    isCrit: hasD20 ? natural === 20 : !!crit,
    isFumble: hasD20 ? natural === 1 : false,
    text: `${label} → ${body} = ${total}`,
    valid: true,
  };
}

/** Roll 1d20 + mod. */
export function rollD20(mod = 0, { advantage = "none", rng = defaultRng } = {}) {
  return rollDice(`1d20${formatMod(mod)}`, { rng, advantage });
}

/** Build a d20 result from a natural roll the player entered (physical dice). */
export function manualD20(natural, mod = 0) {
  const nat = Math.max(1, Math.min(20, Math.round(Number(natural) || 1)));
  const m = Number(mod) || 0;
  const terms = [{ sides: 20, count: 1, rolls: [nat], kept: [nat] }];
  if (m) terms.push({ mod: m });
  const total = nat + m;
  const modText = m ? (m > 0 ? ` + ${m}` : ` - ${-m}`) : "";
  return {
    expr: `1d20${formatMod(m)}`,
    total,
    terms,
    natural: nat,
    isCrit: nat === 20,
    isFumble: nat === 1,
    text: `1d20${formatMod(m)} (manual) → [${nat}]${modText} = ${total}`,
    valid: true,
    manual: true,
  };
}

function stat(expr, fn) {
  const p = parseDice(expr);
  if (!p.valid) return null;
  let v = 0;
  for (const t of p.terms) {
    if ("mod" in t) v += t.mod;
    else v += (t.sign === -1 ? -1 : 1) * fn(t);
  }
  return v;
}

/** Expected value (keep-terms approximated as keepCount dice). */
export function diceAverage(expr) {
  return stat(expr, (t) => (t.keep ? t.keepCount : t.count) * (t.sides + 1) / 2);
}
export function diceMin(expr) {
  return stat(expr, (t) => (t.sign === -1 ? (t.keep ? t.keepCount : t.count) * t.sides : t.keep ? t.keepCount : t.count));
}
export function diceMax(expr) {
  return stat(expr, (t) => (t.sign === -1 ? (t.keep ? t.keepCount : t.count) : (t.keep ? t.keepCount : t.count) * t.sides));
}
