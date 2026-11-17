// Research stop: the Neugal watershed rebuilt from the dissertation's own maps, with OpenStreetMap
// rivers, roads and villages laid over it.
// neugal.bin = uint16 W, uint16 H, then 8 uint8 planes: risk (0 outside, 1..4), elev, R, K, LS, C, P, A.
// osm.json = { lines: {river, stream, road_major, road_minor: [[u,v,...]*1000]}, places: [[u,v,risk]], labels }
import * as THREE from "three";
import { P } from "./config.js";

const MAP_H = 1.9;
const COPIES = 2;
const RAIN = 1400;
const KIND = { river: 0, stream: 1, road_major: 2, road_minor: 3 };
const LINE_STEP = 0.0022; // uv spacing between line particles, about 60 m on the ground

// Stage boundaries over research progress q (0..1); each layer fades in and out around its window.
const STAGES = [0, 0.12, 0.24, 0.36, 0.58, 0.72, 0.86, 1];
const SUB = [0.36, 0.415, 0.47, 0.525, 0.58]; // K, LS, C, P inside the factor stage
const FADE = 0.022;
function smooth(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }
const win = (q, a, b) => Math.min(smooth((q - a + FADE) / (2 * FADE)), 1 - smooth((q - b + FADE) / (2 * FADE)));
const ramp01 = (q, a, b) => smooth((q - a) / (b - a));

export function stageOf(q) {
  for (let i = STAGES.length - 2; i >= 0; i--) if (q >= STAGES[i]) return i;
  return 0;
}
export function subOf(q) {
  for (let i = SUB.length - 2; i >= 0; i--) if (q >= SUB[i]) return i;
  return 0;
}

const RAMP = /* glsl */ `
vec3 ramp(float v) {
  vec3 a = vec3(0.055, 0.165, 0.36), b = vec3(0.25, 0.55, 1.0), c = vec3(0.78, 0.92, 1.0);
  return v < 0.5 ? mix(a, b, v * 2.0) : mix(b, c, v * 2.0 - 1.0);
}`;

const vert = /* glsl */ `
attribute vec2 aUV;
attribute vec4 aA;   // elev, R, K, LS
attribute vec4 aB;   // C, P, A, risk/4
attribute float aSeed;
uniform vec2 uSize;
uniform float uForm, uLift, uFlow, uTime, uPointSize, uPixelRatio, uHover, uDim;
uniform vec4 uWa;    // base, elev, R, K
uniform vec4 uWb;    // LS, C, P, A
uniform float uWRisk;
uniform vec2 uCursorNDC;
uniform vec2 uOutlet;
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;
${RAMP}
vec3 riskColor(float r) {
  if (r < 0.375) return vec3(0.12, 0.25, 0.48);
  if (r < 0.625) return vec3(0.25, 0.55, 1.0);
  if (r < 0.875) return vec3(0.66, 0.86, 1.0);
  return vec3(1.0, 0.36, 0.30);
}
void main() {
  float elev = aA.x;
  vec3 p = vec3((aUV.x - 0.5) * uSize.x, (0.5 - aUV.y) * uSize.y, elev * uLift);
  p.z += sin(uTime * 1.3 + aSeed * 40.0) * 0.004;

  float critical = step(0.875, aB.w);
  float high = step(0.625, aB.w);
  float alpha = 1.0;
  // soil leaves the risk zones and runs down to the outlet, then off the map
  if (uFlow > 0.0 && high > 0.5 && fract(aSeed * 13.7) < 0.55) {
    float t = fract(uTime * 0.09 + aSeed * 7.3);
    vec3 outlet = vec3((uOutlet.x - 0.5) * uSize.x, (0.5 - uOutlet.y) * uSize.y, 0.0);
    vec3 path = mix(p, outlet, smoothstep(0.0, 0.75, t));
    path.y -= max(t - 0.75, 0.0) * 2.4;
    path.z += sin(t * 3.14159) * 0.08;
    p = mix(p, path, uFlow);
    alpha = mix(1.0, 1.0 - smoothstep(0.8, 1.0, t), uFlow);
  }

  vec3 scattered = vec3((fract(aSeed * 11.3) - 0.5) * 9.0, -2.4 - fract(aSeed * 31.9) * 1.2, (fract(aSeed * 71.1) - 0.5) * 6.0);
  float e = clamp((uForm - fract(aSeed * 53.7) * 0.35) / 0.65, 0.0, 1.0);
  e = 1.0 - pow(1.0 - e, 4.0);
  p = mix(scattered, p, e);

  vec3 col = vec3(0.42, 0.66, 1.0) * uWa.x
    + mix(ramp(elev), vec3(0.95, 0.97, 1.0), smoothstep(0.82, 1.0, elev)) * uWa.y
    + ramp(aA.y) * uWa.z + ramp(aA.z) * uWa.w
    + ramp(aA.w) * uWb.x + ramp(aB.x) * uWb.y + ramp(aB.y) * uWb.z
    + mix(vec3(0.1, 0.22, 0.45), vec3(1.0, 0.45, 0.38), aB.z) * uWb.w
    + riskColor(aB.w) * uWRisk;
  float wsum = uWa.x + uWa.y + uWa.z + uWa.w + uWb.x + uWb.y + uWb.z + uWb.w + uWRisk;
  col /= max(wsum, 0.0001);
  float pulse = critical * uWRisk * (0.5 + 0.5 * sin(uTime * 3.0 + aSeed * 6.0));
  col += vec3(0.5, 0.12, 0.08) * pulse * 0.6;
  // when the overlay is on stage, calm terrain recedes so rivers, roads and villages read
  col *= mix(1.0, 0.45 + 0.55 * high, uDim);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec4 clip = projectionMatrix * mv;
  vec2 toCursor = clip.xy / max(clip.w, 0.0001) - uCursorNDC;
  float glow = exp(-dot(toCursor, toCursor) / 0.012) * uHover;
  gl_Position = clip;
  float sz = uPointSize * (1.0 + glow * 1.6 + pulse * 0.5) * (1.0 + aA.w * uWb.x * 0.8);
  gl_PointSize = sz * uPixelRatio * clamp(6.0 / max(-mv.z, 0.5), 0.4, 1.8);
  vColor = col;
  vGlow = glow;
  vAlpha = alpha * smoothstep(0.3, 1.0, e);
}`;

