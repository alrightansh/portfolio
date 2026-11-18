// Shared pieces of the pinned map stops (research.js, energy.js): easing, screen mapping, loading,
// fitting the map into the free screen area, and the depth clear that keeps the flight terrain out.
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

// Scales and centres the map so its relief at the given lift fits the free screen area, as seen
// from the camera's pinned position (the map is pinned relative to the camera while the stop plays).
export function makeFitter(group, size) {
  const corners = [];
  for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [0, 1]) corners.push(new THREE.Vector3(x * size.x, y * size.y, z));
  const cam = new THREE.PerspectiveCamera(), p = new THREE.Vector3();
  return (camera, camShift, z, lift) => {
    cam.copy(camera);
    cam.position.z += camShift;
    cam.updateMatrixWorld(true);
    const box = fitBox();
    const tx = box.x0 + box.x1 - 1, ty = 1 - (box.y0 + box.y1), tw = (box.x1 - box.x0) * 2, th = (box.y1 - box.y0) * 2;
    group.position.z = z;
    for (let iter = 0; iter < 6; iter++) {
      group.updateMatrixWorld(true);
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const c of corners) {
        p.set(c.x, c.y, c.z * lift).applyMatrix4(group.matrixWorld).project(cam);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
      group.scale.multiplyScalar(Math.min(tw / (x1 - x0), th / (y1 - y0)));
      const halfH = cam.position.distanceTo(group.position) * Math.tan((cam.fov * Math.PI) / 360);
      group.position.x += (tx - (x0 + x1) / 2) * halfH * cam.aspect;
      group.position.y += (ty - (y0 + y1) / 2) * halfH;
    }
  };
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
