import {
  SUBJECTS, CORE_KEYS, QUESTIONS, QMAP, INTERVALS, SIZE, STORAGE_KEY, DIFF, LETTERS, PASSAGES, PACE, LSAT_META, TOTAL_QUESTIONS,
  emptyStore, normalize, streakOf, levelOf, levelHint, buildSession, buildLsatSession, choiceOrder, passageIds,
  applyAnswer, subjectStats, whenText, encodeBackup, decodeBackup, loadLsat, dueCounts, weakestTopic, dayKey,
  typeOf, TYPE_LABEL, gradeTyped, gradeOrder, gradeMatch, answerText, loadContext, contextFor,
  LESSONS, LESSON_MAP, loadLessons, needsLessons, lessonProgress,
} from "./engine.js";
import { createSync, syncConfigured, authInUrl } from "./sync.js";
import { initMenu, tagSections, scrollToSection } from "./menu.js";

let menu = null; // the top bar's Menu (the Sections dropdown), set up once the first view is ready

// ---------- storage ----------
let storageOk = true;
function loadStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? normalize(JSON.parse(raw)) : emptyStore();
  } catch (err) {
    storageOk = false;
    return emptyStore();
  }
}
function saveStore(st) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(st)); storageOk = true; }
  catch (err) { storageOk = false; }
}

const TIMER_KEY = "study-lab-lsat-timer";
function loadTimerPref() { try { return localStorage.getItem(TIMER_KEY) === "1"; } catch (err) { return false; } }
function saveTimerPref(on) { try { localStorage.setItem(TIMER_KEY, on ? "1" : "0"); } catch (err) { /* ignore */ } }

// Small UI preferences live in their own keys; the progress store (STORAGE_KEY) is never reshaped.
const HOWTO_KEY = "study-lab-howto";   // "1" open / "0" closed, once the reader has toggled it
const DAILY_KEY = "study-lab-daily-v1"; // { day, dueStart, mixedDone } for today's goal
// Study lessons marked as studied on this device: { lessonKey: timestamp }. Answers to lesson questions
// live in the progress store like any others (and sync); this only remembers the "Studied" tick.
const STUDIED_KEY = "study-lab-studied-v1";
function loadStudied() {
  try { const v = JSON.parse(localStorage.getItem(STUDIED_KEY) || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (err) { return {}; }
}
function readKey(k) { try { return localStorage.getItem(k); } catch (err) { return null; } }
function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* ignore */ } }
const narrowScreen = () => window.matchMedia("(max-width: 640px)").matches;

// ---------- state ----------
const state = {
  store: loadStore(),
  view: "home", // home | lesson | quiz | summary
  lesson: "", // the open Study lesson (lesson view)
  studied: loadStudied(),
  sess: null,
  conf: "unsure",
  restoreText: "",
  msg: "",
  confirmReset: false,
  email: "",
  sync: { state: syncConfigured() ? "loading" : "off" },
  authMsg: "",
  timerOn: loadTimerPref(),
  passageKey: "",
  passageOpen: false,
  loading: false,
  leaving: false,
  howOpen: readKey(HOWTO_KEY) === null ? null : readKey(HOWTO_KEY) === "1",
};

const sync = createSync({
  getStore: () => state.store,
  setStore: (st) => { state.store = st; saveStore(st); render(); },
  onStatus: (s) => { state.sync = s; render(); },
});

function setStore(st) {
  state.store = st;
  saveStore(st);
  sync.schedulePush();
}

// ---------- helpers ----------
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const subjName = (k) => (SUBJECTS.find((s) => s.key === k) || { name: "" }).name;
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const bar = (frac) => `<div class="bar"><div style="width:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></div></div>`;
const btn = (label, action, opts = {}) =>
  `<button class="btn${opts.primary ? " primary" : ""}${opts.cls ? " " + opts.cls : ""}" data-action="${action}"${opts.arg !== undefined ? ` data-arg="${esc(opts.arg)}"` : ""}${opts.describedby ? ` aria-describedby="${opts.describedby}"` : ""}${opts.disabled ? " disabled" : ""}>${esc(label)}</button>`;
const metric = (value, label, detail) =>
  `<div class="metric"><div class="metric-value">${esc(value)}</div><div class="metric-label">${esc(label)}</div>${detail ? `<div class="metric-detail">${esc(detail)}</div>` : ""}</div>`;

const LSAT_TITLES = { short: "LSAT short round", long: "LSAT long round", mix: "LSAT mixed round", due: "LSAT review" };
const WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
const numberWord = (n) => WORDS[n] || String(n);
const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s);

