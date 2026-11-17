// Headless browser smoke test. Serves the site under a sub-path (like GitHub Pages /<repo>/),
// then checks loading, console errors, a full quiz round, localStorage, reload persistence,
// a phone-sized layout, and the sync flow against a fake Supabase client.
// Usage: cd tests && npm install && node smoke.mjs   (uses system Chrome; set CHROME_PATH to override)
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..");
const PORT = 8765;
const BASE = `http://localhost:${PORT}/${path.basename(siteDir)}/`;
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: path.dirname(siteDir), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

let failures = 0;
const check = (name, cond, extra = "") => { console.log((cond ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!cond) failures++; };
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true });

function watch(page) {
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("requestfailed", (r) => errors.push("request failed: " + r.url()));
  page.on("response", (r) => { if (r.status() >= 400) errors.push(r.status() + " " + r.url()); });
  return errors;
}

// Local-only contexts: serve a blank config.js so sign-in stays hidden (the real one has Supabase keys).
async function localOnly(ctx) {
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.STUDY_LAB_CONFIG={};" }));
}
const wrongIndex = (page) => page.evaluate(() => {
  const { state, QMAP } = window.__studyLab;
  const it = state.sess.items[state.sess.idx];
  return it.order.findIndex((o) => o !== QMAP[it.qid].c[0]);
});

// Rounds now mix formats. Tests about multiple choice call mcFirst() so the rest of the round starts with
// its multiple-choice questions (same questions, just reordered), keeping those checks deterministic.
async function mcFirst(page) {
  await page.locator("#q-stem").waitFor();
  await page.evaluate(() => {
    const { state, QMAP, render } = window.__studyLab;
    const s = state.sess, rest = s.items.slice(s.idx);
    const mc = (it) => !QMAP[it.qid].type;
    s.items = s.items.slice(0, s.idx).concat(rest.filter(mc), rest.filter((it) => !mc(it)));
    render(false, "stem");
  });
}
const quizType = (page) => page.evaluate(() => { const { state, QMAP } = window.__studyLab; const it = state.sess && state.sess.items[state.sess.idx]; return it ? QMAP[it.qid].type || "mc" : null; });
// Answer whatever is on screen (any format) and wait for the feedback. right=true answers correctly.
async function answerCurrent(page, right = false, tap = false) {
  const press = (loc) => (tap ? loc.tap() : loc.click());
  const type = await quizType(page);
  if (type === "mc") {
    const i = await page.evaluate((right) => { const { state, QMAP } = window.__studyLab; const it = state.sess.items[state.sess.idx]; const c = it.order.indexOf(QMAP[it.qid].c[0]); return right ? c : (c + 1) % it.order.length; }, right);
    await press(page.locator(".choice").nth(right === null ? 0 : i));
  } else if (type === "typed") {
    const a = await page.evaluate(() => { const { state, QMAP } = window.__studyLab; return String(QMAP[state.sess.items[state.sess.idx].qid].a[0]); });
    await page.locator("#typed-input").fill(right ? a : "zzqx");
    await press(page.locator('[data-action="submit"]'));
  } else if (type === "explain") {
    await page.locator("#explain-input").fill("my attempt");
    await press(page.locator('[data-action="reveal"]'));
    await press(page.locator(`[data-action="grade"][data-arg="${right ? "got" : "missed"}"]`));
  } else if (type === "order") {
    if (right) await page.evaluate(() => { const { state, QMAP, render } = window.__studyLab; const it = state.sess.items[state.sess.idx]; it.order = QMAP[it.qid].items.map((_, i) => i); render(); });
    await press(page.locator('[data-action="checkorder"]'));
  } else if (type === "match") {
    const n = await page.locator('[data-action="pick"][data-arg^="L:"]').count();
    for (let i = 0; i < n; i++) {
      await press(page.locator(`[data-action="pick"][data-arg="L:${i}"]`));
      await press(page.locator(`[data-action="pick"][data-arg="R:${right ? i : (i + 1) % n}"]`));
    }
    await press(page.locator('[data-action="checkmatch"]'));
  }
  await page.locator("#feedback").waitFor();
  return type;
}
async function answerRound(page, right = null) {
  let n = 0;
  while ((await page.locator("#q-stem").count()) && n < 25) {
    await answerCurrent(page, right === null ? n % 3 === 0 : right);
    await page.locator('[data-action="next"]').click();
    n++;
  }
  return n;
}

