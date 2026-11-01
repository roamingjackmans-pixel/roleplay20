import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDice, rollDice, rollD20, manualD20, diceAverage, diceMin, diceMax, normalizeDice, rollDie, defaultRng, formatMod,
} from "../shared/dice.js";

/** rng that returns die faces in order: seq(20, [17]) -> a d20 that rolls 17. */
const faces = (sides, list) => {
  let i = 0;
  return () => (list[i++ % list.length] - 1) / sides + 1e-9;
};
/** rng from raw [0,1) values. */
const seqRng = (vals) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

test("parseDice: multiple terms, constants and signs", () => {
  const p = parseDice("2d6+1d4+3");
  assert.equal(p.valid, true);
  assert.deepEqual(p.terms, [{ count: 2, sides: 6 }, { count: 1, sides: 4 }, { mod: 3 }]);
  assert.deepEqual(parseDice("1d20-1").terms, [{ count: 1, sides: 20 }, { mod: -1 }]);
  assert.deepEqual(parseDice(" 3D6 + 2 ").terms, [{ count: 3, sides: 6 }, { mod: 2 }]);
  assert.deepEqual(parseDice("10-1d4").terms, [{ mod: 10 }, { count: 1, sides: 4, sign: -1 }]);
  assert.deepEqual(parseDice("d8").terms, [{ count: 1, sides: 8 }]);
});

test("parseDice: keep highest/lowest and d%", () => {
  assert.deepEqual(parseDice("4d6kh3").terms, [{ count: 4, sides: 6, keep: "h", keepCount: 3 }]);
  assert.deepEqual(parseDice("2d20kl1").terms, [{ count: 2, sides: 20, keep: "l", keepCount: 1 }]);
  assert.deepEqual(parseDice("2d20k1").terms, [{ count: 2, sides: 20, keep: "h", keepCount: 1 }]);
  assert.deepEqual(parseDice("d%").terms, [{ count: 1, sides: 100 }]);
  assert.deepEqual(parseDice("1d%+5").terms, [{ count: 1, sides: 100 }, { mod: 5 }]);
});

test("parseDice: invalid expressions", () => {
  for (const bad of ["", "abc", "2d", "1d0", "d", "1d6++2", "+", "1d6+", "0d6", "1d6x2", null, undefined]) {
    assert.equal(parseDice(bad).valid, false, `expected invalid: ${bad}`);
  }
});

test("normalizeDice", () => {
  assert.equal(normalizeDice(" 1d8 + 3 "), "1d8+3");
  assert.equal(normalizeDice("10-1d4"), "10-1d4");
  assert.equal(normalizeDice("x"), null);
});

test("rollDice: simple roll with readable text", () => {
  const r = rollDice("1d20+5", { rng: faces(20, [17]) });
  assert.equal(r.total, 22);
  assert.equal(r.natural, 17);
  assert.equal(r.isCrit, false);
  assert.equal(r.isFumble, false);
  assert.equal(r.valid, true);
  assert.equal(r.text, "1d20+5 → [17] + 5 = 22");
  assert.deepEqual(r.terms, [{ sides: 20, count: 1, rolls: [17], kept: [17] }, { mod: 5 }]);
});

test("rollDice: multiple dice terms and negative terms", () => {
  const r = rollDice("2d6+1d4+3", { rng: seqRng([0, 0.99, 0.5]) }); // 1, 6, 3
  assert.equal(r.total, 1 + 6 + 3 + 3);
  assert.equal(r.text, "2d6+1d4+3 → [1, 6] + [3] + 3 = 13");
  const n = rollDice("10-1d4", { rng: seqRng([0.99]) });
  assert.equal(n.total, 6);
  assert.equal(n.text, "10-1d4 → 10 - [4] = 6");
});

test("rollDice: advantage and disadvantage on the first d20 only", () => {
  const adv = rollDice("1d20+3", { advantage: "adv", rng: faces(20, [4, 18]) });
  assert.deepEqual(adv.terms[0].rolls, [4, 18]);
  assert.deepEqual(adv.terms[0].kept, [18]);
  assert.equal(adv.natural, 18);
  assert.equal(adv.total, 21);
  assert.match(adv.text, /\(adv\) → \[~4~, 18\] \+ 3 = 21/);
  const dis = rollDice("1d20+3", { advantage: "dis", rng: faces(20, [4, 18]) });
  assert.equal(dis.natural, 4);
  assert.equal(dis.total, 7);
  // second d20 term is unaffected
  const two = rollDice("1d20+1d20", { advantage: "adv", rng: faces(20, [5, 10, 7]) });
  assert.equal(two.terms[0].rolls.length, 2);
  assert.equal(two.terms[1].rolls.length, 1);
  assert.equal(two.total, 10 + 7);
  // advantage without a d20 does nothing
  const dmg = rollDice("2d6", { advantage: "adv", rng: faces(6, [2, 3]) });
  assert.equal(dmg.terms[0].rolls.length, 2);
  assert.equal(dmg.natural, null);
});

