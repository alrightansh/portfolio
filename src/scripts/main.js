// Orchestrates boot, virtual scroll, scene, stations, labels, outro and audio.
import * as THREE from "three";
import { P } from "./config.js";
import { createWorld } from "./scene.js";
import { createStations, dizzyTexture, catTexture } from "./stations.js";
import { createAmbience } from "./audio.js";
import { splitInto, blockInto, show, hide, swapper, makeLabel, makeTicks, magnet, makeResearchHud, REDUCED } from "./ui.js";
import { initTransitions } from "./transition.js";
import { createResearch, RESEARCH_STAGES, EQ_TERMS, stageOf, subOf } from "./research.js";
import { createEnergy, ENERGY_STAGES, energyStageOf } from "./energy.js";
import { createHimachal, HIMACHAL_STAGES, himachalStageOf, himachalSubOf } from "./himachal.js";
import { STATIONS, OUTRO } from "./content.js";

const FONT = "'Overused Grotesk', system-ui, sans-serif";
const INTRO_MS = 3500;
const CAM0 = 5.5;
const START_HINT = matchMedia("(pointer: coarse)").matches ? "Swipe to dive in" : "Scroll to dive in";

const $ = (id) => document.getElementById(id);
const canvas = $("scene");
const world = createWorld(canvas);
const audio = createAmbience();

// ---------------- stations ----------------
const loader = new THREE.TextureLoader();
const tex = (url) => loader.load(url);
const isMapStop = (s) => Boolean(s.research || s.energy || s.himachal); // pinned stops with their own HUD
const defs = STATIONS.map((s) => isMapStop(s) ? { kind: "none" } : s.glass
  ? { kind: "glass", texture: s.glass === "dizzy" ? dizzyTexture() : tex(s.glass) }
  : { kind: "glyph", glyph: s.glyph, height: s.glyphHeight });
let stations = null;
const stops = []; // map stops once loaded: { stop, hud }

const cat = new THREE.Mesh(new THREE.PlaneGeometry(0.28, 0.28),
  new THREE.MeshBasicMaterial({ map: catTexture(), transparent: true, side: THREE.DoubleSide, opacity: 0 }));
const dizzyIndex = STATIONS.findIndex((s) => s.glass === "dizzy");
const dizzyZ = P.statFirstZ - dizzyIndex * P.statSpacing;
cat.position.set(0.78, 1.2, dizzyZ);
world.scene.add(cat);

// ---------------- labels / chrome ----------------
const labelHost = $("labels");
const labels = STATIONS.map((s) => isMapStop(s) ? { set: () => false } : makeLabel(labelHost, s));
const stationZ = STATIONS.map((_, i) => P.statFirstZ - i * P.statSpacing);

// Scroll px -> flight distance. The camera slows to a crawl while a map stop is pinned, so its
// stages get room to play out. Each pin covers flight distance da..db and scroll sa..sb.
const RS_Z = stationZ[STATIONS.findIndex((s) => s.research)];
const EN_Z = stationZ[STATIONS.findIndex((s) => s.energy)];
const HP_Z = stationZ[STATIONS.findIndex((s) => s.himachal)];
// A map stop that fails to load loses its pin, so the flight never crawls through empty space.
const K = P.scrollSpeed;
const lost = new Set(); // station indices of map stops that failed to load
let PINS = [];
function buildPins() {
  PINS = [];
  STATIONS.forEach((s, i) => {
    if (!isMapStop(s) || lost.has(i)) return;
    const prev = PINS[PINS.length - 1] || { db: 0, sb: 0 };
    const da = CAM0 - (stationZ[i] + P.researchView), sa = prev.sb + (da - prev.db) / K;
    PINS.push({ da, db: da + P.researchPin, sa, sb: sa + P.researchPin / (K * P.researchDwell) });
  });
}
buildPins();
function distFor(s) {
  let prev = { db: 0, sb: 0 };
  for (const p of PINS) {
    if (s <= p.sa) break;
    if (s <= p.sb) return p.da + (s - p.sa) * K * P.researchDwell;
    prev = p;
  }
  return prev.db + (s - prev.sb) * K;
}
function scrollFor(d) {
  let prev = { db: 0, sb: 0 };
  for (const p of PINS) {
    if (d <= p.da) break;
    if (d <= p.db) return p.sa + (d - p.da) / (K * P.researchDwell);
    prev = p;
  }
  return prev.sb + (d - prev.db) / K;
}
let MAX_SCROLL = scrollFor(-(P.outroButtonZ - 12));

