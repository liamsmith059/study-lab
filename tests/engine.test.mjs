// Node unit checks for the question bank and study logic: node tests/engine.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RAW } from "../js/questions.js";
import { LSAT_ITEMS, LSAT_PASSAGES } from "../js/lsat.js";
import { EXTRA, EXTRA_PASSAGES } from "../js/practice.js";
import { STUDY_LESSONS } from "../js/study.js";
import { LESSON_TEXT } from "../js/lessons.js";
import * as E from "../js/engine.js";

let failures = 0;
const t = (name, fn) => { try { fn(); console.log("ok   " + name); } catch (e) { failures++; console.log("FAIL " + name + "\n     " + e.message); } };

// 306 original multiple-choice questions plus the practice formats in js/practice.js, plus the
// Study lesson questions in js/study.js (LSAT lessons are part of the LSAT bank).
const EXTRA_N = Object.values(EXTRA).reduce((a, l) => a + l.length, 0);
const SCHOOL_LESSONS = STUDY_LESSONS.filter((l) => l.s !== "lsat");
const STUDY_N = SCHOOL_LESSONS.reduce((a, l) => a + l.qs.length, 0);
const CORE_N = 306 + EXTRA_N + STUDY_N;
const isMC = (q) => !q.type;
// ---- before the LSAT bank is loaded (the site now loads js/lsat.js on demand) ----
// A store in the exact format the live site saves to localStorage ("study-lab-progress-v1").
const LIVE_STORE = {
  cards: {
    math0: { b: 3, due: 9e12, n: 2, k: 2, t: 1700000000000 },
    hist4: { b: 1, due: 5, n: 3, k: 1, t: 1700000001000 },
    lsat3: { b: 2, due: 4, n: 1, k: 1, t: 1700000002000 },
    lsat27: { b: 5, due: 9e12, n: 4, k: 4, t: 1700000003000 },
    lsat49: { b: 1, due: 6, n: 1, k: 0, t: 1700000004000 },
  },
  recent: { math: [1, 1], hist: [0, 1, 0], lsat: [1, 1, 1, 1, 0] },
  days: ["2026-11-14", "2026-11-15"], total: 11, right: 8, updatedAt: 1700000004000,
};
t("lazy LSAT: bank not loaded at import, core works", () => {
  assert.equal(E.lsatLoaded(), false);
  assert.equal(E.QUESTIONS.length, CORE_N);
  assert.equal(E.TOTAL_QUESTIONS, CORE_N + LSAT_ITEMS.length);
});
t("saved progress (live-site format) loads unchanged before the LSAT bank loads", () => {
  const n = E.normalize(JSON.parse(JSON.stringify(LIVE_STORE)));
  assert.deepEqual(n, LIVE_STORE);
  assert.deepEqual(E.decodeBackup(E.encodeBackup(LIVE_STORE)), LIVE_STORE);
  const lsat = E.subjectStats(n, "lsat", 1000);
  assert.equal(lsat.total, E.LSAT_META.total); assert.equal(lsat.seen, 3); assert.equal(lsat.mastered, 1); assert.equal(lsat.due, 2);
  assert.deepEqual(E.dueCounts(n, 1000), { core: 1, lsat: 2 });
  const other = E.applyAnswer(E.emptyStore(), E.QMAP.geo0, true, "sure", 1700000005000);
  const m = E.mergeStores(n, other);
  for (const id of Object.keys(LIVE_STORE.cards)) assert.deepEqual(m.cards[id], LIVE_STORE.cards[id], id + " kept by merge");
  assert.ok(m.cards.geo0);
  const after = E.applyAnswer(n, E.QMAP.math1, false, "sure", 1700000006000);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(LIVE_STORE).sort(), "same top-level shape");
  assert.deepEqual(after.cards.lsat27, LIVE_STORE.cards.lsat27, "answering a core question leaves LSAT cards alone");
  assert.ok(!E.normalize({ ...LIVE_STORE, cards: { lsat75: { b: 1, due: 1, n: 1, k: 1, t: 1 }, "math-x999": { b: 1, due: 1, n: 1, k: 1, t: 1 } } }).cards.lsat75, "unknown ids still dropped");
});
t("weakest topic and due counts", () => {
  let st = E.emptyStore();
  const alg = E.QUESTIONS.filter((q) => q.s === "math" && q.t === "Algebra");
  for (const q of alg.slice(0, 3)) st = E.applyAnswer(st, q, false, "sure", 1000);
  const bio = E.QUESTIONS.filter((q) => q.s === "sci" && q.t === "Biology");
  for (const q of bio.slice(0, 3)) st = E.applyAnswer(st, q, true, "sure", 1000);
  st = E.applyAnswer(st, bio[3], false, "sure", 1000);
  const w = E.weakestTopic(st);
  assert.equal(w.t, "Algebra"); assert.equal(w.s, "math"); assert.equal(w.n, 3); assert.equal(w.k, 0);
  assert.equal(E.weakestTopic(E.emptyStore()), null);
  assert.deepEqual(E.dueCounts(st, 1000 + 11 * E.MIN), { core: 4, lsat: 0 });
});

await E.loadLsat();
await E.loadLsat(); // a second call must not register the bank twice

