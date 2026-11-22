// Build time only: a contour field for the reading pages' heroes, an echo of the flight's contour wire.
// Gradient noise (fBm) sampled on a grid, traced with marching squares, stitched into smooth SVG paths.

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function noise2(seed) {
  const r = rng(seed);
  const p = [...Array(256).keys()];
  for (let i = 255; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const g = Array.from({ length: 256 }, (_, i) => [Math.cos((i / 256) * Math.PI * 2), Math.sin((i / 256) * Math.PI * 2)]);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  const dot = (h, x, y) => g[h][0] * x + g[h][1] * y;
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255, xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = dot(aa, xf, yf) + u * (dot(ba, xf - 1, yf) - dot(aa, xf, yf));
    const x2 = dot(ab, xf, yf - 1) + u * (dot(bb, xf - 1, yf - 1) - dot(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  };
}

// Marching squares for one level: segments between edge crossings, keyed by edge so neighbours join exactly.
function trace(field, cols, rows, step, level) {
  const at = (i, j) => field[j * (cols + 1) + i];
  const pts = new Map();
  const point = (key, ax, ay, av, bx, by, bv) => {
    if (!pts.has(key)) {
      const t = (level - av) / (bv - av);
      pts.set(key, [(ax + (bx - ax) * t) * step, (ay + (by - ay) * t) * step]);
    }
    return key;
  };
  const adj = new Map();
  const link = (a, b) => {
    if (!adj.has(a)) adj.set(a, []);
    if (!adj.has(b)) adj.set(b, []);
    adj.get(a).push(b); adj.get(b).push(a);
  };
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i + 1, j + 1), d = at(i, j + 1);
      const idx = (a > level ? 8 : 0) | (b > level ? 4 : 0) | (c > level ? 2 : 0) | (d > level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const T = () => point(`h${i},${j}`, i, j, a, i + 1, j, b);
      const R = () => point(`v${i + 1},${j}`, i + 1, j, b, i + 1, j + 1, c);
      const B = () => point(`h${i},${j + 1}`, i, j + 1, d, i + 1, j + 1, c);
      const L = () => point(`v${i},${j}`, i, j, a, i, j + 1, d);
      const mid = (a + b + c + d) / 4 > level;
      switch (idx) {
        case 1: case 14: link(L(), B()); break;
        case 2: case 13: link(B(), R()); break;
        case 3: case 12: link(L(), R()); break;
        case 4: case 11: link(T(), R()); break;
        case 6: case 9: link(T(), B()); break;
        case 7: case 8: link(L(), T()); break;
        case 5: if (mid) { link(L(), T()); link(B(), R()); } else { link(L(), B()); link(T(), R()); } break;
        case 10: if (mid) { link(T(), R()); link(L(), B()); } else { link(L(), T()); link(B(), R()); } break;
      }
    }
  }
  // walk chains: open ones from their loose ends first, then the closed loops
  const seen = new Set(), lines = [];
  const walk = (start) => {
    const line = [start];
    seen.add(start);
    let cur = start;
    for (;;) {
      const next = (adj.get(cur) || []).find((k) => !seen.has(k));
      if (!next) break;
      seen.add(next); line.push(next); cur = next;
    }
    return line.map((k) => pts.get(k));
  };
  for (const [k, n] of adj) if (n.length === 1 && !seen.has(k)) lines.push(walk(k));
  for (const k of adj.keys()) if (!seen.has(k)) { const l = walk(k); l.push(l[0]); lines.push(l); }
  return lines;
}

// Smooth a polyline through the midpoints of its segments (quadratic curves), dropping near-duplicate points.
function toPath(line) {
  const p = [line[0]];
  for (const q of line.slice(1)) { const l = p[p.length - 1]; if (Math.hypot(q[0] - l[0], q[1] - l[1]) > 6) p.push(q); }
  if (p.length < 3) return "";
  const f = (n) => Math.round(n);
  let d = `M${f(p[0][0])} ${f(p[0][1])}`;
  for (let i = 1; i < p.length - 1; i++) {
    const mx = (p[i][0] + p[i + 1][0]) / 2, my = (p[i][1] + p[i + 1][1]) / 2;
    d += `Q${f(p[i][0])} ${f(p[i][1])} ${f(mx)} ${f(my)}`;
  }
  const z = p[p.length - 1];
  return `${d}L${f(z[0])} ${f(z[1])}`;
}

// { w, h, paths: [{ d, major, level }] } for a viewBox of w x h.
export function contourField({ seed = 7, w = 1600, h = 1000, step = 20, levels = 12, scale = 0.0016, minLength = 120 } = {}) {
  const n = noise2(seed);
  const cols = Math.ceil(w / step), rows = Math.ceil(h / step);
  const field = new Float32Array((cols + 1) * (rows + 1));
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j <= rows; j++) {
    for (let i = 0; i <= cols; i++) {
      const x = i * step * scale, y = j * step * scale;
      const v = n(x, y) + 0.5 * n(x * 2.1 + 17, y * 2.1 + 3) + 0.25 * n(x * 4.3 + 41, y * 4.3 + 29);
      field[j * (cols + 1) + i] = v;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  }
  const paths = [];
  for (let k = 1; k <= levels; k++) {
    const level = lo + ((hi - lo) * k) / (levels + 1);
    for (const line of trace(field, cols, rows, step, level)) {
      let len = 0;
      for (let i = 1; i < line.length; i++) len += Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]);
      if (len < minLength) continue;
      const d = toPath(line);
      if (d) paths.push({ d, major: k % 4 === 0, level: k });
    }
  }
  return { w, h, paths };
}