const leftHint = swapper($("hint"));
const audioLabel = swapper($("audioLabel"));
// Fly to a station: the ticks, and deep links such as /#neugal from the work pages.
function flyTo(i) {
  target = Math.max(0, Math.min(MAX_SCROLL, scrollFor(CAM0 - (stationZ[i] + 3.3))));
}
function flyToHash() {
  const i = STATIONS.findIndex((s) => s.id && s.id === decodeURIComponent(location.hash.slice(1)));
  if (i >= 0) flyTo(i);
}
addEventListener("hashchange", () => { if (introDone) flyToHash(); });
const ticks = makeTicks($("ticks"), STATIONS.length, flyTo, STATIONS.map((s) => `Fly to ${s.title}`));
const huds = {
  research: makeResearchHud($("research"), RESEARCH_STAGES, EQ_TERMS, stageOf, subOf),
  energy: makeResearchHud($("energy"), ENERGY_STAGES, [], energyStageOf, () => -1),
  himachal: makeResearchHud($("himachal"), HIMACHAL_STAGES, [], himachalStageOf, himachalSubOf),
};

// hero
const heroA = $("heroA"), heroB = $("heroB"), heroP = $("heroP");
const heroChars = [splitInto(heroA, heroA.dataset.text, 30), splitInto(heroB, heroB.dataset.text, 30, 120),
  blockInto(heroP, heroP.dataset.text, 300)];

// outro
const outroLabel = $("outroLabel"), outroBtn = $("outroBtn"), outroWork = $("outroWork");
const btnMagnet = magnet(outroBtn, P.magnetRadius, P.magnetStrength);
const outro = { phase: 0, enteredAt: 0, ready: false, chars: [], prevZ: CAM0 };
function outroText(phase) {
  hide(outro.chars);
  const t = phase === 1 ? OUTRO.phase1 : OUTRO.phase2;
  setTimeout(() => {
    if (outro.phase !== phase) return;
    audio.whoosh();
    outro.chars = splitInto(outroLabel, t, 35);
    show(outro.chars);
    if (phase === 2) setTimeout(() => { if (outro.phase === 2) outro.ready = true; }, 250 + 35 * t.length);
  }, outro.chars.length ? 35 * outro.chars.length + 350 : 0);
}
function updateOutro(camZ, now, dt) {
  let next = outro.phase;
  if (camZ > P.outroPhase1Z) next = 0;
  else if (outro.phase === 0 && camZ < outro.prevZ - 0.001) next = 1;
  else if (outro.phase === 1 && now - outro.enteredAt >= P.outroHoldMs) next = 2;
  outro.prevZ = camZ;
  if (next !== outro.phase) {
    outro.phase = next;
    outro.ready = false;
    if (next === 1) outro.enteredAt = now;
    if (next === 0) { hide(outro.chars); outro.chars = []; } else outroText(next);
  }
  const vis = outro.phase === 2 && outro.ready;
  outroBtn.style.opacity = vis ? "1" : "0";
  outroBtn.style.pointerEvents = vis ? "auto" : "none";
  outroWork.style.opacity = vis ? "1" : "0";
  outroWork.style.pointerEvents = vis ? "auto" : "none";
  btnMagnet(dt, pointer, vis);
}

