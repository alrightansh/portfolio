// LiDAR stop: a block of Wierden (Overijssel) from AHN6, the 2025 Dutch airborne LiDAR survey. The scan replays
// in the order the laser fired, the returns take their classes, the high-voltage wires are fitted (their sag, and
// the trees under them), then the street turns to glass over the sewers and the water runs: foul water to the
// VGS-305 pumping station and out through its pressure main, and rain to outlets of its own. Data in public/lidar/,
// built by tools/lidar/build_lidar.py, whose header and write_meta() describe the files; positions are metres east
// and north of the box's south-west corner, heights metres above NAP.
import * as THREE from "three";
import { P } from "./config.js";
import { fitBox, ramp, win, geometry, loadJson, depthClearer, makeScreenOf, makeViews, makeRig, WINDOW, MAP_UV } from "./stop-kit.js";

const BASE = "/lidar/";
const V = "v1";
const SMALL = matchMedia("(max-width: 768px)").matches;
const MAP_H = 1.5;          // north-south size in world units before fitting to the screen
const EXAG = 2;             // heights drawn this many times true scale
const UNDER = 6;            // depths below the street drawn this many times deeper again, so the sewers show
const FOOT = 1.2;           // a point's footprint, in thinning voxels
const MAX_POINT_PX = 9;
const HAG_TOP = 30;         // metres above the ground at the warm end of the height colours (the legend's "30 m up")
const DSM_CELL = 25;        // metres: the surface grid that frames zoomed views
const PRESS_GAP = 10;       // metres: pressure-main ends this close join (the data breaks mains at valve chambers)
const PUMP_R = 15;          // metres: pipe ends this close to a pump belong to it
const SCAN_FLASH = 0.012;   // share of the scan a fresh return stays bright
const SCALE_M = [10, 20, 25, 50, 100, 200, 250, 500];
const SCALE_PX = 110;       // longest scale bar in CSS px

// Stage boundaries over the stop's progress q (0..1), and the steps inside stage 5.
const STAGES = [0, 0.15, 0.29, 0.45, 0.59, 0.74, 1];
const LAST = STAGES.length - 2;
const SUBS = { 5: [0.74, 0.82, 0.91] };
const during = (q, k) => win(q, STAGES[k], k === LAST ? 2 : STAGES[k + 1]);
export function lidarStageOf(q) {
  for (let i = LAST; i >= 0; i--) if (q >= STAGES[i]) return i;
  return 0;
}
export function lidarSubOf(q) {
  const s = SUBS[lidarStageOf(q)];
  if (!s) return -1;
  for (let i = s.length - 1; i > 0; i--) if (q >= s[i]) return i;
  return 0;
}

// Line kinds, and the sewer network each pipe kind belongs to (pipe ends join only within one). inflow: pressure
// mains bringing water in to a pump; pressure: those carrying it out. Colours match the legend in index.astro.
const KIND = { foul: 0, combined: 1, storm: 2, pressure: 3, overflow: 4, kv380: 5, kv110: 6, shaft: 7, inflow: 8 };
const NET = { foul: "foul", combined: "foul", storm: "storm", pressure: "pressure", overflow: "overflow" };

// Point classes (build_lidar.py CLASSES): ground, building, tree, low, wire, tower, water, civil.
const CLASS_GLSL = /* glsl */ `
const vec3 CLS[8] = vec3[8](vec3(0.36, 0.42, 0.52), vec3(0.96, 0.86, 0.70), vec3(0.36, 0.80, 0.50), vec3(0.24, 0.48, 0.38),
  vec3(1.0, 0.84, 0.45), vec3(0.95, 0.97, 1.0), vec3(0.30, 0.62, 1.0), vec3(0.76, 0.58, 1.0));`;

// Map position (map units) of a point given in metres east and north of the box corner at a height (NAP), and depth:
// how far below the street, drawn uUnder times deeper. uBase lifts it all to make room below the street.
const PLACE = /* glsl */ `
uniform vec2 uBoxM;
uniform float uBase, uVert, uZ0, uUnder;
vec3 place(vec3 q, float depth) {
  return vec3((q.xy / uBoxM - 0.5) * uSize, uBase + (q.z - uZ0) * uVert - depth * (uUnder - 1.0) * uVert);
}`;

