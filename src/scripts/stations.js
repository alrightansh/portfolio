// Stations along the flight path: particle glyphs that rise out of the ground, and glass tile walls.
import * as THREE from "three";
import { P, rgb } from "./config.js";
import * as F from "./glsl-fx.js";

const PARTICLES = 6000;
const PORTRAIT_GLASS_SCALE = 1.6;
const v3 = (hex) => new THREE.Vector3(...rgb(hex));

// Sample `count` points from the opaque pixels of a glyph string (text or emoji).
function sampleGlyph(text, count, worldHeight, font) {
  const px = 220;
  const w = Math.ceil(text.length * px * 0.7 + px * 0.4), h = Math.ceil(px * 1.3);
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#fff";
  g.font = `500 ${px}px ${font}`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, w / 2, h / 2);
  const data = g.getImageData(0, 0, w, h).data;
  const out = new Float32Array(count * 2);
  const k = worldHeight / px;
  let n = 0, tries = 0;
  while (n < count && tries < count * 200) {
    tries++;
    const x = (Math.random() * w) | 0, y = (Math.random() * h) | 0;
    if (data[(y * w + x) * 4 + 3] > 80) { out[n * 2] = (x - w / 2) * k; out[n * 2 + 1] = -(y - h / 2) * k; n++; }
  }
  return out;
}

function makeParticleStation(glyph, z, worldHeight, font, dpr) {
  const geo = new THREE.BufferGeometry();
  const seed = new Float32Array(PARTICLES);
  for (let i = 0; i < PARTICLES; i++) seed[i] = Math.random();
  geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(PARTICLES * 3), 3));
  geo.setAttribute("aBase", new THREE.BufferAttribute(sampleGlyph(glyph, PARTICLES, worldHeight, font), 2));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  const u = {
    uStationCenter: { value: new THREE.Vector3(0, 0, z) }, uFormProgress: { value: 0 }, uVisProgress: { value: 0 },
    uYOffset: { value: P.statYOffset }, uScatterRadius: { value: P.statScatterRadius },
    uScatterHeight: { value: P.statScatterHeight }, uFormJitter: { value: P.statFormJitter },
    uCursorNDC: { value: new THREE.Vector2() }, uHoverActive: { value: 0 }, uHoverRadius: { value: P.statHoverRadius },
    uHoverRepel: { value: P.statHoverRepel }, uHoverScale: { value: P.statHoverScale },
    uParticleSize: { value: P.statParticleSize }, uPixelRatio: { value: dpr }, uTime: { value: 0 },
    uIdleWiggle: { value: P.statIdleWiggle }, uColorA: { value: v3(P.statColorA) }, uColorB: { value: v3(P.statColorB) },
    uHoverGlowColor: { value: v3(P.statHoverGlowColor) }, uHoverGlow: { value: P.statHoverGlow },
    uPLightDir: { value: new THREE.Vector3(...P.pLight) }, uPAmbient: { value: P.pAmbient },
    uPDiffuse: { value: P.pDiffuse }, uPSpec: { value: P.pSpec }, uPSpecPower: { value: P.pSpecPower },
  };
  const mesh = new THREE.Points(geo, new THREE.ShaderMaterial({ vertexShader: F.stationVert,
    fragmentShader: F.stationFrag, uniforms: u, transparent: true, depthWrite: false }));
  mesh.frustumCulled = false;
  let form = 0;
  return {
    z, mesh,
    update(dt, camZ, time, cursor, hoverAct) {
      const d = camZ - z;
      const want = d <= 6.6 && d >= -1.2 ? 1 : 0;
      const dur = (want ? P.statFormInMs : P.statFormOutMs) / 1000;
      form += (want ? 1 : -1) * dt / dur;
      form = Math.max(0, Math.min(1, form));
      u.uFormProgress.value = form;
      u.uVisProgress.value = Math.min(1, form * 4);
      u.uTime.value = time;
      u.uCursorNDC.value.copy(cursor);
      u.uHoverActive.value = hoverAct;
      mesh.visible = form > 0.001;
    },
  };
}

// MakeMeDizzy's own 16x16 pixel cat.
const CAT_ROWS = [
  ".#............#.", ".##..........##.", ".###........###.", ".####......####.",
  ".##############.", "################", "#......##......#", "#..#...##..#...#",
  "#.#....##.#....#", "##....####....##", "################", "#######..#######",
  ".##############.", "..############..", "...##########...", ".....######.....",
];
function drawCat(g, ox, oy, px, color) {
  g.fillStyle = color;
  CAT_ROWS.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === "#") g.fillRect(ox + x * px, oy + y * px, px + 0.5, px + 0.5);
  }));
}

export function dizzyTexture() {
  const c = document.createElement("canvas");
  c.width = 1024; c.height = 768;
  const g = c.getContext("2d");
  const grd = g.createLinearGradient(0, 0, 0, 768);
  grd.addColorStop(0, "#0a1630"); grd.addColorStop(1, "#04060c");
  g.fillStyle = grd; g.fillRect(0, 0, 1024, 768);
  g.strokeStyle = "rgba(120,190,255,0.10)";
  for (let x = 0; x <= 1024; x += 64) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, 768); g.stroke(); }
  for (let y = 0; y <= 768; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  let p = 470;
  for (let i = 0; i < 34; i++) {
    const o = p; p += (Math.sin(i * 2.7) + Math.sin(i * 1.3) * 0.6) * 26;
    g.fillStyle = p < o ? "rgba(110,200,255,0.6)" : "rgba(90,110,230,0.5)";
    const x = 40 + i * 28;
    g.fillRect(x, Math.min(o, p), 14, Math.max(6, Math.abs(p - o)));
    g.fillRect(x + 6, Math.min(o, p) - 16, 2, Math.abs(p - o) + 32);
  }
  drawCat(g, 512 - 8 * 14, 110, 14, "#e8f2ff");
  g.textAlign = "center";
  g.fillStyle = "#8fd3ff";
  g.font = "500 54px 'Overused Grotesk', sans-serif";
  g.fillText("MakeMeDizzy", 512, 420);
  return new THREE.CanvasTexture(c);
}

