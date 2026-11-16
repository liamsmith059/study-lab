// Node unit checks for the question bank and study logic: node tests/engine.test.mjs
import assert from "node:assert/strict";
import { RAW } from "../js/questions.js";
import * as E from "../js/engine.js";

let failures = 0;
const t = (name, fn) => { try { fn(); console.log("ok   " + name); } catch (e) { failures++; console.log("FAIL " + name + "\n     " + e.message); } };

t("306 questions, 51 per subject", () => {
  assert.equal(E.QUESTIONS.length, 306);
  for (const k of E.SUBJECT_KEYS) assert.equal(RAW[k].length, 51, k);
});
t("every question is well formed", () => {
  const seenQ = new Set();
  for (const q of E.QUESTIONS) {
    assert.ok([1, 2, 3].includes(q.d), q.id + " difficulty");
    assert.ok(q.t && q.q && q.e, q.id + " text");
    assert.equal(q.c.length, 4, q.id + " has 4 choices");
    assert.equal(new Set(q.c).size, 4, q.id + " choices unique");
    q.c.forEach((c) => assert.ok(typeof c === "string" && c.trim(), q.id + " empty choice"));
    assert.ok(!seenQ.has(q.q), "duplicate question text: " + q.q);
    seenQ.add(q.q);
  }
});
t("each subject has all three difficulties", () => {
  for (const k of E.SUBJECT_KEYS) for (const d of [1, 2, 3]) assert.ok(E.QUESTIONS.some((q) => q.s === k && q.d === d), k + d);
});
t("new subject session: 10 questions, level 1 serves no hard ones, easiest first", () => {
  const ids = E.buildSession(E.emptyStore(), ["math"], "subject");
  assert.equal(ids.length, 10);
  const ds = ids.map((id) => E.QMAP[id].d);
  assert.ok(!ds.includes(3));
  assert.deepEqual(ds, [...ds].sort());
});
t("mixed review interleaves subjects", () => {
  const ids = E.buildSession(E.emptyStore(), E.SUBJECT_KEYS, "mixed");
  assert.equal(ids.length, 10);
  for (let i = 1; i < ids.length; i++) assert.notEqual(E.QMAP[ids[i]].s, E.QMAP[ids[i - 1]].s);
});
t("spaced repetition boxes and intervals", () => {
  const now = 1_700_000_000_000, q = E.QMAP.math0;
  let st = E.applyAnswer(E.emptyStore(), q, true, "sure", now);
  assert.equal(st.cards.math0.b, 3); assert.equal(st.cards.math0.due, now + 3 * E.DAY);
  st = E.applyAnswer(st, q, true, "unsure", now); assert.equal(st.cards.math0.b, 4);
  st = E.applyAnswer(st, q, true, "guess", now); assert.equal(st.cards.math0.b, 4);
  st = E.applyAnswer(st, q, false, "sure", now); assert.equal(st.cards.math0.b, 1); assert.equal(st.cards.math0.due, now + 10 * E.MIN);
  let s2 = E.emptyStore(); for (let i = 0; i < 8; i++) s2 = E.applyAnswer(s2, q, true, "unsure", now);
  assert.equal(s2.cards.math0.b, 6);
  assert.equal(st.total, 4); assert.equal(st.right, 3);
});
t("levels unlock at 60%/8 and 75%/15", () => {
  let st = E.emptyStore();
  const qs = E.QUESTIONS.filter((q) => q.s === "sci");
  for (let i = 0; i < 7; i++) st = E.applyAnswer(st, qs[i], true, "unsure");
  assert.equal(E.levelOf(st, "sci"), 1);
  st = E.applyAnswer(st, qs[7], true, "unsure"); assert.equal(E.levelOf(st, "sci"), 2);
  for (let i = 8; i < 15; i++) st = E.applyAnswer(st, qs[i], true, "unsure");
  assert.equal(E.levelOf(st, "sci"), 3);
  const ids = E.buildSession(st, ["sci"], "subject");
  assert.ok(ids.some((id) => E.QMAP[id].d === 3), "hard questions appear at level 3");
});
t("due review picks only due cards", () => {
  const now = Date.now();
  let st = E.applyAnswer(E.emptyStore(), E.QMAP.geo0, false, "sure", now - 20 * E.MIN);
  st = E.applyAnswer(st, E.QMAP.geo1, true, "sure", now);
  assert.deepEqual(E.buildSession(st, E.SUBJECT_KEYS, "due", now), ["geo0"]);
});
t("merge keeps the newest answer per question and loses nothing", () => {
  let a = E.applyAnswer(E.emptyStore(), E.QMAP.math0, true, "sure", 1000);
  a = E.applyAnswer(a, E.QMAP.math1, true, "sure", 3000);
  let b = E.applyAnswer(E.emptyStore(), E.QMAP.math1, false, "sure", 2000);
  b = E.applyAnswer(b, E.QMAP.hist0, true, "sure", 2500);
  const m = E.mergeStores(a, b);
  assert.deepEqual(Object.keys(m.cards).sort(), ["hist0", "math0", "math1"]);
  assert.equal(m.cards.math1.t, 3000);
  assert.equal(m.total, 3);
  assert.deepEqual(E.mergeStores(b, a).cards, m.cards);
});
t("backup codes round-trip, and canvas-era codes load", () => {
  const st = E.applyAnswer(E.emptyStore(), E.QMAP.eng3, true, "sure", 5000);
  assert.deepEqual(E.decodeBackup(E.encodeBackup(st)).cards, st.cards);
  const canvasEra = { cards: { econ2: { b: 2, due: 9e12, n: 1, k: 1 } }, recent: { econ: [1] }, days: ["2026-11-16"], total: 1, right: 1 };
  const loaded = E.decodeBackup(Buffer.from(JSON.stringify(canvasEra)).toString("base64"));
  assert.equal(loaded.cards.econ2.b, 2); assert.ok(loaded.cards.econ2.t > 0); assert.equal(loaded.total, 1);
});

console.log(failures ? failures + " failed" : "all engine checks passed");
process.exit(failures ? 1 : 0);