// ---------------- input: virtual scroll ----------------
let target = 0, smooth = 0, booted = false, introDone = false;
const pointer = { x: 0, y: 0, has: false };
addEventListener("wheel", (e) => {
  if (!booted) return;
  e.preventDefault();
  const k = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? innerHeight : 1;
  target = Math.max(0, Math.min(MAX_SCROLL, target + e.deltaY * k));
}, { passive: false });
// Touch: a swipe moves the flight and keeps gliding after release (fling with friction).
const TOUCH_GAIN = 3.2, FLING_FRICTION = 3.2, FLING_MAX = 9000;
let drag = false, dragY = 0, downX = 0, downY = 0, dragT = 0, fling = 0;
addEventListener("pointerdown", (e) => {
  if (e.button === 0 || e.pointerType === "touch") {
    drag = true; dragY = e.clientY; downX = e.clientX; downY = e.clientY; dragT = performance.now(); fling = 0;
  }
});
addEventListener("pointermove", (e) => {
  pointer.x = e.clientX; pointer.y = e.clientY; pointer.has = true;
  const { nx, ny } = world.pointer(e);
  if (e.pointerType !== "touch") { orbit.yawT = 0.18 * nx; orbit.pitchT = -0.08 * ny; orbit.active = true; }
  if (drag && booted) {
    const gain = e.pointerType === "touch" ? TOUCH_GAIN : 1;
    const d = (dragY - e.clientY) * gain, now = performance.now();
    const v = d / Math.max(1, now - dragT) * 1000;
    fling = fling * 0.6 + v * 0.4; // smoothed px/s for the release
    dragY = e.clientY; dragT = now;
    target = Math.max(0, Math.min(MAX_SCROLL, target + d));
  }
});
addEventListener("pointerup", (e) => {
  drag = false;
  if (e.pointerType !== "touch" || performance.now() - dragT > 80) fling = 0;
  fling = Math.max(-FLING_MAX, Math.min(FLING_MAX, fling));
  if (booted && Math.hypot(e.clientX - downX, e.clientY - downY) < 6 && e.target === canvas) world.click();
});
addEventListener("pointercancel", () => { drag = false; fling = 0; });
document.addEventListener("pointerleave", () => { world.leave(); orbit.active = false; orbit.yawT = orbit.pitchT = 0; });
addEventListener("keydown", (e) => {
  if (!booted) return;
  const step = { ArrowDown: 160, PageDown: innerHeight, " ": innerHeight, ArrowUp: -160, PageUp: -innerHeight }[e.key];
  if (step) target = Math.max(0, Math.min(MAX_SCROLL, target + step));
});

$("audioBtn").addEventListener("click", () => {
  const on = audio.toggle();
  audioLabel(on ? "Audio on" : "Audio off");
  $("eq").classList.toggle("on", on);
});

// ---------------- frame loop ----------------
const orbit = { pitch: 0, yaw: 0, pitchT: 0, yawT: 0, active: false };
const vel = { last: 0, base: 0, fx: 0, kick: 0 };
const CALM_RATE = 3; // per second, how fast the ambient field dims and returns around a map stop
let introStart = -1, last = performance.now(), hintState = "", calm = 0;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  const il = introStart < 0 ? 0 : Math.min((now - introStart) / INTRO_MS, 1);
  const intro = { linear: il, eased: 1 - Math.pow(1 - il, 3) };

  if (!drag && Math.abs(fling) > 5) {
    target = Math.max(0, Math.min(MAX_SCROLL, target + fling * dt));
    fling *= Math.exp(-FLING_FRICTION * dt);
  }
  smooth += (target - smooth) * 0.08;
  const w = -distFor(smooth);
  const travelled = -w / K;
  let x = Math.abs(travelled - vel.last);
  vel.last = travelled;
  vel.base += (x - vel.base) * 0.04;
  // reduced motion: no camera roll or zoom kick on fast scrolls
  const c = REDUCED ? 0 : 1 - Math.exp(-(0.18 * Math.max(0, x - vel.base)));
  vel.fx += (c - vel.fx) * (c > vel.fx ? 0.09 : 0.04);
  const rate = orbit.active ? 0.05 : 0.02;
  orbit.pitch += (orbit.pitchT - orbit.pitch) * rate;
  orbit.yaw += (orbit.yawT - orbit.yaw) * rate;

  const { camZ, tunnel, time } = world.update(dt, { w, orbitPitch: orbit.pitch, orbitYaw: orbit.yaw, velFx: vel.fx, calm }, intro);
  if (stations) stations.update(dt, camZ, time, world.pointerNDC, world.presence, world.speedFactor);
  let pinned = false;
  for (const { stop, hud } of stops) {
    const q = stop.update(dt, camZ, time, world.camera);
    const on = introDone && camZ <= stop.pinStart + 1.2 && camZ >= stop.pinEnd - 0.5;
    if (on) pinned = true;
    hud.update(on, q, dt, stop.live ? stop.live() : 0);
    hud.place(stop.overlay(world.camera));
  }
  calm += ((pinned ? 1 : 0) - calm) * Math.min(1, dt * CALM_RATE); // read by the next frame's world.update

  // cat orbits the MakeMeDizzy wall
  const catK = Math.max(0, 1 - Math.abs(camZ - dizzyZ - 2.5) / 3.2);
  cat.material.opacity = catK;
  cat.visible = catK > 0.01;
  cat.rotation.y = time * 2.2;
  cat.position.y = 1.2 + Math.sin(time * 1.3) * 0.05;

  // hero drifts apart as the flight begins
  const hk = Math.min(1, smooth / 700);
  heroA.style.transform = `translateX(${(smooth * 0.9).toFixed(1)}px)`;
  heroB.style.transform = `translateX(${(-smooth * 0.9).toFixed(1)}px)`;
  document.body.style.setProperty("--hero-fade", String(1 - hk));

  // labels
  let fIndex = 0;
  stationZ.forEach((z, i) => {
    const d = camZ - z;
    const vis = introDone && d <= P.statLabelAppearOffset && d > P.statLabelDisappearOffset;
    if (labels[i].set(vis)) audio.whoosh();
  });
  if (camZ >= stationZ[0]) fIndex = 0;
  else if (camZ <= stationZ[stationZ.length - 1]) fIndex = stationZ.length - 1;
  else for (let i = 0; i < stationZ.length - 1; i++) {
    if (camZ <= stationZ[i] && camZ >= stationZ[i + 1]) { fIndex = i + (stationZ[i] - camZ) / P.statSpacing; break; }
  }
  ticks.update(fIndex, introDone && tunnel < 0.02, now);

  const hint = camZ > 2.5 ? START_HINT : camZ > stationZ[6] - 3 ? "Keep going" : "Almost there";
  if (introDone && hint !== hintState) { hintState = hint; leftHint(hint); }
  updateOutro(camZ, now, dt);

  world.render();
  requestAnimationFrame(frame);
}