// The returns: height colours during the scan, then classes, the wires, clearance, and a ghost over the sewers.
const pointVert = /* glsl */ `
attribute float aCode;
attribute vec3 aColor;
uniform sampler2D uGround;
uniform vec2 uGroundZ, uZr;
uniform float uN, uScan, uFootPx, uPixelRatio, uShow, uClassK, uLinesK, uClearK, uGhost, uSpotK;
uniform vec3 uSpot;
varying vec3 vC;
varying float vA;
varying vec2 vUv;
${MAP_UV}
${PLACE}
${CLASS_GLSL}
const vec3 LUMA = vec3(0.299, 0.587, 0.114), NEAR = vec3(1.0, 0.33, 0.27), MID = vec3(1.0, 0.70, 0.25);
vec3 heightColor(float h) {
  vec3 a = vec3(0.09, 0.18, 0.40), b = vec3(0.16, 0.50, 0.92), c = vec3(0.50, 0.86, 1.0), d = vec3(1.0, 0.96, 0.86);
  return h < 0.1 ? mix(a, b, h / 0.1) : h < 0.5 ? mix(b, c, (h - 0.1) / 0.4) : mix(c, d, (h - 0.5) / 0.5);
}
void main() {
  float age = uScan - float(gl_VertexID) / uN;                // share of the scan since the laser fired this return
  if (age < 0.0 || uShow < 0.003) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; return; }
  float z = uZr.x + position.z * (uZr.y - uZr.x);
  float ground = uGroundZ.x + texture(uGround, vec2(position.x, 1.0 - position.y)).r * (uGroundZ.y - uGroundZ.x);
  int cls = int(mod(aCode, 8.0) + 0.5);
  float band = floor(aCode / 8.0);                             // distance to the nearest fitted wire, in half metres
  bool wire = cls == 4 || cls == 5;
  float lum = dot(aColor, LUMA), size = 1.0;
  vec3 col = heightColor(clamp((z - ground) / ${HAG_TOP.toFixed(1)}, 0.0, 1.0)) * (0.7 + 0.6 * lum);
  col = mix(col, CLS[cls] * (cls == 0 || cls == 3 ? 0.45 + 0.9 * lum : 0.62 + 0.55 * lum), uClassK);
  // the power lines stand out, the rest steps back
  col = mix(col, wire ? CLS[cls] * 1.15 : vec3(dot(col, LUMA) * 0.32), uLinesK);
  size *= 1.0 + 0.6 * uLinesK * float(wire);
  // returns within 5 and 10 m of a wire
  float near = wire ? 0.0 : band < 10.0 ? 1.0 : band < 20.0 ? 0.6 : 0.0;
  col = mix(col, band < 10.0 ? NEAR : MID, near * uClearK);
  size *= 1.0 + 0.6 * near * uClearK;
  // a light on one span (uSpot: its centre and radius in metres); what lies beyond steps back
  col *= 1.0 - 0.7 * uSpotK * smoothstep(uSpot.z, uSpot.z * 1.3, distance(position.xy * uBoxM, uSpot.xy));
  // fresh returns flash
  float fresh = 1.0 - smoothstep(0.0, ${SCAN_FLASH}, age);
  col = mix(col, vec3(1.0), 0.75 * fresh);
  size *= 1.0 + 1.3 * fresh;
  // over the sewers the points thin to a ghost
  col = mix(col, vec3(dot(col, LUMA)), 0.5 * uGhost);
  vA = uShow * mix(1.0, cls == 0 || cls == 3 ? 0.05 : wire ? 0.3 : 0.16, uGhost);
  vC = col;
  vec3 p = place(vec3(position.xy * uBoxM, z), 0.0);
  vUv = mapUv(p.xy);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = clamp(uFootPx * size / -mv.z, 1.0, ${MAX_POINT_PX.toFixed(1)}) * uPixelRatio;
}`;
const pointFrag = /* glsl */ `
${WINDOW}
varying vec3 vC;
varying float vA;
varying vec2 vUv;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = vA * windowAt(vUv);
  if (dot(d, d) > 0.25 || a < 0.003) discard;
  gl_FragColor = vec4(vC, a);
}`;

// The ground as a sheet with a 50 m grid: the survey area before the scan, glass over the sewers.
const planeVert = /* glsl */ `
attribute float aZ;
uniform float uBase, uVert, uZ0;
varying vec2 vUv;
${MAP_UV}
void main() {
  vUv = mapUv(position.xy);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, uBase + (aZ - uZ0) * uVert, 1.0);
}`;
const planeFrag = /* glsl */ `
uniform vec2 uBoxM;
uniform float uK;
${WINDOW}
varying vec2 vUv;
void main() {
  vec2 m = vec2(vUv.x, 1.0 - vUv.y) * uBoxM / 50.0;
  vec2 g = abs(fract(m - 0.5) - 0.5) / fwidth(m);
  float line = 1.0 - min(min(g.x, g.y), 1.0);
  float a = uK * (0.3 + 0.45 * line) * windowAt(vUv);
  if (a < 0.003) discard;
  gl_FragColor = vec4(mix(vec3(0.05, 0.09, 0.16), vec3(0.45, 0.72, 1.0), line * 0.7), a);
}`;

// Pipes, manholes and wires as screen-space ribbons (two vertices a point, pushed apart in CSS px), drawn on along
// aOrder, with pulses running along aRun (metres to where the water leaves) at each kind's speed.
const ribbonVert = /* glsl */ `
attribute float aDepth, aSide, aRun, aKind, aWidth, aOrder;
attribute vec4 aPrev, aNext;
uniform vec2 uViewport;
uniform float uShow, uKindK[9], uDrawK[9], uFlowK[9];
varying vec2 vUv;
varying float vRun, vOrder, vSide;
flat varying vec3 vC;
flat varying float vA, vDraw, vFlow, vSpeed, vGap;
${MAP_UV}
${PLACE}
const vec3 KC[9] = vec3[9](vec3(0.98, 0.62, 0.30), vec3(0.86, 0.46, 0.88), vec3(0.32, 0.77, 1.0), vec3(1.0, 0.36, 0.28),
  vec3(0.55, 1.0, 0.85), vec3(1.0, 0.9, 0.6), vec3(0.65, 0.88, 1.0), vec3(0.6, 0.68, 0.8), vec3(1.0, 0.85, 0.35));
const float SPEED[9] = float[9](22.0, 22.0, 30.0, 70.0, 30.0, 0.0, 0.0, 0.0, 50.0);  // metres a second, drawn
const float GAP[9] = float[9](45.0, 45.0, 55.0, 90.0, 30.0, 1.0, 1.0, 1.0, 80.0);    // metres between pulses
vec2 toPx(vec4 c) { return c.xy / c.w * uViewport * 0.5; }
void main() {
  int k = int(aKind + 0.5);
  mat4 m = projectionMatrix * modelViewMatrix;
  vec3 p = place(position, aDepth);
  vec4 c = m * vec4(p, 1.0);
  vec2 s = toPx(c);
  vec2 d1 = s - toPx(m * vec4(place(aPrev.xyz, aPrev.w), 1.0)), d2 = toPx(m * vec4(place(aNext.xyz, aNext.w), 1.0)) - s;
  vec2 t1 = length(d1) > 1e-3 ? normalize(d1) : vec2(0.0), t2 = length(d2) > 1e-3 ? normalize(d2) : vec2(0.0);
  vec2 t = length(t1 + t2) > 1e-3 ? normalize(t1 + t2) : length(t1) > 0.0 ? t1 : length(t2) > 0.0 ? t2 : vec2(1.0, 0.0);
  vec2 n = vec2(-t.y, t.x);
  float miter = 1.0 / max(0.6, abs(dot(n, length(t1) > 0.0 ? vec2(-t1.y, t1.x) : n)));
  c.xy += n * aSide * aWidth * miter / uViewport * c.w;
  gl_Position = c;
  vUv = mapUv(p.xy);
  vRun = aRun; vOrder = aOrder; vSide = aSide;
  vC = KC[k]; vA = uShow * uKindK[k]; vDraw = uDrawK[k]; vFlow = uFlowK[k]; vSpeed = SPEED[k]; vGap = GAP[k];
}`;
const ribbonFrag = /* glsl */ `
uniform float uTime;
${WINDOW}
varying vec2 vUv;
varying float vRun, vOrder, vSide;
flat varying vec3 vC;
flat varying float vA, vDraw, vFlow, vSpeed, vGap;
void main() {
  float ahead = vDraw - vOrder;
  float a = vA * windowAt(vUv) * smoothstep(0.0, 0.01, ahead) * (1.0 - smoothstep(0.45, 1.0, abs(vSide)));
  if (a < 0.003) discard;
  float x = fract((vRun + uTime * vSpeed) / vGap);              // pulses move towards smaller runs: downstream
  float pulse = vFlow * pow(1.0 - x, 6.0);
  float tip = (1.0 - smoothstep(0.0, 0.03, ahead)) * step(vDraw, 0.999); // the drawing front glows
  vec3 col = vC * (1.0 - 0.35 * vFlow) + mix(vC, vec3(1.0), 0.5) * (pulse * 1.4 + tip);
  gl_FragColor = vec4(col, a * (1.0 - 0.3 * vFlow + 0.3 * pulse));
}`;

