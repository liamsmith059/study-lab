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
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = watch(page);
  await page.goto(BASE);
  await page.locator(".subject").first().waitFor();
  check("home loads with 6 subject cards", (await page.locator(".subject").count()) === 6);
  check("all 306 questions parsed in the browser", (await page.evaluate(() => window.__studyLab.QUESTIONS.length)) === 306);
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
  check("mastery chart shown once questions seen", (await page.locator(".hbar").count()) === 6);

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

  // ---- phone layout ----
  const phone = await browser.newContext({ viewport: { width: 375, height: 740 }, isMobile: true, hasTouch: true });
  const pp = await phone.newPage();
  const perr = watch(pp);
  await pp.goto(BASE);
  await pp.locator(".subject").first().waitFor();
  const overflow = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no horizontal overflow on home", overflow <= 0, "overflow=" + overflow);
  await pp.screenshot({ path: path.join(here, "screenshot-phone-home.png"), fullPage: false });
  await pp.locator('[data-arg="subject:hist"]').tap();
  await pp.locator(".choice").first().tap();
  await pp.locator(".callout").waitFor();
  const overflowQ = await pp.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("phone: no horizontal overflow in quiz", overflowQ <= 0, "overflow=" + overflowQ);
  await pp.screenshot({ path: path.join(here, "screenshot-phone-quiz.png"), fullPage: true });
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
