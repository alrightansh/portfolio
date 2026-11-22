// Reading pages: text, lists and images reveal once as they enter the viewport, with the flight's masked motion.
//   [data-split]  heading: characters rise (data-stagger ms apart, default 25), inline tags such as <sup> kept
//   [data-block]  paragraph or block: rises as one masked block, markup kept
//   [data-items]  list: each child rises as a block, ITEM_STAGGER ms apart, and its hairline draws in
//   [data-img]    figure: clip reveal from the bottom while the image settles from a slight zoom
// data-delay adds a start delay in ms. Without the script, page.css shows everything after 2.5 s.
import { splitInto, wrapInto, wrapAround, show, EASE, REDUCED } from "./ui.js";

export const ITEM_STAGGER = 60; // twice the flight's tick stagger

// Split an element's text into masked chars, keeping inline elements (sup, em, br) in place. The animated copy
// is hidden from assistive tech and a plain copy is read instead, so a heading is never spelled out letter by letter.
export function splitDeep(el, stagger = 25, base = 0) {
  const label = el.textContent.replace(/\s+/g, " ").trim();
  const chars = [];
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === Node.TEXT_NODE) {
        if (!child.textContent.trim()) continue;
        const seg = document.createElement("span");
        seg.setAttribute("aria-hidden", "true");
        node.replaceChild(seg, child);
        chars.push(...splitInto(seg, child.textContent, stagger, base + chars.length * stagger));
      } else if (child.nodeType === Node.ELEMENT_NODE && !child.classList.contains("sr-only")) walk(child);
    }
  };
  walk(el);
  const sr = document.createElement("span");
  sr.className = "sr-only";
  sr.textContent = label;
  el.prepend(sr);
  return chars;
}

// data-items="fade": items whose own box must stay intact (chips, definition rows) fade up 8 px instead,
// the flight's stat-number entrance, rather than rising inside a mask.
function fadeItem(item, delay) {
  item.style.transition = `transform 450ms ${EASE} ${delay}ms, opacity 360ms ease ${delay}ms`;
  item.style.transform = "translateY(8px)";
  item.style.opacity = "0";
  return item;
}

// Returns the parts to show and the element to watch (a mask placed around the element is watched instead of it,
// since the element itself sits clipped below the mask until it rises).
function prime(el) {
  const base = Number(el.dataset.delay || 0);
  if (el.hasAttribute("data-split")) return { parts: splitDeep(el, Number(el.dataset.stagger || 25), base), watch: el };
  if (el.hasAttribute("data-block")) {
    // a flex or grid container keeps its layout: the mask goes around it instead of inside it
    if (/flex|grid/.test(getComputedStyle(el).display)) {
      const parts = wrapAround(el, base);
      return { parts, watch: parts[0].parentElement };
    }
    return { parts: wrapInto(el, base), watch: el };
  }
  if (el.hasAttribute("data-items")) {
    const fade = el.dataset.items === "fade";
    const parts = [...el.children].flatMap((item, i) => {
      const delay = base + i * ITEM_STAGGER;
      item.style.setProperty("--d", `${delay}ms`);
      return fade ? [fadeItem(item, delay)] : wrapInto(item, delay);
    });
    return { parts, watch: el };
  }
  return { parts: [], watch: el };
}

export function initReveals(root = document) {
  const els = [...root.querySelectorAll("[data-split], [data-block], [data-items], [data-img]")];
  if (REDUCED || !("IntersectionObserver" in window)) {
    els.forEach((el) => el.classList.add("rv", "in"));
    return;
  }
  const primed = new Map(); // watched element -> { el, parts }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      const { el, parts } = primed.get(e.target);
      el.classList.add("in");
      show(parts);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  for (const el of els) {
    const { parts, watch } = prime(el);
    primed.set(watch, { el, parts });
    el.classList.add("rv");
    io.observe(watch);
  }
}