// Rings on the street: the pumping station, the overflow chambers and the storm outlets.
const markVert = /* glsl */ `
attribute float aKind, aSize, aSeed;
uniform float uPixelRatio, uTime, uShow, uMarkK[3];
varying vec3 vC;
varying float vA, vRing;
varying vec2 vUv;
${MAP_UV}
${PLACE}
void main() {
  int k = int(aKind + 0.5);
  vec3 p = place(position, 0.0);
  vUv = mapUv(p.xy);
  vC = k == 0 ? vec3(1.0, 0.36, 0.28) : k == 1 ? vec3(0.55, 1.0, 0.85) : vec3(0.32, 0.77, 1.0);
  vA = uShow * uMarkK[k];
  vRing = 0.6 + 0.4 * sin(uTime * 2.4 + aSeed * 6.283);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  gl_PointSize = aSize * (1.0 + 0.15 * vRing) * uPixelRatio;
}`;
const markFrag = /* glsl */ `
${WINDOW}
varying vec3 vC;
varying float vA, vRing;
varying vec2 vUv;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float ring = (1.0 - smoothstep(0.02, 0.06, abs(d - 0.4))) * vRing;
  float a = max(1.0 - smoothstep(0.16, 0.22, d), ring) * vA * windowAt(vUv);
  if (d > 0.5 || a < 0.003) discard;
  gl_FragColor = vec4(vC, a);
}`;

// The point file: N returns in scan order, planar on disk (u16 x, y, z, then u8 code, r, g, b); interleaved here.
async function loadPoints(url, n) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  if (buf.byteLength !== n * 10) throw new Error(`${url}: ${buf.byteLength} bytes, expected ${n * 10}`);
  const xyz = [0, 1, 2].map((k) => new Uint16Array(buf, k * 2 * n, n));
  const rgb = [7, 8, 9].map((k) => new Uint8Array(buf, k * n, n));
  const pos = new Uint16Array(3 * n), col = new Uint8Array(3 * n);
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { pos[3 * i + k] = xyz[k][i]; col[3 * i + k] = rgb[k][i]; }
  return { pos, col, code: new Uint8Array(buf, 6 * n, n).slice() };
}

// Distance along a polyline at each of its points, over the given coordinates.
const cumulative = (pts, dims) => pts.reduce((s, p, i) => {
  if (i) s.push(s[i - 1] + Math.hypot(...dims.map((d) => p[d] - pts[i - 1][d])));
  return s;
}, [0]);

// Each pipe's points as metres to where its network's water leaves (a pump, an outlet, the box edge), following the
// pipes the way they run (the build turned each to its flow), so pulses carry on from pipe to pipe; a draw-on order
// (0 where the water leaves, 1 at the network's far ends); which pressure mains carry water out of a pump; and the
// storm outlets inside the box.
function flowRuns(pipes, pumps, W, H) {
  // pipe i's ends are 2i (where its water enters) and 2i + 1 (where it leaves); ends of one network join within
  // 5 cm, or PRESS_GAP for pressure mains
  const ends = pipes.flatMap((p) => [p.pts[0], p.pts[p.pts.length - 1]].map(([x, y]) => ({ net: NET[p.k], x, y })));
  const root = ends.map((_, i) => i);
  const find = (i) => (root[i] === i ? i : (root[i] = find(root[i])));
  ends.forEach((e, i) => {
    const gap = e.net === "pressure" ? PRESS_GAP : 0.05;
    for (let j = 0; j < i; j++) if (ends[j].net === e.net && Math.hypot(ends[j].x - e.x, ends[j].y - e.y) <= gap) root[find(i)] = find(j);
  });
  const edges = pipes.map((p, i) => {
    const s = cumulative(p.pts, [0, 1]);
    return { net: NET[p.k], a: find(2 * i), b: find(2 * i + 1), s, L: s[s.length - 1] };
  });
  const leaves = new Set(edges.map((e) => e.a));
  const dist = ends.map((_, i) => (leaves.has(i) ? Infinity : 0)); // no pipe leaves a node: the water goes out there
  for (let pass = 0, changed = true; changed && pass < ends.length; pass++) {
    changed = false;
    for (const e of edges) if (dist[e.b] + e.L < dist[e.a]) { dist[e.a] = dist[e.b] + e.L; changed = true; }
  }
  const top = {};
  for (const e of edges) if (Number.isFinite(dist[e.b])) top[e.net] = Math.max(top[e.net] || 1, dist[e.b] + e.L);
  // pressure mains downstream of a pump carry its water out; the others bring water in
  const out = new Set(), stack = ends.flatMap((e, i) =>
    (e.net === "pressure" && pumps.some(([x, y]) => Math.hypot(x - e.x, y - e.y) < PUMP_R) ? [find(i)] : []));
  while (stack.length) {
    const at = stack.pop();
    edges.forEach((e, i) => { if (e.net === "pressure" && e.a === at && !out.has(i)) { out.add(i); stack.push(e.b); } });
  }
  const inside = ({ x, y }) => x > 1 && x < W - 1 && y > 1 && y < H - 1;
  return {
    lines: edges.map((e, i) => {
      const end = Number.isFinite(dist[e.b]) ? dist[e.b] : 0;
      const run = e.s.map((s) => end + e.L - s);
      return { run, order: run.map((r) => Math.min(1, r / (top[e.net] || 1))), out: out.has(i) };
    }),
    outlets: [...new Set(ends.map((_, i) => find(i)))].filter((r) => ends[r].net === "storm" && dist[r] === 0 && inside(ends[r]))
      .map((r) => [ends[r].x, ends[r].y]),
  };
}

