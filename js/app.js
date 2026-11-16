import {
  SUBJECTS, SUBJECT_KEYS, QUESTIONS, QMAP, INTERVALS, SIZE, STORAGE_KEY, DIFF,
  emptyStore, normalize, streakOf, shuffle, levelOf, levelHint, dueList, buildSession,
  applyAnswer, subjectStats, whenText, encodeBackup, decodeBackup,
} from "./engine.js";
import { createSync, syncConfigured } from "./sync.js";

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
  `<button class="btn${opts.primary ? " primary" : ""}" data-action="${action}"${opts.arg !== undefined ? ` data-arg="${esc(opts.arg)}"` : ""}${opts.disabled ? " disabled" : ""}>${esc(label)}</button>`;
const metric = (value, label, detail) =>
  `<div class="metric"><div class="metric-value">${esc(value)}</div><div class="metric-label">${esc(label)}</div>${detail ? `<div class="metric-detail">${esc(detail)}</div>` : ""}</div>`;

// ---------- actions ----------
function start(mode, keys) {
  const ids = buildSession(state.store, keys, mode);
  if (!ids.length) return;
  const startLevels = {};
  keys.forEach((k) => { startLevels[k] = levelOf(state.store, k); });
  const title = mode === "due" ? "Due for review" : mode === "mixed" ? "Mixed review" : subjName(keys[0]) + " practice";
  state.sess = {
    mode, keys, title, idx: 0, picked: null, results: [], startLevels, retries: 0,
    items: ids.map((id) => ({ qid: id, order: shuffle(QMAP[id].c), retry: false, kind: state.store.cards[id] ? "Review" : "New" })),
  };
  state.conf = "unsure";
  state.view = "quiz";
  render(true);
}

function answer(i) {
  const sess = state.sess;
  if (!sess || sess.picked !== null) return;
  const item = sess.items[sess.idx];
  if (i >= item.order.length) return;
  const q = QMAP[item.qid];
  const correct = item.order[i] === q.c[0];
  if (!correct && !item.retry && sess.retries < 3) {
    sess.items.splice(Math.min(sess.idx + 4, sess.items.length), 0, { qid: item.qid, order: shuffle(q.c), retry: true, kind: "Second try" });
    sess.retries++;
  }
  sess.picked = i;
  sess.results.push({ qid: item.qid, correct, retry: item.retry, conf: state.conf });
  if (!item.retry) setStore(applyAnswer(state.store, q, correct, state.conf, Date.now()));
  render();
}

function next() {
  const sess = state.sess;
  if (!sess) return;
  if (sess.idx + 1 >= sess.items.length) { state.view = "summary"; sync.flush(); render(true); return; }
  sess.idx++;
  sess.picked = null;
  state.conf = "unsure";
  render(true);
}

