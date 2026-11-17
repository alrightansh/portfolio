// Full-screen passes, tunnel cylinders, particle stations and glass tiles.
import { SNOISE } from "./glsl-terrain.js";

export const quadVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

export const postFrag = /* glsl */ `
uniform sampler2D tDiffuse;
uniform float uCA;
uniform float uLens;
varying vec2 vUv;
void main() {
  vec2 uv = vUv - 0.5;
  uv *= 1.0 + uLens * dot(uv, uv);
  uv += 0.5;
  vec2 dir = uv - 0.5;
  vec2 off = dir * length(dir) * uCA;
  gl_FragColor = vec4(texture2D(tDiffuse, uv - off).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv + off).b, 1.0);
}`;

export const causticBakeFrag = /* glsl */ `
${SNOISE}
uniform float uTime;
uniform float uCausticsScale;
uniform float uCausticsSpeed;
uniform float uCausticsContrast;
uniform vec2 uCausticsWorldMin;
uniform vec2 uCausticsWorldMax;
varying vec2 vUv;
void main() {
  vec2 worldXZ = mix(uCausticsWorldMin, uCausticsWorldMax, vUv);
  float ct = uTime * uCausticsSpeed;
  vec2 cp = worldXZ * uCausticsScale;
  float c1 = snoise(cp + vec2(ct * 0.6, ct * 0.4));
  float c2 = snoise(cp * 1.37 - vec2(ct * 0.3, -ct * 0.5));
  float ridge = pow(clamp((1.0 - abs(c1)) * (1.0 - abs(c2)), 0.0, 1.0), max(uCausticsContrast, 0.001));
  gl_FragColor = vec4(ridge, ridge, ridge, 1.0);
}`;

// Watercolour-bleed trail: r = pigment, g = water front. uShift re-anchors the texture as
// the world window slides along with the camera.
export const oilSimFrag = /* glsl */ `
uniform sampler2D uPrevTex;
uniform vec2 uTexel;
uniform vec2 uShift;
uniform float uDecay;
uniform float uBlur;
uniform float uSplatActive;
uniform vec2 uSplatPos;
uniform vec2 uSplatPosPrev;
uniform float uSplatRadius;
uniform float uSplatStrength;
uniform vec2 uWorldMin;
uniform vec2 uWorldMax;
uniform float uEdgeDarken;
uniform float uWaterSpread;
uniform float uPigmentDiff;
varying vec2 vUv;
vec4 prev(vec2 uv) {
  vec2 p = uv + uShift;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) return vec4(0.0);
  return texture2D(uPrevTex, p);
}
void main() {
  vec2 o = uTexel * max(uBlur, 0.0);
  vec4 cN = prev(vUv);
  vec4 nN = prev(vUv + vec2(0.0, o.y));
  vec4 sN = prev(vUv - vec2(0.0, o.y));
  vec4 eN = prev(vUv + vec2(o.x, 0.0));
  vec4 wN = prev(vUv - vec2(o.x, 0.0));
  float pigment = cN.r + ((nN.r + sN.r + eN.r + wN.r) * 0.25 - cN.r) * uPigmentDiff;
  float water = cN.g + ((nN.g + sN.g + eN.g + wN.g) * 0.25 - cN.g) * uWaterSpread;
  pigment += max(0.0, water - pigment) * uEdgeDarken;
  pigment *= uDecay;
  water *= uDecay * 0.985;
  if (uSplatActive > 0.001) {
    vec2 fragWorld = uWorldMin + vUv * (uWorldMax - uWorldMin);
    vec2 segVec = uSplatPos - uSplatPosPrev;
    float segLen2 = dot(segVec, segVec);
    float h = segLen2 > 0.000001 ? clamp(dot(fragWorld - uSplatPosPrev, segVec) / segLen2, 0.0, 1.0) : 0.0;
    vec2 d = fragWorld - (uSplatPosPrev + segVec * h);
    float r = max(uSplatRadius, 0.0001);
    pigment = max(pigment, exp(-dot(d, d) / (r * r)) * uSplatStrength * uSplatActive);
    water = max(water, exp(-dot(d, d) / (r * r * 2.25)) * uSplatStrength * 1.1 * uSplatActive);
  }
  gl_FragColor = vec4(pigment, water, 0.0, 1.0);
}`;

