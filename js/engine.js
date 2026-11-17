// Pure study logic: storage shape, spaced repetition, adaptive levels, session building, merging.
// No DOM access here, so it can be tested in Node.
import { RAW } from "./questions.js";
import { EXTRA, EXTRA_PASSAGES } from "./practice.js";
// The LSAT bank (js/lsat.js, ~80 KB) is loaded on demand with loadLsat(), so the home page and the
// core subjects don't pay for it. Until it loads, LSAT progress is still kept, counted and merged by id.

export const SUBJECTS = [
  { key: "math", name: "Math", blurb: "Arithmetic, algebra, geometry, probability, functions" },
  { key: "sci", name: "Science", blurb: "Biology, chemistry, physics, Earth and space" },
  { key: "hist", name: "History", blurb: "Canada, the world wars, ancient to modern" },
  { key: "geo", name: "Geography", blurb: "Capitals, physical geography, climate, Canada" },
  { key: "eng", name: "English & Vocabulary", blurb: "Word meanings, grammar, usage, literary devices" },
  { key: "econ", name: "Economics & Finance", blurb: "Markets, macro, investing, TFSA and RRSP" },
  { key: "lsat", name: "LSAT", blurb: "Logical Reasoning arguments and Reading Comprehension passages", special: true },
];
export const SUBJECT_KEYS = SUBJECTS.map((s) => s.key);
// Core school subjects: what "Mixed review" and the Today panel cover. LSAT has its own rounds.
export const CORE_KEYS = SUBJECTS.filter((s) => !s.special).map((s) => s.key);
export const LETTERS = ["A", "B", "C", "D", "E"];
export const PASSAGES = {};
// Size of the LSAT bank, known without loading it (checked against js/lsat.js by the tests).
// IDs are "lsat0".."lsat64"; new items are only ever appended. lr/rc count multiple-choice items,
// x counts the recall / explain / order / match drills.
export const LSAT_META = { total: 65, lr: 29, rc: 26, sets: 5, x: 10 };
// Question formats. "mc" is the original multiple choice; the rest are the practice formats (js/practice.js).
export const TYPES = ["mc", "typed", "explain", "order", "match"];
export const TYPE_LABEL = { mc: "", typed: "Recall", explain: "Explain why", order: "Put in order", match: "Match" };
export const typeOf = (q) => q.type || "mc";
// The fields a practice-format entry carries over from its source.
const practiceFields = (r) => ({ type: r.type, a: r.a, num: r.num, tol: r.tol, k: r.k, items: r.items, pairs: r.pairs });
const LSAT_ID = /^lsat(\d+)$/;

export const QUESTIONS = [];
for (const s of Object.keys(RAW)) {
  RAW[s].forEach((r, i) => {
    QUESTIONS.push({ id: s + i, s, d: r[0], t: r[1], q: r[2], c: r[3], e: r[4] });
  });
}
// Practice formats for the school subjects: ids "<subject>-x<index>", appended after the multiple-choice bank.
for (const s of Object.keys(EXTRA)) {
  EXTRA[s].forEach((r, i) => {
    const q = { id: s + "-x" + i, s, d: r.d, t: r.t, q: r.q, e: r.e, ...practiceFields(r) };
    if (r.type === "mc") { delete q.type; q.c = r.c; q.p = r.p; }
    QUESTIONS.push(q);
  });
}
Object.assign(PASSAGES, EXTRA_PASSAGES);
export const QMAP = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));
export const CORE_COUNT = QUESTIONS.length;
export const TOTAL_QUESTIONS = CORE_COUNT + LSAT_META.total;
export const PASSAGE_KEYS = [];
let lsatState = null;
export const lsatLoaded = () => QUESTIONS.length > CORE_COUNT;