// ---------- routes ----------
// Each round gets its own hash (#math, #mixed, #due, #lsat/long, ...) so the browser Back button
// returns to the subject list instead of leaving the site.
const LSAT_KINDS = ["short", "long", "mix", "due"];
function routeFor(mode, keys, lesson) {
  if (mode === "study") return "study/" + lesson + "/check";
  if (mode.startsWith("lsat-")) return "lsat/" + mode.slice(5);
  if (mode === "subject" || mode === "topic") return keys[0];
  return mode; // mixed | due
}
function parseRoute(hash) {
  let h = (hash || "").replace(/^#\/?/, "");
  try { h = decodeURIComponent(h); } catch (err) { return null; }
  if (!h) return null;
  if (h === "mixed" || h === "due") return { mode: h, keys: CORE_KEYS };
  if (CORE_KEYS.includes(h)) return { mode: "subject", keys: [h] };
  const sm = /^study\/([\w-]+)(\/check)?$/.exec(h);
  if (sm && LESSON_MAP[sm[1]]) {
    const l = LESSON_MAP[sm[1]];
    return sm[2] ? { mode: "study", keys: [l.s], lesson: l.key } : { view: "lesson", lesson: l.key };
  }
  const m = /^lsat(?:\/(\w+))?$/.exec(h);
  if (m) return { mode: "lsat-" + (LSAT_KINDS.includes(m[1]) ? m[1] : "short"), keys: ["lsat"] };
  return null;
}
const homeUrl = () => location.pathname + location.search;
const roundState = () => !!(history.state && history.state.sl === "round");
// History entries we add above the home page carry their depth (a lesson, then its check round, is 2 deep),
// so leaving for the subject list can step back past all of them at once.
const roundDepth = () => (roundState() ? history.state.d || 1 : 0);
function setRoute(how, hash) {
  try {
    if (how === "push") history.pushState({ sl: "round", d: roundDepth() + 1 }, "", hash);
    else if (how === "replace") history.replaceState({ sl: "round", d: roundDepth() || 1 }, "", hash);
  } catch (err) { /* sandboxed frames may block history; the app still works */ }
}
// A round counts as "in progress" once a question has been answered and there is more to do.
function inProgress() {
  const s = state.sess;
  if (state.view !== "quiz" || !s || !s.results.length) return false;
  return !(s.picked !== null && s.idx + 1 >= s.items.length);
}
const LEAVE_MSG = "Leave this round? Answers so far are saved; the rest of the round is skipped.";

// ---------- actions ----------
// opts.how: "push" (new history entry), "replace" (reuse this entry) or "none" (already on the right entry).
async function start(mode, keys, opts = {}) {
  const lesson = mode === "study" ? LESSON_MAP[opts.lesson] : null;
  if (mode === "study" && !lesson) return;
  const lsat = mode.startsWith("lsat-") || (lesson && lesson.s === "lsat");
  if (lsat) {
    try { await loadLsat(); }
    catch (err) { state.lsatMsg = "Couldn't load the LSAT questions. Check your connection and try again."; render(); return; }
    state.lsatMsg = "";
  }
  const topicFilter = opts.topic ? (q) => q.t === opts.topic : null;
  let ids = lesson ? lesson.ids.slice() : opts.ids ? opts.ids.filter((id) => QMAP[id]) : lsat ? buildLsatSession(state.store, mode.slice(5)) : buildSession(state.store, keys, mode === "topic" ? "subject" : mode, Date.now(), topicFilter);
  // Lesson questions show their lesson beside them, so fetch its text first. Offline, a normal round
  // simply leaves them out; a lesson check can't run without its lesson.
  if (needsLessons(ids)) {
    try { await loadLessons(); }
    catch (err) {
      if (lesson) { state.studyMsg = "Couldn't load the lesson. Check your connection and try again."; render(); return; }
      ids = ids.filter((id) => !QMAP[id].lesson);
    }
  }
  if (!ids.length) return;
  const startLevels = {};
  keys.forEach((k) => { startLevels[k] = levelOf(state.store, k); });
  const title = lesson ? "Study: " + lesson.title : lsat ? LSAT_TITLES[mode.slice(5)] : mode === "topic" ? opts.topic + " practice" : mode === "due" ? "Due for review" : mode === "mixed" ? "Mixed review" : subjName(keys[0]) + " practice";
  // From a lesson, its check round gets its own history entry, so Back returns to the lesson.
  const how = opts.how || (state.view === "home" || state.view === "lesson" ? "push" : "replace");
  const fromLesson = !!lesson && (state.view === "lesson" ? how === "push" : !!(state.sess && state.sess.fromLesson && state.sess.lesson === lesson.key));
  setRoute(how, "#" + routeFor(mode, keys, lesson && lesson.key));
  state.studyMsg = "";
  state.sess = {
    mode, keys, title, topic: opts.topic || "", lesson: lesson ? lesson.key : "", fromLesson, idx: 0, picked: null, results: [], startLevels, retries: 0, total: ids.length,
    items: ids.map((id) => newItem(id, false, state.store.cards[id] ? "Review" : "New")),
  };
  state.conf = "unsure";
  state.view = "quiz";
  state.msg = "";
  beginQuestion();
  render(true, "stem");
  // Richer feedback loads in the background; if an answer is already showing when it arrives, redraw it.
  const sess = state.sess;
  loadContext(ids.map((id) => QMAP[id].s)).then(() => {
    if (state.sess === sess && state.view === "quiz" && sess.picked !== null) render(false, "keep");
  }).catch(() => { /* offline: feedback falls back to the explanation alone */ });
}

// A Study lesson: its text with key terms highlighted, a glossary, and "Check my understanding".
async function openLesson(key, opts = {}) {
  const l = LESSON_MAP[key];
  if (!l) return;
  try { await (l.s === "lsat" ? loadLsat() : loadLessons()); }
  catch (err) { state.studyMsg = "Couldn't load the lesson. Check your connection and try again."; render(); return; }
  state.studyMsg = "";
  setRoute(opts.how || (state.view === "home" ? "push" : "replace"), "#study/" + key);
  state.view = "lesson";
  state.lesson = key;
  state.sess = null;
  render(true, "h1");
}
function setStudied(key, on) {
  if (on) state.studied[key] = Date.now(); else delete state.studied[key];
  writeKey(STUDIED_KEY, JSON.stringify(state.studied));
}
// Done = marked studied here, or every question answered (answers sync, so this shows on every device).
function lessonDone(key) {
  const pr = lessonProgress(state.store, key);
  return !!state.studied[key] || (pr.total > 0 && pr.answered === pr.total);
}

function showHome() {
  state.view = "home";
  sync.flush();
  render(true, "h1");
  // Arrived here from the Menu during a round or summary: continue to the chosen section.
  // Wait a frame: after Back, the browser restores the home page's old scroll position first.
  if (state.pendingSection) { const id = state.pendingSection; state.pendingSection = null; requestAnimationFrame(() => setTimeout(() => scrollToSection(id), 0)); }
}
// Leave a round or summary for the subject list, going back through history when we pushed an entry.
function goHome() {
  const d = roundDepth();
  if (d) { state.leaving = true; history.go(-d); return; }
  try { history.replaceState(null, "", homeUrl()); } catch (err) { /* ignore */ }
  showHome();
}

// Reset the per-question clock and, when the passage changes, the set clock and the passage panel.
function beginQuestion() {
  const sess = state.sess;
  const q = QMAP[sess.items[sess.idx].qid];
  const now = Date.now();
  sess.qStart = now; sess.qEnd = 0;
  state.ctxOpen = false;
  // A new passage starts as a short peek on phones so the question stays in view.
  if (q.p !== state.passageKey) { state.passageKey = q.p; state.passageOpen = false; sess.pStart = now; }
}

// One question in a round. `order` is the display order (choices, ordering items or matching meanings);
// `work` holds an in-progress answer for the practice formats (typed text, matches made so far).
function newItem(qid, retry, kind) {
  const q = QMAP[qid];
  const type = typeOf(q);
  const item = { qid, order: choiceOrder(q), retry, kind };
  if (type === "typed" || type === "explain") item.work = { text: "", shown: false };
  else if (type === "match") item.work = { pairs: q.pairs.map(() => -1), sel: null, msg: "" };
  else if (type === "order") item.work = { msg: "" };
  return item;
}
const current = () => state.sess && state.sess.items[state.sess.idx];

// Multiple choice by index (clicks and the 1-5 / A-E keys). For an explain-why question whose model
// answer is showing, 1 / 2 / 3 grade it instead.
function answer(i) {
  const sess = state.sess;
  if (!sess || sess.picked !== null) return;
  const item = sess.items[sess.idx];
  const q = QMAP[item.qid];
  const type = typeOf(q);
  if (type === "explain") { if (item.work.shown && i < 3) selfGrade(["got", "partly", "missed"][i]); return; }
  if (type !== "mc" || i >= item.order.length) return;
  record(item.order[i] === q.c[0], state.conf, i);
}

// Record an answer of any format: spaced-repetition card, round results, and a second try later in the round if missed.
function record(correct, conf, picked) {
  const sess = state.sess;
  const item = sess.items[sess.idx];
  const q = QMAP[item.qid];
  if (!correct && !item.retry && sess.retries < 3) {
    item.retryItem = newItem(item.qid, true, "Second try");
    sess.items.splice(Math.min(sess.idx + 4, sess.items.length), 0, item.retryItem);
    sess.retries++;
  }
  sess.picked = picked;
  sess.qEnd = Date.now();
  item.conf = conf;
  sess.results.push({ qid: item.qid, correct, retry: item.retry, conf });
  if (!item.retry) { item.before = state.store; setStore(applyAnswer(state.store, q, correct, conf, Date.now())); }
  render(false, "next");
}

function submitTyped() {
  const item = current();
  if (!item || state.sess.picked !== null || typeOf(QMAP[item.qid]) !== "typed") return;
  const el = document.getElementById("typed-input");
  item.work.text = el ? el.value : item.work.text;
  item.work.result = gradeTyped(QMAP[item.qid], item.work.text);
  record(item.work.result.correct, state.conf, -1);
}
// "I was right, count it": the learner overrules the typed-answer grader (synonyms, other wordings).
function overrideTyped() {
  const sess = state.sess, item = current();
  if (!item || !item.work || !item.work.result || item.work.result.correct) return;
  item.work.result = { ...item.work.result, correct: true, overridden: true };
  sess.results[sess.results.length - 1].correct = true;
  if (item.retryItem) {
    const k = sess.items.indexOf(item.retryItem);
    if (k > sess.idx) { sess.items.splice(k, 1); sess.retries--; }
    item.retryItem = null;
  }
  if (!item.retry && item.before) setStore(applyAnswer(item.before, QMAP[item.qid], true, item.conf, Date.now()));
  render(false, "next");
}
function revealExplain() {
  const item = current();
  if (!item || state.sess.picked !== null || typeOf(QMAP[item.qid]) !== "explain") return;
  const el = document.getElementById("explain-input");
  if (el) item.work.text = el.value;
  item.work.shown = true;
  render(false, "grade");
}
// Self-grading an explanation: "Partly" counts as right but at guess strength, so it isn't promoted.
function selfGrade(g) {
  const item = current();
  if (!item || !item.work.shown || state.sess.picked !== null) return;
  item.work.grade = g;
  record(g !== "missed", g === "partly" ? "guess" : "unsure", -1);
}
function moveItem(arg) {
  const item = current();
  if (!item || state.sess.picked !== null) return;
  const q = QMAP[item.qid];
  const [v, dir] = arg.split(":");
  const o = item.order, i = o.indexOf(Number(v)), j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= o.length) return;
  [o[i], o[j]] = [o[j], o[i]];
  item.work.msg = `${q.items[v]}: now ${j + 1} of ${o.length}.`;
  render(false);
  // Keep focus on the item that moved; at the top or bottom its arrow is disabled, so use the other one.
  let b = root.querySelector(`[data-action="move"][data-arg="${v}:${dir}"]`);
  if (!b || b.disabled) b = root.querySelector(`[data-action="move"][data-arg="${v}:${dir === "up" ? "down" : "up"}"]`);
  if (b) b.focus({ preventScroll: true });
}
function checkOrder() {
  const item = current();
  if (!item || state.sess.picked !== null) return;
  item.work.result = gradeOrder(QMAP[item.qid], item.order);
  record(item.work.result.correct, state.conf, -1);
}
// Tap-to-pair matching: choose a term then a meaning (or the other way round). Choosing a new
// meaning for a term replaces its old one; a meaning can only belong to one term.
function pickMatch(arg) {
  const item = current();
  if (!item || state.sess.picked !== null) return;
  const q = QMAP[item.qid], w = item.work;
  const [side, n] = arg.split(":"); const idx = Number(n);
  const pair = (t, m) => {
    for (let k = 0; k < w.pairs.length; k++) if (w.pairs[k] === m) w.pairs[k] = -1;
    w.pairs[t] = m; w.sel = null;
    w.msg = `Matched ${q.pairs[t][0]} with ${q.pairs[m][1]}.`;
  };
  const other = side === "L" ? "R" : "L";
  if (w.sel && w.sel.side === other) { if (side === "L") pair(idx, w.sel.i); else pair(w.sel.i, idx); }
  else if (w.sel && w.sel.side === side && w.sel.i === idx) { w.sel = null; w.msg = "Selection cleared."; }
  else { w.sel = { side, i: idx }; w.msg = side === "L" ? `${q.pairs[idx][0]} selected. Now choose its meaning.` : `Selected: ${q.pairs[idx][1]}. Now choose its term.`; }
  render(false, "keep");
}
function clearMatch() {
  const item = current();
  if (!item || state.sess.picked !== null) return;
  item.work.pairs = item.work.pairs.map(() => -1); item.work.sel = null; item.work.msg = "All matches cleared.";
  render(false);
  const first = root.querySelector('[data-action="pick"]');
  if (first) first.focus({ preventScroll: true });
}
function checkMatch() {
  const item = current();
  if (!item || state.sess.picked !== null) return;
  item.work.result = gradeMatch(QMAP[item.qid], item.work.pairs);
  record(item.work.result.correct, state.conf, -1);
}

function next() {
  const sess = state.sess;
  if (!sess) return;
  if (sess.idx + 1 >= sess.items.length) { finishRound(); return; }
  sess.idx++;
  sess.picked = null;
  state.conf = "unsure";
  beginQuestion();
  render(true, "stem");
}

function finishRound() {
  const sess = state.sess;
  // Answering every question of a lesson's check marks the lesson studied.
  if (sess.mode === "study" && sess.results.filter((r) => !r.retry).length >= sess.total) setStudied(sess.lesson, true);
  if (sess.mode === "mixed" && sess.results.filter((r) => !r.retry).length >= sess.total) {
    const d = dailyState(state.store);
    d.mixedDone = true;
    writeKey(DAILY_KEY, JSON.stringify(d));
  }
  state.view = "summary";
  sync.flush();
  render(true, "h1");
}