const frag = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
varying float vGlow;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  if (d > 0.5) discard;
  // the cursor lights particles through cool shades toward white
  vec3 col = mix(vColor, mix(vec3(0.55, 0.85, 1.0), vec3(1.0), vGlow), clamp(vGlow * 1.2, 0.0, 1.0));
  gl_FragColor = vec4(col * (1.0 + vGlow * 0.6), (1.0 - smoothstep(0.3, 0.5, d)) * vAlpha);
}`;

const rainVert = /* glsl */ `
attribute float aSeed;
uniform vec2 uSize;
uniform float uTime, uRain, uPixelRatio;
varying float vA;
void main() {
  float t = fract(uTime * 0.9 + aSeed * 17.0);
  vec3 p = vec3((fract(aSeed * 3.71) - 0.5) * uSize.x, (fract(aSeed * 7.13) - 0.5) * uSize.y, 0.8 - t * 0.9);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 6.0 * uPixelRatio * clamp(4.0 / max(-mv.z, 0.5), 0.4, 1.1);
  vA = uRain * smoothstep(0.0, 0.15, t) * (1.0 - smoothstep(0.85, 1.0, t)) * 0.55;
}`;
const rainFrag = /* glsl */ `
varying float vA;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.02, 0.07, abs(c.x))) * (1.0 - smoothstep(0.2, 0.5, abs(c.y)));
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.7, 0.88, 1.0, a * vA);
}`;

// OSM lines: draw on along their length; water pulses downstream, risky roads turn coral.
const lineVert = /* glsl */ `
attribute float aKind, aT, aElev, aRisk, aSeed;
uniform vec2 uSize;
uniform float uLift, uTime, uWater, uRoads, uRain, uImpact, uForm, uPixelRatio;
varying vec3 vC;
varying float vA;
void main() {
  float sz = aKind < 0.5 ? 5.0 : aKind < 1.5 ? 3.4 : aKind < 2.5 ? 3.2 : 2.2;
  vec3 p = vec3((position.x - 0.5) * uSize.x, (0.5 - position.y) * uSize.y, aElev * uLift + 0.01);
  bool water = aKind < 1.5;
  float reveal = water ? uWater : uRoads;
  float drawn = smoothstep(0.0, 0.04, reveal * 1.15 - (aT * 0.8 + aSeed * 0.2));
  vec3 c;
  float a;
  if (aKind < 0.5) { c = vec3(0.62, 0.9, 1.0); a = 0.95; }
  else if (aKind < 1.5) { c = vec3(0.45, 0.8, 1.0); a = 0.8; }
  else if (aKind < 2.5) { c = vec3(0.86, 0.92, 1.0); a = 0.6; }
  else { c = vec3(0.6, 0.72, 0.92); a = 0.32; }
  if (water) {
    float wave = 0.5 + 0.5 * sin(aT * 60.0 - uTime * (2.5 + uRain * 4.0));
    c *= 0.65 + wave * (0.35 + uRain * 0.6);
  } else {
    float hot = step(2.5, aRisk) * uImpact;
    c = mix(c, vec3(1.0, 0.42, 0.34), hot * (0.6 + 0.4 * sin(uTime * 3.0 + aSeed * 9.0)));
    a = mix(a, 0.9, hot);
  }
  vC = c;
  vA = a * drawn * uForm;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = sz * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
}`;
const lineFrag = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vC, (1.0 - smoothstep(0.15, 0.5, d)) * vA);
}`;

