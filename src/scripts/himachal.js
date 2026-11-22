// Himachal stop: the state in 3D from Sentinel-2 imagery on Copernicus terrain, relit by a moving sun,
// then four remote sensing studies one at a time, each with its own camera move: forest lost 2001-2025
// (Hansen GFC), the snow year and its 26-year trend in three basins (MODIS), the Beas flood of August 2023
// (Sentinel-1) and landslide susceptibility in Kullu, Mandi and Chamba (random forest on a Sentinel-2
// scar inventory). Data in public/himachal/, built by himachal-remote-sensing/pipeline/export_web.py,
// whose docstring describes every file; positions in hp-meta are u, v in 0..10000, v = 0 at the north.
import * as THREE from "three";
import { P } from "./config.js";
import { fitBox, ramp, win, geometry, loadJson, loadImage, loadDem, buildWalls, wallVert, wallFrag, depthClearer,
  makeScreenOf, makeViews, makeRig, RELIGHT, WINDOW, MAP_UV, sunDir, sunAt } from "./stop-kit.js";

const BASE = "/himachal/";
const V = "v2";
const SMALL = matchMedia("(max-width: 768px)").matches;
const MAP_H = 1.9;          // north-south size in world units before fitting to the screen
const EXAG = 2.6;           // relief drawn this many times taller than true scale in the state view
const DEPTH = 0.03;         // the block's sides reach this far below sea level
const SHADE_EXAG = 1.8;     // normal-map slopes steepened this much for the lighting
const COL_H = 0.2;          // column height of the district that lost the most forest
const COL_W = 0.009;
const SCALE_KM = [5, 10, 20, 25, 50, 100];
const SCALE_PX = 110;       // longest scale bar in CSS px
const DOT_REF_PX = 640;     // view width on screen (CSS px, a 1440 px window) at which the loss and scar dots are full size
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
  "November", "December"];
const SNOW_MONTHS_PER_S = 1.3;