const actions = {
  start: (arg) => { const [mode, keys] = arg.split(":"); start(mode, keys === "all" ? CORE_KEYS : keys.split(",")); },
  topic: (arg) => { const [s, t] = arg.split("|"); start("topic", [s], { topic: t }); },
  lesson: (arg) => openLesson(arg),
  check: (arg) => { const l = LESSON_MAP[arg]; if (l) start("study", [l.s], { lesson: l.key }); },
  studied: (arg) => { setStudied(arg, !state.studied[arg]); render(false, "keep"); },
  // Back to the lesson from its check round: step back if we came from it, else open it in place.
  tolesson: (arg) => {
    const s = state.sess;
    if (s && s.fromLesson && s.lesson === arg && roundDepth() >= 2) { history.back(); return; }
    openLesson(arg, { how: "replace" });
  },
  tostudy: () => { state.pendingSection = "study"; goHome(); },
  passage: () => togglePassage(),
  answer: (arg) => answer(Number(arg)),
  submit: () => submitTyped(),
  override: () => overrideTyped(),
  reveal: () => revealExplain(),
  grade: (arg) => selfGrade(arg),
  move: (arg) => moveItem(arg),
  checkorder: () => checkOrder(),
  pick: (arg) => pickMatch(arg),
  clearmatch: () => clearMatch(),
  checkmatch: () => checkMatch(),
  next,
  conf: (arg) => { state.conf = arg; render(); },
  end: () => { if (state.sess && state.sess.results.length) finishRound(); else goHome(); },
  home: () => goHome(),
  again: () => {
    const s = state.sess, due = dueCounts(state.store);
    if (s.mode === "due" && due.core === 0) start("mixed", CORE_KEYS);
    else if (s.mode === "lsat-due" && due.lsat === 0) start("lsat-short", ["lsat"]);
    else start(s.mode, s.keys, { topic: s.topic, lesson: s.lesson });
  },
  timer: () => { state.timerOn = !state.timerOn; saveTimerPref(state.timerOn); render(); },
  restore: () => {
    try {
      setStore(decodeBackup(state.restoreText));
      state.restoreText = "";
      state.msg = "Progress restored.";
    } catch (err) {
      state.msg = "That code didn't work. Copy the whole code and try again.";
    }
    render();
  },
  copy: async () => {
    const code = encodeBackup(state.store);
    try { await navigator.clipboard.writeText(code); state.msg = "Backup code copied."; }
    catch (err) { const ta = document.getElementById("backup-code"); if (ta) { ta.select(); } state.msg = "Select the code and copy it."; }
    render();
  },
  reset: () => {
    if (state.confirmReset) {
      const fresh = { ...emptyStore(), updatedAt: Date.now() };
      state.store = fresh;
      saveStore(fresh);
      sync.replaceRemote(fresh);
      state.confirmReset = false;
      state.msg = sync.user ? "Progress reset here and in your account. Other devices that still have old progress offline may merge it back next time they sync." : "Progress reset.";
    } else state.confirmReset = true;
    render();
  },
  signin: async () => {
    const email = state.email.trim();
    if (!/^\S+@\S+\.\S+$/.test(email)) { state.authMsg = "Enter a valid email address."; render(); return; }
    state.authMsg = "Sending link…"; render();
    try { await sync.signIn(email); state.authMsg = "Check " + email + " for a sign-in link. Open it on this device."; }
    catch (err) { state.authMsg = "Couldn't send the link: " + (err.message || err); }
    render();
  },
  signout: async () => { await sync.signOut(); state.authMsg = "Signed out. Progress stays saved on this device."; render(); },
  syncnow: () => sync.syncNow(),
};

// ---------- views ----------
// When a question comes back, written into the feedback after an answer.
function followText(item, right) {
  if (item.retry) return "";
  const card = state.store.cards[item.qid];
  if (!right) return " You'll see this again later in this round and " + whenText(INTERVALS[1]) + ".";
  return item.conf === "guess"
    ? " It comes back " + whenText(INTERVALS[card ? card.b : 1]) + " to firm it up."
    : " Next review " + whenText(INTERVALS[card ? card.b : 2]) + ".";
}

function quizView() {
  const sess = state.sess;
  const item = sess.items[sess.idx];
  const q = QMAP[item.qid];
  const type = typeOf(q);
  const revealed = sess.picked !== null;
  const last = sess.idx + 1 >= sess.items.length;
  let main = "", feedback = "", tip = "";
  if (type === "mc") ({ main, feedback, tip } = mcBody(q, item, revealed));
  else if (type === "typed") ({ main, feedback, tip } = typedBody(q, item, revealed));
  else if (type === "explain") ({ main, feedback, tip } = explainBody(q, item, revealed));
  else if (type === "order") ({ main, feedback, tip } = orderBody(q, item, revealed));
  else if (type === "match") ({ main, feedback, tip } = matchBody(q, item, revealed));
  if (revealed && feedback) feedback = withContext(q, item, feedback);
  const confs = [["sure", "Sure"], ["unsure", "Think so"], ["guess", "Guessing"]];
  // The counter tracks the round's original questions only; second tries are labelled, not counted.
  const total = sess.total;
  const pos = sess.items.slice(0, sess.idx + 1).filter((it) => !it.retry).length;
  const doneFirst = sess.results.filter((r) => !r.retry).length;
  const count = item.retry
    ? `<span class="count" aria-hidden="true">Second try · ${doneFirst} / ${total} done</span><span class="sr-only">Second try. ${doneFirst} of ${total} done.</span>`
    : `<span class="count" aria-hidden="true">${pos} / ${total}</span><span class="sr-only">Question ${pos} of ${total}</span>`;
  const format = TYPE_LABEL[type] || (q.lesson ? "Study" : q.p && q.s !== "lsat" ? "Reading" : "");
  const kicker = (sess.mode === "study" ? [sess.title, DIFF[q.d], item.kind]
    : [sess.title, sess.keys.length > 1 ? subjName(q.s) : "", q.t, format, DIFF[q.d], item.kind]).filter(Boolean).join(" · ");
  // Explain-why rates itself after the model answer, so it skips the confidence question.
  const askConf = !revealed && type !== "explain";
  const stemCls = q.s === "lsat" || type === "explain" || q.q.length > 110 ? " stem" : "";
  const body = `
  <section class="quiz quiz-${type}">
    <p class="kicker">${esc(kicker)}</p>
    <div class="quiz-progress">${count}${bar(doneFirst / total)}</div>
    ${paceLine(q)}
    ${q.stim ? `<div class="stim">${esc(q.stim)}</div>` : ""}
    <h1 class="question${stemCls}" id="q-stem" tabindex="-1">${esc(q.q)}</h1>
    ${askConf ? `<div class="conf"><p class="muted">How sure are you? Guesses come back sooner even if right.</p>
      <div class="segmented" role="group" aria-label="Confidence">${confs.map(([v, l]) => `<button class="${state.conf === v ? "on" : ""}" data-action="conf" data-arg="${v}" aria-pressed="${state.conf === v}">${l}</button>`).join("")}</div></div>` : ""}
    ${main}
    ${revealed ? feedback : tip ? `<p class="small muted hide-touch">${tip}</p>` : ""}
    <div class="actions start">${revealed ? btn(last ? "See results" : "Next question", "next", { primary: true, describedby: "feedback" }) : ""}${btn("End round", "end")}</div>
  </section>`;
  return q.p ? `<div class="split">${passageBar(q)}${passagePanel(q.p)}<div class="split-main">${body}</div></div>` : body;
}

function mcBody(q, item, revealed) {
  const sess = state.sess;
  const correctIdx = item.order.indexOf(q.c[0]);
  const wasRight = revealed && sess.picked === correctIdx;
  const choices = item.order.map((opt, i) => {
    let cls = "choice", tag = "";
    if (revealed && i === correctIdx) { cls += " correct"; tag = i === sess.picked ? "Your answer, correct" : "Correct answer"; }
    else if (revealed && i === sess.picked) { cls += " wrong"; tag = "Your answer"; }
    else if (revealed) cls += " dim";
    return `<button class="${cls}" data-action="answer" data-arg="${i}"${revealed ? " disabled" : ""}>
      <span class="letter">${LETTERS[i]}</span><span class="opt">${esc(opt)}</span>${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</button>`;
  }).join("");
  const feedback = revealed ? `<div class="callout ${wasRight ? "success" : "danger"}" role="status" id="feedback">
      <strong>${wasRight ? "Correct. The answer is (" + LETTERS[correctIdx] + ")." : "Not quite. The answer is (" + LETTERS[correctIdx] + ")" + (q.fixed ? "." : ": " + esc(q.c[0]) + (/[.?!]$/.test(q.c[0]) ? "" : "."))}</strong> ${esc(q.e)}${esc(followText(item, wasRight))}
      ${wasRight || !pickedWhy(q, item) ? trapLine(q, item, sess.picked) : ""}</div>` : "";
  const n = item.order.length;
  return { main: `<div class="choices">${choices}</div>`, feedback, tip: `Tip: press 1 to ${n} (or A to ${LETTERS[n - 1]}) to answer, then Enter for the next question.` };
}

function typedBody(q, item, revealed) {
  const w = item.work, r = w.result;
  const state2 = revealed ? (r.correct ? " ok" : " bad") : "";
  const main = `<div class="typed">
      <label for="typed-input" class="small muted">Your answer</label>
      <div class="typed-row"><input id="typed-input" class="typed-input${state2}" type="text" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"
        value="${esc(w.text)}" aria-describedby="q-stem"${revealed ? " readonly" : ""}>${revealed ? "" : btn("Check", "submit", { primary: true })}</div>
    </div>`;
  let feedback = "";
  if (revealed) {
    const others = typeof q.num !== "number" && q.a.length > 1 ? ` <span class="small muted">Also accepted: ${esc(q.a.slice(1, 4).join(", "))}.</span>` : "";
    let head;
    if (r.overridden) head = `<strong>Counted as right.</strong> The expected answer was <strong>${esc(q.a[0])}</strong>.`;
    else if (r.correct && r.close) head = `<strong>Correct, allowing for spelling.</strong> It's spelled <strong>${esc(q.a[0])}</strong>.`;
    else if (r.correct) head = `<strong>Correct: ${esc(q.a[0])}.</strong>`;
    else head = `<strong>${r.blank ? "No answer this time." : "Not quite."} The answer is ${esc(q.a[0])}.</strong>${others}`;
    const over = !r.correct && !r.blank
      ? `<div class="row override">${btn("I was right, count it", "override", { cls: "btn-small" })}<span class="small muted">If your answer means the same thing, count it. Be honest; it only helps you.</span></div>` : "";
    feedback = `<div class="callout ${r.correct ? "success" : "danger"}" role="status" id="feedback">${head} ${esc(q.e)}${esc(followText(item, r.correct))}${over}</div>`;
  }
  return { main, feedback, tip: "Tip: start typing from anywhere and press Enter to check. Small typos are fine." };
}

