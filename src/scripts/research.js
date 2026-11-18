// Research stop: one continuous three.js animation. It opens on the globe, zooms through India and
// Himachal Pradesh to the Neugal watershed beside Palampur, then tilts the valley into a 3D relief
// built from a real DEM and shows one layer at a time: the drainage network, the height, a storm's
// runoff, the five RUSLE factors, soil loss, and the villages and roads at risk.
// Data in public/research/ (built by tools/research/build_dem.py and build_maps.py):
//   neugal-dem.bin      DEM, D8 drainage and RUSLE layers (see research-data.js)
//   osm.json            { lines: {road_major, road_minor, ...}, places: [[u, v, risk]], labels, stats }
//   context.json, world-land.png, hp-relief.jpg   the zoom context (see research-map.js)
//   neugal-albedo-v2.jpg   unlit natural colour of the watershed box
//   neugal-normal-v2.jpg   R, G terrain normal x (east) and y (north), B sky-view factor: lit here by a moving sun
//   neugal-mask.png     R stream lines, G Strahler order / 7, B watershed field (0.5 on the boundary)
import * as THREE from "three";
import { P } from "./config.js";
import { loadWatershed, createRunoff } from "./research-data.js";
import { R_KM, loadContext, zoomView, createZoomMap } from "./research-map.js";
import { fitBox, smooth, ramp, win, geometry, loadJson, loadImage, depthClearer, makeScreenOf, makeViews, makeRig, frame,
  RELIGHT, WINDOW, MAP_UV, sunDir, sunAt } from "./stop-kit.js";

const BASE = "/research/";
const MAP_H = 1.9;          // map height in world units before fitting to the screen
const LIFT = 0.3;           // full relief height: 1.5x vertical exaggeration of the real terrain
const SHADE_EXAG = 1.5;     // the normal map's slopes steepened as much as the relief
const FACE_TILT = -0.2;     // flat map square to the camera, which looks down about 11 degrees
const TILT = -0.72;         // north tilted away from the viewer, like a relief model on a table
// the light baked into the zoom's Himachal and Kangra reliefs, which the valley matches until it tilts up
const ZOOM_SUN = sunDir(315, 42);
const SMALL = matchMedia("(max-width: 768px)").matches;
const RAIN = SMALL ? 500 : 900;
const RUNOFF = SMALL ? 1600 : 3000;
const ROAD_STEP = 0.0022;   // uv spacing between road dots, about 60 m on the ground
const HIGH_RISK = 3;        // risk classes 1..4 = low, moderate, high, critical
const SCALE_KM = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];
const SCALE_PX = 110;       // longest scale bar in CSS px

// Stage boundaries over research progress q (0..1): stage 0 is the zoom, stage 4 the five factors.
const STAGES = [0, 0.2, 0.3, 0.38, 0.48, 0.72, 0.82, 0.91, 1];
const FACTORS = [0.48, 0.528, 0.576, 0.624, 0.672, 0.72]; // R, K, LS, C, P
// Zoom steps as fractions of stage 0: world to India, India to Himachal, Himachal to the watershed.
const ZOOMS = [[0.14, 0.32], [0.44, 0.62], [0.74, 0.94]];

// Zoom level for progress q: 0 world, 1 India, 2 Himachal Pradesh, 3 watershed.
export function zoomLevel(q) {
  const t = q / STAGES[1];
  return ZOOMS.reduce((L, [a, b]) => L + smooth((t - a) / (b - a)), 0);
}
export function stageOf(q) {
  for (let i = STAGES.length - 2; i >= 0; i--) if (q >= STAGES[i]) return i;
  return 0;
}
// Step inside a stage: the zoom target in stage 0, the factor in stage 4, otherwise -1.
export function subOf(q) {
  const s = stageOf(q);
  if (s === 0) return Math.min(3, Math.floor(zoomLevel(q) + 0.5));
  if (s !== 4) return -1;
  for (let i = FACTORS.length - 2; i > 0; i--) if (q >= FACTORS[i]) return i;
  return 0;
}