export const bgVert = /* glsl */ `void main() { gl_Position = vec4(position.xy, 1.0, 1.0); }`;
export const bgFrag = /* glsl */ `
uniform vec3 uFogColor;
uniform float uSurfaceDarken;
void main() { gl_FragColor = vec4(mix(uFogColor, vec3(0.0), clamp(uSurfaceDarken, 0.0, 1.0)), 1.0); }`;

export const cylWireVert = /* glsl */ `
${SNOISE}
uniform vec3 uHoverPos;
uniform float uHoverActivity;
uniform float uHoverRadius;
uniform float uHoverStrength;
uniform float uTime;
uniform float uNoiseAmp;
uniform float uNoiseScale;
uniform float uNoiseSpeed;
varying vec2 vUv;
varying float vWorldZ;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 meshO = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 radialXY = wp.xy - meshO.xy;
  float rLen = length(radialXY);
  vec3 radialDir = rLen > 0.0001 ? vec3(radialXY / rLen, 0.0) : vec3(0.0);
  float ang = atan(radialXY.y, radialXY.x);
  float t = uTime * uNoiseSpeed;
  vec2 nUv = vec2(ang * 1.6 + t * 0.7, wp.z * uNoiseScale - t);
  float n = snoise(nUv) * 0.7 + snoise(nUv * 2.3 + vec2(11.0, 5.0)) * 0.3;
  wp.xyz += radialDir * n * uNoiseAmp;
  float d = distance(wp.xyz, uHoverPos);
  float r = max(uHoverRadius, 0.0001);
  wp.xyz += radialDir * (uHoverStrength * uHoverActivity * exp(-(d * d) / (r * r)));
  vWorldZ = wp.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const cylWireFrag = /* glsl */ `
uniform float uTunnelProgress;
uniform vec3 uWireColor;
uniform float uGridU;
uniform float uGridV;
uniform float uLineWidth;
uniform float uLineSoftness;
uniform float uWireOpacity;
uniform float uTwist;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uFogNearStart;
uniform float uFogNearEnd;
uniform float uCameraZ;
uniform float uCylLen;
uniform float uReveal;
uniform float uRevealEdge;
uniform float uTime;
uniform float uRotSpeed;
varying vec2 vUv;
varying float vWorldZ;
void main() {
  float cylActive = smoothstep(0.92, 1.0, uTunnelProgress);
  if (cylActive < 0.001) discard;
  float worldV = vWorldZ * (uGridV / max(uCylLen, 0.001));
  float uTwisted = (vUv.x + uTime * uRotSpeed / 6.2831853) * uGridU + worldV * uTwist;
  float dist = abs(fract(uTwisted) - 0.5);
  float line = 1.0 - smoothstep(uLineWidth, uLineWidth + max(uLineSoftness, 0.00001), dist);
  if (line < 0.001) discard;
  float dz = abs(vWorldZ - uCameraZ);
  float fog = (1.0 - smoothstep(uFogStart, uFogEnd, dz)) * smoothstep(uFogNearEnd, uFogNearStart, dz);
  float revealDist = uReveal * (uCylLen * 0.5 + uRevealEdge);
  float wipe = 1.0 - smoothstep(revealDist - uRevealEdge, revealDist, dz);
  float a = line * uWireOpacity * cylActive * fog * wipe;
  if (a < 0.001) discard;
  gl_FragColor = vec4(uWireColor, a);
}`;

export const noiseTunVert = /* glsl */ `
${SNOISE}
uniform float uTime;
uniform float uCylLen;
uniform float uScale;
uniform float uDeform;
uniform float uSpeed;
uniform float uRotSpeed;
varying float vN;
varying float vWorldZ;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 meshO = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec2 rXY = wp.xy - meshO.xy;
  float rLen = length(rXY);
  vec2 unit = rLen > 0.0001 ? rXY / rLen : vec2(1.0, 0.0);
  float rotAng = uTime * uRotSpeed;
  float cr = cos(rotAng), sr = sin(rotAng);
  vec2 rotUnit = vec2(unit.x * cr - unit.y * sr, unit.x * sr + unit.y * cr);
  float k = max(uScale, 0.0001);
  float t = wp.z / max(uCylLen, 0.001) * 40.0 - uTime * uSpeed;
  float n = (snoise(vec2(rotUnit.x * k * 2.0, t)) + snoise(vec2(rotUnit.y * k * 2.0, t + 17.0))
    + snoise(vec2(rotUnit.x * k * 4.2, t * 1.3 - 9.0)) * 0.5 + snoise(vec2(rotUnit.y * k * 4.2, t * 1.3 + 5.0)) * 0.5) / 3.0;
  vN = n * 0.5 + 0.5;
  wp.xyz += vec3(unit, 0.0) * n * uDeform;
  vWorldZ = wp.z;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

