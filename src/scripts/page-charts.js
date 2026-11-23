// Readouts for the charts on the reading pages (src/components/charts): hovering, tapping or focusing a mark's hit
// area shows its values, each value first with its series beside a short line key. Each chart is one tab stop; the
// arrow keys, Home and End move along its marks. Every value is also in the chart's table view, so nothing depends
// on this script.
const STEP = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
const EDGE = 8; // px kept clear of the viewport's edges
const OFFSET = 14; // px between the pointer and the readout

// Fills the readout from a hit's data-tip, {h: heading, r: [[value, name, series class], ...]}, as text only.
function fill(tip, hit) {
  let d;
  try {
    d = JSON.parse(hit.dataset.tip);
  } catch {
    return false;
  }
  const head = document.createElement("p");
  head.className = "chart-tip-head";
  head.textContent = d.h;
  const rows = d.r.map(([value, name, cls]) => {
    const row = document.createElement("p");
    row.className = "chart-tip-row";
    const key = document.createElement("i");
    key.className = `chart-tip-key ${cls}`.trim();
    const v = document.createElement("b");
    v.textContent = value;
    const s = document.createElement("span");
    s.textContent = name;
    row.append(key, v, s);
    return row;
  });
  tip.replaceChildren(head, ...rows);
  return true;
}

const hitOf = (e) => (e.target instanceof Element ? e.target.closest(".hit") : null);

export function initCharts() {
  const charts = [...document.querySelectorAll(".chart")];
  if (!charts.length) return;
  const tip = document.createElement("div");
  tip.className = "chart-tip";
  tip.setAttribute("aria-hidden", "true"); // assistive tech reads the focused mark's own label instead
  document.body.append(tip);
  let hot = null;

  const place = (x, y) => {
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const left = x + OFFSET + w > innerWidth - EDGE ? x - OFFSET - w : x + OFFSET;
    const top = Math.min(Math.max(EDGE, y - h - OFFSET), innerHeight - h - EDGE);
    tip.style.transform = `translate(${Math.round(Math.max(EDGE, left))}px, ${Math.round(top)}px)`;
  };
  const show = (hit, x, y) => {
    if (hit !== hot) {
      if (!fill(tip, hit)) return;
      if (hot) hot.classList.remove("hot");
      hot = hit;
      hit.classList.add("hot");
      tip.classList.add("on");
    }
    place(x, y);
  };
  const hide = () => {
    if (hot) hot.classList.remove("hot");
    hot = null;
    tip.classList.remove("on");
  };
  const atPointer = (e) => {
    const hit = hitOf(e);
    if (hit) show(hit, e.clientX, e.clientY);
    else hide();
  };

  for (const chart of charts) {
    const hits = [...chart.querySelectorAll(".hit")];
    hits.forEach((hit, i) => hit.setAttribute("tabindex", i === 0 ? "0" : "-1"));
    chart.addEventListener("pointermove", atPointer);
    chart.addEventListener("pointerdown", atPointer);
    // a finger lifting also "leaves", so only a mouse leaving hides the readout; a tap elsewhere or a scroll does
    chart.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") hide(); });
    chart.addEventListener("focusin", (e) => {
      const hit = hitOf(e);
      if (!hit) return;
      const r = hit.getBoundingClientRect();
      show(hit, r.left + r.width / 2, r.top);
    });
    chart.addEventListener("focusout", hide);
    chart.addEventListener("keydown", (e) => {
      const i = hits.indexOf(document.activeElement);
      if (i < 0) return;
      if (e.key === "Escape") {
        hide();
        return;
      }
      const j = e.key === "Home" ? 0 : e.key === "End" ? hits.length - 1 : e.key in STEP ? i + STEP[e.key] : -1;
      if (j < 0 || j >= hits.length) return;
      e.preventDefault();
      hits[i].setAttribute("tabindex", "-1");
      hits[j].setAttribute("tabindex", "0");
      hits[j].focus();
    });
  }
  document.addEventListener("pointerdown", (e) => { if (!(e.target instanceof Element && e.target.closest(".chart"))) hide(); });
  addEventListener("scroll", hide, { passive: true });
}