const actions = {
  start: (arg) => { const [mode, keys] = arg.split(":"); start(mode, keys === "all" ? SUBJECT_KEYS : keys.split(",")); },
  answer: (arg) => answer(Number(arg)),
  next,
  conf: (arg) => { state.conf = arg; render(); },
  end: () => { state.view = state.sess && state.sess.results.length ? "summary" : "home"; sync.flush(); render(true); },
  home: () => { state.view = "home"; render(true); },
  again: () => {
    const s = state.sess;
    const dueNow = dueList(state.store, SUBJECT_KEYS).length;
    if (s.mode === "due" && dueNow === 0) start("mixed", SUBJECT_KEYS); else start(s.mode, s.keys);
  },
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
  const letters = ["A", "B", "C", "D"];
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
    feedback = `<div class="callout ${wasRight ? "success" : "danger"}" role="status">
      <strong>${wasRight ? "Correct." : "Not quite. The answer is: " + esc(q.c[0]) + "."}</strong> ${esc(q.e)}${esc(follow)}</div>`;
  }
  const confs = [["sure", "Sure"], ["unsure", "Think so"], ["guess", "Guessing"]];
  return `
  <header class="top"><h1>${esc(sess.title)}</h1><p class="muted">Pick an answer, then read why. Missed questions come back later in the round and again soon after.</p></header>
  <section class="card">
    <div class="row between"><h2>Question ${sess.idx + 1} of ${sess.items.length}</h2></div>
    ${bar((sess.idx + (revealed ? 1 : 0)) / sess.items.length)}
    <div class="meta">${esc(subjName(q.s) + " · " + q.t + " · " + DIFF[q.d] + " · " + item.kind)}</div>
    <div class="question">${esc(q.q)}</div>
    ${revealed ? "" : `<div class="conf"><div class="small muted">How sure are you? Guesses come back sooner even if right.</div>
      <div class="segmented" role="group" aria-label="Confidence">${confs.map(([v, l]) => `<button class="${state.conf === v ? "on" : ""}" data-action="conf" data-arg="${v}" aria-pressed="${state.conf === v}">${l}</button>`).join("")}</div></div>`}
    <div class="choices">${choices}</div>
    ${revealed ? feedback : `<div class="small faint hide-touch">Tip: press 1 to 4 to answer, then Enter for the next question.</div>`}
    <div class="row">${revealed ? btn(last ? "See results" : "Next question", "next", { primary: true }) : ""}${btn("End round", "end")}</div>
  </section>`;
}

function summaryView() {
  const sess = state.sess, st = state.store;
  const firsts = sess.results.filter((r) => !r.retry);
  const right = firsts.filter((r) => r.correct).length;
  const missed = firsts.filter((r) => !r.correct);
  const fixed = sess.results.filter((r) => r.retry && r.correct).length;
  const ups = sess.keys.filter((k) => levelOf(st, k) > (sess.startLevels[k] || 1));
  const downs = sess.keys.filter((k) => levelOf(st, k) < (sess.startLevels[k] || 1));
  const dueNow = dueList(st, SUBJECT_KEYS).length;
  let note = "";
  if (ups.length) note = `<div class="callout success"><strong>Level up.</strong> ${esc(ups.map((k) => subjName(k) + " is now Level " + levelOf(st, k)).join("; "))}. Harder questions will show up more often.</div>`;
  else if (downs.length) note = `<div class="callout info"><strong>Easing off.</strong> ${esc(downs.map(subjName).join(" and "))} dropped a level, so you'll get more foundation questions until accuracy recovers.</div>`;
  return `
  <header class="top"><h1>Round complete</h1><p class="muted">${esc(sess.title)}: here is how you did and what comes back next.</p></header>
  <section class="card">
    <h2>Results</h2>
    <p>You got ${right} of ${firsts.length} right on the first try${fixed ? ", and fixed " + fixed + " on the second try." : "."}</p>
    <div class="metrics">
      ${metric(right + "/" + firsts.length, "First-try score", pctOf(right, firsts.length) + "%")}
      ${metric(streakOf(st), "Day streak")}
      ${metric(dueNow, "Due now", "across all subjects")}
      ${metric(pctOf(st.right, st.total) + "%", "All-time accuracy", st.total + " answered")}
    </div>
    ${note}
    <div class="row">${btn("Another round", "again", { primary: true })}${btn("Back to subjects", "home")}</div>
  </section>
  ${missed.length ? `<section class="card"><h2>Review what you missed</h2><ul class="missed">${missed.map((r) => {
    const q = QMAP[r.qid];
    return `<li><div class="mq">${esc(q.q)}</div><div class="small"><strong>Answer: ${esc(q.c[0])}.</strong> ${esc(q.e)}</div><div class="small faint">${esc(subjName(q.s) + " · " + q.t)}</div></li>`;
  }).join("")}</ul></section>` : ""}`;
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
       <div class="row"><input id="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="${esc(state.email)}" aria-label="Email">${btn("Email me a link", "signin", { primary: true })}</div>`;
  return `<section class="card"><h2>Sync across devices</h2>${body}${state.authMsg ? `<p class="small muted">${esc(state.authMsg)}</p>` : ""}</section>`;
}