export const noiseTunFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTunnelProgress;
uniform float uCameraZ;
uniform float uFogNearStart;
uniform float uFogNearEnd;
uniform float uFogFarStart;
uniform float uFogFarEnd;
uniform float uRevealDist;
uniform float uRevealEdge;
varying float vN;
varying float vWorldZ;
void main() {
  float cylActive = smoothstep(0.92, 1.0, uTunnelProgress);
  if (cylActive < 0.001) discard;
  float dz = abs(vWorldZ - uCameraZ);
  float visible = (1.0 - smoothstep(uFogFarStart, uFogFarEnd, dz)) * smoothstep(uFogNearEnd, uFogNearStart, dz);
  float reveal = smoothstep(uRevealDist - uRevealEdge, uRevealDist + uRevealEdge, dz);
  float a = vN * uOpacity * cylActive * visible * reveal;
  if (a < 0.002) discard;
  gl_FragColor = vec4(uColor * (0.6 + vN * 0.6), a);
}`;

export const stationVert = /* glsl */ `
attribute vec2 aBase;
attribute float aSeed;
uniform vec3 uStationCenter;
uniform float uFormProgress;
uniform float uVisProgress;
uniform float uYOffset;
uniform float uScatterRadius;
uniform float uScatterHeight;
uniform float uFormJitter;
uniform vec2 uCursorNDC;
uniform float uHoverActive;
uniform float uHoverRadius;
uniform float uHoverRepel;
uniform float uHoverScale;
uniform float uParticleSize;
uniform float uPixelRatio;
uniform float uTime;
uniform float uIdleWiggle;
varying float vForm;
varying float vVis;
varying float vPAlpha;
varying float vHoverFall;
void main() {
  vec3 jitter = vec3(fract(aSeed * 41.7) - 0.5, fract(aSeed * 79.3) - 0.5, fract(aSeed * 17.1) - 0.5) * uFormJitter;
  vec3 formed = uStationCenter + vec3(aBase.x, aBase.y + uYOffset, 0.0) + jitter;
  vec3 scattered = uStationCenter + vec3((fract(aSeed * 11.3) - 0.5) * 2.0 * uScatterRadius,
    -uScatterHeight - fract(aSeed * 31.9) * 0.6, (fract(aSeed * 71.1) - 0.5) * 2.0 * uScatterRadius);
  float stagger = 0.35;
  float pEase = clamp((uFormProgress - fract(aSeed * 53.7) * stagger) / (1.0 - stagger), 0.0, 1.0);
  pEase = 1.0 - pow(1.0 - pEase, 4.0);
  float e = smoothstep(0.0, 1.0, pEase);
  vec3 worldPos = mix(scattered, formed, e);
  worldPos += vec3(sin(uTime * 1.7 + aSeed * 13.0), cos(uTime * 1.3 + aSeed * 7.0), sin(uTime * 2.1 + aSeed * 23.0))
    * uIdleWiggle * pEase;
  vPAlpha = smoothstep(0.35, 1.0, pEase);
  vec4 mvPos = viewMatrix * vec4(worldPos, 1.0);
  vec4 clip = projectionMatrix * mvPos;
  float hoverFall = 0.0;
  vec2 pushNDC = vec2(0.0);
  if (uHoverActive > 0.0) {
    vec2 toCursor = clip.xy / max(clip.w, 0.0001) - uCursorNDC;
    float dn = length(toCursor);
    float r = max(uHoverRadius, 0.0001);
    hoverFall = exp(-(dn * dn) / (r * r)) * uHoverActive;
    float t = dn / r;
    float radial = t * exp(1.0 - t * t);
    vec2 dir = toCursor / max(dn, 0.0001);
    pushNDC = (dir * radial + vec2(-dir.y, dir.x) * radial * 0.35) * uHoverRepel * 0.5 * uHoverActive;
  }
  clip.xy += pushNDC * clip.w;
  gl_Position = clip;
  gl_PointSize = uParticleSize * uPixelRatio * clamp(8.0 / max(-mvPos.z, 0.5), 0.4, 1.6) * (1.0 + hoverFall * uHoverScale);
  vForm = pEase;
  vVis = clamp(uVisProgress, 0.0, 1.0);
  vHoverFall = hoverFall;
}`;

export const stationFrag = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uHoverGlowColor;
uniform float uHoverGlow;
uniform vec3 uPLightDir;
uniform float uPAmbient;
uniform float uPDiffuse;
uniform float uPSpec;
uniform float uPSpecPower;
varying float vForm;
varying float vVis;
varying float vPAlpha;
varying float vHoverFall;
void main() {
  highp vec2 pc = gl_PointCoord;
  vec2 c = pc - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;
  float disc = 1.0 - smoothstep(0.35, 0.5, d);
  vec3 col = mix(mix(uColorA, uColorB, vForm), uColorA, smoothstep(0.18, 0.5, d) * 0.65);
  float lift = clamp(vHoverFall * uHoverGlow, 0.0, 4.0);
  col = mix(col, uHoverGlowColor, clamp(lift, 0.0, 1.0));
  col += uHoverGlowColor * max(lift - 1.0, 0.0);
  vec2 n2 = vec2(c.x, -c.y) * 2.0;
  vec3 N = vec3(n2, sqrt(clamp(1.0 - dot(n2, n2), 0.0, 1.0)));
  vec3 L = normalize(uPLightDir);
  float spec = pow(max(dot(N, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), max(uPSpecPower, 0.001));
  col = col * (uPAmbient + uPDiffuse * max(dot(N, L), 0.0)) + vec3(uPSpec * spec);
  gl_FragColor = vec4(col, disc * vVis * vPAlpha);
}`;

