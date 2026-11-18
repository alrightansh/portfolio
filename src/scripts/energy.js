// Energy stop: a 3D relief model of India's Northern grid region that builds up one layer at a time:
// the terrain, solar yield, wind speed, the grid already built, the land ruled out, then the solar,
// wind and hybrid hotspots of the north-india-renewables analysis.
// Data in public/energy/ (built by north-india-renewables/pipeline/export_web.py):
//   ni-dem-v1.bin     elevation in metres, Uint16, meta.dem.w x meta.dem.h, row 0 north
//   ni-relief-v1.jpg, ni-solar-v1.jpg, ni-wind-v1.jpg   shaded relief and the two resource drapes
//   ni-mask-v1.png    R state id x 20, G land open for solar, B protected areas
//   ni-hot-v1.png     R solar hotspots, G wind hotspots, B hybrid sites
//   ni-meta-v1.json   grid lines, substations, plants, turbines, labels, hotspots, wind speed grid;
//                     positions as u, v in 0..10000 across the box, v = 0 at the north edge
import * as THREE from "three";
import { P } from "./config.js";
import { fitBox, ramp, win, geometry, loadJson, loadImage, makeFitter, depthClearer, makeScreenOf } from "./stop-kit.js";

const BASE = "/energy/";
const V = "v1";
const MAP_H = 1.9;          // north-south size in world units before fitting to the screen
const LIFT = 0.16;          // height of the highest peak: about 19x vertical exaggeration
const DEPTH = 0.035;        // the block's sides reach this far below sea level
const FACE_TILT = -0.2;     // flat map square to the camera, which looks down about 11 degrees
const TILT = -0.8;          // north tilted away, like a relief model on a table
const YAW = 0.1;            // the model turns this far each way (radians) while the stop plays
const SMALL = matchMedia("(max-width: 768px)").matches;
const STREAKS = SMALL ? 700 : 1500;
const STREAK_DIR = 0.3;     // radians north of east: an illustration, not a measured wind direction
const STREAK_SPEED = 0.012; // map units a second per m/s of mean wind speed
const STREAK_TAIL = 0.7;    // seconds of travel each streak trails behind it
const PLANT_H = 0.17;       // column height of the largest solar plant; columns scale with sqrt(MW)
const PLANT_W = 0.005;
const BEAM_H = 0.34;        // beam height of the largest hotspot; beams scale with sqrt(GW)
const BEAM_W = 0.01;
const SCALE_KM = [50, 100, 200, 250, 500];
const SCALE_PX = 110;       // longest scale bar in CSS px
const HUB = "Delhi";        // the grid draws on outward from here
const kvClass = (kv) => (kv >= 765 ? 2 : kv >= 400 ? 1 : 0);

// Stage boundaries over the stop's progress q (0..1).
const STAGES = [0, 0.11, 0.23, 0.35, 0.48, 0.6, 0.73, 0.86, 1];
const LAST = STAGES.length - 2;
const during = (q, k) => win(q, STAGES[k], k === LAST ? 2 : STAGES[k + 1]);
const from = (q, k) => win(q, STAGES[k], 2);
export function energyStageOf(q) {
  for (let i = LAST; i >= 0; i--) if (q >= STAGES[i]) return i;
  return 0;
}

const terrainVert = /* glsl */ `
attribute float aElev;
uniform float uLift;
varying vec2 vD;
void main() {
  vD = vec2(uv.x, 1.0 - uv.y); // texture rows run north to south
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, aElev * uLift, 1.0);
}`;

