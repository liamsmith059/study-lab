// Review screenshots + numeric checks (contrast, passage clipping, focus) at 1440x900 and 390x844, light and dark.
// Usage: cd tests && node review.mjs   -> writes tests/review/*.png and prints a report.
import { chromium } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as E from "../js/engine.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(here, "..");
const out = path.join(here, "review");
fs.mkdirSync(out, { recursive: true });
const PORT = 8768;
const BASE = `http://localhost:${PORT}/${path.basename(siteDir)}/`;
const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: path.dirname(siteDir), stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true });
let failures = 0;
const check = (name, cond, extra = "") => { console.log((cond ? "ok   " : "FAIL ") + name + (extra ? "  " + extra : "")); if (!cond) failures++; };

// Some realistic progress so the home page shows bars, a weakest topic and a goal.
const now = Date.now();
let st = E.emptyStore();
const pick = (s, t, n) => E.QUESTIONS.filter((q) => q.s === s && (!t || q.t === t)).slice(0, n);
for (const q of pick("math", "Algebra", 4)) st = E.applyAnswer(st, q, false, "sure", now - 2 * E.DAY);
for (const q of pick("sci", null, 8)) st = E.applyAnswer(st, q, true, "sure", now - 4 * E.DAY);
for (const q of pick("hist", null, 6)) st = E.applyAnswer(st, q, true, "unsure", now - 3 * E.DAY);
for (const q of pick("geo", null, 3)) st = E.applyAnswer(st, q, true, "sure", now - E.DAY);
const SEED = JSON.stringify(st);

const shot = (p, name, full = false) => p.screenshot({ path: path.join(out, name), fullPage: full });
async function ctxFor(vp, theme, seed = true, mobile = false) {
  const ctx = await browser.newContext({ viewport: vp, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: mobile ? 2 : 1 });
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.STUDY_LAB_CONFIG={};" }));
  await ctx.addInitScript(([s, t, seedIt]) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    if (seedIt) localStorage.setItem("study-lab-progress-v1", s);
    localStorage.setItem("study-lab-theme", t);
  }, [SEED, theme, seed]);
  const p = await ctx.newPage();
  p.on("dialog", (d) => d.accept().catch(() => {})); // "Leave this round?" when navigating away mid-round
  return p;
}
// Rounds mix formats now; MC-focused shots reorder the rest of the round so its multiple-choice questions come first.
async function mcFirst(p) {
  await p.locator("#q-stem").waitFor();
  await p.evaluate(() => {
    const { state, QMAP, render } = window.__studyLab;
    const s = state.sess, rest = s.items.slice(s.idx), mc = (it) => !QMAP[it.qid].type;
    s.items = s.items.slice(0, s.idx).concat(rest.filter(mc), rest.filter((it) => !mc(it)));
    render(false, "stem");
  });
}
// Answer whatever format is showing (wrong unless right=true) and wait for the feedback.
async function answerAny(p, right = false, tap = false) {
  const press = (loc) => (tap ? loc.tap() : loc.click());
  const type = await p.evaluate(() => { const { state, QMAP } = window.__studyLab; return QMAP[state.sess.items[state.sess.idx].qid].type || "mc"; });
  if (type === "mc") await press(p.locator(".choice").nth(await p.evaluate((r) => { const { state, QMAP } = window.__studyLab; const it = state.sess.items[state.sess.idx]; const c = it.order.indexOf(QMAP[it.qid].c[0]); return r ? c : (c + 1) % it.order.length; }, right)));
  else if (type === "typed") { await p.locator("#typed-input").fill(right ? await p.evaluate(() => { const { state, QMAP } = window.__studyLab; return String(QMAP[state.sess.items[state.sess.idx].qid].a[0]); }) : "not sure"); await press(p.locator('[data-action="submit"]')); }
  else if (type === "explain") { await p.locator("#explain-input").fill("Something like this, from memory."); await press(p.locator('[data-action="reveal"]')); await press(p.locator(`[data-action="grade"][data-arg="${right ? "got" : "partly"}"]`)); }
  else if (type === "order") await press(p.locator('[data-action="checkorder"]'));
  else if (type === "match") {
    const n = await p.locator('[data-action="pick"][data-arg^="L:"]').count();
    for (let i = 0; i < n; i++) { await press(p.locator(`[data-action="pick"][data-arg="L:${i}"]`)); await press(p.locator(`[data-action="pick"][data-arg="R:${right ? i : (i + 1) % n}"]`)); }
    await press(p.locator('[data-action="checkmatch"]'));
  }
  await p.locator("#feedback").waitFor();
}
async function finishRound(p, tap = false) {
  for (let i = 0; i < 25 && (await p.locator("#q-stem").count()); i++) {
    await answerAny(p, i % 3 !== 0, tap);
    await (tap ? p.locator('[data-action="next"]').tap() : p.locator('[data-action="next"]').click());
  }
}
async function ready(p, sel = ".subject") { await p.locator(sel).first().waitFor(); await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(150); }

