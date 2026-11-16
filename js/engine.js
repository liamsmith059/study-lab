// Pure study logic: storage shape, spaced repetition, adaptive levels, session building, merging.
// No DOM access here, so it can be tested in Node.
import { RAW } from "./questions.js";
import { LSAT_ITEMS, LSAT_PASSAGES } from "./lsat.js";

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
export const PASSAGES = LSAT_PASSAGES;

export const QUESTIONS = [];
for (const s of Object.keys(RAW)) {
  RAW[s].forEach((r, i) => {
    QUESTIONS.push({ id: s + i, s, d: r[0], t: r[1], q: r[2], c: r[3], e: r[4] });
  });
}
// LSAT items: c is correct-first like the core bank; `fixed` is the A-E display order (correct in slot `a`).
LSAT_ITEMS.forEach((r, i) => {
  const fixed = r.c.slice(1);
  fixed.splice(LETTERS.indexOf(r.a), 0, r.c[0]);
  QUESTIONS.push({
    id: "lsat" + i, s: "lsat", d: r.d, t: r.t, q: r.q, c: r.c.slice(), e: r.e,
    fixed, len: r.len, stim: r.stim || "", p: r.p || "", trap: r.c[r.trap], te: r.te,
  });
});
export const QMAP = Object.fromEntries(QUESTIONS.map((q) => [q.id, q]));

// Display order for a question's choices: fixed A-E for LSAT, shuffled for everything else.
export function choiceOrder(q) {
  return q.fixed ? q.fixed.slice() : shuffle(q.c);
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
    if (!QMAP[id] || !c || typeof c.b !== "number") continue;
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
  if (mode === "due") return interleave(due.map((q) => q.id)).slice(0, SIZE);
  const chosen = due.slice(0, 5).map((q) => q.id);
  const fresh = pool.filter((q) => !st.cards[q.id]);
  const scored = fresh
    .map((q) => ({ q, w: WEIGHTS[levelOf(st, q.s)][q.d - 1] * (0.5 + Math.random()) }))
    .filter((x) => x.w > 0)
    .sort((a, b) => b.w - a.w)
    .map((x) => x.q.id);
  const ordered = mode === "mixed" ? interleave(scored) : scored;
  let newIds = ordered.slice(0, SIZE - chosen.length);
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
  return mode === "mixed" ? interleave(ids) : ids;
}

// ---------- LSAT rounds ----------
export const isLR = (q) => q.s === "lsat" && !q.p;
export const PASSAGE_KEYS = Array.from(new Set(QUESTIONS.filter((q) => q.p).map((q) => q.p)));
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
  const qs = QUESTIONS.filter((q) => q.s === s);
  let seen = 0, mastered = 0, due = 0, score = 0;
  for (const q of qs) {
    const c = st.cards[q.id];
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
