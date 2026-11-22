// DOM motion: per-character mask reveals, swapping chrome text, station labels, ticks, magnet button.
// Shared by the flight and the reading pages (page.js), so both move the same way.

export const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";
// Reduced motion: the same reveals become short fades in place, with no travel.
export const REDUCED = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

function prime(inner, ms, opacityMs, delay) {
  inner.style.transition = REDUCED ? `opacity 200ms ease ${Math.min(delay, 200)}ms`
    : `transform ${ms}ms ${EASE} ${delay}ms, opacity ${opacityMs}ms ease ${delay}ms`;
  inner.style.transform = REDUCED ? "none" : "translateY(110%)";
  inner.style.opacity = "0";
}

// Split text into masked characters (words kept unbreakable). Returns the inner char spans.
export function splitInto(el, text, stagger = 18, base = 0) {
  el.textContent = "";
  const chars = [];
  text.split(/(\s+)/).forEach((word) => {
    if (!word) return;
    if (/^\s+$/.test(word)) { el.appendChild(document.createTextNode(" ")); return; }
    const w = document.createElement("span");
    w.className = "wd";
    [...word].forEach((ch) => {
      const mask = document.createElement("span");
      mask.className = "ch";
      const inner = document.createElement("span");
      inner.textContent = ch;
      prime(inner, 320, 280, base + chars.length * stagger);
      mask.appendChild(inner);
      w.appendChild(mask);
      chars.push(inner);
    });
    el.appendChild(w);
  });
  return chars;
}

// Paragraph text rises in as one masked block instead of letter by letter, so it can be read as it lands.
// Returns the block in an array, so show() and hide() treat it like a run of chars.
export function blockInto(el, text, base = 0) {
  el.textContent = "";
  const mask = document.createElement("span");
  mask.className = "blk";
  const inner = document.createElement("span");
  inner.textContent = text;
  prime(inner, 420, 360, base);
  mask.appendChild(inner);
  el.appendChild(mask);
  return [inner];
}

// The same masked block rise for an element that keeps its own markup (links, code, lists).
export function wrapInto(el, base = 0) {
  const mask = document.createElement("span");
  mask.className = "blk";
  const inner = document.createElement("span");
  inner.append(...el.childNodes);
  prime(inner, 420, 360, base);
  mask.appendChild(inner);
  el.appendChild(mask);
  return [inner];
}

// The same rise around an element whose own layout (flex, grid) must stay intact: the mask goes outside it.
export function wrapAround(el, base = 0) {
  const mask = document.createElement("div");
  mask.className = "blk";
  const inner = document.createElement("div");
  el.replaceWith(mask);
  inner.appendChild(el);
  mask.appendChild(inner);
  prime(inner, 420, 360, base);
  return [inner];
}

// Chars hidden again before their reveal frame (a fast jump past a station) must stay hidden.
const hiddenSince = new WeakSet();
export function show(chars) {
  chars.forEach((c) => hiddenSince.delete(c));
  requestAnimationFrame(() => requestAnimationFrame(() => chars.forEach((c) => {
    if (hiddenSince.has(c)) return;
    c.style.transform = REDUCED ? "none" : "translateY(0)"; c.style.opacity = "1";
  })));
}
export function hide(chars, up = true) {
  chars.forEach((c) => {
    hiddenSince.add(c);
    if (!REDUCED) c.style.transform = up ? "translateY(-110%)" : "translateY(110%)";
    c.style.opacity = "0";
  });
}

// Chrome label that rolls the old text up and the new text in from below (block: as one paragraph).
export function swapper(el, stagger = 18, block = false) {
  let current = "", layer = null, chars = [];
  el.classList.add("swap");
  return (text) => {
    if (text === current) return;
    if (layer) {
      const old = layer, oldChars = chars;
      old.setAttribute("aria-hidden", "true");
      hide(oldChars);
      setTimeout(() => old.remove(), stagger * current.length + 360);
    }
    current = text;
    layer = document.createElement("span");
    layer.className = "swap-layer";
    chars = block ? blockInto(layer, text) : splitInto(layer, text, stagger);
    el.appendChild(layer);
    show(chars);
  };
}

