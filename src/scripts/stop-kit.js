// Shared pieces of the pinned map stops (research.js, energy.js, himachal.js): easing, screen mapping,
// loading, the block's walls, fitting the map into the free screen area, keyframed camera moves,
// relighting by a moving sun, and the depth clear that keeps the flight terrain out.
import * as THREE from "three";
import { P } from "./config.js";

// Free screen area for a map (fractions of the viewport, from the top-left), clear of the HUD.
const FIT_LANDSCAPE = { x0: 0.34, x1: 0.78, y0: 0.12, y1: 0.88 };
const FIT_PORTRAIT = { x0: 0.04, x1: 0.96, y0: 0.34, y1: 0.66 };
export const fitBox = () => (innerWidth > innerHeight ? FIT_LANDSCAPE : FIT_PORTRAIT);

const FADE = 0.015;
export function smooth(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }
export const ramp = (x, a, b) => smooth((x - a) / (b - a));
export const win = (q, a, b) => Math.min(smooth((q - a + FADE) / (2 * FADE)), 1 - smooth((q - b + FADE) / (2 * FADE)));

// The post pass samples the scene at d * (1 + postLens * |d|²) for a screen offset d from the centre
// (uv units), so a projected point is moved to where it is actually drawn.
export function toScreen(nx, ny) {
  const sx = nx * 0.5, sy = ny * 0.5;
  let dx = sx, dy = sy;
  for (let i = 0; i < 12; i++) { const k = 1 + P.postLens * (dx * dx + dy * dy); dx = sx / k; dy = sy / k; }
  return [(0.5 + dx) * innerWidth, (0.5 - dy) * innerHeight];
}

export function geometry(attrs) {
  const g = new THREE.BufferGeometry();
  for (const [name, [data, size]] of Object.entries(attrs)) g.setAttribute(name, new THREE.Float32BufferAttribute(data, size));
  return g;
}

export async function loadJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export async function loadImage(loader, url) {
  const t = await loader.loadAsync(url);
  t.flipY = false; // row 0 is north, as in the data
  t.anisotropy = 4;
  return t;
}

// A Uint16 elevation grid (metres, row 0 north), normalised to 0..1 of max, with bilinear lookup.
// step > 1 keeps every step-th sample in both directions (a lighter mesh for phones).
export async function loadDem(url, w, h, max, step = 1) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const raw = new Uint16Array(await res.arrayBuffer());
  if (raw.length !== w * h) throw new Error(`${url}: ${raw.length} samples, expected ${w * h}`);
  const W = Math.ceil(w / step), H = Math.ceil(h / step), norm = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) norm[y * W + x] = raw[y * step * w + x * step] / max;
  // bilinear height (0..1 of the highest peak) at u, v in 0..1
  const at = (u, v) => {
    const x = Math.min(Math.max(u, 0), 1) * (W - 1), y = Math.min(Math.max(v, 0), 1) * (H - 1);
    const x0 = Math.min(W - 2, x | 0), y0 = Math.min(H - 2, y | 0), fx = x - x0, fy = y - y0, i = y0 * W + x0;
    return (norm[i] * (1 - fx) + norm[i + 1] * fx) * (1 - fy) + (norm[i + W] * (1 - fx) + norm[i + W + 1] * fx) * fy;
  };
  return { norm, at, w: W, h: H };
}