const RAMP = /* glsl */ `
vec3 ramp(float v) {
  vec3 a = vec3(0.06, 0.13, 0.30), b = vec3(0.16, 0.42, 0.85), c = vec3(0.50, 0.80, 1.0);
  return v < 0.5 ? mix(a, b, v * 2.0) : mix(b, c, v * 2.0 - 1.0);
}
vec3 riskColor(float r) {
  if (r < 0.375) return vec3(0.12, 0.25, 0.48);
  if (r < 0.625) return vec3(0.25, 0.55, 1.0);
  if (r < 0.875) return vec3(0.55, 0.80, 1.0);
  return vec3(1.0, 0.36, 0.30);
}`;

const terrainVert = /* glsl */ `
attribute float aElev;
attribute vec2 aData;
uniform float uLift;
varying vec2 vD;
void main() {
  vD = aData;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, aElev * uLift, 1.0);
}`;

// Natural-colour relief, lit by the sun, with one layer on top at a time: streams, a RUSLE factor, risk classes.
const terrainFrag = /* glsl */ `
uniform sampler2D uRelief, uNormal, uMask, uDist, uLA, uLB;
uniform vec3 uSun;
uniform vec4 uWa;   // R, K, LS, C
uniform vec4 uWb;   // P, risk classes, high risk, critical
uniform float uShow, uOut, uRivers, uReveal, uFlow, uWet, uTime, uDistKm;
varying vec2 vD;
const vec3 ACCENT = vec3(0.56, 0.83, 1.0), CORAL = vec3(1.0, 0.36, 0.30);
const float OUTSIDE = 0.32; // brightness left outside the watershed
${RAMP}
${RELIGHT}
${WINDOW}
void main() {
  vec3 nm = texture2D(uNormal, vD).rgb;
  vec3 rel = texture2D(uRelief, vD).rgb * shadeAt(unpackNormal(nm.rg, ${SHADE_EXAG.toFixed(2)}), nm.b, uSun);
  vec4 m = texture2D(uMask, vD);
  vec4 la = texture2D(uLA, vD), lb = texture2D(uLB, vD);
  float inside = smoothstep(0.4, 0.6, m.b);
  float lum = dot(rel, vec3(0.299, 0.587, 0.114));
  float shade = min(0.4 + 1.9 * lum, 1.15); // the relief's light and shadow, kept under the layers

  float w = uWa.x + uWa.y + uWa.z + uWa.w + uWb.x + uWb.y;
  vec3 layer = ramp(la.r) * uWa.x + ramp(la.g) * uWa.y + ramp(la.b) * uWa.z + ramp(la.a) * uWa.w
    + ramp(lb.r) * uWb.x + riskColor(lb.b) * uWb.y;
  vec3 col = mix(rel, layer / max(w, 1e-4) * shade, min(w, 1.0) * 0.9 * inside);
  float high = step(0.625, lb.b) * inside, crit = step(0.875, lb.b) * inside;
  col = mix(col, CORAL * shade, high * uWb.z * 0.2);
  col = mix(col, CORAL * shade * (0.9 + 0.15 * sin(uTime * 2.5)), crit * uWb.w * 0.85);
  col *= 1.0 - 0.3 * uWet; // wet ground while the storm runs

  // drainage: grows upstream from the outlet; pulses run downstream
  float dn = texture2D(uDist, vD).r;
  float grow = 1.0 - smoothstep(uReveal * 1.05 - 0.05, uReveal * 1.05, dn);
  float order = clamp((m.g * 7.0 - 2.0) / 2.0, 0.0, 1.0);
  vec3 water = mix(vec3(0.22, 0.45, 0.72), vec3(0.45, 0.72, 1.0), order);
  water *= 1.0 + 0.18 * uFlow * sin(dn * uDistKm * 2.4 + uTime * 3.0);
  col = mix(col, water, m.r * inside * grow * uRivers);

  // outside the watershed: darker and greyer, with a thin rim on the boundary
  float o = (1.0 - inside) * uOut;
  col = mix(col, vec3(lum), 0.6 * o) * (1.0 - (1.0 - OUTSIDE) * o);
  float rim = 1.0 - smoothstep(0.5, 1.5, abs(m.b - 0.5) / max(fwidth(m.b), 1e-4));
  col = mix(col, ACCENT, rim * uOut * 0.6);

  vec2 edge = smoothstep(vec2(0.0), vec2(0.015), vD) * smoothstep(vec2(0.0), vec2(0.015), 1.0 - vD);
  gl_FragColor = vec4(col, uShow * edge.x * edge.y * windowAt(vD));
}`;

