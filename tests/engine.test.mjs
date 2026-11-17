// Node unit checks for the question bank and study logic: node tests/engine.test.mjs
import assert from "node:assert/strict";
import { RAW } from "../js/questions.js";
import { LSAT_ITEMS, LSAT_PASSAGES } from "../js/lsat.js";
import * as E from "../js/engine.js";

let failures = 0;
const t = (name, fn) => { try { fn(); console.log("ok   " + name); } catch (e) { failures++; console.log("FAIL " + name + "\n     " + e.message); } };

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
  assert.equal(E.QUESTIONS.length, 306);
  assert.equal(E.TOTAL_QUESTIONS, 356);
});
t("saved progress (live-site format) loads unchanged before the LSAT bank loads", () => {
  const n = E.normalize(JSON.parse(JSON.stringify(LIVE_STORE)));
  assert.deepEqual(n, LIVE_STORE);
  assert.deepEqual(E.decodeBackup(E.encodeBackup(LIVE_STORE)), LIVE_STORE);
  const lsat = E.subjectStats(n, "lsat", 1000);
  assert.equal(lsat.total, 50); assert.equal(lsat.seen, 3); assert.equal(lsat.mastered, 1); assert.equal(lsat.due, 2);
  assert.deepEqual(E.dueCounts(n, 1000), { core: 1, lsat: 2 });
  const other = E.applyAnswer(E.emptyStore(), E.QMAP.geo0, true, "sure", 1700000005000);
  const m = E.mergeStores(n, other);
  for (const id of Object.keys(LIVE_STORE.cards)) assert.deepEqual(m.cards[id], LIVE_STORE.cards[id], id + " kept by merge");
  assert.ok(m.cards.geo0);
  const after = E.applyAnswer(n, E.QMAP.math1, false, "sure", 1700000006000);
  assert.deepEqual(Object.keys(after).sort(), Object.keys(LIVE_STORE).sort(), "same top-level shape");
  assert.deepEqual(after.cards.lsat27, LIVE_STORE.cards.lsat27, "answering a core question leaves LSAT cards alone");
  assert.ok(!E.normalize({ ...LIVE_STORE, cards: { lsat50: { b: 1, due: 1, n: 1, k: 1, t: 1 } } }).cards.lsat50, "unknown ids still dropped");
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
  assert.equal(E.QUESTIONS.length, 356, "no double registration");
  assert.equal(LSAT_ITEMS.length, E.LSAT_META.total);
  assert.equal(LSAT_ITEMS.filter((r) => !r.p).length, E.LSAT_META.lr);
  assert.equal(LSAT_ITEMS.filter((r) => r.p).length, E.LSAT_META.rc);
  assert.equal(Object.keys(LSAT_PASSAGES).length, E.LSAT_META.sets);
  assert.equal(E.TOTAL_QUESTIONS, E.QUESTIONS.length);
});
t("saved progress is identical whether or not the LSAT bank was loaded", () => {
  assert.deepEqual(E.normalize(JSON.parse(JSON.stringify(LIVE_STORE))), LIVE_STORE);
  assert.equal(E.subjectStats(LIVE_STORE, "lsat", 1000).seen, 3);
  assert.deepEqual(E.dueCounts(LIVE_STORE, 1000), { core: 1, lsat: 2 });
});
t("306 core questions, 51 per core subject, plus the LSAT bank", () => {
  assert.equal(E.CORE_KEYS.length, 6);
  for (const k of E.CORE_KEYS) assert.equal(RAW[k].length, 51, k);
  assert.equal(E.QUESTIONS.filter((q) => q.s !== "lsat").length, 306);
  assert.equal(E.QUESTIONS.filter((q) => q.s === "lsat").length, LSAT_ITEMS.length);
  assert.ok(LSAT_ITEMS.length >= 45 && LSAT_ITEMS.length <= 55, "about 45-50 LSAT questions, got " + LSAT_ITEMS.length);
});
t("every question is well formed (4 choices core, 5 choices LSAT)", () => {
  const seenQ = new Set();
  for (const q of E.QUESTIONS) {
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
  for (const q of E.QUESTIONS.filter((x) => x.s === "lsat")) {
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
  const lr = E.QUESTIONS.filter(E.isLR);
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
  const qs = E.QUESTIONS.filter((q) => q.s === "lsat");
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
  const ids = E.buildSession(E.emptyStore(), ["math"], "subject");
  assert.equal(ids.length, 10);
  const ds = ids.map((id) => E.QMAP[id].d);
  assert.ok(!ds.includes(3));
  assert.deepEqual(ds, [...ds].sort());
});
t("mixed review interleaves subjects", () => {
  const ids = E.buildSession(E.emptyStore(), E.CORE_KEYS, "mixed");
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