// Ribbon geometry for lines [{ pts [[x, y, z, depth]], kind, width (CSS px), run [], order [] }], one entry a point.
function buildRibbons(lines) {
  const a = { position: [], aDepth: [], aPrev: [], aNext: [], aSide: [], aRun: [], aKind: [], aWidth: [], aOrder: [] };
  const index = [];
  let first = 0;
  for (const l of lines) {
    const n = l.pts.length;
    l.pts.forEach((p, i) => {
      const prev = l.pts[Math.max(0, i - 1)], next = l.pts[Math.min(n - 1, i + 1)];
      for (const side of [-1, 1]) {
        a.position.push(p[0], p[1], p[2]); a.aDepth.push(p[3]); a.aPrev.push(...prev); a.aNext.push(...next);
        a.aSide.push(side); a.aRun.push(l.run[i]); a.aKind.push(l.kind); a.aWidth.push(l.width); a.aOrder.push(l.order[i]);
      }
    });
    for (let i = 0; i < n - 1; i++) { const k = first + 2 * i; index.push(k, k + 1, k + 2, k + 2, k + 1, k + 3); }
    first += 2 * n;
  }
  const dims = (k) => (k === "position" ? 3 : k === "aPrev" || k === "aNext" ? 4 : 1);
  const g = geometry(Object.fromEntries(Object.entries(a).map(([k, v]) => [k, [v, dims(k)]])));
  g.setIndex(index);
  return g;
}

