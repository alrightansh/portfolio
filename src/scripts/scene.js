// Terrain world: surface, contour wire, particle field, dust, oil trail, caustics, post.
import * as THREE from "three";
import { P, rgb } from "./config.js";
import * as T from "./glsl-terrain.js";
import * as F from "./glsl-fx.js";
import { createTunnel } from "./tunnel.js";

const v3 = (hex) => new THREE.Vector3(...rgb(hex));
const lightDir = (angle, elev) => {
  const a = (angle * Math.PI) / 180, s = (elev * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a) * Math.cos(s), Math.sin(s), Math.cos(a) * Math.cos(s));
};
const OIL_SIZE = 256;
const OIL_W = 16, OIL_D = 16;
// share of the particle field and the dust that fades out while a map stop is pinned
const CALM_PARTICLES = 0.6, CALM_DUST = 0.75;

export function createWorld(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  renderer.setPixelRatio(dpr);
  renderer.setClearColor(0x000000, 1);
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 80);
  const CAM_BASE = new THREE.Vector3(0, 1.2, 5.5);
  const LOOK = new THREE.Vector3(0, 0.1, 0);

  const plane = new THREE.PlaneGeometry(60, 60, 340, 340);
  plane.rotateX(-Math.PI / 2);

  const U = {
    uNoiseScale: { value: P.noiseScale }, uDisplacement: { value: P.displacement },
    uBaseColor: { value: v3(P.baseColor) }, uPeakColor: { value: v3(P.peakColor) },
    uFogColor: { value: v3(P.fogColor) }, uFogInner: { value: P.fogInner }, uFogOuter: { value: P.fogOuter },
    uSurfaceDarken: { value: 0 }, uFocusX: { value: P.focusX }, uFocusZ: { value: P.focusZ },
    uTime: { value: 0 }, uWaveSpeed: { value: P.waveSpeed }, uWaveAmplitude: { value: P.waveAmplitude },
    uWaveLength: { value: P.waveLength }, uWaveFalloff: { value: P.waveFalloff }, uPulseWidth: { value: P.pulseWidth },
    uClicks: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(0, 0, -1)) },
    uHoverX: { value: 0 }, uHoverZ: { value: 0 }, uHoverActive: { value: 0 },
    uHoverRadius: { value: P.hoverRadius }, uHoverStrength: { value: P.hoverStrength },
    uBaseAmplitude: { value: P.baseAmplitude }, uBaseSpeed: { value: P.baseSpeed },
    uBaseWavelength: { value: P.baseWavelength }, uIntro: { value: 0 }, uIntroLinear: { value: 0 },
    uCorridorWidth: { value: P.corridorWidth }, uCorridorHeight: { value: P.corridorHeight },
    uCorridorSharpness: { value: P.corridorSharpness },
  };
  const disp = {};
  for (const k of ["uNoiseScale", "uDisplacement", "uTime", "uFocusX", "uFocusZ", "uWaveSpeed", "uWaveAmplitude",
    "uWaveLength", "uWaveFalloff", "uPulseWidth", "uBaseAmplitude", "uBaseSpeed", "uBaseWavelength", "uClicks",
    "uHoverX", "uHoverZ", "uHoverActive", "uHoverRadius", "uHoverStrength", "uIntro", "uIntroLinear",
    "uCorridorWidth", "uCorridorHeight", "uCorridorSharpness"]) disp[k] = U[k];

  // ---- render targets: caustic ridge bake + oil trail ping-pong ----
  const causticRT = new THREE.WebGLRenderTarget(256, 256, { type: THREE.HalfFloatType });
  const rtOpts = { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false };
  let oilA = new THREE.WebGLRenderTarget(OIL_SIZE, OIL_SIZE, rtOpts);
  let oilB = new THREE.WebGLRenderTarget(OIL_SIZE, OIL_SIZE, rtOpts);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadScene = new THREE.Scene();
  const quad = new THREE.Mesh(quadGeo);
  quad.frustumCulled = false;
  quadScene.add(quad);

  const causticMat = new THREE.ShaderMaterial({
    vertexShader: F.quadVert, fragmentShader: F.causticBakeFrag,
    uniforms: { uTime: U.uTime, uCausticsScale: { value: P.causticsScale }, uCausticsSpeed: { value: P.causticsSpeed },
      uCausticsContrast: { value: P.causticsContrast }, uCausticsWorldMin: { value: new THREE.Vector2() },
      uCausticsWorldMax: { value: new THREE.Vector2() } },
  });
  const oilMat = new THREE.ShaderMaterial({
    vertexShader: F.quadVert, fragmentShader: F.oilSimFrag,
    uniforms: { uPrevTex: { value: null }, uTexel: { value: new THREE.Vector2(1 / OIL_SIZE, 1 / OIL_SIZE) },
      uShift: { value: new THREE.Vector2() }, uDecay: { value: P.oilDecay }, uBlur: { value: P.oilBlur },
      uSplatActive: { value: 0 }, uSplatPos: { value: new THREE.Vector2() }, uSplatPosPrev: { value: new THREE.Vector2() },
      uSplatRadius: { value: P.oilSplatRadius }, uSplatStrength: { value: P.oilSplatStrength },
      uWorldMin: { value: new THREE.Vector2() }, uWorldMax: { value: new THREE.Vector2() },
      uEdgeDarken: { value: P.oilEdgeDarken }, uWaterSpread: { value: P.oilWaterSpread },
      uPigmentDiff: { value: P.oilPigmentDiff } },
  });

  // ---- background, surface, contour wire ----
  const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
    vertexShader: F.bgVert, fragmentShader: F.bgFrag, depthTest: false, depthWrite: false,
    uniforms: { uFogColor: U.uFogColor, uSurfaceDarken: U.uSurfaceDarken } }));
  bg.frustumCulled = false; bg.renderOrder = -100;
  scene.add(bg);

  const surfaceMat = new THREE.ShaderMaterial({
    vertexShader: T.surfaceVert, fragmentShader: T.surfaceFrag, transparent: true,
    uniforms: { ...disp, uBaseColor: U.uBaseColor, uPeakColor: U.uPeakColor, uFogColor: U.uFogColor,
      uSurfaceDarken: U.uSurfaceDarken, uFogInner: U.uFogInner, uFogOuter: U.uFogOuter,
      uLightDir: { value: lightDir(P.lightAngle, P.lightElevation) }, uLightColor: { value: v3(P.lightColor) },
      uBumpiness: { value: P.bumpiness }, uSpecularStrength: { value: P.specularStrength },
      uSpecularSharpness: { value: P.specularSharpness },
      uOilTex: { value: oilA.texture }, uOilWorldMin: { value: new THREE.Vector2() }, uOilWorldMax: { value: new THREE.Vector2() },
      uOilTexThreshold: { value: P.oilTexThreshold }, uBumpNoiseScale: { value: P.bumpNoiseScale },
      uBumpNoiseStrength: { value: P.bumpNoiseStrength }, uCausticsColor: { value: v3(P.causticsColor) },
      uCausticsIntensity: { value: P.causticsIntensity }, uCausticsScale: causticMat.uniforms.uCausticsScale,
      uCausticsSpeed: causticMat.uniforms.uCausticsSpeed, uCausticsContrast: causticMat.uniforms.uCausticsContrast,
      uCausticsDistort: { value: P.causticsDistort }, uCausticsTex: { value: causticRT.texture },
      uCausticsWorldMin: causticMat.uniforms.uCausticsWorldMin, uCausticsWorldMax: causticMat.uniforms.uCausticsWorldMax,
      uVolumeDensity: { value: P.volumeDensity }, uVolumeYFalloff: { value: P.volumeYFalloff },
      uVolumeMaxDist: { value: P.volumeMaxDist }, uVolumeSteps: { value: P.volumeSteps },
      uVolumeSharpness: { value: P.volumeSharpness }, uVolumeFocusBias: { value: P.volumeFocusBias },
      uRippleColor: { value: v3(P.rippleColor) }, uRippleIntensity: { value: P.rippleIntensity },
      uRippleSpeed: { value: P.rippleSpeed }, uRippleSoftness: { value: P.rippleSoftness },
      uRippleLife: { value: P.rippleLife }, uRippleNoiseScale: { value: P.rippleNoiseScale },
      uRippleNoiseStrength: { value: P.rippleNoiseStrength }, uOilIntensity: { value: P.oilIntensity },
      uOilRingStrength: { value: P.oilRingStrength }, uOilRingWidth: { value: P.oilRingWidth },
      uOilRingBlur: { value: P.oilRingBlur }, uOilNoiseScale: { value: P.oilNoiseScale },
      uOilSpeed: { value: P.oilSpeed }, uOilColorA: { value: v3(P.oilColorA) }, uOilColorB: { value: v3(P.oilColorB) } },
  });
  const surface = new THREE.Mesh(plane, surfaceMat);
  surface.frustumCulled = false;
  scene.add(surface);

  const wireMat = new THREE.ShaderMaterial({
    vertexShader: T.wireVert, fragmentShader: T.wireFrag, transparent: true, depthWrite: false,
    side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    uniforms: { ...disp, uFogInner: U.uFogInner, uFogOuter: U.uFogOuter, uSurfaceDarken: U.uSurfaceDarken,
      uWireColor: { value: v3(P.wireColor) }, uWireThickness: { value: P.wireThickness },
      uWireOpacity: { value: P.wireOpacity }, uGlowSpread: { value: P.glowSpread },
      uGlowStrength: { value: P.glowStrength }, uContourSpacing: { value: P.contourSpacing },
      uRevealRadius: { value: P.revealRadius }, uRevealBlur: { value: P.revealBlur },
      uRevealNoiseScale: { value: P.revealNoiseScale }, uRevealNoiseStrength: { value: P.revealNoiseStrength },
      uWireAmbient: { value: P.wireAmbient } },
  });
  const wire = new THREE.Mesh(plane, wireMat);
  wire.frustumCulled = false;
  scene.add(wire);

  // ---- particle field (plane vertices), second pass only in the tunnel ----
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute("position", plane.getAttribute("position"));
  const count = plane.getAttribute("position").count;
  const rnd = new Float32Array(count);
  for (let i = 0; i < count; i++) rnd[i] = Math.random();
  pGeo.setAttribute("aRandom", new THREE.BufferAttribute(rnd, 1));
  const pU = {
    ...disp, uFogInner: U.uFogInner, uFogOuter: U.uFogOuter,
    uParticleLift: { value: P.particleLift }, uParticleSize: { value: P.particleSize },
    uParticleSizeJitter: { value: P.particleSizeJitter }, uParticleXZJitter: { value: P.particleXZJitter },
    uParticleYJitter: { value: P.particleYJitter }, uPWaveBoost: { value: P.pWaveBoost },
    uPWaveSpeed: { value: P.pWaveSpeed }, uPWavePeriod: { value: P.pWavePeriod }, uPWaveWidth: { value: P.pWaveWidth },
    uCameraZ: { value: 0 }, uParticleZRange: { value: 60 }, uTunnelProgress: { value: 0 },
    uTunnelRadius: { value: P.tunnelRadius }, uTunnelCenterX: { value: 0 }, uTunnelCenterY: { value: 0 },
    uTunnelScatter: { value: P.tunnelScatter }, uTunnelSpiralTurns: { value: P.tunnelSpiralTurns },
    uTunnelSpiralPitch: { value: P.tunnelSpiralPitch }, uTunnelRotSpeed: { value: P.tunnelRotSpeed },
    uTunnelWiggle: { value: P.tunnelWiggle }, uTunnelPulseSpeed: { value: P.tunnelPulseSpeed },
    uTunnelPulseWidth: { value: P.tunnelPulseWidth }, uTunnelPulseBoost: { value: P.tunnelPulseBoost },
    uTunnelPulsePeriod: { value: P.tunnelPulsePeriod }, uTunnelBreathAmp: { value: P.tunnelBreathAmp },
    uTunnelBreathSpeed: { value: P.tunnelBreathSpeed }, uCursorNDC: { value: new THREE.Vector2() },
    uHoverNActive: { value: 0 }, uHoverNRadius: { value: P.statHoverRadius }, uHoverNScale: { value: P.statHoverScale },
    uHoverNRepel: { value: P.statHoverRepel }, uPixelRatio: { value: dpr },
    uParticleColor: { value: v3(P.particleColor) }, uParticleColorFar: { value: v3(P.tunnelColorFar) },
    uParticleGradStart: { value: P.tunnelGradStart }, uParticleGradEnd: { value: P.tunnelGradEnd },
    uPLightDir: { value: new THREE.Vector3(...P.pLight) }, uPAmbient: { value: P.pAmbient },
    uPDiffuse: { value: P.pDiffuse }, uPSpec: { value: P.pSpec }, uPSpecPower: { value: P.pSpecPower },
    uParticleHoverColor: { value: v3(P.particleHoverColor) }, uParticleHoverStrength: { value: P.particleHoverStrength },
  };
  const makePass = (i) => {
    const m = new THREE.ShaderMaterial({ vertexShader: T.particleVert, fragmentShader: T.particleFrag,
      transparent: true, depthWrite: false,
      uniforms: { ...pU, uPassIndex: { value: i }, uParticleOpacity: { value: P.particleOpacity } } });
    const pts = new THREE.Points(pGeo, m);
    pts.frustumCulled = false;
    scene.add(pts);
    return pts;
  };
  const particles = makePass(0);
  const particles2 = makePass(1);
  particles2.visible = false;

  // ---- dust ----
  const dGeo = new THREE.BufferGeometry();
  const dPos = new Float32Array(P.dustCount * 3), dSeed = new Float32Array(P.dustCount), dPhase = new Float32Array(P.dustCount);
  for (let i = 0; i < P.dustCount; i++) {
    const r = Math.sqrt(Math.random()) * P.dustSpawnRadius, a = Math.random() * Math.PI * 2;
    dPos[i * 3] = Math.cos(a) * r; dPos[i * 3 + 2] = Math.sin(a) * r;
    dSeed[i] = Math.random(); dPhase[i] = Math.random();
  }
  dGeo.setAttribute("position", new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute("aSeed", new THREE.BufferAttribute(dSeed, 1));
  dGeo.setAttribute("aPhase", new THREE.BufferAttribute(dPhase, 1));
  const dustMat = new THREE.ShaderMaterial({ vertexShader: T.dustVert, fragmentShader: T.dustFrag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { ...disp, uFogInner: U.uFogInner, uFogOuter: U.uFogOuter, uDustSpeed: { value: P.dustSpeed },
      uDustRise: { value: P.dustRise }, uDustSize: { value: P.dustSize }, uDustSizeJitter: { value: P.dustSizeJitter },
      uDustWander: { value: P.dustWander }, uCameraZ: pU.uCameraZ, uDustZRange: { value: 44 },
      uTunnelProgress: pU.uTunnelProgress, uDustForwardSpeed: { value: P.dustForwardSpeed },
      uTunnelCenterY: pU.uTunnelCenterY, uDustTunnelYSpread: { value: P.dustTunnelYSpread },
      uPixelRatio: { value: dpr }, uDustColor: { value: v3(P.dustColor) }, uDustOpacity: { value: P.dustOpacity } } });
  const dust = new THREE.Points(dGeo, dustMat);
  dust.frustumCulled = false;
  scene.add(dust);

  const tunnel = createTunnel(scene, U.uTime);

  // ---- post (chromatic aberration + lens) ----
  const sceneRT = new THREE.WebGLRenderTarget(1, 1, { samples: 4, type: THREE.HalfFloatType });
  const postMat = new THREE.ShaderMaterial({ vertexShader: F.quadVert, fragmentShader: F.postFrag,
    uniforms: { tDiffuse: { value: sceneRT.texture }, uCA: { value: P.postCA }, uLens: { value: P.postLens } } });

  // ---- pointer state ----
  const ray = new THREE.Raycaster();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();
  const ptr = { ndc: new THREE.Vector2(), inside: 0, world: null, speed: 0, lastX: 0, lastY: 0, lastT: 0, has: false };
  const hover = { x: 0, z: 0, presence: 0, speedF: 0, activity: 0 };
  const splat = { x: 0, z: 0, px: 0, pz: 0, init: false };
  let clickSlot = 0;

  function pointerWorld() {
    ray.setFromCamera(ptr.ndc, camera);
    return ray.ray.intersectPlane(ground, hit) ? { x: hit.x, z: hit.z } : null;
  }

  return {
    renderer, camera, scene, tunnel, dpr,
    pointer(e) {
      const nx = (e.clientX / innerWidth) * 2 - 1, ny = (e.clientY / innerHeight) * 2 - 1;
      ptr.ndc.set(nx, -ny);
      ptr.inside = 1;
      const t = performance.now() / 1000;
      if (ptr.has) {
        const v = Math.hypot(e.clientX - ptr.lastX, e.clientY - ptr.lastY) / Math.max(t - ptr.lastT, 1 / 240);
        ptr.speed = 0.55 * ptr.speed + 0.45 * v;
      }
      ptr.lastX = e.clientX; ptr.lastY = e.clientY; ptr.lastT = t; ptr.has = true;
      return { nx, ny };
    },
    leave() { ptr.inside = 0; ptr.has = false; },
    click() {
      const w = pointerWorld();
      if (!w) return;
      U.uClicks.value[clickSlot].set(w.x, w.z, U.uTime.value);
      clickSlot = (clickSlot + 1) % 4;
    },
    pointerNDC: ptr.ndc,
    get speedFactor() { return hover.speedF; },
    get presence() { return ptr.inside; },

    // cam: { w, orbitPitch, orbitYaw, velFx, calm }, intro: { eased, linear }; calm 0..1 while a map stop is pinned
    update(dt, cam, intro) {
      U.uTime.value += dt;
      const time = U.uTime.value;
      U.uIntro.value = intro.eased;
      U.uIntroLinear.value = intro.linear;

      // camera orbit + intro drop + scroll flight + velocity roll / zoom
      const dist = CAM_BASE.distanceTo(LOOK);
      const pitch = Math.asin((CAM_BASE.y - LOOK.y) / dist) + cam.orbitPitch;
      const yaw = Math.atan2(CAM_BASE.x - LOOK.x, CAM_BASE.z - LOOK.z) + cam.orbitYaw;
      camera.position.set(LOOK.x + Math.sin(yaw) * Math.cos(pitch) * dist, LOOK.y + Math.sin(pitch) * dist,
        LOOK.z + Math.cos(yaw) * Math.cos(pitch) * dist);
      camera.position.y += (1 - intro.eased) * 8;
      camera.position.z += cam.w;
      camera.lookAt(LOOK.x, LOOK.y, LOOK.z + cam.w);
      camera.rotation.x += cam.velFx * P.scrollRotateX;
      camera.rotation.y += cam.velFx * P.scrollRotateY;
      camera.rotation.z += cam.velFx * P.scrollRotateZ;
      const baseFov = innerWidth <= 768 ? 75 : 52;
      camera.fov = Math.max(15, Math.min(baseFov + cam.velFx * P.scrollZoom, 110));
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      U.uFocusZ.value = P.focusZ + cam.w;
      surface.position.z = cam.w;
      wire.position.z = cam.w;
      const camZ = camera.position.z;
      pU.uCameraZ.value = camZ;

      // hover: eased world point, presence, cursor-speed factor
      ptr.speed *= Math.exp(-4 * dt);
      const n = Math.min(1, ptr.speed / 450), s = n * n * (3 - 2 * n);
      hover.speedF += (s - hover.speedF) * (s > hover.speedF ? 0.22 : 0.08);
      const w = ptr.inside ? pointerWorld() : null;
      if (w) { hover.x = w.x; hover.z = w.z; }
      U.uHoverX.value += (hover.x - U.uHoverX.value) * P.hoverEasing;
      U.uHoverZ.value += (hover.z - U.uHoverZ.value) * P.hoverEasing;
      hover.presence += (ptr.inside - hover.presence) * P.hoverEasing;
      U.uHoverActive.value = hover.presence;

      // tunnel progress from camera depth
      const r = Math.max(0, Math.min(1, (camZ - P.tunnelStartZ) / (P.tunnelEndZ - P.tunnelStartZ)));
      const tp = r * r * (3 - 2 * r);
      pU.uTunnelProgress.value = tp;
      pU.uTunnelCenterX.value = camera.position.x;
      pU.uTunnelCenterY.value = camera.position.y;
      particles2.material.uniforms.uParticleOpacity.value = P.particleOpacity * tp;
      particles2.visible = tp > 0.001;
      // the ambient field steps back behind a map stop, so the map and its text are not read through moving dots
      particles.material.uniforms.uParticleOpacity.value = P.particleOpacity * (1 - CALM_PARTICLES * cam.calm);
      dustMat.uniforms.uDustOpacity.value = P.dustOpacity * (1 - CALM_DUST * cam.calm);
      pU.uPWaveBoost.value = P.pWaveBoost * (1 - cam.calm);
      U.uSurfaceDarken.value = tp;
      if (tp > 0.05) U.uHoverActive.value = 0;
      pU.uCursorNDC.value.copy(ptr.ndc);
      pU.uHoverNActive.value = ptr.inside * hover.speedF;
      tunnel.update(dt, camera, tp, ptr.ndc, ptr.inside * hover.speedF);

      // oil trail: splat follows the cursor with lag while it moves
      const target = w || (splat.init ? { x: splat.x, z: splat.z } : null);
      const actTarget = ptr.inside && w && hover.speedF > 0.3 ? 1 : 0;
      hover.activity += (actTarget - hover.activity) * (actTarget > hover.activity ? 0.05 : 0.025);
      if (target) {
        if (!splat.init) { splat.x = splat.px = target.x; splat.z = splat.pz = target.z; splat.init = true; }
        splat.px = splat.x; splat.pz = splat.z;
        splat.x += (target.x - splat.x) * P.oilSplatLag;
        splat.z += (target.z - splat.z) * P.oilSplatLag;
      }
      const minX = -OIL_W / 2, minZ = camZ - OIL_D + 2;
      const prevMin = oilMat.uniforms.uWorldMin.value.clone();
      oilMat.uniforms.uWorldMin.value.set(minX, minZ);
      oilMat.uniforms.uWorldMax.value.set(minX + OIL_W, minZ + OIL_D);
      oilMat.uniforms.uShift.value.set(0, prevMin.y === 0 && prevMin.x === 0 ? 0 : (minZ - prevMin.y) / OIL_D);
      oilMat.uniforms.uSplatActive.value = splat.init ? hover.activity : 0;
      oilMat.uniforms.uSplatPos.value.set(splat.x, splat.z);
      oilMat.uniforms.uSplatPosPrev.value.set(splat.px, splat.pz);
      oilMat.uniforms.uPrevTex.value = oilA.texture;
      quad.material = oilMat;
      renderer.setRenderTarget(oilB);
      renderer.render(quadScene, quadCam);
      [oilA, oilB] = [oilB, oilA];
      surfaceMat.uniforms.uOilTex.value = oilA.texture;
      surfaceMat.uniforms.uOilWorldMin.value.copy(oilMat.uniforms.uWorldMin.value);
      surfaceMat.uniforms.uOilWorldMax.value.copy(oilMat.uniforms.uWorldMax.value);

      // caustic ridge bake for the volume march
      causticMat.uniforms.uCausticsWorldMin.value.set(-15, camZ - 26);
      causticMat.uniforms.uCausticsWorldMax.value.set(15, camZ + 4);
      quad.material = causticMat;
      renderer.setRenderTarget(causticRT);
      renderer.render(quadScene, quadCam);
      renderer.setRenderTarget(null);
      return { camZ, tunnel: tp, time };
    },

    render() {
      renderer.setRenderTarget(sceneRT);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      quad.material = postMat;
      renderer.render(quadScene, quadCam);
    },

    resize() {
      const w = innerWidth, h = innerHeight;
      renderer.setSize(w, h, false);
      sceneRT.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    },
  };
}