const placeVert = /* glsl */ `
attribute float aRisk, aSeed, aElev;
uniform vec2 uSize;
uniform float uLift, uTime, uPlaces, uImpact, uPixelRatio;
varying vec3 vC;
varying float vA, vRing;
void main() {
  vec3 p = vec3((position.x - 0.5) * uSize.x, (0.5 - position.y) * uSize.y, aElev * uLift + 0.015);
  float risky = step(2.5, aRisk) * uImpact;
  float beat = 0.5 + 0.5 * sin(uTime * 3.2 + aSeed * 12.0);
  vC = mix(vec3(0.85, 0.95, 1.0), vec3(1.0, 0.45, 0.36), risky);
  vA = uPlaces * smoothstep(0.0, 0.1, uPlaces * 1.2 - aSeed) * mix(0.7, 1.0, risky);
  vRing = risky * beat;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (5.0 + risky * (6.0 + beat * 8.0)) * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
}`;
const placeFrag = /* glsl */ `
varying vec3 vC;
varying float vA, vRing;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(0.12, 0.2, d);
  float ring = (1.0 - smoothstep(0.03, 0.06, abs(d - 0.38))) * vRing;
  gl_FragColor = vec4(vC, (core + ring * 0.8) * vA);
}`;

function buildLines(osm, elevAt, riskAt) {
  const pos = [], kind = [], t = [], elev = [], risk = [], seed = [];
  for (const [name, list] of Object.entries(osm.lines)) {
    for (const flat of list) {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] / 1000, flat[i + 1] / 1000]);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[cum.length - 1] || 1, s = Math.random();
      // sample each polyline as evenly spaced particles so it reads in the point-cloud style
      for (let i = 1; i < pts.length; i++) {
        const steps = Math.max(1, Math.ceil((cum[i] - cum[i - 1]) / LINE_STEP));
        for (let k = 0; k < steps; k++) {
          const f = k / steps, x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
          pos.push(x, y, 0);
          kind.push(KIND[name]); t.push((cum[i - 1] + (cum[i] - cum[i - 1]) * f) / total); seed.push(s);
          elev.push(elevAt(x, y)); risk.push(riskAt(x, y));
        }
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aKind", new THREE.Float32BufferAttribute(kind, 1));
  g.setAttribute("aT", new THREE.Float32BufferAttribute(t, 1));
  g.setAttribute("aElev", new THREE.Float32BufferAttribute(elev, 1));
  g.setAttribute("aRisk", new THREE.Float32BufferAttribute(risk, 1));
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  return g;
}

function buildPlaces(osm, elevAt) {
  const pos = [], risk = [], seed = [], elev = [];
  for (const [u, v, r] of osm.places) {
    pos.push(u, v, 0); risk.push(r); seed.push(Math.random()); elev.push(elevAt(u, v));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aRisk", new THREE.Float32BufferAttribute(risk, 1));
  g.setAttribute("aSeed", new THREE.Float32BufferAttribute(seed, 1));
  g.setAttribute("aElev", new THREE.Float32BufferAttribute(elev, 1));
  return g;
}

async function load(url, kind) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return kind === "json" ? res.json() : res.arrayBuffer();
}

