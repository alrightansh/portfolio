// Utility Network schematic (components/NetworkDiagram.astro).
// Entrance: the feeder energises outward from the substation; lines draw, parts pop in, labels follow.
// Legend: pointing at a term isolates its parts in the drawing; a click pins it.
// Trace: a subnetwork trace runs from the breaker at a steady speed, splits at the tap, stops at the open point, and
// the traced extent then shows as the stored SubnetLine.
import { swapper, EASE, REDUCED } from "./ui.js";

const SPEED = 0.42; // viewBox units per ms for the trace front

function setup(box) {
  const svg = box.querySelector(".net-svg");
  const parts = [...svg.querySelectorAll("[data-part]")];
  const keysOf = new Map(parts.map((p) => [p, p.dataset.part.split(" ")]));
  const btns = [...box.querySelectorAll(".lg-btn")];
  const statusEl = box.querySelector(".net-status");
  const first = statusEl.textContent.trim();
  statusEl.textContent = "";
  const status = swapper(statusEl, 4, true);
  status(first);

  // legend
  let pinned = null;
  const isolate = (key) => {
    box.classList.toggle("focus", Boolean(key));
    parts.forEach((p) => p.classList.toggle("hot", Boolean(key) && keysOf.get(p).includes(key)));
    btns.forEach((b) => b.classList.toggle("on", b.dataset.key === key));
  };
  for (const b of btns) {
    const k = b.dataset.key;
    b.addEventListener("pointerenter", () => { if (!pinned) isolate(k); });
    b.addEventListener("pointerleave", () => { if (!pinned) isolate(null); });
    b.addEventListener("focus", () => { if (!pinned) isolate(k); });
    b.addEventListener("blur", () => { if (!pinned) isolate(null); });
    b.addEventListener("click", () => {
      pinned = pinned === k ? null : k;
      btns.forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.key === pinned)));
      isolate(pinned || k);
    });
  }

  // trace
  const btn = box.querySelector("[data-trace]");
  const traces = [...svg.querySelectorAll(".trace")];
  const ring = svg.querySelector(".op-ring");
  let running = false;
  btn.addEventListener("click", () => {
    if (running) return;
    running = true;
    btn.disabled = true;
    box.classList.remove("show-mv");
    traces.forEach((t) => t.getAnimations().forEach((a) => a.cancel()));
    const lens = traces.map((t) => t.getTotalLength());
    const lead = lens[0] / SPEED;
    const end = REDUCED ? 0 : lead + Math.max(...lens.slice(1)) / SPEED;
    status("Tracing the subnetwork from its controller.");
    traces.forEach((t, i) => t.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: REDUCED ? 0 : lens[i] / SPEED, delay: REDUCED || i === 0 ? 0 : lead, easing: "linear", fill: "forwards" }));
    setTimeout(() => {
      if (!REDUCED) ring.animate([{ opacity: 1, transform: "scale(0.5)" }, { opacity: 0, transform: "scale(1.7)" }], { duration: 900, easing: EASE });
      status("It stops at the open point, the edge of this feeder.");
    }, end);
    setTimeout(() => {
      box.classList.add("show-mv");
      status("Update Subnetwork stores the traced extent as a SubnetLine.");
      btn.textContent = "Run the trace again";
      btn.disabled = false;
      running = false;
    }, REDUCED ? 0 : end + 1400);
  });

  // entrance, played once
  if (REDUCED || !("IntersectionObserver" in window)) return;
  for (const el of svg.querySelectorAll(".draw, .pop, .fade, text")) {
    const x = el.getBBox().x;
    const d = 80 + x * 0.9 + (el.tagName === "text" ? 320 : el.classList.contains("pop") ? 140 : 0);
    el.style.setProperty("--d", `${Math.round(d)}ms`);
  }
  box.classList.add("armed");
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((e) => e.isIntersecting)) return;
    io.disconnect();
    box.classList.add("in");
  }, { rootMargin: "0px 0px -20% 0px" });
  io.observe(svg);
}

export function initNetworks() {
  document.querySelectorAll("[data-net]").forEach(setup);
}