// A station label: optional pre-line, big title (+ superscript), optional post-line and caption.
export function makeLabel(host, def) {
  const el = document.createElement("div");
  el.className = "st-label";
  const parts = [];
  const add = (cls, text, tag = "div") => {
    if (!text) return null;
    const n = document.createElement(tag);
    n.className = cls;
    el.appendChild(n);
    parts.push({ n, text });
    return n;
  };
  add("st-pre", def.pre);
  const title = add("st-title", def.title);
  add("st-post", def.post);
  add("st-cap", def.caption);
  if (def.href) {
    const a = document.createElement("a");
    a.className = "st-link"; a.href = def.href; a.rel = "noopener"; a.textContent = def.linkText;
    el.appendChild(a);
  }
  host.appendChild(el);
  let chars = [], shown = false;
  const build = () => {
    chars = [];
    let base = 0;
    parts.forEach(({ n, text }) => {
      const c = n.className === "st-cap" ? blockInto(n, text, base) : splitInto(n, text, 25, base);
      base += Math.min(c.length * 12, 260);
      chars.push(...c);
    });
    if (title && def.sup) {
      const s = document.createElement("sup");
      title.appendChild(s);
      chars.push(...splitInto(s, def.sup, 25, base));
    }
  };
  build();
  return {
    set(visible) {
      if (visible === shown) return false;
      shown = visible;
      el.classList.toggle("on", visible);
      if (visible) { build(); show(chars); } else hide(chars);
      return visible;
    },
  };
}

// Bottom station ticks: tall near the current station, short elsewhere. labels: optional accessible names.
export function makeTicks(host, count, onPick, labels = []) {
  const ticks = [];
  for (let i = 0; i < count; i++) {
    const b = document.createElement("button");
    b.className = "tick";
    b.setAttribute("aria-label", labels[i] || `Jump to stop ${i + 1}`);
    const line = document.createElement("i");
    b.appendChild(line);
    b.addEventListener("click", () => onPick(i));
    host.appendChild(b);
    ticks.push(line);
  }
  // Each tick rises over 520 ms, 30 ms after its left neighbour, and sinks right to left. Progress is kept per tick,
  // so showing them again halfway through sinking turns them around where they are.
  const rise = new Float32Array(count);
  let want = false, changedAt = 0, last = -1;
  return {
    update(fIndex, visible, now) {
      if (visible !== want) { want = visible; changedAt = now; }
      const dt = last < 0 ? 0 : Math.min(50, now - last);
      last = now;
      host.style.pointerEvents = visible ? "auto" : "none";
      ticks.forEach((t, i) => {
        const delay = 30 * (want ? i : count - 1 - i);
        if (now - changedAt >= delay) rise[i] = Math.max(0, Math.min(1, rise[i] + (want ? dt : -dt) / 520));
        const k = rise[i] * rise[i] * (3 - 2 * rise[i]);
        const near = Math.max(0, 1 - Math.abs(i - fIndex) / 2);
        const h = (24 + near * near * (3 - 2 * near) * 40) * k;
        const o = Math.max(0, 1 - Math.abs(i - fIndex) / 4);
        t.style.height = `${h}px`;
        t.style.opacity = String(0.15 + o * o * (3 - 2 * o) * 0.35);
      });
    },
  };
}

