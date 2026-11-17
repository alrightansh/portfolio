// Tunnel into the void: spiral wire cylinder + deforming noise tube, both riding with the camera.
import * as THREE from "three";
import { P, rgb } from "./config.js";
import * as F from "./glsl-fx.js";

const CYL_LEN = 60;
const NOISE_LEN = 44;
const REVEAL_MS = 1600;

export function createTunnel(scene, uTime) {
  const wireGeo = new THREE.CylinderGeometry(2.6, 2.6, CYL_LEN, 128, 240, true);
  wireGeo.rotateX(Math.PI / 2);
  const wireU = {
    uTime, uTunnelProgress: { value: 0 }, uWireColor: { value: new THREE.Vector3(...rgb(P.cylColor)) },
    uGridU: { value: P.cylGridU }, uGridV: { value: P.cylGridV }, uLineWidth: { value: P.cylLineWidth },
    uLineSoftness: { value: P.cylLineSoftness }, uWireOpacity: { value: P.cylOpacity }, uTwist: { value: P.cylTwist },
    uFogStart: { value: P.cylFogStart }, uFogEnd: { value: P.cylFogEnd }, uFogNearStart: { value: P.cylFogNearStart },
    uFogNearEnd: { value: P.cylFogNearEnd }, uCameraZ: { value: 0 }, uCylLen: { value: CYL_LEN },
    uReveal: { value: 0 }, uRevealEdge: { value: 4 }, uRotSpeed: { value: P.cylRotSpeed },
    uHoverPos: { value: new THREE.Vector3() }, uHoverActivity: { value: 0 }, uHoverRadius: { value: P.cylHoverRadius },
    uHoverStrength: { value: P.cylHoverStrength }, uNoiseAmp: { value: 0.08 }, uNoiseScale: { value: 0.12 },
    uNoiseSpeed: { value: 0.35 },
  };
  const wire = new THREE.Mesh(wireGeo, new THREE.ShaderMaterial({ vertexShader: F.cylWireVert,
    fragmentShader: F.cylWireFrag, uniforms: wireU, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending }));
  wire.frustumCulled = false;
  wire.visible = false;
  scene.add(wire);

  const tubeGeo = new THREE.CylinderGeometry(3.2, 3.2, NOISE_LEN, 160, 320, true);
  tubeGeo.rotateX(Math.PI / 2);
  const tubeU = {
    uTime, uCylLen: { value: NOISE_LEN }, uScale: { value: P.noiseTunScale }, uDeform: { value: P.noiseTunDeform },
    uSpeed: { value: P.noiseTunSpeed }, uRotSpeed: { value: P.noiseTunRotSpeed },
    uColor: { value: new THREE.Vector3(...rgb(P.noiseTunColor)) }, uOpacity: { value: P.noiseTunOpacity },
    uTunnelProgress: { value: 0 }, uCameraZ: { value: 0 }, uFogNearStart: { value: P.noiseTunFogNearStart },
    uFogNearEnd: { value: P.noiseTunFogNearEnd }, uFogFarStart: { value: P.noiseTunFogFarStart },
    uFogFarEnd: { value: P.noiseTunFogFarEnd }, uRevealDist: { value: NOISE_LEN }, uRevealEdge: { value: 3 },
  };
  const tube = new THREE.Mesh(tubeGeo, new THREE.ShaderMaterial({ vertexShader: F.noiseTunVert,
    fragmentShader: F.noiseTunFrag, uniforms: tubeU, transparent: true, depthWrite: false, side: THREE.BackSide }));
  tube.frustumCulled = false;
  tube.visible = false;
  scene.add(tube);

  let activeSince = -1;
  const ray = new THREE.Raycaster();
  return {
    update(dt, camera, progress, ndc, hoverAct) {
      const on = progress > 0.92;
      wire.visible = tube.visible = on;
      wireU.uTunnelProgress.value = tubeU.uTunnelProgress.value = progress;
      const cz = camera.position.z;
      wireU.uCameraZ.value = tubeU.uCameraZ.value = cz;
      wire.position.set(camera.position.x, camera.position.y, cz - CYL_LEN * 0.35);
      tube.position.set(camera.position.x, camera.position.y, cz - NOISE_LEN * 0.4);
      const now = performance.now();
      if (on && activeSince < 0) activeSince = now;
      if (!on) activeSince = -1;
      const k = activeSince < 0 ? 0 : Math.min(1, (now - activeSince) / REVEAL_MS);
      const e = 1 - Math.pow(1 - k, 3);
      wireU.uReveal.value = e;
      tubeU.uRevealDist.value = NOISE_LEN * (1 - e);
      ray.setFromCamera(ndc, camera);
      const d = ray.ray.direction;
      const t = 2.6 / Math.max(Math.hypot(d.x, d.y), 0.05);
      wireU.uHoverPos.value.copy(ray.ray.origin).addScaledVector(d, t);
      wireU.uHoverActivity.value += (hoverAct - wireU.uHoverActivity.value) * 0.1;
    },
  };
}