try {
  // ---- local-only mode ----
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await localOnly(ctx);
  const page = await ctx.newPage();
  const errors = watch(page);
  const lsatRequests = [];
  page.on("request", (r) => { if (/lsat\.js$/.test(r.url())) lsatRequests.push(r.url()); if (/supabase/.test(r.url())) lsatRequests.push(r.url()); });
  await page.goto(BASE);
  await page.locator(".subject").first().waitFor();
  check("home loads with 6 subject cards", (await page.locator(".subject").count()) === 6);
  check("home has a separate LSAT card", (await page.locator(".lsat-card").count()) === 1);
  check("header no longer says just 'Six subjects'", /plus LSAT prep/.test(await page.locator(".hero").innerText()));
  const nQ = await page.evaluate(() => window.__studyLab.QUESTIONS.length);
  check("home loads only the 384 core questions (LSAT bank lazy)", nQ === 384, "n=" + nQ);
  check("header counts all 449 questions", /449 questions/.test(await page.locator(".hero").innerText()));
  check("lsat.js and supabase-js not fetched on the home page", lsatRequests.length === 0, lsatRequests.join(","));
  check("#app is no longer a page-wide live region", (await page.locator("#app[aria-live]").count()) === 0);
  check("empty mastery bars hidden before any progress", (await page.locator(".subject .bar, .lsat-card .bar").count()) === 0);
  check("How it works open on a first desktop visit", await page.evaluate(() => document.getElementById("howto").open));
  check("six subject tiles rendered from engine data", (await page.locator(".subject[data-s]").count()) === 6);
  check("sign-in UI hidden when config.js is blank", (await page.locator("#email").count()) === 0);
  check("localStorage empty before answering", (await page.evaluate(() => localStorage.getItem("study-lab-progress-v1"))) === null);

  await page.locator('[data-arg="subject:math"]').click();
  await page.locator(".question").waitFor();
  check("quiz shows question 1 of 10", (await page.locator(".quiz-progress").innerText()).includes("1 / 10"));
  check("starting a round sets #math", (await page.evaluate(() => location.hash)) === "#math");
  check("focus moves to the question stem", (await page.evaluate(() => document.activeElement && document.activeElement.id)) === "q-stem");
  // Back before answering anything: straight home, no prompt
  let dialogs = 0;
  const onDialog = (d) => { dialogs++; d.dismiss(); };
  page.on("dialog", onDialog);
  await page.goBack();
  await page.locator(".subject").first().waitFor();
  check("Back with nothing answered returns home without a prompt", dialogs === 0 && (await page.evaluate(() => location.hash)) === "");
  page.off("dialog", onDialog);
  await page.locator('[data-arg="subject:math"]').click();
  await page.locator(".question").waitFor();
  await mcFirst(page);
  await page.locator('.segmented [data-arg="sure"]').click();
  await page.locator(".choice").nth(0).click();
  await page.locator(".callout").waitFor();
  const fb = await page.locator(".callout").innerText();
  check("feedback shown after answering", /Correct\.|Not quite\./.test(fb), JSON.stringify(fb.slice(0, 60)));
  check("correct answer highlighted", (await page.locator(".choice.correct").count()) === 1);
  check("feedback is the only live region (role=status)", (await page.locator(".callout[role=status]").count()) === 1 && (await page.locator("[aria-live=polite]").count()) === 0);
  check("focus moves to Next question after answering", (await page.evaluate(() => document.activeElement && document.activeElement.dataset.action)) === "next");
  check("Next question is described by the feedback", (await page.locator('[data-action="next"]').getAttribute("aria-describedby")) === "feedback");
  await page.evaluate(() => document.fonts.ready);
  check("theme fonts loaded (Inter, Inter Tight)", await page.evaluate(() => document.fonts.check('17px "Inter"') && document.fonts.check('600 24px "Inter Tight"')));
  check("old Garamond web fonts no longer requested", await page.evaluate(() => !document.querySelector('link[href*="Garamond"]')));
  await page.screenshot({ path: path.join(here, "screenshot-laptop-quiz.png") });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  check("answering updates localStorage", saved && saved.total === 1 && Object.keys(saved.cards).length === 1, JSON.stringify(saved && saved.cards));

  // keyboard: Enter for next, 1-4 to answer
  await page.keyboard.press("Enter");
  await page.locator(".choice:not(:disabled)").first().waitFor();
  check("Enter on the focused Next button advances exactly one question", (await page.locator(".quiz-progress").innerText()).includes("2 / 10"));
  await page.keyboard.press(String((await wrongIndex(page)) + 1));
  await page.locator(".callout").waitFor();
  check("keyboard answering works", (await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")).total)) === 2);
  check("a miss doesn't grow the round counter", (await page.locator('[data-action="next"]').click(), await page.locator(".quiz-progress").innerText()).includes("3 / 10"));
  // Back mid-round asks first; Cancel stays put
  page.once("dialog", (d) => { dialogs++; d.dismiss(); });
  await page.goBack();
  await page.waitForTimeout(300);
  check("Back mid-round asks for confirmation", dialogs === 1);
  check("Cancel keeps the round and its #hash", (await page.locator(".question").count()) === 1 && (await page.evaluate(() => location.hash)) === "#math");

  let sawSecondTry = false, maxOf = 0;
  for (let i = 0; i < 25 && (await page.locator("#q-stem").count()); i++) {
    const h = await page.locator(".quiz-progress").innerText();
    if (/Second try/.test(h)) sawSecondTry = true;
    const m = /\/ (\d+)/.exec(h); if (m) maxOf = Math.max(maxOf, Number(m[1]));
    await answerCurrent(page, i % 2 === 1);
    await page.locator('[data-action="next"]').click();
  }
  await page.locator("text=Round complete").waitFor();
  check("second tries are labelled 'Second try' and the total stays 10", sawSecondTry && maxOf === 10, "max=" + maxOf);
  check("round reaches summary", true);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  check("10 first-try answers recorded", st.total === 10, "total=" + st.total);

  await page.locator('[data-action="home"]').click();
  await page.reload();
  await page.locator(".subject").first().waitFor();
  const metricsText = await page.locator(".metrics").innerText();
  check("progress persists after reload", metricsText.includes("10 answered"));
  check("mastery chart shows only subjects with progress", (await page.locator(".hbar").count()) === 1);
  check("math card shows its mastery bar once studied", (await page.locator('.subject[data-s="math"] .bar').count()) === 1 && (await page.locator('.subject[data-s="sci"] .bar').count()) === 0);
  check("Today card shows a daily goal", /Daily goal/.test(await page.locator(".goal").innerText()));

  // mixed review interleaves
  await page.locator('[data-arg="mixed:all"]').click();
  await page.locator(".quiz .kicker").waitFor();
  check("mixed review starts", (await page.locator(".quiz .kicker").innerText()).length > 0);
  await page.locator('[data-action="end"]').click();

  // backup restore round trip
  await page.locator('[data-action="home"]').click().catch(() => {});
  check("Back to subjects returns home and clears the hash", (await page.locator(".subject").first().waitFor(), await page.evaluate(() => location.hash)) === "");
  await page.locator("#backup summary").click();
  check("backup code textarea has a label", (await page.evaluate(() => document.getElementById("backup-code").labels.length)) === 1);
  const code = await page.locator("#backup-code").inputValue();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#backup summary").click();
  await page.locator("#restore").fill(code);
  await page.locator('[data-action="restore"]').click();
  check("backup code restores progress", (await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")).total)) >= 10);
  check("no console errors (local mode)", errors.length === 0, errors.join(" | "));

  // ---- history, deep links, theme and saved progress ----
  const hctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await localOnly(hctx);
  const LIVE = { cards: { math0: { b: 3, due: 9e12, n: 2, k: 2, t: 1700000000000 }, lsat3: { b: 2, due: 4, n: 1, k: 1, t: 1700000002000 }, lsat27: { b: 5, due: 9e12, n: 4, k: 4, t: 1700000003000 } }, recent: { math: [1, 1], lsat: [1, 1, 1, 1, 0] }, days: ["2026-11-15"], total: 7, right: 6, updatedAt: 1700000003000 };
  const LIVE_JSON = JSON.stringify(LIVE);
  await hctx.addInitScript((v) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("study-lab-progress-v1", v); } }, LIVE_JSON);
  const hp = await hctx.newPage();
  const herr = watch(hp);
  await hp.goto(BASE);
  await hp.locator(".subject").first().waitFor();
  check("saved progress from the live site is left byte-for-byte untouched on load", (await hp.evaluate(() => localStorage.getItem("study-lab-progress-v1"))) === LIVE_JSON);
  check("saved LSAT progress counted on the home page without loading the LSAT bank", /2\/65 seen/i.test(await hp.locator(".lsat-card").innerText()) && (await hp.evaluate(() => window.__studyLab.QUESTIONS.length)) === 384);
  check("Due now is the same set on home: school subjects + LSAT noted", /\+ 1 LSAT/.test(await hp.locator(".metrics").first().innerText()));
  await hp.locator('[data-arg="subject:geo"]').click();
  await mcFirst(hp);
  await hp.locator(".choice").first().click();
  await hp.locator(".callout").waitFor();
  const afterAns = await hp.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  check("answering keeps every earlier card (incl. LSAT) unchanged", ["math0", "lsat3", "lsat27"].every((k) => JSON.stringify(afterAns.cards[k]) === JSON.stringify(LIVE.cards[k])) && afterAns.total === 8);
  hp.once("dialog", (d) => d.accept());
  await hp.goBack();
  await hp.locator(".subject").first().waitFor();
  check("Back mid-round + OK returns home (still on the site)", (await hp.evaluate(() => location.href)) === BASE);
  // deep link + refresh
  await hp.goto(BASE + "#sci");
  await hp.locator(".question").waitFor();
  check("deep link #sci opens a Science round", /Science practice/i.test(await hp.locator(".kicker").innerText()));
  await hp.reload();
  await hp.locator(".question").waitFor();
  check("refresh on #sci starts a fresh Science round", /Science practice/i.test(await hp.locator(".kicker").innerText()) && (await hp.evaluate(() => location.hash)) === "#sci");
  await hp.goBack();
  await hp.locator(".subject").first().waitFor();
  check("Back from a deep-linked round lands on the home page", (await hp.evaluate(() => location.href)) === BASE);
  await hp.goto(BASE + "#nonsense");
  await hp.locator(".subject").first().waitFor();
  check("unknown hash shows home and is cleared", (await hp.evaluate(() => location.hash)) === "");
  // summary consistency
  await hp.locator('[data-arg="subject:geo"]').click();
  await answerRound(hp);
  await hp.locator("text=Round complete").waitFor();
  const sumDue = await hp.locator(".metric", { hasText: "Due now" }).innerText();
  await hp.goBack();
  await hp.locator(".subject").first().waitFor();
  const homeDue = await hp.locator(".metric", { hasText: "Due now" }).innerText();
  check("summary 'Due now' matches the home 'Due now'", sumDue === homeDue, JSON.stringify([sumDue, homeDue]));
  // theme
  check("light theme by default (device not in dark mode), color-scheme light", (await hp.evaluate(() => getComputedStyle(document.documentElement).colorScheme)) === "light");
  await hp.locator("#theme-toggle").click();
  const lt = await hp.evaluate(() => ({ t: document.documentElement.dataset.theme, cs: getComputedStyle(document.documentElement).colorScheme, meta: document.querySelector('meta[name="theme-color"]').content, saved: localStorage.getItem("study-lab-theme"), pressed: document.getElementById("theme-toggle").getAttribute("aria-pressed") }));
  check("dark mode: data-theme dark, color-scheme dark, theme-color #000000, saved", lt.t === "dark" && lt.cs === "dark" && lt.meta === "#000000" && lt.saved === "dark" && lt.pressed === "true", JSON.stringify(lt));
  await hp.reload();
  await hp.locator(".subject").first().waitFor();
  check("dark mode persists across reloads", (await hp.evaluate(() => document.documentElement.dataset.theme)) === "dark");
  await hp.locator("#theme-toggle").click();
  check("toggle back to light (theme-color #f5f5f7)", (await hp.evaluate(() => document.documentElement.dataset.theme + " " + document.querySelector('meta[name="theme-color"]').content)) === "light #f5f5f7");
  check("progress format still the same keys", JSON.stringify(Object.keys(await hp.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")))).sort()) === JSON.stringify(Object.keys(LIVE).sort()));
  // ---- Menu (desktop) ----
  await hp.goto(BASE);
  await hp.locator(".subject").first().waitFor();
  const mstate = () => hp.evaluate(() => ({ exp: document.getElementById("menu-btn").getAttribute("aria-expanded"), hidden: document.getElementById("menu-panel").hidden, focus: document.activeElement.id || document.activeElement.className }));
  const m0 = await hp.evaluate(() => { const b = document.getElementById("menu-btn"); const r = b.getBoundingClientRect(); return { exp: b.getAttribute("aria-expanded"), ctl: b.getAttribute("aria-controls"), name: b.textContent.trim(), hidden: document.getElementById("menu-panel").hidden, left: r.left, svg: b.querySelector("svg").getAttribute("aria-hidden") }; });
  check("menu: 'Menu' button at the top left, aria-expanded=false, aria-controls the panel", m0.exp === "false" && m0.ctl === "menu-panel" && m0.name === "Menu" && m0.hidden && m0.left < 40 && m0.svg === "true", JSON.stringify(m0));
  await hp.mouse.move(700, 600);
  await hp.locator("#menu-btn").hover();
  await hp.waitForFunction(() => document.getElementById("menu-btn").getAttribute("aria-expanded") === "true");
  check("menu: hovering opens the dropdown", !(await mstate()).hidden);
  const outline = await hp.evaluate(() => {
    const items = [...document.querySelectorAll("#menu-panel .menu-item")].map((b) => ({ sub: b.classList.contains("sub"), label: b.textContent, id: b.dataset.target, exists: !!document.getElementById(b.dataset.target) }));
    const sections = [...document.querySelectorAll("#app > *")].filter((el) => el.querySelector("h2") && el.tagName !== "FOOTER").length;
    const tiles = [...document.querySelectorAll("#subjects h3")].map((h) => h.textContent.trim());
    return { items, sections, tiles };
  });
  const tops = outline.items.filter((x) => !x.sub).map((x) => x.label);
  const subjSubs = []; { let inS = false; for (const x of outline.items) { if (!x.sub) inS = x.label === "Subjects"; else if (inS) subjSubs.push(x.label); } }
  check("menu: one entry per page section, in page order", tops.length === outline.sections && JSON.stringify(tops) === JSON.stringify(["Today", "Subjects", "LSAT prep", "Mastery by subject", "How it works", "Backup and reset"]), JSON.stringify(tops));
  check("menu: subjects indented under Subjects, read from their h3s", JSON.stringify(subjSubs) === JSON.stringify(outline.tiles) && subjSubs.length === 6, JSON.stringify(subjSubs));
  check("menu: How it works lists its 8 steps (incl. Question formats); every entry points at a real id", outline.items.filter((x) => x.sub && x.id.startsWith("howto-")).length === 8 && outline.items.every((x) => x.exists));
  await hp.mouse.move(700, 700);
  await hp.waitForTimeout(120);
  const stillOpen = !(await mstate()).hidden;
  await hp.waitForTimeout(500);
  check("menu: leaving it closes after a short delay (no flicker)", stillOpen && (await mstate()).hidden);
  // keyboard
  await hp.locator("#menu-btn").focus();
  await hp.keyboard.press("ArrowDown");
  const k1 = await hp.evaluate(() => ({ exp: document.getElementById("menu-btn").getAttribute("aria-expanded"), f: document.activeElement.textContent }));
  await hp.keyboard.press("ArrowDown");
  const k2 = await hp.evaluate(() => document.activeElement.textContent);
  await hp.keyboard.press("End");
  const k3 = await hp.evaluate(() => document.activeElement.textContent);
  await hp.keyboard.press("Escape");
  const k4 = await mstate();
  check("menu keys: ArrowDown opens on the first entry, arrows/End move, Escape closes and returns focus", k1.exp === "true" && k1.f === "Today" && k2 === "Subjects" && k3 === "Backup and reset" && k4.hidden && k4.focus === "menu-btn", JSON.stringify([k1, k2, k3, k4]));
  await hp.keyboard.press("Enter");
  const k5 = await mstate();
  await hp.keyboard.press("Tab");
  const k6 = await hp.evaluate(() => document.activeElement.className);
  for (let i = 0; i < 25 && (await hp.evaluate(() => document.getElementById("menu-panel").contains(document.activeElement))); i++) await hp.keyboard.press("Tab");
  check("menu keys: Enter toggles it open, Tab walks the entries, tabbing out closes it", !k5.hidden && /menu-item/.test(k6) && (await mstate()).hidden, JSON.stringify([k5, k6]));
  await hp.locator("#menu-btn").click();
  check("menu: click opens it (pinned)", !(await mstate()).hidden);
  await hp.mouse.click(1000, 500);
  check("menu: clicking outside closes it", (await mstate()).hidden);
  await hp.locator("#menu-btn").click();
  await hp.locator("#menu-panel .menu-item", { hasText: "Backup and reset" }).click();
  await hp.waitForFunction(() => Math.abs(document.getElementById("backup").getBoundingClientRect().top - document.getElementById("nav").getBoundingClientRect().height - 16) < 3 || innerHeight + scrollY >= document.documentElement.scrollHeight - 2);
  const jump = await hp.evaluate(() => ({ open: document.getElementById("backup").open, top: document.getElementById("backup").getBoundingClientRect().top, nav: document.getElementById("nav").getBoundingClientRect().height, f: document.activeElement.textContent, hidden: document.getElementById("menu-panel").hidden }));
  check("menu: choosing an entry scrolls below the sticky bar, opens it, focuses its heading, closes", jump.open && jump.top >= jump.nav && jump.f === "Backup and reset" && jump.hidden, JSON.stringify(jump));
  await hp.evaluate(() => { document.getElementById("backup").open = false; });
  await hp.evaluate(() => document.getElementById("subjects").scrollIntoView());
  await hp.evaluate(() => window.scrollBy(0, -10)); // scroll-margin puts the heading 16px under the bar; nudge a little above that
  await hp.locator("#menu-btn").click();
  const cur = await hp.evaluate(() => [...document.querySelectorAll('#menu-panel [aria-current="location"]')].map((b) => b.textContent));
  check("menu: highlights the section you are reading", JSON.stringify(cur) === JSON.stringify(["Subjects"]), JSON.stringify(cur));
  await hp.keyboard.press("Escape");
  // during a round: the home sections, a warning, keys stay with the menu, quiz shortcuts still work
  await hp.locator('[data-arg="subject:geo"]').click();
  await mcFirst(hp);
  await hp.locator(".choice").first().click();
  await hp.locator(".callout").waitFor();
  await hp.locator('[data-action="next"]').click();
  await hp.locator("#q-stem").waitFor();
  await hp.locator("#menu-btn").focus();
  await hp.keyboard.press("ArrowDown");
  const rq = await hp.evaluate(() => ({ note: document.querySelector(".menu-note").hidden ? "" : document.querySelector(".menu-note").textContent, n: document.querySelectorAll("#menu-panel .menu-item").length, first: document.activeElement.textContent }));
  await hp.keyboard.press("2");
  const pickedInMenu = await hp.evaluate(() => window.__studyLab.state.sess.picked);
  await hp.keyboard.press("Escape");
  await hp.mouse.click(5, 400);
  await hp.keyboard.press("2");
  const pickedAfter = await hp.evaluate(() => window.__studyLab.state.sess.picked);
  check("menu in a round: lists the home sections with a 'ends this round' note", rq.n === outline.items.length && /ends this round/.test(rq.note) && rq.first === "Today", JSON.stringify(rq));
  check("menu in a round: number keys inside the menu don't answer; after closing, shortcuts work", pickedInMenu === null && pickedAfter === 1, JSON.stringify([pickedInMenu, pickedAfter]));
  await hp.locator('[data-action="next"]').click();
  await hp.locator("#q-stem").waitFor();
  let menuAsk = "";
  hp.once("dialog", (d) => { menuAsk = d.message(); d.dismiss(); });
  await hp.locator("#menu-btn").click();
  await hp.locator("#menu-panel .menu-item", { hasText: "LSAT prep" }).click();
  await hp.waitForTimeout(150);
  check("menu in a round: asks before leaving; Cancel keeps the round and returns focus", /leave/i.test(menuAsk) && (await hp.locator(".question").count()) === 1 && (await mstate()).focus === "menu-btn", menuAsk);
  hp.once("dialog", (d) => d.accept());
  await hp.locator("#menu-btn").click();
  await hp.locator("#menu-panel .menu-item", { hasText: "LSAT prep" }).click();
  await hp.locator(".subject").first().waitFor();
  await hp.waitForTimeout(1200); // smooth scroll
  const landed = await hp.evaluate(() => ({ t: document.querySelector(".lsat-card").getBoundingClientRect().top, end: innerHeight + scrollY >= document.documentElement.scrollHeight - 2, y: scrollY, f: document.activeElement.id, h: location.href }));
  // (a short page can't bring the card all the way up; then the page must be at its end with the card on screen)
  check("menu in a round + OK: home, scrolled to LSAT prep", landed.h === BASE && landed.f === "lsat-title" && ((landed.t > 52 && landed.t < 120) || (landed.end && landed.t > 52 && landed.t < 700)), JSON.stringify(landed));
  check("no console errors (history/theme)", herr.length === 0, herr.join(" | "));

  // dark mode follows the device until the reader picks one
  const dctx = await browser.newContext({ colorScheme: "dark" });
  await localOnly(dctx);
  const dp = await dctx.newPage();
  await dp.goto(BASE); await dp.locator(".subject").first().waitFor();
  check("device in dark mode: site opens in dark mode with theme-color #000000", (await dp.evaluate(() => document.documentElement.dataset.theme + " " + document.querySelector('meta[name="theme-color"]').content)) === "dark #000000");
  await dctx.close();

  // ---- LSAT on a laptop-sized screen ----
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await localOnly(lctx);
  const lp = await lctx.newPage();
  const lerr = watch(lp);
  await lp.goto(BASE);
  await lp.locator(".lsat-card").waitFor();
  await lp.evaluate(() => document.fonts.ready);
  await lp.screenshot({ path: path.join(here, "screenshot-laptop-home.png"), fullPage: true });
  await lp.locator('[data-arg="lsat-short:lsat"]').click();
  await lp.locator(".question.stem").waitFor();
  await mcFirst(lp);
  check("LSAT short: question 1 of 10", (await lp.locator(".quiz-progress").innerText()).includes("1 / 10"));
  check("LSAT bank loaded on demand (449 questions)", (await lp.evaluate(() => window.__studyLab.QUESTIONS.length)) === 449);
  check("LSAT round hash is #lsat/short", (await lp.evaluate(() => location.hash)) === "#lsat/short");
  const letters = await lp.locator(".choice .letter").allInnerTexts();
  check("LSAT short: five choices lettered A-E", letters.join("") === "ABCDE", letters.join(""));
  check("LSAT short: stimulus shown, no passage panel", (await lp.locator(".stim").count()) === 1 && (await lp.locator(".passage").count()) === 0);
  check("LSAT short: keyboard tip mentions 1 to 5", /1 to 5/.test(await lp.locator(".hide-touch").innerText()));
  await lp.keyboard.press("5");
  await lp.locator(".callout").waitFor();
  const lfb = await lp.locator(".callout").innerText();
  check("LSAT: key 5 answers choice E", (await lp.locator(".choice").nth(4).getAttribute("class")).match(/correct|wrong/) !== null);
  check("LSAT feedback reads 'The answer is (X)'", /The answer is \([A-E]\)\./.test(lfb), JSON.stringify(lfb.slice(0, 80)));
  check("LSAT feedback has a 'Tempting but wrong' line", /Tempting but wrong: \([A-E]\)/.test(lfb));
  const lst = await lp.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  check("LSAT answer saved under an lsat id", Object.keys(lst.cards).every((k) => k.startsWith("lsat")) && lst.total === 1);
  await lp.keyboard.press("Enter");
  await lp.locator(".choice:not(:disabled)").first().waitFor();
  await lp.keyboard.press("c");
  await lp.locator(".callout").waitFor();
  check("LSAT: letter keys answer too", (await lp.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")).total)) === 2);
  await lp.locator('[data-action="next"]').click();
  await answerRound(lp);
  await lp.locator("text=Round complete").waitFor();
  check("LSAT short round reaches summary", true);
  check("summary offers another LSAT round", (await lp.locator('[data-action="again"]').innerText()).includes("LSAT"));

  // long round: passage beside the questions and staying on screen
  await lp.locator('[data-action="home"]').click();
  await lp.locator('[data-arg="lsat-long:lsat"]').click();
  await lp.locator(".passage-body").waitFor();
  const pBox = await lp.locator(".passage").boundingBox();
  const qBox = await lp.locator(".split-main .quiz").boundingBox();
  check("LSAT long: passage panel sits beside the question on wide screens", pBox.x + pBox.width <= qBox.x + 1 && Math.abs(pBox.y - qBox.y) < 200, JSON.stringify({ p: pBox.x, q: qBox.x }));
  check("LSAT long: wide layout used", (await lp.locator("#app.wide").count()) === 1);
  const setLen = await lp.evaluate(() => window.__studyLab.state.sess.items.length);
  check("LSAT long: one passage set of 5-6 questions", setLen >= 5 && setLen <= 6, "n=" + setLen);
  await lp.mouse.wheel(0, 2000);
  await lp.waitForTimeout(300);
  const pAfter = await lp.locator(".passage").boundingBox();
  check("LSAT long: whole passage panel stays on screen while scrolling", pAfter.y >= 0 && pAfter.y + pAfter.height <= 801, "y=" + pAfter.y + " h=" + pAfter.height);
  await lp.evaluate(() => { const b = document.querySelector(".passage-body"); b.scrollTop = 120; });
  await lp.locator(".choice").first().click();
  await lp.locator(".callout").waitFor();
  await lp.mouse.wheel(0, 3000);
  await lp.waitForTimeout(300);
  const pFb = await lp.locator(".passage").boundingBox();
  check("LSAT long: passage panel still on screen with feedback open", pFb.y >= 0 && pFb.y + pFb.height <= 801, "y=" + pFb.y + " h=" + pFb.height);
  check("LSAT long: passage scroll kept after answering", (await lp.evaluate(() => document.querySelector(".passage-body").scrollTop)) > 50);
  const clip = await lp.evaluate(() => {
    const b = document.querySelector(".passage-body");
    b.scrollTop = b.scrollHeight;
    const last = b.querySelector("p:last-of-type"), br = b.getBoundingClientRect(), lr = last.getBoundingClientRect();
    return { lastBottom: lr.bottom, bodyBottom: br.bottom, fade: 32, view: innerHeight, panel: document.querySelector(".passage").getBoundingClientRect().bottom };
  });
  check("LSAT desktop: last passage line fully visible above the fade when scrolled to the end", clip.lastBottom <= clip.bodyBottom - clip.fade + 1 && clip.panel <= clip.view, JSON.stringify(clip));
  check("LSAT desktop: no sticky bar or peek on wide screens", !(await lp.locator(".lsat-bar").isVisible()) && (await lp.locator(".passage.open").count()) === 1);
  check("LSAT desktop: no stray +/− marker on the passage heading", (await lp.evaluate(() => getComputedStyle(document.querySelector(".passage-head h2"), "::after").content)) === "none");
  await lp.evaluate(() => { document.querySelector(".passage-body").scrollTop = 0; window.scrollTo(0, 0); });
  await lp.screenshot({ path: path.join(here, "screenshot-laptop-lsat-passage.png") });
  await lp.locator('[data-action="next"]').click();
  check("LSAT long: same passage on question 2", (await lp.locator(".passage").count()) === 1);
  await lp.locator('[data-action="end"]').click();

  // pace timer: counts up, never ends the question
  await lp.locator('[data-action="home"]').click();
  await lp.locator('[data-action="timer"]').click();
  check("timer toggle turns on and persists", (await lp.evaluate(() => localStorage.getItem("study-lab-lsat-timer"))) === "1");
  await lp.locator('[data-arg="lsat-short:lsat"]').click();
  await lp.locator("#pace").waitFor();
  const t1 = await lp.locator("#pace").innerText();
  await lp.waitForTimeout(2200);
  const t2 = await lp.locator("#pace").innerText();
  check("timer counts up", t1 !== t2 && /\/ 1:25/.test(t2), t1 + " -> " + t2);
  check("timer does not answer for you", (await lp.locator(".callout").count()) === 0);
  await lp.locator('[data-action="end"]').click().catch(() => {});

  // Mixed review never serves LSAT
  await lp.locator('[data-action="home"]').click().catch(() => {});
  await lp.locator('[data-arg="mixed:all"]').click();
  await lp.locator(".quiz .kicker").waitFor();
  const mixedSubjects = await lp.evaluate(() => window.__studyLab.state.sess.items.map((i) => i.qid));
  check("Mixed review contains no LSAT questions", mixedSubjects.every((id) => !id.startsWith("lsat")), mixedSubjects.join(","));
  await lp.locator('[data-action="end"]').click();
  check("no console errors (LSAT laptop)", lerr.length === 0, lerr.join(" | "));

  // ---- phone layout ----
  const phone = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  await localOnly(phone);
  const pp = await phone.newPage();
  const perr = watch(pp);
  await pp.goto(BASE);
  await pp.locator(".subject").first().waitFor();
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no horizontal overflow on home", overflow <= 0, "overflow=" + overflow);
  check("phone: How it works folded to a teaser on a first visit", (await pp.evaluate(() => document.getElementById("howto").open)) === false && (await pp.locator("#howto .teaser").isVisible()));
  check("phone: short tagline", (await pp.locator(".tagline-short").isVisible()) && !(await pp.locator(".tagline-long").isVisible()));
  await pp.locator("#howto summary").tap();
  await pp.waitForFunction(() => localStorage.getItem("study-lab-howto") === "1");
  await pp.reload(); await pp.locator(".subject").first().waitFor();
  check("phone: How it works remembers being opened", await pp.evaluate(() => document.getElementById("howto").open));
  await pp.evaluate(() => document.fonts.ready);
  await pp.screenshot({ path: path.join(here, "screenshot-phone-home.png"), fullPage: false });
  await pp.locator('[data-arg="subject:hist"]').tap();
  await mcFirst(pp);
  await pp.locator(".choice").first().tap();
  await pp.locator(".callout").waitFor();
  const overflowQ = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no horizontal overflow in quiz", overflowQ <= 0, "overflow=" + overflowQ);
  await pp.screenshot({ path: path.join(here, "screenshot-phone-quiz.png"), fullPage: true });
  // LSAT long round on a phone: passage above the questions and folds away
  await pp.goto(BASE);
  await pp.locator('[data-arg="lsat-long:lsat"]').tap();
  await pp.locator(".passage-body").waitFor();
  const ppBox = await pp.locator(".passage").boundingBox();
  const pqBox = await pp.locator(".split-main .quiz").boundingBox();
  check("phone LSAT: passage starts as a short peek", ppBox.height < 400 && (await pp.locator(".passage.peek").count()) === 1, "h=" + ppBox.height);
  check("phone LSAT: question card starts within the first screen", pqBox.y < 740, "y=" + pqBox.y);
  check("phone LSAT: sticky bar shows 'Q 1 of N' and Show passage", /Q 1 of \d/.test(await pp.locator(".lsat-bar").innerText()) && /Show passage/.test(await pp.locator(".lsat-bar").innerText()));
  await pp.evaluate(() => document.fonts.ready);
  await pp.screenshot({ path: path.join(here, "screenshot-phone-lsat-passage.png") });
  await pp.locator(".lsat-bar [data-action=passage]").tap();
  const openH = (await pp.locator(".passage").boundingBox()).height;
  check("phone LSAT: Show passage opens it in full", (await pp.locator(".passage.open").count()) === 1 && openH > 1200, "h=" + openH);
  await pp.mouse.wheel(0, 900); await pp.evaluate(() => window.scrollBy(0, 900)); await pp.waitForTimeout(200);
  const barTop = await pp.evaluate(() => document.querySelector(".lsat-bar").getBoundingClientRect().top - document.getElementById("nav").getBoundingClientRect().bottom);
  check("phone LSAT: bar stays stuck right under the top bar while reading", Math.abs(barTop) <= 1, "gap=" + barTop);
  await pp.locator(".lsat-bar [data-action=passage]").tap();
  check("phone LSAT: Hide passage folds it back to a peek", (await pp.locator(".passage.peek").count()) === 1);
  await pp.locator(".choice").first().tap();
  await pp.locator(".callout").waitFor();
  check("phone LSAT: passage stays folded after answering", (await pp.locator(".passage.peek").count()) === 1);
  const overflowL = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone LSAT: no horizontal overflow", overflowL <= 0, "overflow=" + overflowL);
  await pp.screenshot({ path: path.join(here, "screenshot-phone-lsat.png"), fullPage: true });
  check("no console errors (phone)", perr.length === 0, perr.join(" | "));

  // ---- Menu on a 390px phone, with reduced motion ----
  const mphone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: "reduce" });
  await localOnly(mphone);
  const mp = await mphone.newPage();
  const mperr = watch(mp);
  const fit = () => mp.evaluate(() => {
    const r = (s) => document.querySelector(s).getBoundingClientRect();
    const slot = document.getElementById("nav-slot"), m = r("#menu-btn"), w = r(".wordmark"), t = r("#theme-toggle");
    const s = slot.hidden ? null : slot.getBoundingClientRect();
    return { a: w.left - m.right, b: (s ? s.left : t.left) - w.right, c: s ? t.left - s.right : 99, right: t.right, h: Math.max(m.height, s ? s.height : 0, t.height), slot: slot.hidden ? "" : slot.textContent };
  });
  await mp.goto(BASE);
  await mp.locator(".subject").first().waitFor();
  const pf = await fit();
  check("390px: Menu, wordmark and theme toggle fit on one line (no separate Subjects jump)", pf.slot === "" && pf.a >= 6 && pf.b >= 6 && pf.c >= 0 && pf.right <= 375 && pf.h < 40, JSON.stringify(pf));
  await mp.locator("#menu-btn").tap();
  const sheet = await mp.evaluate(() => { const p = document.getElementById("menu-panel"), r = p.getBoundingClientRect(); return { left: r.left, width: r.width, top: r.top, bottom: r.bottom, scrolls: p.scrollHeight > p.clientHeight, oy: getComputedStyle(p).overflowY, exp: document.getElementById("menu-btn").getAttribute("aria-expanded") }; });
  check("390px: tapping opens a full-width sheet under the bar that scrolls", sheet.exp === "true" && sheet.left === 0 && sheet.width === 390 && sheet.top >= 51 && sheet.bottom <= 844 && sheet.oy === "auto", JSON.stringify(sheet));
  await mp.locator("#menu-panel .menu-item", { hasText: "Second tries" }).tap();
  const inst = await mp.evaluate(() => ({ top: document.getElementById("howto-second-tries").closest("li").getBoundingClientRect().top, open: document.getElementById("howto").open, end: innerHeight + scrollY >= document.documentElement.scrollHeight - 2 }));
  check("390px + reduced motion: entry jumps there instantly and opens How it works", inst.open && ((inst.top >= 52 && inst.top < 120) || (inst.end && inst.top > 52 && inst.top < 844)), JSON.stringify(inst));
  await mp.goto(BASE + "#math");
  await mp.locator(".question").waitFor();
  const pr = await fit();
  check("390px round: Menu, wordmark, 'End round' and toggle still fit", pr.slot === "End round" && pr.a >= 6 && pr.b >= 6 && pr.right <= 375 && pr.h < 40, JSON.stringify(pr));
  check("no console errors (menu phone)", mperr.length === 0, mperr.join(" | "));
  await mphone.close();

  // ---- sync mode with a fake Supabase ----
  const fake = `
    const db = window.__fakeDb = { row: { user_id: "u1", data: { cards: { geo0: { b: 5, due: 9e12, n: 3, k: 3, t: 1 } }, recent: { geo: [1,1,1] }, days: ["2026-01-01"], total: 3, right: 3, updatedAt: 1 } }, upserts: 0 };
    const user = { id: "u1", email: "liam@example.com" };
    export function createClient() {
      return {
        auth: {
          onAuthStateChange(cb) { setTimeout(() => cb("INITIAL_SESSION", { user }), 0); return { data: { subscription: { unsubscribe() {} } } }; },
          async getSession() { return { data: { session: { user } } }; },
          async signInWithOtp() { return { error: null }; },
          async signOut() { return { error: null }; },
        },
        from() {
          return {
            select() { return { eq() { return { async maybeSingle() { return { data: db.row ? { data: db.row.data } : null, error: null }; } }; } }; },
            async upsert(row) { db.row = JSON.parse(JSON.stringify(row)); db.upserts++; return { error: null }; },
          };
        },
      };
    }`;
  const sctx = await browser.newContext();
  await sctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.STUDY_LAB_CONFIG={SUPABASE_URL:"https://example.supabase.co",SUPABASE_ANON_KEY:"test"};' }));
  await sctx.route("https://cdn.jsdelivr.net/**", (r) => r.fulfill({ contentType: "text/javascript", body: fake, headers: { "access-control-allow-origin": "*" } }));
  const sp = await sctx.newPage();
  const serr = watch(sp);
  await sp.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("study-lab-progress-v1", JSON.stringify({ cards: { math0: { b: 2, due: 9e12, n: 1, k: 1, t: 5 } }, recent: { math: [1] }, days: ["2026-11-16"], total: 1, right: 1, updatedAt: 5 }));
      localStorage.setItem("sb-example-auth-token", "{}"); // what supabase-js saves for a signed-in browser
    }
  });
  await sp.goto(BASE);
  await sp.locator("text=Signed in as").waitFor({ timeout: 5000 });
  await sp.locator("text=Synced at").waitFor({ timeout: 5000 });
  const merged = await sp.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  check("sync: sign-in UI shown when configured", true);
  check("sync: merge keeps local and remote progress", !!merged.cards.math0 && !!merged.cards.geo0, Object.keys(merged.cards).join(","));
  const remote = await sp.evaluate(() => window.__fakeDb.row.data);
  check("sync: merged state written back to account", !!remote.cards.math0 && !!remote.cards.geo0);
  await sp.locator('[data-arg="subject:eng"]').click();
  await mcFirst(sp);
  await sp.locator(".choice").first().click();
  await sp.waitForFunction(() => Object.keys(window.__fakeDb.row.data.cards).some((k) => k.startsWith("eng")), null, { timeout: 6000 });
  check("sync: new answers pushed to account", true);
  check("no console errors (sync mode)", serr.length === 0, serr.join(" | "));

  // signed out: supabase-js is fetched only when the Sync section is used
  const octx = await browser.newContext();
  await octx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'window.STUDY_LAB_CONFIG={SUPABASE_URL:"https://example.supabase.co",SUPABASE_ANON_KEY:"test"};' }));
  let cdnHits = 0;
  await octx.route("https://cdn.jsdelivr.net/**", (r) => { cdnHits++; r.fulfill({ contentType: "text/javascript", body: fake.replace("cb(\"INITIAL_SESSION\", { user })", "cb(\"INITIAL_SESSION\", null)").replace("return { data: { session: { user } } }", "return { data: { session: null } }"), headers: { "access-control-allow-origin": "*" } }); });
  const op = await octx.newPage();
  const oerr = watch(op);
  await op.goto(BASE);
  await op.locator("#email").waitFor();
  await op.waitForTimeout(400);
  check("sync: supabase-js not loaded on startup without a saved session", cdnHits === 0);
  await op.locator("#email").focus();
  await op.waitForTimeout(400);
  check("sync: supabase-js loads when the Sync section is used", cdnHits === 1);
  await op.locator("#email").fill("liam@example.com");
  await op.locator('[data-action="signin"]').click();
  await op.locator("text=Check liam@example.com").waitFor({ timeout: 4000 });
  check("sync: sign-in link flow still works after lazy load", true);
  check("#email input has a label", (await op.evaluate(() => document.getElementById("email").labels.length)) === 1);
  check("no console errors (signed-out sync)", oerr.length === 0, oerr.join(" | "));

  // ---- new question formats: recall, explain why, put in order, match, reading sets ----
  const tctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await localOnly(tctx);
  await tctx.addInitScript((v) => { if (!sessionStorage.getItem("seeded")) { sessionStorage.setItem("seeded", "1"); localStorage.setItem("study-lab-progress-v1", v); } }, LIVE_JSON);
  const tp = await tctx.newPage();
  const terr = watch(tp);
  await tp.goto(BASE);
  await tp.locator(".subject").first().waitFor();
  const startIds = async (pg, key, ids) => { await pg.evaluate(([key, ids]) => window.__studyLab.start("subject", [key], { ids }), [key, ids]); await pg.locator("#q-stem").waitFor(); };
  const readStore = (pg) => pg.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  const active = (pg) => pg.evaluate(() => { const a = document.activeElement; return { id: a.id, action: a.dataset.action || "", arg: a.dataset.arg || "", label: a.getAttribute("aria-label") || "" }; });
  check("formats: every school subject has recall, explain, order, match and reading questions", await tp.evaluate(() => {
    const { QUESTIONS } = window.__studyLab;
    return ["math", "sci", "hist", "geo", "eng", "econ"].every((s) => ["typed", "explain", "order", "match"].every((t) => QUESTIONS.some((q) => q.s === s && q.type === t)) && QUESTIONS.some((q) => q.s === s && q.p));
  }));

  // Recall (typed): type from anywhere, Enter checks, small typos accepted, override, blank answers
  await startIds(tp, "sci", ["sci-x0", "math-x0", "sci-x3"]);
  check("recall: kicker labels the format 'Recall' and the input has a label", /Recall/i.test(await tp.locator(".quiz .kicker").innerText()) && (await tp.evaluate(() => document.getElementById("typed-input").labels.length)) === 1);
  check("recall: confidence buttons still offered", (await tp.locator('.segmented [data-action="conf"]').count()) === 3);
  await tp.keyboard.press("m");
  check("recall: typing from anywhere jumps into the answer box (first key kept)", (await active(tp)).id === "typed-input" && (await tp.locator("#typed-input").inputValue()) === "m");
  await tp.keyboard.type("itochondira");
  await tp.keyboard.press("Enter");
  await tp.locator("#feedback").waitFor();
  check("recall: Enter checks; a small typo counts, with the right spelling shown", /Correct, allowing for spelling/.test(await tp.locator("#feedback").innerText()) && /mitochondria/.test(await tp.locator("#feedback").innerText()));
  check("recall: focus moves to Next after checking", (await active(tp)).action === "next");
  let sv = await readStore(tp);
  check("recall: answer saved as a normal card", sv.cards["sci-x0"] && sv.cards["sci-x0"].k === 1 && sv.total === 8, JSON.stringify(sv.cards["sci-x0"]));
  await tp.keyboard.press("Enter");
  await tp.locator("#typed-input:not([readonly])").waitFor();
  await tp.locator("#typed-input").focus();
  await tp.keyboard.type("8");
  check("recall: number keys type into the box instead of answering", (await tp.locator("#typed-input").inputValue()) === "8" && (await tp.evaluate(() => window.__studyLab.state.sess.picked)) === null);
  await tp.keyboard.press("Enter");
  await tp.locator("#feedback").waitFor();
  check("recall: a wrong answer shows the answer and an 'I was right' override", /Not quite\. The answer is 9/.test(await tp.locator("#feedback").innerText()) && (await tp.locator('[data-action="override"]').count()) === 1);
  const retriesBefore = await tp.evaluate(() => window.__studyLab.state.sess.items.length);
  await tp.locator('[data-action="override"]').click();
  sv = await readStore(tp);
  check("recall: override counts it as right without double counting, and drops the second try", /Counted as right/.test(await tp.locator("#feedback").innerText()) && sv.cards["math-x0"].k === 1 && sv.cards["math-x0"].n === 1 && sv.total === 9 && sv.right === 9 && (await tp.evaluate(() => window.__studyLab.state.sess.items.length)) === retriesBefore - 1, JSON.stringify([sv.cards["math-x0"], sv.total, sv.right]));
  await tp.locator('[data-action="next"]').click();
  await tp.locator('[data-action="submit"]').click();
  await tp.locator("#feedback").waitFor();
  check("recall: a blank answer is a miss with no override", /No answer this time/.test(await tp.locator("#feedback").innerText()) && (await tp.locator('[data-action="override"]').count()) === 0);
  await tp.locator('[data-action="end"]').click().catch(() => {});

  // Explain why: write, Ctrl+Enter shows the model answer, 1/2/3 self-grade, Partly = guess strength
  await startIds(tp, "math", ["math-x5", "math-x6"]);
  check("explain: labelled 'Explain why', no confidence question, textarea labelled", /Explain why/i.test(await tp.locator(".quiz .kicker").innerText()) && (await tp.locator('.segmented [data-action="conf"]').count()) === 0 && (await tp.evaluate(() => document.getElementById("explain-input").labels.length)) === 1);
  await tp.locator("#explain-input").focus();
  await tp.keyboard.type("Because 1 2 3 halves fit");
  check("explain: number keys type into the explanation, not grade it", (await tp.locator("#explain-input").inputValue()) === "Because 1 2 3 halves fit" && (await tp.locator(".model").count()) === 0);
  await tp.keyboard.press("Control+Enter");
  await tp.locator(".model").waitFor();
  check("explain: Ctrl+Enter shows your text beside the model answer and key points", /Because 1 2 3 halves fit/.test(await tp.locator(".mine").innerText()) && (await tp.locator(".keypoints li").count()) >= 2);
  check("explain: focus moves to the first self-grade button", (await active(tp)).action === "grade");
  await tp.keyboard.press("2");
  await tp.locator("#feedback").waitFor();
  sv = await readStore(tp);
  check("explain: key 2 = Partly, saved at guess strength (box 1, back within a day)", /Partly/.test(await tp.locator("#feedback").innerText()) && sv.cards["math-x5"].b <= 1 && sv.cards["math-x5"].due - Date.now() < 864e5, JSON.stringify(sv.cards["math-x5"]));
  await tp.keyboard.press("Enter");
  await tp.locator('[data-action="reveal"]').click();
  await tp.locator(".model").waitFor();
  check("explain: an empty attempt still shows the model answer", /nothing this time/.test(await tp.locator(".mine").innerText()));
  await tp.keyboard.press("1");
  await tp.locator("#feedback").waitFor();
  sv = await readStore(tp);
  check("explain: key 1 = I had it, counted right", sv.cards["math-x6"].k === 1);
  await tp.locator('[data-action="end"]').click().catch(() => {});

  // Put in order: arrow buttons, focus follows the moved item, live status, check
  await startIds(tp, "hist", ["hist-x7"]);
  const nItems = await tp.locator(".order-row").count();
  check("order: labelled 'Put in order', 3+ rows, each with labelled up/down buttons", /Put in order/i.test(await tp.locator(".quiz .kicker").innerText()) && nItems >= 3 && (await tp.locator('.order-row [data-action="move"][aria-label^="Move "]').count()) === nItems * 2);
  check("order: first up and last down are disabled", await tp.evaluate(() => { const b = document.querySelectorAll('[data-action="move"]'); return b[0].disabled && b[b.length - 1].disabled; }));
  const firstDown = tp.locator('.order-row [data-action="move"][data-arg$=":down"]').first();
  const movedV = (await firstDown.getAttribute("data-arg")).split(":")[0];
  await firstDown.focus();
  await tp.keyboard.press("Enter");
  const afterMove = await tp.evaluate(() => window.__studyLab.state.sess.items[0].order);
  const fa = await active(tp);
  check("order: keyboard move swaps the item down and keeps focus on it", afterMove[1] === Number(movedV) && fa.action === "move" && fa.arg.startsWith(movedV + ":"), JSON.stringify(fa));
  check("order: the move is announced", /now 2 of/.test(await tp.locator("#order-status").innerText()));
  // Sort it with the buttons
  for (let p = 0; p < nItems; p++) {
    for (let g = 0; g < nItems; g++) {
      const o = await tp.evaluate(() => window.__studyLab.state.sess.items[0].order);
      if (o.indexOf(p) <= p) break;
      await tp.locator(`[data-action="move"][data-arg="${p}:up"]`).click();
    }
  }
  await tp.locator('[data-action="checkorder"]').click();
  await tp.locator("#feedback").waitFor();
  check("order: sorted with the buttons and graded correct", /Correct order/.test(await tp.locator("#feedback").innerText()) && (await tp.locator(".order-row.ok").count()) === nItems);
  await tp.locator('[data-action="end"]').click().catch(() => {});
  await startIds(tp, "hist", ["hist-x8"]);
  await tp.locator('[data-action="checkorder"]').click();
  await tp.locator("#feedback").waitFor();
  check("order: an unsorted check shows how many were in place and the right order", /in the right place/.test(await tp.locator("#feedback").innerText()) && (await tp.locator("#feedback .answer-list li").count()) === (await tp.locator(".order-row").count()));
  await tp.locator('[data-action="end"]').click().catch(() => {});

  // Match: tap-to-pair, keyboard, aria-pressed, live status, Check disabled until every term is paired
  await startIds(tp, "geo", ["geo-x9"]);
  const nPairs = await tp.locator('[data-action="pick"][data-arg^="L:"]').count();
  check("match: labelled 'Match', terms and meanings as buttons", /Match/i.test(await tp.locator(".quiz .kicker").innerText()) && nPairs >= 4 && (await tp.locator('[data-action="pick"][data-arg^="R:"]').count()) === nPairs);
  check("match: Check disabled before pairing", await tp.locator('[data-action="checkmatch"]').isDisabled());
  await tp.locator('[data-action="pick"][data-arg="L:0"]').click();
  check("match: choosing a term marks it pressed and announces it", (await tp.locator('[data-arg="L:0"]').getAttribute("aria-pressed")) === "true" && /selected/.test(await tp.locator("#match-status").innerText()));
  await tp.locator('[data-action="pick"][data-arg="R:0"]').click();
  check("match: choosing a meaning pairs them (label and status say so)", /matched with/.test(await tp.locator('[data-arg="L:0"]').getAttribute("aria-label")) && /^Matched /.test(await tp.locator("#match-status").innerText()));
  await tp.locator('[data-action="pick"][data-arg="L:1"]').focus();
  await tp.keyboard.press("Enter");
  check("match: keyboard selection keeps focus on the chosen term", (await active(tp)).arg === "L:1" && (await tp.locator('[data-arg="L:1"]').getAttribute("aria-pressed")) === "true");
  await tp.locator('[data-action="pick"][data-arg="R:1"]').focus();
  await tp.keyboard.press("Space");
  check("match: Space on a meaning completes the pair", await tp.evaluate(() => window.__studyLab.state.sess.items[0].work.pairs[1] === 1));
  for (let i = 2; i < nPairs; i++) {
    await tp.locator(`[data-action="pick"][data-arg="L:${i}"]`).click();
    await tp.locator(`[data-action="pick"][data-arg="R:${i === 2 ? 3 : i === 3 ? 2 : i}"]`).click();
  }
  check("match: Check enabled once every term is paired", !(await tp.locator('[data-action="checkmatch"]').isDisabled()));
  await tp.locator('[data-action="checkmatch"]').click();
  await tp.locator("#feedback").waitFor();
  check("match: graded per pair, the swapped two shown with fixes", new RegExp(`${nPairs - 2} of ${nPairs} matched`).test(await tp.locator("#feedback").innerText()) && (await tp.locator(".match-done.bad").count()) === 2 && (await tp.locator(".match-done.bad .fix").count()) === 2);
  sv = await readStore(tp);
  check("match: a partly right match is saved as a miss", sv.cards["geo-x9"] && sv.cards["geo-x9"].k === 0);
  await tp.locator('[data-action="end"]').click().catch(() => {});

  // Reading sets in school subjects: passage beside the questions, labelled 'Reading'
  await startIds(tp, "econ", ["econ-x10", "econ-x11", "econ-x12"]);
  const rdP = await tp.locator(".passage").boundingBox(), rdQ = await tp.locator(".split-main .quiz").boundingBox();
  check("reading: school passage shown beside its questions, labelled 'Reading'", /Reading/i.test(await tp.locator(".quiz .kicker").innerText()) && rdP.x + rdP.width <= rdQ.x + 1 && (await tp.locator(".choice").count()) === 4);
  await tp.keyboard.press("1");
  await tp.locator("#feedback").waitFor();
  check("reading: MC number shortcuts unchanged", (await tp.evaluate(() => window.__studyLab.state.sess.picked)) === 0);
  await tp.locator('[data-action="end"]').click().catch(() => {});

  // Progress compatibility: earlier cards untouched, new cards in the same format, survive a reload
  sv = await readStore(tp);
  const fmtOk = Object.values(sv.cards).every((c) => ["b", "due", "n", "k", "t"].every((k) => typeof c[k] === "number") && Object.keys(c).length === 5);
  check("progress: live-site cards untouched; new formats saved as ordinary cards", ["math0", "lsat3", "lsat27"].every((k) => JSON.stringify(sv.cards[k]) === JSON.stringify(LIVE.cards[k])) && fmtOk && ["sci-x0", "math-x0", "math-x5", "hist-x7", "geo-x9", "econ-x10"].every((k) => sv.cards[k]));
  await tp.goto(BASE); await tp.reload();
  await tp.locator(".subject").first().waitFor();
  const sv2 = await readStore(tp);
  check("progress: new-format cards survive a reload", Object.keys(sv.cards).every((k) => JSON.stringify(sv2.cards[k]) === JSON.stringify(sv.cards[k])) && Object.keys(sv2.cards).length === Object.keys(sv.cards).length && /2\/65 seen/i.test(await tp.locator(".lsat-card").innerText()), JSON.stringify([Object.keys(sv.cards).length, Object.keys(sv2.cards).length, await tp.locator(".lsat-card").innerText()]).slice(0, 300));
  check("no console errors (question formats)", terr.length === 0, terr.join(" | "));

  // Phone, 390px dark: every format fits without sideways scrolling, before and after answering
  const fctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "dark" });
  await localOnly(fctx);
  const fp = await fctx.newPage();
  const ferr = watch(fp);
  await fp.goto(BASE);
  await fp.locator(".subject").first().waitFor();
  const phoneIds = await fp.evaluate(() => {
    const { QUESTIONS } = window.__studyLab, out = [];
    const subs = ["math", "sci", "hist", "geo", "eng", "econ"];
    ["typed", "explain", "order", "match"].forEach((t, i) => { const s = subs[i % 6]; out.push(QUESTIONS.filter((q) => q.s === s && q.type === t).pop().id); });
    out.push(QUESTIONS.find((q) => q.s === "eng" && q.p).id);
    return out;
  });
  for (const id of phoneIds) {
    await startIds(fp, id.split("-")[0], [id]);
    const t = await quizType(fp);
    const before = await fp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const small = await fp.evaluate(() => [...document.querySelectorAll(".quiz button:not([disabled])")].filter((b) => b.offsetParent && b.getBoundingClientRect().height < 44 && !b.closest(".segmented")).map((b) => b.textContent.trim()));
    await answerCurrent(fp, false, true);
    const after = await fp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    check(`phone: ${t}${id.includes("x1") && t === "mc" ? " (reading)" : ""} fits 390px before and after answering, tap targets ≥44px`, before <= 0 && after <= 0 && small.length === 0, JSON.stringify({ id, before, after, small }));
    await fp.locator('[data-action="end"]').tap().catch(() => {});
  }
  check("phone: match columns stack into one on narrow screens", await (async () => { await startIds(fp, "sci", [phoneIds[3]]); return fp.evaluate(() => { const c = document.querySelectorAll(".match-col"); return c[1].getBoundingClientRect().top > c[0].getBoundingClientRect().bottom - 1; }); })());
  check("no console errors (phone formats)", ferr.length === 0, ferr.join(" | "));

  // ---- Menu: smooth Apple-style hover (red pill fades/grows in, label eases up in size) ----
  const menuCtx = async (opts) => {
    const c = await browser.newContext(opts);
    await localOnly(c);
    await c.addInitScript(() => { window.__vib = []; if (navigator.vibrate) navigator.vibrate = function (p) { window.__vib.push(p); return true; }; });
    const pg = await c.newPage();
    return { c, pg, errs: watch(pg) };
  };
  // Look of one entry: label colour and scale, pill opacity/colour, the current-section bar, and the expected theme colours.
  const look = (pg, sel) => (typeof sel === "string" ? pg.locator(sel).first() : sel || pg.locator(":focus")).evaluate((b) => {
    b = b || document.activeElement;
    const cs = getComputedStyle(b), pill = getComputedStyle(b, "::after"), label = b.querySelector(".mi-label");
    const probe = document.createElement("span"); probe.style.color = "var(--red-text)"; probe.style.background = "var(--tint-soft)"; document.body.appendChild(probe);
    const want = getComputedStyle(probe);
    const m = new DOMMatrix(getComputedStyle(label).transform === "none" ? undefined : getComputedStyle(label).transform);
    const r = { text: b.textContent, color: cs.color, red: want.color, pillBg: pill.backgroundColor, tint: want.backgroundColor, pillOpacity: Number(pill.opacity), scale: Math.round(m.a * 1000) / 1000, bar: getComputedStyle(b, "::before").content, motion: pill.transitionProperty + " | " + getComputedStyle(label).transitionProperty, anim: cs.animationName };
    probe.remove(); return r;
  });
  const boxes = (pg) => pg.evaluate(() => [...document.querySelectorAll("#menu-panel .menu-item")].map((b) => { const r = b.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.height), Math.round(r.width)].join(","); }).join(";"));
  const panelOverflow = (pg) => pg.evaluate(() => { const p = document.getElementById("menu-panel"); return p.scrollWidth - p.clientWidth; });
  for (const theme of ["light", "dark"]) {
    const { c, pg, errs } = await menuCtx({ viewport: { width: 1280, height: 800 }, colorScheme: theme });
    await pg.goto(BASE); await pg.locator(".subject").first().waitFor();
    await pg.evaluate(() => { const s = document.getElementById("subjects"); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 60); });
    await pg.locator("#menu-btn").click();
    await pg.locator("#menu-panel .menu-item").first().waitFor();
    await pg.waitForTimeout(300); // let the panel's open animation finish
    const before = await boxes(pg);
    const rest = await look(pg, '#menu-panel .menu-item:not([aria-current])');
    check(`menu smooth ${theme}: entries at rest are not scaled and have no pill`, rest.scale === 1 && rest.pillOpacity === 0, JSON.stringify(rest));
    check(`menu smooth ${theme}: motion is transform/opacity transitions only, no keyframe animation (shake removed)`, /opacity/.test(rest.motion) && /transform/.test(rest.motion) && !/width|height|top|left|margin|padding/.test(rest.motion) && rest.anim === "none", rest.motion);
    const target = await pg.locator('#menu-panel .menu-item.sub').last().elementHandle(); // "Question formats", far from the current section
    await target.hover();
    await pg.waitForTimeout(80);
    const mid = await look(pg, target);
    await pg.waitForTimeout(300);
    const lk = await look(pg, target);
    const hovering = await target.evaluate((b) => b.matches(':hover'));
    check(`menu smooth ${theme}: hovered entry eases up to ~1.04 with red text on a red pill`, hovering && lk.scale >= 1.03 && lk.scale <= 1.05 && lk.color === lk.red && lk.pillBg === lk.tint && lk.pillOpacity === 1, JSON.stringify(lk));
    check(`menu smooth ${theme}: it transitions (part-way after 80ms), not a jump`, mid.scale > 1 && mid.scale < lk.scale, JSON.stringify(mid));
    const afterBoxes = await boxes(pg);
    check(`menu smooth ${theme}: no layout shift: every entry keeps its position and size`, afterBoxes === before, JSON.stringify([before, afterBoxes, await pg.evaluate(() => scrollY)]).slice(0, 400));
    check(`menu smooth ${theme}: the grown label stays inside the panel (no sideways scroll in the menu)`, (await panelOverflow(pg)) <= 0 && (await pg.evaluate(() => { const b = document.querySelector("#menu-panel .menu-item:hover") || document.querySelector("#menu-panel .menu-item.sub:not([aria-current])"), l = b.querySelector(".mi-label").getBoundingClientRect(), r = b.getBoundingClientRect(); return l.right <= r.right - 2; })));
    const cur = await look(pg, '#menu-panel .menu-item[aria-current="location"]');
    check(`menu smooth ${theme}: current section keeps its red bar and no pill, so it differs from the hovered entry`, cur.bar !== "none" && cur.pillOpacity === 0 && lk.bar === "none", JSON.stringify(cur));
    // keyboard focus gets the same look
    await pg.mouse.move(900, 700);
    await pg.locator("#menu-panel .menu-item").first().focus();
    await pg.keyboard.press("ArrowDown");
    await pg.waitForTimeout(300);
    const kf = await look(pg, null);
    check(`menu smooth ${theme}: ArrowDown focus shows the same grow + red pill`, kf.scale >= 1.03 && kf.color === kf.red && kf.pillOpacity === 1, JSON.stringify(kf));
    check(`menu smooth ${theme}: no vibration any more`, (await pg.evaluate(() => window.__vib.length)) === 0);
    check(`menu smooth ${theme}: no console errors`, errs.length === 0, errs.join(" | "));
    await c.close();
  }
  {
    // Reduced motion: colour and pill only, no scaling and no transitions
    const { c, pg, errs } = await menuCtx({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" });
    await pg.goto(BASE); await pg.locator(".subject").first().waitFor();
    await pg.locator("#menu-btn").click();
    await pg.locator("#menu-panel .menu-item:not([aria-current])").nth(2).hover();
    await pg.waitForTimeout(50);
    const rm = await look(pg, pg.locator("#menu-panel .menu-item:not([aria-current])").nth(2));
    check("menu smooth reduced motion: red colour and pill straight away, no scaling", rm.scale === 1 && rm.color === rm.red && rm.pillOpacity === 1, JSON.stringify(rm));
    check("menu smooth reduced motion: no console errors", errs.length === 0, errs.join(" | "));
    await c.close();
  }
  {
    // Phone: sliding a finger across the entries highlights the one under it, smoothly, without sideways scroll
    const { c, pg, errs } = await menuCtx({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    await pg.goto(BASE); await pg.locator(".subject").first().waitFor();
    await pg.locator("#menu-btn").tap();
    await pg.locator("#menu-panel .menu-item").nth(3).waitFor();
    await pg.waitForTimeout(300);
    const before = await boxes(pg);
    const slide = await pg.evaluate(async () => {
      const its = [...document.querySelectorAll("#menu-panel .menu-item")].slice(1, 4);
      const list = document.querySelector("#menu-panel .menu-list");
      const seen = [];
      for (const b of its) {
        const r = b.getBoundingClientRect();
        const t = new Touch({ identifier: 1, target: b, clientX: r.left + 30, clientY: r.top + r.height / 2 });
        list.dispatchEvent(new TouchEvent("touchmove", { touches: [t], bubbles: true }));
        seen.push(document.querySelectorAll("#menu-panel .menu-item.hl").length === 1 && b.classList.contains("hl"));
        await new Promise((res) => setTimeout(res, 60));
      }
      await new Promise((res) => setTimeout(res, 300));
      const last = its[its.length - 1], m = new DOMMatrix(getComputedStyle(last.querySelector(".mi-label")).transform);
      list.dispatchEvent(new TouchEvent("touchend", { touches: [], bubbles: true }));
      return { seen, scale: Math.round(m.a * 1000) / 1000, after: document.querySelectorAll("#menu-panel .menu-item.hl").length };
    });
    check("menu smooth phone: a finger sliding across highlights one entry at a time (grown), cleared on lift", slide.seen.every(Boolean) && slide.scale >= 1.03 && slide.after === 0, JSON.stringify(slide));
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check("menu smooth phone: no layout shift, no sideways scroll on the page or in the menu, no errors", (await boxes(pg)) === before && ov <= 0 && (await panelOverflow(pg)) <= 0 && errs.length === 0, JSON.stringify({ ov, errs }));
    await c.close();
  }

  // ---- polish batch ----
  const fsMod = await import("node:fs");
  const { TOTAL_QUESTIONS } = await import("../js/engine.js");
  for (const [w, h, mob] of [[1440, 900, false], [390, 844, true]]) {
    const tag = w + "px";
    const pc = await browser.newContext({ viewport: { width: w, height: h }, isMobile: mob, hasTouch: mob });
    await localOnly(pc);
    const pg = await pc.newPage();
    const perrs = watch(pg);
    pg.on("dialog", (d) => d.accept());
    await pg.goto(BASE); await pg.locator(".subject").first().waitFor();
    // 1. first visit: no grey "Nothing due", just Mixed review
    const hero = await pg.evaluate(() => ({ btns: [...document.querySelectorAll(".hero .btn")].map((b) => b.textContent.trim() + (b.classList.contains("primary") ? "*" : "")), nothing: /Nothing due/.test(document.querySelector(".hero").innerText) }));
    check(`${tag} #1: first visit shows only a primary 'Mixed review' (no 'Nothing due')`, !hero.nothing && JSON.stringify(hero.btns) === JSON.stringify(["Mixed review*"]), JSON.stringify(hero));
    // 7. unlock hints hidden on unused tiles and on an unused LSAT card
    check(`${tag} #7: no unlock hints on subjects or LSAT before they're started`, (await pg.locator(".subject .hint").count()) === 0 && (await pg.locator(".lsat-hint").count()) === 0 && !/to unlock|more answers toward/i.test(await pg.evaluate(() => [...document.querySelectorAll(".subject, .lsat-card")].map((e) => e.innerText).join(" "))));
    // 5. top bar: 'Menu' trigger, no Subjects jump
    const bar = await pg.evaluate(() => ({ menu: document.getElementById("menu-btn").textContent.trim(), name: document.getElementById("menu-btn").getAttribute("aria-label"), slotHidden: document.getElementById("nav-slot").hidden, slotShown: getComputedStyle(document.getElementById("nav-slot")).display, subjectsInBar: [...document.querySelectorAll("#nav button")].some((b) => b.offsetParent && /Subjects/.test(b.textContent)) }));
    check(`${tag} #5: menu trigger reads 'Menu' (its accessible name) and there's no Subjects button in the bar`, bar.menu === "Menu" && bar.name === null && bar.slotHidden && bar.slotShown === "none" && !bar.subjectsInBar, JSON.stringify(bar));
    // 6. 44px targets for every visible top-bar control, without a heavier look
    const targets = async () => pg.evaluate(() => [...document.querySelectorAll("#nav button")].filter((b) => b.offsetParent).map((b) => {
      const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const hits = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && (e === b || b.contains(e)); };
      return { id: b.id || b.className, h: Math.round(r.height), ok: hits(cx, cy - 21.5) && hits(cx, cy + 21.5) && hits(cx - 21.5, cy) && hits(cx + 21.5, cy) };
    }));
    const t0 = await targets();
    check(`${tag} #6: every top-bar control has a 44x44 touch target while its visible pill stays under 40px`, t0.length >= 3 && t0.every((t) => t.ok && t.h < 40), JSON.stringify(t0));
    // 2. jump targets land below the sticky bar (Menu entries and plain scrollIntoView)
    const navH = await pg.evaluate(() => document.getElementById("nav").getBoundingClientRect().height);
    const sm = await pg.evaluate(() => parseFloat(getComputedStyle(document.getElementById("subjects")).scrollMarginTop));
    check(`${tag} #2: jump targets have scroll-margin-top = real bar height + 16px`, Math.abs(sm - (navH + 16)) < 1, JSON.stringify({ sm, navH }));
    for (const label of ["Subjects", "LSAT prep", "How it works", "Backup and reset"]) {
      await pg.evaluate(() => window.scrollTo(0, 0));
      await (mob ? pg.locator("#menu-btn").tap() : pg.locator("#menu-btn").click());
      await pg.locator("#menu-panel .menu-item.top", { hasText: label }).click();
      await pg.waitForTimeout(1100);
      const pos = await pg.evaluate((label) => {
        const nb = document.getElementById("nav").getBoundingClientRect().bottom;
        const h2 = [...document.querySelectorAll("#app h2")].find((x) => x.textContent.trim() === label || x.closest(".lsat-card") && label === "LSAT prep");
        const sec = h2.closest("#app > *"), end = innerHeight + scrollY >= document.documentElement.scrollHeight - 2;
        return { secTop: Math.round(sec.getBoundingClientRect().top - nb), h2Top: Math.round(h2.getBoundingClientRect().top - nb), end };
      }, label);
      check(`${tag} #2: Menu > ${label} shows its heading just below the bar`, pos.secTop >= 8 && (pos.h2Top < 120 || pos.end), JSON.stringify(pos));
    }
    for (const id of ["subjects", "sec-lsat-prep", "howto"]) {
      const g = await pg.evaluate((id) => { const el = document.getElementById(id); el.scrollIntoView({ block: "start" }); const h = el.querySelector("h2"); return Math.round(h.getBoundingClientRect().top - document.getElementById("nav").getBoundingClientRect().bottom); }, id);
      check(`${tag} #2: scrollIntoView(#${id}) keeps its heading visible below the bar`, g >= 8, "gap=" + g);
    }
    // 8. tab title during rounds
    const titles = [];
    titles.push(await pg.title());
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.locator('[data-arg="subject:math"]').click(); await pg.locator("#q-stem").waitFor();
    titles.push(await pg.title());
    // 5 + 6 during a round: End round in the bar, 44px, and it still ends the round
    const slot = await pg.evaluate(() => { const s = document.getElementById("nav-slot"); return { shown: !s.hidden && !!s.offsetParent, text: s.textContent }; });
    const t1 = await targets();
    check(`${tag} #5/#6: during a round the bar shows 'End round' with a 44px target`, slot.shown && slot.text === "End round" && t1.find((t) => t.id === "nav-slot")?.ok, JSON.stringify([slot, t1]));
    await answerCurrent(pg, true);
    await pg.locator("#nav-slot").click();
    await pg.locator("text=Round complete").waitFor();
    titles.push(await pg.title());
    check(`${tag} #5: 'End round' in the bar still ends the round (summary shown) and then hides`, (await pg.evaluate(() => document.getElementById("nav-slot").hidden)));
    await pg.locator('[data-action="home"]').click(); await pg.locator(".subject").first().waitFor();
    titles.push(await pg.title());
    // 7 after starting math: hint on Math only
    const hints = await pg.evaluate(() => [...document.querySelectorAll(".subject")].filter((t) => t.querySelector(".hint")).map((t) => t.dataset.s));
    check(`${tag} #7: after a Math round only the Math tile shows its unlock hint`, JSON.stringify(hints) === JSON.stringify(["math"]), JSON.stringify(hints));
    await pg.locator('[data-arg="mixed:all"]').click(); await pg.locator("#q-stem").waitFor();
    titles.push(await pg.title());
    await pg.goBack(); await pg.locator(".subject").first().waitFor();
    titles.push(await pg.title());
    await pg.locator('[data-arg="lsat-short:lsat"]').click(); await pg.locator("#q-stem").waitFor();
    titles.push(await pg.title());
    await pg.goBack(); await pg.locator(".subject").first().waitFor();
    titles.push(await pg.title());
    check(`${tag} #8: tab title follows rounds (Math, Mixed review, LSAT) and returns to 'Study Lab' at home`, JSON.stringify(titles) === JSON.stringify(["Study Lab", "Math practice — Study Lab", "Math practice — Study Lab", "Study Lab", "Mixed review — Study Lab", "Study Lab", "LSAT practice — Study Lab", "Study Lab"]), JSON.stringify(titles));
    // 1 with something due: Review due appears
    await pg.evaluate(() => { const s = JSON.parse(localStorage.getItem("study-lab-progress-v1")); for (const c of Object.values(s.cards)) c.due = 1; localStorage.setItem("study-lab-progress-v1", JSON.stringify(s)); });
    await pg.reload(); await pg.locator(".subject").first().waitFor();
    const hero2 = await pg.evaluate(() => [...document.querySelectorAll(".hero .btn")].map((b) => b.textContent.trim()));
    check(`${tag} #1: once something is due, 'Review due (n)' appears beside Mixed review`, hero2.length === 2 && /^Review due \(\d+\)$/.test(hero2[0]) && hero2[1] === "Mixed review", JSON.stringify(hero2));
    const ov = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    check(`${tag}: no sideways scroll, no console errors (polish)`, ov <= 0 && perrs.length === 0, JSON.stringify({ ov, perrs }));
    await pc.close();
  }
  // 3. share preview count + 4. no leftover links to the old study-lab- address
  const html = fsMod.readFileSync(path.join(here, "..", "index.html"), "utf8");
  const metaC = (re) => (html.match(re) || [])[1] || "";
  const ogDesc = metaC(/property="og:description" content="([^"]*)"/), twDesc = metaC(/name="twitter:description" content="([^"]*)"/), ogImg = metaC(/property="og:image" content="([^"]*)"/);
  check(`#3: og/twitter descriptions say ${TOTAL_QUESTIONS} questions (the bank's real count) and no stale 356`, ogDesc.startsWith(TOTAL_QUESTIONS + " ") && twDesc.startsWith(TOTAL_QUESTIONS + " ") && !/\b356\b/.test(html), JSON.stringify([ogDesc.slice(0, 40), twDesc.slice(0, 40)]));
  check("#3: og:image URL is versioned so previews refresh", /og\.png\?v=\d+$/.test(ogImg), ogImg);
  const png = fsMod.readFileSync(path.join(here, "..", "og.png"));
  check("#3: og.png is 1200x630 and the generator takes its count from the banks", png.readUInt32BE(16) === 1200 && png.readUInt32BE(20) === 630 && /TOTAL_QUESTIONS\} questions/.test(fsMod.readFileSync(path.join(here, "make-og.mjs"), "utf8")));
  const scan = ["index.html", "README.md", "lsat-research.md", "js/app.js", "js/sync.js", "js/menu.js", "supabase/schema.sql", ".github/workflows/pages.yml"].filter((f) => fsMod.existsSync(path.join(here, "..", f)));
  const stale = scan.filter((f) => /study-lab-\/|github\.io\/study-lab-|github\.com\/liamsmith059\/study-lab-/.test(fsMod.readFileSync(path.join(here, "..", f), "utf8")));
  check("#4: no links to the old /study-lab-/ address anywhere in the site or docs", stale.length === 0, stale.join(","));
} catch (e) {
  failures++;
  console.log("FAIL exception: " + e.message);
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? failures + " failed" : "all browser checks passed");
process.exit(failures ? 1 : 0);
