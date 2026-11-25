// Are the dice fair? Rolls the game's real dice functions (shared/dice.js, the same code the server uses for every
// roll) millions of times and checks the counts with a chi-square test.
//
//   node scripts/dice-fairness.mjs            1,000,000 rolls of each die
//   node scripts/dice-fairness.mjs 5000000    more rolls
//
// A p-value is the chance a perfectly fair die would look at least this uneven. Fair dice give p-values spread
// evenly between 0 and 1; a biased die drives p towards 0 (below 0.001 would be a red flag).
import { rollDice, rollD20 } from "../shared/dice.js";

const N = Math.max(10000, Number(process.argv[2]) || 1_000_000);

// ── chi-square p-value (regularized upper incomplete gamma) ─────────────────────────────────────────────────
function lgamma(x) {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const t = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let s = 1.000000000190015;
  for (const c of g) s += c / ++y;
  return -t + Math.log((2.5066282746310005 * s) / x);
}
function gammaQ(a, x) {
  if (x < a + 1) {
    let sum = 1 / a, del = sum, ap = a;
    for (let n = 0; n < 1000; n++) { ap += 1; del *= x / ap; sum += del; if (Math.abs(del) < Math.abs(sum) * 1e-15) break; }
    return 1 - sum * Math.exp(-x + a * Math.log(x) - lgamma(a));
  }
  let b = x + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
    c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return Math.exp(-x + a * Math.log(x) - lgamma(a)) * h;
}
export function chiSquare(counts, expected) {
  let chi = 0;
  for (let i = 0; i < counts.length; i++) chi += (counts[i] - expected[i]) ** 2 / expected[i];
  const df = counts.length - 1;
  return { chi, df, p: gammaQ(df / 2, chi / 2) };
}

const pct = (x) => `${(x * 100).toFixed(3)}%`;
const rows = [];
function report(name, counts, probs, n) {
  const expected = probs.map((p) => p * n);
  const r = chiSquare(counts, expected);
  let worst = 0;
  let worstFace = 0;
  counts.forEach((c, i) => { const d = Math.abs(c / n - probs[i]) / probs[i]; if (d > worst) { worst = d; worstFace = i + 1; } });
  rows.push({ name, ...r, worst, worstFace, min: Math.min(...counts.map((c, i) => c / n / probs[i])), max: Math.max(...counts.map((c, i) => c / n / probs[i])) });
  return r;
}

const t0 = Date.now();
// plain dice, through rollDice (the function behind every damage roll, hit-point roll and DM-requested roll)
for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
  const counts = new Array(sides).fill(0);
  for (let i = 0; i < N; i++) counts[rollDice(`1d${sides}`).total - 1]++;
  report(`d${sides}`, counts, new Array(sides).fill(1 / sides), N);
}
// the d20 as checks, saves and attacks roll it (rollD20), normal / advantage / disadvantage
{
  const counts = new Array(20).fill(0);
  for (let i = 0; i < N; i++) counts[rollD20(5).natural - 1]++;
  report("d20 check (rollD20)", counts, new Array(20).fill(1 / 20), N);
  const d20face = d20Faces(counts);
  console.log(`\nd20 faces from ${N.toLocaleString()} rolls of rollD20 (expected ${(N / 20).toLocaleString()} each):`);
  console.log(d20face);
}
{
  const adv = new Array(20).fill(0), dis = new Array(20).fill(0);
  for (let i = 0; i < N; i++) { adv[rollD20(0, { advantage: "adv" }).natural - 1]++; dis[rollD20(0, { advantage: "dis" }).natural - 1]++; }
  // keep the higher of two: P(k) = (2k - 1) / 400; keep the lower: P(k) = (41 - 2k) / 400
  report("d20 advantage", adv, adv.map((_, i) => (2 * (i + 1) - 1) / 400), N);
  report("d20 disadvantage", dis, dis.map((_, i) => (41 - 2 * (i + 1)) / 400), N);
}
// 4d6 drop lowest (ability scores in the character creator)
{
  const dist = new Map();
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) for (let d = 1; d <= 6; d++) {
    const s = a + b + c + d - Math.min(a, b, c, d);
    dist.set(s, (dist.get(s) || 0) + 1 / 1296);
  }
  const keys = [...dist.keys()].sort((x, y) => x - y);
  const counts = new Array(keys.length).fill(0);
  for (let i = 0; i < N; i++) counts[keys.indexOf(rollDice("4d6kh3").total)]++;
  report("4d6 drop lowest", counts, keys.map((k) => dist.get(k)), N);
}

function d20Faces(counts) {
  return counts.map((c, i) => `${String(i + 1).padStart(2)}: ${c.toLocaleString().padStart(9)}  (${pct(c / N)})`).join("\n");
}

console.log(`\n${"die".padEnd(22)} ${"chi-square".padStart(10)} ${"df".padStart(3)} ${"p-value".padStart(8)}   each face between`);
for (const r of rows) {
  console.log(`${r.name.padEnd(22)} ${r.chi.toFixed(2).padStart(10)} ${String(r.df).padStart(3)} ${r.p.toFixed(3).padStart(8)}   ${pct(r.min - 1)} and ${pct(r.max - 1)} of its fair share`);
}

// the old mapping, exactly (no sampling needed): floor(word / 2^32 * 20) over all 2^32 words
const per = Math.floor(4294967296 / 20);
const extra = 4294967296 % 20;
console.log(`\nOld mapping, worked out exactly: 2^32 random words over 20 faces = ${per.toLocaleString()} each with ${extra} left over, so ${extra} faces got one extra word: a difference of 1 in ${per.toLocaleString()} (${(100 / per).toExponential(1)}%). Now those leftover words are redrawn.`);
console.log(`\n${(N * (7 + 4) ).toLocaleString()} rolls in ${((Date.now() - t0) / 1000).toFixed(1)} s.`);