// A view across a span (wire ends a, b): its middle, the turn that lays the wire across the screen, its length.
function spanOf(w) {
  const a = w.pts[0], b = w.pts[w.pts.length - 1];
  const turn = (((-Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI - Math.PI / 2;
  return { mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], yaw: turn, len: Math.hypot(b[0] - a[0], b[1] - a[1]) };
}

export async function createLidar(scene, dpr, stationZ) {
  const meta = await loadJson(`${BASE}li-meta-${V}.json`);
  const n = SMALL ? meta.nSm : meta.n;
  const pts = await loadPoints(`${BASE}li-points${SMALL ? "-sm" : ""}-${V}.bin`, n);
  const [W, H] = meta.size, [Z0, ZTOP] = meta.z;
  const size = new THREE.Vector2((MAP_H * W) / H, MAP_H);
  const mPerUnit = H / MAP_H, vert0 = EXAG / mPerUnit;
  const sw = meta.sewers, pw = meta.power, grid = meta.grid;

  // the ground (grid.cell squares, row 0 north), bilinear between cell centres
  const G = grid.ground, gLo = Math.min(...G), gHi = Math.max(...G);
  const groundAt = (x, y) => {
    const fx = Math.min(Math.max(x / grid.cell - 0.5, 0), grid.w - 1), fy = Math.min(Math.max((H - y) / grid.cell - 0.5, 0), grid.h - 1);
    const x0 = Math.min(grid.w - 2, Math.floor(fx)), y0 = Math.min(grid.h - 2, Math.floor(fy)), tx = fx - x0, ty = fy - y0;
    const i = y0 * grid.w + x0;
    return (G[i] * (1 - tx) + G[i + 1] * tx) * (1 - ty) + (G[i + grid.w] * (1 - tx) + G[i + grid.w + 1] * tx) * ty;
  };
  const groundTex = new THREE.DataTexture(Uint8Array.from(G, (g) => Math.round(((g - gLo) / Math.max(gHi - gLo, 1e-3)) * 255)),
    grid.w, grid.h, THREE.RedFormat, THREE.UnsignedByteType);
  groundTex.magFilter = groundTex.minFilter = THREE.LinearFilter;
  groundTex.needsUpdate = true;

  // the surface (highest return in each DSM_CELL square, row 0 north), so zoomed views frame the wires and pylons
  const dw = Math.ceil(W / DSM_CELL), dh = Math.ceil(H / DSM_CELL), dsm = new Float32Array(dw * dh).fill(gLo);
  for (let i = 0; i < n; i++) {
    const cx = Math.min(dw - 1, Math.floor(((pts.pos[3 * i] / 65535) * W) / DSM_CELL));
    const cy = Math.min(dh - 1, Math.floor(((1 - pts.pos[3 * i + 1] / 65535) * H) / DSM_CELL));
    dsm[cy * dw + cx] = Math.max(dsm[cy * dw + cx], Z0 + (pts.pos[3 * i + 2] / 65535) * (ZTOP - Z0));
  }
  // the vertical layout now: map units a metre, the sewers' extra depth, the lift that makes room for them, the top
  const st = { vert: vert0, under: 1, base: 0, lift: (ZTOP - Z0) * vert0 };
  const placeZ = (z, depth = 0) => st.base + (z - Z0) * st.vert - depth * (st.under - 1) * st.vert;
  const at = (u, v) => placeZ(dsm[Math.min(dh - 1, Math.max(0, Math.floor(v * dh))) * dw + Math.min(dw - 1, Math.max(0, Math.floor(u * dw)))]) / st.lift;
  // metres the city rises so the deepest pipe, drawn UNDER times deeper, stays above Z0
  const room = Math.max(0, ...sw.pipes.flatMap((p) => p.pts.map(([, , z, d]) => d * (UNDER - 1) - (z - Z0))));

  const shared = { uTime: { value: 0 }, uPixelRatio: { value: dpr }, uSize: { value: size }, uBoxM: { value: new THREE.Vector2(W, H) },
    uWin: { value: new THREE.Vector4(-1, -1, 2, 2) }, uFeather: { value: 0.1 }, uShow: { value: 0 },
    uBase: { value: 0 }, uVert: { value: vert0 }, uZ0: { value: Z0 }, uUnder: { value: 1 } };
  const mat = (vertexShader, fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, ...extra });

  const pg = new THREE.BufferGeometry();
  pg.setAttribute("position", new THREE.BufferAttribute(pts.pos, 3, true));
  pg.setAttribute("aCode", new THREE.BufferAttribute(pts.code, 1));
  pg.setAttribute("aColor", new THREE.BufferAttribute(pts.col, 3, true));
  const pu = { ...shared, uGround: { value: groundTex }, uGroundZ: { value: new THREE.Vector2(gLo, gHi) },
    uZr: { value: new THREE.Vector2(Z0, ZTOP) }, uN: { value: n }, uScan: { value: 0 }, uFootPx: { value: 1 },
    uClassK: { value: 0 }, uLinesK: { value: 0 }, uClearK: { value: 0 }, uGhost: { value: 0 },
    uSpot: { value: new THREE.Vector3() }, uSpotK: { value: 0 } };
  const points = new THREE.Points(pg, mat(pointVert, pointFrag, pu));
  const footM = FOOT * (SMALL ? meta.voxelSm : meta.voxel);

  const lu = { ...shared, uK: { value: 0 } };
  // one vertex a ground cell, at its centre: half a cell in from the edges of the box
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(size.x * (1 - grid.cell / W), size.y * (1 - grid.cell / H), grid.w - 1, grid.h - 1)
    .setAttribute("aZ", new THREE.Float32BufferAttribute(G, 1)), mat(planeVert, planeFrag, lu, { depthTest: false }));

  // manholes first (under the pipes), then the pipes, then the wires on top
  const fr = flowRuns(sw.pipes, sw.pumps, W, H);
  const pipeAt = sw.pipes.flatMap((p, i) => p.pts.map((q, j) => [q[0], q[1], fr.lines[i].order[j]]));
  const lines = sw.manholes.map(([x, y, top, bottom]) => {
    let best = Infinity, order = 1; // a manhole appears as the draw-on reaches the nearest pipe point
    for (const [px, py, o] of pipeAt) { const d = (px - x) ** 2 + (py - y) ** 2; if (d < best) { best = d; order = o; } }
    return { pts: [[x, y, top, 0], [x, y, bottom, top - bottom]], kind: KIND.shaft, width: 1, run: [0, 0], order: [order, order] };
  });
  const pipeWidth = (p) => (SMALL ? 0.85 : 1) * Math.max(1.3 + Math.min(p.d, 1000) / 230, p.k === "pressure" ? 2.4 : 0);
  sw.pipes.forEach((p, i) => {
    const f = fr.lines[i], kind = p.k === "pressure" ? (f.out ? KIND.pressure : KIND.inflow) : KIND[p.k];
    lines.push({ pts: p.pts, kind, width: pipeWidth(p), run: f.run, order: f.order });
  });
  for (const w of pw.wires) {
    const s = cumulative(w.pts, [0, 1, 2]), L = s[s.length - 1];
    lines.push({ pts: w.pts.map(([x, y, z]) => [x, y, z, 0]), kind: w.kv >= 300 ? KIND.kv380 : KIND.kv110,
      width: w.kv >= 300 ? 1.6 : 1.3, run: s.map((v) => L - v), order: s.map((v) => v / L) });
  }
  const zeros = () => new Array(9).fill(0);
  const ru = { ...shared, uViewport: { value: new THREE.Vector2(innerWidth, innerHeight) }, uKindK: { value: zeros() },
    uDrawK: { value: zeros() }, uFlowK: { value: zeros() } };
  // double-sided: a ribbon's winding on screen flips with the side its points are pushed to
  const ribbons = new THREE.Mesh(buildRibbons(lines), mat(ribbonVert, ribbonFrag, ru, { depthTest: false, side: THREE.DoubleSide }));

  const marks = [...sw.pumps.map(([x, y]) => [x, y, 0, 26]), ...sw.outfalls.map(([x, y]) => [x, y, 1, 15]),
    ...fr.outlets.map(([x, y]) => [x, y, 2, 10])];
  const mu = { ...shared, uMarkK: { value: [0, 0, 0] } };
  const markers = new THREE.Points(geometry({
    position: [marks.flatMap(([x, y]) => [x, y, groundAt(x, y)]), 3], aKind: [marks.map((m) => m[2]), 1],
    aSize: [marks.map((m) => m[3] * (SMALL ? 0.8 : 1)), 1], aSeed: [marks.map(() => Math.random()), 1],
  }), mat(markVert, markFrag, mu, { depthTest: false }));

  const clearer = depthClearer();
  const drawn = [clearer, plane, points, ribbons, markers];
  // after the Himachal stop's objects (3000 and up), so the stops never interleave while they fade
  drawn.forEach((m, i) => { m.frustumCulled = false; m.renderOrder = 4000 + i; });
  const group = new THREE.Group();
  group.add(...drawn);
  const rig = makeRig(group, size, at, shared);

  // the spans to show: the 380 kV wire with the deepest sag over a whole span, and the 110 kV wire nearest the tree
  const clear = pw.clearance, tree = clear.treeAt;
  const whole = pw.wires.filter((w) => w.full);
  const sagWire = whole.filter((w) => w.kv >= 300).reduce((a, b) => (b.sag > a.sag ? b : a));
  const gapTo = (w) => Math.min(...w.pts.map(([x, y, z]) => Math.hypot(x - tree[0], y - tree[1], z - tree[2])));
  const treeWire = whole.filter((w) => w.kv < 300).reduce((a, b) => (gapTo(b) < gapTo(a) ? b : a));
  const sa = spanOf(sagWire), sb = spanOf(treeWire);
  pu.uSpot.value.set(sb.mid[0], sb.mid[1], sb.len * 0.52); // the tree stage lights the 110 kV span
  const za = Math.min(2.5, W / (sa.len * 1.25)), zb = Math.min(2.5, W / (sb.len * 1.25));
  const centre = (list) => [0, 1].map((k) => list.reduce((s, p) => s + p[k], 0) / list.length);
  const pump = sw.pumps[0], exit = sw.plant.exit;
  const stormMid = centre(fr.outlets.length ? fr.outlets : [[W / 2, H / 2]]);
  const outMid = [(pump[0] + exit[0]) / 2, (pump[1] + exit[1]) / 2];

  const S = STAGES, U = SUBS[5];
  const WHOLE = { c: [0.5, 0.5], z: 1, tilt: -0.86, yaw: -0.12, e: 1 };
  const look = ([x, y], z, tilt, yaw) => ({ c: [x / W, 1 - y / H], z, tilt, yaw, e: 1 });
  const views = makeViews([
    [0, { ...WHOLE, tilt: -0.35, yaw: -0.32 }], [0.06, { ...WHOLE, tilt: -0.78 }], [S[1] - 0.01, { ...WHOLE, yaw: 0.02 }],
    [S[1] + 0.03, { ...WHOLE, z: 1.05, tilt: -0.92, yaw: 0.14 }], [S[2] - 0.01, { ...WHOLE, z: 1.05, tilt: -0.92, yaw: 0.3 }],
    [S[2] + 0.04, look(sa.mid, za, -1.12, sa.yaw)], [S[3] - 0.01, look(sa.mid, za * 1.06, -1.12, sa.yaw + 0.08)],
    [S[3] + 0.04, look(sb.mid, zb, -1.02, sb.yaw)], [S[4] - 0.01, look(sb.mid, zb * 1.06, -1.02, sb.yaw + 0.08)],
    [S[4] + 0.04, { ...WHOLE, tilt: -0.98, yaw: 0.22 }], [S[5] - 0.01, { ...WHOLE, tilt: -0.98, yaw: 0.34 }],
    // the whole block, so both mains in show where they cross its north and west edges
    [U[0] + 0.03, { ...WHOLE, tilt: -0.96, yaw: 0.36 }], [U[1] - 0.01, { ...WHOLE, tilt: -0.96, yaw: 0.42 }],
    [U[1] + 0.03, look(outMid, 1.3, -0.96, 0.44)], [U[2] - 0.01, look(outMid, 1.3, -0.96, 0.5)],
    [U[2] + 0.03, look(stormMid, 1.1, -0.94, 0.24)], [1, look(stormMid, 1.1, -0.94, 0.3)],
  ]);

  // Labels, highest priority first: a label that would overlap one already placed is skipped. x, y in metres,
  // z NAP, depth below the street.
  const labels = [];
  const add = (name, cls, [x, y], z, a, depth = 0) => labels.push({ name, cls, x, y, z, depth, a });
  add(`Tree ${clear.tree} m from a wire`, "warn", tree, tree[2], (q) => during(q, 3) * ramp(q, S[3] + 0.03, S[3] + 0.05));
  const low = sagWire.pts.reduce((a, b) => (b[2] < a[2] ? b : a));
  add(`Sag ${sagWire.sag.toFixed(1)} m`, "", low, low[2] - 12,(q) => during(q, 2) * ramp(q, S[2] + 0.06, S[2] + 0.08));
  for (const [x, y, top, kv] of pw.towers) {
    add(`${kv} kV pylon · ${Math.round(top - groundAt(x, y))} m`, "", [x, y], top + 2, (q) => during(q, 2) + (kv < 300 ? during(q, 3) : 0));
  }
  for (const [x, y, name] of sw.pumps) add(`${name} pumping station`, "pump", [x, y], groundAt(x, y), (q) => ramp(q, S[4] + 0.05, S[4] + 0.08));
  const plant = sw.plant;
  add(`To ${plant.name} treatment plant · ${plant.km} km`, "pump", exit, groundAt(...exit), (q) => win(q, U[1] + 0.02, U[2]));
  // pressure mains entering the box: from the water board's Hoge Hexel station (north edge), the pump pits (west)
  for (const p of sw.pipes) {
    const [x, y] = p.pts[0];
    if (p.k !== "pressure" || (y < H - 0.5 && x > 0.5)) continue;
    add(y >= H - 0.5 ? "From Hoge Hexel" : "From the pump pits", "", [x, y], groundAt(x, y), (q) => win(q, U[0] + 0.02, U[1]));
  }
  for (const [x, y, , crest] of sw.outfalls) add(`Overflow · weir ${crest.toFixed(1)} m`, "", [x, y], groundAt(x, y), (q) => win(q, U[2] + 0.02, 2));
  add(meta.site, "big", [W / 2, H / 2], groundAt(W / 2, H / 2) + 40, (q) => 1 - ramp(q, 0.03, 0.06));
  const screenOf = makeScreenOf();

  const pinStart = stationZ + P.researchView;
  const pinEnd = pinStart - P.researchPin;
  let form = 0, q = 0, live = 0, cur = WHOLE;
  scene.add(group); // last, so a stop that fails to build leaves nothing in the scene

  return {
    pinStart, pinEnd,
    update(dt, camZ, time, camera) {
      q = Math.max(0, Math.min(1, (pinStart - camZ) / P.researchPin));
      const want = camZ <= stationZ + 6.6 && camZ >= pinEnd - 1.0;
      form = Math.max(0, Math.min(1, form + (want ? dt / 1.1 : -dt / 1.4)));
      group.visible = form > 0.001;
      if (!group.visible) { rig.reset(); return q; } // snap to a fresh fit on re-entry

      cur = views(q);
      // the relief rises from flat, then the sewers sink to their depths as the city lifts to make room
      const sink = ramp(q, S[4] + 0.005, S[4] + 0.06);
      st.vert = vert0 * (0.15 + 0.85 * ramp(q, 0, 0.05)) * cur.e;
      st.under = 1 + (UNDER - 1) * sink;
      st.base = room * st.vert * sink;
      st.lift = st.base + (ZTOP - Z0) * st.vert;
      shared.uVert.value = st.vert; shared.uUnder.value = st.under; shared.uBase.value = st.base;
      shared.uTime.value = time;
      shared.uShow.value = form;
      ru.uViewport.value.set(innerWidth, innerHeight);
      // refit every frame (scroll speed zooms the camera)
      const clamped = Math.min(Math.max(camZ, pinEnd), pinStart);
      rig.update(cur, camera, clamped - camZ, clamped - P.researchView, st.lift, dt);
      pu.uFootPx.value = (footM / mPerUnit) * group.scale.x * camera.projectionMatrix.elements[5] * innerHeight * 0.5;

      const sub = lidarSubOf(q), five = lidarStageOf(q) === 5;
      const scan = Math.max(0, Math.min(1, (q - 0.01) / 0.12));
      pu.uScan.value = scan * (1 + SCAN_FLASH); // runs past the last return, so its flash fades too
      live = (scan * meta.points) / 1e6;
      pu.uClassK.value = ramp(q, S[1], S[1] + 0.04);
      pu.uLinesK.value = ramp(q, S[2], S[2] + 0.03) * (1 - 0.25 * ramp(q, S[3], S[3] + 0.03)) * (1 - ramp(q, S[4], S[4] + 0.03));
      pu.uClearK.value = win(q, S[3] + 0.01, S[4]);
      pu.uSpotK.value = during(q, 3);
      pu.uGhost.value = ramp(q, S[4], S[4] + 0.04);
      points.material.depthWrite = form > 0.99 && pu.uGhost.value < 0.01; // see-through points must not hide each other
      lu.uK.value = 0.55 * (1 - ramp(q, 0.06, 0.12)) + 0.9 * ramp(q, S[4], S[4] + 0.04);

      const K = ru.uKindK.value, D = ru.uDrawK.value, F = ru.uFlowK.value;
      K[KIND.kv380] = K[KIND.kv110] = ramp(q, S[2], S[2] + 0.02) * (1 - 0.85 * ramp(q, S[4], S[4] + 0.03));
      K[KIND.kv380] *= 1 - 0.7 * during(q, 3); // the tree stage is about the 110 kV line
      D[KIND.kv380] = D[KIND.kv110] = ramp(q, S[2] + 0.005, S[2] + 0.07);
      const pipes = ramp(q, S[4] + 0.01, S[4] + 0.03), drawPipes = ramp(q, S[4] + 0.015, S[4] + 0.11);
      // in the flow steps one network at a time stands out: foul water and the mains in, the main out, then the rain
      const lit = (k) => (sub === 0 ? k === KIND.foul || k === KIND.combined || k === KIND.inflow
        : sub === 1 ? k === KIND.pressure || k === KIND.foul : k === KIND.storm || k === KIND.overflow);
      for (const k of [KIND.foul, KIND.combined, KIND.storm, KIND.pressure, KIND.overflow, KIND.inflow]) {
        K[k] = pipes * (!five || lit(k) ? 1 : 0.25);
        D[k] = drawPipes;
        F[k] = five && lit(k) ? ramp(q, S[5], S[5] + 0.02) : 0;
      }
      K[KIND.shaft] = ramp(q, S[4] + 0.02, S[4] + 0.05) * 0.5 * (1 - 0.5 * ramp(q, S[5], S[5] + 0.03));
      D[KIND.shaft] = drawPipes;
      const M = mu.uMarkK.value;
      M[0] = ramp(q, S[4] + 0.05, S[4] + 0.08) * (five && sub === 2 ? 0.4 : 1);
      M[1] = M[2] = win(q, U[2] + 0.01, 2);

      plane.visible = lu.uK.value > 0.002;
      ribbons.visible = Math.max(...K) > 0.002;
      markers.visible = Math.max(...M) > 0.002;
      return q;
    },
    // The stage's counting figure: returns replayed so far, in millions.
    live() { return live; },
    // Screen overlay in CSS px: labels with opacity, north arrow and scale bar; null when hidden.
    overlay(camera) {
      if (!group.visible) return null;
      group.updateMatrixWorld();
      const placed = [], fb = fitBox(), Wpx = innerWidth, Hpx = innerHeight, top = fb.y0 * Hpx + 12;
      const out = labels.map((l) => {
        const a = form * Math.min(1, l.a(q)), hidden = { name: l.name, cls: l.cls, x: 0, y: 0, a: 0 };
        if (a <= 0.004 || !rig.sees(l.x / W, 1 - l.y / H)) return hidden;
        const p = screenOf(group, (l.x / W - 0.5) * size.x, (l.y / H - 0.5) * size.y, placeZ(l.z, l.depth) + 0.004, camera);
        if (!p) return hidden;
        const y = Math.max(p[1], top), big = l.cls === "big", w = big ? l.name.length * 9 : 16 + l.name.length * 8.5;
        const flip = !big && p[0] - 6 + w > Wpx - 8; // a label that would run off the right edge opens to the left
        const x0 = big ? p[0] - w / 2 : flip ? p[0] + 6 - w : p[0] - 6;
        if (placed.some(([bx, by, bw]) => x0 < bx + bw && x0 + w > bx && Math.abs(y - by) < 18)) return hidden;
        placed.push([x0, y, w]);
        return { name: l.name, cls: flip ? `${l.cls} flip`.trim() : l.cls, x: p[0], y, a };
      });
      // north: the map's own +y on screen at the centre of the view, foreshortened by the tilt
      const d = 0.1 / cur.z, cx = (cur.c[0] - 0.5) * size.x, cy = (0.5 - cur.c[1]) * size.y;
      const cz = placeZ(groundAt(cur.c[0] * W, (1 - cur.c[1]) * H));
      const o = screenOf(group, cx, cy, cz, camera), nn = screenOf(group, cx, cy + d, cz, camera), e = screenOf(group, cx + d, cy, cz, camera);
      if (!o || !nn || !e) return { labels: out, north: null, scale: null };
      const nx = nn[0] - o[0], ny = nn[1] - o[1], ex = Math.hypot(e[0] - o[0], e[1] - o[1]);
      const north = { x: fb.x1 * Wpx - 26, y: fb.y0 * Hpx + 26, rot: Math.atan2(nx, -ny),
        sy: Math.max(0.35, Math.min(1, Math.hypot(nx, ny) / ex)), a: form };
      // scale bar: east-west at the centre of the view (approximate once the map turns)
      const pxPerM = ex / (d * mPerUnit);
      let m = SCALE_M[0];
      for (const c of SCALE_M) if (c * pxPerM <= SCALE_PX) m = c;
      return { labels: out, north, scale: { x: fb.x0 * Wpx + 6, y: fb.y1 * Hpx - 30, w: m * pxPerM, text: `${m} m`, a: form } };
    },
  };
}

