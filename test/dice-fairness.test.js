import { test } from "node:test";
import assert from "node:assert/strict";
import { faceFromWord, fairDie, rollD20, rollDice } from "../shared/dice.js";

// chi-square statistic of observed counts against expected probabilities
function chi(counts, probs) {
  const n = counts.reduce((a, b) => a + b, 0);
  return counts.reduce((s, c, i) => s + (c - probs[i] * n) ** 2 / (probs[i] * n), 0);
}
// critical values with a false-alarm chance of about one in ten million, so a fair die never fails this test
const CRIT = { 3: 36, 5: 41, 7: 45, 11: 53, 19: 66 };

test("faceFromWord: every face gets the same number of 32-bit words; the leftover words are redrawn", () => {
  // 2^32 = 214,748,364 * 20 + 16: the top 16 words would give faces 1-16 one extra chance, so they're thrown away
  assert.equal(faceFromWord(0, 20), 1);
  assert.equal(faceFromWord(19, 20), 20);
  assert.equal(faceFromWord(4294967279, 20), 20); // last word of the last full set
  for (let w = 4294967280; w <= 4294967295; w++) assert.equal(faceFromWord(w, 20), null);
  // a power of two divides 2^32 evenly: nothing is thrown away
  assert.equal(faceFromWord(4294967295, 8), 8);
  assert.equal(faceFromWord(4294967295, 6), null); // 2^32 % 6 = 4
  assert.equal(faceFromWord(4294967291, 6), 6);
});

test("fairDie stays within 1..sides", () => {
  for (const s of [1, 2, 4, 6, 8, 10, 12, 20, 100]) {
    for (let i = 0; i < 2000; i++) {
      const v = fairDie(s);
      assert.ok(Number.isInteger(v) && v >= 1 && v <= s, `d${s} gave ${v}`);
    }
  }
});

test("the real roll functions are uniform (chi-square over 200,000 rolls of each die)", () => {
  const N = 200000;
  for (const sides of [4, 6, 8, 12, 20]) {
    const counts = new Array(sides).fill(0);
    for (let i = 0; i < N; i++) counts[rollDice(`1d${sides}`).total - 1]++;
    const x = chi(counts, counts.map(() => 1 / sides));
    assert.ok(x < CRIT[sides - 1], `d${sides} chi-square ${x.toFixed(1)} is too high: ${counts.join(", ")}`);
  }
  const d20 = new Array(20).fill(0);
  for (let i = 0; i < N; i++) d20[rollD20(3).natural - 1]++;
  assert.ok(chi(d20, d20.map(() => 1 / 20)) < CRIT[19], `rollD20: ${d20.join(", ")}`);
});

test("advantage and disadvantage follow keep-the-higher / keep-the-lower of two fair d20s", () => {
  const N = 200000;
  const adv = new Array(20).fill(0);
  const dis = new Array(20).fill(0);
  for (let i = 0; i < N; i++) {
    adv[rollD20(0, { advantage: "adv" }).natural - 1]++;
    dis[rollD20(0, { advantage: "dis" }).natural - 1]++;
  }
  const pAdv = adv.map((_, i) => (2 * (i + 1) - 1) / 400);
  const pDis = dis.map((_, i) => (41 - 2 * (i + 1)) / 400);
  assert.ok(chi(adv, pAdv) < CRIT[19], `advantage: ${adv.join(", ")}`);
  assert.ok(chi(dis, pDis) < CRIT[19], `disadvantage: ${dis.join(", ")}`);
});