const dotFrag = /* glsl */ `
varying vec3 vC;
varying float vA;
varying vec2 vUv;
${WINDOW}
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vC, (1.0 - smoothstep(0.15, 0.5, d)) * vA * windowAt(vUv));
}`;

// Runoff particles: positions come from the physics in research-data.js every frame.
const runoffVert = /* glsl */ `
attribute float aKind, aAlpha, aSettled;
uniform float uPixelRatio;
varying vec3 vC;
varying float vA;
varying vec2 vUv;
${MAP_UV}
void main() {
  vUv = mapUv(position.xy);
  bool water = aKind < 0.5;
  vC = water ? vec3(0.62, 0.84, 1.0) : aSettled > 0.0 ? vec3(0.72, 0.47, 0.28) : vec3(0.90, 0.58, 0.34);
  vA = aAlpha * (water ? 0.8 : 1.0);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = (water ? 2.6 : 3.0) * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
}`;

// Rain falls only over the watershed, from a short height onto the ground below each drop.
const rainVert = /* glsl */ `
attribute float aSeed, aElev;
uniform float uTime, uRain, uLift, uPixelRatio;
varying float vA;
varying vec2 vUv;
${MAP_UV}
void main() {
  vUv = mapUv(position.xy);
  float t = fract(uTime * 1.1 + aSeed * 17.0);
  vec3 p = vec3(position.xy, aElev * uLift + 0.28 * (1.0 - t));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 4.0 * uPixelRatio * clamp(4.0 / max(-mv.z, 0.5), 0.4, 1.1);
  vA = uRain * smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.8, 1.0, t)) * 0.4;
}`;
const rainFrag = /* glsl */ `
varying float vA;
varying vec2 vUv;
${WINDOW}
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = (1.0 - smoothstep(0.02, 0.07, abs(c.x))) * (1.0 - smoothstep(0.2, 0.5, abs(c.y)));
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.70, 0.84, 1.0, a * vA * windowAt(vUv));
}`;

// Roads across high-risk ground, drawn on along their length.
const roadVert = /* glsl */ `
attribute float aT, aElev, aSeed;
uniform float uLift, uDraw, uAlpha, uPixelRatio;
varying vec3 vC;
varying float vA;
varying vec2 vUv;
${MAP_UV}
void main() {
  vUv = mapUv(position.xy);
  vec3 p = vec3(position.xy, aElev * uLift + 0.006);
  vC = vec3(1.0, 0.42, 0.34);
  vA = 0.9 * uAlpha * smoothstep(0.0, 0.04, uDraw * 1.15 - (aT * 0.8 + aSeed * 0.2));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 2.4 * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
}`;

// Villages: small light dots; those on high-risk ground get a coral core and a slow ring.
const placeVert = /* glsl */ `
attribute float aRisk, aSeed, aElev;
uniform float uLift, uTime, uPlaces, uPixelRatio;
varying vec3 vC;
varying float vA, vCore, vRing;
varying vec2 vUv;
${MAP_UV}
void main() {
  vUv = mapUv(position.xy);
  vec3 p = vec3(position.xy, aElev * uLift + 0.01);
  float risky = step(2.5, aRisk);
  vC = mix(vec3(0.86, 0.91, 0.96), vec3(1.0, 0.42, 0.34), risky);
  vA = uPlaces * smoothstep(0.0, 0.1, uPlaces * 1.2 - aSeed * 0.2) * mix(0.45, 1.0, risky);
  vCore = mix(0.42, 0.16, risky);
  vRing = risky * (0.55 + 0.45 * sin(uTime * 2.4 + aSeed * 12.0));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = mix(3.5, 12.0, risky) * uPixelRatio * clamp(5.0 / max(-mv.z, 0.5), 0.5, 1.6);
}`;
const placeFrag = /* glsl */ `
varying vec3 vC;
varying float vA, vCore, vRing;
varying vec2 vUv;
${WINDOW}
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(vCore - 0.08, vCore, d);
  float ring = (1.0 - smoothstep(0.03, 0.07, abs(d - 0.38))) * vRing;
  gl_FragColor = vec4(vC, max(core, ring * 0.8) * vA * windowAt(vUv));
}`;

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