// LSAT items: c is correct-first like the core bank; `fixed` is the A-E display order (correct in slot `a`).
export function registerLsat(items, passages) {
  if (lsatLoaded()) return;
  Object.assign(PASSAGES, passages);
  items.forEach((r, i) => {
    if (r.type) {
      const q = { id: "lsat" + i, s: "lsat", d: r.d, t: r.t, q: r.q, e: r.e, len: "short", ...practiceFields(r) };
      QUESTIONS.push(q);
      QMAP[q.id] = q;
      return;
    }
    const fixed = r.c.slice(1);
    fixed.splice(LETTERS.indexOf(r.a), 0, r.c[0]);
    const q = {
      id: "lsat" + i, s: "lsat", d: r.d, t: r.t, q: r.q, c: r.c.slice(), e: r.e,
      fixed, len: r.len, stim: r.stim || "", p: r.p || "", trap: r.c[r.trap], te: r.te,
    };
    QUESTIONS.push(q);
    QMAP[q.id] = q;
    if (q.p && !PASSAGE_KEYS.includes(q.p)) PASSAGE_KEYS.push(q.p);
  });
}
export function loadLsat() {
  if (!lsatState) {
    lsatState = import("./lsat.js").then((m) => registerLsat(m.LSAT_ITEMS, m.LSAT_PASSAGES))
      .catch((err) => { lsatState = null; throw err; });
  }
  return lsatState;
}

// A saved card id we recognise: a loaded question, or an LSAT id (even before the LSAT bank loads).
export function knownId(id) {
  if (QMAP[id]) return true;
  const m = LSAT_ID.exec(id);
  return !!m && !lsatLoaded() && Number(m[1]) < LSAT_META.total;
}
// Question ids for one subject, without needing the LSAT bank loaded.
export function idsOf(s) {
  if (s === "lsat" && !lsatLoaded()) return Array.from({ length: LSAT_META.total }, (_, i) => "lsat" + i);
  return QUESTIONS.filter((q) => q.s === s).map((q) => q.id);
}

// Display order for a question: fixed A-E choices for LSAT, shuffled choices for other multiple choice,
// a shuffled start (never already solved) for ordering, shuffled meanings (indexes) for matching.
export function choiceOrder(q) {
  const type = typeOf(q);
  if (type === "order") {
    const idx = q.items.map((_, i) => i);
    let o = shuffle(idx);
    for (let n = 0; n < 20 && o.every((v, i) => v === i); n++) o = shuffle(idx);
    return o;
  }
  if (type === "match") return shuffle(q.pairs.map((_, i) => i));
  if (type !== "mc") return [];
  return q.fixed ? q.fixed.slice() : shuffle(q.c);
}