// Relief with one story at a time on top: a resource drape, the land ruled out, or the hotspots.
const terrainFrag = /* glsl */ `
uniform sampler2D uRelief, uSolar, uWind, uMask, uHot;
uniform vec2 uMaskSize;
uniform float uShow, uOut, uBorders, uSolarK, uSolarWipe, uWindK, uWindWipe, uDim, uExcl, uTime, uAspect, uPixelRatio;
uniform vec3 uHotK, uRip;   // solar, wind, hybrid: strength and how far the reveal wave has run
uniform vec2 uOriS, uOriW, uOriH;
varying vec2 vD;
const vec3 ACCENT = vec3(0.56, 0.83, 1.0), LUMA = vec3(0.299, 0.587, 0.114);
const vec3 SOLAR = vec3(1.0, 0.70, 0.255), WIND = vec3(0.27, 0.83, 0.91), HYBRID = vec3(0.75, 0.55, 1.0);
const vec3 PROTECT = vec3(0.37, 0.75, 0.48);
const float ID = 20.0 / 255.0;

// state id of the texel under uv, unfiltered so neighbouring ids never blend
float idAt(vec2 uv) { return floor(textureLod(uMask, (floor(uv * uMaskSize) + 0.5) / uMaskSize, 0.0).r / ID + 0.5); }
float fill(float v) { return smoothstep(0.35, 0.65, v); }
float edge(float v) { return 1.0 - smoothstep(0.5, 1.5, abs(v - 0.5) / max(fwidth(v), 1e-4)); }
// > 0 once the wave from o has passed: it runs out at a steady pace while t goes 0 -> 1
float reach(vec2 o, float t) { return t * 1.6 - length((vD - o) * vec2(uAspect, 1.0)); }

vec3 hotspot(vec3 col, float v, vec3 tint, float k, float t, vec2 o, float shade) {
  float r = reach(o, t), on = smoothstep(0.0, 0.03, r) * k;
  float pulse = 0.82 + 0.18 * sin(uTime * 2.2 - r * 14.0);
  col = mix(col, tint * shade, fill(v) * on * 0.8 * pulse);
  col = mix(col, tint * 1.3, edge(v) * on);
  return col + tint * 0.22 * k * (1.0 - t) * (1.0 - smoothstep(0.0, 0.025, abs(r))); // the wave front
}

void main() {
  vec3 rel = texture2D(uRelief, vD).rgb;
  vec4 m = texture2D(uMask, vD);
  vec3 hot = texture2D(uHot, vD).rgb;
  float inside = smoothstep(0.25 * ID, 0.75 * ID, m.r);
  float lum = dot(rel, LUMA);
  vec3 col = rel;

  // resource drapes wipe in: solar from the south-west, wind from the west
  col = mix(col, texture2D(uSolar, vD).rgb, uSolarK * smoothstep(0.0, 0.08, uSolarWipe * 1.1 - (vD.x + 1.0 - vD.y) * 0.5));
  col = mix(col, texture2D(uWind, vD).rgb, uWindK * smoothstep(0.0, 0.08, uWindWipe * 1.1 - vD.x));

  // a quieter base for the grid and the hotspots
  col = mix(col, vec3(dot(col, LUMA)), 0.35 * uDim) * (1.0 - 0.38 * uDim);

  // land ruled out turns grey and dark, protected areas are hatched green, open land stays lit
  float open = smoothstep(0.2, 0.55, m.g) * inside, prot = smoothstep(0.3, 0.7, m.b) * inside;
  float hatch = step(0.55, fract((gl_FragCoord.x + gl_FragCoord.y) / (7.0 * uPixelRatio)));
  vec3 ex = mix(vec3(lum * 0.5), vec3(0.92, 0.95, 1.0) * (0.55 + 0.6 * lum), open);
  ex = mix(ex, mix(ex, PROTECT, 0.35 + 0.35 * hatch), prot);
  col = mix(col, ex, uExcl);

  float shade = 0.75 + 0.5 * lum;
  col = hotspot(col, hot.r, SOLAR, uHotK.x, uRip.x, uOriS, shade);
  col = hotspot(col, hot.g, WIND, uHotK.y, uRip.y, uOriW, shade);
  col = hotspot(col, hot.b, HYBRID, uHotK.z, uRip.z, uOriH, shade);

  // outside the ten states: darker and greyer; the region edge and state borders on top
  float o = (1.0 - inside) * uOut;
  col = mix(col, vec3(lum), 0.6 * o) * (1.0 - 0.55 * o);
  vec2 px = fwidth(vD);
  float id = idAt(vD), ix = idAt(vD + vec2(px.x, 0.0)), iy = idAt(vD + vec2(0.0, px.y));
  float inR = step(0.5, id), inX = step(0.5, ix), inY = step(0.5, iy);
  float rim = max(abs(inR - inX), abs(inR - inY));
  float border = inR * inX * inY * max(step(0.5, abs(id - ix)), step(0.5, abs(id - iy)));
  col = mix(col, ACCENT, rim * uBorders * 0.85);
  col = mix(col, vec3(0.92, 0.95, 1.0), border * uBorders * 0.35);
  gl_FragColor = vec4(col, uShow);
}`;

// The block's sides: from the terrain's edge down to a flat base, with faint strata.
const wallVert = /* glsl */ `
attribute float aTop, aElev;
uniform float uLift, uDepth;
varying float vZ, vTop;
void main() {
  vZ = aTop > 0.5 ? aElev * uLift : -uDepth;
  vTop = aTop;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, vZ, 1.0);
}`;
const wallFrag = /* glsl */ `
uniform float uShow, uDepth;
varying float vZ, vTop;
void main() {
  vec3 col = mix(vec3(0.05, 0.07, 0.11), vec3(0.16, 0.19, 0.25), clamp((vZ + uDepth) / (uDepth + 0.05), 0.0, 1.0));
  col += 0.05 * smoothstep(0.9, 1.0, fract(vZ * 140.0));
  col += vec3(0.25, 0.4, 0.55) * 0.3 * smoothstep(0.9, 1.0, vTop); // lit lip along the top edge
  gl_FragColor = vec4(col, uShow);
}`;