// Stage boundaries over the stop's progress q (0..1), and the steps inside stages 4, 5 and 7.
const STAGES = [0, 0.11, 0.23, 0.35, 0.47, 0.59, 0.71, 0.83, 1];
const LAST = STAGES.length - 2;
const SUBS = { 4: [0.47, 0.52], 5: [0.59, 0.625, 0.665], 7: [0.83, 0.88, 0.94] };
const during = (q, k) => win(q, STAGES[k], k === LAST ? 2 : STAGES[k + 1]);
export function himachalStageOf(q) {
  for (let i = LAST; i >= 0; i--) if (q >= STAGES[i]) return i;
  return 0;
}
export function himachalSubOf(q) {
  const s = SUBS[himachalStageOf(q)];
  if (!s) return -1;
  for (let i = s.length - 1; i > 0; i--) if (q >= s[i]) return i;
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

// Satellite colour relit by the moving sun, with one study at a time on top.
const terrainFrag = /* glsl */ `
uniform sampler2D uAlbedo, uNormal, uForest, uSnow1, uSnow2, uSnow3, uSnow4, uTrend, uFlood, uFloodMask, uSlide;
uniform vec2 uIdSize, uTrendSize;
uniform vec4 uFloodBox, uSlideBox;
uniform vec3 uSun0, uSun;
uniform float uShow, uRelight, uOut, uBorders, uDim, uTime;
uniform float uForestK, uSnowK, uMonth, uTrendK, uBasinK, uFocusBasin, uGlacierK;
uniform float uFloodK, uPhase, uSlideK, uSlideT;
varying vec2 vD;
const vec3 ACCENT = vec3(0.56, 0.83, 1.0), LUMA = vec3(0.299, 0.587, 0.114);
const vec3 FOREST = vec3(0.25, 0.62, 0.36), GLACIER = vec3(0.78, 0.93, 1.0);
const vec3 LESS = vec3(1.0, 0.45, 0.28), MORE = vec3(0.35, 0.62, 1.0);
const vec3 FLOOD = vec3(0.36, 0.78, 1.0), RIVER = vec3(0.10, 0.25, 0.48);
const float ID = 20.0 / 255.0;
${RELIGHT}
${WINDOW}

// categorical values: the texel under p, never blended with its neighbours
vec4 nearest(sampler2D t, vec2 size, vec2 p) { return textureLod(t, (floor(p * size) + 0.5) / size, 0.0); }
float districtAt(vec2 p) { return floor(nearest(uForest, uIdSize, p).g / ID + 0.5); }
float basinAt(vec2 p) { return floor(nearest(uTrend, uTrendSize, p).b * 255.0 / 80.0 + 0.5); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float edgeOf(float a, float b, float c) { return max(step(0.5, abs(a - b)), step(0.5, abs(a - c))); }

float snowAt(vec2 p, float m) {
  vec3 a = texture2D(uSnow1, p).rgb, b = texture2D(uSnow2, p).rgb, c = texture2D(uSnow3, p).rgb, d = texture2D(uSnow4, p).rgb;
  float s[12] = float[12](a.r, a.g, a.b, b.r, b.g, b.b, c.r, c.g, c.b, d.r, d.g, d.b);
  int i = int(floor(m)) % 12;
  return mix(s[i], s[(i + 1) % 12], fract(m));
}
vec3 slideColor(float c) { // classes 1..5: very low to very high
  vec3 a = vec3(0.16, 0.42, 0.33), b = vec3(0.55, 0.74, 0.38), d = vec3(0.98, 0.84, 0.42), e = vec3(0.98, 0.52, 0.30), f = vec3(0.90, 0.20, 0.22);
  return c < 2.0 ? mix(a, b, c - 1.0) : c < 3.0 ? mix(b, d, c - 2.0) : c < 4.0 ? mix(d, e, c - 3.0) : mix(e, f, c - 4.0);
}
// position inside an inset box (0..1), and a soft mask that fades in from its edges
vec2 inBox(vec4 box) { return (vD - box.xy) / (box.zw - box.xy); }
float boxMask(vec2 p, float f) {
  vec2 e = smoothstep(vec2(0.0), vec2(f), p) * smoothstep(vec2(0.0), vec2(f), 1.0 - p);
  return e.x * e.y;
}

void main() {
  float alpha = uShow * windowAt(vD);
  if (alpha < 0.003) discard;
  vec3 nm = texture2D(uNormal, vD).rgb;
  vec3 n = unpackNormal(nm.rg, ${SHADE_EXAG.toFixed(2)});
  vec3 col = relight(texture2D(uAlbedo, vD).rgb, n, nm.b, uSun0, uSun, uRelight);
  float shade = (0.5 + 0.65 * max(dot(n, uSun), 0.0)) * (0.7 + 0.3 * nm.b); // light on the layers drawn on top
  vec4 fo = texture2D(uForest, vD);
  float inside = smoothstep(0.25 * ID, 0.75 * ID, fo.g);
  float lum = dot(col, LUMA);

  // a quieter base under the studies
  col = mix(col, vec3(lum), 0.45 * uDim) * (1.0 - 0.3 * uDim);

  if (uForestK > 0.001) col = mix(col, FOREST * shade, smoothstep(0.25, 0.45, fo.r) * inside * 0.5 * uForestK);

  if (uSnowK > 0.001) {
    float sn = snowAt(vD, uMonth);
    vec3 snow = mix(vec3(0.66, 0.80, 0.98), vec3(0.96, 0.98, 1.0), smoothstep(0.4, 1.0, sn)) * (0.72 + 0.35 * shade);
    col = mix(col, snow, smoothstep(0.06, 0.55, sn) * 0.9 * uSnowK);
  }

  if (uTrendK + uBasinK + uGlacierK > 0.001) {
    vec4 tr = texture2D(uTrend, vD);
    float days = (tr.r * 255.0 - 128.0) / 4.0;             // snow-cover days gained or lost per decade
    float sig = 1.0 - smoothstep(0.04, 0.06, tr.g);         // p < 0.05
    vec3 tc = days < 0.0 ? LESS : MORE;
    col = mix(col, tc * (0.55 + 0.6 * shade), clamp(abs(days) / 8.0, 0.0, 1.0) * mix(0.2, 0.85, sig) * uTrendK);
    col = mix(col, GLACIER * (0.65 + 0.45 * shade), smoothstep(0.3, 0.7, fo.b) * 0.6 * uGlacierK);
    vec2 px = fwidth(vD);
    float b = basinAt(vD), bx = basinAt(vD + vec2(px.x, 0.0)), by = basinAt(vD + vec2(0.0, px.y));
    float focus = uFocusBasin > 0.5 ? step(abs(b - uFocusBasin), 0.5) : step(0.5, b);
    col *= 1.0 - 0.35 * uBasinK * (1.0 - focus);           // the basins in view stand out
    col = mix(col, ACCENT, edgeOf(b, bx, by) * uBasinK * mix(0.35, 1.0, max(focus, step(abs(bx - uFocusBasin), 0.5))));
  }

  if (uFloodK > 0.001) {
    vec2 p = inBox(uFloodBox);
    float k = boxMask(p, 0.03) * uFloodK;
    if (k > 0.001) {
      vec3 vv = texture2D(uFlood, p).rgb;                    // radar: 10 Aug, 22 Aug, 3 Sep
      float radar = uPhase < 1.0 ? mix(vv.r, vv.g, uPhase) : mix(vv.g, vv.b, uPhase - 1.0);
      float r = smoothstep(0.5, 0.95, radar);                // land sits in a narrow band of the radar's range
      // dark grey, so the flood shows, with a wide fade so the inset has no hard edge
      col = mix(col, mix(vec3(0.02, 0.03, 0.04), vec3(0.40, 0.43, 0.48), r), boxMask(p, 0.12) * uFloodK * 0.88);
      vec3 fm = texture2D(uFloodMask, p).rgb;                // flood 22 Aug, still wet 3 Sep, normal water
      col = mix(col, RIVER, smoothstep(0.3, 0.7, fm.b) * k * 0.85);
      // the water spreads in, then drains back to what was still wet on 3 September
      float grow = smoothstep(0.0, 0.25, uPhase * 1.2 - hash(floor(p * 220.0)) * 0.9);
      float wet = uPhase < 1.0 ? fm.r * grow : mix(fm.r, fm.g, uPhase - 1.0);
      float shimmer = 0.88 + 0.12 * sin(uTime * 2.2 + (p.x + p.y) * 90.0);
      col = mix(col, FLOOD * shimmer, smoothstep(0.02, 0.3, wet) * k); // by cover: the strips are thinner than a pixel at this zoom
    }
  }

  if (uSlideK > 0.001) {
    vec2 p = inBox(uSlideBox);
    float k = boxMask(p, 0.03) * uSlideK;
    if (k > 0.001) {
      vec3 sl = texture2D(uSlide, p).rgb;
      float c = sl.r * 255.0 / 50.0;                         // class 1..5, blended at the class edges
      float show = smoothstep(0.0, 0.6, uSlideT * 5.6 - (5.0 - c)); // the highest classes first
      col = mix(col, slideColor(clamp(c, 1.0, 5.0)) * (0.6 + 0.55 * shade), smoothstep(0.3, 0.7, sl.b) * show * 0.82 * k);
    }
  }

  // outside the state: darker and greyer; the state's edge and the district borders on top
  float o = (1.0 - inside) * uOut;
  col = mix(col, vec3(lum), 0.6 * o) * (1.0 - 0.5 * o);
  vec2 px = fwidth(vD);
  float id = districtAt(vD), ix = districtAt(vD + vec2(px.x, 0.0)), iy = districtAt(vD + vec2(0.0, px.y));
  float inR = step(0.5, id), inX = step(0.5, ix), inY = step(0.5, iy);
  float rim = max(abs(inR - inX), abs(inR - inY));
  float border = inR * inX * inY * edgeOf(id, ix, iy);
  col = mix(col, ACCENT, rim * uBorders * 0.85);
  col = mix(col, vec3(0.92, 0.95, 1.0), border * uBorders * 0.4);
  gl_FragColor = vec4(col, alpha);
}`;

// Lines on the terrain (rivers, flooded roads): drawn on along aT, faded by the window.
const lineVert = /* glsl */ `
attribute float aElev, aT;
uniform float uLift, uDraw, uLines, uTime, uPulse;
uniform vec3 uColor;
varying vec3 vC;
varying float vA;
varying vec2 vUv;
${MAP_UV}
void main() {
  vUv = mapUv(position.xy);
  float pulse = 1.0 + uPulse * smoothstep(0.85, 1.0, sin(aT * 60.0 - uTime * 2.4));
  vC = uColor * pulse;
  vA = min(1.0, uLines * smoothstep(0.0, 0.04, uDraw * 1.08 - aT));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, aElev * uLift + 0.002, 1.0);
}`;
const lineFrag = /* glsl */ `
${WINDOW}
varying vec3 vC;
varying float vA;
varying vec2 vUv;
void main() { gl_FragColor = vec4(vC, vA * windowAt(vUv)); }`;

// Points on the terrain: forest loss by year, landslide scars, flooded places.
// aKind 0: loss (aT = year 1..25, aS = size); 1: 2023 scar; 2: 2025 scar; 3: place near the flood.
const pointVert = /* glsl */ `
attribute float aElev, aT, aS, aKind, aSeed;
uniform float uLift, uPixelRatio, uTime, uYear, uLossK, uScarA, uScarB, uPlaces, uZoom, uDot;
varying vec3 vC;
varying float vA, vRing;
varying vec2 vUv;
${MAP_UV}
void main() {
  vUv = mapUv(position.xy);
  float size = 3.0;
  vRing = 0.0;
  if (aKind < 0.5) {
    float age = uYear - aT;                                // years since this cell lost its trees
    float on = smoothstep(-0.6, 0.0, age);
    float fresh = 1.0 - smoothstep(0.0, 3.0, age);
    vC = mix(vec3(0.78, 0.30, 0.16), vec3(1.0, 0.86, 0.55), fresh);
    vA = uLossK * on * mix(0.6, 1.0, fresh);
    size = (1.6 + aS * 2.6) * (1.0 + 0.9 * fresh * (1.0 - smoothstep(0.0, 0.6, age))) * mix(1.0, 1.6, smoothstep(1.0, 3.0, uZoom));
  } else if (aKind < 2.5) {
    bool first = aKind < 1.5;
    float k = first ? uScarA : uScarB;
    float pop = smoothstep(0.0, 0.12, k * 1.15 - aSeed * 0.15);
    vC = first ? vec3(1.0, 0.42, 0.34) : vec3(1.0, 0.82, 0.40);
    vA = pop;
    vRing = first ? 0.0 : 0.6 + 0.4 * sin(uTime * 2.6 + aSeed * 20.0);
    size = (first ? 3.0 + aS * 2.2 : 4.0 + aS * 2.5) * (1.0 + 0.6 * (1.0 - smoothstep(0.0, 0.5, pop)));
  } else {
    vC = vec3(1.0, 0.42, 0.34);
    vA = uPlaces * smoothstep(0.0, 0.1, uPlaces * 1.2 - aSeed * 0.2);
    vRing = 0.55 + 0.45 * sin(uTime * 2.4 + aSeed * 12.0);
    size = 7.0 + aS * 6.0;
  }
  if (aKind < 2.5) size *= uDot;                         // the dense layers cover the same share of a smaller map
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, aElev * uLift + 0.004, 1.0);
  gl_PointSize = size * uPixelRatio;
}`;
const pointFrag = /* glsl */ `
${WINDOW}
varying vec3 vC;
varying float vA, vRing;
varying vec2 vUv;
void main() {
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  float core = 1.0 - smoothstep(0.24, 0.34, d);
  float ring = (1.0 - smoothstep(0.03, 0.08, abs(d - 0.4))) * vRing;
  float a = vRing > 0.0 ? max(core * 0.9, ring) : 1.0 - smoothstep(0.3, 0.5, d);
  gl_FragColor = vec4(vC, a * vA * windowAt(vUv));
}`;

// Instanced columns standing on the terrain: forest lost per district, rising in turn.
const columnVert = /* glsl */ `
attribute vec3 aAt;
attribute float aH, aT;
uniform float uLift, uWidth, uRise;
varying float vL, vTop, vA;
void main() {
  float grow = smoothstep(0.0, 0.35, uRise * 1.4 - aT * 0.4);
  vec3 p = vec3(aAt.xy + position.xy * uWidth, aAt.z * uLift + position.z * aH * grow);
  vL = 0.55 + 0.45 * max(dot(normal, normalize(vec3(-0.5, 0.6, 0.6))), 0.0);
  vTop = position.z;
  vA = step(0.001, grow);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;
const columnFrag = /* glsl */ `
uniform float uK;
varying float vL, vTop, vA;
void main() { gl_FragColor = vec4(mix(vec3(0.85, 0.32, 0.20), vec3(1.0, 0.72, 0.42), vTop) * vL, uK * vA); }`;

async function loadLoss(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return new Uint16Array(await res.arrayBuffer());
}

// One instanced cylinder per item [u, v, height, delay 0..1].
function buildColumns(items, at, size) {
  const base = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
  base.rotateX(Math.PI / 2).translate(0, 0, 0.5); // axis along +z, from 0 to 1
  const g = new THREE.InstancedBufferGeometry();
  g.index = base.index;
  g.setAttribute("position", base.attributes.position);
  g.setAttribute("normal", base.attributes.normal);
  const attr = (data, n) => new THREE.InstancedBufferAttribute(new Float32Array(data), n);
  g.setAttribute("aAt", attr(items.flatMap(([u, v]) => [(u - 0.5) * size.x, (0.5 - v) * size.y, at(u, v)]), 3));
  g.setAttribute("aH", attr(items.map((i) => i[2]), 1));
  g.setAttribute("aT", attr(items.map((i) => i[3]), 1));
  g.instanceCount = items.length;
  return g;
}

// Line segments [[label, flat u, v x 1e4], ...] with their position along the draw-on (0..1).
function buildLines(lines, at, size, order) {
  const pos = [], elev = [], t = [];
  for (const [, flat] of lines) {
    for (let i = 0; i + 3 < flat.length; i += 2) {
      for (const j of [i, i + 2]) {
        const u = flat[j] / 1e4, v = flat[j + 1] / 1e4;
        pos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0);
        elev.push(at(u, v)); t.push(order(u, v));
      }
    }
  }
  return geometry({ position: [pos, 3], aElev: [elev, 1], aT: [t, 1] });
}

// All points in one buffer: [u, v, t, size, kind] in 0..1 map uv.
function buildPoints(items, at, size) {
  const pos = [], elev = [], t = [], s = [], kind = [], seed = [];
  for (const [u, v, a, b, k] of items) {
    pos.push((u - 0.5) * size.x, (0.5 - v) * size.y, 0);
    elev.push(at(u, v)); t.push(a); s.push(b); kind.push(k); seed.push(Math.random());
  }
  return geometry({ position: [pos, 3], aElev: [elev, 1], aT: [t, 1], aS: [s, 1], aKind: [kind, 1], aSeed: [seed, 1] });
}

export async function createHimachal(scene, dpr, stationZ) {
  const loader = new THREE.TextureLoader();
  const meta = await loadJson(`${BASE}hp-meta-${V}.json`);
  const k2 = SMALL ? "-2k" : "";
  const sm = SMALL ? "-sm" : ""; // phones: the data layers at half size
  const png = (n) => loadImage(loader, `${BASE}hp-${n}${sm}-${V}.png`);
  const [dem, loss, albedo, normal, forest, snow1, snow2, snow3, snow4, trend, flood, floodMask, slide] = await Promise.all([
    loadDem(`${BASE}hp-dem-${V}.bin`, meta.dem.w, meta.dem.h, meta.dem.max, SMALL ? 2 : 1),
    loadLoss(`${BASE}hp-loss-${V}.bin`),
    loadImage(loader, `${BASE}hp-albedo${k2}-${V}.jpg`), loadImage(loader, `${BASE}hp-normal${k2}-${V}.jpg`),
    png("forest"), png("snow1"), png("snow2"), png("snow3"), png("snow4"), png("trend"),
    loadImage(loader, `${BASE}hp-flood${sm}-${V}.jpg`), png("floodmask"), png("slide")]);
  for (const t of [forest, trend]) t.anisotropy = 1; // read texel by texel for the borders
  const size = new THREE.Vector2((MAP_H * meta.km[0]) / meta.km[1], MAP_H);
  const kmPerUnit = meta.km[1] / MAP_H;
  const trueLift = meta.dem.max / 1000 / kmPerUnit; // the highest peak at true scale, in map units
  const ll = (lon, lat) => [(lon - meta.box[0]) / (meta.box[2] - meta.box[0]), (meta.box[3] - lat) / (meta.box[3] - meta.box[1])];
  const uvOf = (p) => [p[0] / 1e4, p[1] / 1e4];

  const shared = { uLift: { value: 0 }, uTime: { value: 0 }, uPixelRatio: { value: dpr }, uSize: { value: size },
    uWin: { value: new THREE.Vector4(-1, -1, 2, 2) }, uFeather: { value: 0.1 } };
  const mat = (vertexShader, fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, ...extra });

  const box = (b) => new THREE.Vector4(...b);
  const tu = {
    ...shared, uAlbedo: { value: albedo }, uNormal: { value: normal }, uForest: { value: forest }, uSnow1: { value: snow1 },
    uSnow2: { value: snow2 }, uSnow3: { value: snow3 }, uSnow4: { value: snow4 }, uTrend: { value: trend }, uFlood: { value: flood },
    uFloodMask: { value: floodMask }, uSlide: { value: slide },
    uIdSize: { value: new THREE.Vector2(forest.image.width, forest.image.height) },
    uTrendSize: { value: new THREE.Vector2(trend.image.width, trend.image.height) },
    uFloodBox: { value: box(meta.flood.box) }, uSlideBox: { value: box(meta.slide.box) },
    uSun0: { value: sunDir(meta.sun[0], meta.sun[1]) }, uSun: { value: new THREE.Vector3() },
    uShow: { value: 0 }, uRelight: { value: 1 }, uOut: { value: 0 }, uBorders: { value: 0 }, uDim: { value: 0 },
    uForestK: { value: 0 }, uSnowK: { value: 0 }, uMonth: { value: 0 }, uTrendK: { value: 0 }, uBasinK: { value: 0 },
    uFocusBasin: { value: 0 }, uGlacierK: { value: 0 }, uFloodK: { value: 0 }, uPhase: { value: 0 },
    uSlideK: { value: 0 }, uSlideT: { value: 0 },
  };
  const terrain = new THREE.Mesh(
    new THREE.PlaneGeometry(size.x, size.y, dem.w - 1, dem.h - 1).setAttribute("aElev", new THREE.BufferAttribute(dem.norm, 1)),
    mat(terrainVert, terrainFrag, tu, { depthWrite: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
  const wu = { ...shared, uShow: { value: 0 }, uDepth: { value: DEPTH } };
  const walls = new THREE.Mesh(buildWalls(dem.norm, dem.w, dem.h, size), mat(wallVert, wallFrag, wu, { depthWrite: true, side: THREE.DoubleSide }));

  // rivers flow down from their sources: draw-on runs from high ground to low
  const ru = { ...shared, uDraw: { value: 0 }, uLines: { value: 0 }, uPulse: { value: 0.8 }, uColor: { value: new THREE.Vector3(0.45, 0.75, 1.0) } };
  const rivers = new THREE.LineSegments(buildLines(meta.rivers, dem.at, size, (u, v) => 1 - dem.at(u, v)), mat(lineVert, lineFrag, ru));
  const fc = ll(75.95, 32.03);
  const roadOrder = (u, v) => Math.min(1, Math.hypot(u - fc[0], v - fc[1]) * 14);
  const du = { ...shared, uDraw: { value: 0 }, uLines: { value: 0 }, uPulse: { value: 0 }, uColor: { value: new THREE.Vector3(1.0, 0.45, 0.36) } };
  const roads = new THREE.LineSegments(buildLines(meta.flood.roads, dem.at, size, roadOrder), mat(lineVert, lineFrag, du));

  // points: forest loss cells, landslide scars, places by the flood
  const items = [];
  const maxArea = loss.reduce((m, _, i) => (i % 4 === 3 ? Math.max(m, loss[i]) : m), 1);
  for (let i = 0; i < loss.length; i += 4) items.push([loss[i] / 65535, loss[i + 1] / 65535, loss[i + 2], Math.sqrt(loss[i + 3] / maxArea), 0]);
  const maxHa = Math.max(1, ...meta.slide.scars.map((s) => s[2]));
  for (const [u, v, ha, y] of meta.slide.scars) items.push([u / 1e4, v / 1e4, 0, Math.sqrt(ha / maxHa), y === 2023 ? 1 : 2]);
  const places = meta.flood.places.slice(0, 40);
  for (const [, u, v, pct] of places) items.push([u / 1e4, v / 1e4, 0, pct / 100, 3]);
  const pu = { ...shared, uYear: { value: 0 }, uLossK: { value: 0 }, uScarA: { value: 0 }, uScarB: { value: 0 }, uPlaces: { value: 0 }, uZoom: { value: 1 }, uDot: { value: 1 } };
  const points = new THREE.Points(buildPoints(items, dem.at, size), mat(pointVert, pointFrag, pu));

  // forest lost per district, as columns
  const dl = meta.forest.districts.filter((d) => d[1] > 0.05);
  const maxLoss = Math.max(...dl.map((d) => d[1]));
  const colH = (km2) => COL_H * Math.sqrt(km2 / maxLoss);
  const order = [...dl].sort((a, b) => b[1] - a[1]).map((d) => d[0]);
  const cu = { ...shared, uWidth: { value: COL_W }, uRise: { value: 0 }, uK: { value: 0 } };
  const columns = new THREE.Mesh(buildColumns(dl.map(([name, km2, , u, v]) => [u / 1e4, v / 1e4, colH(km2), order.indexOf(name) / dl.length]), dem.at, size),
    mat(columnVert, columnFrag, cu, { depthWrite: true }));
  // a column's height so far, as columnVert grows it
  const grown = (name) => ramp(cu.uRise.value * 1.4 - (order.indexOf(name) / dl.length) * 0.4, 0, 0.35);

  const clearer = depthClearer();
  const drawn = [clearer, walls, terrain, rivers, roads, columns, points];
  // after the energy stop's objects (2000 and up), so the stops never interleave while they fade
  drawn.forEach((m, i) => { m.frustumCulled = false; m.renderOrder = 3000 + i; });
  const group = new THREE.Group();
  group.add(...drawn);
  const rig = makeRig(group, size, dem.at, shared);

  // camera moves, stage by stage
  const S = STAGES;
  const view = (lon, lat, z, tilt, yaw, e = 1) => ({ c: ll(lon, lat), z, tilt, yaw, e });
  const STATE = { c: [0.5, 0.5], z: 1, tilt: -0.82, yaw: 0, e: 1 };
  const views = makeViews([
    [0, { ...STATE, tilt: -0.2 }], [0.06, STATE], [0.1, { ...STATE, yaw: 0.06 }],
    [0.14, view(76.75, 31.55, 1.45, -0.72, -0.1, 0.9)], [0.22, view(76.8, 31.55, 1.5, -0.74, -0.02, 0.9)],
    [0.26, view(77.0, 31.75, 1.15, -0.98, 0.26, 0.85)], [0.34, view(77.0, 31.75, 1.15, -0.98, 0.4, 0.85)],
    [0.38, view(77.55, 32.2, 1.3, -0.92, -0.2)], [0.46, view(77.55, 32.2, 1.3, -0.92, -0.08)],
    [0.49, view(77.4, 32.05, 1.25, -0.85, 0)], [0.515, view(77.4, 32.05, 1.25, -0.85, 0.04)],
    [0.55, view(77.45, 31.98, 3.4, -0.8, 0.35, 0.7)], [0.585, view(77.45, 31.98, 3.5, -0.8, 0.45, 0.7)],
    [0.62, view(75.95, 32.03, 4.0, -0.5, -0.05, 0.6)], [0.705, view(75.95, 32.03, 4.1, -0.52, 0.05, 0.6)],
    [0.74, view(75.8, 32.07, 7.0, -0.62, 0.1, 0.6)], [0.82, view(75.8, 32.07, 7.2, -0.62, 0.2, 0.6)],
    [0.86, view(77.1, 31.95, 2.6, -0.85, 0.3, 0.75)], [0.93, view(77.1, 31.95, 2.7, -0.85, 0.36, 0.75)],
    [0.965, view(77.15, 31.85, 3.4, -0.9, 0.45, 0.7)], [1, view(77.15, 31.85, 3.5, -0.9, 0.5, 0.7)],
  ]);

  // Labels, highest priority first: a label that would overlap one already placed is skipped.
  const labels = [];
  const add = (name, cls, [u, v], a, h = () => 0) => labels.push({ name, cls, u, v, a, h });
  const forestYears = meta.forest.years;
  const lostBy = forestYears.reduce((acc, x) => [...acc, acc[acc.length - 1] + x], [0]); // lostBy[k]: the first k years
  let year = 1, month = 0, cur = STATE;
  // the year and month counters sit in the top-left corner of the view
  const corner = () => [cur.c[0] - 0.42 / cur.z, cur.c[1] - 0.4 / cur.z];
  labels.push({ name: "", cls: "big", corner: true, a: (q) => during(q, 1), text: () => String(2000 + Math.round(year)) });
  labels.push({ name: "", cls: "big", corner: true, a: (q) => during(q, 3), text: () => MONTHS[Math.floor(month) % 12] });
  dl.forEach(([name, km2, , u, v]) => add(`${name} · ${km2.toFixed(1)} km²`, "", uvOf([u, v]), (q) => during(q, 2), () => colH(km2) * grown(name)));
  for (const [name, cu0, cv0, , , id] of meta.snow.basins) add(name, "big state", uvOf([cu0, cv0]), (q) => (id === 2 ? during(q, 4) : win(q, S[4], SUBS[4][1])));
  [["Pong Dam lake", 76.05, 32.0], ["Beas", 75.72, 31.95]].forEach(([n, lon, lat]) => add(n, "", ll(lon, lat), (q) => during(q, 5)));
  places.slice(0, 8).forEach(([n, u, v]) => add(n, "", uvOf([u, v]), (q) => during(q, 6)));
  [["Kullu", 77.11, 31.96], ["Mandi", 76.93, 31.71], ["Manali", 77.19, 32.24], ["Chamba", 76.13, 32.56]].forEach(([n, lon, lat]) =>
    add(n, "", ll(lon, lat), (q) => during(q, 7)));
  for (const [name, u, v] of meta.towns) add(name, "", uvOf([u, v]), (q) => during(q, 0) * ramp(q, 0.04, 0.07));
  for (const [name, u, v] of meta.districts) add(name, "state", uvOf([u, v]), (q) => during(q, 0) * (1 - ramp(q, 0.03, 0.06)));
  add("Himachal Pradesh", "big", [0.5, 0.42], (q) => 1 - ramp(q, 0.02, 0.05));
  const screenOf = makeScreenOf();

  const pinStart = stationZ + P.researchView;
  const pinEnd = pinStart - P.researchPin;
  let form = 0, q = 0, live = 0;
  const sun = tu.uSun.value;
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
      const lift = EXAG * trueLift * cur.e * ramp(q, 0.0, 0.06);
      shared.uLift.value = lift;
      shared.uTime.value = time;
      // refit every frame (scroll speed zooms the camera)
      const clamped = Math.min(Math.max(camZ, pinEnd), pinStart);
      rig.update(cur, camera, clamped - camZ, clamped - P.researchView, lift, dt);
      sunAt(q, time, sun);

      const sub = himachalSubOf(q), st = himachalStageOf(q);
      year = 1 + 24 * ramp(q, S[1] + 0.012, S[2] - 0.02);
      month = (time * SNOW_MONTHS_PER_S) % 12;
      const y0 = Math.floor(year), fy = year - y0;
      live = lostBy[Math.min(y0, forestYears.length)] + (forestYears[y0] || 0) * fy;

      tu.uShow.value = form;
      wu.uShow.value = form * (1 - ramp(cur.z, 1.01, 1.1));
      tu.uOut.value = ramp(q, 0, 0.05) * (1 - 0.6 * (during(q, 5) + during(q, 6))); // the flood runs on into Punjab
      tu.uBorders.value = ramp(q, 0.01, 0.06) * (1 - 0.75 * ramp(q, S[1] - 0.01, S[1] + 0.01)) + 0.6 * during(q, 2);
      tu.uDim.value = ramp(q, S[1] - 0.01, S[1] + 0.02) * (1 - 0.5 * during(q, 5) - 0.5 * during(q, 6));
      tu.uForestK.value = during(q, 1) + 0.5 * during(q, 2);
      tu.uSnowK.value = during(q, 3);
      tu.uMonth.value = month;
      tu.uTrendK.value = during(q, 4) * ramp(q, SUBS[4][1] - 0.01, SUBS[4][1] + 0.02);
      tu.uBasinK.value = during(q, 4);
      tu.uGlacierK.value = during(q, 4);
      tu.uFocusBasin.value = st === 4 && sub === 1 ? 2 : 0; // the Parbati
      tu.uFloodK.value = during(q, 5) + during(q, 6);
      // 10 August (0), 22 August (1), 3 September (2), then back to the 22 August peak for the next stage
      tu.uPhase.value = ramp(q, SUBS[5][1] - 0.012, SUBS[5][1] + 0.025) + ramp(q, SUBS[5][2], SUBS[5][2] + 0.03) - ramp(q, S[6], S[6] + 0.03);
      tu.uSlideK.value = during(q, 7) * ramp(q, SUBS[7][1] - 0.01, SUBS[7][1] + 0.01);
      tu.uSlideT.value = ramp(q, SUBS[7][1], SUBS[7][1] + 0.045);

      ru.uDraw.value = ramp(q, 0.02, 0.09);
      ru.uLines.value = (during(q, 0) + 0.7 * during(q, 4) + 0.5 * during(q, 7)) * form * 0.8;
      du.uDraw.value = ramp(q, S[6], S[6] + 0.05);
      du.uLines.value = during(q, 6) * form;
      pu.uYear.value = year;
      pu.uLossK.value = (during(q, 1) + 0.35 * during(q, 2)) * form;
      pu.uScarA.value = during(q, 7) * ramp(q, S[7], S[7] + 0.035) * (1 - 0.8 * ramp(q, SUBS[7][1], SUBS[7][1] + 0.02)) * form;
      pu.uScarB.value = during(q, 7) * ramp(q, SUBS[7][2], SUBS[7][2] + 0.035) * form;
      pu.uPlaces.value = during(q, 6) * ramp(q, S[6] + 0.02, S[6] + 0.05) * form;
      pu.uZoom.value = cur.z;
      cu.uRise.value = ramp(q, S[2], S[2] + 0.06);
      cu.uK.value = during(q, 2) * form;

      rivers.visible = ru.uLines.value > 0.002;
      roads.visible = du.uLines.value > 0.002;
      points.visible = pu.uLossK.value + pu.uScarA.value + pu.uScarB.value + pu.uPlaces.value > 0.002;
      columns.visible = cu.uK.value > 0.002;
      walls.visible = wu.uShow.value > 0.002;
      return q;
    },
    // The stage's counting figure: forest lost so far during the time-lapse.
    live() { return live; },
    // Screen overlay in CSS px: labels with opacity, north arrow and scale bar; null when hidden.
    overlay(camera) {
      if (!group.visible) return null;
      group.updateMatrixWorld();
      const lift = shared.uLift.value, placed = [];
      const fb = fitBox(), W = innerWidth, H = innerHeight, top = fb.y0 * H + 12;
      const out = labels.map((l) => {
        const a = form * Math.min(1, l.a(q)), name = l.text ? l.text() : l.name;
        const hidden = { name, cls: l.cls, x: 0, y: 0, a: 0 };
        if (a <= 0.004) return hidden;
        const [u, v] = l.corner ? corner() : [l.u, l.v];
        if (!l.corner && !rig.sees(u, v)) return hidden;
        const p = screenOf(group, (u - 0.5) * size.x, (0.5 - v) * size.y, dem.at(u, v) * lift + (l.h ? l.h() : 0) + 0.01, camera);
        if (!p) return hidden;
        const y = Math.max(p[1], top); // the label of a column taller than the free area stays below the HUD
        const big = l.cls.startsWith("big"), w = big ? name.length * 9 : 16 + name.length * 8.5;
        const x0 = big ? p[0] - w / 2 : p[0] - 6;
        if (placed.some(([bx, by, bw]) => x0 < bx + bw && x0 + w > bx && Math.abs(y - by) < 18)) return hidden;
        placed.push([x0, y, w]);
        return { name, cls: l.cls, x: p[0], y, a };
      });
      // north: the map's own +y on screen at the centre of the view, foreshortened by the tilt
      const d = 0.1 / cur.z, cx = (cur.c[0] - 0.5) * size.x, cy = (0.5 - cur.c[1]) * size.y, cz = dem.at(cur.c[0], cur.c[1]) * lift;
      const o = screenOf(group, cx, cy, cz, camera), n = screenOf(group, cx, cy + d, cz, camera), e = screenOf(group, cx + d, cy, cz, camera);
      if (!o || !n || !e) return { labels: out, north: null, scale: null };
      const nx = n[0] - o[0], ny = n[1] - o[1], ex = Math.hypot(e[0] - o[0], e[1] - o[1]);
      const north = { x: fb.x1 * W - 26, y: fb.y0 * H + 26, rot: Math.atan2(nx, -ny),
        sy: Math.max(0.35, Math.min(1, Math.hypot(nx, ny) / ex)), a: form };
      // scale bar: east-west at the centre of the view (approximate once the map yaws)
      const pxPerKm = ex / (d * kmPerUnit);
      // the dense dots scale with the view's width on screen, so they cover the same share of the map
      pu.uDot.value = Math.max(0.4, Math.min(1, (ex * (size.x / cur.z)) / d / DOT_REF_PX));
      let km = SCALE_KM[0];
      for (const c of SCALE_KM) if (c * pxPerKm <= SCALE_PX) km = c;
      const scale = { x: fb.x0 * W + 6, y: fb.y1 * H - 30, w: km * pxPerKm, text: `${km} km`, a: form };
      return { labels: out, north, scale };
    },
  };
}

// HUD copy. Sources: Hansen Global Forest Change v1.13 (2001-2025), MODIS MOD10A2 v6.1 (Feb 2000 to
// Nov 2026), RGI 7.0 glacier outlines, Sentinel-1 RTC, JRC Global Surface Water, ESA WorldCover 2021,
// Sentinel-2 L2A, CHIRPS v3, Copernicus GLO-30 and OpenStreetMap; the analyses are in
// himachal-remote-sensing/outputs. legend: [class suffix, label] pairs, or ["ramp", low, high, ramp class].
export const HIMACHAL_STAGES = [
  { name: "A state of mountains", stat: 55673, dp: 0, unit: "km² rising from about 300 m to peaks over 6,500 m",
    legend: [["edge", "State edge"], ["border", "District border"], ["river", "Main river"]],
    text: "Sentinel-2 imagery from 9 November 2025 on Copernicus 30 m terrain, drawn 2.6 times taller and lit by a moving sun. Four studies follow: forests, snow, floods and landslides." },
  { name: "Forest lost, year by year", stat: "live", dp: 1, unit: "km² of tree cover lost since 2000",
    legend: [["forest", "Forest in 2000"], ["loss", "Lost that year"], ["lossold", "Lost before"]],
    text: "Hansen Global Forest Change at 30 m: 13,699 km² of forest (30% canopy or more) in 2000, and 62.6 km² gone by 2025, or 0.46%. Losses peaked in 2004 and 2012 and have climbed again since 2020." },
  { name: "Where it went", stat: 13.2, dp: 1, unit: "km² lost in Kangra, the most of any district",
    legend: [["column", "Column height = forest lost"], ["border", "District border"]],
    text: "Kangra (13.2 km²) and Kullu (12.2 km²) lost the most, Una the largest share of its forest (0.87%). Nearly a third of all loss is on slopes over 30°, and the 2,700-3,600 m belt lost 0.64% of its forest, more than any other." },
  { name: "The snow year", stat: 153.6, dp: 1, unit: "days a year under snow, averaged over the state",
    legend: [["ramp", "Patchy", "Full snow", "snow"]],
    text: "Eight-day MODIS snow maps from February 2000 to November 2026, averaged by month. Snow lies on 61% of the state in January, down to about 2,200 m, and on 17% in August, above about 5,000 m, three-quarters of it in Lahaul and Spiti and Kinnaur." },
  { name: "Three basins, 26 years", stat: 79, dp: 0, unit: "metres a decade: the Parbati's late-summer snowline rise", sub: [
    "The Chandra-Bhaga, Parbati and Baspa basins, traced from the terrain, with 1,891 RGI 7.0 glaciers. A Mann-Kendall test with Sen's slope runs on each basin's yearly snow cover.",
    "No basin shows a significant trend in mean snow cover. The exception is the Parbati in late summer: its snow cover falls 3.8 points a decade (p = 0.012) as the snowline climbs."],
    legend: [["glacier", "Glacier"], ["edge", "Basin edge"], ["less", "Fewer snow days"], ["more", "More snow days"]] },
  { name: "The Beas, August 2023", stat: 17.2, dp: 1, unit: "km² of floodwater on 22 August, 9.7 of it in Himachal", sub: [
    "10 August 2023: Sentinel-1 radar over the Beas below Pong Dam. Calm water reflects the radar away and shows dark.",
    "22 August, after the dam's spillway releases: water outside the river's normal channels, found with an Otsu threshold on the radar and checked against a second orbit.",
    "3 September: most of the water has drained, leaving 3 km². A cloud-free Sentinel-2 image from 30 August agrees with the radar moderately well (kappa 0.52)."],
    legend: [["flood", "Floodwater"], ["perm", "Normal river and lake"]] },
  { name: "What the water reached", stat: 20.3, dp: 1, unit: "km of road under water on 22 August",
    legend: [["flood", "Floodwater"], ["road", "Flooded road"]],
    text: "5.3 km of the flooded road is in Himachal. Most of the water lay on farmland (10.6 km²), and the nearest mapped villages were about 500 m away. The outline, flooded roads and counts are written out for PostGIS, for planners and relief teams." },
  { name: "Where slopes fail", stat: 0.78, dp: 2, unit: "AUC on 2025's new landslides, unseen in training", sub: [
    "Landslide and debris-flow scars after the 2023 monsoon: 25 km² where vegetation vanished between two October Sentinel-2 images on steep ground.",
    "A random forest on 15 factors, led by distance to rivers, vegetation and distance to roads, ranks every 30 m cell of steep, vegetated ground from very low to very high susceptibility.",
    "The test: 2025's new scars, which the model never saw. The top 15% of the ground holds 55% of them."],
    legend: [["ramp", "Very low", "Very high", "slide"], ["scar", "2023 scar"], ["scar25", "2025 scar"]] },
];