// ---------- grading the practice formats (pure, so the tests can check them) ----------
// Typed answers: ignore case, accents, punctuation, spacing and a leading article; allow a small typo.
export function normAnswer(s) {
  return String(s == null ? "" : s).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'").replace(/[\u2212\u2013\u2014]/g, "-")
    .replace(/[^a-z0-9'./%-]+/g, " ").replace(/[.]+(\s|$)/g, "$1").trim().replace(/^(the|a|an) /, "").replace(/\s+/g, " ");
}
// The last number written in an answer ("x = 6", "$1,102.50", "-2%", "1/6"), or null.
export function parseNumber(s) {
  const t = String(s == null ? "" : s).replace(/[\u2212\u2013\u2014]/g, "-").replace(/(\d),(?=\d{3}\b)/g, "$1").replace(/\$/g, "");
  const all = t.match(/-?\d*\.?\d+(?:\s*\/\s*-?\d*\.?\d+)?/g);
  if (!all) return null;
  const last = all[all.length - 1];
  const [a, b] = last.split("/").map((x) => parseFloat(x));
  if (b === undefined) return a;
  return b === 0 ? null : a / b;
}
export function editDistance(a, b) {
  const m = a.length, n = b.length;
  if (Math.abs(m - n) > 3) return 99;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[n];
}
// Returns { correct, close, blank }: close means accepted with a small spelling slip.
export function gradeTyped(q, input) {
  const raw = String(input == null ? "" : input);
  if (!raw.trim()) return { correct: false, close: false, blank: true };
  if (typeof q.num === "number") {
    const v = parseNumber(raw);
    const tol = typeof q.tol === "number" ? q.tol : 1e-9;
    return { correct: v !== null && Math.abs(v - q.num) <= tol + 1e-12, close: false, blank: false };
  }
  const got = normAnswer(raw);
  const accepted = q.a.map(normAnswer);
  if (accepted.includes(got)) return { correct: true, close: false, blank: false };
  // Small typos count on longer words ("mitocondria"), never on short ones where one letter changes the word (its / it's).
  const near = accepted.some((x) => x.length >= 5 && editDistance(got, x) <= (x.length >= 9 ? 2 : 1));
  return { correct: near, close: near, blank: false };
}
// Ordering: arr lists item indexes in the learner's order. Returns { correct, right: number in the right place }.
export function gradeOrder(q, arr) {
  const right = arr.filter((v, i) => v === i).length;
  return { correct: right === q.items.length && arr.length === q.items.length, right };
}
// Matching: pairs[i] is the index of the meaning given to term i (or -1). Returns { correct, right }.
export function gradeMatch(q, pairs) {
  const right = q.pairs.filter((_, i) => pairs[i] === i).length;
  return { correct: right === q.pairs.length, right };
}
// The answer as one line of text, for feedback and the "Review what you missed" list.
export function answerText(q) {
  const type = typeOf(q);
  if (type === "typed") return q.a[0];
  if (type === "explain") return q.a;
  if (type === "order") return q.items.join(" → ");
  if (type === "match") return q.pairs.map(([a, b]) => a + ": " + b).join("; ");
  return q.c[0];
}

export const MIN = 60000;
export const DAY = 86400000;
// Box 1..6 review intervals: 10 min, 1 day, 3 days, 1 week, 16 days, 35 days.
export const INTERVALS = [0, 10 * MIN, DAY, 3 * DAY, 7 * DAY, 16 * DAY, 35 * DAY];
export const SIZE = 10;
export const STORAGE_KEY = "study-lab-progress-v1";
// Weight of [easy, medium, hard] new questions at each subject level.
const WEIGHTS = { 1: [1, 0.15, 0], 2: [0.35, 1, 0.3], 3: [0.15, 0.5, 1] };
export const DIFF = ["", "Easy", "Medium", "Hard"];

export function emptyStore() {
  return { cards: {}, recent: {}, days: [], total: 0, right: 0, updatedAt: 0 };
}

export function validStore(x) {
  return !!x && typeof x === "object" && typeof x.cards === "object" && x.cards !== null &&
    typeof x.recent === "object" && x.recent !== null && Array.isArray(x.days) && typeof x.total === "number";
}

// Fill in fields added after the canvas version (card.t, updatedAt) and drop unknown question ids.
export function normalize(x) {
  if (!validStore(x)) return emptyStore();
  const cards = {};
  for (const [id, c] of Object.entries(x.cards)) {
    if (!knownId(id) || !c || typeof c.b !== "number") continue;
    cards[id] = { b: c.b, due: c.due || 0, n: c.n || 0, k: c.k || 0, t: c.t || Math.max(0, (c.due || 0) - (INTERVALS[c.b] || 0)) };
  }
  const recent = {};
  for (const k of SUBJECT_KEYS) if (Array.isArray(x.recent[k])) recent[k] = x.recent[k].slice(-30).map((v) => (v ? 1 : 0));
  const st = { cards, recent, days: x.days.filter((d) => typeof d === "string").slice(-400), total: 0, right: 0, updatedAt: x.updatedAt || 0 };
  recount(st);
  // Keep the larger of the stored and counted totals (older stores may not have per-card counts).
  st.total = Math.max(st.total, x.total || 0);
  st.right = Math.max(st.right, Math.min(x.right || 0, st.total));
  return st;
}

function recount(st) {
  let total = 0, right = 0;
  for (const c of Object.values(st.cards)) { total += c.n; right += c.k; }
  st.total = total; st.right = right;
}

// Merge two progress stores without losing either side:
// per question keep the card answered most recently; union study days;
// recent-accuracy windows come from whichever store was updated last.
export function mergeStores(a, b) {
  a = normalize(a); b = normalize(b);
  const cards = { ...a.cards };
  for (const [id, cb] of Object.entries(b.cards)) {
    const ca = cards[id];
    if (!ca || cb.t > ca.t || (cb.t === ca.t && cb.n > ca.n)) cards[id] = cb;
  }
  const newer = b.updatedAt > a.updatedAt ? b : a;
  const older = newer === a ? b : a;
  const recent = { ...older.recent, ...newer.recent };
  const days = Array.from(new Set(a.days.concat(b.days))).sort().slice(-400);
  const st = { cards, recent, days, total: 0, right: 0, updatedAt: Math.max(a.updatedAt, b.updatedAt) };
  recount(st);
  st.total = Math.max(st.total, Math.min(a.total, b.total));
  st.right = Math.max(st.right, Math.min(a.right, b.right, st.total));
  return st;
}

export function dayKey(t) {
  const d = new Date(t);
  const m = d.getMonth() + 1, day = d.getDate();
  return d.getFullYear() + "-" + (m < 10 ? "0" : "") + m + "-" + (day < 10 ? "0" : "") + day;
}

export function streakOf(st, now = Date.now()) {
  const set = new Set(st.days);
  let t = now;
  if (!set.has(dayKey(t))) t -= DAY;
  let n = 0;
  while (set.has(dayKey(t))) { n++; t -= DAY; }
  return n;
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function recentStats(st, s) {
  const rec = (st.recent[s] || []).slice(-20);
  const n = rec.length;
  const sum = rec.reduce((x, y) => x + y, 0);
  return { n, acc: n ? sum / n : 0 };
}

export function levelOf(st, s) {
  const { n, acc } = recentStats(st, s);
  if (n >= 15 && acc >= 0.75) return 3;
  if (n >= 8 && acc >= 0.6) return 2;
  return 1;
}

export function levelHint(st, s) {
  const { n, acc } = recentStats(st, s);
  const pct = Math.round(acc * 100);
  const lv = levelOf(st, s);
  if (lv === 1) return n < 8 ? "Answer " + (8 - n) + " more to unlock medium questions" : "Reach 60% recent accuracy to unlock medium (now " + pct + "%)";
  if (lv === 2) return n < 15 ? (15 - n) + " more answers toward hard questions" : "Reach 75% recent accuracy to unlock hard (now " + pct + "%)";
  return "All levels unlocked, recent accuracy " + pct + "%";
}

export function interleave(ids) {
  const groups = {}, order = [];
  for (const id of ids) {
    const s = QMAP[id].s;
    if (!groups[s]) { groups[s] = []; order.push(s); }
    groups[s].push(id);
  }
  const out = [];
  for (let i = 0, added = true; added; i++) {
    added = false;
    for (const s of order) if (groups[s][i] !== undefined) { out.push(groups[s][i]); added = true; }
  }
  return out;
}

export function dueList(st, keys, now = Date.now(), filter = null) {
  return QUESTIONS.filter((q) => {
    const c = st.cards[q.id];
    return keys.includes(q.s) && (!filter || filter(q)) && !!c && c.due <= now;
  }).sort((a, b) => st.cards[a.id].due - st.cards[b.id].due);
}

// mode: "subject" | "mixed" | "due"
export function buildSession(st, keys, mode, now = Date.now(), filter = null) {
  const pool = QUESTIONS.filter((q) => keys.includes(q.s) && (!filter || filter(q)));
  const due = dueList(st, keys, now, filter);
  if (mode === "due") return interleaveUnits(keepSetsTogether(st, due.slice(0, SIZE).map((q) => q.id), now));
  const chosen = due.slice(0, 5).map((q) => q.id);
  const fresh = pool.filter((q) => !st.cards[q.id]);
  const scored = fresh
    .map((q) => ({ q, w: WEIGHTS[levelOf(st, q.s)][q.d - 1] * (0.5 + Math.random()) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .map((x) => x.q.id);
  // About 3 in 10 new questions come from the practice formats (recall, explain, order, match), when there are any left.
  const need = SIZE - chosen.length;
  // Mixed review spreads both kinds across subjects (interleave takes the best of each subject in turn).
  const spread = (list) => (mode === "mixed" ? interleave(list) : list);
  const prac = spread(scored.filter((id) => QMAP[id].type));
  const np = Math.min(prac.length, Math.ceil(need * PRACTICE_SHARE));
  const keep = new Set(prac.slice(0, np).concat(spread(scored.filter((id) => !QMAP[id].type)).slice(0, need - np)));
  const picked = scored.filter((id) => keep.has(id));
  let newIds = spread(picked).slice(0, need);
  if (mode === "subject") newIds = newIds.sort((a, b) => QMAP[a].d - QMAP[b].d);
  let ids = chosen.concat(newIds);
  if (ids.length < SIZE) {
    const extra = pool
      .filter((q) => !ids.includes(q.id) && !!st.cards[q.id])
      .sort((a, b) => st.cards[a.id].b - st.cards[b.id].b || st.cards[a.id].due - st.cards[b.id].due)
      .map((q) => q.id);
    ids = ids.concat(extra.slice(0, SIZE - ids.length));
  }
  if (ids.length < SIZE) {
    const rest = fresh.filter((q) => !ids.includes(q.id)).sort((a, b) => a.d - b.d).map((q) => q.id);
    ids = ids.concat(rest.slice(0, SIZE - ids.length));
  }
  ids = keepSetsTogether(st, ids, now);
  // A second reading set held back for later can leave the round short: top it up with loose new questions.
  if (ids.length < SIZE) ids = ids.concat(spread(scored.filter((id) => !ids.includes(id) && !QMAP[id].p)).slice(0, SIZE - ids.length));
  return mode === "mixed" ? interleaveUnits(ids) : ids;
}
// Interleave by subject, treating a reading set as one unit so it stays together: at each step take the
// next unit of the subject with the most left that differs from the one just placed.
function interleaveUnits(ids) {
  const units = [], byKey = {};
  for (const id of ids) {
    const p = QMAP[id].p;
    if (p && byKey[p]) { byKey[p].push(id); continue; }
    const u = [id];
    if (p) byKey[p] = u;
    units.push(u);
  }
  const groups = {}, order = [];
  for (const u of units) {
    const s = QMAP[u[0]].s;
    if (!groups[s]) { groups[s] = []; order.push(s); }
    groups[s].push(u);
  }
  const out = [];
  let last = null;
  while (out.length < ids.length) {
    const left = order.filter((s) => groups[s].length);
    const pick = left.filter((s) => s !== last).sort((a, b) => groups[b].length - groups[a].length || order.indexOf(a) - order.indexOf(b))[0] || left[0];
    out.push(...groups[pick].shift());
    last = pick;
  }
  return out;
}
const PRACTICE_SHARE = 0.3;
// A school-subject reading question brings the rest of its passage set along (the unseen or due ones),
// placed together where the first one landed. One set per round; other reading questions wait for a later
// round, and the round is trimmed back to SIZE from the end. LSAT sets are handled by buildLsatSession.
export function keepSetsTogether(st, ids, now = Date.now()) {
  if (!ids.some((id) => QMAP[id].p && QMAP[id].s !== "lsat")) return ids;
  const out = [], seen = new Set();
  let setKey = null;
  for (const id of ids) {
    if (seen.has(id)) continue;
    const q = QMAP[id];
    if (!q.p || q.s === "lsat") { out.push(id); seen.add(id); continue; }
    if (setKey && q.p !== setKey) continue;
    setKey = q.p;
    for (const x of passageIds(q.p)) {
      const c = st.cards[x];
      // Unseen siblings come along only if the subject's level serves their difficulty.
      const fresh = !c && WEIGHTS[levelOf(st, q.s)][QMAP[x].d - 1] > 0;
      if (seen.has(x) || !(x === id || ids.includes(x) || fresh || (c && c.due <= now))) continue;
      out.push(x); seen.add(x);
    }
  }
  // Trim back to SIZE from whichever subject has the most loose questions, so Mixed review stays balanced.
  while (out.length > SIZE) {
    const loose = out.filter((id) => !QMAP[id].p);
    if (!loose.length) break;
    const count = {};
    for (const id of out) count[QMAP[id].s] = (count[QMAP[id].s] || 0) + 1;
    const top = Object.keys(count).filter((s) => loose.some((id) => QMAP[id].s === s)).sort((a, b) => count[b] - count[a])[0];
    const drop = loose.filter((id) => QMAP[id].s === top).pop();
    out.splice(out.lastIndexOf(drop), 1);
  }
  return out;
}

// ---------- LSAT rounds ----------
// LSAT questions without a passage: the Logical Reasoning items plus the recall / explain / order / match drills.
export const isLR = (q) => q.s === "lsat" && !q.p;
export function passageIds(key) {
  return QUESTIONS.filter((q) => q.p === key).map((q) => q.id);
}
// Real-test pace: 35 minutes for ~25 LR questions; 35 minutes for 4 passage sets.
export const PACE = { lr: 85, set: 525 };

// Pick the passage set for a long round: one with due questions first, then an unseen set whose
// average difficulty suits the current level, then the weakest-known set.
export function pickPassage(st, now = Date.now()) {
  const lv = levelOf(st, "lsat");
  const target = [0, 1.6, 2, 2.4][lv];
  const info = PASSAGE_KEYS.map((key, idx) => {
    const qs = QUESTIONS.filter((q) => q.p === key);
    const cards = qs.map((q) => st.cards[q.id]);
    return {
      key, idx,
      due: cards.filter((c) => c && c.due <= now).length,
      unseen: cards.filter((c) => !c).length,
      avgD: qs.reduce((a, q) => a + q.d, 0) / qs.length,
      avgB: cards.reduce((a, c) => a + (c ? c.b : 0), 0) / qs.length,
    };
  });
  const withDue = info.filter((x) => x.due > 0).sort((a, b) => b.due - a.due || a.idx - b.idx);
  if (withDue.length) return withDue[0].key;
  const fresh = info.filter((x) => x.unseen > 0).sort((a, b) => Math.abs(a.avgD - target) - Math.abs(b.avgD - target) || b.unseen - a.unseen || a.idx - b.idx);
  if (fresh.length) return fresh[0].key;
  return info.sort((a, b) => a.avgB - b.avgB || a.idx - b.idx)[0].key;
}

// Keep questions that share a passage together, in authored order, after any LR questions.
export function groupPassages(ids) {
  const lr = ids.filter((id) => !QMAP[id].p);
  const keys = [];
  for (const id of ids) { const p = QMAP[id].p; if (p && !keys.includes(p)) keys.push(p); }
  return lr.concat(...keys.map((k) => passageIds(k).filter((id) => ids.includes(id))));
}

// kind: "short" (about 10 LR) | "long" (one passage set) | "mix" (5 LR + one passage set) | "due"
export function buildLsatSession(st, kind, now = Date.now()) {
  if (kind === "short") return buildSession(st, ["lsat"], "subject", now, isLR);
  if (kind === "long") return passageIds(pickPassage(st, now));
  if (kind === "mix") return buildSession(st, ["lsat"], "subject", now, isLR).slice(0, 5).concat(passageIds(pickPassage(st, now)));
  if (kind === "due") return groupPassages(dueList(st, ["lsat"], now).slice(0, SIZE).map((q) => q.id));
  return [];
}

// conf: "sure" | "unsure" | "guess"
export function applyAnswer(st, q, correct, conf, now = Date.now()) {
  const prev = st.cards[q.id];
  const pb = prev ? prev.b : 0;
  let nb = 1;
  if (correct) {
    if (conf === "guess") nb = Math.max(1, pb);
    else if (pb === 0 && conf === "sure") nb = 3;
    else nb = Math.min(6, Math.max(1, pb) + 1);
  }
  const card = { b: nb, due: now + INTERVALS[nb], n: (prev ? prev.n : 0) + 1, k: (prev ? prev.k : 0) + (correct ? 1 : 0), t: now };
  const rec = (st.recent[q.s] || []).concat([correct ? 1 : 0]).slice(-30);
  const today = dayKey(now);
  return {
    cards: { ...st.cards, [q.id]: card },
    recent: { ...st.recent, [q.s]: rec },
    days: st.days.includes(today) ? st.days : st.days.concat([today]).slice(-400),
    total: st.total + 1,
    right: st.right + (correct ? 1 : 0),
    updatedAt: now,
  };
}

export function subjectStats(st, s, now = Date.now()) {
  const qs = idsOf(s);
  let seen = 0, mastered = 0, due = 0, score = 0;
  for (const id of qs) {
    const c = st.cards[id];
    if (!c) continue;
    seen++;
    if (c.b >= 4) mastered++;
    if (c.due <= now) due++;
    score += Math.min(c.b, 5) / 5;
  }
  return { total: qs.length, seen, mastered, due, mastery: qs.length ? score / qs.length : 0 };
}

export function whenText(ms) {
  if (ms < 60 * MIN) return "in about " + Math.max(1, Math.round(ms / MIN)) + " minutes";
  const days = Math.round(ms / DAY);
  return days <= 1 ? "tomorrow" : "in " + days + " days";
}

// Backup codes are base64 JSON, compatible with codes copied from the original Study Lab Page.
export function encodeBackup(st) {
  const json = JSON.stringify(st);
  return btoa(unescape(encodeURIComponent(json)));
}
export function decodeBackup(code) {
  const json = decodeURIComponent(escape(atob(code.trim())));
  const parsed = JSON.parse(json);
  if (!validStore(parsed)) throw new Error("Not a Study Lab backup");
  return normalize(parsed);
}

// Due counts used everywhere a "Due now" number is shown: core subjects (what Due review and Mixed cover)
// and LSAT separately (it has its own review round). Works before the LSAT bank loads.
export function dueCounts(st, now = Date.now()) {
  let core = 0, lsat = 0;
  for (const [id, c] of Object.entries(st.cards)) {
    if (c.due > now) continue;
    if (id.startsWith("lsat")) lsat++; else core++;
  }
  return { core, lsat };
}

// The core topic with the lowest accuracy over every answer recorded for it (at least `min` answers).
export function weakestTopic(st, min = 3) {
  const by = {};
  for (const [id, c] of Object.entries(st.cards)) {
    const q = QMAP[id];
    if (!q || q.s === "lsat" || !c.n) continue;
    const key = q.s + "|" + q.t;
    const g = by[key] || (by[key] = { s: q.s, t: q.t, n: 0, k: 0 });
    g.n += c.n; g.k += Math.min(c.k, c.n);
  }
  const list = Object.values(by).filter((g) => g.n >= min && g.k < g.n)
    .map((g) => ({ ...g, acc: g.k / g.n }))
    .sort((a, b) => a.acc - b.acc || b.n - a.n);
  return list[0] || null;
}