// Flow distance to the outlet (0..1) and the RUSLE layers as textures.
function layerTextures(ws) {
  const { Wd, Hd, Wl, Hl, layers: L } = ws;
  let maxDist = 1;
  for (let i = 0; i < Wd * Hd; i++) maxDist = Math.max(maxDist, ws.dist[i]);
  const half = new Uint16Array(Wd * Hd);
  for (let i = 0; i < Wd * Hd; i++) half[i] = THREE.DataUtils.toHalfFloat(ws.dist[i] / maxDist);
  const dist = new THREE.DataTexture(half, Wd, Hd, THREE.RedFormat, THREE.HalfFloatType);
  const a = new Uint8Array(Wl * Hl * 4), b = new Uint8Array(Wl * Hl * 4);
  for (let i = 0; i < Wl * Hl; i++) {
    a.set([L.R[i], L.K[i], L.LS[i], L.C[i]], i * 4);
    b.set([L.P[i], L.A[i], L.risk[i] * 63.75, L.risk[i] ? 255 : 0], i * 4);
  }
  const la = new THREE.DataTexture(a, Wl, Hl), lb = new THREE.DataTexture(b, Wl, Hl);
  for (const t of [dist, la, lb]) {
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
  }
  return { dist, la, lb, distKm: maxDist / 1000 };
}

function buildRoads(osm, ws, size, riskAt) {
  const pos = [], t = [], elev = [], seed = [];
  for (const name of ["road_major", "road_minor"]) {
    for (const flat of osm.lines[name] || []) {
      const pts = [];
      for (let i = 0; i < flat.length; i += 2) pts.push([flat[i] / 1000, flat[i + 1] / 1000]);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
      const total = cum[cum.length - 1] || 1, s = Math.random();
      for (let i = 1; i < pts.length; i++) {
        const steps = Math.max(1, Math.ceil((cum[i] - cum[i - 1]) / ROAD_STEP));
        for (let k = 0; k < steps; k++) {
          const f = k / steps, x = pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, y = pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f;
          if (riskAt(x, y) < HIGH_RISK) continue;
          pos.push((x - 0.5) * size.x, (0.5 - y) * size.y, 0);
          t.push((cum[i - 1] + (cum[i] - cum[i - 1]) * f) / total); seed.push(s); elev.push(ws.elevAt(x, y));
        }
      }
    }
  }
  return geometry({ position: [pos, 3], aT: [t, 1], aElev: [elev, 1], aSeed: [seed, 1] });
}

function buildPlaces(osm, ws, size) {
  const pos = [], risk = [], seed = [], elev = [];
  for (const [u, v, r] of osm.places) {
    pos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0); risk.push(r); seed.push(Math.random()); elev.push(ws.elevAt(u, v));
  }
  return geometry({ position: [pos, 3], aRisk: [risk, 1], aSeed: [seed, 1], aElev: [elev, 1] });
}

