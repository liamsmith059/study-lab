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
  ["--red-text", "--card", "Sections menu: current section"], ["--text", "--fill", "Sections menu: hovered / focused entry"],
  ["--red-text", "--bg", "Sections button while open (on the top bar)"],
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
  await p.locator('[data-arg="subject:eng"]').click(); await ready(p, ".question");
  await p.locator(".choice").first().click(); await p.locator(".callout").waitFor();
  await shot(p, `quiz-${theme}-desktop-after-answer.png`);
  for (let i = 0; i < 25 && (await p.locator(".choice").count()); i++) {
    if (await p.locator(".choice:not(:disabled)").count()) { await p.locator(".choice").nth(i % 3).click(); await p.locator(".callout").waitFor(); }
    await p.locator('[data-action="next"]').click();
  }
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
  await p.locator('[data-arg="subject:hist"]').tap(); await ready(p, ".question");
  await p.locator(".choice").first().tap(); await p.locator(".callout").waitFor(); await p.waitForTimeout(150);
  await shot(p, `quiz-phone-${theme}-after-answer.png`);
  const f = await p.evaluate(() => ({ focus: document.activeElement.dataset.action, nextBottom: Math.round(document.activeElement.getBoundingClientRect().bottom), vh: innerHeight }));
  check(`phone ${theme}: after answering, focus is on Next and it is on screen`, f.focus === "next" && f.nextBottom <= f.vh, JSON.stringify(f));
  for (let i = 0; i < 25 && (await p.locator(".choice").count()); i++) {
    if (await p.locator(".choice:not(:disabled)").count()) { await p.locator(".choice").nth(i % 2).tap(); await p.locator(".callout").waitFor(); }
    await p.locator('[data-action="next"]').tap();
  }
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
    await p.locator('[data-arg="subject:math"]').click();
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
await browser.close(); server.kill();
console.log(failures ? failures + " failed" : "all review checks passed");
process.exitCode = failures ? 1 : 0;