export function catTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  drawCat(c.getContext("2d"), 0, 0, 8, "#e8f2ff");
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  return t;
}

function smooth01(x) { const t = Math.max(0, Math.min(1, x)); return t * t * (3 - 2 * t); }

function makeGlassStation(texture, z) {
  const tx = P.glassTilesX, ty = P.glassTilesY;
  const W = P.glassWidth, H = P.glassWidth / P.glassAspect;
  const tw = W / tx, th = H / ty;
  const geo = new THREE.BoxGeometry(tw * P.glassTileGap, th * P.glassTileGap, 0.015);
  const off = new Float32Array(tx * ty * 2), scl = new Float32Array(tx * ty * 2);
  const u = {
    uMap: { value: texture }, uOpacity: { value: 0 }, uTime: { value: 0 },
    uOilColorA: { value: v3(P.oilColorA) }, uOilColorB: { value: v3(P.oilColorB) }, uEmissive: { value: 0.7 },
    uHoverNDC: { value: new THREE.Vector2() }, uHoverActive: { value: 0 },
    uHoverRadius: { value: P.glassHoverRadius }, uHoverScale: { value: P.glassHoverScale },
  };
  const mesh = new THREE.InstancedMesh(geo, new THREE.ShaderMaterial({ vertexShader: F.glassVert,
    fragmentShader: F.glassFrag, uniforms: u, transparent: true }), tx * ty);
  const m = new THREE.Matrix4();
  let i = 0;
  for (let y = 0; y < ty; y++) for (let x = 0; x < tx; x++, i++) {
    m.makeTranslation(-W / 2 + tw * (x + 0.5), -H / 2 + th * (y + 0.5), 0);
    mesh.setMatrixAt(i, m);
    off[i * 2] = x / tx; off[i * 2 + 1] = y / ty;
    scl[i * 2] = 1 / tx; scl[i * 2 + 1] = 1 / ty;
  }
  geo.setAttribute("instUvOffset", new THREE.InstancedBufferAttribute(off, 2));
  geo.setAttribute("instUvScale", new THREE.InstancedBufferAttribute(scl, 2));
  const group = new THREE.Group();
  group.add(mesh);
  group.position.set(0, P.glassYBase + P.glassYOffset * 0.5, z);
  mesh.frustumCulled = false;
  return {
    z, mesh: group,
    update(dt, camZ, time, cursor, hoverAct) {
      const d = camZ - z;
      const enter = smooth01((P.glassEnterStart - d) / (P.glassEnterStart - P.glassEnterEnd));
      const exit = smooth01((P.glassExitStart - d) / (P.glassExitStart - P.glassExitEnd));
      group.visible = enter > 0.001 && exit < 0.999;
      group.rotation.y = P.glassInitRotY * (1 - enter) + P.glassExitRotY * exit;
      // portrait screens see less width, so the image wall grows to stay readable
      const s = Math.max(0.0001, enter) * (innerWidth < innerHeight ? PORTRAIT_GLASS_SCALE : 1);
      group.scale.set(s, s, s);
      u.uOpacity.value = Math.min(1, enter * 1.5) * (1 - exit);
      u.uTime.value = time;
      u.uHoverNDC.value.copy(cursor);
      u.uHoverActive.value = hoverAct;
    },
  };
}

// defs: [{ kind: "glyph", glyph, height } | { kind: "glass", texture }]
export function createStations(scene, defs, font, dpr) {
  const list = defs.map((d, i) => {
    if (d.kind === "none") return null;
    const z = P.statFirstZ - i * P.statSpacing;
    const s = d.kind === "glass" ? makeGlassStation(d.texture, z) : makeParticleStation(d.glyph, z, d.height || 1.4, font, dpr);
    scene.add(s.mesh);
    return s;
  }).filter(Boolean);
  const spring = { x: 0, y: 0, vx: 0, vy: 0, init: false };
  const cursor = new THREE.Vector2();
  return {
    list,
    update(dt, camZ, time, ndc, inside, speedF) {
      if (!inside) { spring.init = false; spring.vx = spring.vy = 0; }
      else if (!spring.init) { spring.x = ndc.x; spring.y = ndc.y; spring.init = true; }
      else {
        const k = P.statHoverStiffness, c = P.statHoverDamping, h = Math.min(dt, 0.05);
        spring.vx += ((ndc.x - spring.x) * k - spring.vx * c) * h;
        spring.vy += ((ndc.y - spring.y) * k - spring.vy * c) * h;
        spring.x += spring.vx * h; spring.y += spring.vy * h;
      }
      cursor.set(spring.init ? spring.x : ndc.x, spring.init ? spring.y : ndc.y);
      for (const s of list) s.update(dt, camZ, time, cursor, inside * speedF);
    },
  };
}