// Glass tile wall: each instance shows its slice of the image, pushed back and shrunk near the cursor.
export const glassVert = /* glsl */ `
attribute vec2 instUvOffset;
attribute vec2 instUvScale;
uniform vec2 uHoverNDC;
uniform float uHoverActive;
uniform float uHoverRadius;
uniform float uHoverScale;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying float vHover;
void main() {
  vec4 centerClip = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec2 cNDC = centerClip.xy / max(centerClip.w, 0.0001);
  float dn = length(cNDC - uHoverNDC);
  float r = max(uHoverRadius, 0.0001);
  float h = exp(-(dn * dn) / (r * r)) * uHoverActive;
  vec3 p = position * (1.0 + uHoverScale * h);
  p.z -= h * 0.06;
  vec4 mv = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
  vViewPos = mv.xyz;
  vNormalV = normalize(normalMatrix * mat3(instanceMatrix) * normal);
  vUv = instUvOffset + uv * instUvScale;
  vHover = h;
  gl_Position = projectionMatrix * mv;
}`;

export const glassFrag = /* glsl */ `
${SNOISE}
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uTime;
uniform vec3 uOilColorA;
uniform vec3 uOilColorB;
uniform float uEmissive;
varying vec2 vUv;
varying vec3 vNormalV;
varying vec3 vViewPos;
varying float vHover;
void main() {
  vec3 V = normalize(-vViewPos);
  vec3 N = normalize(vNormalV);
  float ndv = clamp(abs(dot(N, V)), 0.0, 1.0);
  vec2 uv = vUv + (N.xy * 0.012);
  vec3 col;
  col.r = texture2D(uMap, uv + vec2(0.0025, 0.0)).r;
  col.g = texture2D(uMap, uv).g;
  col.b = texture2D(uMap, uv - vec2(0.0025, 0.0)).b;
  col *= uEmissive + 0.35;
  vec3 R = reflect(-V, N);
  float matcap = pow(max(dot(R, normalize(vec3(0.55, 0.6, 0.6))), 0.0), 8.5) * 0.81;
  col += vec3(matcap);
  float rim = pow(1.0 - ndv, 2.5);
  col += vec3(0.55, 0.78, 1.0) * rim * 0.35;
  float n = snoise(vUv * 3.4 + uTime * 1.19 * 0.2);
  vec3 oil = mix(uOilColorA, uOilColorB, n * 0.5 + 0.5);
  col = 1.0 - (1.0 - col) * (1.0 - oil * vHover * 0.6);
  gl_FragColor = vec4(col, uOpacity);
}`;
