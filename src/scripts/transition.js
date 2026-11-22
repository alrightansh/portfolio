// Page changes between the flight and the reading pages: the loader's accent bar sweeps across the top while the
// page fades, and drains away on arrival. Same-origin links only; new tabs, hashes and modified clicks pass through.
import { EASE, REDUCED } from "./ui.js";

const LEAVE_MS = 360;

export function initTransitions({ arrive = true } = {}) {
  const bar = document.getElementById("bar");
  const root = document.documentElement;
  if (bar && arrive && !REDUCED) {
    bar.style.transformOrigin = "100% 50%";
    bar.animate([{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }], { duration: 700, easing: EASE, fill: "forwards" });
  }
  document.addEventListener("click", (e) => {
    const a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if ((a.target && a.target !== "_self") || a.hasAttribute("download")) return;
    const url = new URL(a.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname && url.search === location.search) return; // same page: hashes scroll or fly
    e.preventDefault();
    root.classList.add("leaving");
    if (bar && !REDUCED) {
      bar.getAnimations().forEach((an) => an.cancel());
      bar.style.transformOrigin = "0 50%";
      bar.animate([{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { duration: LEAVE_MS + 200, easing: EASE, fill: "forwards" });
    }
    setTimeout(() => location.assign(url.href), REDUCED ? 0 : LEAVE_MS);
  });
  // back/forward cache: the page returns as it was left, faded out, so undo the exit
  addEventListener("pageshow", (e) => {
    if (!e.persisted) return;
    root.classList.remove("leaving");
    if (bar) { bar.getAnimations().forEach((an) => an.cancel()); bar.style.transform = "scaleX(0)"; }
  });
}