function explainBody(q, item, revealed) {
  const w = item.work;
  if (!w.shown) {
    return {
      main: `<div class="explain">
        <label for="explain-input" class="small muted">Your explanation</label>
        <textarea id="explain-input" class="explain-input" rows="4" aria-describedby="q-stem explain-hint" placeholder="Explain it in your own words">${esc(w.text)}</textarea>
        <p id="explain-hint" class="small muted">Write a sentence or two from memory, then compare it with a model answer. Even a rough attempt helps you remember.</p>
        <div class="actions start">${btn("Show model answer", "reveal", { primary: true })}</div>
      </div>`, feedback: "", tip: "Tip: Ctrl+Enter (⌘+Enter on a Mac) shows the model answer.",
    };
  }
  const grades = [["got", "I had it", "1"], ["partly", "Partly", "2"], ["missed", "Missed it", "3"]];
  const mine = w.text.trim() ? `<div class="mine"><p class="kicker">You wrote</p><p>${esc(w.text)}</p></div>` : `<div class="mine"><p class="kicker">You wrote</p><p class="muted">(nothing this time)</p></div>`;
  const model = `<div class="model" id="model"><p class="kicker">Model answer</p><p>${esc(q.a)}</p>
      <p class="small muted kp-head">Key points to check yours against</p><ul class="keypoints">${q.k.map((k) => `<li>${esc(k)}</li>`).join("")}</ul></div>`;
  const ask = revealed ? "" : `<div class="self-grade"><p id="grade-q"><strong>How did yours compare?</strong> <span class="muted">Partly counts as a guess, so it comes back sooner.</span></p>
      <div class="grade-row" role="group" aria-labelledby="grade-q">${grades.map(([v, l, k]) => `<button class="btn grade-btn" data-action="grade" data-arg="${v}" aria-describedby="model"><span class="key" aria-hidden="true">${k}</span>${l}</button>`).join("")}</div></div>`;
  let feedback = "";
  if (revealed) {
    const g = w.grade;
    const head = g === "got" ? "Nice. Explaining it from memory makes it stick." : g === "partly" ? "Partly: worth another look soon." : "No problem: now you've seen the full explanation.";
    feedback = `<div class="callout ${g === "got" ? "success" : g === "partly" ? "info" : "danger"}" role="status" id="feedback"><strong>${esc(head)}</strong> ${esc(q.e)}${esc(followText(item, g !== "missed"))}</div>`;
  }
  return { main: mine + model + ask, feedback, tip: "Tip: press 1, 2 or 3 to grade yourself." };
}