// Four strips from the terrain's edge down to the base, walking round the map.
export function buildWalls(norm, w, h, size) {
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

// The block's sides: from the terrain's edge down to a flat base, with faint strata.
export const wallVert = /* glsl */ `
attribute float aTop, aElev;
uniform float uLift, uDepth;
varying float vZ, vTop;
void main() {
  vZ = aTop > 0.5 ? aElev * uLift : -uDepth;
  vTop = aTop;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position.xy, vZ, 1.0);
}`;
export const wallFrag = /* glsl */ `
uniform float uShow, uDepth;
varying float vZ, vTop;
void main() {
  vec3 col = mix(vec3(0.05, 0.07, 0.11), vec3(0.16, 0.19, 0.25), clamp((vZ + uDepth) / (uDepth + 0.05), 0.0, 1.0));
  col += 0.05 * smoothstep(0.9, 1.0, fract(vZ * 140.0));
  col += vec3(0.25, 0.4, 0.55) * 0.3 * smoothstep(0.9, 1.0, vTop); // lit lip along the top edge
  gl_FragColor = vec4(col, uShow);
}`;

// Scales and centres the map so its relief at the given lift fits the free screen area, as seen
// from the camera's pinned position (the map is pinned relative to the camera while the stop plays).
// focus (optional): fit only part of the map, { x, y, w, h } in map units (centre and size), with the
// relief between heights lo and hi (0..1 of the lift) instead of 0..1. Uses the group's rotation as set.
// Each call starts from a first guess of its own, never from the group's state, so a bad frame cannot
// carry over. Returns false if no fit was found (the group's scale and position are then meaningless).
const FIT_STEPS = 30;        // at most this many refinements a call
const FIT_TOLERANCE = 1e-6;  // done once the size and the centre are this close (screen units, -1..1)
export function makeFitter(group, size) {
  const cam = new THREE.PerspectiveCamera(), p = new THREE.Vector3(), mid = new THREE.Vector3();
  return (camera, camShift, z, lift, focus = null) => {
    const f = focus || { x: 0, y: 0, w: size.x, h: size.y, lo: 0, hi: 1 };
    cam.copy(camera);
    cam.position.z += camShift;
    cam.updateMatrixWorld(true);
    const box = fitBox();
    const tx = box.x0 + box.x1 - 1, ty = 1 - (box.y0 + box.y1), tw = (box.x1 - box.x0) * 2, th = (box.y1 - box.y0) * 2;
    const ky = Math.tan((cam.fov * Math.PI) / 360), kx = ky * cam.aspect, midZ = ((f.lo + f.hi) / 2) * lift;
    // first guess: the box face on at the pinned depth, filling the free area, its centre on the line
    // of sight through the free area's centre
    const depth = cam.position.z - z, s = Math.min((tw * kx * depth) / f.w, (th * ky * depth) / f.h);
    mid.set(f.x, f.y, midZ).applyEuler(group.rotation).multiplyScalar(s); // the box centre from the group's origin
    p.set(tx, ty, 0.5).unproject(cam).sub(cam.position);
    p.multiplyScalar((z + mid.z - cam.position.z) / p.z);
    group.scale.setScalar(s);
    group.position.set(cam.position.x + p.x - mid.x, cam.position.y + p.y - mid.y, z);
    // the box's size against the free area (r: the scale that fits it) and its offset from the free
    // area's centre, in screen units; null while a corner is behind the camera, where projections mean nothing
    const bounds = () => {
      group.updateMatrixWorld(true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const h of [f.lo, f.hi]) {
        p.set(f.x + sx * f.w, f.y + sy * f.h, h * lift).applyMatrix4(group.matrixWorld).applyMatrix4(cam.matrixWorldInverse);
        if (-p.z < cam.near) return null;
        p.applyMatrix4(cam.projectionMatrix);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      return { r: Math.min(tw / (x1 - x0), th / (y1 - y0)), ex: tx - (x0 + x1) / 2, ey: ty - (y0 + y1) / 2 };
    };
    for (let i = 0; i < FIT_STEPS; i++) {
      const b = bounds();
      // resize about the box centre, so it stays put on screen (halved while a corner is behind the camera)
      const r = b ? b.r : 0.5;
      mid.set(f.x, f.y, midZ).applyMatrix4(group.matrixWorld);
      group.scale.multiplyScalar(r);
      group.position.x = mid.x + (group.position.x - mid.x) * r;
      group.position.y = mid.y + (group.position.y - mid.y) * r;
      if (!b) continue;
      // then slide it onto the free area's centre, by the screen offset at the box centre's depth
      const d = -p.copy(mid).applyMatrix4(cam.matrixWorldInverse).z;
      group.position.x += b.ex * kx * d;
      group.position.y += b.ey * ky * d;
      if (Math.abs(r - 1) < FIT_TOLERANCE && Math.abs(b.ex) < FIT_TOLERANCE && Math.abs(b.ey) < FIT_TOLERANCE) break;
    }
    return bounds() !== null && Number.isFinite(group.scale.x + group.position.x + group.position.y);
  };
}

// Camera moves for a pinned map. keys: [[q, view], ...] in q order, view = { c: [u, v] focus centre in
// map uv (v = 0 north), z: zoom (1 = the whole map), tilt (radians, negative tips north away), yaw
// (radians), e: lift multiplier }. Between two keys the view eases; zoom runs linearly in log z about
// the one map point that stays put on screen, so each move reads as a single dive. Hold a view by
// repeating it.
export function makeViews(keys) {
  return (q) => {
    let i = 0;
    while (i < keys.length - 2 && q > keys[i + 1][0]) i++;
    const [qa, a] = keys[i], [qb, b] = keys[Math.min(i + 1, keys.length - 1)];
    const t = qb > qa ? smooth((q - qa) / (qb - qa)) : 1;
    const mix = (x, y) => x + (y - x) * t;
    const la = Math.log(a.z), lb = Math.log(b.z), z = Math.exp(mix(la, lb));
    let c;
    if (Math.abs(lb - la) < 1e-3) c = [mix(a.c[0], b.c[0]), mix(a.c[1], b.c[1])];
    else {
      // fixed point p: (p - ca) za = (p - cb) zb; then c(t) = p - (p - ca) za / z
      const k = a.z / z;
      c = [0, 1].map((j) => { const p = (b.c[j] * b.z - a.c[j] * a.z) / (b.z - a.z); return p - (p - a.c[j]) * k; });
    }
    return { c, z, tilt: mix(a.tilt, b.tilt), yaw: mix(a.yaw, b.yaw), e: mix(a.e ?? 1, b.e ?? 1) };
  };
}

// Lighting by a moving sun. relight: for a terrain colour that already carries the light of one sun (a
// satellite image), divide that light out and light the surface again from another direction; k is how
// much of the new light to apply (0 leaves the colour as it is). shadeAt: the light on an unlit colour,
// 1 on flat open ground. n: unit normal; sky: sky-view factor 0..1; sun0: the baked sun, sun: the new
// one (unit vectors, map frame).
export const RELIGHT = /* glsl */ `
float occlusion(float sky) { return mix(1.0, 0.45 + 0.55 * sky, 0.7); }
vec3 relight(vec3 col, vec3 n, float sky, vec3 sun0, vec3 sun, float k) {
  float was = 0.38 + 0.62 * max(dot(n, sun0), 0.0);
  float now = 0.38 + 0.62 * max(dot(n, sun), 0.0);
  vec3 lit = col * clamp(now / was, 0.45, 1.9) * occlusion(sky);
  return mix(col, lit, k);
}
float shadeAt(vec3 n, float sky, vec3 sun) {
  return (0.38 + 0.62 * max(dot(n, sun), 0.0)) / (0.38 + 0.62 * max(sun.z, 0.0)) * occlusion(sky);
}
// Unit normal from a normal map texel: xy in rg (0.5 = flat), scaled by exag for steeper shading.
vec3 unpackNormal(vec2 rg, float exag) {
  vec2 xy = rg * 2.0 - 1.0;
  float z = sqrt(max(1.0 - dot(xy, xy), 0.0));
  return normalize(vec3(xy * exag, z));
}`;

// Sun direction in the map frame (x east, y north, z up) from azimuth (degrees clockwise from north)
// and elevation (degrees).
export function sunDir(azimuth, elevation, out = new THREE.Vector3()) {
  const a = (azimuth * Math.PI) / 180, e = (elevation * Math.PI) / 180;
  return out.set(Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), Math.sin(e));
}
// The sun crossing the southern sky over a stop's progress q, with a slow drift in time.
export const SUN_ELEVATION = 34;
export const sunAt = (q, time, out) => sunDir(105 + 150 * q + 6 * Math.sin(time * 0.15), SUN_ELEVATION, out);

// The visible window of a zoomed map: positions outside the focus box fade out. Every layer's fragment
// shader includes this and multiplies its alpha by windowAt(map uv).
export const WINDOW = /* glsl */ `
uniform vec4 uWin;      // u0, v0, u1, v1 of the window in map uv (v = 0 north)
uniform float uFeather;
float windowAt(vec2 p) {
  vec2 d = max(uWin.xy - p, p - uWin.zw);
  return 1.0 - smoothstep(-uFeather, 0.0, max(d.x, d.y));
}`;
// Map uv of a position in map units, for the layers' vertex shaders (uSize: the map's size).
export const MAP_UV = /* glsl */ `
uniform vec2 uSize;
vec2 mapUv(vec2 p) { return vec2(p.x / uSize.x + 0.5, 0.5 - p.y / uSize.y); }`;

const MARGIN = 0.35;   // the window reaches this share of the focus box past its edges
const FEATHER = 0.35;  // and fades out over this share

// The camera of a pinned map, run once a frame: tilts and turns the map to the view (from makeViews),
// sets the window round the view's focus box (win: the shared uWin and uFeather uniforms) and fits that
// box, relief included, to the free screen area, easing toward the fit so scrolling never makes it jump.
// at(u, v): ground height 0..1 of the lift.
export function makeRig(group, size, at, win) {
  const fit = makeFitter(group, size), prev = new THREE.Vector3();
  let fitted = false;
  // lowest and highest ground inside a uv box
  const range = (u0, v0, u1, v1) => {
    let lo = 1, hi = 0;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) {
      const h = at(u0 + ((u1 - u0) * i) / 12, v0 + ((v1 - v0) * j) / 12);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    return [lo, hi];
  };
  return {
    // snap to a fresh fit next time (call when the stop is hidden)
    reset() { fitted = false; },
    update(view, camera, camShift, z, lift, dt) {
      group.rotation.x = view.tilt;
      group.rotation.z = view.yaw;
      const hw = 0.5 / view.z, [cx, cy] = view.c, zoomed = view.z > 1.02;
      const [lo, hi] = zoomed ? range(cx - hw, cy - hw, cx + hw, cy + hw) : [0, 1];
      const m = zoomed ? hw * (1 + MARGIN) : 1;
      win.uWin.value.set(cx - m, cy - m, cx + m, cy + m);
      win.uFeather.value = zoomed ? hw * FEATHER : 0.05;
      const s0 = group.scale.x;
      prev.copy(group.position);
      if (!fit(camera, camShift, z, lift, { x: (cx - 0.5) * size.x, y: (0.5 - cy) * size.y, w: size.x / view.z, h: size.y / view.z, lo, hi })) {
        group.scale.setScalar(s0); // no fit this frame: hold the last one
        group.position.set(prev.x, prev.y, z);
        return;
      }
      if (fitted) { // ease from the last frame toward the fit; a fresh fit is taken as it is
        const k = 1 - Math.exp(-dt * 5);
        group.scale.setScalar(s0 + (group.scale.x - s0) * k);
        group.position.x = prev.x + (group.position.x - prev.x) * k;
        group.position.y = prev.y + (group.position.y - prev.y) * k;
      }
      fitted = true;
    },
    // whether a map uv point is inside the window, short of its faded edge (labels outside are hidden)
    sees(u, v) {
      const w = win.uWin.value, f = win.uFeather.value / 2;
      return u >= w.x + f && u <= w.z - f && v >= w.y + f && v <= w.w - f;
    },
  };
}

// A view framing uv points: centre and zoom so their box, padded, fills the focus box (at most zMax).
export function frame(points, pad = 0.05, zMax = 4) {
  const us = points.map((p) => p[0]), vs = points.map((p) => p[1]);
  const u0 = Math.min(...us), u1 = Math.max(...us), v0 = Math.min(...vs), v1 = Math.max(...vs);
  return { c: [(u0 + u1) / 2, (v0 + v1) / 2], z: Math.min(zMax, 1 / (Math.max(u1 - u0, v1 - v0) + 2 * pad)) };
}

// Drawn after the world, on a cleared depth buffer, so the flight terrain never cuts into the map.
// The clearer is an empty triangle sorted just before the map in the transparent pass.
export function depthClearer() {
  const clearer = new THREE.Mesh(geometry({ position: [new Array(9).fill(0), 3] }),
    new THREE.MeshBasicMaterial({ transparent: true, colorWrite: false, depthWrite: false, depthTest: false }));
  clearer.onBeforeRender = (renderer) => {
    renderer.state.buffers.depth.setMask(true); // clear is a no-op while depth writes are off
    renderer.clearDepth();
  };
  return clearer;
}

// Screen position in CSS px of a point in an object's local space, or null behind the camera.
export function makeScreenOf() {
  const tmp = new THREE.Vector3();
  return (obj, x, y, z, camera) => {
    tmp.set(x, y, z);
    obj.localToWorld(tmp).project(camera);
    return tmp.z < 1 ? toScreen(tmp.x, tmp.y) : null;
  };
}
