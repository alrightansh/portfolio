// Neugal watershed data: decodes neugal-dem.bin (built by tools/research/build_dem.py), derives the
// drainage network, and runs the runoff physics for water and soil particles.

// Bounding box from the dissertation graticule; used for cell sizes in metres.
const LAT0 = 31.89087, LAT1 = 32.25436, LON_SPAN = 0.29355;
const M_PER_DEG = 111320;
const OFFS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

// Runoff physics. Velocities come from Manning's equation for kinematic overland and channel flow
// under a design storm; the clock is compressed so a storm plays out in seconds.
const STORM_MM_PER_H = 20;            // rainfall excess intensity
const RAIN_EXCESS = STORM_MM_PER_H / 1000 / 3600; // m/s
const CHANNEL_AREA = 0.4e6;           // m², contributing area where a channel begins
const N_OVERLAND = 0.12, N_CHANNEL = 0.035; // Manning roughness
const MIN_SLOPE = 0.002, MAX_V = 6;   // m/m, m/s
const DEPOSIT_SLOPE = 0.03;           // soil settles on hillslope cells flatter than 3%
const DEPOSIT_TIME = 1800;            // s, mean settling time on such cells
const INERTIA = 120;                  // s, time to reach the local flow speed
const SETTLED_FADE = 5;               // real seconds a settled soil particle stays visible
export const SIM_SECONDS_PER_SECOND = 1800; // one real second = 30 minutes of storm

export async function loadWatershed(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const [Wd, Hd, Wl, Hl] = new Uint16Array(buf, 0, 4);
  const n = Wd * Hd, nl = Wl * Hl;
  const elev = new Uint16Array(buf, 8, n);
  const d8 = new Uint8Array(buf, 8 + n * 2, n);
  const plane = (i) => new Uint8Array(buf, 8 + n * 3 + i * nl, nl);
  const layers = Object.fromEntries(["risk", "R", "K", "LS", "C", "P", "A"].map((k, i) => [k, plane(i)]));

  const cellW = (LON_SPAN * M_PER_DEG * Math.cos(((LAT0 + LAT1) / 2) * Math.PI / 180)) / Wd;
  const cellH = ((LAT1 - LAT0) * M_PER_DEG) / Hd;
  let emin = Infinity, emax = -Infinity, outlet = -1;
  const down = new Int32Array(n).fill(-1), stepLen = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (d8[i] === 255) continue;
    emin = Math.min(emin, elev[i]); emax = Math.max(emax, elev[i]);
    if (d8[i] === 8) { outlet = i; continue; }
    const [dx, dy] = OFFS[d8[i]];
    down[i] = i + dy * Wd + dx;
    stepLen[i] = Math.hypot(dx * cellW, dy * cellH);
  }

  // Kahn order (sources first) gives accumulation; its reverse gives distance to the outlet.
  const indeg = new Int32Array(n), order = [];
  for (let i = 0; i < n; i++) if (down[i] >= 0) indeg[down[i]]++;
  for (let i = 0; i < n; i++) if (d8[i] !== 255 && indeg[i] === 0) order.push(i);
  for (let k = 0; k < order.length; k++) {
    const d = down[order[k]];
    if (d >= 0 && --indeg[d] === 0) order.push(d);
  }
  const acc = new Float32Array(n), dist = new Float32Array(n);
  for (const i of order) { acc[i] += 1; if (down[i] >= 0) acc[down[i]] += acc[i]; }
  for (let k = order.length - 1; k >= 0; k--) { const i = order[k]; if (down[i] >= 0) dist[i] = dist[down[i]] + stepLen[i]; }

  const relief = emax - emin;
  const norm = (i) => Math.max(0, (elev[i] - emin) / relief);
  // bilinear normalised elevation at data uv (u east, v south); cell centres sit at (i + 0.5) / W
  const elevAt = (u, v) => {
    const x = Math.min(Wd - 1.001, Math.max(0, u * Wd - 0.5)), y = Math.min(Hd - 1.001, Math.max(0, v * Hd - 0.5));
    const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * Wd + x0;
    return (norm(i) * (1 - fx) + norm(i + 1) * fx) * (1 - fy) + (norm(i + Wd) * (1 - fx) + norm(i + Wd + 1) * fx) * fy;
  };
  return { Wd, Hd, Wl, Hl, elev, layers, emin, emax, relief, cellW, cellH, down, stepLen, acc, dist, outlet, elevAt, norm };
}

// Flow speed per cell from Manning's equation: q = i·A/w, h = (n·q/√S)^0.6, v = q/h.
function flowField(ws) {
  const { Wd, Hd, elev, down, stepLen, acc, cellW, cellH } = ws;
  const n = Wd * Hd, area = cellW * cellH;
  const speed = new Float32Array(n), slope = new Float32Array(n), channel = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (down[i] < 0) continue;
    const s = Math.max(MIN_SLOPE, (elev[i] - elev[down[i]]) / stepLen[i]);
    const Q = RAIN_EXCESS * acc[i] * area;
    const isChannel = acc[i] * area >= CHANNEL_AREA;
    const width = isChannel ? Math.max(4, 2.5 * Math.sqrt(Q)) : cellW;
    const q = Q / width, rough = isChannel ? N_CHANNEL : N_OVERLAND;
    const h = Math.pow((rough * q) / Math.sqrt(s), 0.6);
    speed[i] = Math.min(MAX_V, q / h);
    slope[i] = s;
    channel[i] = isChannel ? 1 : 0;
  }
  return { speed, slope, channel };
}

