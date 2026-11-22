// Reading-page chrome: top bar, menu overlay, hero drift, chapter ticks and the magnetic contact button.
import { splitInto, show, hide, swapper, makeTicks, magnet, REDUCED } from "./ui.js";

const $ = (s, r = document) => r.querySelector(s);

// The top bar gets a soft dark backing once text starts to scroll under it.
function initTopbar() {
  const top = $(".top");
  if (!top) return;
  const update = () => top.classList.toggle("scrolled", scrollY > 24);
  addEventListener("scroll", update, { passive: true });
  update();
}

// Menu: big links rise in letter by letter over the loader's dot grid; the label rolls Menu -> Close.
function initMenu() {
  const btn = $("#menuBtn"), menu = $("#menu");
  if (!btn || !menu) return;
  const labelEl = $("#menuLabel");
  labelEl.textContent = "";
  const label = swapper(labelEl);
  label("Menu");
  const links = [...menu.querySelectorAll("a")];
  const names = [...menu.querySelectorAll(".menu-name")].map((el) => ({ el, text: el.textContent, chars: [] }));
  let open = false, closeTimer = 0;

  const set = (want) => {
    if (want === open) return;
    open = want;
    clearTimeout(closeTimer);
    btn.setAttribute("aria-expanded", String(open));
    document.documentElement.classList.toggle("menu-open", open);
    label(open ? "Close" : "Menu");
    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => menu.classList.add("on"));
      let base = 80;
      names.forEach((n) => {
        n.chars = splitInto(n.el, n.text, 22, base);
        show(n.chars);
        base += Math.min(n.text.length * 12, 260) / 2;
      });
      setTimeout(() => links[0]?.focus({ preventScroll: true }), 60);
    } else {
      names.forEach((n) => hide(n.chars));
      menu.classList.remove("on");
      closeTimer = setTimeout(() => { menu.hidden = true; }, 420);
    }
  };
  btn.addEventListener("click", () => set(!open));
  addEventListener("keydown", (e) => {
    if (!open) return;
    if (e.key === "Escape") { set(false); btn.focus(); return; }
    if (e.key !== "Tab") return;
    // keep focus inside the menu and its toggle
    const ring = [btn, ...links], i = ring.indexOf(document.activeElement);
    const next = e.shiftKey ? (i <= 0 ? ring.length - 1 : i - 1) : (i === ring.length - 1 ? 0 : i + 1);
    e.preventDefault();
    ring[next].focus();
  });
}

// Hero words drift apart and fade over the first 700 px of scroll, as they do when the flight begins.
function initHero() {
  const hero = $(".hero"), a = $(".hero-a"), b = $(".hero-b");
  if (!hero || !a || !b || REDUCED) return;
  let queued = false;
  const update = () => {
    queued = false;
    const y = Math.max(0, scrollY);
    if (y > innerHeight * 1.5) return;
    a.style.transform = `translateX(${(y * 0.9).toFixed(1)}px)`;
    b.style.transform = `translateX(${(-y * 0.9).toFixed(1)}px)`;
    hero.style.setProperty("--hero-fade", String(1 - Math.min(1, y / 700)));
  };
  addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(update); } }, { passive: true });
  update();
}

// Chapter ticks: the flight's stop ticks, one per chapter, tall near the one being read. Over text they would get in
// the way, so they rise while the page moves (or the pointer comes near them) and sink again once reading resumes.
const TICKS_LINGER = 1600;
function initTicks() {
  const host = $("#ticks");
  const chapters = [...document.querySelectorAll("[data-chapter]")];
  if (!host) return;
  if (chapters.length < 3) { host.remove(); return; }
  const ticks = makeTicks(host, chapters.length,
    (i) => chapters[i].scrollIntoView({ behavior: REDUCED ? "auto" : "smooth", block: "start" }),
    chapters.map((c) => `Go to ${c.dataset.chapter}`));
  let active = 0, near = false, raf = 0;
  const frame = (now) => {
    const mid = innerHeight * 0.45;
    const tops = chapters.map((c) => c.getBoundingClientRect().top - mid);
    let f = 0;
    for (let i = 0; i < tops.length; i++) {
      if (tops[i] > 0) break;
      const span = i < tops.length - 1 ? tops[i + 1] - tops[i] : 1;
      f = i + (i < tops.length - 1 ? Math.min(1, -tops[i] / Math.max(1, span)) : 0);
    }
    const end = chapters[chapters.length - 1].getBoundingClientRect().bottom;
    const inside = tops[0] < innerHeight * 0.3 && end > innerHeight * 0.5;
    const visible = inside && (near || now - active < TICKS_LINGER || host.contains(document.activeElement));
    ticks.update(f, visible, now);
    // keep animating until the ticks have finished sinking after the last movement
    raf = near || now - active < TICKS_LINGER + 1200 ? requestAnimationFrame(frame) : 0;
  };
  const kick = () => { active = performance.now(); if (!raf) raf = requestAnimationFrame(frame); };
  addEventListener("scroll", kick, { passive: true });
  addEventListener("resize", kick);
  addEventListener("pointermove", (e) => {
    const was = near;
    near = e.clientY > innerHeight - 120 && Math.abs(e.clientX - innerWidth / 2) < 220;
    if (near !== was) kick();
  }, { passive: true });
  host.addEventListener("focusin", kick);
  kick();
}

// The contact button leans toward the cursor like the flight's outro button. Runs only while the pointer is near.
function initMagnets() {
  if (REDUCED || matchMedia("(pointer: coarse)").matches) return;
  for (const el of document.querySelectorAll("[data-magnet]")) {
    const pull = magnet(el, 220, 0.35, { x: "0px", rest: 0 });
    const ptr = { x: 0, y: 0, has: false };
    let raf = 0, last = 0;
    const loop = (now) => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const r = el.getBoundingClientRect();
      const near = ptr.has && Math.hypot(ptr.x - (r.left + r.width / 2), ptr.y - (r.top + r.height / 2)) < 280;
      const moving = pull(dt, ptr, true);
      raf = near || moving ? requestAnimationFrame(loop) : 0;
    };
    addEventListener("pointermove", (e) => {
      ptr.x = e.clientX; ptr.y = e.clientY; ptr.has = true;
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(loop); }
    }, { passive: true });
  }
}

// Hero contour field: lines draw in once, level by level.
function initContours() {
  for (const svg of document.querySelectorAll(".contours")) {
    if (REDUCED) continue;
    const paths = [...svg.querySelectorAll("path")];
    paths.forEach((p) => p.style.setProperty("--d", `${120 + Number(p.dataset.level || 0) * 90}ms`));
    svg.classList.add("armed");
    requestAnimationFrame(() => requestAnimationFrame(() => svg.classList.add("in")));
  }
}

export function initChrome() {
  initTopbar();
  initMenu();
  initHero();
  initTicks();
  initMagnets();
  initContours();
}
