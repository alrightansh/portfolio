// Zoom-in context for the research stop: an orthographic map centred on the Neugal watershed.
// At world scale it reads as a globe; at the watershed it is the terrain's own plane, so one
// continuous zoom runs from the whole planet down to the valley. context.json (Earth radii),
// world-land.png, hp-relief.jpg and kangra-relief.jpg are built by tools/research/build_maps.py.
import * as THREE from "three";

export const R_KM = 6371;
const WORLD_BOX = [0, 0, 2.4, 2.4];        // the whole disc of the globe with a margin, in Earth radii
const PAD = { india: 1.1, hp: 1.3 };       // breathing room around each zoom target
const ACCENT = new THREE.Vector3(0.56, 0.83, 1.0);

const flatVert = /* glsl */ `
void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const flatFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
void main() { gl_FragColor = vec4(uColor, uOpacity); }`;

const diskVert = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// Inverse orthographic projection per pixel: ocean, land, coastline, graticule and limb at world
// scale, then the Himachal relief and the sharper Kangra relief as the zoom closes in.
const diskFrag = /* glsl */ `
uniform sampler2D uLand, uHP, uKangra;
uniform vec4 uHPBox, uKBox; // lon0, lat0, lon1, lat1 in degrees
uniform vec3 uCentre;    // centre longitude in degrees, sin and cos of the centre latitude
uniform float uAlpha, uGlobe, uHPk, uKk;
varying vec2 vP;
const float DEG = 57.2957795;
const vec3 OCEAN = vec3(0.024, 0.047, 0.098), LAND = vec3(0.10, 0.16, 0.26), HALO = vec3(0.30, 0.55, 0.90);
float grid(float v) { // anti-aliased lines every 15 degrees: zero crossings of sin(12 v)
  float s = sin(v * 12.0);
  return 1.0 - smoothstep(0.5, 1.5, abs(s) / max(fwidth(s), 1e-6));
}
// an equirectangular relief over box, with its coverage fading out towards the box edges
vec4 relief(sampler2D tex, vec4 box, float lon, float latD, float fade) {
  vec2 uv = vec2((lon - box.x) / (box.z - box.x), (box.w - latD) / (box.w - box.y));
  vec2 e = smoothstep(vec2(0.0), vec2(fade), uv) * smoothstep(vec2(0.0), vec2(fade), 1.0 - uv);
  return vec4(texture2D(tex, clamp(uv, 0.0, 1.0)).rgb, e.x * e.y);
}
void main() {
  float rho = length(vP), aa = fwidth(rho);
  float r = min(rho, 1.0);
  float cosc = sqrt(max(0.0, 1.0 - r * r));
  vec2 p = vP * (r / max(rho, 1e-9)); // outside the disc, read the limb
  float lat = asin(clamp(cosc * uCentre.y + p.y * uCentre.z, -1.0, 1.0));
  float lon = uCentre.x + DEG * atan(p.x, cosc * uCentre.z - p.y * uCentre.y);
  float latD = lat * DEG;
  float land = texture2D(uLand, vec2(fract((lon + 180.0) / 360.0), (90.0 - latD) / 180.0)).r;
  float fw = fwidth(land) * 0.7 + 0.004;
  vec3 col = mix(OCEAN, LAND, smoothstep(0.5 - fw, 0.5 + fw, land));
  col += vec3(0.20, 0.36, 0.55) * (1.0 - smoothstep(0.0, 2.2 * fw, abs(land - 0.5))) * 0.5;
  float lines = max(grid(lon / DEG), grid(lat)) * (1.0 - smoothstep(70.0, 80.0, abs(latD)));
  col += vec3(0.25, 0.45, 0.70) * lines * 0.1 * uGlobe;
  vec4 hp = relief(uHP, uHPBox, lon, latD, 0.12);
  col = mix(col, hp.rgb, uHPk * hp.a);
  vec4 kangra = relief(uKangra, uKBox, lon, latD, 0.15);
  col = mix(col, kangra.rgb, uKk * kangra.a);
  col *= mix(1.0, 0.4 + 0.6 * sqrt(cosc), uGlobe);
  float disc = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, rho);
  float halo = uGlobe * 0.45 * exp(-max(rho - 1.0, 0.0) * 30.0) * (1.0 - disc);
  gl_FragColor = vec4(mix(HALO, col, disc), uAlpha * max(disc, halo));
}`;