export async function createResearch(scene, dpr, stationZ) {
  const loader = new THREE.TextureLoader();
  const [ws, osm, context, relief, normal, mask] = await Promise.all([
    loadWatershed(`${BASE}neugal-dem.bin`), loadJson(`${BASE}osm.json`), loadContext(BASE),
    loadImage(loader, `${BASE}neugal-albedo-v2.jpg`), loadImage(loader, `${BASE}neugal-normal-v2.jpg`),
    loadImage(loader, `${BASE}neugal-mask.png`)]);
  const size = new THREE.Vector2(MAP_H * ws.Wd / ws.Hd, MAP_H);
  const K0 = (MAP_H * R_KM * 1000) / (ws.cellH * ws.Hd); // map units per Earth radius
  const zm = createZoomMap(context, [0, 0, size.x / K0, size.y / K0]);
  const riskAt = (u, v) => ws.layers.risk[Math.min(ws.Hl - 1, (v * ws.Hl) | 0) * ws.Wl + Math.min(ws.Wl - 1, (u * ws.Wl) | 0)];
  const runoff = createRunoff(ws, RUNOFF);
  const lt = layerTextures(ws);

  const shared = { uLift: { value: 0 }, uTime: { value: 0 }, uPixelRatio: { value: dpr }, uSize: { value: size },
    uWin: { value: new THREE.Vector4(-1, -1, 2, 2) }, uFeather: { value: 0.1 } };
  const tu = {
    ...shared, uRelief: { value: relief }, uNormal: { value: normal }, uSun: { value: new THREE.Vector3() },
    uMask: { value: mask }, uDist: { value: lt.dist },
    uLA: { value: lt.la }, uLB: { value: lt.lb }, uWa: { value: new THREE.Vector4() }, uWb: { value: new THREE.Vector4() },
    uShow: { value: 0 }, uOut: { value: 0 }, uRivers: { value: 0 }, uReveal: { value: 0 }, uFlow: { value: 0 },
    uWet: { value: 0 }, uDistKm: { value: lt.distKm },
  };
  const mat = (vertexShader, fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false });

  const terrainMat = mat(terrainVert, terrainFrag, tu);
  terrainMat.depthWrite = true;
  terrainMat.side = THREE.DoubleSide;
  const terrain = new THREE.Mesh(buildTerrain(ws, size), terrainMat);

  const rgeo = new THREE.BufferGeometry();
  const dyn = (arr, n) => new THREE.BufferAttribute(arr, n).setUsage(THREE.DynamicDrawUsage);
  rgeo.setAttribute("position", dyn(runoff.out.pos, 3));
  rgeo.setAttribute("aKind", dyn(runoff.out.kind, 1));
  rgeo.setAttribute("aAlpha", dyn(runoff.out.alpha, 1));
  rgeo.setAttribute("aSettled", dyn(runoff.out.settled, 1));
  const flowPts = new THREE.Points(rgeo, mat(runoffVert, dotFrag, shared));

  const rainPos = [], rainElev = [], rainSeed = [];
  while (rainSeed.length < RAIN) {
    const u = Math.random(), v = Math.random();
    if (!riskAt(u, v)) continue; // outside the watershed
    rainPos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0);
    rainElev.push(ws.elevAt(u, v)); rainSeed.push(Math.random());
  }
  const ru = { ...shared, uRain: { value: 0 } };
  const rain = new THREE.Points(geometry({ position: [rainPos, 3], aElev: [rainElev, 1], aSeed: [rainSeed, 1] }), mat(rainVert, rainFrag, ru));
  const lu = { ...shared, uDraw: { value: 0 }, uAlpha: { value: 0 } };
  const roads = new THREE.Points(buildRoads(osm, ws, size, riskAt), mat(roadVert, dotFrag, lu));
  const pu = { ...shared, uPlaces: { value: 0 } };
  const places = new THREE.Points(buildPlaces(osm, ws, size), mat(placeVert, placeFrag, pu));

  const clearer = depthClearer();
  const drawn = [clearer, ...zm.objects, terrain, flowPts, roads, places, rain];
  drawn.forEach((m, i) => { m.frustumCulled = false; m.renderOrder = 999 + i; });

  // group: fitted to the screen and tilted; zoom: magnification and view centre; map: Earth radii
  const zoom = new THREE.Group();
  zm.root.scale.set(K0, K0, 1);
  zoom.add(zm.root, terrain, flowPts, roads, places, rain);
  const group = new THREE.Group();
  group.add(clearer, zoom);
  scene.add(group);
  // at the end of the zoom, zoom is the identity, so the group's map units are the valley's
  const rig = makeRig(group, size, ws.elevAt, shared);

  // map labels: zoom anchors in Earth radii, terrain labels in data uv
  const S = STAGES;
  const uvAt = (u, v) => [(u - 0.5) * size.x, (0.5 - v) * size.y];
  const pal = osm.labels.find((l) => l.n === "Palampur");
  const outlet = [((ws.outlet % ws.Wd) + 0.5) / ws.Wd, (((ws.outlet / ws.Wd) | 0) + 0.5) / ws.Hd];
  let top = -1; // highest cell inside the watershed
  for (let i = 0; i < ws.Wd * ws.Hd; i++) if (ws.down[i] >= 0 && (top < 0 || ws.elev[i] > ws.elev[top])) top = i;
  const peak = [((top % ws.Wd) + 0.5) / ws.Wd, (((top / ws.Wd) | 0) + 0.5) / ws.Hd];

  // camera moves once the valley is reached: each stage's view comes early in the stage and is held or runs on
  const FLAT = { c: [0.5, 0.5], z: 1, tilt: FACE_TILT, yaw: 0, e: 1 };
  const WHOLE = { ...FLAT, tilt: TILT };
  // a view of point c at zoom z, its focus box kept on the map
  const near = (c, z, tilt, yaw) => ({ c: c.map((x) => Math.min(Math.max(x, 0.5 / z), 1 - 0.5 / z)), z, tilt, yaw, e: 1 });
  const along = (t) => [outlet[0] + (peak[0] - outlet[0]) * t, outlet[1] + (peak[1] - outlet[1]) * t];
  const risky = osm.places.filter((p) => p[2] >= HIGH_RISK);
  const villages = risky.length ? frame(risky, 0.06, 3) : { c: [0.5, 0.5], z: 1 };
  const views = makeViews([
    [0, FLAT], [S[1], FLAT],
    [S[1] + 0.03, near(outlet, 2.2, TILT, -0.1)],                                         // streams grow from the outlet
    [S[1] + 0.08, { ...WHOLE, yaw: 0.02 }], [S[2] - 0.005, { ...WHOLE, yaw: 0.06 }],      // up to every ridge
    [S[2] + 0.035, near(along(0.35), 1.3, -0.9, -0.2)], [S[3] - 0.005, near(along(0.8), 1.7, -0.95, 0.15)], // up to the peaks
    [S[3] + 0.03, near(along(0.5), 1.5, -0.8, 0.1)], [S[4] - 0.005, near(along(0.5), 1.6, -0.8, 0.16)],     // the storm
    [S[4] + 0.03, { ...WHOLE, tilt: -0.6, yaw: 0.06 }], [S[5] - 0.005, { ...WHOLE, tilt: -0.6, yaw: -0.04 }], // flatter to read
    [S[5] + 0.03, { ...WHOLE, tilt: -0.66, yaw: -0.06 }], [S[6] - 0.005, { ...WHOLE, tilt: -0.66, yaw: 0.02 }],
    [S[6] + 0.03, near(villages.c, villages.z, -0.75, -0.06)], [S[7] - 0.005, near(villages.c, villages.z, -0.75, 0.04)],
    [S[7] + 0.035, { ...WHOLE, yaw: 0.04 }], [1, { ...WHOLE, yaw: 0.1 }],
  ]);
  const { anchors } = context.ctx;
  const labels = [
    { name: "India", cls: "big", at: [anchors.india[0] * K0, anchors.india[1] * K0], a: (L) => ramp(L, 0.55, 0.85) * (1 - ramp(L, 1.45, 1.75)) },
    { name: "Himachal Pradesh", cls: "big", at: [anchors.hp[0] * K0, anchors.hp[1] * K0], a: (L) => ramp(L, 1.5, 1.8) * (1 - ramp(L, 2.4, 2.7)) },
    pal && { name: "Palampur", cls: "", uv: [pal.u, pal.v], a: (L, q) => ramp(L, 2.2, 2.5) * (1 - ramp(q, S[3] - 0.02, S[3])) + win(q, S[6], S[7]) },
    { name: "Outlet to the Beas", cls: "", uv: outlet, a: (L, q) => win(q, S[1], S[2]) },
    { name: "Dhauladhar range", cls: "", uv: peak, a: (L, q) => win(q, S[2], S[3]) },
  ].filter(Boolean); // osm.json may lack Palampur after a rebuild
  const screenOf = makeScreenOf();

  const pinStart = stationZ + P.researchView;
  const pinEnd = pinStart - P.researchPin;
  let form = 0, q = 0, L = 0, view = { Z: 1, cx: 0, cy: 0, mag: 1 }, cur = FLAT;
  const sun = tu.uSun.value;

  return {
    pinStart, pinEnd, stats: osm.stats,
    update(dt, camZ, time, camera) {
      q = Math.max(0, Math.min(1, (pinStart - camZ) / P.researchPin));
      const want = camZ <= stationZ + 6.6 && camZ >= pinEnd - 1.0;
      form = Math.max(0, Math.min(1, form + (want ? dt / 1.1 : -dt / 1.4)));
      group.visible = form > 0.001;
      if (!group.visible) { rig.reset(); return q; } // snap to a fresh fit on re-entry

      L = zoomLevel(q);
      cur = views(q);
      const rise = ramp(q, S[1], S[1] + 0.06);
      const lift = LIFT * (0.75 * rise + 0.25 * ramp(q, S[2] - 0.01, S[2] + 0.03));
      shared.uLift.value = lift;

      // refit every frame (scroll speed zooms the camera)
      const clamped = Math.min(Math.max(camZ, pinEnd), pinStart);
      rig.update(cur, camera, clamped - camZ, clamped - P.researchView, lift, dt);
      sunAt(q, time, sun).lerp(ZOOM_SUN, 1 - rise).normalize();

      // zoom: each level fills the whole free screen area, measured in map units
      const box = fitBox();
      const aspect = ((box.x1 - box.x0) * innerWidth) / ((box.y1 - box.y0) * innerHeight);
      view = zoomView(zm.boxes, L, { w: Math.max(size.x, size.y * aspect), h: Math.max(size.y, size.x / aspect) }, K0);
      zoom.scale.set(view.Z, view.Z, 1);
      zoom.position.set(-view.cx * K0 * view.Z, -view.cy * K0 * view.Z, 0);
      zm.update(L, form);

      // one layer at a time
      const F = FACTORS, rainK = win(q, S[3], S[4]), soilK = win(q, S[5], S[6]);
      tu.uShow.value = form * ramp(L, 2.55, 2.95);
      tu.uOut.value = ramp(L, 2.85, 3);
      tu.uRivers.value = win(q, S[1], S[4]) * (1 - 0.5 * win(q, S[2], S[3]) - 0.3 * rainK);
      tu.uReveal.value = ramp(q, S[1], S[1] + 0.07);
      tu.uFlow.value = win(q, S[1], S[4]);
      tu.uWet.value = rainK;
      tu.uWa.value.set(win(q, F[0], F[1]), win(q, F[1], F[2]), win(q, F[2], F[3]), win(q, F[3], F[4]));
      tu.uWb.value.set(win(q, F[4], F[5]), win(q, S[5], S[6]), win(q, S[6], S[7]), win(q, S[7], 2));
      ru.uRain.value = rainK * form;
      lu.uDraw.value = ramp(q, S[6], S[6] + 0.05);
      lu.uAlpha.value = win(q, S[6], S[7]) * form;
      pu.uPlaces.value = win(q, S[6], S[7]) * form;
      shared.uTime.value = time;
      terrain.visible = tu.uShow.value > 0.002;
      rain.visible = ru.uRain.value > 0.002;
      roads.visible = lu.uAlpha.value > 0.002;
      places.visible = pu.uPlaces.value > 0.002;

      // water runs off during the storm, soil during the soil-loss stage
      flowPts.visible = (rainK + soilK) * form > 0.001;
      runoff.update(dt, [rainK * form, soilK * form], { w: size.x, h: size.y, lift });
      for (const key of ["position", "aKind", "aAlpha", "aSettled"]) flowPts.geometry.attributes[key].needsUpdate = true;
      return q;
    },
    // Live magnification against the whole-planet view, for the first stage's counter.
    live() { return view.mag; },
    // Screen overlay in CSS px: labels with opacity, north arrow and scale bar; null when hidden.
    overlay(camera) {
      if (!group.visible) return null;
      group.updateMatrixWorld();
      const out = labels.map((l) => {
        const [x, y] = l.uv ? uvAt(l.uv[0], l.uv[1]) : l.at;
        const z = l.uv ? ws.elevAt(l.uv[0], l.uv[1]) * shared.uLift.value + 0.015 : 0;
        const p = l.uv && !rig.sees(l.uv[0], l.uv[1]) ? null : screenOf(zoom, x, y, z, camera);
        return { name: l.name, cls: l.cls, x: p ? p[0] : 0, y: p ? p[1] : 0, a: p ? form * Math.min(1, l.a(L, q)) : 0 };
      });
      // north: the map's own +y on screen at the centre of the view, foreshortened by the tilt
      const d = 0.1 / cur.z, cx = (cur.c[0] - 0.5) * size.x, cy = (0.5 - cur.c[1]) * size.y, cz = ws.elevAt(cur.c[0], cur.c[1]) * shared.uLift.value;
      const o = screenOf(group, cx, cy, cz, camera), n = screenOf(group, cx, cy + d, cz, camera), e = screenOf(group, cx + d, cy, cz, camera);
      if (!o || !n || !e) return { labels: out, north: null, scale: null };
      const nx = n[0] - o[0], ny = n[1] - o[1], ex = Math.hypot(e[0] - o[0], e[1] - o[1]);
      const box = fitBox(), W = innerWidth, H = innerHeight;
      const north = { x: box.x1 * W - 26, y: box.y0 * H + 26, rot: Math.atan2(nx, -ny),
        sy: Math.max(0.35, Math.min(1, Math.hypot(nx, ny) / ex)), a: form * ramp(L, 0.7, 1) };
      // scale bar: true at the map centre; hidden once the map tilts into perspective
      const pxPerKm = ((ex / d) * K0 * view.Z) / R_KM;
      let km = SCALE_KM[0];
      for (const c of SCALE_KM) if (c * pxPerKm <= SCALE_PX) km = c;
      const scale = { x: box.x0 * W + 6, y: box.y1 * H - 30, w: km * pxPerKm, text: `${km.toLocaleString("en-US")} km`,
        a: form * ramp(L, 0.7, 1) * (1 - ramp(q, S[1], S[1] + 0.02)) };
      return { labels: out, north, scale };
    },
  };
}

