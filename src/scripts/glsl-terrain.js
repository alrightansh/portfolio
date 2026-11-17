// Terrain, contour wire, particle and dust shaders.

export const SNOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g;
  g.x = a0.x * x0.x + h.x * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}`;

export const DISP_UNIFORMS = /* glsl */ `
uniform float uNoiseScale;
uniform float uDisplacement;
uniform float uTime;
uniform float uFocusX;
uniform float uFocusZ;
uniform float uWaveSpeed;
uniform float uWaveAmplitude;
uniform float uWaveLength;
uniform float uWaveFalloff;
uniform float uPulseWidth;
uniform float uBaseAmplitude;
uniform float uBaseSpeed;
uniform float uBaseWavelength;
uniform vec3 uClicks[4];
uniform float uHoverX;
uniform float uHoverZ;
uniform float uHoverActive;
uniform float uHoverRadius;
uniform float uHoverStrength;
uniform float uIntro;
uniform float uIntroLinear;
uniform float uCorridorWidth;
uniform float uCorridorHeight;
uniform float uCorridorSharpness;`;

export const DISP_FN = /* glsl */ `
float computeDisplacement(vec2 posXZ) {
  float n1 = snoise(posXZ * uNoiseScale);
  float n2 = snoise(posXZ * uNoiseScale * 2.5) * 0.45;
  float disp = (n1 + n2) * uDisplacement;
  float focusR = length(posXZ - vec2(uFocusX, uFocusZ));
  float falloffFocus = exp(-focusR * uWaveFalloff);
  float sigma = max(uPulseWidth, 0.0001);
  float halfLife = 1.6;
  float wave = 0.0;
  for (int i = 0; i < 4; i++) {
    vec3 click = uClicks[i];
    if (click.z < 0.0) continue;
    float age = uTime - click.z;
    if (age < 0.0 || age > halfLife * 4.0) continue;
    float r = length(posXZ - click.xy);
    float frontR = age * uWaveSpeed;
    float delta = r - frontR;
    float spatial = exp(-(delta * delta) / (sigma * sigma));
    float tau = age / halfLife;
    float temporal = tau * exp(1.0 - tau);
    float falloffR = exp(-r * uWaveFalloff);
    wave += sin((r - frontR) * (6.2831853 / max(uWaveLength, 0.0001))) * spatial * temporal * falloffR;
  }
  disp += wave * uWaveAmplitude;
  float basePhase = focusR * (6.2831853 / max(uBaseWavelength, 0.0001)) - uTime * uBaseSpeed;
  disp += sin(basePhase) * uBaseAmplitude * falloffFocus;
  float dh = length(posXZ - vec2(uHoverX, uHoverZ));
  float hr = max(uHoverRadius, 0.0001);
  disp += exp(-(dh * dh) / (hr * hr)) * uHoverStrength * uHoverActive;
  if (uCorridorHeight > 0.0001) {
    float d = max(abs(posXZ.x) - uCorridorWidth, 0.0);
    disp += pow(d, max(uCorridorSharpness, 0.001)) * uCorridorHeight;
  }
  return disp;
}`;

const HEAD = SNOISE + DISP_UNIFORMS + DISP_FN;

export const surfaceVert = /* glsl */ `
${HEAD}
varying float vDisp;
varying vec3 vWorldPos;
void main() {
  vec4 worldFlat = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
  float disp = computeDisplacement(worldFlat.xz) * smoothstep(0.0, 0.5, uIntro);
  vec3 pos = position;
  pos.y += disp;
  vDisp = disp;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;

export const surfaceFrag = /* glsl */ `
${SNOISE}
uniform vec3 uBaseColor;
uniform vec3 uPeakColor;
uniform vec3 uFogColor;
uniform float uDisplacement;
uniform float uSurfaceDarken;
uniform float uFocusX;
uniform float uFocusZ;
uniform float uFogInner;
uniform float uFogOuter;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform float uBumpiness;
uniform float uSpecularStrength;
uniform float uSpecularSharpness;
uniform sampler2D uOilTex;
uniform vec2 uOilWorldMin;
uniform vec2 uOilWorldMax;
uniform float uOilTexThreshold;
uniform float uBumpNoiseScale;
uniform float uBumpNoiseStrength;
uniform float uTime;
uniform vec3 uCausticsColor;
uniform float uCausticsIntensity;
uniform float uCausticsScale;
uniform float uCausticsSpeed;
uniform float uCausticsContrast;
uniform float uCausticsDistort;
uniform float uIntro;
uniform sampler2D uCausticsTex;
uniform vec2 uCausticsWorldMin;
uniform vec2 uCausticsWorldMax;
uniform float uVolumeDensity;
uniform float uVolumeYFalloff;
uniform float uVolumeMaxDist;
uniform float uVolumeSteps;
uniform float uVolumeSharpness;
uniform float uVolumeFocusBias;
uniform vec3 uClicks[4];
uniform vec3 uRippleColor;
uniform float uRippleIntensity;
uniform float uRippleSpeed;
uniform float uRippleSoftness;
uniform float uRippleLife;
uniform float uRippleNoiseScale;
uniform float uRippleNoiseStrength;
uniform float uOilIntensity;
uniform float uOilRingStrength;
uniform float uOilRingWidth;
uniform float uOilRingBlur;
uniform float uOilNoiseScale;
uniform float uOilSpeed;
uniform vec3 uOilColorA;
uniform vec3 uOilColorB;
varying float vDisp;
varying vec3 vWorldPos;

void main() {
  float h = clamp(vDisp / max(uDisplacement, 0.0001) * 0.5 + 0.5, 0.0, 1.0);
  float introH = mix(1.0, h, smoothstep(0.0, 0.7, uIntro));
  vec3 col = mix(uBaseColor, uPeakColor, introH);

  vec3 N = normalize(cross(dFdy(vWorldPos), dFdx(vWorldPos)));
  N.xz *= uBumpiness;
  N = normalize(N);
  if (uBumpNoiseStrength > 0.0001) {
    vec2 bp = vWorldPos.xz * uBumpNoiseScale;
    float eps = 0.6;
    float nC = snoise(bp);
    vec2 grad = vec2(snoise(bp + vec2(eps, 0.0)) - nC, snoise(bp + vec2(0.0, eps)) - nC) / eps;
    N.xz -= grad * uBumpNoiseStrength;
    N = normalize(N);
  }
  vec3 L = normalize(uLightDir);
  float ndl = clamp(dot(N, L), 0.0, 1.0);
  vec3 lit = col * (0.45 + 0.55 * ndl * uLightColor);
  vec3 V = normalize(cameraPosition - vWorldPos);
  float spec = pow(max(dot(V, reflect(-L, N)), 0.0), max(uSpecularSharpness, 1.0));
  lit += uLightColor * spec * uSpecularStrength;

  if (uRippleIntensity > 0.0001) {
    vec3 rippleSum = vec3(0.0);
    float life = max(uRippleLife, 0.0001);
    for (int i = 0; i < 4; i++) {
      vec3 click = uClicks[i];
      if (click.z < 0.0) continue;
      float age = uTime - click.z;
      if (age < 0.0 || age > life) continue;
      float d = length(vWorldPos.xz - click.xy);
      float rnoise = snoise(vWorldPos.xz * uRippleNoiseScale + vec2(uTime * 0.4)) * uRippleNoiseStrength;
      float t = clamp(age / life, 0.0, 1.0);
      float radius = life * uRippleSpeed * (1.0 - (1.0 - t) * (1.0 - t));
      float ringDist = abs((d + rnoise) - radius);
      float softness = max(uRippleSoftness, 0.0001) * (1.0 + 3.5 * smoothstep(0.0, 1.0, t));
      float ring = 1.0 - smoothstep(0.0, softness, ringDist);
      ring = ring * ring * (3.0 - 2.0 * ring);
      float timeFade = 1.0 - (t * t * t * (t * (t * 6.0 - 15.0) + 10.0));
      float chunk01 = snoise(vWorldPos.xz * uRippleNoiseScale * 2.8 + vec2(uTime * 0.9, -uTime * 0.7)) * 0.5 + 0.5;
      float radNorm = clamp(d / max(radius, 0.0001), 0.0, 1.0);
      chunk01 = clamp(chunk01 + (1.0 - smoothstep(0.0, 0.5, radNorm)) * 0.3, 0.0, 1.0);
      float cutoff = max(smoothstep(0.2, 1.0, t) * 0.9, smoothstep(0.6, 1.15, radNorm) * 0.7);
      float chunkMask = smoothstep(cutoff - 0.06, cutoff + 0.06, chunk01);
      rippleSum += uRippleColor * ring * timeFade * chunkMask;
    }
    vec3 r = clamp(rippleSum * uRippleIntensity, 0.0, 4.0);
    lit = 1.0 - (1.0 - clamp(lit, 0.0, 1.0)) * (1.0 - clamp(r, 0.0, 1.0));
  }

  if (uCausticsIntensity > 0.0001) {
    float ct = uTime * uCausticsSpeed;
    vec2 cp = vWorldPos.xz * uCausticsScale + vDisp * uCausticsDistort;
    float c1 = snoise(cp + vec2(ct * 0.6, ct * 0.4));
    float c2 = snoise(cp * 1.37 - vec2(ct * 0.3, -ct * 0.5));
    float ridge = pow(clamp((1.0 - abs(c1)) * (1.0 - abs(c2)), 0.0, 1.0), max(uCausticsContrast, 0.001));
    lit += uCausticsColor * ridge * uCausticsIntensity * smoothstep(0.3, 0.85, uIntro);
  }

  vec2 lmRangeC = uCausticsWorldMax - uCausticsWorldMin;
  float fogFactor = smoothstep(uFogInner, uFogOuter, length(vWorldPos.xz - vec2(uFocusX, uFocusZ)));
  float volFocus = 1.0 - fogFactor;
  if (uVolumeDensity > 0.0001 && volFocus > 0.01) {
    vec3 toSurf = vWorldPos - cameraPosition;
    float rayLen = length(toSurf);
    vec3 rayDir = toSurf / max(rayLen, 0.0001);
    float marchDist = min(rayLen, uVolumeMaxDist);
    int volSteps = int(clamp(uVolumeSteps, 1.0, 32.0));
    float volStepDist = marchDist / float(volSteps);
    float vt = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5) * volStepDist;
    vec3 volAcc = vec3(0.0);
    for (int j = 0; j < 32; j++) {
      if (j >= volSteps) break;
      vec3 vp = cameraPosition + rayDir * vt;
      if (vp.y > 0.0) {
        vec2 vuv = (vp.xz - uCausticsWorldMin) / lmRangeC;
        if (vuv.x >= 0.0 && vuv.x <= 1.0 && vuv.y >= 0.0 && vuv.y <= 1.0) {
          float vridge = pow(texture2D(uCausticsTex, vuv).r, max(uVolumeSharpness, 0.001));
          float sampleR = length(vp.xz - vec2(uFocusX, uFocusZ));
          float sampleFocus = 1.0 - smoothstep(uFogInner * 0.6, uFogOuter, sampleR);
          volAcc += vridge * exp(-vp.y * uVolumeYFalloff) * sampleFocus;
        }
      }
      vt += volStepDist;
    }
    lit += volAcc * uCausticsColor * uVolumeDensity * volStepDist
      * pow(volFocus, max(uVolumeFocusBias, 0.001)) * smoothstep(0.45, 1.0, uIntro);
  }

  vec3 oilContribution = vec3(0.0);
  float oilOpacity = 0.0;
  if (uOilIntensity > 0.0001) {
    vec2 op = vWorldPos.xz * uOilNoiseScale;
    float ot = uTime * uOilSpeed;
    vec2 warp = vec2(snoise(op + vec2(ot, 0.0)), snoise(op + vec2(0.0, ot) + 31.7));
    float n = snoise(op + warp * 1.6);
    vec3 rainbow = vec3(sin(n * 6.2831853), sin(n * 6.2831853 + 2.094), sin(n * 6.2831853 + 4.189)) * 0.5 + 0.5;
    vec3 oilCol = rainbow * mix(uOilColorA, uOilColorB, n * 0.5 + 0.5);
    vec2 oilUV = (vWorldPos.xz - uOilWorldMin) / (uOilWorldMax - uOilWorldMin);
    float oilSample = 0.0;
    if (oilUV.x >= 0.0 && oilUV.x <= 1.0 && oilUV.y >= 0.0 && oilUV.y <= 1.0) {
      oilSample = texture2D(uOilTex, oilUV).r;
    }
    float thr = max(uOilTexThreshold, 0.0001);
    float silhouette = smoothstep(thr * 1.5, thr * 8.0, oilSample);
    float dn = 1.0 - silhouette;
    float halfW = max(uOilRingWidth, 0.0001) * 0.5;
    float rim = 1.0 - smoothstep(halfW, halfW + max(uOilRingBlur, 0.0001), abs(dn - 0.5));
    float oilMask = silhouette * (0.15 + uOilRingStrength * rim);
    oilContribution = clamp(oilCol * uOilIntensity * oilMask, 0.0, 1.5);
    oilOpacity = clamp(oilMask * uOilIntensity, 0.0, 1.0);
  }

  vec3 outCol = mix(lit, uFogColor, fogFactor);
  float darken = clamp(uSurfaceDarken, 0.0, 1.0);
  outCol = mix(outCol, vec3(0.0), darken);
  float alpha = 1.0 - darken;
  float oilGate = (1.0 - darken) * (1.0 - fogFactor);
  oilContribution *= oilGate;
  oilOpacity *= oilGate;
  if (oilOpacity > 0.001) {
    outCol = 1.0 - (1.0 - clamp(outCol, 0.0, 1.0)) * (1.0 - clamp(oilContribution, 0.0, 1.0));
    alpha = max(alpha, oilOpacity);
  }
  if (alpha <= 0.001) discard;
  gl_FragColor = vec4(outCol, alpha);
}`;

export const wireVert = /* glsl */ `
${HEAD}
varying float vDisp;
varying vec3 vWorldPos;
void main() {
  vec4 worldFlat = modelMatrix * vec4(position.x, 0.0, position.z, 1.0);
  float disp = computeDisplacement(worldFlat.xz);
  vec3 pos = position;
  pos.y += disp;
  vDisp = disp;
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPos = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}`;

// Contour lines are evaluated per fragment from the analytic displacement so they stay smooth.
// They glow inside a noisy reveal mask that follows the cursor; uWireAmbient keeps a faint
// field of contours alive elsewhere in the focus area.
export const wireFrag = /* glsl */ `
${HEAD}
uniform vec3 uWireColor;
uniform float uWireThickness;
uniform float uWireOpacity;
uniform float uGlowSpread;
uniform float uGlowStrength;
uniform float uContourSpacing;
uniform float uRevealRadius;
uniform float uRevealBlur;
uniform float uRevealNoiseScale;
uniform float uRevealNoiseStrength;
uniform float uWireAmbient;
uniform float uSurfaceDarken;
uniform float uFogInner;
uniform float uFogOuter;
varying float vDisp;
varying vec3 vWorldPos;
void main() {
  float disp = computeDisplacement(vWorldPos.xz);
  float spacing = max(uContourSpacing, 0.0001);
  float bandDist = abs(mod(disp + spacing * 0.5, spacing) - spacing * 0.5);
  float w = fwidth(disp);
  float sharp = 1.0 - smoothstep(0.0, w * uWireThickness, bandDist);
  float glow = 1.0 - smoothstep(0.0, w * uWireThickness * (1.0 + uGlowSpread), bandDist);
  float lineAlpha = max(sharp, glow * uGlowStrength);
  float dist = length(vWorldPos.xz - vec2(uHoverX, uHoverZ))
    + snoise(vWorldPos.xz * uRevealNoiseScale) * uRevealNoiseStrength;
  float mask = (1.0 - smoothstep(max(uRevealRadius - uRevealBlur, 0.0), uRevealRadius + uRevealBlur, dist)) * uHoverActive;
  float drift = 0.55 + 0.45 * snoise(vWorldPos.xz * 0.35 + vec2(uTime * 0.05, -uTime * 0.04));
  mask = max(mask, uWireAmbient * drift);
  float fogFactor = smoothstep(uFogInner, uFogOuter, length(vWorldPos.xz - vec2(uFocusX, uFocusZ)));
  float alpha = lineAlpha * mask * uWireOpacity * (1.0 - fogFactor)
    * smoothstep(0.4, 1.0, uIntro) * (1.0 - clamp(uSurfaceDarken, 0.0, 1.0));
  if (alpha < 0.002) discard;
  gl_FragColor = vec4(uWireColor, alpha);
}`;

export const particleVert = /* glsl */ `
${HEAD}
uniform float uParticleLift;
uniform float uParticleSize;
uniform float uParticleSizeJitter;
uniform float uParticleXZJitter;
uniform float uParticleYJitter;
uniform float uPWaveBoost;
uniform float uPWaveSpeed;
uniform float uPWavePeriod;
uniform float uPWaveWidth;
uniform float uCameraZ;
uniform float uParticleZRange;
uniform float uTunnelProgress;
uniform float uTunnelRadius;
uniform float uTunnelCenterX;
uniform float uTunnelCenterY;
uniform float uTunnelScatter;
uniform float uTunnelSpiralTurns;
uniform float uTunnelSpiralPitch;
uniform float uTunnelRotSpeed;
uniform float uTunnelWiggle;
uniform float uTunnelPulseSpeed;
uniform float uTunnelPulseWidth;
uniform float uTunnelPulseBoost;
uniform float uTunnelPulsePeriod;
uniform float uTunnelBreathAmp;
uniform float uTunnelBreathSpeed;
uniform vec2 uCursorNDC;
uniform float uHoverNActive;
uniform float uHoverNRadius;
uniform float uHoverNScale;
uniform float uHoverNRepel;
uniform float uPassIndex;
uniform float uPixelRatio;
attribute float aRandom;
varying float vAlphaScale;
varying float vFocusR;
varying float vHoverFall;
varying float vCamForward;
varying float vTunnelMix;
void main() {
  vec3 localPos = position;
  float effRandom = fract(aRandom + uPassIndex * 0.3759);
  localPos.xz += (vec2(fract(effRandom * 13.31), fract(effRandom * 71.17)) - 0.5) * uParticleXZJitter;
  float worldX = localPos.x;
  float zRange = max(uParticleZRange, 1.0);
  float relZ = mod(localPos.z - uCameraZ + zRange * 0.5, zRange) - zRange * 0.5;
  float worldZ = uCameraZ + relZ;
  float disp = computeDisplacement(vec2(worldX, worldZ));
  float worldY = disp + uParticleLift + (fract(effRandom * 91.7) - 0.5) * uParticleYJitter;
  vec3 worldXYZ = vec3(worldX, worldY, worldZ);
  if (uTunnelProgress > 0.0001) {
    float tRad = uTunnelRadius + (fract(effRandom * 41.7) - 0.5) * uTunnelScatter;
    float turnAngle = effRandom * 6.2831853 * uTunnelSpiralTurns + position.z * uTunnelSpiralPitch
      + uTime * uTunnelRotSpeed;
    vec3 wiggle = vec3(sin(uTime * 0.73 + effRandom * 17.0), sin(uTime * 0.97 + effRandom * 31.0),
      sin(uTime * 1.11 + effRandom * 23.0)) * uTunnelWiggle * uTunnelProgress;
    vec3 tunnelXYZ = vec3(uTunnelCenterX + cos(turnAngle) * tRad, uTunnelCenterY + sin(turnAngle) * tRad, worldZ) + wiggle;
    worldXYZ = mix(worldXYZ, tunnelXYZ, uTunnelProgress);
  }
  vec4 mvPos = viewMatrix * vec4(worldXYZ, 1.0);
  gl_Position = projectionMatrix * mvPos;
  vCamForward = cameraPosition.z - worldXYZ.z;
  vTunnelMix = clamp(uTunnelProgress, 0.0, 1.0);
  float sizeRand = mix(1.0 - uParticleSizeJitter, 1.0 + uParticleSizeJitter, effRandom);
  float depthAtten = mix(clamp(8.0 / max(-mvPos.z, 0.5), 0.4, 1.6), 1.0, uTunnelProgress);
  float pwR = length(vec2(worldX, worldZ) - vec2(uFocusX, uFocusZ));
  float period = max(uPWavePeriod, 0.0001);
  float tau = mod(uTime, period) / period;
  float pwFront = (1.0 - pow(1.0 - tau, 3.0)) * period * uPWaveSpeed;
  float pwBell = smoothstep(max(uPWaveWidth, 0.0001), 0.0, abs(pwR - pwFront));
  float edge = smoothstep(0.0, 0.04, tau) * (1.0 - smoothstep(0.96, 1.0, tau));
  float surfacePulse = pwBell * edge * uPWaveBoost * (1.0 - uTunnelProgress);
  float tPeriod = max(uTunnelPulsePeriod, 0.0001);
  float bandZ = uCameraZ - mod(uTime, tPeriod) * uTunnelPulseSpeed;
  float tunnelPulse = smoothstep(max(uTunnelPulseWidth, 0.0001), 0.0, abs(worldZ - bandZ)) * uTunnelPulseBoost * uTunnelProgress;
  float breath = sin(uTime * uTunnelBreathSpeed + effRandom * 6.2831853);
  float breathMul = 1.0 + breath * uTunnelBreathAmp * uTunnelProgress;
  float hoverFall = 0.0;
  vec2 pushNDC = vec2(0.0);
  if (uHoverNActive > 0.0 && uTunnelProgress > 0.0001) {
    vec2 toCursor = gl_Position.xy / max(gl_Position.w, 0.0001) - uCursorNDC;
    float dn = length(toCursor);
    float r = max(uHoverNRadius, 0.0001);
    hoverFall = exp(-(dn * dn) / (r * r)) * uHoverNActive;
    float t = dn / r;
    float radial = t * exp(1.0 - t * t);
    vec2 dir = toCursor / max(dn, 0.0001);
    pushNDC = (dir * radial + vec2(-dir.y, dir.x) * radial * 0.35) * uHoverNRepel * 0.5 * uHoverNActive;
  }
  gl_Position.xy += pushNDC * gl_Position.w;
  gl_PointSize = uParticleSize * uPixelRatio * sizeRand * depthAtten * (1.0 + surfacePulse + tunnelPulse)
    * breathMul * (1.0 + hoverFall * uHoverNScale);
  vHoverFall = hoverFall;
  vAlphaScale = clamp(1.0 - (-mvPos.z) * 0.05, 0.2, 1.0);
  vAlphaScale *= 1.0 + (tunnelPulse + breath * uTunnelBreathAmp) * 0.4 * uTunnelProgress;
  float distFromCam = length(vec2(worldX, worldZ - uCameraZ));
  float waveR = uIntroLinear * 50.0;
  vAlphaScale *= 1.0 - smoothstep(waveR, waveR + 4.0, distFromCam);
  vFocusR = pwR;
}`;

export const particleFrag = /* glsl */ `
uniform vec3 uParticleColor;
uniform vec3 uParticleColorFar;
uniform float uParticleGradStart;
uniform float uParticleGradEnd;
uniform float uParticleOpacity;
uniform float uFogInner;
uniform float uFogOuter;
uniform vec3 uPLightDir;
uniform float uPAmbient;
uniform float uPDiffuse;
uniform float uPSpec;
uniform float uPSpecPower;
uniform vec3 uParticleHoverColor;
uniform float uParticleHoverStrength;
varying float vAlphaScale;
varying float vFocusR;
varying float vHoverFall;
varying float vCamForward;
varying float vTunnelMix;
void main() {
  highp vec2 pc = gl_PointCoord;
  vec2 c = pc - vec2(0.5);
  float d = length(c);
  if (d > 0.5) discard;
  float fogFactor = smoothstep(uFogInner, uFogOuter, vFocusR);
  float alpha = (1.0 - smoothstep(0.35, 0.5, d)) * uParticleOpacity * vAlphaScale * (1.0 - fogFactor);
  vec2 n2 = vec2(c.x, -c.y) * 2.0;
  vec3 N = vec3(n2, sqrt(clamp(1.0 - dot(n2, n2), 0.0, 1.0)));
  vec3 L = normalize(uPLightDir);
  float diff = max(dot(N, L), 0.0);
  float spec = pow(max(dot(N, normalize(L + vec3(0.0, 0.0, 1.0))), 0.0), max(uPSpecPower, 0.001));
  float gradT = clamp((vCamForward - uParticleGradStart) / max(uParticleGradEnd - uParticleGradStart, 0.0001), 0.0, 1.0);
  vec3 baseCol = mix(uParticleColor, uParticleColorFar, gradT * vTunnelMix);
  baseCol = mix(baseCol, uParticleHoverColor, clamp(vHoverFall * uParticleHoverStrength, 0.0, 1.0));
  gl_FragColor = vec4(baseCol * (uPAmbient + uPDiffuse * diff) + vec3(uPSpec * spec), alpha);
}`;

export const dustVert = /* glsl */ `
${HEAD}
uniform float uDustSpeed;
uniform float uDustRise;
uniform float uDustSize;
uniform float uDustSizeJitter;
uniform float uDustWander;
uniform float uCameraZ;
uniform float uDustZRange;
uniform float uTunnelProgress;
uniform float uDustForwardSpeed;
uniform float uTunnelCenterY;
uniform float uDustTunnelYSpread;
uniform float uPixelRatio;
attribute float aSeed;
attribute float aPhase;
varying float vAge;
varying float vFocusR;
varying float vIntroMul;
void main() {
  float age = fract(uTime * uDustSpeed + aPhase);
  float worldX = position.x + sin(uTime * 0.7 + aSeed * 31.7) * uDustWander;
  float worldZ = position.z + cos(uTime * 0.5 + aSeed * 17.3) * uDustWander;
  float zRange = max(uDustZRange, 1.0);
  worldZ = uCameraZ + mod(worldZ - uCameraZ + zRange * 0.5, zRange) - zRange * 0.5;
  float surfaceY = computeDisplacement(vec2(worldX, worldZ)) + age * uDustRise;
  float tunnelY = uTunnelCenterY + (fract(aSeed * 13.71) - 0.5) * uDustTunnelYSpread;
  float worldY = mix(surfaceY, tunnelY, uTunnelProgress);
  worldZ -= age * uDustForwardSpeed * uTunnelProgress;
  worldZ = uCameraZ + mod(worldZ - uCameraZ + zRange * 0.5, zRange) - zRange * 0.5;
  vec4 mvPos = viewMatrix * vec4(worldX, worldY, worldZ, 1.0);
  gl_Position = projectionMatrix * mvPos;
  float sizeRand = mix(1.0 - uDustSizeJitter, 1.0 + uDustSizeJitter, fract(aSeed * 0.71));
  gl_PointSize = uDustSize * uPixelRatio * sizeRand * clamp(8.0 / max(-mvPos.z, 0.5), 0.4, 1.6);
  vAge = age;
  vFocusR = length(vec2(worldX, worldZ) - vec2(uFocusX, uFocusZ));
  float waveR = uIntroLinear * 50.0;
  vIntroMul = 1.0 - smoothstep(waveR, waveR + 4.0, length(vec2(worldX, worldZ - uCameraZ)));
}`;

export const dustFrag = /* glsl */ `
uniform vec3 uDustColor;
uniform float uDustOpacity;
uniform float uFogInner;
uniform float uFogOuter;
varying float vAge;
varying float vFocusR;
varying float vIntroMul;
void main() {
  float d = length(gl_PointCoord - vec2(0.5));
  if (d > 0.5) discard;
  float a = (1.0 - smoothstep(0.35, 0.5, d)) * sin(vAge * 3.14159) * uDustOpacity
    * (1.0 - smoothstep(uFogInner, uFogOuter, vFocusR)) * vIntroMul;
  gl_FragColor = vec4(uDustColor, a);
}`;
