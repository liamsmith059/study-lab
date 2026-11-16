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
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(BASE);
  await page.locator(".subject").first().waitFor();
  check("home loads with 6 subject cards", (await page.locator(".subject").count()) === 6);
  check("home has a separate LSAT card", (await page.locator(".lsat-card").count()) === 1);
  check("header no longer says just 'Six subjects'", /plus LSAT prep/.test(await page.locator("header.top").innerText()));
  const nQ = await page.evaluate(() => window.__studyLab.QUESTIONS.length);
  check("all questions parsed in the browser (306 core + LSAT)", nQ >= 350, "n=" + nQ);
  check("sign-in UI hidden when config.js is blank", (await page.locator("#email").count()) === 0);
  check("localStorage empty before answering", (await page.evaluate(() => localStorage.getItem("study-lab-progress-v1"))) === null);

  await page.locator('[data-arg="subject:math"]').click();
  await page.locator(".question").waitFor();
  check("quiz shows question 1 of 10", (await page.locator("h2").first().innerText()).includes("1 of 10"));
  await page.locator('.segmented [data-arg="sure"]').click();
  await page.locator(".choice").nth(0).click();
  await page.locator(".callout").waitFor();
  const fb = await page.locator(".callout").innerText();
  check("feedback shown after answering", /Correct\.|Not quite\./.test(fb), JSON.stringify(fb.slice(0, 60)));
  check("correct answer highlighted", (await page.locator(".choice.correct").count()) === 1);
  await page.evaluate(() => document.fonts.ready);
  check("theme fonts loaded (EB Garamond, Cormorant Garamond)", await page.evaluate(() => document.fonts.check('18px "EB Garamond"') && document.fonts.check('600 24px "Cormorant Garamond"')));
  await page.screenshot({ path: path.join(here, "screenshot-laptop-quiz.png") });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  check("answering updates localStorage", saved && saved.total === 1 && Object.keys(saved.cards).length === 1, JSON.stringify(saved && saved.cards));

  // keyboard: Enter for next, 1-4 to answer
  await page.keyboard.press("Enter");
  await page.locator(".choice:not(:disabled)").first().waitFor();
  await page.keyboard.press("2");
  await page.locator(".callout").waitFor();
  check("keyboard answering works", (await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")).total)) === 2);
  await page.locator('[data-action="next"]').click();

  const n = await answerRound(page);
  await page.locator("text=Round complete").waitFor();
  check("round reaches summary", true, `(${n + 2} questions incl. second tries)`);
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")));
  check("10 first-try answers recorded", st.total === 10, "total=" + st.total);

  await page.locator('[data-action="home"]').click();
  await page.reload();
  await page.locator(".subject").first().waitFor();
  const metricsText = await page.locator(".metrics").innerText();
  check("progress persists after reload", metricsText.includes("10 answered"));
  check("mastery chart shown once questions seen", (await page.locator(".hbar").count()) === 7);

  // mixed review interleaves
  await page.locator('[data-arg="mixed:all"]').click();
  await page.locator(".meta").waitFor();
  check("mixed review starts", (await page.locator(".meta").innerText()).length > 0);
  await page.locator('[data-action="end"]').click();

  // backup restore round trip
  await page.locator('[data-action="home"]').click().catch(() => {});
  await page.locator("#backup summary").click();
  const code = await page.locator("#backup-code").inputValue();
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.locator("#backup summary").click();
  await page.locator("#restore").fill(code);
  await page.locator('[data-action="restore"]').click();
  check("backup code restores progress", (await page.evaluate(() => JSON.parse(localStorage.getItem("study-lab-progress-v1")).total)) >= 10);
  check("no console errors (local mode)", errors.length === 0, errors.join(" | "));

  // ---- LSAT on a laptop-sized screen ----
  const lctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const lp = await lctx.newPage();
  const lerr = watch(lp);
  await lp.goto(BASE);
  await lp.locator(".lsat-card").waitFor();
  await lp.evaluate(() => document.fonts.ready);
  await lp.screenshot({ path: path.join(here, "screenshot-laptop-home.png"), fullPage: true });
  await lp.locator('[data-arg="lsat-short:lsat"]').click();
  await lp.locator(".question.stem").waitFor();
  check("LSAT short: question 1 of 10", (await lp.locator("h2").first().innerText()).includes("1 of 10"));
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
  const qBox = await lp.locator(".split > div > .card").boundingBox();
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
  await lp.locator(".meta").waitFor();
  const mixedSubjects = await lp.evaluate(() => window.__studyLab.state.sess.items.map((i) => i.qid));
  check("Mixed review contains no LSAT questions", mixedSubjects.every((id) => !id.startsWith("lsat")), mixedSubjects.join(","));
  await lp.locator('[data-action="end"]').click();
  check("no console errors (LSAT laptop)", lerr.length === 0, lerr.join(" | "));

  // ---- phone layout ----
  const phone = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  const perr = watch(pp);
  await pp.goto(BASE);
  await pp.locator(".subject").first().waitFor();
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no horizontal overflow on home", overflow <= 0, "overflow=" + overflow);
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
  const pqBox = await pp.locator(".split > div > .card").boundingBox();
  check("phone LSAT: passage stacked above the question", ppBox.y + ppBox.height <= pqBox.y + 1);
  await pp.evaluate(() => document.fonts.ready);
  await pp.screenshot({ path: path.join(here, "screenshot-phone-lsat-passage.png") });
  await pp.locator(".passage > summary").tap();
  check("phone LSAT: passage folds away", (await pp.evaluate(() => document.getElementById("passage").open)) === false);
  await pp.locator(".choice").first().tap();
  await pp.locator(".callout").waitFor();
  check("phone LSAT: passage stays folded after answering", (await pp.evaluate(() => document.getElementById("passage").open)) === false);
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
} catch (e) {
  failures++;
  console.log("FAIL exception: " + e.message);
} finally {
  await browser.close();
  server.kill();
}
console.log(failures ? failures + " failed" : "all browser checks passed");
process.exit(failures ? 1 : 0);
