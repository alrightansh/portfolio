// DOM motion: per-character mask reveals, swapping chrome text, station labels, ticks, magnet button.

const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

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
      const delay = base + chars.length * stagger;
      inner.style.transition = `transform 320ms ${EASE} ${delay}ms, opacity 280ms ease ${delay}ms`;
      inner.style.transform = "translateY(110%)";
      inner.style.opacity = "0";
      mask.appendChild(inner);
      w.appendChild(mask);
      chars.push(inner);
    });
    el.appendChild(w);
  });
  return chars;
}

export function show(chars) {
  requestAnimationFrame(() => requestAnimationFrame(() => chars.forEach((c) => {
    c.style.transform = "translateY(0)"; c.style.opacity = "1";
  })));
}
export function hide(chars, up = true) {
  chars.forEach((c) => { c.style.transform = up ? "translateY(-110%)" : "translateY(110%)"; c.style.opacity = "0"; });
}

// Chrome label that rolls the old text up and the new text in from below.
export function swapper(el, stagger = 18) {
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
    chars = splitInto(layer, text, stagger);
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
      const c = splitInto(n, text, n.className === "st-cap" ? 6 : 25, base);
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

// Bottom station ticks: tall near the current station, short elsewhere.
export function makeTicks(host, count, onPick) {
  const ticks = [];
  for (let i = 0; i < count; i++) {
    const b = document.createElement("button");
    b.className = "tick";
    b.setAttribute("aria-label", `Jump to stop ${i + 1}`);
    const line = document.createElement("i");
    b.appendChild(line);
    b.addEventListener("click", () => onPick(i));
    host.appendChild(b);
    ticks.push(line);
  }
  let shownAt = -1, hiddenAt = -1;
  return {
    update(fIndex, visible, now) {
      if (visible && shownAt < 0) { shownAt = now; hiddenAt = -1; }
      if (!visible && shownAt >= 0 && hiddenAt < 0) hiddenAt = now;
      if (!visible && hiddenAt >= 0 && now - hiddenAt > 900) shownAt = -1;
      host.style.pointerEvents = visible ? "auto" : "none";
      ticks.forEach((t, i) => {
        const near = Math.max(0, 1 - Math.abs(i - fIndex) / 2);
        let h = 24 + near * near * (3 - 2 * near) * 40;
        const inK = shownAt < 0 ? 0 : Math.max(0, Math.min(1, (now - shownAt - 30 * i) / 520));
        h *= inK * inK * (3 - 2 * inK);
        if (hiddenAt >= 0) {
          const outK = Math.max(0, Math.min(1, (now - hiddenAt - (count - 1 - i) * 30) / 520));
          h *= 1 - outK * outK * (3 - 2 * outK);
        }
        const o = Math.max(0, 1 - Math.abs(i - fIndex) / 4);
        t.style.height = `${h}px`;
        t.style.opacity = String(0.15 + o * o * (3 - 2 * o) * 0.35);
      });
    },
  };
}

// Research HUD: step counter, stage name and text, equation highlight, counting stat, progress bar.
export function makeResearchHud(root, stages, terms, stageOf, subOf) {
  const q$ = (s) => root.querySelector(s);
  const idx = swapper(q$(".rs-idx")), name = swapper(q$(".rs-name"), 22);
  const text = swapper(q$(".rs-text"), 4), unit = swapper(q$(".rs-unit"), 10);
  const num = q$(".rs-num"), legend = q$(".rs-legend");
  const eq = [...root.querySelectorAll(".rs-eq [data-term]")];
  const bar = q$(".rs-bar"), pin = q$(".rs-place");
  stages.forEach(() => bar.appendChild(document.createElement("i")));
  const segs = [...bar.children];
  const head = [...root.querySelectorAll("[data-reveal-rs]")].map((el) => ({ el, text: el.dataset.revealRs, chars: [] }));
  let shown = false, key = "", stat = { cur: 0, target: 0, dp: 0 };
  const fmt = (v, dp) => v.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return {
    // Projected town label; p is {name, x, y} in CSS px, or null when the map is hidden.
    place(p) {
      pin.classList.toggle("on", Boolean(p) && shown);
      if (!p) return;
      if (pin.textContent !== p.name) pin.textContent = p.name;
      pin.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    },
    update(visible, q, dt) {
      if (visible !== shown) {
        shown = visible;
        root.classList.toggle("on", visible);
        head.forEach((h) => {
          if (visible) { h.chars = splitInto(h.el, h.text, 14); show(h.chars); } else hide(h.chars);
        });
        if (!visible) key = "";
      }
      if (!visible) return;
      const s = stageOf(q), sub = s === 3 ? subOf(q) : -1, st = stages[s];
      const k = `${s}:${sub}`;
      if (k !== key) {
        key = k;
        idx(`${String(s + 1).padStart(2, "0")} / ${String(stages.length).padStart(2, "0")}`);
        name(st.name);
        text(sub >= 0 ? st.sub[sub] : st.text);
        unit(st.unit);
        stat = { cur: stat.cur, target: st.stat, dp: st.dp };
        const hot = s === 2 ? "R" : sub >= 0 ? terms[sub + 1] : s >= 4 ? "A" : "";
        eq.forEach((e) => e.classList.toggle("hot", e.dataset.term === hot));
        segs.forEach((g, i) => g.classList.toggle("on", i <= s));
        legend.classList.toggle("on", s >= 4);
      }
      stat.cur += (stat.target - stat.cur) * Math.min(1, dt * 5);
      if (Math.abs(stat.target - stat.cur) < 10 ** -stat.dp / 2) stat.cur = stat.target;
      num.textContent = fmt(stat.cur, stat.dp);
    },
  };
}

// Springy magnetic pull toward the cursor.
export function magnet(el, radius, strength) {
  const s = { x: 0, y: 0, vx: 0, vy: 0 };
  return (dt, ptr, active) => {
    let tx = 0, ty = active ? 0 : 32;
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
    el.style.transform = `translate(calc(-50% + ${s.x.toFixed(2)}px), ${s.y.toFixed(2)}px)`;
  };
}
