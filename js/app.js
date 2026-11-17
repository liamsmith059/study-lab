import {
  SUBJECTS, CORE_KEYS, QUESTIONS, QMAP, INTERVALS, SIZE, STORAGE_KEY, DIFF, LETTERS, PASSAGES, PACE, LSAT_META, TOTAL_QUESTIONS,
  emptyStore, normalize, streakOf, levelOf, levelHint, buildSession, buildLsatSession, choiceOrder, passageIds,
  applyAnswer, subjectStats, whenText, encodeBackup, decodeBackup, loadLsat, dueCounts, weakestTopic, dayKey,
} from "./engine.js";
import { createSync, syncConfigured, authInUrl } from "./sync.js";

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
function readKey(k) { try { return localStorage.getItem(k); } catch (err) { return null; } }
function writeKey(k, v) { try { localStorage.setItem(k, v); } catch (err) { /* ignore */ } }
const narrowScreen = () => window.matchMedia("(max-width: 640px)").matches;

// ---------- state ----------
const state = {
  store: loadStore(),
  view: "home", // home | quiz | summary
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
function routeFor(mode, keys) {
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
  const m = /^lsat(?:\/(\w+))?$/.exec(h);
  if (m) return { mode: "lsat-" + (LSAT_KINDS.includes(m[1]) ? m[1] : "short"), keys: ["lsat"] };
  return null;
}
const homeUrl = () => location.pathname + location.search;
const roundState = () => !!(history.state && history.state.sl === "round");
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
  const lsat = mode.startsWith("lsat-");
  if (lsat) {
    try { await loadLsat(); }
    catch (err) { state.lsatMsg = "Couldn't load the LSAT questions. Check your connection and try again."; render(); return; }
    state.lsatMsg = "";
  }
  const topicFilter = opts.topic ? (q) => q.t === opts.topic : null;
  const ids = lsat ? buildLsatSession(state.store, mode.slice(5)) : buildSession(state.store, keys, mode === "topic" ? "subject" : mode, Date.now(), topicFilter);
  if (!ids.length) return;
  const startLevels = {};
  keys.forEach((k) => { startLevels[k] = levelOf(state.store, k); });
  const title = lsat ? LSAT_TITLES[mode.slice(5)] : mode === "topic" ? opts.topic + " practice" : mode === "due" ? "Due for review" : mode === "mixed" ? "Mixed review" : subjName(keys[0]) + " practice";
  const how = opts.how || (state.view === "home" ? "push" : "replace");
  const hash = "#" + routeFor(mode, keys);
  try {
    if (how === "push") history.pushState({ sl: "round" }, "", hash);
    else if (how === "replace") history.replaceState({ sl: "round" }, "", hash);
  } catch (err) { /* sandboxed frames may block history; the app still works */ }
  state.sess = {
    mode, keys, title, topic: opts.topic || "", idx: 0, picked: null, results: [], startLevels, retries: 0, total: ids.length,
    items: ids.map((id) => ({ qid: id, order: choiceOrder(QMAP[id]), retry: false, kind: state.store.cards[id] ? "Review" : "New" })),
  };
  state.conf = "unsure";
  state.view = "quiz";
  state.msg = "";
  beginQuestion();
  render(true, "stem");
}

function showHome() {
  state.view = "home";
  sync.flush();
  render(true, "h1");
}
// Leave a round or summary for the subject list, going back through history when we pushed an entry.
function goHome() {
  if (roundState()) { state.leaving = true; history.back(); return; }
  try { history.replaceState(null, "", homeUrl()); } catch (err) { /* ignore */ }
  showHome();
}

// Reset the per-question clock and, when the passage changes, the set clock and the passage panel.
function beginQuestion() {
  const sess = state.sess;
  const q = QMAP[sess.items[sess.idx].qid];
  const now = Date.now();
  sess.qStart = now; sess.qEnd = 0;
  // A new passage starts as a short peek on phones so the question stays in view.
  if (q.p !== state.passageKey) { state.passageKey = q.p; state.passageOpen = false; sess.pStart = now; }
}