function orderBody(q, item, revealed) {
  const rows = item.order.map((v, pos) => {
    const txt = q.items[v];
    const ok = v === pos;
    const res = revealed ? `<span class="order-tag">${ok ? "✓ Right place" : "Goes " + ordinal(v + 1)}</span>` : "";
    const moves = revealed ? "" : `<span class="order-moves">
        <button class="move" data-action="move" data-arg="${v}:up" aria-label="Move ${esc(txt)} up"${pos === 0 ? " disabled" : ""}><span aria-hidden="true">↑</span></button>
        <button class="move" data-action="move" data-arg="${v}:down" aria-label="Move ${esc(txt)} down"${pos === item.order.length - 1 ? " disabled" : ""}><span aria-hidden="true">↓</span></button></span>`;
    return `<li class="order-row${revealed ? (ok ? " ok" : " bad") : ""}"><span class="order-pos" aria-hidden="true">${pos + 1}</span><span class="order-text">${esc(txt)}</span>${res}${moves}</li>`;
  }).join("");
  const main = `<p id="order-help" class="small muted order-help">${revealed ? "Your order:" : "Use the arrows to move each item. The top is first."}</p>
    <ol class="order-list" aria-describedby="order-help">${rows}</ol>
    <p class="sr-only" aria-live="polite" id="order-status">${esc(item.work.msg || "")}</p>
    ${revealed ? "" : `<div class="actions start">${btn("Check order", "checkorder", { primary: true })}</div>`}`;
  let feedback = "";
  if (revealed) {
    const r = item.work.result;
    feedback = `<div class="callout ${r.correct ? "success" : "danger"}" role="status" id="feedback">
      <strong>${r.correct ? "Correct order." : `Not quite: ${r.right} of ${q.items.length} in the right place.`}</strong>
      ${r.correct ? "" : `<ol class="answer-list">${q.items.map((t) => `<li>${esc(t)}</li>`).join("")}</ol>`}${esc(q.e)}${esc(followText(item, r.correct))}</div>`;
  }
  return { main, feedback, tip: "" };
}
const ordinal = (n) => n + (n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th");

function matchBody(q, item, revealed) {
  const w = item.work;
  if (revealed) {
    const rows = q.pairs.map(([t, m], i) => {
      const got = w.pairs[i];
      const ok = got === i;
      return `<li class="match-done ${ok ? "ok" : "bad"}"><span class="match-term">${esc(t)}</span><span class="match-mean">${ok ? "✓ " + esc(m) : `<span class="was">${got >= 0 ? esc(q.pairs[got][1]) : "(no match)"}</span><span class="fix">${esc(m)}</span>`}</span></li>`;
    }).join("");
    const r = w.result;
    return {
      main: `<ul class="match-results">${rows}</ul>`, tip: "",
      feedback: `<div class="callout ${r.correct ? "success" : "danger"}" role="status" id="feedback"><strong>${r.correct ? "All matched." : `${r.right} of ${q.pairs.length} matched correctly.`}</strong> ${esc(q.e)}${esc(followText(item, r.correct))}</div>`,
    };
  }
  const termOf = (m) => w.pairs.indexOf(m);
  const terms = q.pairs.map(([t], i) => {
    const sel = w.sel && w.sel.side === "L" && w.sel.i === i;
    const m = w.pairs[i];
    return `<li><button class="match-item${sel ? " sel" : ""}${m >= 0 ? " paired" : ""}" data-action="pick" data-arg="L:${i}" aria-pressed="${sel}"
      aria-label="${esc(t)}${m >= 0 ? ", matched with " + esc(q.pairs[m][1]) : ""}"><span class="badge" aria-hidden="true">${i + 1}</span><span class="mi-text">${esc(t)}</span></button></li>`;
  }).join("");
  const means = item.order.map((m) => {
    const sel = w.sel && w.sel.side === "R" && w.sel.i === m;
    const t = termOf(m);
    return `<li><button class="match-item mean${sel ? " sel" : ""}${t >= 0 ? " paired" : ""}" data-action="pick" data-arg="R:${m}" aria-pressed="${sel}"
      aria-label="${esc(q.pairs[m][1])}${t >= 0 ? ", matched with " + esc(q.pairs[t][0]) : ""}"><span class="badge${t >= 0 ? "" : " empty"}" aria-hidden="true">${t >= 0 ? t + 1 : ""}</span><span class="mi-text">${esc(q.pairs[m][1])}</span></button></li>`;
  }).join("");
  const done = w.pairs.every((m) => m >= 0);
  const main = `<p class="small muted match-help" id="match-help">Choose a term, then the meaning that goes with it. Matched pairs share a number.</p>
    <div class="match" aria-describedby="match-help">
      <div class="match-col"><p class="match-head" id="match-terms">Terms</p><ul class="match-list" aria-labelledby="match-terms">${terms}</ul></div>
      <div class="match-col"><p class="match-head" id="match-means">Meanings</p><ul class="match-list" aria-labelledby="match-means">${means}</ul></div>
    </div>
    <p class="sr-only" aria-live="polite" id="match-status">${esc(w.msg || "")}</p>
    <div class="actions start">${btn(done ? "Check matches" : "Check matches (" + w.pairs.filter((m) => m >= 0).length + " of " + q.pairs.length + ")", "checkmatch", { primary: true, disabled: !done })}${w.pairs.some((m) => m >= 0) ? btn("Clear", "clearmatch") : ""}</div>`;
  return { main, feedback: "", tip: "" };
}

// Phones and narrow windows: a compact bar that sticks to the top while reading a passage set.
function passageBar(q) {
  const p = PASSAGES[q.p];
  const set = passageIds(q.p);
  const open = state.passageOpen;
  return `<div class="lsat-bar">
    <span class="lsat-bar-title">${esc(p.title)}</span>
    <span class="lsat-bar-q">Q ${set.indexOf(q.id) + 1} of ${set.length}</span>
    <button class="btn lsat-bar-btn" data-action="passage" aria-controls="passage" aria-expanded="${open}">${open ? "Hide " + passageWord(p) : "Show " + passageWord(p)}</button>
  </div>`;
}

// On phones the passage is a short peek until opened; on wide screens it is always shown in full beside the questions.
function togglePassage() {
  state.passageOpen = !state.passageOpen;
  render(false, "keep");
  const el = document.getElementById("passage");
  const barEl = document.querySelector(".lsat-bar");
  if (!el || wideScreen()) return;
  const top = el.getBoundingClientRect().top + window.scrollY - (barEl ? barEl.offsetHeight : 0) - 8;
  if (state.passageOpen || window.scrollY > top) window.scrollTo(0, Math.max(0, top));
}

// ---------- richer feedback ----------
// Index in q.c of the option picked for a multiple-choice item (0 is the correct one), else -1.
function pickedIndex(q, item) {
  const sess = state.sess;
  if (typeOf(q) !== "mc" || sess.picked === null || sess.picked < 0) return -1;
  return q.c.indexOf(item.order[sess.picked]);
}
const pickedWhy = (q, item) => { const c = contextFor(q, pickedIndex(q, item)); return c ? c.why : ""; };
function answeredRight(q, item) {
  const type = typeOf(q), w = item.work || {};
  if (type === "mc") return pickedIndex(q, item) === 0;
  if (type === "explain") return w.grade === "got";
  return !!(w.result && w.result.correct);
}
// Topic tag above the verdict; why-wrong, key idea and tip below it. These sit outside the role=status
// callout, so a screen reader announces only the verdict and explanation, and can then read on.
function withContext(q, item, feedback) {
  const ctx = contextFor(q, pickedIndex(q, item));
  if (!ctx) return feedback;
  const right = answeredRight(q, item);
  const sec = (cls, head, text) => text ? `<div class="ctx-sec ${cls}"><h2 class="ctx-h">${head}</h2><p>${esc(text)}</p></div>` : "";
  const why = right ? "" : sec("ctx-why", "Why your answer was wrong", ctx.why);
  const rest = sec("ctx-key", "Key idea", ctx.concept) + sec("ctx-tip", "How to improve", ctx.tip);
  const topic = `<p class="ctx-topic"><span class="sr-only">Topic: </span><span class="ctx-tag">${esc(ctx.topic)}</span></p>`;
  const more = right
    ? (rest ? `<details class="ctx ctx-more" id="ctx"${state.ctxOpen ? " open" : ""}><summary>More context</summary><div class="ctx-body">${rest}</div></details>` : "")
    : `<section class="ctx ctx-open" id="ctx" aria-label="More context">${why}${rest}</section>`;
  return topic + feedback + more;
}

function trapLine(q, item, picked) {
  if (!q.trap) return "";
  const ti = item.order.indexOf(q.trap);
  if (ti < 0) return "";
  return `<p class="trap"><strong>Tempting but wrong: (${LETTERS[ti]})</strong>${picked === ti ? " <span class=\"muted\">(your pick)</span>" : ""} ${esc(q.te)}</p>`;
}

function passagePanel(key) {
  const p = PASSAGES[key];
  let n = 0;
  const paras = (list) => list.map((t) => `<p><span class="pn">${++n}</span>${esc(t)}</p>`).join("");
  const body = p.kind === "comparative"
    ? `<h4>Passage A</h4>${paras(p.a)}<h4>Passage B</h4>${paras(p.b)}`
    : p.kind === "lesson" ? lessonParas(p.paras || [], p.terms || [], true)
    : paras(p.paras);
  const open = state.passageOpen || wideScreen();
  return `<section class="card passage ${open ? "open" : "peek"}" id="passage" aria-labelledby="passage-title">
    <div class="passage-head"><h2 id="passage-title">${esc(p.title)}<span class="small muted"> · ${esc(p.area || "")}${p.kind === "comparative" ? " · comparative" : ""}</span></h2></div>
    <div class="passage-body" data-key="${esc(key)}" tabindex="0" aria-label="${p.kind === "lesson" ? "Lesson" : "Passage"} text">${body}</div>
    <div class="passage-foot">${open
      ? `<button class="btn passage-toggle" data-action="passage" aria-controls="passage" aria-expanded="true">Hide ${passageWord(p)}</button>`
      : `<button class="btn passage-toggle" data-action="passage" aria-controls="passage" aria-expanded="false">Read the full ${passageWord(p)}</button>`}</div>
  </section>`;
}

// In a lesson's check round (and for lesson questions in other rounds) the passage is the lesson.
const passageWord = (p) => (p.kind === "lesson" || (state.sess && state.sess.mode === "study") ? "lesson" : "passage");

// ---------- study lessons ----------
// Key terms are highlighted where they first appear. A term can match a few ways: "Watershed (drainage
// basin)" matches either name, "Ethos, pathos, logos" each word, and a plural "s" is allowed.
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function termMatchers(terms) {
  return terms.map(([t]) => {
    const v = new Set();
    const base = t.replace(/\s*\([^)]*\)/g, "").trim();
    v.add(t); v.add(base);
    const par = /\(([^)]+)\)/.exec(t);
    if (par) v.add(par[1]);
    if (/y$/.test(base)) v.add(base.slice(0, -1) + "ies");
    if (/,|\sand\s|\//.test(base)) base.split(/,\s*|\s+and\s+|\s*\/\s*/).forEach((x) => v.add(x.trim()));
    const alts = [...v].filter((x) => x.length > 1).sort((a, b) => b.length - a.length).map((x) => reEsc(esc(x)));
    return new RegExp("(^|[^\\w-])(" + alts.join("|") + ")((?:e?s)?)(?![\\w])", "i");
  });
}
// Wrap the first not-yet-highlighted match of each term in <mark>, outside tags and existing marks.
function highlightTerms(html, matchers, used) {
  matchers.forEach((re, i) => {
    if (used.has(i)) return;
    const parts = html.split(/(<[^>]+>)/);
    let inMark = false;
    for (let k = 0; k < parts.length; k++) {
      const part = parts[k];
      if (part.startsWith("<")) { if (/^<mark/.test(part)) inMark = true; else if (part === "</mark>") inMark = false; continue; }
      const m = inMark ? null : re.exec(part);
      if (!m) continue;
      parts[k] = part.slice(0, m.index) + m[1] + `<mark class="kt">${m[2]}${m[3]}</mark>` + part.slice(m.index + m[0].length);
      used.add(i);
      html = parts.join("");
      return;
    }
  });
  return html;
}
// Lesson paragraphs: "\n" starts a new line; lines starting "- " become a bulleted list.
function lessonParas(paras, terms, numbered) {
  const ms = termMatchers(terms), used = new Set();
  let n = 0;
  return paras.map((t) => {
    const pn = numbered ? `<span class="pn">${++n}</span>` : "";
    let html = "", lines = [], items = [], first = true;
    const flush = () => {
      if (lines.length) { html += `<p>${first ? pn : ""}${lines.join("<br>")}</p>`; first = false; lines = []; }
      if (items.length) { html += `<ul class="lp-list">${items.map((x) => `<li>${x}</li>`).join("")}</ul>`; items = []; }
    };
    for (const line of t.split("\n")) {
      if (/^- /.test(line)) { if (lines.length) flush(); items.push(esc(line.slice(2))); }
      else { if (items.length) flush(); lines.push(esc(line)); }
    }
    flush();
    if (first && pn) html = pn + html; // a paragraph that is only a list still gets its number
    return highlightTerms(html, ms, used);
  }).join("");
}
const lessonWords = (p) => (p.paras || []).join(" ").split(/\s+/).length;
function lessonView() {
  const l = LESSON_MAP[state.lesson];
  const p = PASSAGES[l.p];
  const pr = lessonProgress(state.store, l.key);
  const studied = !!state.studied[l.key];
  const terms = p.terms || [];
  const mins = Math.max(1, Math.round(lessonWords(p) / 200));
  const status = lessonDone(l.key)
    ? (pr.answered ? `Studied. ${pr.known} of ${pr.total} questions known right now.` : "Studied.")
    : pr.answered ? `${pr.answered} of ${pr.total} questions answered so far.` : "Not started yet.";
  const gloss = terms.length ? `<aside class="card panel glossary" aria-labelledby="gloss-h">
      <h2 id="gloss-h">Key terms</h2>
      <dl>${terms.map(([t, d]) => `<div class="gl"><dt>${esc(t)}</dt><dd>${esc(d)}</dd></div>`).join("")}</dl>
    </aside>` : "";
  return `
  <section class="hero compact lesson-hero">
    <p class="kicker">Study · ${esc(subjName(l.s))} · ${mins} min read</p>
    <h1 tabindex="-1">${esc(l.title)}</h1>
    <p class="lede">${esc(l.topic.charAt(0).toUpperCase() + l.topic.slice(1))}</p>
  </section>
  <div class="lesson-layout">
    <article class="card panel lesson" aria-label="Lesson">
      <div class="lesson-body">${lessonParas(p.paras || [], terms, false)}</div>
    </article>
    ${gloss}
    <section class="card panel lesson-check" aria-labelledby="check-h">
      <h2 id="check-h">Check my understanding</h2>
      <p>${numberWord(l.ids.length)} questions on this lesson, with the lesson beside them${l.s === "lsat" ? " (LSAT style, A to E)" : ""}. Each answer explains what it tests, and the questions come back in your reviews.</p>
      <p class="small muted" id="lesson-status">${esc(status)}</p>
      <div class="actions start">
        ${btn("Check my understanding", "check", { arg: l.key, primary: true })}
        <button class="btn studied-btn" data-action="studied" data-arg="${esc(l.key)}" aria-pressed="${studied}"><span class="tick" aria-hidden="true">${studied ? "✓" : ""}</span>Mark as studied</button>
        ${btn("Back to Study", "tostudy")}
      </div>
      ${state.studyMsg ? `<p class="small" role="alert">${esc(state.studyMsg)}</p>` : ""}
    </section>
  </div>`;
}
function studySection() {
  const doneN = LESSONS.filter((l) => lessonDone(l.key)).length;
  const next = LESSONS.find((l) => !lessonDone(l.key));
  const groups = SUBJECTS.map((s) => ({ s, list: LESSONS.filter((l) => l.s === s.key) })).filter((g) => g.list.length);
  const item = (l) => {
    const pr = lessonProgress(state.store, l.key);
    const done = lessonDone(l.key);
    const meta = done
      ? `<span class="ll-done"><span aria-hidden="true">✓ </span>Studied</span>${pr.answered ? ` · ${pr.known}/${pr.total} known` : ""}`
      : pr.answered ? `${pr.answered}/${pr.total} answered` : `${pr.total} questions`;
    return `<li><button class="lesson-link${done ? " done" : ""}" data-action="lesson" data-arg="${esc(l.key)}"><span class="ll-title">${esc(l.title)}</span><span class="ll-meta">${meta}</span></button></li>`;
  };
  return `<section class="study" id="study" data-menu-flat>
    <h2>Study</h2>
    <p class="lead">Read a short lesson on one idea, with key terms explained, then check your understanding. ${doneN ? `${doneN} of ${LESSONS.length} studied.` : `${LESSONS.length} lessons.`}</p>
    ${next ? `<div class="actions start">${btn((doneN ? "Next lesson: " : "Start with: ") + next.title, "lesson", { arg: next.key })}</div>` : ""}
    ${state.view === "home" && state.studyMsg ? `<p class="small" role="alert">${esc(state.studyMsg)}</p>` : ""}
    <div class="study-grid">${groups.map((g) => `<article class="card study-group" data-s="${g.s.key}"><h3>${esc(g.s.name)}</h3><ul class="lesson-list">${g.list.map(item).join("")}</ul></article>`).join("")}</div>
  </section>`;
}

