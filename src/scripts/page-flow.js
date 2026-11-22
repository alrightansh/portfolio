// Pipelines and architectures (components/Flow.astro). The rail draws in segment by segment, nodes rise in, and a
// single pulse runs the length of the flow (and back, for request/response flows). The stage HUD under the rail swaps
// index, name and text like a map stop. data-flow="scroll" pins the stage on desktop so each step plays with scroll.
import { wrapInto, show, swapper, EASE, REDUCED } from "./ui.js";

const pad = (n) => String(n).padStart(2, "0");
const DESKTOP = matchMedia("(min-width: 1024px)");

function setup(fig) {
  const steps = [...fig.querySelectorAll(".flow-step")];
  const nodes = steps.map((s) => s.querySelector(".flow-node"));
  // read the copy before the reveal wraps the labels
  const copy = steps.map((s) => ({ name: s.querySelector(".flow-name").textContent.trim(), text: s.querySelector(".flow-desc").textContent.trim() }));
  const idx = swapper(fig.querySelector(".fp-idx"));
  const name = swapper(fig.querySelector(".fp-name"), 22);
  const text = swapper(fig.querySelector(".fp-text"), 4, true);
  const segs = [...fig.querySelectorAll(".fp-bar i")];
  fig.style.setProperty("--n", String(steps.length));
  let active = -1;

  const set = (i) => {
    i = Math.max(0, Math.min(steps.length - 1, i));
    if (i === active) return;
    active = i;
    steps.forEach((s, k) => { s.classList.toggle("on", k === i); s.classList.toggle("past", k < i); });
    segs.forEach((g, k) => g.classList.toggle("on", k <= i));
    idx(`${pad(i + 1)} / ${pad(steps.length)}`);
    name(copy[i].name);
    text(copy[i].text);
  };

  nodes.forEach((n, i) => {
    n.addEventListener("pointerenter", () => set(i));
    n.addEventListener("focus", () => set(i));
    n.addEventListener("click", () => set(i));
    n.addEventListener("keydown", (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      nodes[Math.max(0, Math.min(nodes.length - 1, i + d))].focus();
    });
  });

  // scroll mode: while the stage is stuck, progress through the tall pin picks the step
  if (fig.dataset.flow === "scroll") {
    const pin = fig.querySelector(".flow-pin"), stage = fig.querySelector(".flow-stage");
    const apply = () => fig.classList.toggle("pinned", DESKTOP.matches && !REDUCED);
    apply();
    DESKTOP.addEventListener("change", apply);
    let queued = false;
    const onScroll = () => {
      queued = false;
      if (!fig.classList.contains("pinned")) return;
      const r = pin.getBoundingClientRect();
      if (r.top > innerHeight || r.bottom < 0) return;
      const stick = parseFloat(getComputedStyle(stage).top) || 0;
      const p = (stick - r.top) / Math.max(1, r.height - stage.offsetHeight);
      set(Math.floor(Math.max(0, Math.min(0.9999, p)) * steps.length));
    };
    addEventListener("scroll", () => { if (!queued) { queued = true; requestAnimationFrame(onScroll); } }, { passive: true });
  }

  if (REDUCED || !("IntersectionObserver" in window)) { set(0); return; }

  // entrance: arm the hidden state now (the figure is below the fold), play it once on entry.
  // Rail segments draw left to right; each dot pops as its segment arrives; labels rise in their masks.
  const linkAt = (i) => 200 + i * 110;
  const rises = steps.map((s, i) => wrapInto(s.querySelector(".flow-label"), 80 + i * 60));
  fig.querySelectorAll(".flow-link").forEach((l, i) => l.style.setProperty("--d", `${linkAt(i)}ms`));
  fig.classList.add("armed");
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    fig.classList.add("in");
    rises.forEach(show);
    fig.querySelectorAll(".flow-dot").forEach((d, i) => d.animate([{ transform: "scale(0)" }, { transform: "scale(1)" }],
      { duration: 520, delay: i ? linkAt(i - 1) + 260 : 120, easing: EASE, fill: "backwards" }));
    set(0);
    const drawn = 200 + (steps.length - 1) * 110 + 520;
    if (fig.dataset.flow !== "scroll") setTimeout(() => pulse(fig, fig.hasAttribute("data-return")), drawn);
  }, { rootMargin: "0px 0px -15% 0px" });
  io.observe(fig);
}

// One travelling pulse from the first node to the last; for request/response flows, a gold one returns.
function pulse(fig, back) {
  const stage = fig.querySelector(".flow-stage");
  const dots = [...fig.querySelectorAll(".flow-dot")];
  if (dots.length < 2 || !stage.offsetParent) return;
  const base = stage.getBoundingClientRect();
  const at = (d) => { const r = d.getBoundingClientRect(); return [r.left + r.width / 2 - base.left, r.top + r.height / 2 - base.top]; };
  const from = at(dots[0]), to = at(dots[dots.length - 1]);
  const run = (cls, a, b, delay) => {
    const p = document.createElement("span");
    p.className = `flow-pulse ${cls}`;
    p.setAttribute("aria-hidden", "true");
    stage.appendChild(p);
    // the pulse is 10 px wide: centre it on the dot
    const key = ([x, y], opacity, offset) => ({ transform: `translate(${x - 5}px, ${y - 5}px)`, opacity, offset });
    const anim = p.animate([key(a, 0, 0), key(a, 1, 0.08), key(b, 1, 0.9), key(b, 0, 1)],
      { duration: 1600, delay, easing: EASE, fill: "both" });
    anim.onfinish = () => p.remove();
  };
  run("", from, to, 0);
  if (back) run("back", to, from, 1500);
}

export function initFlows() {
  document.querySelectorAll("[data-flow]").forEach(setup);
}