function answer(i) {
  const sess = state.sess;
  if (!sess || sess.picked !== null) return;
  const item = sess.items[sess.idx];
  if (i >= item.order.length) return;
  const q = QMAP[item.qid];
  const correct = item.order[i] === q.c[0];
  if (!correct && !item.retry && sess.retries < 3) {
    sess.items.splice(Math.min(sess.idx + 4, sess.items.length), 0, { qid: item.qid, order: choiceOrder(q), retry: true, kind: "Second try" });
    sess.retries++;
  }
  sess.picked = i;
  sess.qEnd = Date.now();
  sess.results.push({ qid: item.qid, correct, retry: item.retry, conf: state.conf });
  if (!item.retry) setStore(applyAnswer(state.store, q, correct, state.conf, Date.now()));
  render(false, "next");
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
  passage: () => togglePassage(),
  answer: (arg) => answer(Number(arg)),
  next,
  conf: (arg) => { state.conf = arg; render(); },
  end: () => { if (state.sess && state.sess.results.length) finishRound(); else goHome(); },
  home: () => goHome(),
  again: () => {
    const s = state.sess, due = dueCounts(state.store);
    if (s.mode === "due" && due.core === 0) start("mixed", CORE_KEYS);
    else if (s.mode === "lsat-due" && due.lsat === 0) start("lsat-short", ["lsat"]);
    else start(s.mode, s.keys, { topic: s.topic });
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
function quizView() {
  const sess = state.sess;
  const item = sess.items[sess.idx];
  const q = QMAP[item.qid];
  const revealed = sess.picked !== null;
  const correctIdx = item.order.indexOf(q.c[0]);
  const wasRight = revealed && sess.picked === correctIdx;
  const card = state.store.cards[q.id];
  const last = sess.idx + 1 >= sess.items.length;
  const letters = LETTERS;
  const choices = item.order.map((opt, i) => {
    let cls = "choice", tag = "";
    if (revealed && i === correctIdx) { cls += " correct"; tag = i === sess.picked ? "Your answer, correct" : "Correct answer"; }
    else if (revealed && i === sess.picked) { cls += " wrong"; tag = "Your answer"; }
    else if (revealed) cls += " dim";
    return `<button class="${cls}" data-action="answer" data-arg="${i}"${revealed ? " disabled" : ""}>
      <span class="letter">${letters[i]}</span><span class="opt">${esc(opt)}</span>${tag ? `<span class="tag">${esc(tag)}</span>` : ""}</button>`;
  }).join("");
  let feedback = "";
  if (revealed) {
    let follow = "";
    if (!item.retry) {
      follow = wasRight
        ? (state.conf === "guess" ? " You marked this as a guess, so it comes back " + whenText(INTERVALS[card ? card.b : 1]) + "." : " Next review " + whenText(INTERVALS[card ? card.b : 2]) + ".")
        : " You'll see this again later in this round and " + whenText(INTERVALS[1]) + ".";
    }
    feedback = `<div class="callout ${wasRight ? "success" : "danger"}" role="status" id="feedback">
      <strong>${wasRight ? "Correct. The answer is (" + letters[correctIdx] + ")." : "Not quite. The answer is (" + letters[correctIdx] + ")" + (q.fixed ? "." : ": " + esc(q.c[0]) + ".")}</strong> ${esc(q.e)}${esc(follow)}
      ${trapLine(q, item, sess.picked)}</div>`;
  }
  const confs = [["sure", "Sure"], ["unsure", "Think so"], ["guess", "Guessing"]];
  // The counter tracks the round's original questions only; second tries are labelled, not counted.
  const total = sess.total;
  const pos = sess.items.slice(0, sess.idx + 1).filter((it) => !it.retry).length;
  const doneFirst = sess.results.filter((r) => !r.retry).length;
  const count = item.retry
    ? `<span class="count" aria-hidden="true">Second try · ${doneFirst} / ${total} done</span><span class="sr-only">Second try. ${doneFirst} of ${total} done.</span>`
    : `<span class="count" aria-hidden="true">${pos} / ${total}</span><span class="sr-only">Question ${pos} of ${total}</span>`;
  const kicker = [sess.title, sess.keys.length > 1 ? subjName(q.s) : "", q.t, DIFF[q.d], item.kind].filter(Boolean).join(" · ");
  const body = `
  <section class="quiz">
    <p class="kicker">${esc(kicker)}</p>
    <div class="quiz-progress">${count}${bar(doneFirst / total)}</div>
    ${paceLine(q)}
    ${q.stim ? `<div class="stim">${esc(q.stim)}</div>` : ""}
    <h1 class="question${q.s === "lsat" ? " stem" : ""}" id="q-stem" tabindex="-1">${esc(q.q)}</h1>
    ${revealed ? "" : `<div class="conf"><p class="muted">How sure are you? Guesses come back sooner even if right.</p>
      <div class="segmented" role="group" aria-label="Confidence">${confs.map(([v, l]) => `<button class="${state.conf === v ? "on" : ""}" data-action="conf" data-arg="${v}" aria-pressed="${state.conf === v}">${l}</button>`).join("")}</div></div>`}
    <div class="choices">${choices}</div>
    ${revealed ? feedback : `<p class="small muted hide-touch">Tip: press 1 to ${item.order.length} (or A to ${letters[item.order.length - 1]}) to answer, then Enter for the next question.</p>`}
    <div class="actions start">${revealed ? btn(last ? "See results" : "Next question", "next", { primary: true, describedby: "feedback" }) : ""}${btn("End round", "end")}</div>
  </section>`;
  return q.p ? `<div class="split">${passageBar(q)}${passagePanel(q.p)}<div class="split-main">${body}</div></div>` : body;
}

// Phones and narrow windows: a compact bar that sticks to the top while reading a passage set.
function passageBar(q) {
  const p = PASSAGES[q.p];
  const set = passageIds(q.p);
  const open = state.passageOpen;
  return `<div class="lsat-bar">
    <span class="lsat-bar-title">${esc(p.title)}</span>
    <span class="lsat-bar-q">Q ${set.indexOf(q.id) + 1} of ${set.length}</span>
    <button class="btn lsat-bar-btn" data-action="passage" aria-controls="passage" aria-expanded="${open}">${open ? "Hide passage" : "Show passage"}</button>
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
    : paras(p.paras);
  const open = state.passageOpen || wideScreen();
  return `<section class="card passage ${open ? "open" : "peek"}" id="passage" aria-labelledby="passage-title">
    <div class="passage-head"><h2 id="passage-title">${esc(p.title)}<span class="small muted"> · ${esc(p.area || "")}${p.kind === "comparative" ? " · comparative" : ""}</span></h2></div>
    <div class="passage-body" data-key="${esc(key)}" tabindex="0" aria-label="Passage text">${body}</div>
    <div class="passage-foot">${open
      ? `<button class="btn passage-toggle" data-action="passage" aria-controls="passage" aria-expanded="true">Hide passage</button>`
      : `<button class="btn passage-toggle" data-action="passage" aria-controls="passage" aria-expanded="false">Read the full passage</button>`}</div>
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
  else if (downs.length) note = `<div class="callout info"><strong>Easing off.</strong> ${esc(downs.map(subjName).join(" and "))} dropped a level, so you'll get more foundation questions until accuracy recovers.</div>`;
  const missedList = missed.map((r) => {
    const q = QMAP[r.qid];
    const ans = q.fixed ? `(${LETTERS[q.fixed.indexOf(q.c[0])]}) ${esc(q.c[0])}` : esc(q.c[0]) + ".";
    const ctx = q.fixed ? `<div class="small muted">${esc(q.stim ? trunc(q.stim, 160) : "Passage: " + PASSAGES[q.p].title)}</div>` : "";
    return `<li>${ctx}<div class="mq">${esc(q.q)}</div><div class="small"><strong>Answer: ${ans}</strong> ${esc(q.e)}</div><div class="small muted">${esc(subjName(q.s) + " · " + q.t)}</div></li>`;
  }).join("");
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
    <div class="actions start">${btn(lsatRound ? "Another LSAT round" : "Another round", "again", { primary: true })}${btn("Back to subjects", "home")}</div>
  </article>
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
      <span class="meta hint">${esc(levelHint(st, s.key))}</span>
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
  ];
  // First visit: open on wide screens, folded to a one-line teaser on phones. After that, the reader's choice sticks.
  const howOpen = state.howOpen === null ? st.total === 0 && !narrowScreen() : state.howOpen;
  return `
  <section class="hero">
    <h1 tabindex="-1">Study Lab</h1>
    <p class="lede"><span class="tagline-long">Six school subjects plus LSAT prep, ${TOTAL_QUESTIONS} questions, with spaced repetition and difficulty that climbs as you improve.</span><span class="tagline-short">${TOTAL_QUESTIONS} questions that get harder as you do.</span></p>
    <div class="actions">
      ${btn(dueAll ? "Review due (" + Math.min(dueAll, SIZE) + ")" : "Nothing due", "start", { arg: "due:all", primary: dueAll > 0, disabled: !dueAll })}
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
  ${lsatCard(st, now)}
  ${seenAll ? `<section class="card panel"><h2>Mastery by subject</h2><p class="small muted">Mastery grows as questions move to longer review intervals; mastered means a week or more.</p>${bars}</section>` : ""}
  ${syncSection()}
  <details class="card panel howto" id="howto"${howOpen ? " open" : ""}><summary><h2>How it works</h2><span class="teaser small">Recall, spacing and rising difficulty, in a one-minute read.</span></summary>
    <ol class="steps">${steps.map(([t, d]) => `<li><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></li>`).join("")}</ol>
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
  const { lr, rc, sets } = LSAT_META;
  return `<article class="card panel lsat-card" aria-labelledby="lsat-title">
    <p class="kicker">LSAT prep · Level ${levelOf(st, "lsat")} of 3 · ${ss.seen}/${ss.total} seen · ${ss.mastered} mastered${ss.due ? ` · <span class="due">${ss.due} due</span>` : ""}</p>
    <h2 id="lsat-title">Original practice in the style of the current test.</h2>
    <p class="lead">${lr} Logical Reasoning arguments and ${sets} Reading Comprehension passage sets (${rc} questions) across law, science, humanities and social science. Five choices, A to E.</p>
    ${ss.seen ? bar(ss.mastery) : ""}
    <p class="small muted">${esc(levelHint(st, "lsat"))}</p>
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
  else if (state.view === "summary" && state.sess) root.innerHTML = summaryView();
  else { state.view = "home"; root.innerHTML = homeView(); }
  const nb = document.getElementById("backup");
  if (nb && backupWasOpen) nb.open = true;
  const newBody = document.querySelector(".passage-body");
  if (newBody && keepScroll && keepScroll.key === newBody.dataset.key) newBody.scrollTop = keepScroll.top;
  if (scrollTop) window.scrollTo(0, 0);
  updateNav();
  placeFocus(focus, had);
}

// The top bar lives outside #app: "Subjects" on the home page, "End round" during a round.
const navSlot = document.getElementById("nav-slot");
function updateNav() {
  if (!navSlot) return;
  const mode = state.view === "quiz" ? "end" : state.view === "summary" ? "back" : "subjects";
  navSlot.dataset.nav = mode;
  navSlot.textContent = mode === "end" ? "End round" : "Subjects";
}
const nav = document.getElementById("nav");
if (nav) nav.addEventListener("click", (e) => {
  const el = e.target.closest("[data-nav]");
  if (!el) return;
  const what = el.dataset.nav;
  if (what === "subjects") {
    const target = document.getElementById("subjects");
    if (target) { target.scrollIntoView({ behavior: "smooth", block: "start" }); const b = target.querySelector(".tile-link"); if (b) b.focus({ preventScroll: true }); }
  } else if (what === "end") actions.end();
  else if (what === "back") goHome();
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
}, true);
root.addEventListener("input", (e) => {
  if (e.target.id === "restore") { state.restoreText = e.target.value; state.msg = ""; }
  if (e.target.id === "email") state.email = e.target.value;
});
// supabase-js is only fetched once the Sync section is actually used.
root.addEventListener("focusin", (e) => { if (e.target.id === "email") sync.ensure(); });
root.addEventListener("keydown", (e) => {
  if (e.target.id === "email" && e.key === "Enter") { e.preventDefault(); actions.signin(); }
});
window.addEventListener("keydown", (e) => {
  if (state.view !== "quiz" || !state.sess) return;
  if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (state.sess.picked === null) {
    const map = { 1: 0, 2: 1, 3: 2, 4: 3, 5: 4, a: 0, b: 1, c: 2, d: 3, e: 4 };
    const k = e.key.toLowerCase();
    if (map[k] !== undefined) { e.preventDefault(); answer(map[k]); }
  } else if (e.key === "Enter" || e.key === "ArrowRight") {
    // Enter on another focused button (End round, Show passage) belongs to that button.
    const onOther = e.key === "Enter" && e.target && e.target.tagName === "BUTTON" && e.target.dataset.action !== "next";
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
  const here = state.sess && (state.view === "quiz" || state.view === "summary") ? "#" + routeFor(state.sess.mode, state.sess.keys) : "";
  if (here && location.hash === here) return;
  if (inProgress() && !window.confirm(LEAVE_MSG)) {
    // Stay: put the round's entry back on top of the history stack.
    try { history.pushState({ sl: "round" }, "", here); } catch (err) { /* ignore */ }
    return;
  }
  if (r) { start(r.mode, r.keys, { how: "none" }); return; } // Forward into a round, or a typed hash
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
  if (roundState()) { start(r.mode, r.keys, { how: "none" }); return; } // refresh: home entry is already behind us
  try { history.replaceState(null, "", homeUrl()); } catch (err) { /* ignore */ }
  start(r.mode, r.keys, { how: "push" });
}

render();
routeOnLoad();
sync.init();
window.__studyLab = { state, QUESTIONS, QMAP, loadLsat }; // handy for debugging in the console