// HUD copy: plain numbers anyone can picture, with the technical detail in the text.
// Football field = 105 m x 68 m (0.714 ha). Elephant = about 6 tonnes.
// legend: [class suffix, label] pairs; ramps: low and high ends of each factor's colour ramp.
export const RESEARCH_STAGES = [
  { name: "Where it is", stat: "live", dp: 0, unit: "times closer than the whole planet", sub: [
    "Planet Earth. Somewhere in the Himalayas is one small valley worth a closer look.",
    "India. The valley sits in the far north, where the plains run into the mountains.",
    "Himachal Pradesh: a mountain state of snow peaks, pine forests and terraced farms.",
    "The Neugal watershed beside Palampur. All the rain that falls here drains into one river."] },
  { name: "A valley that feeds a river", stat: 80000, dp: 0, unit: "football fields of land",
    legend: [["river", "Main river"], ["stream", "Stream"], ["edge", "Watershed edge"]],
    text: "The Neugal watershed covers 573.6 km² of Himalayan slopes. Every stream drawn here was traced from the terrain itself, and every drop of rain ends up at one outlet, on its way to the Beas." },
  { name: "How high it climbs", stat: 4749, dp: 0, unit: "metres at the top, almost 6 Burj Khalifas",
    text: "Real elevation from the SRTM satellite mission, drawn 1.5 times taller so the slopes read. The land rises from 562 m in the valley to the snowy Dhauladhar peaks." },
  { name: "How hard it rains", stat: 2.2, dp: 1, unit: "metres of rain a year, taller than a grown-up",
    legend: [["rain", "Rain"], ["water", "Runoff"]],
    text: "Rain runs downhill into the streams. Each drop moves at the speed Manning's equation gives for a 20 mm an hour storm on that slope; one second here is 30 minutes." },
  { name: "Five ingredients", stat: 5, dp: 0, unit: "things decide how much soil washes away", eq: true, sub: [
    "Rain power: heavier, harder rain knocks more soil loose.",
    "Soil type: some soils crumble more easily than others.",
    "Slope: steeper, longer slopes let water race downhill and carry more soil.",
    "Plant cover: forests hold soil in place, bare fields do not. Mapped from Sentinel-2 images, 98% accurate.",
    "Farming: terraces and contour ploughing slow the water down."],
    ramps: [["Gentle rain", "Strong rain"], ["Sturdy soil", "Crumbly soil"], ["Gentle slope", "Steep slope"],
      ["Dense forest", "Bare ground"], ["Protected", "Unprotected"]] },
  { name: "How much soil is lost", stat: 125, dp: 0, unit: "elephants of soil, from one football field, every year", eq: true,
    legend: [["low", "Low"], ["mod", "Moderate"], ["high", "High"], ["crit", "Critical"], ["soil", "Moving soil"]],
    text: "Soil leaves the steepest, barest slopes, rides the streams and settles where the land flattens. On average 1,047.66 tonnes per hectare wash away each year; the riskiest ground is ranked low to critical." },
  { name: "Who lives here", stat: 82, dp: 0, unit: "villages sit on or beside high-risk ground",
    legend: [["village", "Village"], ["atrisk", "Village at risk"], ["road", "Road at risk"]],
    text: "OpenStreetMap shows 417 villages and hamlets, 876 km of roads and 360 km of streams in this valley. 201 km of road crosses high-risk ground." },
  { name: "Why it matters", stat: 2500, dp: 0, unit: "football fields of critical land to protect first",
    legend: [["crit", "Critical land"]],
    text: "Soil takes hundreds of years to form and one storm to lose. Washed-away soil clogs rivers and small hydro dams, worsens floods and leaves farms poorer. This map shows planners exactly where to start, and the method works for any valley." },
];
export const EQ_TERMS = ["R", "K", "LS", "C", "P"];
