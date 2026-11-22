// Small interactive pieces: code tabs and the equation line.
import { EASE, REDUCED } from "./ui.js";

// Code tabs (components/CodeTabs.astro): ARIA tabs; the chosen panel fades up like the flight's stat number.
export function initTabs() {
  for (const box of document.querySelectorAll("[data-tabs]")) {
    const tabs = [...box.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
    const select = (i, focus = false) => {
      tabs.forEach((t, k) => {
        const on = k === i;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panels[k].hidden = !on;
      });
      if (focus) tabs[i].focus();
      if (!REDUCED) panels[i].animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: EASE });
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(i));
      t.addEventListener("keydown", (e) => {
        const n = tabs.length;
        const to = { ArrowRight: (i + 1) % n, ArrowLeft: (i - 1 + n) % n, Home: 0, End: n - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        select(to, true);
      });
    });
  }
}

// Equation (components/Equation.astro): each term glows and lifts once in turn as it enters, like the RUSLE line
// in the flight; afterwards a term and its definition light together on hover.
export function initEquations() {
  for (const box of document.querySelectorAll("[data-eq]")) {
    const terms = [...box.querySelectorAll(".eq-line [data-term]")];
    const defs = [...box.querySelectorAll(".eq-def[data-term]")];
    const hot = (key) => {
      terms.forEach((t) => t.classList.toggle("hot", t.dataset.term === key));
      defs.forEach((d) => d.classList.toggle("on", d.dataset.term === key));
    };
    for (const el of [...terms, ...defs]) {
      el.addEventListener("pointerenter", () => hot(el.dataset.term));
      el.addEventListener("pointerleave", () => hot(null));
    }
    if (REDUCED || !("IntersectionObserver" in window)) continue;
    const keys = [...new Set(terms.map((t) => t.dataset.term))];
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      keys.forEach((k, i) => setTimeout(() => hot(k), 500 + i * 700));
      setTimeout(() => hot(null), 500 + keys.length * 700);
    }, { rootMargin: "0px 0px -20% 0px" });
    io.observe(box);
  }
}