// Cumulative weights over watershed cells for weighted spawning.
function sampler(ws, weightOf) {
  const cells = [], cdf = [];
  let total = 0;
  for (let i = 0; i < ws.Wd * ws.Hd; i++) {
    if (ws.down[i] < 0) continue;
    const w = weightOf(i);
    if (w <= 0) continue;
    total += w; cells.push(i); cdf.push(total);
  }
  return () => {
    const r = Math.random() * total;
    let lo = 0, hi = cdf.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cdf[mid] < r) lo = mid + 1; else hi = mid; }
    return cells[lo];
  };
}

export const WATER = 0, SOIL = 1;

// Particle runoff: each particle rides the D8 flow path at the local Manning speed, with inertia.
// Soil settles on flat hillslopes; anything reaching the outlet leaves the watershed.
export function createRunoff(ws, count) {
  const { Wd, Hd, down, stepLen } = ws;
  const flow = flowField(ws);
  const lay = (name) => (i) => ws.layers[name][(((i / Wd) | 0) >> 1) * ws.Wl + ((i % Wd) >> 1)];
  const pick = [sampler(ws, (i) => 0.4 + lay("R")(i) / 255), sampler(ws, (i) => Math.pow(lay("A")(i) / 255, 2))];
  const cell = new Int32Array(count).fill(-1), f = new Float32Array(count), v = new Float32Array(count);
  const kind = new Uint8Array(count), settled = new Float32Array(count);
  const jx = new Float32Array(count), jy = new Float32Array(count);
  const out = { pos: new Float32Array(count * 3), kind: new Float32Array(count), alpha: new Float32Array(count), settled };

  const spawn = (p, rates, scatter) => {
    const total = rates[WATER] + rates[SOIL];
    if (total <= 0.001) { cell[p] = -1; return; }
    kind[p] = Math.random() * total < rates[WATER] ? WATER : SOIL;
    let c = pick[kind[p]]();
    // scatter: start partway down the flow path so the map fills at once
    for (let k = scatter ? (Math.random() * 40) | 0 : 0; k > 0 && down[c] >= 0 && down[down[c]] >= 0; k--) c = down[c];
    cell[p] = c; f[p] = Math.random(); v[p] = flow.speed[c] * 0.5; settled[p] = 0;
    jx[p] = Math.random() - 0.5; jy[p] = Math.random() - 0.5; out.alpha[p] = 0;
  };

  let started = false;
  return {
    flow, out,
    update(dt, rates, map) {
      const dts = Math.min(dt, 0.05) * SIM_SECONDS_PER_SECOND;
      const live = rates[WATER] + rates[SOIL] > 0.001;
      if (live && !started) { for (let p = 0; p < count; p++) spawn(p, rates, true); started = true; }
      if (!live) started = false;
      for (let p = 0; p < count; p++) {
        let c = cell[p];
        if (c < 0) { out.alpha[p] = 0; if (live && Math.random() < dt * 2) spawn(p, rates, false); continue; }
        const rate = rates[kind[p]];
        if (settled[p] > 0) {
          settled[p] += dt;
          out.alpha[p] = Math.max(0, 1 - settled[p] / SETTLED_FADE) * rate;
          if (settled[p] > SETTLED_FADE) spawn(p, rates, false);
        } else {
          v[p] += (flow.speed[c] - v[p]) * Math.min(1, dts / INERTIA);
          f[p] += (v[p] * dts) / stepLen[c];
          while (f[p] >= 1 && down[c] >= 0 && down[down[c]] >= 0) { f[p] -= 1; c = down[c]; }
          if (f[p] >= 1) { spawn(p, rates, false); continue; } // reached the outlet
          cell[p] = c;
          if (kind[p] === SOIL && !flow.channel[c] && flow.slope[c] < DEPOSIT_SLOPE && Math.random() < dts / DEPOSIT_TIME) settled[p] = 1e-3;
          out.alpha[p] = Math.min(rate, out.alpha[p] + dt * 2);
        }
        // position along the segment between cell centres, with lateral spread off-channel
        const d = down[c] >= 0 ? down[c] : c, t = Math.min(f[p], 1);
        const spread = flow.channel[c] ? 0.15 : 0.9;
        const x = ((c % Wd) * (1 - t) + (d % Wd) * t + 0.5 + jx[p] * spread) / Wd;
        const y = (((c / Wd) | 0) * (1 - t) + ((d / Wd) | 0) * t + 0.5 + jy[p] * spread) / Hd;
        out.pos[p * 3] = (x - 0.5) * map.w;
        out.pos[p * 3 + 1] = (0.5 - y) * map.h;
        out.pos[p * 3 + 2] = ws.elevAt(x, y) * map.lift + 0.008;
        out.kind[p] = kind[p];
      }
    },
  };
}