test("rollDice: keep highest / lowest", () => {
  const r = rollDice("4d6kh3", { rng: faces(6, [1, 6, 3, 5]) });
  assert.deepEqual(r.terms[0].rolls, [1, 6, 3, 5]);
  assert.deepEqual(r.terms[0].kept, [6, 3, 5]);
  assert.equal(r.total, 14);
  assert.equal(r.text, "4d6kh3 → [~1~, 6, 3, 5] = 14");
  const l = rollDice("2d20kl1", { rng: faces(20, [15, 9]) });
  assert.equal(l.total, 9);
  assert.equal(l.natural, 9);
});

test("rollDice: crit doubles dice, not modifiers", () => {
  const r = rollDice("1d8+3", { crit: true, rng: faces(8, [5, 7]) });
  assert.equal(r.terms[0].rolls.length, 2);
  assert.equal(r.total, 15);
  assert.equal(r.isCrit, true);
  assert.match(r.text, /\(crit\)/);
  const r2 = rollDice("2d6+1d4", { crit: true, rng: faces(6, [1]) });
  assert.equal(r2.terms[0].count, 4);
  assert.equal(r2.terms[1].count, 2);
});

test("rollDice: crits and fumbles on natural 20 / 1", () => {
  assert.equal(rollDice("1d20+2", { rng: faces(20, [20]) }).isCrit, true);
  const f = rollDice("1d20+2", { rng: faces(20, [1]) });
  assert.equal(f.isFumble, true);
  assert.equal(f.isCrit, false);
});

test("rollDice: d% and bounds with default rng", () => {
  for (let i = 0; i < 300; i++) {
    const r = rollDice("d%");
    assert.ok(r.total >= 1 && r.total <= 100);
    const s = rollDice("3d6+2");
    assert.ok(s.total >= 5 && s.total <= 20);
  }
  for (let i = 0; i < 100; i++) {
    const v = defaultRng();
    assert.ok(v >= 0 && v < 1);
    const d = rollDie(6);
    assert.ok(d >= 1 && d <= 6 && Number.isInteger(d));
  }
});

test("rollDice: invalid input does not throw", () => {
  const r = rollDice("banana");
  assert.equal(r.valid, false);
  assert.equal(r.total, 0);
  assert.match(r.text, /invalid/);
});

test("rollD20 and manualD20", () => {
  const r = rollD20(5, { rng: faces(20, [12]) });
  assert.equal(r.total, 17);
  assert.equal(r.expr, "1d20+5");
  const neg = rollD20(-2, { rng: faces(20, [12]) });
  assert.equal(neg.total, 10);
  const adv = rollD20(0, { advantage: "adv", rng: faces(20, [3, 16]) });
  assert.equal(adv.natural, 16);
  const m = manualD20(17, 5);
  assert.equal(m.total, 22);
  assert.equal(m.natural, 17);
  assert.equal(m.isCrit, false);
  assert.deepEqual(m.terms[0].kept, [17]);
  assert.match(m.text, /\[17\] \+ 5 = 22/);
  assert.equal(manualD20(20, 3).isCrit, true);
  assert.equal(manualD20(1, 3).isFumble, true);
  assert.equal(manualD20(14, -1).total, 13);
});

test("dice statistics and formatMod", () => {
  assert.equal(diceAverage("2d6+3"), 10);
  assert.equal(diceAverage("1d20"), 10.5);
  assert.equal(diceMin("2d6+3"), 5);
  assert.equal(diceMax("2d6+3"), 15);
  assert.equal(diceMin("10-1d4"), 6);
  assert.equal(diceMax("10-1d4"), 9);
  assert.equal(diceAverage("nope"), null);
  assert.equal(formatMod(3), "+3");
  assert.equal(formatMod(-1), "-1");
  assert.equal(formatMod(0), "");
  assert.equal(formatMod(0, { zero: true }), "+0");
});