const wideScreen = () => window.matchMedia("(min-width: 1000px)").matches;
const clock = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

function paceText() {
  const sess = state.sess;
  const q = QMAP[sess.items[sess.idx].qid];
  const now = Date.now();
  const qMs = (sess.qEnd || now) - sess.qStart;
  if (q.p) {
    const setMs = now - sess.pStart;
    return { text: "This question " + clock(qMs) + " · Passage set " + clock(setMs) + " / " + clock(PACE.set * 1000), over: setMs > PACE.set * 1000 };
  }
  return { text: "This question " + clock(qMs) + " / " + clock(PACE.lr * 1000), over: qMs > PACE.lr * 1000 };
}
function paceLine(q) {
  if (q.s !== "lsat" || !state.timerOn) return "";
  const p = paceText();
  // Visual only: ticks every second, so screen readers are kept out of it.
  return `<div class="pace${p.over ? " over" : ""}" id="pace" aria-live="off" aria-hidden="true">⏱ ${esc(p.text)}</div>`;
}
setInterval(() => {
  if (state.view !== "quiz" || !state.sess || !state.timerOn) return;
  const el = document.getElementById("pace");
  if (!el) return;
  const p = paceText();
  el.textContent = "⏱ " + p.text;
  el.classList.toggle("over", p.over);
}, 1000);

function summaryView() {
  const sess = state.sess, st = state.store;
  const firsts = sess.results.filter((r) => !r.retry);
  const right = firsts.filter((r) => r.correct).length;
  const missed = firsts.filter((r) => !r.correct);
  const fixed = sess.results.filter((r) => r.retry && r.correct).length;
  const ups = sess.keys.filter((k) => levelOf(st, k) > (sess.startLevels[k] || 1));
  const downs = sess.keys.filter((k) => levelOf(st, k) < (sess.startLevels[k] || 1));
  const due = dueCounts(st);
  const lsatRound = sess.mode.startsWith("lsat-");
  let note = "";
  if (ups.length) note = `<div class="callout success"><strong>Level up.</strong> ${esc(ups.map((k) => subjName(k) + " is now Level " + levelOf(st, k)).join("; "))}. Harder questions will show up more often.</div>`;
  else if (sess.mode === "study" && state.studied[sess.lesson]) note = `<div class="callout success"><strong>Lesson studied.</strong> ${esc(LESSON_MAP[sess.lesson].title)} is ticked off in Study, and its questions come back in your reviews.</div>`;
  else if (downs.length) note = `<div class="callout info"><strong>Easing off.</strong> ${esc(downs.map(subjName).join(" and "))} dropped a level, so you'll get more foundation questions until accuracy recovers.</div>`;
  const missedList = missed.map((r) => {
    const q = QMAP[r.qid];
    const ans = q.fixed ? `(${LETTERS[q.fixed.indexOf(q.c[0])]}) ${esc(q.c[0])}` : esc(answerText(q)) + (/[.?!]$/.test(answerText(q)) ? "" : ".");
    const ctx = q.fixed ? `<div class="small muted">${esc(q.stim ? trunc(q.stim, 160) : "Passage: " + PASSAGES[q.p].title)}</div>` : q.p ? `<div class="small muted">${esc("Passage: " + PASSAGES[q.p].title)}</div>` : "";
    const more = contextFor(q);
    return `<li>${ctx}<div class="mq">${esc(q.q)}</div><div class="small"><strong>Answer: ${ans}</strong> ${esc(q.e)}</div><div class="small muted">${esc([subjName(q.s), more ? more.topic : q.t, TYPE_LABEL[typeOf(q)]].filter(Boolean).join(" · "))}</div></li>`;
  }).join("");
  // Misses grouped by topic, each with a study tip, most-missed first.
  const groups = new Map();
  missed.forEach((r) => {
    const c = contextFor(QMAP[r.qid]);
    if (!c) return;
    const g = groups.get(c.topic) || { topic: c.topic, n: 0, tip: c.tip };
    g.n++;
    groups.set(c.topic, g);
  });
  const topicList = [...groups.values()].sort((a, b) => b.n - a.n).slice(0, 6).map((g) =>
    `<li><p class="tw-head"><span class="ctx-tag">${esc(g.topic)}</span><span class="small muted">${g.n} missed</span></p><p class="small">${esc(g.tip)}</p></li>`).join("");
  return `
  <section class="hero compact"><h1 tabindex="-1">Round complete</h1><p class="lede">${esc(sess.title)}: here is how you did and what comes back next.</p></section>
  <article class="card panel results">
    <p class="kicker">Results</p>
    <h2>${right} of ${firsts.length} right on the first try.</h2>
    <p class="lead">${fixed ? "You fixed " + fixed + " on the second try. " : ""}${missed.length ? "What you missed comes back later today." : "Clean round. These move to longer review intervals."}</p>
    <div class="metrics">
      ${metric(right + "/" + firsts.length, "First-try score", pctOf(right, firsts.length) + "%")}
      ${metric(streakOf(st), "Day streak")}
      ${dueMetric(due)}
      ${metric(pctOf(st.right, st.total) + "%", "All-time accuracy", st.total + " answered")}
    </div>
    ${note}
    <div class="actions start">${sess.mode === "study"
      ? btn("Back to the lesson", "tolesson", { arg: sess.lesson, primary: true }) + btn("Try these again", "again") + btn("Back to Study", "tostudy")
      : btn(lsatRound ? "Another LSAT round" : "Another round", "again", { primary: true }) + btn("Back to subjects", "home")}</div>
  </article>
  ${topicList ? `<section class="card panel topics-work"><h2>Topics to work on</h2><ul class="tw-list">${topicList}</ul></section>` : ""}
  ${missed.length ? `<section class="card panel"><h2>Review what you missed</h2><ul class="missed">${missedList}</ul></section>` : ""}`;
}

// "Due now" means the same thing on the home page and the round summary: the six school subjects
// (what Due review covers), with LSAT's own due count shown alongside.
function dueMetric(due) {
  return metric(due.core, "Due now", due.lsat ? "+ " + due.lsat + " LSAT" : "school subjects");
}

// Today's goal: clear what was due at the start of the day, or finish one full Mixed review.
function dailyState(st, now = Date.now()) {
  const today = dayKey(now);
  let d = null;
  try { d = JSON.parse(readKey(DAILY_KEY) || "null"); } catch (err) { d = null; }
  if (!d || d.day !== today) d = { day: today, dueStart: 0, mixedDone: false };
  d.dueStart = Math.max(d.dueStart || 0, dueCounts(st, now).core);
  return d;
}
function dailyGoal(st, now) {
  const d = dailyState(st, now);
  writeKey(DAILY_KEY, JSON.stringify(d));
  const left = dueCounts(st, now).core;
  const cleared = d.dueStart > 0 && left === 0;
  const met = d.mixedDone || cleared;
  const frac = met ? 1 : d.dueStart ? (d.dueStart - left) / d.dueStart : 0;
  let text;
  if (met) text = d.mixedDone ? "Daily goal met: you finished a Mixed review today." : "Daily goal met: today's reviews are cleared.";
  else if (d.dueStart) text = "Daily goal: clear today's " + d.dueStart + " due reviews (" + left + " left), or finish one Mixed review.";
  else text = "Daily goal: finish one Mixed review.";
  return `<div class="goal${met ? " met" : ""}"><div class="goal-text">${met ? "✓ " : ""}${esc(text)}</div>${bar(frac)}</div>`;
}

function syncSection() {
  if (!syncConfigured()) return "";
  const s = state.sync;
  const user = s.user;
  let line = "";
  if (s.state === "loading") line = "Connecting…";
  else if (s.state === "syncing") line = "Syncing…";
  else if (s.state === "synced") line = "Synced at " + new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) + ".";
  else if (s.state === "error") line = s.message;
  const body = user
    ? `<p>Signed in as <strong>${esc(user.email || "")}</strong>. Your progress syncs across devices.</p>
       ${line ? `<p class="small muted">${esc(line)}</p>` : ""}
       <div class="row">${btn("Sync now", "syncnow")}${btn("Sign out", "signout")}</div>`
    : `<p>Sign in with your email to keep progress in sync across your phone and laptop. No password: we email you a link.</p>
       ${s.state === "error" ? `<p class="small muted">${esc(line)}</p>` : ""}
       <div class="row"><label class="sr-only" for="email">Email</label><input id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(state.email)}">${btn("Email me a link", "signin", { primary: true })}</div>`;
  return `<section class="card panel" id="sync"><h2>Sync across devices</h2>${body}${state.authMsg ? `<p class="small muted">${esc(state.authMsg)}</p>` : ""}</section>`;
}

