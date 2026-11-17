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

async function answerRound(page) {
  let n = 0;
  while (await page.locator(".choice").count()) {
    await page.locator(".choice").first().click();
    await page.locator(".callout").waitFor();
    await page.locator('[data-action="next"]').click();
    if (++n > 20) break;
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
  check("home loads only the 306 core questions (LSAT bank lazy)", nQ === 306, "n=" + nQ);
  check("header counts all 356 questions", /356 questions/.test(await page.locator(".hero").innerText()));
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
  for (let i = 0; i < 25 && (await page.locator(".choice").count()); i++) {
    const h = await page.locator(".quiz-progress").innerText();
    if (/Second try/.test(h)) sawSecondTry = true;
    const m = /\/ (\d+)/.exec(h); if (m) maxOf = Math.max(maxOf, Number(m[1]));
    await page.locator(".choice").first().click();
    await page.locator(".callout").waitFor();
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
  check("saved LSAT progress counted on the home page without loading the LSAT bank", /2\/50 seen/i.test(await hp.locator(".lsat-card").innerText()) && (await hp.evaluate(() => window.__studyLab.QUESTIONS.length)) === 306);
  check("Due now is the same set on home: school subjects + LSAT noted", /\+ 1 LSAT/.test(await hp.locator(".metrics").first().innerText()));
  await hp.locator('[data-arg="subject:geo"]').click();
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
  check("LSAT short: question 1 of 10", (await lp.locator(".quiz-progress").innerText()).includes("1 / 10"));
  check("LSAT bank loaded on demand (356 questions)", (await lp.evaluate(() => window.__studyLab.QUESTIONS.length)) === 356);
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
} catch (e) {
  failures++;
  console.log("FAIL exception: " + e.message);
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? failures + " failed" : "all browser checks passed");
process.exit(failures ? 1 : 0);