// Grid lines: drawn on outward from Delhi, then pulses run along them. 765 kV coral, 400 kV amber, 220 kV pale.
const lineVert = /* glsl */ `
attribute float aElev, aT, aKv;
uniform float uLift, uDraw, uLines, uTime;
varying vec3 vC;
varying float vA;
void main() {
  vec3 c = aKv > 1.5 ? vec3(1.0, 0.48, 0.35) : aKv > 0.5 ? vec3(1.0, 0.82, 0.48) : vec3(0.85, 0.89, 0.95);
  float pulse = 1.0 + 0.7 * smoothstep(0.9, 1.0, sin(aT * 90.0 - uTime * 2.5));
  vC = c * pulse;
  vA = min(1.0, uLines * smoothstep(0.0, 0.03, uDraw * 1.06 - aT) * (aKv > 0.5 ? 0.9 : 0.5) * pulse);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, aElev * uLift + 0.003 + aKv * 0.0015, 1.0);
}`;
const lineFrag = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() { gl_FragColor = vec4(vC, vA); }`;

// Substations pop in once the drawing wave reaches them; turbines twinkle.
const pointVert = /* glsl */ `
attribute float aElev, aT, aKv, aSeed;
uniform float uLift, uDraw, uK, uTime, uPixelRatio, uSize, uTwinkle;
uniform vec3 uColor;
varying vec3 vC;
varying float vA;
void main() {
  vC = aKv > 1.5 ? vec3(1.0, 0.48, 0.35) : aKv > 0.5 ? vec3(1.0, 0.82, 0.48) : uColor;
  vA = uK * smoothstep(0.0, 0.04, uDraw * 1.06 - aT - 0.02) * (1.0 - uTwinkle * 0.45 * (1.0 + sin(uTime * 3.0 + aSeed * 40.0)) * 0.5);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, aElev * uLift + 0.005, 1.0);
  gl_PointSize = (uSize + 1.2 * aKv) * uPixelRatio;
}`;
const pointFrag = /* glsl */ `
uniform float uRing;
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  vec3 c = mix(vC, vec3(0.03, 0.05, 0.08), uRing * smoothstep(0.3, 0.38, d));
  gl_FragColor = vec4(c, vA * (1.0 - smoothstep(0.4, 0.5, d)));
}`;

// Instanced columns: solar plants (solid, rising by capacity) and hotspot beams (glowing, additive).
const columnVert = /* glsl */ `
attribute vec3 aAt;
attribute float aH, aT, aKind;
uniform float uLift, uWidth;
uniform vec3 uRise;  // growth per kind: solar, wind, hybrid
varying float vL, vTop, vKind, vA;
void main() {
  float rise = aKind > 1.5 ? uRise.z : aKind > 0.5 ? uRise.y : uRise.x;
  float grow = smoothstep(0.0, 0.3, rise * 1.3 - aT);
  vec3 p = vec3(aAt.xy + position.xy * uWidth, aAt.z * uLift + position.z * aH * grow);
  vL = 0.55 + 0.45 * max(dot(normal, normalize(vec3(-0.5, 0.6, 0.6))), 0.0);
  vTop = position.z;
  vKind = aKind;
  vA = step(0.001, grow);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const plantFrag = /* glsl */ `
uniform float uK;
varying float vL, vTop, vKind, vA;
void main() { gl_FragColor = vec4(vec3(1.0, 0.70, 0.255) * vL * (0.7 + 0.5 * vTop), uK * vA); }`;
const beamFrag = /* glsl */ `
uniform vec3 uK;
uniform float uTime;
varying float vL, vTop, vKind, vA;
void main() {
  vec3 c = vKind > 1.5 ? vec3(0.75, 0.55, 1.0) : vKind > 0.5 ? vec3(0.27, 0.83, 0.91) : vec3(1.0, 0.70, 0.255);
  float k = vKind > 1.5 ? uK.z : vKind > 0.5 ? uK.y : uK.x;
  gl_FragColor = vec4(c * 1.2, (1.0 - vTop) * (0.5 + 0.25 * sin(uTime * 3.0 - vTop * 8.0)) * k * vA);
}`;

// Wind streaks: positions come from createStreaks() every frame.
const streakVert = /* glsl */ `
attribute float aA;
uniform float uK;
varying float vA;
void main() {
  vA = aA * uK;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const streakFrag = /* glsl */ `
varying float vA;
void main() { gl_FragColor = vec4(0.62, 0.93, 1.0, vA); }`;

async function loadDem(url, w, h, max) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const raw = new Uint16Array(await res.arrayBuffer());
  if (raw.length !== w * h) throw new Error(`${url}: ${raw.length} samples, expected ${w * h}`);
  const norm = Float32Array.from(raw, (m) => m / max);
  // bilinear height (0..1 of the highest peak) at u, v in 0..1
  const at = (u, v) => {
    const x = Math.min(Math.max(u, 0), 1) * (w - 1), y = Math.min(Math.max(v, 0), 1) * (h - 1);
    const x0 = Math.min(w - 2, x | 0), y0 = Math.min(h - 2, y | 0), fx = x - x0, fy = y - y0, i = y0 * w + x0;
    return (norm[i] * (1 - fx) + norm[i + 1] * fx) * (1 - fy) + (norm[i + w] * (1 - fx) + norm[i + w + 1] * fx) * fy;
  };
  return { norm, at };
}

// Four strips from the terrain's edge down to the base, walking round the map.
function buildWalls(norm, w, h, size) {
  const edges = [
    Array.from({ length: w }, (_, i) => i),
    Array.from({ length: h }, (_, j) => j * w + w - 1),
    Array.from({ length: w }, (_, i) => (h - 1) * w + w - 1 - i),
    Array.from({ length: h }, (_, j) => (h - 1 - j) * w),
  ];
  const pos = [], top = [], elev = [], index = [];
  for (const e of edges) {
    const first = pos.length / 3;
    for (const k of e) {
      const x = ((k % w) / (w - 1) - 0.5) * size.x, y = (0.5 - Math.floor(k / w) / (h - 1)) * size.y;
      pos.push(x, y, 0, x, y, 0); top.push(1, 0); elev.push(norm[k], norm[k]);
    }
    for (let i = 0; i < e.length - 1; i++) {
      const a = first + i * 2;
      index.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
    }
  }
  const g = geometry({ position: [pos, 3], aTop: [top, 1], aElev: [elev, 1] });
  g.setIndex(index);
  return g;
}

// Line segments with their height and their distance from the hub (0..1) for the draw-on; far is the
// largest distance in map units.
function buildLines(lines, at, size, hub) {
  const pos = [], elev = [], t = [], kv = [];
  for (const [k, flat] of lines) {
    for (let i = 0; i + 3 < flat.length; i += 2) {
      for (const j of [i, i + 2]) {
        const u = flat[j] / 1e4, v = flat[j + 1] / 1e4;
        pos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0);
        elev.push(at(u, v)); kv.push(kvClass(k));
        t.push(Math.hypot((u - hub[0]) * size.x, (v - hub[1]) * size.y));
      }
    }
  }
  const far = t.reduce((a, b) => Math.max(a, b), 0);
  return { far, geometry: geometry({ position: [pos, 3], aElev: [elev, 1], aT: [t.map((d) => d / far), 1], aKv: [kv, 1] }) };
}

function buildPoints(items, at, size, hub, far) {
  const pos = [], elev = [], t = [], kv = [], seed = [];
  for (const [u, v, k] of items) {
    pos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0);
    elev.push(at(u, v)); kv.push(k); seed.push(Math.random());
    t.push(Math.hypot((u - hub[0]) * size.x, (v - hub[1]) * size.y) / far);
  }
  return geometry({ position: [pos, 3], aElev: [elev, 1], aT: [t, 1], aKv: [kv, 1], aSeed: [seed, 1] });
}

// One instanced cylinder per item [u, v, height, delay 0..1, kind], standing on the terrain.
function buildColumns(items, at, size) {
  const base = new THREE.CylinderGeometry(1, 1, 1, 8, 1);
  base.rotateX(Math.PI / 2).translate(0, 0, 0.5); // axis along +z, from 0 to 1
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.attributes.position);
  g.setAttribute("normal", base.attributes.normal);
  const attr = (data, n) => new THREE.InstancedBufferAttribute(new Float32Array(data), n);
  g.setAttribute("aAt", attr(items.flatMap(([u, v]) => [(u - 0.5) * size.x, (0.5 - v) * size.y, at(u, v)]), 3));
  g.setAttribute("aH", attr(items.map((i) => i[2]), 1));
  g.setAttribute("aT", attr(items.map((i) => i[3]), 1));
  g.setAttribute("aKind", attr(items.map((i) => i[4]), 1));
  g.instanceCount = items.length;
  return g;
}

// Streaks that move with the local mean wind speed, faster and brighter where it blows harder.
function createStreaks(wind, n, size, at) {
  const { w, h, v: grid } = wind;
  const speedAt = (u, v) => (u < 0 || u >= 1 || v < 0 || v >= 1 ? 0 : grid[((v * h) | 0) * w + ((u * w) | 0)] / 10);
  const pos = new Float32Array(n * 6), alpha = new Float32Array(n * 2);
  const spawn = (p) => {
    for (let k = 0; k < 40; k++) { p.u = Math.random(); p.v = Math.random(); if (speedAt(p.u, p.v) > 0) break; }
    p.age = 0; p.life = 2.5 + Math.random() * 3;
    return p;
  };
  const parts = Array.from({ length: n }, () => { const p = spawn({}); p.age = Math.random() * p.life; return p; });
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute("aA", new THREE.BufferAttribute(alpha, 1).setUsage(THREE.DynamicDrawUsage));
  return {
    geometry: g,
    update(dt, lift, time) {
      for (let i = 0; i < n; i++) {
        const p = parts[i];
        p.age += dt;
        let s = speedAt(p.u, p.v);
        if (s <= 0 || p.age > p.life) { spawn(p); s = speedAt(p.u, p.v); }
        const ang = STREAK_DIR + 0.35 * Math.sin(p.v * 9 + p.u * 5 + time * 0.15);
        const dx = Math.cos(ang), dy = Math.sin(ang), step = s * STREAK_SPEED;
        p.u += (dx * step * dt) / size.x;
        p.v -= (dy * step * dt) / size.y;
        const tu = p.u - (dx * step * STREAK_TAIL) / size.x, tv = p.v + (dy * step * STREAK_TAIL) / size.y;
        const o = i * 6;
        pos[o] = (p.u - 0.5) * size.x; pos[o + 1] = (0.5 - p.v) * size.y; pos[o + 2] = at(p.u, p.v) * lift + 0.012;
        pos[o + 3] = (tu - 0.5) * size.x; pos[o + 4] = (0.5 - tv) * size.y; pos[o + 5] = at(tu, tv) * lift + 0.012;
        const fade = Math.max(0, Math.min(1, p.age / 0.5, (p.life - p.age) / 0.8));
        alpha[i * 2] = fade * Math.min(1, Math.max(0.15, (s - 2.5) / 4.5));
        alpha[i * 2 + 1] = 0;
      }
      g.attributes.position.needsUpdate = true;
      g.attributes.aA.needsUpdate = true;
    },
  };
}

const gw = (x) => (x >= 10 ? Math.round(x) : x.toFixed(1)).toLocaleString("en-US");

export async function createEnergy(scene, dpr, stationZ) {
  const loader = new THREE.TextureLoader();
  const meta = await loadJson(`${BASE}ni-meta-${V}.json`);
  const [dem, relief, solar, wind, mask, hot] = await Promise.all([
    loadDem(`${BASE}ni-dem-${V}.bin`, meta.dem.w, meta.dem.h, meta.dem.max),
    ...["relief", "solar", "wind"].map((n) => loadImage(loader, `${BASE}ni-${n}-${V}.jpg`)),
    ...["mask", "hot"].map((n) => loadImage(loader, `${BASE}ni-${n}-${V}.png`))]);
  const size = new THREE.Vector2((MAP_H * meta.km[0]) / meta.km[1], MAP_H);
  const kmPerUnit = meta.km[1] / MAP_H;
  const uv = (p) => [p[0] / 1e4, p[1] / 1e4];
  const city = Object.fromEntries(meta.cities.map(([n, u, v]) => [n, uv([u, v])]));
  const hub = city[HUB] || [0.5, 0.5];

  const shared = { uLift: { value: 0 }, uTime: { value: 0 }, uPixelRatio: { value: dpr } };
  const mat = (vertexShader, fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, ...extra });

  const [oriS, oriW, oriH] = ["solar", "wind", "hybrid"].map((k) => new THREE.Vector2(...uv(meta.hot[k][0].slice(1, 3))));
  const tu = {
    ...shared, uRelief: { value: relief }, uSolar: { value: solar }, uWind: { value: wind }, uMask: { value: mask },
    uHot: { value: hot }, uMaskSize: { value: new THREE.Vector2(mask.image.width, mask.image.height) },
    uShow: { value: 0 }, uOut: { value: 0 }, uBorders: { value: 0 }, uSolarK: { value: 0 }, uSolarWipe: { value: 0 },
    uWindK: { value: 0 }, uWindWipe: { value: 0 }, uDim: { value: 0 }, uExcl: { value: 0 }, uAspect: { value: size.x / size.y },
    uHotK: { value: new THREE.Vector3() }, uRip: { value: new THREE.Vector3() },
    uOriS: { value: oriS }, uOriW: { value: oriW }, uOriH: { value: oriH },
  };
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x, size.y, meta.dem.w - 1, meta.dem.h - 1).setAttribute("aElev", new THREE.BufferAttribute(dem.norm, 1)),
    mat(terrainVert, terrainFrag, tu, { depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const wu = { ...shared, uShow: tu.uShow, uDepth: { value: DEPTH } };
  const walls = new THREE.Mesh(buildWalls(dem.norm, meta.dem.w, meta.dem.h, size),
    mat(wallVert, wallFrag, wu, { depthWrite: true, side: THREE.DoubleSide }));

  const grid = buildLines(meta.lines, dem.at, size, hub), far = grid.far;
  const lu = { ...shared, uDraw: { value: 0 }, uLines: { value: 0 } };
  const lines = new THREE.LineSegments(grid.geometry, mat(lineVert, lineFrag, lu));
  const su = { ...shared, uDraw: lu.uDraw, uK: { value: 0 }, uSize: { value: 2.6 }, uTwinkle: { value: 0 },
    uColor: { value: new THREE.Vector3(0.92, 0.95, 1.0) }, uRing: { value: 1 } };
  const subs = new THREE.Points(buildPoints(meta.subs.map(([u, v, kv]) => [u / 1e4, v / 1e4, kvClass(kv)]), dem.at, size, hub, far),
    mat(pointVert, pointFrag, su));
  const tbu = { ...shared, uDraw: { value: 1 }, uK: { value: 0 }, uSize: { value: 2.4 }, uTwinkle: { value: 1 },
    uColor: { value: new THREE.Vector3(0.27, 0.83, 0.91) }, uRing: { value: 0 } };
  const turbines = new THREE.Points(buildPoints(meta.turbines.map(([u, v]) => [u / 1e4, v / 1e4, 0]), dem.at, size, hub, Infinity),
    mat(pointVert, pointFrag, tbu));

  const maxMw = Math.max(...meta.plants.map((p) => p[2]));
  const plantH = (mw) => PLANT_H * Math.sqrt(mw / maxMw);
  const pu = { ...shared, uWidth: { value: PLANT_W }, uRise: { value: new THREE.Vector3() }, uK: { value: 0 } };
  const plants = new THREE.Mesh(buildColumns(meta.plants.map(([u, v, mw]) => [u / 1e4, v / 1e4, plantH(mw), Math.random(), 0]), dem.at, size),
    mat(columnVert, plantFrag, pu, { depthWrite: true }));

  const kinds = ["solar", "wind", "hybrid"];
  const maxGw = Math.max(...kinds.flatMap((k) => meta.hot[k].map((h) => h[3])));
  const beamH = (x) => BEAM_H * Math.sqrt(x / maxGw);
  const beamItems = kinds.flatMap((k, kind) => meta.hot[k].map(([, u, v, x], i) => [u / 1e4, v / 1e4, beamH(x), i / 10, kind]));
  const bu = { ...shared, uWidth: { value: BEAM_W }, uRise: { value: new THREE.Vector3() }, uK: { value: new THREE.Vector3() } };
  const beams = new THREE.Mesh(buildColumns(beamItems, dem.at, size),
    mat(columnVert, beamFrag, bu, { side: THREE.DoubleSide, blending: THREE.AdditiveBlending }));

  const streaks = createStreaks(meta.wind, STREAKS, size, dem.at);
  const ku = { uK: { value: 0 } };
  const streakLines = new THREE.LineSegments(streaks.geometry, mat(streakVert, streakFrag, ku, { blending: THREE.AdditiveBlending }));

  const clearer = depthClearer();
  const drawn = [clearer, walls, terrain, lines, subs, turbines, plants, streakLines, beams];
  // after the research stop's objects (999 and up), so the two never interleave while both fade
  drawn.forEach((m, i) => { m.frustumCulled = false; m.renderOrder = 2000 + i; });
  const group = new THREE.Group();
  group.add(...drawn);
  scene.add(group);
  const fit = makeFitter(group, size);
  let fitted = false;
  const prevPos = new THREE.Vector3();

  // Labels, highest priority first: a label that would overlap one already placed is skipped.
  const labels = [];
  const add = (name, cls, [u, v], a, h = () => 0) => labels.push({ name, cls, u, v, a, h });
  const rise = bu.uRise.value;
  meta.hot.solar.slice(0, 5).forEach(([id, u, v, x]) => add(`${id} · ${gw(x)} GW`, "solar", uv([u, v]), (q) => during(q, 5), () => beamH(x) * rise.x));
  meta.hot.wind.slice(0, 4).forEach(([id, u, v, x]) => add(`${id} · ${gw(x)} GW`, "wind", uv([u, v]), (q) => during(q, 6), () => beamH(x) * rise.y));
  meta.hot.hybrid.slice(0, 3).forEach(([id, u, v, x, y]) => add(`${id} · ${gw(x)} + ${gw(y)} GW`, "hybrid", uv([u, v]), (q) => during(q, 7), () => beamH(x) * rise.z));
  meta.top_plants.slice(0, 2).forEach(([name, u, v, mw]) => add(`${name} · ${mw.toLocaleString("en-US")} MW`, "plant", uv([u, v]),
    (q) => during(q, 3), () => plantH(mw) * pu.uRise.value.x));
  meta.states.forEach(([name, u, v]) => add(name, "big state", uv([u, v]), (q) => during(q, 0) + during(q, 4)));
  const CITY_STAGES = { Delhi: [0, 3], Jaipur: [0], Lucknow: [0, 1], Srinagar: [0], Leh: [1, 2], Jaisalmer: [1, 2], Jodhpur: [1], Bikaner: [1, 2], Barmer: [2] };
  for (const [name, ks] of Object.entries(CITY_STAGES)) if (city[name]) add(name, "", city[name], (q) => ks.reduce((s, k) => s + during(q, k), 0));
  const screenOf = makeScreenOf();

  const pinStart = stationZ + P.researchView;
  const pinEnd = pinStart - P.researchPin;
  let form = 0, q = 0;

  return {
    pinStart, pinEnd,
    update(dt, camZ, time, camera) {
      q = Math.max(0, Math.min(1, (pinStart - camZ) / P.researchPin));
      const want = camZ <= stationZ + 6.6 && camZ >= pinEnd - 1.0;
      form = Math.max(0, Math.min(1, form + (want ? dt / 1.1 : -dt / 1.4)));
      group.visible = form > 0.001;
      if (!group.visible) { fitted = false; return q; } // snap to a fresh fit on re-entry

      const S = STAGES;
      const tilt = ramp(q, 0, S[1] * 0.8);
      const lift = LIFT * ramp(q, 0.01, S[1]);
      group.rotation.x = FACE_TILT + (TILT - FACE_TILT) * tilt;
      group.rotation.z = YAW * (2 * q - 1) * tilt;
      shared.uLift.value = lift;
      shared.uTime.value = time;

      // refit every frame (scroll speed zooms the camera) and ease toward the fit so it never jumps
      const clamped = Math.min(Math.max(camZ, pinEnd), pinStart);
      const prevScale = group.scale.x;
      prevPos.copy(group.position);
      fit(camera, clamped - camZ, clamped - P.researchView, lift);
      const k = fitted ? 1 - Math.exp(-dt * 5) : 1;
      group.scale.setScalar(prevScale + (group.scale.x - prevScale) * k);
      group.position.x = prevPos.x + (group.position.x - prevPos.x) * k;
      group.position.y = prevPos.y + (group.position.y - prevPos.y) * k;
      fitted = true;

      tu.uShow.value = form;
      tu.uOut.value = ramp(q, 0, 0.05);
      tu.uBorders.value = ramp(q, 0.01, 0.06);
      tu.uSolarK.value = during(q, 1);
      tu.uSolarWipe.value = ramp(q, S[1], S[1] + 0.07);
      tu.uWindK.value = during(q, 2);
      tu.uWindWipe.value = ramp(q, S[2], S[2] + 0.07);
      tu.uDim.value = from(q, 3);
      tu.uExcl.value = during(q, 4);
      tu.uHotK.value.set(from(q, 5) * (1 - 0.55 * from(q, 6)), from(q, 6) * (1 - 0.55 * from(q, 7)), from(q, 7));
      tu.uRip.value.set(ramp(q, S[5], S[5] + 0.09), ramp(q, S[6], S[6] + 0.09), ramp(q, S[7], S[7] + 0.08));
      lu.uDraw.value = ramp(q, S[3], S[3] + 0.085);
      lu.uLines.value = from(q, 3) * (1 - 0.9 * during(q, 4) - 0.82 * from(q, 5)) * form;
      su.uK.value = during(q, 3) * form;
      tbu.uK.value = (during(q, 3) + during(q, 6)) * form;
      pu.uRise.value.x = ramp(q, S[3] + 0.015, S[3] + 0.09);
      pu.uK.value = (during(q, 3) + 0.8 * during(q, 7)) * form;
      bu.uRise.value.set(ramp(q, S[5], S[5] + 0.06), ramp(q, S[6], S[6] + 0.06), ramp(q, S[7], S[7] + 0.06));
      bu.uK.value.set(during(q, 5), during(q, 6), during(q, 7)).multiplyScalar(form);
      ku.uK.value = (during(q, 2) + 0.45 * during(q, 6)) * form;

      lines.visible = lu.uLines.value > 0.002;
      subs.visible = su.uK.value > 0.002;
      turbines.visible = tbu.uK.value > 0.002;
      plants.visible = pu.uK.value > 0.002;
      beams.visible = bu.uK.value.x + bu.uK.value.y + bu.uK.value.z > 0.002;
      streakLines.visible = ku.uK.value > 0.002;
      if (streakLines.visible) streaks.update(dt, lift, time);
      return q;
    },
    // Screen overlay in CSS px: labels with opacity, north arrow and scale bar; null when hidden.
    overlay(camera) {
      if (!group.visible) return null;
      group.updateMatrixWorld();
      const lift = shared.uLift.value, placed = [];
      const out = labels.map((l) => {
        const a = form * Math.min(1, l.a(q)), hidden = { name: l.name, cls: l.cls, x: 0, y: 0, a: 0 };
        if (a <= 0.004) return hidden;
        const p = screenOf(group, (l.u - 0.5) * size.x, (0.5 - l.v) * size.y, dem.at(l.u, l.v) * lift + l.h() + 0.01, camera);
        if (!p) return hidden;
        const big = l.cls === "big state", w = big ? l.name.length * 9 : 16 + l.name.length * 8.5;
        const x0 = big ? p[0] - w / 2 : p[0] - 6;
        if (placed.some(([bx, by, bw]) => x0 < bx + bw && x0 + w > bx && Math.abs(p[1] - by) < 18)) return hidden;
        placed.push([x0, p[1], w]);
        return { name: l.name, cls: l.cls, x: p[0], y: p[1], a };
      });
      // north: the map's own +y on screen, foreshortened by the tilt
      const o = screenOf(group, 0, 0, 0, camera), n = screenOf(group, 0, 0.1, 0, camera), e = screenOf(group, 0.1, 0, 0, camera);
      if (!o || !n || !e) return { labels: out, north: null, scale: null };
      const nx = n[0] - o[0], ny = n[1] - o[1], ex = Math.hypot(e[0] - o[0], e[1] - o[1]);
      const box = fitBox(), W = innerWidth, H = innerHeight;
      const north = { x: box.x1 * W - 26, y: box.y0 * H + 26, rot: Math.atan2(nx, -ny),
        sy: Math.max(0.35, Math.min(1, Math.hypot(nx, ny) / ex)), a: form };
      // scale bar: east-west at the map centre, where the tilt does not shorten it
      const pxPerKm = ex / (0.1 * kmPerUnit);
      let km = SCALE_KM[0];
      for (const c of SCALE_KM) if (c * pxPerKm <= SCALE_PX) km = c;
      const scale = { x: box.x0 * W + 6, y: box.y1 * H - 30, w: km * pxPerKm, text: `${km} km`, a: form };
      return { labels: out, north, scale };
    },
  };
}

// HUD copy. Sources: Global Solar Atlas, Global Wind Atlas, ESA WorldCover, SRTM, OpenStreetMap,
// MNRE (state capacity, 31 October 2026) and CEA's CO2 baseline (0.675 t/MWh, FY 2025-26).
// legend: [class suffix, label] pairs, or ["ramp", low, high, ramp class].
export const ENERGY_STAGES = [
  { name: "One grid, from Ladakh to the Thar", stat: 898496, dp: 0, unit: "km² of land, nearly France and Germany combined",
    legend: [["edge", "Region edge"], ["border", "State border"]],
    text: "India's Northern grid region: six states and four union territories, from the cold desert of Ladakh to the hot Thar. Terrain from SRTM, drawn 19 times taller so the Himalaya reads." },
  { name: "Where the sun is strongest", stat: 1601, dp: 0, unit: "kWh a year from each kilowatt of panels, on average",
    legend: [["ramp", "1,350", "1,950 kWh/kWp", "solar"]],
    text: "Global Solar Atlas yields. The dry Thar in western Rajasthan and the thin, clear air of Ladakh (1,752) lead; haze and winter fog hold the Gangetic plain to about 1,500." },
  { name: "Where the wind blows", stat: 6.8, dp: 1, unit: "m/s at 100 m in the windiest zone, about 24 km an hour",
    legend: [["ramp", "2.5", "8 m/s", "wind"], ["streak", "Faster = windier"]],
    text: "Global Wind Atlas means at turbine height. Only 9% of the region passes 6 m/s, in the western Thar and the high Himalaya, and most of those mountains are too steep or too high to build on." },
  { name: "What is already built", stat: 90473, dp: 0, unit: "km of 220 kV+ power lines, over twice around the Earth",
    legend: [["l765", "765 kV"], ["l400", "400 kV"], ["l220", "220 kV"], ["sub", "Substation"], ["plant", "Solar plant"], ["turbine", "Turbine"]],
    text: "OpenStreetMap maps 945 substations, 833 solar plants (22.9 GW) and 3,942 wind turbines. MNRE counts 59.5 GW of solar and 5.8 GW of wind installed here, all of the wind in Rajasthan." },
  { name: "Land that is off limits", stat: 122399, dp: 0, unit: "km² left for solar parks, 13.6% of the region",
    legend: [["open", "Open for solar"], ["excl", "Ruled out"], ["prot", "Protected area"]],
    text: "Forests, farmland, towns, water and snow are ruled out, with slopes over 5°, ground above 5,000 m, protected areas and existing parks. What remains must also yield 1,450 kWh/kWp." },
  { name: "Solar hotspots", stat: 297, dp: 0, unit: "GW of solar on 0.8% of the region's land",
    legend: [["solar", "Solar hotspot"], ["beam", "Beam height = GW"]],
    text: "An AHP score weighs PV yield (49%), distance to lines and substations (36%), roads and slope. 36 zones: 95% of the capacity is in Rajasthan, 99% within 10 km of a 220 kV+ line." },
  { name: "Wind hotspots", stat: 72, dp: 0, unit: "GW of wind in 13 zones, all in Rajasthan",
    legend: [["wind", "Wind hotspot"], ["turbine", "Existing turbine"]],
    text: "Here the capacity factor carries 54% of the score. W1, 41 km east of Jaisalmer, holds 25.5 GW at 6.3 m/s; the windiest, W7, averages 6.8 m/s. At 4 MW per km², the land between turbines stays in use." },
  { name: "Where to build first", stat: 677, dp: 0, unit: "TWh a year if every hotspot were built, about 457 Mt of CO2 avoided",
    legend: [["hybrid", "Hybrid site"], ["solar", "Solar"], ["wind", "Wind"], ["plant", "Built plant"]],
    text: "9 sites (3,502 km²) are hot for both: H1 pairs 57 GW of solar with 9.6 GW of wind on one grid connection. A check on the method: 171 of the 833 solar plants already built sit in or within 5 km of a hotspot." },
];