function resize() { world.resize(); }
addEventListener("resize", resize);
resize();

// ---------------- boot ----------------
// A map stop that failed to load: drop its pin and keep the camera where it is.
function dropPin(key) {
  const at = distFor(smooth), to = distFor(target);
  lost.add(STATIONS.findIndex((s) => s[key]));
  buildPins();
  MAX_SCROLL = scrollFor(-(P.outroButtonZ - 12));
  smooth = scrollFor(at);
  target = Math.min(MAX_SCROLL, scrollFor(to));
}
const pct = $("loaderPct"), bar = $("loaderBar");
async function boot() {
  const t0 = performance.now();
  let ready = false;
  (async () => {
    try { await document.fonts.load(`500 220px ${FONT}`); await document.fonts.load(`400 18px ${FONT}`); } catch { /* fallback font */ }
    stations = createStations(world.scene, defs, FONT, world.dpr);
    const load = async (key, create, z) => {
      try { stops.push({ stop: await create(world.scene, world.dpr, z), hud: huds[key] }); }
      catch (err) { console.error(`${key} stop unavailable`, err); dropPin(key); }
    };
    await load("research", createResearch, RS_Z);
    ready = true;
    // later in the flight, so it loads after the page is up
    await load("energy", createEnergy, EN_Z);
    await load("himachal", createHimachal, HP_Z);
  })();
  requestAnimationFrame(frame);
  await new Promise((done) => {
    const tick = (now) => {
      const raw = Math.min(1, (now - t0) / 2200);
      const stut = raw < 0.55 ? raw : 0.55 + (raw - 0.55) * (0.35 + 0.65 * Math.abs(Math.sin(raw * 8)));
      const v = Math.round((ready ? Math.min(1, stut) : Math.min(0.92, stut)) * 100);
      pct.textContent = `${raw >= 1 && ready ? 100 : v}%`;
      bar.style.transform = `scaleX(${(raw >= 1 && ready ? 100 : v) / 100})`;
      if (raw >= 1 && ready) done(); else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  $("loader").classList.add("done");
  introStart = performance.now();
  booted = true;
  heroChars.forEach(show);
  leftHint(START_HINT); hintState = START_HINT;
  audioLabel("Audio off");
  document.querySelectorAll("[data-reveal]").forEach((el) => show(splitInto(el, el.dataset.reveal)));
  setTimeout(() => { introDone = true; document.body.classList.add("intro-done"); flyToHash(); }, INTRO_MS * 0.6);
}
// links to the work pages leave with the loader's accent bar; the loader itself covers the arrival
initTransitions({ arrive: false });
boot();