function homeView() {
  const st = state.store, now = Date.now();
  const due = dueCounts(st, now);
  const dueAll = due.core, lsatDue = due.lsat;
  const masteredAll = Object.values(st.cards).filter((c) => c.b >= 4).length;
  const seenAll = Object.keys(st.cards).length;
  const weak = weakestTopic(st);
  const headline = st.total === 0 ? "Start with any subject."
    : dueAll > 0 ? numberWord(dueAll) + (dueAll === 1 ? " question is due." : " questions are due.")
    : "Nothing is due right now.";
  const lead = (st.total === 0
    ? "Each round is 10 questions, and what you miss comes back sooner."
    : dueAll > 0 ? "Clear those first, then take a new round to keep your streak going."
    : "Take a new round or a mixed review to keep your streak going.") + (lsatDue ? " LSAT has " + lsatDue + " due as well." : "");
  const saveNote = storageOk
    ? (sync.user ? "Progress saves on this device and syncs to your account." : "Progress saves automatically on this device.")
    : "This browser is blocking storage (private mode?), so progress won't be kept. Use the backup code below.";
  const cards = SUBJECTS.filter((s) => !s.special).map((s) => {
    const ss = subjectStats(st, s.key, now);
    return `<article class="card tile subject" data-s="${s.key}">
      <div class="tile-top"><h3><button class="tile-link" data-action="start" data-arg="subject:${s.key}" aria-label="Study ${esc(s.name)}">${esc(s.name)}</button></h3>${ss.due ? `<span class="due">${ss.due} due</span>` : ""}</div>
      <p>${esc(s.blurb)}.</p>
      ${ss.seen ? bar(ss.mastery) : ""}
      <span class="meta">Level ${levelOf(st, s.key)} of 3 · ${ss.seen}/${ss.total} seen · ${ss.mastered} mastered</span>
      ${ss.seen ? `<span class="meta hint">${esc(levelHint(st, s.key))}</span>` : ""}
    </article>`;
  }).join("");
  const bars = SUBJECTS.map((s) => ({ s, ss: subjectStats(st, s.key, now) }))
    .filter(({ ss }) => ss.seen > 0)
    .sort((a, b) => b.ss.mastery - a.ss.mastery)
    .map(({ s, ss }) => `<div class="hbar"><div class="hlabel">${esc(s.name)}</div><div class="htrack"><div style="width:${Math.round(ss.mastery * 100)}%"></div></div><div class="hval">${Math.round(ss.mastery * 100)}%<span class="muted"> · ${ss.mastered} mastered</span></div></div>`).join("");
  const steps = [
    ["Retrieval practice", "Every question makes you recall the answer before you see it, which strengthens memory far more than rereading."],
    ["Spaced repetition", "Each question sits in one of six boxes. A miss sends it back to box 1 (review in 10 minutes); each correct answer moves it up: 1 day, 3 days, 1 week, 16 days, 35 days."],
    ["Confidence check", "Mark Sure, Think so, or Guessing before answering. A lucky guess doesn't move a question up, and a sure first answer skips ahead."],
    ["Adaptive difficulty", "Each subject starts at Level 1 with mostly easy questions. Medium unlocks at 60% accuracy over 8+ recent answers, hard at 75% over 15+, and the level drops back if accuracy falls."],
    ["Interleaving", "Mixed review and Due review alternate subjects, which feels harder but builds more durable, flexible knowledge."],
    ["LSAT section", "Answers stay in fixed A–E order like the real test, passages stay beside the questions on wide screens, every question names its most tempting wrong answer, and an optional timer shows real-test pace. LSAT stays out of Mixed review."],
    ["Second tries", "A missed question returns a few questions later in the same round so you fix it while the explanation is fresh."],
    ["Question formats", "About three in ten new questions use a format other than multiple choice: Recall (type the answer, with small typos allowed and an \"I was right\" override), Explain why (write it in your own words, then grade yourself against a model answer), Put in order, Match, and short Reading passages in every subject. Producing and explaining an answer builds stronger memory than recognising it."],
    ["Study lessons", "Short readings in every subject, plus two LSAT passages, explain one idea at a time, with key terms highlighted and a glossary. Check my understanding asks a few questions with the lesson beside them, and they join your reviews. Lessons also turn up as reading sets in Mixed review."],
  ];
  // First visit: open on wide screens, folded to a one-line teaser on phones. After that, the reader's choice sticks.
  const howOpen = state.howOpen === null ? st.total === 0 && !narrowScreen() : state.howOpen;
  return `
  <section class="hero">
    <h1 tabindex="-1">Study Lab</h1>
    <p class="lede"><span class="tagline-long">Six school subjects plus LSAT prep, ${TOTAL_QUESTIONS} questions and ${LESSONS.length} short lessons, with spaced repetition and difficulty that climbs as you improve.</span><span class="tagline-short">${TOTAL_QUESTIONS} questions that get harder as you do.</span></p>
    <div class="actions">
      ${dueAll ? btn("Review due (" + Math.min(dueAll, SIZE) + ")", "start", { arg: "due:all", primary: true }) : ""}
      ${btn("Mixed review", "start", { arg: "mixed:all", primary: !dueAll })}
    </div>
  </section>
  <article class="card panel today" id="today">
    <p class="kicker">Today</p>
    <h2>${esc(headline)}</h2>
    <p class="lead">${esc(lead)}</p>
    <div class="metrics">
      ${metric(streakOf(st, now), "Day streak")}
      ${dueMetric(due)}
      ${metric(pctOf(st.right, st.total) + "%", "Accuracy", st.total + " answered")}
      ${metric(masteredAll + "/" + TOTAL_QUESTIONS, "Mastered", seenAll + " seen")}
    </div>
    ${weak ? `<p class="weak">Weakest topic: <strong>${esc(weak.t)}</strong> (${esc(subjName(weak.s))}), ${pctOf(weak.k, weak.n)}% right over ${weak.n} answers. ${btn("Practice " + weak.t, "topic", { arg: weak.s + "|" + weak.t, cls: "btn-small" })}</p>` : ""}
    ${dailyGoal(st, now)}
    <p class="note">${esc(saveNote)}</p>
  </article>
  <section class="subjects" id="subjects">
    <h2>Subjects</h2>
    <div class="grid">${cards}</div>
  </section>
  ${studySection()}
  ${lsatCard(st, now)}
  ${seenAll ? `<section class="card panel"><h2>Mastery by subject</h2><p class="small muted">Mastery grows as questions move to longer review intervals; mastered means a week or more.</p>${bars}</section>` : ""}
  ${syncSection()}
  <details class="card panel howto" id="howto"${howOpen ? " open" : ""}><summary><h2>How it works</h2><span class="teaser small">Recall, spacing and rising difficulty, in a one-minute read.</span></summary>
    <ol class="steps">${steps.map(([t, d]) => `<li><h3 class="step">${esc(t)}</h3><div class="small muted">${esc(d)}</div></li>`).join("")}</ol>
  </details>
  <details class="card panel" id="backup"><summary><h2>Backup and reset</h2></summary>
    <p>Copy this code to move progress to another browser, or paste a code here (codes from the original Study Lab Page work too).</p>
    <label class="small muted" for="backup-code">Your backup code</label>
    <textarea id="backup-code" readonly rows="3">${esc(encodeBackup(st))}</textarea>
    <div class="row">${btn("Copy code", "copy")}</div>
    <label class="small muted" for="restore">Restore from a backup code</label>
    <textarea id="restore" rows="2" placeholder="Paste a backup code">${esc(state.restoreText)}</textarea>
    <div class="row">${btn("Restore", "restore")}${btn(state.confirmReset ? "Tap again to erase all progress" : "Reset progress", "reset")}</div>
    ${state.msg ? `<p class="small muted">${esc(state.msg)}</p>` : ""}
  </details>
  <footer class="foot">Study Lab · progress is stored in your browser${syncConfigured() ? " and, if you sign in, your account" : ""}.</footer>`;
}

function lsatCard(st, now) {
  const ss = subjectStats(st, "lsat", now);
  const { lr, rc, sets, x } = LSAT_META;
  return `<article class="card panel lsat-card" aria-labelledby="lsat-title">
    <p class="kicker">LSAT prep · Level ${levelOf(st, "lsat")} of 3 · ${ss.seen}/${ss.total} seen · ${ss.mastered} mastered${ss.due ? ` · <span class="due">${ss.due} due</span>` : ""}</p>
    <h2 id="lsat-title">Original practice in the style of the current test.</h2>
    <p class="lead">${lr} Logical Reasoning arguments and ${sets} Reading Comprehension passage sets (${rc} questions) across law, science, humanities and social science, five choices, A to E. Short rounds also mix in ${x} skill drills: conditional logic you type out, flaws you explain, chains you order and terms you match.</p>
    ${ss.seen ? bar(ss.mastery) : ""}
    ${ss.seen ? `<p class="small muted lsat-hint">${esc(levelHint(st, "lsat"))}</p>` : ""}
    <div class="actions start">
      ${ss.due ? btn("Review due (" + Math.min(ss.due, SIZE) + ")", "start", { arg: "lsat-due:lsat", primary: true }) : ""}
      ${btn("Short round · 10", "start", { arg: "lsat-short:lsat", primary: !ss.due })}
      ${btn("Long round · passage", "start", { arg: "lsat-long:lsat" })}
      ${btn("Mixed · 5 + passage", "start", { arg: "lsat-mix:lsat" })}
    </div>
    ${state.lsatMsg ? `<p class="small" role="alert">${esc(state.lsatMsg)}</p>` : ""}
    <div class="actions start timer-row">${btn("Pace timer: " + (state.timerOn ? "On" : "Off"), "timer", { cls: "btn-small" })}<span class="note">Real-test pace is about 1:25 per argument and 8:45 per passage set. The timer only counts; it never ends a question.</span></div>
  </article>`;
}