function homeView() {
  const st = state.store, now = Date.now();
  const dueAll = dueList(st, SUBJECT_KEYS, now).length;
  const masteredAll = QUESTIONS.filter((q) => st.cards[q.id] && st.cards[q.id].b >= 4).length;
  const seenAll = Object.keys(st.cards).length;
  const lead = st.total === 0
    ? "Pick any subject to start. Each round is 10 questions, and what you miss comes back sooner."
    : dueAll > 0 ? dueAll + " questions are due for review. Clear those first, then take a new round."
    : "Nothing is due right now. Take a new round or a mixed review to keep your streak going.";
  const saveNote = storageOk
    ? (sync.user ? "Progress saves on this device and syncs to your account." : "Progress saves automatically on this device.")
    : "This browser is blocking storage (private mode?), so progress won't be kept. Use the backup code below.";
  const cards = SUBJECTS.map((s) => {
    const ss = subjectStats(st, s.key, now);
    return `<div class="subject">
      <h3>${esc(s.name)}</h3>
      <div class="small muted">${esc(s.blurb)}</div>
      ${bar(ss.mastery)}
      <div class="small muted">Level ${levelOf(st, s.key)} of 3 · ${ss.seen}/${ss.total} seen · ${ss.mastered} mastered${ss.due ? " · " + ss.due + " due" : ""}</div>
      <div class="small faint">${esc(levelHint(st, s.key))}</div>
      <div>${btn("Study " + s.name, "start", { arg: "subject:" + s.key, primary: ss.due > 0 })}</div>
    </div>`;
  }).join("");
  const bars = SUBJECTS.map((s) => ({ s, ss: subjectStats(st, s.key, now) }))
    .sort((a, b) => b.ss.mastery - a.ss.mastery)
    .map(({ s, ss }) => `<div class="hbar"><div class="hlabel">${esc(s.name)}</div><div class="htrack"><div style="width:${Math.round(ss.mastery * 100)}%"></div></div><div class="hval">${Math.round(ss.mastery * 100)}%<span class="faint"> · ${ss.mastered} mastered</span></div></div>`).join("");
  const steps = [
    ["Retrieval practice", "Every question makes you recall the answer before you see it, which strengthens memory far more than rereading."],
    ["Spaced repetition", "Each question sits in one of six boxes. A miss sends it back to box 1 (review in 10 minutes); each correct answer moves it up: 1 day, 3 days, 1 week, 16 days, 35 days."],
    ["Confidence check", "Mark Sure, Think so, or Guessing before answering. A lucky guess doesn't move a question up, and a sure first answer skips ahead."],
    ["Adaptive difficulty", "Each subject starts at Level 1 with mostly easy questions. Medium unlocks at 60% accuracy over 8+ recent answers, hard at 75% over 15+, and the level drops back if accuracy falls."],
    ["Interleaving", "Mixed review and Due review alternate subjects, which feels harder but builds more durable, flexible knowledge."],
    ["Second tries", "A missed question returns a few questions later in the same round so you fix it while the explanation is fresh."],
  ];
  return `
  <header class="top"><h1>Study Lab</h1><p class="muted">Six subjects, ${QUESTIONS.length} questions, with spaced repetition and difficulty that climbs as you improve.</p></header>
  <section class="card">
    <h2>Today</h2>
    <p>${esc(lead)}</p>
    <div class="metrics">
      ${metric(streakOf(st, now), "Day streak")}
      ${metric(dueAll, "Due now")}
      ${metric(pctOf(st.right, st.total) + "%", "Accuracy", st.total + " answered")}
      ${metric(masteredAll + "/" + QUESTIONS.length, "Mastered", seenAll + " seen")}
    </div>
    <div class="row">
      ${btn(dueAll ? "Review due (" + Math.min(dueAll, SIZE) + ")" : "Nothing due", "start", { arg: "due:all", primary: dueAll > 0, disabled: !dueAll })}
      ${btn("Mixed review", "start", { arg: "mixed:all", primary: !dueAll })}
    </div>
    <p class="small faint">${esc(saveNote)}</p>
  </section>
  <h2 class="section-title">Subjects</h2>
  <div class="grid">${cards}</div>
  ${seenAll ? `<section class="card"><h2>Mastery by subject</h2><p class="small faint">Mastery grows as questions move to longer review intervals; mastered means a week or more.</p>${bars}</section>` : ""}
  ${syncSection()}
  <details class="card"${st.total === 0 ? " open" : ""}><summary><h2>How it works</h2></summary>
    <ol class="steps">${steps.map(([t, d]) => `<li><strong>${esc(t)}</strong><div class="small muted">${esc(d)}</div></li>`).join("")}</ol>
  </details>
  <details class="card" id="backup"><summary><h2>Backup and reset</h2></summary>
    <p>Copy this code to move progress to another browser, or paste a code here (codes from the original Study Lab Page work too).</p>
    <textarea id="backup-code" readonly rows="3">${esc(encodeBackup(st))}</textarea>
    <div class="row">${btn("Copy code", "copy")}</div>
    <label class="small muted" for="restore">Restore from a backup code</label>
    <textarea id="restore" rows="2" placeholder="Paste a backup code">${esc(state.restoreText)}</textarea>
    <div class="row">${btn("Restore", "restore")}${btn(state.confirmReset ? "Tap again to erase all progress" : "Reset progress", "reset")}</div>
    ${state.msg ? `<p class="small muted">${esc(state.msg)}</p>` : ""}
  </details>
  <footer class="small faint">Study Lab · progress is stored in your browser${syncConfigured() ? " and, if you sign in, your account" : ""}.</footer>`;
}