// HUD copy. Sources: AHN6 (Het Waterschapshuis), the municipality's sewer data and the water boards' pumping
// stations and treatment plants (GWSW, via PDOK), OpenStreetMap's power lines; figures from tools/lidar/build_lidar.py.
// legend: [class suffix, label] pairs, or ["ramp", low, high, ramp class].
export const LIDAR_STAGES = [
  { name: "One flight, 22 million returns", stat: "live", dp: 1, unit: "million laser returns so far",
    legend: [["ramp", "Ground", "30 m up", "lidar"]],
    text: "AHN6, the Dutch national LiDAR survey: 22.1 million returns over 0.75 km² of Wierden in Overijssel, 29.5 per square metre, scanned in 54 seconds over two passes on 9 February 2025. They replay in the order the laser fired." },
  { name: "Every return has a class", stat: 48, dp: 0, unit: "% of the returns reached the ground",
    legend: [["liground", "Ground"], ["libuild", "Building"], ["litree", "Tree"], ["liwater", "Water"]],
    text: "AHN sorts the returns into ground, buildings, water, wires and civil structures. The rest are drawn as trees where they stand 2.5 m or more above the ground. Each return also carries the colour of the aerial photo beneath it." },
  { name: "Wires in the air", stat: 11.5, dp: 1, unit: "m of sag across the 380 kV line's 414 m span",
    legend: [["li380", "380 kV"], ["li110", "110 kV"], ["litower", "Pylon"]],
    text: "AHN marks the returns off wires and pylons. Along each span from OpenStreetMap, 60,735 wire returns fit 42 wires as hanging parabolas: two 380 kV circuits on pylons 43 to 52 m tall, and two 110 kV circuits on 31 m pylons." },
  { name: "Trees under the line", stat: 2.6, dp: 1, unit: "m from a 110 kV wire to the trees beneath it",
    legend: [["linear", "Within 5 m"], ["limid", "5 to 10 m"], ["li110", "Wire"]],
    text: "The distance from every return to the nearest fitted wire, leaving out 25 m round each pylon. 25 tree returns lie within 2.6 m of a wire, the closest at 2.2 m, and 4,682 within 5 m, nearly all under the 110 kV line. Scanned in February, with the leaves down. Roofs stay at least 13 m clear." },
  { name: "Under the street", stat: 12.7, dp: 1, unit: "km of sewer beneath the block",
    legend: [["lifoul", "Foul"], ["licomb", "Combined"], ["listorm", "Storm"], ["liinflow", "Main in"], ["lipress", "Main out"]],
    text: "The municipality's open sewer data: 5.1 km of foul sewer, 5.5 km of storm drains and 1.7 km of pressure mains, with 292 manholes. Gravity pipes lie at their recorded levels, up to 3.4 m down, drawn six times deeper so they show." },
  { name: "Where the water goes", stat: 93.6, dp: 1, unit: "m³ an hour: the VGS-305 pumping station", sub: [
    "All 5.1 km of foul sewer drains to the VGS-305 pumping station. Two pressure mains bring more: 4.8 km of main from the water board's Hoge Hexel station to the north-west, and a chain of pump pits from the west.",
    "VGS-305 pumps it all 1.1 km south-east, into the main from the water board's Wierden pumping station, which runs north-east toward the Almelo-Vissedijk treatment plant, 3.4 km east of the block.",
    "Rain is kept apart: 5.5 km of storm drains carry it to outlets of its own. In heavy rain, six overflow chambers can spill to surface water over weirs set 8.1 to 8.4 m above NAP."],
    legend: [["lifoul", "Foul"], ["liinflow", "Main in"], ["lipress", "Main out"], ["listorm", "Storm"], ["lioverflow", "Overflow"]] },
];
