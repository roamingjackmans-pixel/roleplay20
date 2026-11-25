import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, findMatches, passageMatches, splitPassages, searchMarkdown, highlightPieces } from "../shared/journalSearch.js";

const q = (s) => parseQuery(s);
const hits = (text, query) => findMatches(text, q(query)).map(([a, b]) => text.slice(a, b));

test("parseQuery: plain words match inside words, quoted words match whole words", () => {
  assert.deepEqual(q("hand"), [{ text: "hand", whole: false }]);
  assert.deepEqual(q('"hand"'), [{ text: "hand", whole: true }]);
  assert.deepEqual(q('  "Iron Hand"  mill '), [{ text: "iron hand", whole: true }, { text: "mill", whole: false }]);
  assert.deepEqual(q('"hand'), [{ text: "hand", whole: true }], "an unclosed quote still counts");
  assert.deepEqual(q(""), []);
  assert.deepEqual(q('  ""  '), []);
  assert.deepEqual(q("hand HAND"), [{ text: "hand", whole: false }], "the same word twice is one term");
});

test("plain hand matches anywhere in a word: hand, handle, secondhand", () => {
  const text = "She took his hand, then the handle of the secondhand cart. Hands up!";
  assert.deepEqual(hits(text, "hand"), ["hand", "hand", "hand", "Hand"]);
});

test('quoted "hand" matches the whole word only', () => {
  const text = "She took his hand, then the handle of the secondhand cart. Hand-made; the hand's grip. Hands up!";
  assert.deepEqual(hits(text, '"hand"'), ["hand", "Hand", "hand"]);
  assert.equal(passageMatches("Grab the handle.", q('"hand"')), false);
  assert.equal(passageMatches("Grab the handle.", q("hand")), true);
});

test("case never matters, and accented letters count as letters", () => {
  assert.deepEqual(hits("The KRAKEN rose. kraken!", "Kraken"), ["KRAKEN", "kraken"]);
  assert.equal(passageMatches("Café Élan", q('"élan"')), true);
  assert.equal(passageMatches("Élanor", q('"élan"')), false, "é is a letter, so Élanor isn't the whole word élan");
});

test("quoted phrases match as whole words, across any spacing in the query", () => {
  assert.equal(passageMatches("They met the Iron Hand at dawn.", q('"iron   hand"')), true);
  assert.equal(passageMatches("They met the Iron Handlers at dawn.", q('"iron hand"')), false);
});

test("several terms: a passage must mention all of them", () => {
  const terms = q('mill "rat"');
  assert.equal(passageMatches("A rat in the mill.", terms), true);
  assert.equal(passageMatches("A rat in the barn.", terms), false);
  assert.equal(passageMatches("Pirates at the mill.", terms), false, "rat inside pirates is not the word rat");
});

test("highlights never overlap and keep the original text", () => {
  const text = "handhand handle";
  const pieces = highlightPieces(text, q("hand handh"));
  assert.equal(pieces.map((p) => p.text).join(""), text);
  assert.deepEqual(pieces.filter((p) => p.hit).map((p) => p.text), ["handhand", "hand"]);
  assert.deepEqual(highlightPieces("nothing here", q("hand")), [{ text: "nothing here", hit: false }]);
});

test("splitPassages: paragraphs, list items and headings, each with its heading", () => {
  const md = "# Session 3\nThe party left town.\nThey walked all day.\n\n## The mill\n- A rat ran past.\n- Old Pell waved.\n\nThe wheel turned.\n---\nEnd.";
  const p = splitPassages(md);
  assert.deepEqual(p.map((x) => [x.kind, x.text, x.heading]), [
    ["h", "# Session 3", ""],
    ["p", "The party left town.\nThey walked all day.", "Session 3"],
    ["h", "## The mill", ""],
    ["li", "- A rat ran past.", "The mill"],
    ["li", "- Old Pell waved.", "The mill"],
    ["p", "The wheel turned.", "The mill"],
    ["p", "End.", "The mill"],
  ]);
});

test("searchMarkdown: only the passages that mention the term", () => {
  const md = "## The mill\nThe miller's hand shook.\n\nThe wheel turned.\n\n- Grab the handle\n- Run";
  assert.deepEqual(searchMarkdown(md, "hand").map((p) => p.text), ["The miller's hand shook.", "- Grab the handle"]);
  assert.deepEqual(searchMarkdown(md, '"hand"').map((p) => p.text), ["The miller's hand shook."]);
  assert.deepEqual(searchMarkdown(md, "mill").map((p) => p.text), ["## The mill", "The miller's hand shook."]);
  assert.deepEqual(searchMarkdown(md, ""), []);
  assert.deepEqual(searchMarkdown("", "hand"), []);
});