t("LSAT bank loads on demand, once, and matches LSAT_META", () => {
  assert.equal(E.lsatLoaded(), true);
  assert.equal(E.QUESTIONS.length, CORE_N + LSAT_ITEMS.length, "no double registration");
  assert.equal(LSAT_ITEMS.length, E.LSAT_META.total);
  assert.equal(LSAT_ITEMS.filter((r) => !r.p && !r.type).length, E.LSAT_META.lr);
  assert.equal(LSAT_ITEMS.filter((r) => r.type).length, E.LSAT_META.x);
  assert.equal(LSAT_ITEMS.filter((r) => r.p).length, E.LSAT_META.rc);
  assert.equal(Object.keys(LSAT_PASSAGES).length, E.LSAT_META.sets);
  assert.equal(E.TOTAL_QUESTIONS, E.QUESTIONS.length);
});
t("saved progress is identical whether or not the LSAT bank was loaded", () => {
  assert.deepEqual(E.normalize(JSON.parse(JSON.stringify(LIVE_STORE))), LIVE_STORE);
  assert.equal(E.subjectStats(LIVE_STORE, "lsat", 1000).seen, 3);
  assert.deepEqual(E.dueCounts(LIVE_STORE, 1000), { core: 1, lsat: 2 });
});
t("306 original questions (51 per core subject) plus practice formats, plus the LSAT bank", () => {
  assert.equal(E.CORE_KEYS.length, 6);
  for (const k of E.CORE_KEYS) assert.equal(RAW[k].length, 51, k);
  assert.equal(E.QUESTIONS.filter((q) => q.s !== "lsat" && !q.id.includes("-x") && !q.id.includes("-s")).length, 306);
  assert.equal(E.QUESTIONS.filter((q) => q.s !== "lsat").length, CORE_N);
  assert.equal(E.QUESTIONS.filter((q) => q.s === "lsat").length, LSAT_ITEMS.length);
  assert.ok(LSAT_ITEMS.length >= 70 && LSAT_ITEMS.length <= 80, "LSAT bank size " + LSAT_ITEMS.length);
});
t("every multiple-choice question is well formed (4 choices core, 5 choices LSAT)", () => {
  const seenQ = new Set();
  for (const q of E.QUESTIONS.filter(isMC)) {
    const n = q.s === "lsat" ? 5 : 4;
    assert.ok([1, 2, 3].includes(q.d), q.id + " difficulty");
    assert.ok(q.t && q.q && q.e, q.id + " text");
    assert.equal(q.c.length, n, q.id + " has " + n + " choices");
    assert.equal(new Set(q.c).size, n, q.id + " choices unique");
    q.c.forEach((c) => assert.ok(typeof c === "string" && c.trim(), q.id + " empty choice"));
    const key = q.q + "|" + (q.stim || "") + "|" + (q.p || "");
    assert.ok(!seenQ.has(key), "duplicate question: " + q.q);
    seenQ.add(key);
  }
});
t("LSAT items: fixed A-E order, trap note, stimulus or passage", () => {
  for (const q of E.QUESTIONS.filter((x) => x.s === "lsat" && isMC(x))) {
    assert.equal(q.fixed.length, 5, q.id);
    assert.deepEqual([...q.fixed].sort(), [...q.c].sort(), q.id + " fixed order is a permutation");
    assert.ok(q.trap && q.trap !== q.c[0] && q.c.includes(q.trap), q.id + " trap is a wrong choice");
    assert.ok(q.te && q.te.length > 40, q.id + " tempting-but-wrong note");
    assert.ok(q.e.length > 80, q.id + " explanation is thorough");
    assert.ok(!!q.stim !== !!q.p, q.id + " has exactly one of stim / passage");
    if (q.p) assert.ok(LSAT_PASSAGES[q.p], q.id + " passage exists");
    assert.ok(["short", "medium", "long"].includes(q.len), q.id + " len");
    assert.equal(q.len === "long", !!q.p, q.id + " long = passage set");
    assert.ok(/^(LR|RC) · /.test(q.t), q.id + " type label");
  }
});
const sentences = (s) => (s.replace(/\n/g, " ").replace(/\b(Dr|Mr|Ms|Mrs)\./g, "$1").match(/[.!?](?=[”"’]?\s|[”"’]?$)/g) || []).length;
t("LSAT lengths: short LR 2-4 sentences, medium LR 5-8 sentences", () => {
  const lr = E.QUESTIONS.filter((q) => E.isLR(q) && isMC(q));
  for (const q of lr) {
    const n = sentences(q.stim);
    if (q.len === "short") assert.ok(n >= 2 && n <= 4, q.id + " short has " + n + " sentences");
    else assert.ok(q.len === "medium" && n >= 5 && n <= 8, q.id + " medium has " + n + " sentences");
  }
  assert.ok(lr.filter((q) => q.len === "medium").length >= 8, "enough medium LR");
  assert.ok(lr.some((q) => q.len === "medium" && /Parallel/.test(q.t)), "medium parallel reasoning");
  assert.ok(lr.some((q) => q.len === "medium" && /Principle/.test(q.t)), "medium principle");
});
t("LSAT passage sets: at least 3, distinct topic areas, 400-520 words, 5-6 questions each", () => {
  const words = (p) => (p.kind === "comparative" ? p.a.concat(p.b) : p.paras).join(" ").split(/\s+/).length;
  const keys = Object.keys(LSAT_PASSAGES);
  assert.ok(keys.length >= 3);
  assert.equal(new Set(keys.map((k) => LSAT_PASSAGES[k].area)).size, keys.length, "distinct areas");
  assert.ok(keys.some((k) => LSAT_PASSAGES[k].kind === "comparative"), "a comparative pair");
  for (const k of keys) {
    const w = words(LSAT_PASSAGES[k]);
    assert.ok(w >= 400 && w <= 520, k + " has " + w + " words");
    const n = E.passageIds(k).length;
    assert.ok(n >= 5 && n <= 6, k + " has " + n + " questions");
  }
  assert.deepEqual([...E.PASSAGE_KEYS].sort(), [...keys].sort());
});
t("LSAT answer balance: correct is longest in at most 20%, letters spread evenly", () => {
  const qs = E.QUESTIONS.filter((q) => q.s === "lsat" && isMC(q));
  const longest = qs.filter((q) => q.c[0].length >= Math.max(...q.c.slice(1).map((c) => c.length))).length;
  assert.ok(longest / qs.length <= 0.2, "correct longest in " + longest + "/" + qs.length);
  const counts = {};
  for (const q of qs) { const L = E.LETTERS[q.fixed.indexOf(q.c[0])]; counts[L] = (counts[L] || 0) + 1; }
  const even = qs.length / 5;
  for (const L of E.LETTERS) assert.ok(Math.abs((counts[L] || 0) - even) <= 2, "letter " + L + ": " + counts[L]);
});
t("LSAT difficulty spread", () => {
  const qs = E.QUESTIONS.filter((q) => q.s === "lsat");
  for (const d of [1, 2, 3]) assert.ok(qs.filter((q) => q.d === d).length >= qs.length * 0.25, "difficulty " + d);
  for (const d of [1, 2, 3]) assert.ok(qs.some((q) => E.isLR(q) && q.d === d) && qs.some((q) => q.p && q.d === d), "LR and RC at difficulty " + d);
});
t("choiceOrder: LSAT fixed, core shuffled copy", () => {
  const l = E.QMAP.lsat0;
  assert.deepEqual(E.choiceOrder(l), l.fixed);
  assert.notEqual(E.choiceOrder(l), l.fixed, "returns a copy");
  assert.deepEqual([...E.choiceOrder(E.QMAP.math0)].sort(), [...E.QMAP.math0.c].sort());
});
t("LSAT rounds: short = 10 LR only, long = one whole passage set in order, mix = 5 LR + a set", () => {
  const st = E.emptyStore();
  const short = E.buildLsatSession(st, "short");
  assert.equal(short.length, 10);
  assert.ok(short.every((id) => E.isLR(E.QMAP[id])));
  assert.ok(!short.some((id) => E.QMAP[id].d === 3), "level 1 serves no hard LR");
  const long = E.buildLsatSession(st, "long");
  const key = E.QMAP[long[0]].p;
  assert.ok(key);
  assert.deepEqual(long, E.passageIds(key));
  const mix = E.buildLsatSession(st, "mix");
  assert.equal(mix.filter((id) => E.isLR(E.QMAP[id])).length, 5);
  assert.deepEqual(mix.slice(5), E.passageIds(E.QMAP[mix[5]].p));
});
t("long round prefers sets with due questions, then unseen sets", () => {
  const now = Date.now();
  const target = E.PASSAGE_KEYS[E.PASSAGE_KEYS.length - 1];
  const id = E.passageIds(target)[2];
  let st = E.applyAnswer(E.emptyStore(), E.QMAP[id], false, "sure", now - 20 * E.MIN);
  assert.equal(E.pickPassage(st, now), target, "due set first");
  st = E.emptyStore();
  for (const k of E.PASSAGE_KEYS.slice(0, -1)) for (const pid of E.passageIds(k)) st = E.applyAnswer(st, E.QMAP[pid], true, "sure", now);
  assert.equal(E.pickPassage(st, now), target, "only unseen set");
});
t("LSAT due review keeps passage questions together and LR first", () => {
  const now = Date.now();
  const [k1] = E.PASSAGE_KEYS;
  const p = E.passageIds(k1);
  let st = E.emptyStore();
  for (const id of [p[3], "lsat2", p[0], "lsat7"]) st = E.applyAnswer(st, E.QMAP[id], false, "sure", now - 20 * E.MIN);
  const ids = E.buildLsatSession(st, "due", now);
  assert.deepEqual(ids, ["lsat2", "lsat7", p[0], p[3]]);
});
t("Mixed review and core due review never include LSAT", () => {
  for (let i = 0; i < 20; i++) assert.ok(E.buildSession(E.emptyStore(), E.CORE_KEYS, "mixed").every((id) => E.QMAP[id].s !== "lsat"));
  const now = Date.now();
  let st = E.applyAnswer(E.emptyStore(), E.QMAP.lsat0, false, "sure", now - 20 * E.MIN);
  st = E.applyAnswer(st, E.QMAP.geo0, false, "sure", now - 20 * E.MIN);
  assert.deepEqual(E.buildSession(st, E.CORE_KEYS, "due", now), ["geo0"]);
});
t("LSAT progress: levels, spaced repetition, merge and backup all work", () => {
  const now = 1_700_000_000_000;
  let st = E.emptyStore();
  const lr = E.QUESTIONS.filter(E.isLR);
  for (let i = 0; i < 8; i++) st = E.applyAnswer(st, lr[i], true, "unsure", now);
  assert.equal(E.levelOf(st, "lsat"), 2);
  assert.equal(st.cards[lr[0].id].b, 1 + 1);
  const back = E.decodeBackup(E.encodeBackup(st));
  assert.deepEqual(back.cards, st.cards);
  assert.deepEqual(back.recent.lsat, st.recent.lsat);
  const other = E.applyAnswer(E.emptyStore(), E.QMAP.math0, true, "sure", now + 1);
  const m = E.mergeStores(st, other);
  assert.ok(m.cards.math0 && m.cards[lr[0].id]);
  assert.equal(E.subjectStats(m, "lsat", now).seen, 8);
});
t("pre-LSAT saved progress still loads unchanged", () => {
  const old = { cards: { math0: { b: 3, due: 9e12, n: 2, k: 2, t: 10 }, hist4: { b: 1, due: 5, n: 1, k: 0, t: 4 } }, recent: { math: [1, 1], hist: [0] }, days: ["2026-11-15"], total: 3, right: 2, updatedAt: 10 };
  const n = E.normalize(old);
  assert.deepEqual(n.cards, old.cards);
  assert.equal(n.total, 3);
  assert.deepEqual(E.decodeBackup(Buffer.from(JSON.stringify(old)).toString("base64")).cards, old.cards);
});
t("each subject has all three difficulties", () => {
  for (const k of E.SUBJECT_KEYS) for (const d of [1, 2, 3]) assert.ok(E.QUESTIONS.some((q) => q.s === k && q.d === d), k + d);
});
t("new subject session: 10 questions, level 1 serves no hard ones, easiest first", () => {
  for (let r = 0; r < 30; r++) {
    const ids = E.buildSession(E.emptyStore(), ["math"], "subject");
    assert.equal(ids.length, 10);
    const ds = ids.map((id) => E.QMAP[id].d);
    assert.ok(!ds.includes(3));
    // A reading set stays together in authored order, so the easiest-first check skips its questions.
    const loose = ids.filter((id) => !E.QMAP[id].p).map((id) => E.QMAP[id].d);
    assert.deepEqual(loose, [...loose].sort());
  }
});
t("mixed review interleaves subjects", () => {
  for (let r = 0; r < 30; r++) {
    const ids = E.buildSession(E.emptyStore(), E.CORE_KEYS, "mixed");
    assert.equal(ids.length, 10);
    // Neighbours differ in subject, except inside a reading set (which stays together).
    for (let i = 1; i < ids.length; i++) {
      const a = E.QMAP[ids[i - 1]], b = E.QMAP[ids[i]];
      if (!(a.p && a.p === b.p)) assert.notEqual(b.s, a.s, ids.join(","));
    }
  }
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


// ---------- practice formats: recall, explain why, put in order, match, reading sets ----------
const ALL_PRACTICE = () => E.QUESTIONS.filter((q) => q.type || (q.p && q.s !== "lsat"));
t("practice formats: 10-15 new questions in every category, every format in every school subject", () => {
  for (const k of E.CORE_KEYS) {
    const qs = E.QUESTIONS.filter((q) => q.s === k && q.id.includes("-x"));
    assert.ok(qs.length >= 10 && qs.length <= 15, k + " has " + qs.length);
    for (const type of ["typed", "explain", "order", "match"]) assert.ok(qs.some((q) => q.type === type), k + " has " + type);
    assert.ok(qs.filter((q) => q.p).length >= 2, k + " has a reading set");
  }
  const lsatNew = E.QUESTIONS.filter((q) => q.s === "lsat" && Number(q.id.slice(4)) >= 50 && Number(q.id.slice(4)) < 65);
  assert.ok(lsatNew.length >= 10 && lsatNew.length <= 15, "LSAT new " + lsatNew.length);
  for (const type of ["typed", "explain", "order", "match"]) assert.ok(lsatNew.some((q) => q.type === type), "LSAT has " + type);
});
t("practice ids: '<subject>-x<n>' appended after the original bank, unique, original ids unchanged", () => {
  for (const k of E.CORE_KEYS) {
    EXTRA[k].forEach((_, i) => assert.ok(E.QMAP[k + "-x" + i], k + "-x" + i));
    RAW[k].forEach((r, i) => assert.equal(E.QMAP[k + i].q, r[2], "original id " + k + i));
  }
  assert.equal(new Set(E.QUESTIONS.map((q) => q.id)).size, E.QUESTIONS.length);
  assert.ok(E.QUESTIONS.every((q) => q.s === "lsat" || !q.id.startsWith("lsat")), "core ids never look like LSAT ids");
});
t("practice items are well formed", () => {
  const seen = new Set();
  for (const q of E.QUESTIONS.filter((x) => x.type)) {
    assert.ok([1, 2, 3].includes(q.d) && q.t && q.q && q.e && q.e.length > 30, q.id + " basics");
    assert.ok(!seen.has(q.q), "duplicate prompt " + q.q); seen.add(q.q);
    if (q.type === "typed") {
      assert.ok(Array.isArray(q.a) && q.a.length && q.a.every((x) => typeof x === "string" && x.trim()), q.id + " accepted answers");
      if (q.num !== undefined) { assert.equal(typeof q.num, "number"); assert.equal(E.gradeTyped(q, q.a[0]).correct, true, q.id + " shown answer grades right"); }
      for (const a of q.a) assert.ok(E.gradeTyped(q, a).correct, q.id + " accepts " + a);
    } else if (q.type === "explain") {
      assert.ok(typeof q.a === "string" && q.a.length > 80, q.id + " model answer");
      assert.ok(Array.isArray(q.k) && q.k.length >= 2 && q.k.length <= 4, q.id + " key points");
    } else if (q.type === "order") {
      assert.ok(q.items.length >= 3 && q.items.length <= 6 && new Set(q.items).size === q.items.length, q.id + " items");
      assert.ok(!q.items.some((x) => /\(\d{3,4}\)/.test(x)), q.id + " doesn't give the answer away with dates");
    } else if (q.type === "match") {
      assert.ok(q.pairs.length >= 3 && q.pairs.length <= 5, q.id + " pairs");
      assert.equal(new Set(q.pairs.map((p) => p[0])).size, q.pairs.length, q.id + " unique terms");
      assert.equal(new Set(q.pairs.map((p) => p[1])).size, q.pairs.length, q.id + " unique meanings");
    } else assert.fail(q.id + " unknown type " + q.type);
  }
  for (const [k, p] of Object.entries(EXTRA_PASSAGES)) {
    const n = E.passageIds(k).length;
    assert.ok(n >= 2 && n <= 4, k + " has " + n + " questions");
    assert.ok(p.title && p.area && p.paras.length >= 2, k + " shape");
    assert.equal(E.PASSAGES[k], p);
  }
});
t("typed grading: case, spaces, punctuation, articles, accents, typos on long words only", () => {
  const q = { type: "typed", a: ["Magna Carta", "Magna Charta"] };
  for (const ok of ["magna carta", "  MAGNA   carta ", "The Magna Carta.", "magna charta", "Magna Cartaa", "magna crta"]) assert.ok(E.gradeTyped(q, ok).correct, ok);
  assert.ok(E.gradeTyped(q, "Magna Cartaa").close && !E.gradeTyped(q, "magna carta").close);
  assert.ok(!E.gradeTyped(q, "Bill of Rights").correct);
  const its = { a: ["its"] };
  assert.ok(E.gradeTyped(its, "Its").correct && !E.gradeTyped(its, "it's").correct && !E.gradeTyped(its, "it\u2019s").correct, "its / it's stays strict");
  assert.ok(E.gradeTyped({ a: ["Montréal"] }, "montreal").correct, "accents ignored");
  assert.ok(E.gradeTyped({ a: ["H2O"] }, "H\u2082O").correct, "subscript digits");
  const blank = E.gradeTyped(q, "   ");
  assert.ok(blank.blank && !blank.correct);
});
t("typed grading: numbers with tolerance, fractions, commas, $, %, unicode minus", () => {
  const p = E.QMAP["math-x3"]; // 1/6, tolerance 0.001
  for (const ok of ["1/6", "0.167", ".1667", "1 / 6", "about 1/6"]) assert.ok(E.gradeTyped(p, ok).correct, ok);
  for (const bad of ["0.17", "1/5", "6/36ths?", ""]) if (bad !== "6/36ths?") assert.ok(!E.gradeTyped(p, bad).correct, bad);
  assert.ok(E.gradeTyped(p, "6/36").correct, "equivalent fraction");
  const money = E.QMAP["econ-x1"];
  for (const ok of ["1102.50", "$1,102.50", "1102.5 dollars", "$1102.5"]) assert.ok(E.gradeTyped(money, ok).correct, ok);
  assert.ok(!E.gradeTyped(money, "1100").correct);
  const neg = E.QMAP["econ-x4"];
  for (const ok of ["-2", "\u22122%", "-2 %", "about -2"]) assert.ok(E.gradeTyped(neg, ok).correct, ok);
  assert.ok(!E.gradeTyped(neg, "2").correct, "sign matters");
  assert.ok(E.gradeTyped(E.QMAP["math-x1"], "x = 6").correct && E.gradeTyped(E.QMAP["hist-x0"], "1867").correct && !E.gradeTyped(E.QMAP["hist-x0"], "1876").correct);
  assert.equal(E.parseNumber("no number"), null);
  assert.equal(E.parseNumber("3/0"), null);
});
t("ordering and matching: grading and start positions", () => {
  const o = E.QMAP["sci-x7"];
  assert.deepEqual(E.gradeOrder(o, [0, 1, 2, 3, 4]), { correct: true, right: 5 });
  assert.deepEqual(E.gradeOrder(o, [1, 0, 2, 3, 4]), { correct: false, right: 3 });
  for (let i = 0; i < 50; i++) {
    const start = E.choiceOrder(o);
    assert.deepEqual([...start].sort(), [0, 1, 2, 3, 4]);
    assert.ok(!E.gradeOrder(o, start).correct, "never starts solved");
  }
  const m = E.QMAP["sci-x9"];
  assert.deepEqual(E.gradeMatch(m, [0, 1, 2, 3]), { correct: true, right: 4 });
  assert.deepEqual(E.gradeMatch(m, [1, 0, 2, -1]), { correct: false, right: 1 });
  assert.deepEqual([...E.choiceOrder(m)].sort(), [0, 1, 2, 3]);
  assert.deepEqual(E.choiceOrder(E.QMAP["sci-x0"]), [], "typed has no choices");
});
t("answerText for every format", () => {
  assert.equal(E.answerText(E.QMAP["sci-x0"]), "mitochondria");
  assert.match(E.answerText(E.QMAP["sci-x7"]), /^Cell → Tissue → Organ → Organ system → Organism$/);
  assert.match(E.answerText(E.QMAP["sci-x9"]), /^Proton: Positive particle in the nucleus; /);
  assert.equal(E.answerText(E.QMAP["sci-x5"]), E.QMAP["sci-x5"].a);
  assert.equal(E.answerText(E.QMAP.math0), "56");
});
t("practice formats use the same cards: spaced repetition, levels, merge, backup, live-format progress", () => {
  const now = 1_700_000_000_000;
  let st = E.normalize(JSON.parse(JSON.stringify(LIVE_STORE)));
  st = E.applyAnswer(st, E.QMAP["hist-x0"], true, "sure", now);
  st = E.applyAnswer(st, E.QMAP["geo-x9"], false, "unsure", now);
  st = E.applyAnswer(st, E.QMAP.lsat57, true, "guess", now);
  assert.deepEqual(Object.keys(st).sort(), Object.keys(LIVE_STORE).sort(), "same top-level shape");
  assert.deepEqual(st.cards["hist-x0"], { b: 3, due: now + 3 * E.DAY, n: 1, k: 1, t: now });
  assert.equal(st.cards["geo-x9"].b, 1);
  for (const id of Object.keys(LIVE_STORE.cards)) assert.deepEqual(st.cards[id], LIVE_STORE.cards[id], id + " untouched");
  const json = JSON.parse(JSON.stringify(st));
  assert.deepEqual(E.normalize(json), st, "round-trips through localStorage JSON");
  assert.deepEqual(E.decodeBackup(E.encodeBackup(st)).cards, st.cards, "backup code");
  const other = E.applyAnswer(E.emptyStore(), E.QMAP["hist-x0"], false, "sure", now + 5);
  const m = E.mergeStores(st, other);
  assert.equal(m.cards["hist-x0"].t, now + 5, "merge keeps the newest");
  assert.ok(m.cards["geo-x9"] && m.cards.lsat27);
  assert.equal(E.subjectStats(st, "hist", now).total, 51 + EXTRA.hist.length + E.LESSONS.filter((l) => l.s === "hist").reduce((a, l) => a + l.ids.length, 0));
  assert.deepEqual(E.dueCounts(st, now + 11 * E.MIN), { core: 2, lsat: 3 }, "LSAT drill counted as LSAT once due");
  const w = E.weakestTopic([E.QMAP["eng-x2"], E.QMAP["eng-x5"], E.QMAP["eng-x2"]].reduce((s, q) => E.applyAnswer(s, q, false, "sure", now), E.emptyStore()));
  assert.ok(w && w.s === "eng", "practice answers feed the weakest topic");
});
t("rounds mix in about 3 practice questions per 10 and keep a reading set together (one per round)", () => {
  let prac = 0, rounds = 0;
  for (let r = 0; r < 200; r++) {
    for (const [keys, mode] of [[E.CORE_KEYS, "mixed"], [["geo"], "subject"]]) {
      const ids = E.buildSession(E.emptyStore(), keys, mode);
      rounds++;
      assert.equal(ids.length, 10);
      prac += ids.filter((id) => E.QMAP[id].type).length;
      assert.ok(ids.filter((id) => E.QMAP[id].type).length <= 4, "not crowded out");
      const sets = [...new Set(ids.map((id) => E.QMAP[id].p).filter(Boolean))];
      assert.ok(sets.length <= 1, "one reading set per round");
      for (const k of sets) {
        const pos = ids.map((id, i) => (E.QMAP[id].p === k ? i : -1)).filter((i) => i >= 0);
        assert.equal(pos[pos.length - 1] - pos[0], pos.length - 1, "set questions are adjacent");
        assert.deepEqual(ids.filter((id) => E.QMAP[id].p === k), E.passageIds(k).filter((id) => ids.includes(id)), "authored order");
      }
    }
  }
  const avg = prac / rounds;
  assert.ok(avg >= 2 && avg <= 3.5, "average practice per round " + avg.toFixed(2));
  // types are interleaved: a mixed round usually shows more than one format
  let multi = 0;
  for (let r = 0; r < 100; r++) multi += new Set(E.buildSession(E.emptyStore(), E.CORE_KEYS, "mixed").map((id) => E.typeOf(E.QMAP[id]))).size >= 3 ? 1 : 0;
  assert.ok(multi >= 40, "mixed rounds with 3+ formats: " + multi + "/100");
});
t("due reading questions bring their unseen siblings; seen and not-due ones stay out", () => {
  const now = Date.now();
  const set = E.passageIds("geo-permafrost");
  let st = E.applyAnswer(E.emptyStore(), E.QMAP[set[1]], false, "sure", now - 20 * E.MIN);
  st = E.applyAnswer(st, E.QMAP[set[0]], true, "sure", now);
  const ids = E.buildSession(st, ["geo"], "due", now);
  assert.deepEqual(ids, [set[1]], "due round: only the due card (siblings seen or above level stay out)");
  st = E.applyAnswer(E.emptyStore(), E.QMAP[set[1]], false, "sure", now - 20 * E.MIN);
  const ids2 = E.buildSession(st, ["geo"], "subject", now);
  assert.ok(ids2.includes(set[0]) && ids2.includes(set[1]), "subject round brings the unseen easier sibling");
  assert.ok(!ids2.includes(set[2]), "the hard sibling waits until level 2+");
});
t("LSAT short rounds include drills alongside Logical Reasoning, never passage questions", () => {
  let drills = 0;
  for (let r = 0; r < 50; r++) {
    const ids = E.buildLsatSession(E.emptyStore(), "short");
    assert.equal(ids.length, 10);
    assert.ok(ids.every((id) => !E.QMAP[id].p));
    drills += ids.filter((id) => E.QMAP[id].type).length;
  }
  assert.ok(drills / 50 >= 1.5, "drills per short round " + drills / 50);
});

// ---- richer feedback (js/context/*.js) ----
await E.loadContext(E.SUBJECT_KEYS);
const CTX = {};
for (const s of E.SUBJECT_KEYS) CTX[s] = (await import(`../js/context/${s}.js`)).default;
t("every question (all subjects, LSAT, every format) has a topic, key idea and tip", () => {
  assert.equal(E.QUESTIONS.length, E.TOTAL_QUESTIONS);
  for (const q of E.QUESTIONS) {
    const c = CTX[q.s][q.id];
    assert.ok(c, "no context for " + q.id);
    for (const f of ["tp", "c", "tip"]) assert.ok(typeof c[f] === "string" && c[f].trim().length >= 8, q.id + " " + f);
    assert.match(c.tp, /^[^•]+ • [^•]+$/, q.id + " topic is 'Area • Subtopic'");
    const x = E.contextFor(q);
    assert.ok(x.topic && x.concept && x.tip && !x.why, q.id);
  }
  for (const s in CTX) for (const id in CTX[s]) assert.ok(E.QMAP[id] && E.QMAP[id].s === s, "stray context id " + id);
});
t("every wrong multiple-choice option explains itself (or uses the LSAT trap note)", () => {
  let n = 0;
  for (const q of E.QUESTIONS) {
    const w = CTX[q.s][q.id].w;
    if (E.typeOf(q) !== "mc") { assert.equal(w, undefined, q.id + " has w but isn't multiple choice"); continue; }
    assert.ok(!w || (w.length <= q.c.length && !w[0]), q.id + " w indexes");
    for (let i = 1; i < q.c.length; i++) {
      const why = E.contextFor(q, i).why;
      assert.ok(why && why.length >= 8, q.id + " option " + i);
      n++;
    }
    assert.equal(E.contextFor(q, 0).why, "", q.id + " right answer has no why-wrong");
  }
  assert.ok(n > 1100, "wrong options covered: " + n);
});
t("the dangling-modifier question defines the term", () => {
  const q = E.QUESTIONS.find((x) => /dangling modifier/.test(x.q) && E.typeOf(x) === "mc");
  const c = E.contextFor(q, 1);
  assert.match(c.topic, /Dangling modifiers/);
  assert.match(c.concept, /A dangling modifier (is|has)/);
  assert.match(q.e, /A dangling modifier is/);
});

// ---- Study lessons (js/study.js, js/lessons.js) ----
t("Study: 4 lessons per school subject plus 2 LSAT passages, with stable '<subject>-s<n>' ids", () => {
  assert.equal(E.LESSONS.length, STUDY_LESSONS.length);
  for (const k of E.CORE_KEYS) assert.equal(E.LESSONS.filter((l) => l.s === k).length, 4, k);
  assert.equal(E.LESSONS.filter((l) => l.s === "lsat").length, 2);
  assert.equal(new Set(E.LESSONS.map((l) => l.key)).size, E.LESSONS.length, "unique lesson keys");
  for (const k of E.CORE_KEYS) {
    const ids = E.LESSONS.filter((l) => l.s === k).flatMap((l) => l.ids);
    assert.deepEqual(ids, ids.map((_, i) => k + "-s" + i), k + " ids numbered in lesson order");
  }
  for (const l of E.LESSONS.filter((x) => x.s !== "lsat")) {
    assert.ok(l.ids.length >= 3 && l.ids.length <= 5, l.key + " has " + l.ids.length + " questions");
    for (const id of l.ids) {
      const q = E.QMAP[id];
      assert.ok(q && q.s === l.s && q.p === l.key && q.lesson === l.key && E.typeOf(q) === "mc", id);
    }
    assert.deepEqual(E.passageIds(l.key), l.ids, l.key + " is one reading set");
  }
  const stems = E.QUESTIONS.filter((q) => q.lesson).map((q) => q.q);
  assert.equal(new Set(stems).size, stems.length, "no repeated lesson questions");
  assert.equal(E.TOTAL_QUESTIONS, 306 + EXTRA_N + STUDY_N + LSAT_ITEMS.length);
});
t("Study: every lesson has text (3+ paragraphs, 250+ words) and a glossary of 2+ key terms", () => {
  for (const l of E.LESSONS) {
    const p = l.s === "lsat" ? LSAT_PASSAGES[l.p] : LESSON_TEXT[l.key];
    assert.ok(p, l.key + " text");
    assert.ok(p.paras.length >= 3, l.key + " paragraphs");
    assert.ok(p.paras.join(" ").split(/\s+/).length >= 250, l.key + " length");
    assert.ok(Array.isArray(p.terms) && p.terms.length >= 2, l.key + " key terms");
    for (const [term, def] of p.terms) assert.ok(term && def && def.length > 15, l.key + " term " + term);
  }
  assert.deepEqual(Object.keys(LESSON_TEXT).sort(), SCHOOL_LESSONS.map((l) => l.key).sort(), "text for exactly the school lessons");
});
t("Study: LSAT lessons are LSAT Reading Comprehension sets (lsat65+)", () => {
  for (const l of E.LESSONS.filter((x) => x.s === "lsat")) {
    assert.ok(E.PASSAGE_KEYS.includes(l.p), l.key + " passage registered");
    assert.deepEqual(E.passageIds(l.p), l.ids, l.key + " ids are the passage set");
    assert.ok(l.ids.every((id) => Number(id.slice(4)) >= 65), l.key + " appended after lsat64");
  }
});
t("Study: lesson answers use the same cards (spaced repetition, merge, backup) and show lesson progress", () => {
  const now = 1_700_000_000_000;
  const l = E.LESSON_MAP["study-math-1"];
  let st = E.normalize(JSON.parse(JSON.stringify(LIVE_STORE)));
  assert.deepEqual(E.lessonProgress(st, l.key), { total: 4, answered: 0, known: 0 });
  st = E.applyAnswer(st, E.QMAP[l.ids[0]], true, "sure", now);
  st = E.applyAnswer(st, E.QMAP[l.ids[1]], false, "sure", now);
  assert.deepEqual(E.lessonProgress(st, l.key), { total: 4, answered: 2, known: 1 });
  assert.deepEqual(Object.keys(st).sort(), Object.keys(LIVE_STORE).sort(), "same store shape");
  assert.deepEqual(E.normalize(JSON.parse(JSON.stringify(st))), st, "kept through localStorage JSON");
  assert.deepEqual(E.decodeBackup(E.encodeBackup(st)).cards, st.cards, "backup code");
  assert.ok(E.mergeStores(E.emptyStore(), st).cards[l.ids[0]], "merge");
  assert.equal(E.buildSession(st, ["math"], "due", now + 11 * E.MIN)[0], l.ids[1], "a missed lesson question comes back in Due review");
  const ls = E.LESSON_MAP["study-lsat-1"];
  const s2 = E.applyAnswer(E.emptyStore(), E.QMAP[ls.ids[0]], true, "unsure", now);
  assert.equal(E.lessonProgress(s2, ls.key).answered, 1);
  assert.deepEqual(E.dueCounts(s2, now + 2 * E.DAY), { core: 0, lsat: 1 }, "LSAT lesson counted as LSAT");
});
t("Study: lessons feed the reading sets, so most Mixed rounds include a passage set", () => {
  let withSet = 0, withLesson = 0;
  for (let r = 0; r < 300; r++) {
    const ids = E.buildSession(E.emptyStore(), E.CORE_KEYS, "mixed");
    const sets = [...new Set(ids.map((id) => E.QMAP[id].p).filter(Boolean))];
    if (sets.length) withSet++;
    if (ids.some((id) => E.QMAP[id].lesson)) withLesson++;
  }
  assert.ok(withSet >= 150, "mixed rounds with a reading set: " + withSet + "/300");
  assert.ok(withLesson >= 100, "mixed rounds with a lesson set: " + withLesson + "/300");
  assert.ok(!E.buildSession(E.emptyStore(), E.CORE_KEYS, "mixed").some((id) => E.QMAP[id].s === "lsat"), "LSAT lessons stay out of Mixed review");
});
await (async () => {
  const p = E.PASSAGES["study-sci-1"];
  try {
    assert.equal(p.paras, null, "not loaded at import");
    assert.equal(p.kind, "lesson");
    assert.ok(E.needsLessons(["math0", "sci-s0"]) && !E.needsLessons(["math0", "lsat65"]));
    await E.loadLessons(); await E.loadLessons();
    assert.ok(E.lessonsLoaded());
    assert.deepEqual(p.paras, LESSON_TEXT["study-sci-1"].paras);
    assert.deepEqual(p.terms, LESSON_TEXT["study-sci-1"].terms);
    console.log("ok   Study: lesson text loads on demand, once, into the passages");
  } catch (e) { failures++; console.log("FAIL Study: lesson text loads on demand\n     " + e.message); }
})();
t("share metadata counts every question (og/twitter text and image version)", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const n = String(E.TOTAL_QUESTIONS);
  assert.ok(html.includes('og:description" content="' + n + " "), "og:description");
  assert.ok(html.includes('twitter:description" content="' + n + " "), "twitter:description");
  assert.equal((html.match(/og\.png\?v=(\d+)/g) || []).filter((m) => m.endsWith("=" + n)).length, 2, "og.png?v=" + n);
  assert.ok(html.includes("red " + n + " questions badge"), "image alt text");
});

console.log(failures ? failures + " failed" : "all engine checks passed");
process.exit(failures ? 1 : 0);