// ---- contrast ----
function lum(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
// [foreground, background, what it is]; "#fff" is literal white (button text).
const PAIRS = [
  ["#ffffff", "--red", "white text on red primary button"],
  ["#ffffff", "--red-hover", "white text on hovered button"],
  ["--red-text", "--bg", "small red text (due counts, links) on the page"],
  ["--red-text", "--card", "small red text on cards"],
  ["--red-text", "--tint-soft", "red tag on a wrong-answer tint"],
  ["--text", "--bg", "body text on the page"], ["--text", "--card", "body text on cards"],
  ["--muted", "--bg", "secondary text on the page"], ["--muted", "--card", "secondary text on cards"], ["--muted", "--card-2", "secondary text on goal box"],
  ["--muted-on-fill", "--fill", "unselected segmented control / pace pill"], ["--text", "--fill", "grey button text"],
  ["--ok", "--ok-soft", "green tag on a correct-answer tint"], ["--ok", "--card", "green feedback heading"],
  ["--text", "--card", "Sections menu: section entry"], ["--muted", "--card", "Sections menu: sub-heading entry and note"],
  ["--red-text", "--card", "Sections menu: current section"],
  ["--red-text", "--bg", "Sections button while open (on the top bar)"],
  ["--red-text", "--tint-soft", "Sections menu: hovered / focused entry (red on red tint)"],
  ["--text", "--card-2", "Explain why: 'You wrote' box"], ["--muted-on-fill", "--card", "Explain why: 1/2/3 key hints on grade buttons"],
  ["--text", "--ok-soft", "Order/Match: text on a correct row"], ["--text", "--tint-soft", "Order/Match: text on a wrong row or selected term"],
  ["--muted", "--tint-soft", "Match: crossed-out wrong meaning"], ["--muted", "--ok-soft", "Order: position number on a correct row"],
  ["--card", "--text", "Match: pair number badge (inverted)"],
];
const report = {};
for (const theme of ["light", "dark"]) {
  const p = await ctxFor({ width: 1440, height: 900 }, theme);
  await p.goto(BASE); await ready(p);
  const names = [...new Set(PAIRS.flatMap(([a, b]) => [a, b]).filter((n) => n.startsWith("--")))];
  const vars = await p.evaluate((ns) => { const cs = getComputedStyle(document.documentElement); return Object.fromEntries(ns.map((n) => [n, cs.getPropertyValue(n).trim()])); }, names);
  // Flatten translucent tints onto the card colour so the ratio is what the eye sees.
  const solid = (v, under) => {
    const m = /rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)/.exec(v);
    if (!m) return v;
    const base = [1, 3, 5].map((k) => parseInt(under.slice(k, k + 2), 16));
    return "#" + [m[1], m[2], m[3]].map((c, k) => Math.round(Number(c) * Number(m[4]) + base[k] * (1 - Number(m[4]))).toString(16).padStart(2, "0")).join("");
  };
  const val = (n) => solid(n.startsWith("--") ? vars[n] : n, vars["--card"]);
  report[theme] = PAIRS.map(([fg, bg, what]) => ({ what, fg, bg, fgv: val(fg), bgv: val(bg), r: Math.round(ratio(val(fg), val(bg)) * 100) / 100 }));
  for (const x of report[theme]) check(`contrast ${theme}: ${x.what}: ${x.fgv} on ${x.bgv} = ${x.r.toFixed(2)}:1`, x.r >= 4.5);
  await p.context().close();
}
fs.writeFileSync(path.join(out, "contrast.json"), JSON.stringify(report, null, 2));