export async function createResearch(scene, dpr, stationZ) {
  const [buf, osm] = await Promise.all([load("/research/neugal.bin"), load("/research/osm.json", "json")]);
  const head = new DataView(buf);
  const W = head.getUint16(0, true), H = head.getUint16(2, true);
  const plane = (i) => new Uint8Array(buf, 4 + i * W * H, W * H);
  const [risk, elev, R, K, LS, C, Pp, A] = [0, 1, 2, 3, 4, 5, 6, 7].map(plane);
  const cell = (u, v) => Math.min(H - 1, Math.max(0, (v * H) | 0)) * W + Math.min(W - 1, Math.max(0, (u * W) | 0));
  const elevAt = (u, v) => elev[cell(u, v)] / 255;
  const riskAt = (u, v) => risk[cell(u, v)];

  const cells = [];
  for (let i = 0; i < W * H; i++) if (risk[i]) cells.push(i);
  const n = cells.length * COPIES;
  const uv = new Float32Array(n * 2), a = new Float32Array(n * 4), b = new Float32Array(n * 4), seed = new Float32Array(n);
  let o = 0;
  for (let c = 0; c < COPIES; c++) for (const i of cells) {
    const x = i % W, y = (i / W) | 0;
    uv[o * 2] = (x + Math.random()) / W;
    uv[o * 2 + 1] = (y + Math.random()) / H;
    a.set([elev[i] / 255, R[i] / 255, K[i] / 255, LS[i] / 255], o * 4);
    b.set([C[i] / 255, Pp[i] / 255, A[i] / 255, risk[i] / 4], o * 4);
    seed[o] = Math.random();
    o++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  geo.setAttribute("aUV", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("aA", new THREE.BufferAttribute(a, 4));
  geo.setAttribute("aB", new THREE.BufferAttribute(b, 4));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));

  const size = new THREE.Vector2(MAP_H * W / H, MAP_H);
  const shared = { uSize: { value: size }, uLift: { value: 0 }, uTime: { value: 0 }, uPixelRatio: { value: dpr } };
  const u = {
    ...shared, uForm: { value: 0 }, uFlow: { value: 0 }, uPointSize: { value: 2.2 }, uHover: { value: 0 }, uDim: { value: 0 },
    uWa: { value: new THREE.Vector4(1, 0, 0, 0) }, uWb: { value: new THREE.Vector4() }, uWRisk: { value: 0 },
    uCursorNDC: { value: new THREE.Vector2() }, uOutlet: { value: new THREE.Vector2(0.52, 0.99) },
  };
  const mat = (vertexShader, fragmentShader, uniforms, additive) => new THREE.ShaderMaterial({ vertexShader, fragmentShader,
    uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });

  const points = new THREE.Points(geo, mat(vert, frag, u, false));
  const rs = new Float32Array(RAIN);
  for (let i = 0; i < RAIN; i++) rs[i] = Math.random();
  const rainGeo = new THREE.BufferGeometry();
  rainGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(RAIN * 3), 3));
  rainGeo.setAttribute("aSeed", new THREE.BufferAttribute(rs, 1));
  const ru = { ...shared, uRain: { value: 0 } };
  const rain = new THREE.Points(rainGeo, mat(rainVert, rainFrag, ru, true));
  const lu = { ...shared, uWater: { value: 0 }, uRoads: { value: 0 }, uRain: ru.uRain, uImpact: { value: 0 }, uForm: { value: 0 } };
  const lines = new THREE.Points(buildLines(osm, elevAt, riskAt), mat(lineVert, lineFrag, lu, true));
  const pu = { ...shared, uPlaces: { value: 0 }, uImpact: lu.uImpact };
  const places = new THREE.Points(buildPlaces(osm, elevAt), mat(placeVert, placeFrag, pu, true));
  for (const m of [points, rain, lines, places]) m.frustumCulled = false;

  const group = new THREE.Group();
  group.add(points, lines, places, rain);
  group.rotation.x = -0.78;
  scene.add(group);

  const labelLocal = osm.labels.map((l) => ({ name: l.n, uv: [l.u, l.v] }));
  const tmp = new THREE.Vector3();
  const pinStart = stationZ + P.researchView;
  const pinEnd = pinStart - P.researchPin;
  let form = 0, q = 0;

  return {
    pinStart, pinEnd, stats: osm.stats,
    update(dt, camZ, time, cursor, hoverAct) {
      q = Math.max(0, Math.min(1, (pinStart - camZ) / P.researchPin));
      const want = camZ <= stationZ + 6.6 && camZ >= pinEnd - 1.0 ? 1 : 0;
      form = Math.max(0, Math.min(1, form + (want ? 1 : -1) * dt / ((want ? 900 : 1400) / 1000)));
      group.visible = form > 0.001;
      if (!group.visible) return q;

      const pinnedZ = Math.min(Math.max(camZ, pinEnd), pinStart) - P.researchView;
      group.position.set(innerWidth > innerHeight ? 0.42 : 0, 0.5, pinnedZ);

      const S = STAGES, mid = (S[4] + S[5]) / 2;
      u.uWa.value.set(win(q, -1, S[1]), win(q, S[1], S[2]), win(q, S[2], S[3]), win(q, SUB[0], SUB[1]));
      u.uWb.value.set(win(q, SUB[1], SUB[2]), win(q, SUB[2], SUB[3]), win(q, SUB[3], SUB[4]), win(q, S[4], mid));
      u.uWRisk.value = win(q, mid, 2);
      // dim calm terrain while rivers draw on (stage 1) and while the OSM overlay is up (stages 6-7)
      u.uDim.value = Math.max(0.95 * win(q, -1, S[1]), ramp01(q, S[5] - FADE, S[5] + FADE));
      shared.uLift.value = 0.24 * ramp01(q, S[1] - FADE, S[1] + 2 * FADE);
      u.uFlow.value = ramp01(q, S[5], S[5] + 0.06);
      ru.uRain.value = win(q, S[2], S[3]);
      lu.uWater.value = Math.max(form > 0.95 ? 0.15 : 0, ramp01(q, 0.0, S[1] - 0.01));
      lu.uRoads.value = ramp01(q, S[5], S[5] + 0.08);
      lu.uImpact.value = ramp01(q, S[5] + 0.05, S[5] + 0.1);
      lu.uForm.value = form;
      pu.uPlaces.value = ramp01(q, S[5] + 0.02, S[5] + 0.09);
      u.uForm.value = form;
      shared.uTime.value = time;
      u.uCursorNDC.value.copy(cursor);
      u.uHover.value = hoverAct;
      return q;
    },
    // Screen positions for the place labels (CSS px), or null when hidden.
    labels(camera) {
      if (!group.visible || form < 0.5) return labelLocal.map(() => null);
      group.updateMatrixWorld();
      return labelLocal.map(({ name, uv }) => {
        tmp.set((uv[0] - 0.5) * size.x, (0.5 - uv[1]) * size.y, elevAt(uv[0], uv[1]) * shared.uLift.value + 0.02);
        group.localToWorld(tmp).project(camera);
        return { name, x: (tmp.x * 0.5 + 0.5) * innerWidth, y: (0.5 - tmp.y * 0.5) * innerHeight };
      });
    },
  };
}

// HUD copy: plain numbers anyone can picture, with the technical detail in the text.
// Football field = 105 m x 68 m (0.714 ha). Elephant = about 6 tonnes.
export const RESEARCH_STAGES = [
  { name: "A valley that feeds a river", stat: 80000, dp: 0, unit: "football fields of land",
    text: "The Neugal watershed covers 573.6 km² of Himalayan slopes. Every drop of rain that lands here ends up in one river, the Neugal, on its way to the Beas." },
  { name: "How high it climbs", stat: 4749, dp: 0, unit: "metres at the top, almost 6 Burj Khalifas",
    text: "Satellites measured the height of every 30 m patch of ground. The land rises from 562 m in the valley to snowy peaks." },
  { name: "How hard it rains", stat: 2.2, dp: 1, unit: "metres of rain a year, taller than a grown-up",
    text: "17 years of satellite rain records (1998 to 2015) show how hard rain hits each slope. Harder rain knocks more soil loose." },
  { name: "Five ingredients", stat: 5, dp: 0, unit: "things decide how much soil washes away", sub: [
    "Soil type: some soils crumble more easily than others.",
    "Slope: steeper, longer slopes let water race downhill and carry more soil.",
    "Plant cover: forests hold soil in place, bare fields do not. Mapped from Sentinel-2 images, 98% accurate.",
    "Farming: terraces and contour ploughing slow the water down."] },
  { name: "How much soil is lost", stat: 125, dp: 0, unit: "elephants of soil, from one football field, every year",
    text: "Multiplying the five ingredients gives soil loss for every patch: 1,047.66 tonnes per hectare per year on average. Rivers, rock cracks, relief and landforms then rank the land from low to critical risk." },
  { name: "Who lives here", stat: 82, dp: 0, unit: "villages sit on or beside high-risk ground",
    text: "OpenStreetMap shows 417 villages and hamlets, 876 km of roads and 360 km of streams in this valley. 201 km of road crosses high-risk ground." },
  { name: "Why it matters", stat: 2500, dp: 0, unit: "football fields of critical land to protect first",
    text: "Soil takes hundreds of years to form and one storm to lose. Washed-away soil clogs rivers and small hydro dams, worsens floods and leaves farms poorer. This map shows planners exactly where to start, and the method works for any valley." },
];
export const EQ_TERMS = ["R", "K", "LS", "C", "P"];