// Outlines with a constant on-screen width: each segment is a quad widened in screen space.
const lineVert = /* glsl */ `
attribute vec3 aOther;
attribute float aSide, aEnd;
uniform vec2 uHalfRes;
uniform float uWidth;
varying float vD;
void main() {
  vec4 a = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  vec4 b = projectionMatrix * modelViewMatrix * vec4(aOther, 1.0);
  vec2 dir = b.xy / b.w * uHalfRes - a.xy / a.w * uHalfRes;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 n = vec2(-dir.y, dir.x) * (aEnd > 0.5 ? -1.0 : 1.0);
  float hw = uWidth * 0.5 + 1.0;
  a.xy += n * aSide * hw / uHalfRes * a.w;
  gl_Position = a;
  vD = aSide * hw;
}`;
const lineFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity, uWidth;
varying float vD;
void main() {
  gl_FragColor = vec4(uColor, uOpacity * (1.0 - smoothstep(uWidth * 0.5 - 0.5, uWidth * 0.5 + 0.5, abs(vD))));
}`;

const shader = (vertexShader, fragmentShader, uniforms) => new THREE.ShaderMaterial({
  vertexShader, fragmentShader, uniforms, transparent: true, depthTest: false, depthWrite: false });

function fill(rings) {
  const pos = [], idx = [];
  for (const flat of rings) {
    const pts = [];
    for (let i = 0; i < flat.length - 2; i += 2) pts.push(new THREE.Vector2(flat[i], flat[i + 1])); // drop the closing point
    const base = pos.length / 3;
    for (const p of pts) pos.push(p.x, p.y, 0);
    for (const [a, b, c] of THREE.ShapeUtils.triangulateShape(pts, [])) idx.push(base + a, base + b, base + c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, shader(flatVert, flatFrag, { uColor: { value: ACCENT }, uOpacity: { value: 0 } }));
}

function outline(rings, width) {
  const pos = [], other = [], side = [], end = [], idx = [];
  for (const flat of rings) {
    for (let i = 0; i + 3 < flat.length; i += 2) {
      const v = pos.length / 3;
      const a = [flat[i], flat[i + 1], 0], b = [flat[i + 2], flat[i + 3], 0];
      for (const [p, o, e] of [[a, b, 0], [b, a, 1]]) for (const s of [-1, 1]) { pos.push(...p); other.push(...o); side.push(s); end.push(e); }
      idx.push(v, v + 1, v + 2, v + 1, v + 3, v + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("aOther", new THREE.Float32BufferAttribute(other, 3));
  g.setAttribute("aSide", new THREE.Float32BufferAttribute(side, 1));
  g.setAttribute("aEnd", new THREE.Float32BufferAttribute(end, 1));
  g.setIndex(idx);
  return new THREE.Mesh(g, shader(lineVert, lineFrag, {
    uColor: { value: ACCENT }, uOpacity: { value: 0 }, uWidth: { value: width }, uHalfRes: { value: new THREE.Vector2(1, 1) } }));
}

export async function loadContext(base) {
  const res = await fetch(`${base}context.json`);
  if (!res.ok) throw new Error(`${base}context.json: HTTP ${res.status}`);
  const loader = new THREE.TextureLoader();
  const [ctx, land, hp, kangra] = await Promise.all([res.json(), loader.loadAsync(`${base}world-land.png`),
    loader.loadAsync(`${base}hp-relief.jpg`), loader.loadAsync(`${base}kangra-relief.jpg`)]);
  for (const t of [land, hp, kangra]) t.flipY = false; // row 0 is north, as in the data
  // no mipmaps on the world raster: its longitude seam would pick a blurry level along the antimeridian
  land.generateMipmaps = false;
  land.minFilter = THREE.LinearFilter;
  land.wrapS = THREE.RepeatWrapping;
  return { ctx, land, hp, kangra };
}

// Framing for zoom level L (0 world, 1 India, 2 Himachal, 3 watershed): magnification Z (1 at the
// watershed) and the view centre in Earth radii. Between two levels the zoom is linear in log Z about
// the one point that stays put on screen, so each step reads as a single dive.
// boxes: [cx, cy, w, h] per level in Earth radii; frame: visible area in terrain units; K0: terrain
// units per Earth radius.
export function zoomView(boxes, L, frame, K0) {
  const lv = boxes.map(([cx, cy, w, h]) => ({ cx, cy, Z: Math.min(frame.w / (w * K0), frame.h / (h * K0)) }));
  const i = Math.max(0, Math.min(lv.length - 2, Math.floor(L)));
  const f = Math.max(0, Math.min(1, L - i));
  const a = lv[i], b = lv[i + 1];
  const Z = a.Z * Math.pow(b.Z / a.Z, f);
  const ax = (a.cx * a.Z - b.cx * b.Z) / (a.Z - b.Z), ay = (a.cy * a.Z - b.cy * b.Z) / (a.Z - b.Z);
  return { Z, cx: ax - ((ax - a.cx) * a.Z) / Z, cy: ay - ((ay - a.cy) * a.Z) / Z, mag: Z / lv[0].Z };
}

const smooth = (x) => { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); };

export function createZoomMap({ ctx, land, hp, kangra }, shedBox) {
  const rad = (ctx.center[1] * Math.PI) / 180;
  const du = {
    uLand: { value: land }, uHP: { value: hp }, uKangra: { value: kangra },
    uHPBox: { value: new THREE.Vector4(...ctx.hpBox) }, uKBox: { value: new THREE.Vector4(...ctx.kangraBox) },
    uCentre: { value: new THREE.Vector3(ctx.center[0], Math.sin(rad), Math.cos(rad)) },
    uAlpha: { value: 0 }, uGlobe: { value: 1 }, uHPk: { value: 0 }, uKk: { value: 0 },
  };
  const disk = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), shader(diskVert, diskFrag, du));
  const indiaFill = fill(ctx.india), hpFill = fill(ctx.hp);
  const indiaLine = outline(ctx.india, 1.4), hpLine = outline(ctx.hp, 1.6);
  const objects = [disk, indiaFill, hpFill, indiaLine, hpLine];
  const root = new THREE.Group();
  root.add(...objects);
  const pad = ([cx, cy, w, h], k) => [cx, cy, w * k, h * k];
  const boxes = [WORLD_BOX, pad(ctx.boxes.india, PAD.india), pad(ctx.boxes.hp, PAD.hp), shedBox];
  const fade = (o, value) => { o.material.uniforms.uOpacity.value = value; o.visible = value > 0.002; };

  return {
    root, objects, boxes, anchors: ctx.anchors,
    // one layer at a time: globe, then India, then Himachal's relief, handing over to the terrain
    update(L, form) {
      const r = (a, b) => smooth((L - a) / (b - a));
      du.uAlpha.value = form * (1 - r(2.85, 3.0)); // opaque under the terrain while it fades in
      disk.visible = du.uAlpha.value > 0.002;
      du.uGlobe.value = 1 - r(0.25, 0.85);
      du.uHPk.value = r(1.35, 1.85);
      du.uKk.value = r(2.15, 2.45);
      fade(indiaFill, form * 0.2 * (1 - r(1.2, 1.7)));
      fade(hpFill, form * 0.32 * r(0.7, 1.0) * (1 - r(1.4, 1.8)));
      fade(indiaLine, form * 0.9 * (1 - r(1.3, 1.8)));
      fade(hpLine, form * 0.9 * r(0.6, 0.95) * (1 - r(2.45, 2.85)));
      for (const l of [indiaLine, hpLine]) l.material.uniforms.uHalfRes.value.set(innerWidth / 2, innerHeight / 2);
    },
  };
}