// ---- desktop 1440x900 ----
for (const theme of ["light", "dark"]) {
  const p = await ctxFor({ width: 1440, height: 900 }, theme);
  await p.goto(BASE); await ready(p);
  await shot(p, `home-${theme}-desktop.png`);
  await shot(p, `home-${theme}-desktop-full.png`, true);
  await p.locator('[data-arg="subject:eng"]').click(); await ready(p, ".question"); await mcFirst(p);
  await p.locator(".choice").first().click(); await p.locator(".callout").waitFor();
  await shot(p, `quiz-${theme}-desktop-after-answer.png`);
  await p.locator('[data-action="next"]').click();
  await finishRound(p);
  await p.locator("text=Round complete").waitFor(); await p.waitForTimeout(150);
  await shot(p, `summary-${theme}-desktop.png`, true);
  await p.locator('[data-action="home"]').click(); await ready(p);
  await p.locator('[data-arg="lsat-long:lsat"]').click(); await ready(p, ".passage-body");
  await shot(p, `lsat-${theme}-desktop-split.png`);
  if (theme === "light") {
    const clip = await p.evaluate(() => {
      const b = document.querySelector(".passage-body"); b.scrollTop = b.scrollHeight;
      const last = b.querySelector("p:last-of-type").getBoundingClientRect(), br = b.getBoundingClientRect(), pr = document.querySelector(".passage").getBoundingClientRect();
      return { lastLineBottom: Math.round(last.bottom), bodyBottom: Math.round(br.bottom), fadeStarts: Math.round(br.bottom - 32), panelBottom: Math.round(pr.bottom), viewport: innerHeight };
    });
    check("1440x900: passage scrolled to the end shows its last line above the fade, panel inside viewport", clip.lastLineBottom <= clip.fadeStarts && clip.panelBottom <= clip.viewport, JSON.stringify(clip));
    await p.waitForTimeout(100);
    await shot(p, "lsat-light-desktop-split-scrolled-to-end.png");
  }
  await p.context().close();
}
// ---- phone 390x844 ----
for (const theme of ["light", "dark"]) {
  const p = await ctxFor({ width: 390, height: 844 }, theme, true, true);
  await p.goto(BASE); await ready(p);
  await shot(p, `home-phone-${theme}.png`);
  await shot(p, `home-phone-${theme}-full.png`, true);
  await p.locator('[data-arg="subject:hist"]').tap(); await ready(p, ".question"); await mcFirst(p);
  await p.locator(".choice").first().tap(); await p.locator(".callout").waitFor(); await p.waitForTimeout(150);
  await shot(p, `quiz-phone-${theme}-after-answer.png`);
  const f = await p.evaluate(() => ({ focus: document.activeElement.dataset.action, nextBottom: Math.round(document.activeElement.getBoundingClientRect().bottom), vh: innerHeight }));
  check(`phone ${theme}: after answering, focus is on Next and it is on screen`, f.focus === "next" && f.nextBottom <= f.vh, JSON.stringify(f));
  await p.locator('[data-action="next"]').tap();
  await finishRound(p, true);
  await p.locator("text=Round complete").waitFor(); await p.waitForTimeout(150);
  await shot(p, `summary-phone-${theme}.png`);
  await p.goto(BASE + "#lsat/long"); await ready(p, ".passage-body");
  await shot(p, `lsat-phone-${theme}-collapsed.png`);
  await p.locator(".lsat-bar [data-action=passage]").tap(); await p.waitForTimeout(150);
  await shot(p, `lsat-phone-${theme}-expanded.png`);
  await p.evaluate(() => window.scrollBy(0, 1200)); await p.waitForTimeout(150);
  await shot(p, `lsat-phone-${theme}-expanded-scrolled.png`);
  await p.context().close();
}
// ---- Sections menu: open on desktop (both themes) and phone, and the page after choosing an entry ----
const menuOut = path.join(out, "menu");
fs.mkdirSync(menuOut, { recursive: true });
const menuShot = (p, name) => p.screenshot({ path: path.join(menuOut, name) });
const panelFits = (p) => p.evaluate(() => { const r = document.getElementById("menu-panel").getBoundingClientRect(); return { open: !document.getElementById("menu-panel").hidden, ok: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, n: document.querySelectorAll(".menu-item").length }; });
for (const theme of ["light", "dark"]) {
  const p = await ctxFor({ width: 1440, height: 900 }, theme);
  await p.goto(BASE); await ready(p);
  await p.evaluate(() => { const s = document.getElementById("subjects"); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 68); });
  await p.locator("#menu-btn").hover();
  await p.waitForFunction(() => !document.getElementById("menu-panel").hidden);
  await p.waitForTimeout(250);
  const f = await panelFits(p);
  check(`menu ${theme} desktop: opens on hover and fits on screen`, f.open && f.ok && f.n > 10, JSON.stringify(f));
  await menuShot(p, `menu-desktop-1440x900-open-${theme}.png`);
  if (theme === "light") {
    await p.locator("#menu-panel .menu-item", { hasText: "LSAT prep" }).click();
    await p.waitForTimeout(1200); // smooth scroll
    const t = await p.evaluate(() => document.querySelector(".lsat-card").getBoundingClientRect().top);
    check("menu: after choosing LSAT prep, the card sits just under the top bar", t > 52 && t < 90, "top=" + t);
    await menuShot(p, "menu-desktop-1440x900-after-choosing-lsat-prep-light.png");
    await p.locator('[data-arg="subject:math"]').click(); await mcFirst(p);
    await p.locator(".choice").first().click(); await p.locator(".callout").waitFor();
    await p.locator("#menu-btn").click();
    await p.waitForTimeout(250);
    await menuShot(p, "menu-desktop-1440x900-open-during-round-light.png");
  }
  await p.context().close();
}
{
  const p = await ctxFor({ width: 390, height: 844 }, "light", true, true);
  await p.goto(BASE); await ready(p);
  await p.locator("#menu-btn").tap();
  await p.waitForTimeout(250);
  const f = await panelFits(p);
  check("menu light phone: tap opens a full-width sheet that fits", f.open && f.ok, JSON.stringify(f));
  await menuShot(p, "menu-phone-390x844-open-light.png");
  await p.locator("#menu-panel .menu-item", { hasText: "Science" }).tap();
  await p.waitForTimeout(1200);
  await menuShot(p, "menu-phone-390x844-after-choosing-science-light.png");
  await p.context().close();
}