// Research HUD: step counter, stage name and text, equation highlight, counting stat, legend,
// progress bar, and the map overlay (labels, north arrow, scale bar).
export function makeResearchHud(root, stages, terms, stageOf, subOf) {
  const q$ = (s) => root.querySelector(s);
  const idx = swapper(q$(".rs-idx")), name = swapper(q$(".rs-name"), 22);
  const text = swapper(q$(".rs-text"), 4, true), unit = swapper(q$(".rs-unit"), 10, true);
  const num = q$(".rs-num"), legend = q$(".rs-legend"), eqLine = q$(".rs-eq");
  const north = q$(".rs-north"), scale = q$(".rs-scale"), scaleBar = q$(".rs-scale i"), scaleText = q$(".rs-scale span");
  const eq = [...root.querySelectorAll(".rs-eq [data-term]")];
  const bar = q$(".rs-bar"), pinHost = q$(".rs-places"), pins = [];
  stages.forEach(() => bar.appendChild(document.createElement("i")));
  const segs = [...bar.children];
  const head = [...root.querySelectorAll("[data-reveal-rs]")].map((el) => ({ el, text: el.dataset.revealRs, chars: [] }));
  let shown = false, key = "", stageAt = -1, st = stages[0], stat = { cur: 0, target: 0, dp: 0 }, legendKey = "", legendTimer = 0;
  const fmt = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  // legend: a colour ramp ["ramp", low, high, optional ramp class], or swatches [class suffix, label]
  const swatch = (cls) => { const i = document.createElement("i"); i.className = cls; return i; };
  const legendItem = ([k, a, b, c]) => {
    const span = document.createElement("span");
    if (k === "ramp") { span.className = "lg-ramp"; span.append(a, swatch(c ? `lg-bar lg-bar-${c}` : "lg-bar"), b); } else span.append(swatch(`lg-${k}`), a);
    return span;
  };
  const setLegend = (items) => {
    const k = JSON.stringify(items);
    if (k === legendKey) return;
    legendKey = k;
    legend.classList.remove("on");
    clearTimeout(legendTimer);
    legendTimer = setTimeout(() => { legend.replaceChildren(...items.map(legendItem)); legend.classList.toggle("on", items.length > 0); }, 300);
  };
  const fade = (el, a) => { el.style.opacity = a > 0.004 ? a.toFixed(3) : "0"; };
  return {
    // Map overlay from research.overlay(): labels [{name, cls, x, y, a}], north and scale; null when hidden.
    place(o) {
      const list = o && shown ? o.labels : [];
      while (pins.length < list.length) pins.push(pinHost.appendChild(document.createElement("div")));
      pins.forEach((el, i) => {
        const p = list[i];
        fade(el, p ? p.a : 0);
        if (!p || p.a <= 0.004) return;
        const cls = `rs-place ${p.cls}`;
        if (el.textContent !== p.name || el.className !== cls) { el.textContent = p.name; el.className = cls; }
        const shift = el.classList.contains("big") ? " translate(-50%, -50%)" : el.classList.contains("flip") ? " translateX(-100%)" : "";
        el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)${shift}`;
      });
      const n = o && shown ? o.north : null, s = o && shown ? o.scale : null;
      fade(north, n ? n.a : 0);
      if (n && n.a > 0.004) north.style.transform = `translate(${n.x.toFixed(1)}px, ${n.y.toFixed(1)}px) rotate(${n.rot.toFixed(3)}rad) scaleY(${n.sy.toFixed(3)})`;
      fade(scale, s ? s.a : 0);
      if (s && s.a > 0.004) {
        scale.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
        scaleBar.style.width = `${s.w.toFixed(1)}px`;
        if (scaleText.textContent !== s.text) scaleText.textContent = s.text;
      }
    },
    // live: the value for a stage whose stat is "live" (the zoom's magnification)
    update(visible, q, dt, live) {
      if (visible !== shown) {
        shown = visible;
        root.classList.toggle("on", visible);
        head.forEach((h) => {
          if (visible) { h.chars = splitInto(h.el, h.text, 14); show(h.chars); } else hide(h.chars);
        });
        if (!visible) { key = ""; stageAt = -1; }
      }
      if (!visible) return;
      const s = stageOf(q), d = stages[s], sub = d.sub ? subOf(q) : -1;
      const k = `${s}:${sub}`;
      if (k !== key) {
        key = k;
        st = d;
        idx(`${String(s + 1).padStart(2, "0")} / ${String(stages.length).padStart(2, "0")}`);
        name(d.name);
        text(sub >= 0 ? d.sub[sub] : d.text);
        unit(d.unit);
        if (s !== stageAt) {
          // each stage's figure has its own unit: show it at once, not counting through values that mean nothing
          stageAt = s;
          const target = d.stat === "live" ? live : d.stat;
          stat = { cur: target, target, dp: d.dp };
          num.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], { duration: 450, easing: EASE });
        }
        // the equation shows only with the factors and the soil loss they multiply into
        const hot = d.eq ? (sub >= 0 ? terms[sub] : "A") : "";
        eq.forEach((e) => e.classList.toggle("hot", e.dataset.term === hot));
        eqLine.classList.toggle("on", Boolean(d.eq));
        segs.forEach((g, i) => g.classList.toggle("on", i <= s));
        setLegend(d.ramps ? [["ramp", ...d.ramps[Math.max(0, sub)]]] : d.legend || []);
      }
      if (st.stat === "live") stat.target = live;
      stat.cur += (stat.target - stat.cur) * Math.min(1, dt * 5);
      if (Math.abs(stat.target - stat.cur) < 10 ** -stat.dp / 2) stat.cur = stat.target;
      num.textContent = fmt(stat.cur, stat.dp);
    },
  };
}

// Springy magnetic pull toward the cursor. x: the element's own horizontal offset (the flight's button is
// centred with -50%); rest: how far below its place it waits while inactive.
export function magnet(el, radius, strength, { x = "-50%", rest = 32 } = {}) {
  const s = { x: 0, y: 0, vx: 0, vy: 0 };
  return (dt, ptr, active) => {
    let tx = 0, ty = active ? 0 : rest;
    if (active && ptr.has) {
      const r = el.getBoundingClientRect();
      const dx = ptr.x - (r.left + r.width / 2), dy = ptr.y - (r.top + r.height / 2);
      const d = Math.hypot(dx, dy);
      if (d < radius) { const e = 1 - d / radius, k = e * e * (3 - 2 * e) * strength; tx = dx * k; ty = dy * k; }
    }
    const h = Math.min(dt, 0.05);
    s.vx += ((tx - s.x) * 280 - 20 * s.vx) * h;
    s.vy += ((ty - s.y) * 280 - 20 * s.vy) * h;
    s.x += s.vx * h; s.y += s.vy * h;
    el.style.transform = `translate(calc(${x} + ${s.x.toFixed(2)}px), ${s.y.toFixed(2)}px)`;
    return Math.abs(s.x - tx) + Math.abs(s.y - ty) + Math.abs(s.vx) + Math.abs(s.vy) > 0.05; // still moving
  };
}
