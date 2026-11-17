// Light / dark theme. A classic script loaded in <head> so the theme applies before first paint.
// With no saved choice it follows the device setting; the toggle saves "light" or "dark" under
// "study-lab-theme" (same key as before, so a previously saved "light" still means light).
(function () {
  var KEY = "study-lab-theme";
  var COLORS = { light: "#f5f5f7", dark: "#000000" };
  var root = document.documentElement;
  var media = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  function saved() { try { var v = localStorage.getItem(KEY); return v === "light" || v === "dark" ? v : null; } catch (e) { return null; } }
  function system() { return media && media.matches ? "dark" : "light"; }
  function apply(theme) {
    root.setAttribute("data-theme", theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", COLORS[theme]);
    var btn = document.getElementById("theme-toggle");
    if (btn) {
      var dark = theme === "dark";
      btn.setAttribute("aria-pressed", dark ? "true" : "false");
      btn.setAttribute("aria-label", dark ? "Dark mode on. Switch to light mode" : "Switch to dark mode");
      btn.querySelector(".icon").textContent = dark ? "☀" : "☾";
      btn.querySelector(".label").textContent = dark ? "Light" : "Dark";
    }
  }
  var current = saved() || system();
  apply(current);
  if (media && media.addEventListener) media.addEventListener("change", function () { if (!saved()) { current = system(); apply(current); } });
  document.addEventListener("DOMContentLoaded", function () {
    apply(current);
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    btn.addEventListener("click", function () {
      current = current === "dark" ? "light" : "dark";
      try { localStorage.setItem(KEY, current); } catch (e) { /* storage blocked: applies for this visit */ }
      apply(current);
    });
  });
})();