// ---- question formats: recall, explain why, put in order, match, reading ----
const qtOut = path.join(out, "question-types");
fs.mkdirSync(qtOut, { recursive: true });
for (const f of fs.readdirSync(qtOut)) if (f.endsWith(".png")) fs.unlinkSync(path.join(qtOut, f));
const qtShare = [];
for (const [vp, theme, mobile] of [[{ width: 1440, height: 900 }, "light", false], [{ width: 1440, height: 900 }, "dark", false], [{ width: 390, height: 844 }, "light", true], [{ width: 390, height: 844 }, "dark", true]]) {
  const p = await ctxFor(vp, theme, true, mobile);
  const tag = (mobile ? "phone-390x844-" : "desktop-1440x900-") + theme;
  const qshot = async (name) => { if (mobile) await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(120); const f = `${name}-${tag}.png`; await p.screenshot({ path: path.join(qtOut, f), fullPage: mobile }); if ((!mobile && theme === "light") || (mobile && theme === "dark")) qtShare.push(f); };
  const go = async (s, ids) => { await p.evaluate(([s, ids]) => window.__studyLab.start("subject", [s], { ids }), [s, ids]); await p.locator("#q-stem").waitFor(); await p.evaluate(() => document.fonts.ready); };
  const press = (loc) => (mobile ? loc.tap() : loc.click());
  await p.goto(BASE); await ready(p);
  const over = async (what) => { const o = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth); check(`${tag}: ${what} has no sideways scroll`, o <= 0, "overflow=" + o); };
  // Recall: a typo accepted
  await go("sci", ["sci-x0"]);
  await p.locator("#typed-input").fill("mitochondira");
  await qshot("01-recall-typing");
  await press(p.locator('[data-action="submit"]')); await p.locator("#feedback").waitFor();
  await qshot("02-recall-answered"); await over("Recall");
  // Recall: wrong, with the override
  await go("hist", ["hist-x0"]);
  await p.locator("#typed-input").fill("not sure");
  await press(p.locator('[data-action="submit"]')); await p.locator("#feedback").waitFor();
  await qshot("03-recall-wrong-with-override");
  // Explain why
  await go("econ", ["econ-x5"]);
  await p.locator("#explain-input").fill("Growth inside a TFSA is never taxed, so the whole return keeps compounding instead of losing a slice to tax each year.");
  await qshot("04-explain-writing");
  await press(p.locator('[data-action="reveal"]')); await p.locator(".model").waitFor();
  await qshot("05-explain-model-answer-self-grade"); await over("Explain why");
  // Put in order
  await go("sci", ["sci-x7"]);
  await press(p.locator('.order-row [data-action="move"][data-arg$=":down"]').first());
  await qshot("06-order-arranging"); await over("Put in order");
  await press(p.locator('[data-action="checkorder"]')); await p.locator("#feedback").waitFor();
  await qshot("07-order-checked");
  // Match
  await go("eng", ["eng-x9"]);
  const n = await p.locator('[data-action="pick"][data-arg^="L:"]').count();
  await press(p.locator('[data-action="pick"][data-arg="L:0"]')); await press(p.locator('[data-action="pick"][data-arg="R:0"]'));
  await press(p.locator('[data-action="pick"][data-arg="L:1"]')); await press(p.locator('[data-action="pick"][data-arg="R:2"]'));
  await press(p.locator('[data-action="pick"][data-arg="L:2"]'));
  await qshot("08-match-pairing"); await over("Match");
  await press(p.locator('[data-action="pick"][data-arg="R:1"]'));
  for (let i = 3; i < n; i++) { await press(p.locator(`[data-action="pick"][data-arg="L:${i}"]`)); await press(p.locator(`[data-action="pick"][data-arg="R:${i}"]`)); }
  await press(p.locator('[data-action="checkmatch"]')); await p.locator("#feedback").waitFor();
  await qshot("09-match-checked");
  // Reading set in a school subject
  await go("geo", ["geo-x10", "geo-x11", "geo-x12"]);
  await qshot("10-reading-passage"); await over("Reading");
  await p.context().close();
}
// ---- Sections menu: smooth hover (red pill + label grown to 1.04), desktop light + dark and phone dark, 2x ----
const msOut = path.join(out, "menu-smooth");
fs.mkdirSync(msOut, { recursive: true });
for (const [theme, phone] of [["light", false], ["dark", false], ["dark", true]]) {
  const ctx = await browser.newContext({ viewport: phone ? { width: 390, height: 844 } : { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: "window.STUDY_LAB_CONFIG={};" }));
  await ctx.addInitScript(([s, t]) => { if (sessionStorage.getItem("seeded")) return; sessionStorage.setItem("seeded", "1"); localStorage.setItem("study-lab-progress-v1", s); localStorage.setItem("study-lab-theme", t); }, [SEED, theme]);
  const p = await ctx.newPage();
  await p.goto(BASE); await ready(p);
  await p.evaluate(() => { const s = document.getElementById("subjects"); window.scrollTo(0, s.getBoundingClientRect().top + scrollY - 68); });
  if (phone) await p.locator("#menu-btn").tap(); else await p.locator("#menu-btn").hover();
  await p.waitForFunction(() => !document.getElementById("menu-panel").hidden);
  await p.waitForTimeout(300);
  const item = await p.locator("#menu-panel .menu-item.sub:not([aria-current])").nth(2).elementHandle();
  if (phone) await item.evaluate((b) => { const r = b.getBoundingClientRect(); const t = new Touch({ identifier: 1, target: b, clientX: r.left + 30, clientY: r.top + r.height / 2 }); b.closest(".menu-list").dispatchEvent(new TouchEvent("touchmove", { touches: [t], bubbles: true })); });
  else await item.hover();
  await p.waitForTimeout(400);
  const hov = await item.evaluate((b) => { const cs = getComputedStyle(b), pill = getComputedStyle(b, "::after"); return { color: cs.color, pill: pill.backgroundColor, opacity: pill.opacity, scale: new DOMMatrix(getComputedStyle(b.querySelector(".mi-label")).transform).a }; });
  const tag = phone ? `phone-390x844-${theme}-finger-slide` : `desktop-${theme}`;
  check(`menu smooth ${tag}: highlighted entry is red, on its pill, grown to ~1.04`, /^rgb\((200, 16, 46|255, 90, 95)\)/.test(hov.color) && hov.opacity === "1" && hov.scale > 1.03, JSON.stringify(hov));
  const r = await p.evaluate(() => document.getElementById("menu-panel").getBoundingClientRect().toJSON());
  await p.screenshot({ path: path.join(msOut, `menu-hover-${tag}.png`), clip: phone ? { x: 0, y: 0, width: 390, height: Math.min(844, r.bottom + 8) } : { x: 0, y: 0, width: Math.min(1440, r.right + 420), height: Math.min(900, r.bottom + 24) } });
  await ctx.close();
}
fs.copyFileSync(path.join(siteDir, "og.png"), path.join(out, "og.png"));
// JPEG copies under 400 KB for sharing (needs python3 + Pillow).
const share = process.env.SHARE_DIR || path.resolve(siteDir, "..", "review-share", "redesign");
const py = `
import os, sys
from PIL import Image
src, dst = sys.argv[1], sys.argv[2]
os.makedirs(dst, exist_ok=True)
for f in sorted(os.listdir(src)):
    if not f.endswith(".png"): continue
    im = Image.open(os.path.join(src, f)).convert("RGB")
    out = os.path.join(dst, f[:-4] + ".jpg")
    for q in (85, 78, 70, 62, 55):
        w = im
        while True:
            w.save(out, "JPEG", quality=q, optimize=True, progressive=True)
            if os.path.getsize(out) < 400_000 or w.width < 500: break
            w = w.resize((int(w.width * 0.85), int(w.height * 0.85)), Image.LANCZOS)
        if os.path.getsize(out) < 400_000: break
    print(f"{out} {os.path.getsize(out)//1024} KB")
`;
const { execFileSync } = await import("node:child_process");
console.log(execFileSync("python3", ["-c", py, out, share]).toString().trim());
const menuShare = process.env.MENU_SHARE_DIR || path.resolve(siteDir, "..", "review-share", "menu");
console.log(execFileSync("python3", ["-c", py, menuOut, menuShare]).toString().trim());
// Question formats: desktop light + phone dark copies for review.
const qtShareDir = process.env.QT_SHARE_DIR || path.resolve(siteDir, "..", "review-share", "question-types");
const qtTmp = fs.mkdtempSync(path.join(out, ".qt-"));
for (const f of qtShare) fs.copyFileSync(path.join(qtOut, f), path.join(qtTmp, f));
console.log(execFileSync("python3", ["-c", py, qtTmp, qtShareDir]).toString().trim());
fs.rmSync(qtTmp, { recursive: true });
const msShare = process.env.MENU_SMOOTH_SHARE_DIR || path.resolve(siteDir, "..", "review-share", "menu-smooth");
console.log(execFileSync("python3", ["-c", py, msOut, msShare]).toString().trim());
await browser.close(); server.kill();
console.log(failures ? failures + " failed" : "all review checks passed");
process.exitCode = failures ? 1 : 0;
