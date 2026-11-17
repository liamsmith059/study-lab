// "Sections" menu in the top bar: a dropdown listing the page's headings, built from the DOM.
// Top-level entries are the home page's sections (each a direct child of #app with an h2); entries
// indented under them are that section's h3 sub-headings. Opens on hover (with a short close delay)
// on mouse devices, and on click / tap / Enter / ArrowDown everywhere.

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "section";
const reduceMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Short label for a section: its kicker's first part ("LSAT prep · Level 1…" -> "LSAT prep"), else its h2.
function sectionLabel(sec, h2) {
  const k = sec.querySelector(":scope > .kicker");
  const t = k ? k.textContent.split("·")[0].trim() : "";
  return t || h2.textContent.trim();
}

// Give every section and sub-heading a stable id (kept if it already has one) and return the outline.
export function tagSections(container) {
  const out = [];
  for (const sec of container.children) {
    const h2 = sec.querySelector("h2");
    if (!h2 || sec.tagName === "FOOTER") continue;
    const label = sectionLabel(sec, h2);
    if (!sec.id) sec.id = "sec-" + slug(label);
    const subs = [];
    for (const h3 of sec.querySelectorAll("h3")) {
      const text = h3.textContent.trim();
      if (!text) continue;
      if (!h3.id) h3.id = sec.id + "-" + slug(text);
      subs.push({ id: h3.id, label: text });
    }
    out.push({ id: sec.id, label, subs });
  }
  return out;
}

const navOffset = () => { const n = document.getElementById("nav"); return n ? n.getBoundingClientRect().height : 0; };

// Scroll a section or sub-heading into view below the sticky bar(s), open its <details>, and move focus there.
export function scrollToSection(id) {
  const el = document.getElementById(id);
  if (!el) return false;
  const det = el.tagName === "DETAILS" ? el : el.closest("details");
  if (det && !det.open) det.open = true;
  const box = el.tagName === "H3" ? el.closest(".tile, li") || el : el;
  const top = Math.max(0, box.getBoundingClientRect().top + window.scrollY - navOffset() - 16);
  window.scrollTo({ top, behavior: reduceMotion() ? "auto" : "smooth" });
  const heading = el.matches("h2, h3") ? el : el.querySelector("h2");
  const focusEl = (heading && heading.querySelector("button")) || heading || el;
  if (!focusEl.matches("button, a, input, textarea, select, [tabindex]")) focusEl.setAttribute("tabindex", "-1");
  focusEl.focus({ preventScroll: true });
  return true;
}