// ---------- render ----------
const root = document.getElementById("app");
// focus: "stem" (new question), "next" (after answering), "h1" (new page), "keep" or undefined
// (put focus back on the equivalent control, since the whole view is re-rendered).
function render(scrollTop = false, focus) {
  const openBackup = document.getElementById("backup");
  const backupWasOpen = openBackup && openBackup.open;
  const oldBody = document.querySelector(".passage-body");
  const keepScroll = oldBody ? { key: oldBody.dataset.key, top: oldBody.scrollTop } : null;
  const active = document.activeElement;
  const had = active && root.contains(active) && active !== root
    ? { id: active.id, action: active.dataset && active.dataset.action, arg: active.dataset && active.dataset.arg, cls: active.classList.contains("passage-toggle") }
    : null;
  const inPassage = state.view === "quiz" && state.sess && !!QMAP[state.sess.items[state.sess.idx].qid].p;
  root.className = "wrap" + (inPassage ? " wide" : "");
  if (state.view === "quiz" && state.sess) root.innerHTML = quizView();
  else if (state.view === "lesson" && LESSON_MAP[state.lesson]) root.innerHTML = lessonView();
  else if (state.view === "summary" && state.sess) root.innerHTML = summaryView();
  else { state.view = "home"; root.innerHTML = homeView(); }
  const nb = document.getElementById("backup");
  if (nb && backupWasOpen) nb.open = true;
  const newBody = document.querySelector(".passage-body");
  if (newBody && keepScroll && keepScroll.key === newBody.dataset.key) newBody.scrollTop = keepScroll.top;
  if (scrollTop) window.scrollTo(0, 0);
  if (state.view === "home") tagSections(root);
  updateNav();
  placeFocus(focus, had);
  if (menu) menu.refresh();
}

// The top bar lives outside #app. Its only extra control is "End round", shown during a round (Subjects and
// the other home sections are in the Menu). Also keeps the tab title in step: "Math practice — Study Lab".
const navSlot = document.getElementById("nav-slot");
const BASE_TITLE = document.title || "Study Lab";
function updateNav() {
  if (navSlot) {
    const inRound = state.view === "quiz";
    navSlot.hidden = !inRound;
    navSlot.dataset.nav = "end";
    navSlot.textContent = "End round";
  }
  const s = state.sess;
  const roundTitle = state.view === "lesson" && LESSON_MAP[state.lesson] ? LESSON_MAP[state.lesson].title
    : (state.view === "quiz" || state.view === "summary") && s ? (s.mode.startsWith("lsat-") ? "LSAT practice" : s.title) : "";
  const want = roundTitle ? roundTitle + " — " + BASE_TITLE : BASE_TITLE;
  if (document.title !== want) document.title = want;
}
// Menu dropdown (js/menu.js; `menu` is declared near the top). It always lists the home page's sections: on the home page it reads the
// live page; during a round or summary it reads a freshly built copy of the home page, and choosing an
// entry goes home first (asking before leaving a round in progress), then scrolls to that section.
function homeOutline() {
  if (state.view === "home") return { el: root, live: true };
  const t = document.createElement("div");
  t.innerHTML = homeView();
  return { el: t, live: false };
}
function goToSection(id) {
  if (state.view === "home") return scrollToSection(id);
  if (inProgress() && !window.confirm(LEAVE_MSG)) return false;
  state.pendingSection = id;
  goHome();
  return true;
}
const nav = document.getElementById("nav");
if (nav) nav.addEventListener("click", (e) => {
  const el = e.target.closest("[data-nav]");
  if (!el) return;
  const what = el.dataset.nav;
  if (what === "end") actions.end();
  else if (what === "home") {
    if (state.view === "home") { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    if (inProgress() && !window.confirm(LEAVE_MSG)) return;
    goHome();
  }
});

function placeFocus(focus, had) {
  let el = null;
  if (focus === "stem") el = document.getElementById("q-stem");
  else if (focus === "next") el = root.querySelector('[data-action="next"]');
  else if (focus === "h1") el = root.querySelector("h1");
  else if (focus === "grade") el = root.querySelector('[data-action="grade"]');
  if (!el && had) {
    if (had.id) el = document.getElementById(had.id);
    if (!el && had.cls) el = root.querySelector(".passage-toggle");
    if (!el && had.action) {
      el = Array.from(root.querySelectorAll(`[data-action="${had.action}"]`)).find((x) => (x.dataset.arg || "") === (had.arg || "")) || null;
      if (el && el.disabled) el = null;
    }
  }
  if (!el) return;
  el.focus({ preventScroll: true });
  if (el.tagName === "INPUT" && typeof el.value === "string") { try { el.setSelectionRange(el.value.length, el.value.length); } catch (err) { /* email inputs */ } }
  if (focus === "next") {
    // Keep the feedback in view: scroll just enough to show it and the Next button.
    const fb = document.getElementById("feedback");
    if (fb) {
      const r = fb.getBoundingClientRect(), b = el.getBoundingClientRect();
      if (b.bottom > window.innerHeight - 8) window.scrollBy(0, Math.min(b.bottom - window.innerHeight + 16, r.top - 72));
    }
  }
}

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  if (el.tagName === "SUMMARY") return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el.dataset.arg || "");
});
// Remember whether "How it works" was left open or folded.
root.addEventListener("toggle", (e) => {
  if (e.target.id === "howto") { state.howOpen = e.target.open; writeKey(HOWTO_KEY, e.target.open ? "1" : "0"); }
  if (e.target.id === "ctx") state.ctxOpen = e.target.open;
}, true);
root.addEventListener("input", (e) => {
  if (e.target.id === "restore") { state.restoreText = e.target.value; state.msg = ""; }
  if (e.target.id === "email") state.email = e.target.value;
});
// supabase-js is only fetched once the Sync section is actually used.
root.addEventListener("focusin", (e) => { if (e.target.id === "email") sync.ensure(); });
root.addEventListener("keydown", (e) => {
  if (e.target.id === "email" && e.key === "Enter") { e.preventDefault(); actions.signin(); }
  if (e.target.id === "typed-input" && e.key === "Enter" && !e.isComposing) { e.preventDefault(); e.stopPropagation(); submitTyped(); }
  if (e.target.id === "explain-input" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); revealExplain(); }
});
root.addEventListener("input", (e) => {
  const item = current();
  if (item && item.work && (e.target.id === "typed-input" || e.target.id === "explain-input")) item.work.text = e.target.value;
});
window.addEventListener("keydown", (e) => {
  if (state.view !== "quiz" || !state.sess) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (state.sess.picked === null) {
    // Typed recall: typing anywhere on the page goes into the answer box.
    const inp = document.getElementById("typed-input");
    if (inp && !inp.readOnly && e.key.length === 1 && e.key !== " ") { inp.focus(); return; }
    const map = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, a: 0, b: 1, c: 2, d: 3, e: 4 };
    const k = e.key.toLowerCase();
    if (map[k] !== undefined) { e.preventDefault(); answer(map[k]); }
  } else if (e.key === "Enter" || e.key === "ArrowRight") {
    // Enter on another focused button (End round, Show passage) belongs to that button.
    const onOther = e.key === "Enter" && e.target && ((e.target.tagName === "BUTTON" && e.target.dataset.action !== "next") || e.target.tagName === "SUMMARY");
    if (onOther) return;
    e.preventDefault(); next();
  }
});
// Another tab answered questions: pick up its progress.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try { state.store = normalize(JSON.parse(e.newValue)); if (state.view === "home") render(); } catch (err) { /* ignore */ }
  }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sync.flush(); });
// Crossing the wide-screen breakpoint switches the passage between side-by-side and peek.
window.matchMedia("(min-width: 1000px)").addEventListener("change", () => { if (state.view === "quiz") render(false, "keep"); });

// ---------- history ----------
window.addEventListener("popstate", () => {
  if (state.leaving) { state.leaving = false; showHome(); return; }
  const r = parseRoute(location.hash);
  const here = state.sess && (state.view === "quiz" || state.view === "summary") ? "#" + routeFor(state.sess.mode, state.sess.keys, state.sess.lesson)
    : state.view === "lesson" ? "#study/" + state.lesson : "";
  if (here && location.hash === here) return;
  if (inProgress() && !window.confirm(LEAVE_MSG)) {
    // Stay: put the round's entry back on top of the history stack.
    try { history.pushState({ sl: "round" }, "", here); } catch (err) { /* ignore */ }
    return;
  }
  if (r && r.view === "lesson") { openLesson(r.lesson, { how: "none" }); return; }
  if (r) { start(r.mode, r.keys, { how: "none", lesson: r.lesson }); return; } // Forward into a round, or a typed hash
  if (location.hash && !authInUrl()) { try { history.replaceState(null, "", homeUrl()); } catch (err) { /* ignore */ } }
  showHome();
});

// Opening or refreshing a round's link starts a fresh round of that kind (rounds are short and
// randomised, so there is nothing to resume). Back from it returns to the subject list.
function routeOnLoad() {
  if (authInUrl()) return; // a magic-link redirect: leave the hash for supabase-js to read
  const r = parseRoute(location.hash);
  if (!r) {
    if (location.hash) { try { history.replaceState(null, "", homeUrl()); } catch (err) { /* ignore */ } }
    return;
  }
  const go = (how) => (r.view === "lesson" ? openLesson(r.lesson, { how }) : start(r.mode, r.keys, { how, lesson: r.lesson }));
  if (roundState()) { go("none"); return; } // refresh: home entry is already behind us
  try { history.replaceState(null, "", homeUrl()); } catch (err) { /* ignore */ }
  go("push");
}

menu = initMenu({
  source: homeOutline,
  go: goToSection,
  note: () => (inProgress() ? "Opening a section ends this round (you'll be asked first)." : state.view !== "home" ? "Sections of the home page." : ""),
});
render();
routeOnLoad();
sync.init();
// start(mode, keys, { ids }) runs a round of chosen question ids (used by the tests and screenshots).
window.__studyLab = { state, QUESTIONS, QMAP, LESSONS, loadLsat, menu, start, openLesson, render }; // handy for debugging in the console
