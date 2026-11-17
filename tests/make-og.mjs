// Renders the 1200x630 share image (../og.png) from inline HTML in the site's light design.
// Usage: cd tests && node make-og.mjs   (needs network for Google Fonts)
import { chromium } from "playwright-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOTAL_QUESTIONS } from "../js/engine.js"; // the count comes from the question banks, so it stays current
const here = path.dirname(fileURLToPath(import.meta.url));
const html = `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@600;700&family=Inter:wght@400;500&display=swap">
<style>
  html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#f5f5f7;-webkit-font-smoothing:antialiased}
  body{display:flex;align-items:center;justify-content:center;font-family:Inter,-apple-system,Helvetica,Arial,sans-serif}
  .c{text-align:center;color:#1d1d1f}
  .mark{display:inline-flex;align-items:center;justify-content:center;width:84px;height:84px;border-radius:20px;background:#e31937;color:#fff;font:700 36px "Inter Tight",Helvetica,Arial,sans-serif;letter-spacing:-.04em;margin-bottom:30px}
  h1{margin:0;font:600 150px/0.95 "Inter Tight",Helvetica,Arial,sans-serif;letter-spacing:-.055em}
  p{margin:26px auto 0;max-width:820px;font:400 34px/1.35 Inter,Helvetica,Arial,sans-serif;color:#6e6e73;letter-spacing:-.01em}
  .pills{margin-top:36px;display:flex;gap:14px;justify-content:center}
  .pill{font:500 24px Inter,Helvetica,Arial,sans-serif;padding:14px 30px;border-radius:999px;background:#e8e8ed;color:#1d1d1f}
  .pill.red{background:#e31937;color:#fff}
</style></head><body>
<div class="c"><div class="mark">SL</div><h1>Study Lab</h1>
<p>Six subjects plus LSAT prep, with spaced repetition and difficulty that climbs as you improve.</p>
<div class="pills"><span class="pill red">${TOTAL_QUESTIONS} questions</span><span class="pill">Real feedback on every answer</span></div></div></body></html>`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || "/usr/bin/google-chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.setContent(html, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: path.resolve(here, "..", "og.png") });
await browser.close();
console.log("wrote og.png (" + TOTAL_QUESTIONS + " questions)");