// ---------- render ----------
const root = document.getElementById("app");
function render(scrollTop = false) {
  const openBackup = document.getElementById("backup");
  const backupWasOpen = openBackup && openBackup.open;
  if (state.view === "quiz" && state.sess) root.innerHTML = quizView();
  else if (state.view === "summary" && state.sess) root.innerHTML = summaryView();
  else { state.view = "home"; root.innerHTML = homeView(); }
  const nb = document.getElementById("backup");
  if (nb && backupWasOpen) nb.open = true;
  if (scrollTop) window.scrollTo(0, 0);
}

root.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  if (el.tagName === "SUMMARY") return;
  const fn = actions[el.dataset.action];
  if (fn) fn(el.dataset.arg || "");
});
root.addEventListener("input", (e) => {
  if (e.target.id === "restore") { state.restoreText = e.target.value; state.msg = ""; }
  if (e.target.id === "email") state.email = e.target.value;
});
root.addEventListener("keydown", (e) => {
  if (e.target.id === "email" && e.key === "Enter") { e.preventDefault(); actions.signin(); }
});
window.addEventListener("keydown", (e) => {
  if (state.view !== "quiz" || !state.sess) return;
  if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (state.sess.picked === null) {
    const map = { 1: 0, 2: 1, 3: 2, 4: 3, a: 0, b: 1, c: 2, d: 3 };
    const k = e.key.toLowerCase();
    if (map[k] !== undefined) { e.preventDefault(); answer(map[k]); }
  } else if (e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); next(); }
});
// Another tab answered questions: pick up its progress.
window.addEventListener("storage", (e) => {
  if (e.key === STORAGE_KEY && e.newValue) {
    try { state.store = normalize(JSON.parse(e.newValue)); if (state.view === "home") render(); } catch (err) { /* ignore */ }
  }
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") sync.flush(); });

render();
sync.init();
window.__studyLab = { state, QUESTIONS }; // handy for debugging in the console