// opts.source(): { el, live } – the element whose sections to list, and whether it's the page on screen.
// opts.go(id): navigate to a section id (the app may first leave a round). opts.note(): optional hint text.
export function initMenu(opts) {
  const wrap = document.getElementById("menu");
  const btn = document.getElementById("menu-btn");
  const panel = document.getElementById("menu-panel");
  const list = panel && panel.querySelector(".menu-list");
  const noteEl = panel && panel.querySelector(".menu-note");
  if (!wrap || !btn || !panel || !list) return { refresh() {}, close() {} };
  let open = false, pinned = false, openTimer = 0, closeTimer = 0, live = false;
  const hoverable = window.matchMedia("(hover: hover) and (pointer: fine)");

  const items = () => Array.from(list.querySelectorAll(".menu-item"));
  function build() {
    const src = opts.source();
    live = !!src.live;
    const outline = src.el ? tagSections(src.el) : [];
    list.innerHTML = outline.map((s) => `<li><button type="button" class="menu-item top" data-target="${s.id}">${esc(s.label)}</button>${
      s.subs.length ? `<ul>${s.subs.map((x) => `<li><button type="button" class="menu-item sub" data-target="${x.id}">${esc(x.label)}</button></li>`).join("")}</ul>` : ""}</li>`).join("");
    const note = opts.note ? opts.note() : "";
    if (noteEl) { noteEl.textContent = note; noteEl.hidden = !note; }
    spy();
  }
  // Highlight the section (and sub-heading) currently at the top of the page.
  function spy() {
    for (const b of items()) b.removeAttribute("aria-current");
    if (!live || !open) return;
    const line = navOffset() + 40;
    let cur = null;
    for (const b of items()) {
      const el = document.getElementById(b.dataset.target);
      if (!el) continue;
      const box = b.classList.contains("sub") ? el.closest(".tile, li") || el : el;
      if (box.getBoundingClientRect().top <= line) cur = b; else if (b.classList.contains("top")) break;
    }
    // Scrolled to the very bottom: the last section is current once it is on screen, even if it is too short to reach the line.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      const tops = items().filter((b) => b.classList.contains("top"));
      const last = tops[tops.length - 1], el = last && document.getElementById(last.dataset.target);
      if (el && el.getBoundingClientRect().top < window.innerHeight && (!cur || !last.parentElement.contains(cur))) cur = last;
    }
    if (!cur) return;
    cur.setAttribute("aria-current", "location");
    if (cur.classList.contains("sub")) {
      const parent = cur.closest("ul").closest("li").querySelector(".menu-item.top");
      if (parent) parent.setAttribute("aria-current", "true");
    }
  }
  function show(how) {
    clearTimeout(closeTimer); clearTimeout(openTimer);
    if (how === "click") pinned = true;
    if (open) return;
    open = true;
    build();
    panel.hidden = false;
    wrap.classList.add("open");
    btn.setAttribute("aria-expanded", "true");
  }
  function hide(returnFocus) {
    clearTimeout(closeTimer); clearTimeout(openTimer);
    if (!open) return;
    open = false; pinned = false;
    panel.hidden = true;
    wrap.classList.remove("open");
    btn.setAttribute("aria-expanded", "false");
    if (returnFocus) btn.focus();
  }

  btn.addEventListener("click", () => {
    // A hover-opened menu stays open (pinned) on the first click instead of snapping shut.
    if (open && !pinned) { pinned = true; return; }
    if (open) hide(false); else show("click");
  });
  wrap.addEventListener("mouseenter", () => {
    if (!hoverable.matches) return;
    clearTimeout(closeTimer);
    if (!open) openTimer = setTimeout(() => show("hover"), 90);
  });
  wrap.addEventListener("mouseleave", () => {
    if (!hoverable.matches) return;
    clearTimeout(openTimer);
    if (open && !pinned) closeTimer = setTimeout(() => hide(false), 280);
  });
  list.addEventListener("click", (e) => {
    const b = e.target.closest(".menu-item");
    if (!b) return;
    const id = b.dataset.target;
    hide(false);
    if (!opts.go(id)) btn.focus();
  });
  wrap.addEventListener("keydown", (e) => {
    const inPanel = panel.contains(e.target);
    if (e.key === "Escape" && open) { e.preventDefault(); e.stopPropagation(); hide(true); return; }
    if (e.target === btn && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault(); e.stopPropagation(); show("click");
      const all = items(); if (all.length) (e.key === "ArrowUp" ? all[all.length - 1] : all[0]).focus();
      return;
    }
    if (!inPanel) return;
    // Keys pressed inside the open menu belong to the menu, not to the quiz's answer shortcuts.
    e.stopPropagation();
    const all = items(); const i = all.indexOf(document.activeElement);
    let to = -1;
    if (e.key === "ArrowDown") to = (i + 1) % all.length;
    else if (e.key === "ArrowUp") to = (i - 1 + all.length) % all.length;
    else if (e.key === "Home") to = 0;
    else if (e.key === "End") to = all.length - 1;
    if (to >= 0 && all.length) { e.preventDefault(); all[to].focus(); }
  });
  // Tabbing out of the menu, or clicking/tapping anywhere else, closes it.
  wrap.addEventListener("focusout", (e) => { if (open && e.relatedTarget && !wrap.contains(e.relatedTarget)) hide(false); });
  document.addEventListener("pointerdown", (e) => { if (open && !wrap.contains(e.target)) hide(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && open && !wrap.contains(e.target)) hide(false); });
  let ticking = false;
  window.addEventListener("scroll", () => {
    if (!open || ticking) return;
    ticking = true;
    requestAnimationFrame(() => { ticking = false; spy(); });
  }, { passive: true });

  return { refresh() { if (open) build(); }, close: () => hide(false), isOpen: () => open };
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }
