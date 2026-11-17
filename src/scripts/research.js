// Research stop: the Neugal watershed as a shaded 3D terrain from a real DEM, with the RUSLE layers
// from the dissertation draped over it, a drainage network derived from the DEM, physics-driven
// water and soil runoff, and OpenStreetMap roads and villages.
// Data: neugal-dem.bin (see research-data.js) and osm.json = { lines: {road_major, road_minor}, places, labels, stats }.
import * as THREE from "three";
import { P } from "./config.js";
import { loadWatershed, createRunoff } from "./research-data.js";

const MAP_H = 1.9;          // map height in world units before fitting to the screen
const LIFT = 0.3;           // full relief height: 1.5x vertical exaggeration of the real terrain
const SHADE_EXAGGERATION = 2.5;
const CONTOUR_M = 200;      // contour interval
const RAIN = 1400;
const RUNOFF = 5000;
const CHANNEL_CELLS = 30;   // accumulation where the drawn river network starts (about 0.4 km²)
const ROAD = { road_major: 2, road_minor: 3 };
const ROAD_STEP = 0.0022;   // uv spacing between road particles, about 60 m on the ground
// Free screen area for the map (fractions of the viewport, from the top-left), clear of the HUD.
const FIT_LANDSCAPE = { x0: 0.34, x1: 0.78, y0: 0.12, y1: 0.88 };
const FIT_PORTRAIT = { x0: 0.05, x1: 0.95, y0: 0.35, y1: 0.69 };

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
}
vec3 riskColor(float r) {
  if (r < 0.375) return vec3(0.12, 0.25, 0.48);
  if (r < 0.625) return vec3(0.25, 0.55, 1.0);
  if (r < 0.875) return vec3(0.66, 0.86, 1.0);
  return vec3(1.0, 0.36, 0.30);
}`;

const terrainVert = /* glsl */ `
attribute float aElev;
attribute vec2 aData;
uniform float uLift;
varying vec2 vD;
void main() {
  vD = aData;
  vec3 p = vec3(position.xy, aElev * uLift);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

// Hillshade from the DEM (sun in the north-west), contours, RUSLE layer colours and the watershed rim.
const terrainFrag = /* glsl */ `
uniform sampler2D uDem, uLA, uLB;
uniform vec2 uTexel;
uniform float uShadeK, uReliefM, uContourM, uContour, uForm, uDim, uWet, uTime;
uniform vec4 uWa;    // base, elev, R, K
uniform vec4 uWb;    // LS, C, P, A
uniform float uWRisk;
varying vec2 vD;
${RAMP}
float dem(vec2 o) { return texture2D(uDem, vD + o * uTexel).r; }
void main() {
  vec4 la = texture2D(uLA, vD), lb = texture2D(uLB, vD);
  if (lb.a < 0.5) discard;
  float e = dem(vec2(0.0));
  float ex = dem(vec2(1.0, 0.0)) - dem(vec2(-1.0, 0.0));
  float ey = dem(vec2(0.0, 1.0)) - dem(vec2(0.0, -1.0));
  vec3 nrm = normalize(vec3(-ex * uShadeK, ey * uShadeK, 1.0));
  float sun = max(dot(nrm, normalize(vec3(-0.6, 0.6, 0.75))), 0.0);

  vec3 base = mix(vec3(0.10, 0.20, 0.42), vec3(0.42, 0.64, 1.0), smoothstep(0.0, 1.0, e));
  vec3 col = base * uWa.x
    + mix(ramp(e), vec3(0.96, 0.98, 1.0), smoothstep(0.78, 0.95, e)) * uWa.y
    + ramp(la.r) * uWa.z + ramp(la.g) * uWa.w
    + ramp(la.b) * uWb.x + ramp(la.a) * uWb.y + ramp(lb.r) * uWb.z
    + mix(vec3(0.1, 0.22, 0.45), vec3(1.0, 0.45, 0.38), lb.g) * uWb.w
    + riskColor(lb.b) * uWRisk;
  col /= max(uWa.x + uWa.y + uWa.z + uWa.w + uWb.x + uWb.y + uWb.z + uWb.w + uWRisk, 0.0001);
  float critical = step(0.875, lb.b) * uWRisk;
  col += vec3(0.5, 0.12, 0.08) * critical * (0.3 + 0.3 * sin(uTime * 3.0));
  col *= mix(1.0, 0.4 + 0.6 * step(0.625, lb.b), uDim);
  col *= 1.0 - 0.45 * uWet; // darker ground while the storm runs so the runoff reads
  col *= 0.28 + 0.95 * sun;

  float cz = e * uReliefM / uContourM;
  float line = 1.0 - smoothstep(0.0, 1.0, abs(fract(cz + 0.5) - 0.5) / max(fwidth(cz), 0.0001));
  col += vec3(0.55, 0.82, 1.0) * line * uContour;
  col += vec3(0.56, 0.83, 1.0) * (1.0 - smoothstep(0.5, 0.68, lb.a)) * 0.9;

  // forms by flooding upward from the valley floor, with a glowing front
  float front = uForm * 1.15 - 0.05;
  float vis = 1.0 - smoothstep(front - 0.03, front, e);
  col += vec3(0.6, 0.85, 1.0) * (1.0 - smoothstep(0.0, 0.04, abs(e - front + 0.02))) * (1.0 - uForm) * 2.0;
  gl_FragColor = vec4(col, vis);
}`;

// Drainage network from the DEM: brightness and width by contributing area, pulses run downstream.
const riverVert = /* glsl */ `
attribute float aElev, aStr, aDist;
uniform float uLift, uTime, uWater, uRain, uForm, uPixelRatio, uDistKm;
varying vec3 vC;
varying float vA;
void main() {
  vec3 p = vec3(position.xy, aElev * uLift + 0.006);
  float shown = smoothstep(0.0, 0.08, uWater * 1.1 - (1.0 - aStr));
  float wave = 0.5 + 0.5 * sin(aDist * uDistKm * 1.1 + uTime * (2.2 + uRain * 3.5));
  vC = mix(vec3(0.2, 0.55, 1.0), vec3(0.75, 0.93, 1.0), wave * 0.6 + aStr * 0.2);
  vA = shown * uForm * (0.35 + 0.35 * aStr) * (0.5 + 0.5 * wave) * (1.0 + uRain * 0.4);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (1.3 + aStr * 2.2) * (1.0 + uRain * 0.3) * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
}`;

const dotFrag = /* glsl */ `
varying vec3 vC;
varying float vA;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vC, (1.0 - smoothstep(0.15, 0.5, d)) * vA);
}`;

// Runoff particles: positions come from the physics in research-data.js every frame.
const runoffVert = /* glsl */ `
attribute float aKind, aAlpha, aSettled;
uniform float uPixelRatio;
varying vec3 vC;
varying float vA;
void main() {
  bool water = aKind < 0.5;
  vC = water ? vec3(0.92, 0.99, 1.0) : aSettled > 0.0 ? vec3(0.78, 0.5, 0.3) : vec3(1.0, 0.6, 0.38);
  vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (water ? 2.8 : 3.2) * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
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

// OSM roads draw on; those crossing high-risk ground turn coral.
const roadVert = /* glsl */ `
attribute float aKind, aT, aElev, aRisk, aSeed;
uniform float uLift, uTime, uRoads, uImpact, uForm, uPixelRatio;
varying vec3 vC;
varying float vA;
void main() {
  vec3 p = vec3(position.xy, aElev * uLift + 0.007);
  float drawn = smoothstep(0.0, 0.04, uRoads * 1.15 - (aT * 0.8 + aSeed * 0.2));
  bool major = aKind < 2.5;
  vec3 c = major ? vec3(0.86, 0.92, 1.0) : vec3(0.6, 0.72, 0.92);
  float a = major ? 0.7 : 0.4;
  float hot = step(2.5, aRisk) * uImpact;
  c = mix(c, vec3(1.0, 0.42, 0.34), hot * (0.6 + 0.4 * sin(uTime * 3.0 + aSeed * 9.0)));
  vC = c;
  vA = mix(a, 0.9, hot) * drawn * uForm;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (major ? 3.0 : 2.1) * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
}`;

const placeVert = /* glsl */ `
attribute float aRisk, aSeed, aElev;
uniform float uLift, uTime, uPlaces, uImpact, uPixelRatio;
varying vec3 vC;
varying float vA, vRing;
void main() {
  vec3 p = vec3(position.xy, aElev * uLift + 0.012);
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

function geometry(attrs) {
  const g = new THREE.BufferGeometry();
  for (const [name, [data, size]] of Object.entries(attrs)) g.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  return g;
}

function buildTerrain(ws, size) {
  const { Wd, Hd } = ws;
  // vertices sit on DEM cell centres, row 0 (north) at the top
  const g = new THREE.PlaneGeometry(size.x * (Wd - 1) / Wd, size.y * (Hd - 1) / Hd, Wd - 1, Hd - 1);
  const elev = new Float32Array(Wd * Hd), data = new Float32Array(Wd * Hd * 2);
  for (let i = 0; i < Wd * Hd; i++) {
    elev[i] = ws.norm(i);
    data[i * 2] = ((i % Wd) + 0.5) / Wd;
    data[i * 2 + 1] = (((i / Wd) | 0) + 0.5) / Hd;
  }
  g.setAttribute("aElev", new THREE.BufferAttribute(elev, 1));
  g.setAttribute("aData", new THREE.BufferAttribute(data, 2));
  return g;
}

function textures(ws) {
  const { Wd, Hd, Wl, Hl, layers: L } = ws;
  const half = new Uint16Array(Wd * Hd);
  for (let i = 0; i < Wd * Hd; i++) half[i] = THREE.DataUtils.toHalfFloat(ws.norm(i));
  const dem = new THREE.DataTexture(half, Wd, Hd, THREE.RedFormat, THREE.HalfFloatType);
  const a = new Uint8Array(Wl * Hl * 4), b = new Uint8Array(Wl * Hl * 4);
  for (let i = 0; i < Wl * Hl; i++) {
    a.set([L.R[i], L.K[i], L.LS[i], L.C[i]], i * 4);
    b.set([L.P[i], L.A[i], L.risk[i] * 63.75, L.risk[i] ? 255 : 0], i * 4);
  }
  const la = new THREE.DataTexture(a, Wl, Hl), lb = new THREE.DataTexture(b, Wl, Hl);
  for (const t of [dem, la, lb]) {
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
  }
  return { dem, la, lb };
}

function buildRivers(ws, size) {
  const { Wd, Hd, acc, down, dist } = ws;
  let maxAcc = 1, maxDist = 1;
  for (let i = 0; i < Wd * Hd; i++) { maxAcc = Math.max(maxAcc, acc[i]); maxDist = Math.max(maxDist, dist[i]); }
  const lo = Math.log(CHANNEL_CELLS), span = Math.log(maxAcc) - lo;
  const pos = [], elev = [], str = [], dst = [];
  for (let i = 0; i < Wd * Hd; i++) {
    if (acc[i] < CHANNEL_CELLS || down[i] < 0) continue;
    const d = down[i], s = (Math.log(acc[i]) - lo) / span;
    for (let k = 0; k < 3; k++) {
      const t = k / 3;
      const u = ((i % Wd) * (1 - t) + (d % Wd) * t + 0.5) / Wd, v = (((i / Wd) | 0) * (1 - t) + ((d / Wd) | 0) * t + 0.5) / Hd;
      pos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0);
      elev.push(ws.elevAt(u, v)); str.push(s);
      dst.push((dist[i] * (1 - t) + dist[d] * t) / maxDist);
    }
  }
  return { geo: geometry({ position: [pos, 3], aElev: [elev, 1], aStr: [str, 1], aDist: [dst, 1] }), distKm: maxDist / 1000 };
}

function buildRoads(osm, ws, size, riskAt) {
  const pos = [], kind = [], t = [], elev = [], risk = [], seed = [];
  for (const [name, list] of Object.entries(osm.lines)) {
    if (!(name in ROAD)) continue;
    for (const flat of list) {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] / 1000, flat[i + 1] / 1000]);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[cum.length - 1] || 1, s = Math.random();
      for (let i = 1; i < pts.length; i++) {
        const steps = Math.max(1, Math.ceil((cum[i] - cum[i - 1]) / ROAD_STEP));
        for (let k = 0; k < steps; k++) {
          const f = k / steps, x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
          pos.push((x - 0.5) * size.x, (0.5 - y) * size.y, 0);
          kind.push(ROAD[name]); t.push((cum[i - 1] + (cum[i] - cum[i - 1]) * f) / total); seed.push(s);
          elev.push(ws.elevAt(x, y)); risk.push(riskAt(x, y));
        }
      }
    }
  }
  return geometry({ position: [pos, 3], aKind: [kind, 1], aT: [t, 1], aElev: [elev, 1], aRisk: [risk, 1], aSeed: [seed, 1] });
}

function buildPlaces(osm, ws, size) {
  const pos = [], risk = [], seed = [], elev = [];
  for (const [u, v, r] of osm.places) {
    pos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0); risk.push(r); seed.push(Math.random()); elev.push(ws.elevAt(u, v));
  }
  return geometry({ position: [pos, 3], aRisk: [risk, 1], aSeed: [seed, 1], aElev: [elev, 1] });
}

async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

// Scales and centres the map so its full relief fits the free screen area, as seen from the
// camera's pinned position (the map is pinned relative to the camera while the stop plays).
function makeFitter(group, size) {
  const corners = [];
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [0, LIFT]) corners.push(new THREE.Vector3(x * size.x, y * size.y, z));
  const cam = new THREE.PerspectiveCamera(), p = new THREE.Vector3();
  return (camera, camShift, z) => {
    cam.copy(camera);
    cam.position.z += camShift;
    cam.updateMatrixWorld(true);
    const box = innerWidth > innerHeight ? FIT_LANDSCAPE : FIT_PORTRAIT;
    const tx = box.x0 + box.x1 - 1, ty = 1 - (box.y0 + box.y1), tw = (box.x1 - box.x0) * 2, th = (box.y1 - box.y0) * 2;
    group.position.z = z;
    for (let iter = 0; iter < 6; iter++) {
      group.updateMatrixWorld(true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        p.copy(c).applyMatrix4(group.matrixWorld).project(cam);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      group.scale.multiplyScalar(Math.min(tw / (x1 - x0), th / (y1 - y0)));
      const halfH = cam.position.distanceTo(group.position) * Math.tan((cam.fov * Math.PI) / 360);
      group.position.x += (tx - (x0 + x1) / 2) * halfH * cam.aspect;
      group.position.y += (ty - (y0 + y1) / 2) * halfH;
    }
  };
}

export async function createResearch(scene, dpr, stationZ) {
  const [ws, osm] = await Promise.all([loadWatershed("/research/neugal-dem.bin"), loadJson("/research/osm.json")]);
  const size = new THREE.Vector2(MAP_H * ws.Wd / ws.Hd, MAP_H);
  const riskAt = (u, v) => ws.layers.risk[Math.min(ws.Hl - 1, (v * ws.Hl) | 0) * ws.Wl + Math.min(ws.Wl - 1, (u * ws.Wl) | 0)];
  const runoff = createRunoff(ws, RUNOFF);

  const shared = { uLift: { value: 0 }, uTime: { value: 0 }, uPixelRatio: { value: dpr }, uForm: { value: 0 } };
  const tex = textures(ws);
  const tu = {
    ...shared, uDem: { value: tex.dem }, uLA: { value: tex.la }, uLB: { value: tex.lb },
    uTexel: { value: new THREE.Vector2(1 / ws.Wd, 1 / ws.Hd) },
    uShadeK: { value: (ws.relief / (2 * ws.cellW)) * SHADE_EXAGGERATION },
    uReliefM: { value: ws.relief }, uContourM: { value: CONTOUR_M }, uContour: { value: 0 }, uDim: { value: 0 }, uWet: { value: 0 },
    uWa: { value: new THREE.Vector4(1, 0, 0, 0) }, uWb: { value: new THREE.Vector4() }, uWRisk: { value: 0 },
  };
  const mat = (vertexShader, fragmentShader, uniforms, additive) => new THREE.ShaderMaterial({ vertexShader, fragmentShader,
    uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending });

  const terrainMat = mat(terrainVert, terrainFrag, tu, false);
  terrainMat.depthWrite = true;
  terrainMat.side = THREE.DoubleSide;
  const terrain = new THREE.Mesh(buildTerrain(ws, size), terrainMat);

  const rv = buildRivers(ws, size);
  const wu = { ...shared, uWater: { value: 0 }, uRain: { value: 0 }, uDistKm: { value: rv.distKm } };
  const rivers = new THREE.Points(rv.geo, mat(riverVert, dotFrag, wu, true));

  const rgeo = new THREE.BufferGeometry();
  const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  rgeo.setAttribute("position", dyn(runoff.out.pos, 3));
  rgeo.setAttribute("aKind", dyn(runoff.out.kind, 1));
  rgeo.setAttribute("aAlpha", dyn(runoff.out.alpha, 1));
  rgeo.setAttribute("aSettled", dyn(runoff.out.settled, 1));
  const flowPts = new THREE.Points(rgeo, mat(runoffVert, dotFrag, shared, false));

  const rs = new Float32Array(RAIN);
  for (let i = 0; i < RAIN; i++) rs[i] = Math.random();
  const ru = { ...shared, uSize: { value: size }, uRain: wu.uRain };
  const rain = new THREE.Points(geometry({ position: [new Float32Array(RAIN * 3), 3], aSeed: [rs, 1] }), mat(rainVert, rainFrag, ru, true));
  const lu = { ...shared, uRoads: { value: 0 }, uImpact: { value: 0 } };
  const roads = new THREE.Points(buildRoads(osm, ws, size, riskAt), mat(roadVert, dotFrag, lu, true));
  const pu = { ...shared, uPlaces: { value: 0 }, uImpact: lu.uImpact };
  const places = new THREE.Points(buildPlaces(osm, ws, size), mat(placeVert, placeFrag, pu, true));
  // draw after the world, on a cleared depth buffer, so the flight terrain never cuts into the map
  [terrain, rivers, roads, flowPts, places, rain].forEach((m, i) => { m.frustumCulled = false; m.renderOrder = 1000 + i; });
  terrain.onBeforeRender = (renderer) => {
    renderer.state.buffers.depth.setMask(true); // clear is a no-op while depth writes are off
    renderer.clearDepth();
  };

  const group = new THREE.Group();
  group.add(terrain, rivers, roads, flowPts, places, rain);
  group.rotation.x = -0.72; // north tilted away from the viewer, like a relief model on a table
  scene.add(group);
  const fit = makeFitter(group, size);
  let fitted = false;
  const prevPos = new THREE.Vector3();

  const ox = ((ws.outlet % ws.Wd) + 0.5) / ws.Wd, oy = (((ws.outlet / ws.Wd) | 0) + 0.5) / ws.Hd;
  const labelLocal = [
    ...osm.labels.map((l) => ({ name: l.n, u: l.u, v: l.v, cls: "" })),
    { name: "N", u: 0.5, v: -0.05, cls: "north", flat: true },
    { name: "Outlet to the Beas", u: ox, v: oy + 0.03, cls: "", flat: true },
  ];
  const tmp = new THREE.Vector3();
  const pinStart = stationZ + P.researchView;
  const pinEnd = pinStart - P.researchPin;
  let form = 0, q = 0;

  return {
    pinStart, pinEnd, stats: osm.stats,
    update(dt, camZ, time, camera) {
      q = Math.max(0, Math.min(1, (pinStart - camZ) / P.researchPin));
      const want = camZ <= stationZ + 6.6 && camZ >= pinEnd - 1.0 ? 1 : 0;
      form = Math.max(0, Math.min(1, form + (want ? 1 : -1) * dt / ((want ? 1100 : 1400) / 1000)));
      group.visible = form > 0.001;
      if (!group.visible) return q;

      const clamped = Math.min(Math.max(camZ, pinEnd), pinStart);
      // refit every frame (scroll speed zooms the camera) and ease toward the fit so it never jumps
      const prevScale = group.scale.x;
      prevPos.copy(group.position);
      fit(camera, clamped - camZ, clamped - P.researchView);
      const k = fitted ? 1 - Math.exp(-dt * 5) : 1;
      group.scale.setScalar(prevScale + (group.scale.x - prevScale) * k);
      group.position.x = prevPos.x + (group.position.x - prevPos.x) * k;
      group.position.y = prevPos.y + (group.position.y - prevPos.y) * k;
      fitted = true;

      const S = STAGES, mid = (S[4] + S[5]) / 2;
      tu.uWa.value.set(win(q, -1, S[1]), win(q, S[1], S[2]), win(q, S[2], S[3]), win(q, SUB[0], SUB[1]));
      tu.uWb.value.set(win(q, SUB[1], SUB[2]), win(q, SUB[2], SUB[3]), win(q, SUB[3], SUB[4]), win(q, S[4], mid));
      tu.uWRisk.value = win(q, mid, 2);
      tu.uDim.value = ramp01(q, S[5] - FADE, S[5] + FADE);
      tu.uContour.value = 0.12 + 0.3 * win(q, S[1], S[2]);
      shared.uLift.value = LIFT * (0.45 + 0.55 * ramp01(q, S[1] - FADE, S[1] + 2 * FADE));
      const rainK = win(q, S[2], S[3]);
      wu.uRain.value = rainK;
      tu.uWet.value = rainK;
      wu.uWater.value = Math.max(form > 0.95 ? 0.2 : 0, ramp01(q, 0.0, S[1] - 0.01));
      lu.uRoads.value = ramp01(q, S[5], S[5] + 0.08);
      lu.uImpact.value = ramp01(q, S[5] + 0.05, S[5] + 0.1);
      pu.uPlaces.value = ramp01(q, S[5] + 0.02, S[5] + 0.09);
      shared.uForm.value = form;
      shared.uTime.value = time;

      // water runs off during the rain stage; soil from the soil-loss stage on, fainter under the overlay
      const soilK = ramp01(q, S[4] - FADE, S[4] + FADE) * (1 - 0.6 * ramp01(q, S[5] - FADE, S[5] + FADE));
      runoff.update(dt, [rainK * form, soilK * form], { w: size.x, h: size.y, lift: shared.uLift.value });
      for (const k of ["position", "aKind", "aAlpha", "aSettled"]) flowPts.geometry.attributes[k].needsUpdate = true;
      return q;
    },
    // Screen positions for map labels (CSS px), or an empty list when hidden.
    labels(camera) {
      if (!group.visible || form < 0.5) return [];
      group.updateMatrixWorld();
      return labelLocal.map(({ name, u, v, cls, flat }) => {
        const z = flat ? 0 : ws.elevAt(u, v) * shared.uLift.value + 0.02;
        tmp.set((u - 0.5) * size.x, (0.5 - v) * size.y, z);
        group.localToWorld(tmp).project(camera);
        return { name, cls, x: (tmp.x * 0.5 + 0.5) * innerWidth, y: (0.5 - tmp.y * 0.5) * innerHeight };
      });
    },
  };
}

// HUD copy: plain numbers anyone can picture, with the technical detail in the text.
// Football field = 105 m x 68 m (0.714 ha). Elephant = about 6 tonnes.
export const RESEARCH_STAGES = [
  { name: "A valley that feeds a river", stat: 80000, dp: 0, unit: "football fields of land",
    text: "The Neugal watershed covers 573.6 km² of Himalayan slopes. Every stream drawn here was traced from the terrain itself, and every drop of rain ends up at one outlet, on its way to the Beas." },
  { name: "How high it climbs", stat: 4749, dp: 0, unit: "metres at the top, almost 6 Burj Khalifas",
    text: "Real elevation from the SRTM satellite mission, lit by a sun in the north-west, with a contour line every 200 m. The land rises from 562 m in the valley to snowy peaks." },
  { name: "How hard it rains", stat: 2.2, dp: 1, unit: "metres of rain a year, taller than a grown-up",
    text: "Rain runs downhill into the streams. Each drop moves at the speed Manning's equation gives for a 20 mm an hour storm on that slope; one second here is 30 minutes." },
  { name: "Five ingredients", stat: 5, dp: 0, unit: "things decide how much soil washes away", sub: [
    "Soil type: some soils crumble more easily than others.",
    "Slope: steeper, longer slopes let water race downhill and carry more soil.",
    "Plant cover: forests hold soil in place, bare fields do not. Mapped from Sentinel-2 images, 98% accurate.",
    "Farming: terraces and contour ploughing slow the water down."] },
  { name: "How much soil is lost", stat: 125, dp: 0, unit: "elephants of soil, from one football field, every year",
    text: "Soil leaves the steepest, barest slopes, rides the streams and settles where the land flattens. On average 1,047.66 tonnes per hectare wash away each year; the riskiest ground is ranked low to critical." },
  { name: "Who lives here", stat: 82, dp: 0, unit: "villages sit on or beside high-risk ground",
    text: "OpenStreetMap shows 417 villages and hamlets, 876 km of roads and 360 km of streams in this valley. 201 km of road crosses high-risk ground." },
  { name: "Why it matters", stat: 2500, dp: 0, unit: "football fields of critical land to protect first",
    text: "Soil takes hundreds of years to form and one storm to lose. Washed-away soil clogs rivers and small hydro dams, worsens floods and leaves farms poorer. This map shows planners exactly where to start, and the method works for any valley." },
];
export const EQ_TERMS = ["R", "K", "LS", "C", "P"];
