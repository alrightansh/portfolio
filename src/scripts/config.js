// Scene settings. Values mirror the reference scene; colours are re-graded to blue / light blue.
export const P = {
  noiseScale: 0.365, displacement: 0.16,
  baseColor: "#2f6fe6", peakColor: "#0c1220", fogColor: "#07090f",
  fogInner: 1.5, fogOuter: 6.3, focusX: 0, focusZ: 0.4,
  waveSpeed: 1.55, waveAmplitude: 0.09, waveLength: 1.1, waveFalloff: 0.07, pulseWidth: 2,
  hoverRadius: 0.65, hoverStrength: 0.12, hoverEasing: 0.05,
  baseAmplitude: 0.02, baseSpeed: 0.35, baseWavelength: 8,
  lightAngle: -179, lightElevation: 17, lightColor: "#bfe4ff",
  bumpiness: 0.23, specularStrength: 0, specularSharpness: 128,

  particleColor: "#b4e2ff", particleSize: 2.4, particleOpacity: 1, particleLift: 0.045,
  particleSizeJitter: 0.56, particleXZJitter: 0.1, particleYJitter: 0,

  wireColor: "#9fdcff", wireThickness: 0.05, wireOpacity: 1.5, contourSpacing: 0.015,
  glowSpread: 20, glowStrength: 0.5, revealRadius: 0.1, revealBlur: 1.15,
  revealNoiseScale: 1.39, revealNoiseStrength: 0.45, wireAmbient: 0.1,

  bumpNoiseScale: 77.7, bumpNoiseStrength: 0.32,
  causticsColor: "#5aa6ff", causticsIntensity: 0.2, causticsScale: 0.72, causticsSpeed: 0.26,
  causticsContrast: 2.1, causticsDistort: 0,

  dustCount: 3000, dustSpawnRadius: 16, dustColor: "#8fd3ff", dustOpacity: 0.52, dustSize: 3,
  dustSizeJitter: 1, dustSpeed: 0.08, dustRise: 1.15, dustWander: 0.085,

  postCA: 0.0055, postLens: -0.66,
  scrollSpeed: 0.0065, scrollRotateX: -0.005, scrollRotateY: -0.005, scrollRotateZ: 0.15, scrollZoom: 30,
  corridorWidth: 1.8, corridorHeight: 0.425, corridorSharpness: 1.85,

  oilColorA: "#6f5cff", oilColorB: "#5cf0ff", oilIntensity: 0.7, oilNoiseScale: 2.19, oilSpeed: 0.18,
  oilRingStrength: 0.9, oilRingWidth: 0, oilRingBlur: 0.42, oilDecay: 0.985, oilBlur: 2.2,
  oilSplatRadius: 0.5, oilSplatStrength: 1, oilTexThreshold: 0.04, oilSplatLag: 0.18,
  oilWaterSpread: 0.55, oilPigmentDiff: 0.12, oilEdgeDarken: 0.18,

  statColorA: "#8fd3ff", statColorB: "#f4f8ff", statYOffset: 0.5, statParticleSize: 1.7,
  statScatterRadius: 20, statScatterHeight: 4.3, statFormJitter: 0.019,
  statHoverRadius: 0.09, statHoverRepel: 0.05, statHoverScale: 1.8, statHoverGlow: 1.4,
  statHoverGlowColor: "#ffffff", statHoverStiffness: 140, statHoverDamping: 16,
  statFormInMs: 490, statFormOutMs: 1440, statSpacing: 8, statFirstZ: -5.5, statIdleWiggle: 0.026,
  statLabelAppearOffset: 5.6, statLabelDisappearOffset: -0.9,
  researchView: 3.3, researchPin: 3, researchDwell: 0.1,

  tunnelStartZ: -72.5, tunnelEndZ: -96.5, tunnelRadius: 2.05, tunnelScatter: 0.31,
  tunnelSpiralTurns: 0.75, tunnelSpiralPitch: 0.735, tunnelRotSpeed: -0.21, tunnelWiggle: 0.02,
  tunnelPulseSpeed: 18, tunnelPulseWidth: 4, tunnelPulseBoost: 0.8, tunnelPulsePeriod: 4,
  tunnelBreathAmp: 0.35, tunnelBreathSpeed: 2.2, tunnelColorFar: "#000000",
  tunnelGradStart: 0, tunnelGradEnd: 60, particleHoverColor: "#ffffff", particleHoverStrength: 1,
  pLight: [0.4, 0.8, 0.6], pAmbient: 0.48, pDiffuse: 0.44, pSpec: 0.34, pSpecPower: 11,

  cylGridU: 28, cylGridV: 43, cylLineWidth: 0, cylLineSoftness: 0.02, cylOpacity: 0.45,
  cylColor: "#8fd3ff", cylTwist: -2.5, cylFogStart: 20.5, cylFogEnd: 31.5,
  cylFogNearStart: 8, cylFogNearEnd: 4.75, cylRotSpeed: 0.1, cylHoverRadius: 0.6, cylHoverStrength: -0.29,
  dustForwardSpeed: 22, dustTunnelYSpread: 8,

  noiseTunColor: "#1d4d9e", noiseTunScale: 1.1, noiseTunDeform: 0.055, noiseTunOpacity: 0.84,
  noiseTunSpeed: -0.89, noiseTunRotSpeed: 0.57, noiseTunFogNearStart: 4.9, noiseTunFogNearEnd: 0.9,
  noiseTunFogFarStart: 0, noiseTunFogFarEnd: 19,

  outroPhase1Z: -102, outroButtonZ: -141, outroHoldMs: 2400,
  magnetRadius: 220, magnetStrength: 0.35,

  pWaveBoost: 0.85, pWaveSpeed: 1.85, pWavePeriod: 2.85, pWaveWidth: 1.1,
  rippleColor: "#4aa8ff", rippleIntensity: 4, rippleSpeed: 2.2, rippleSoftness: 0.07, rippleLife: 1.05,
  rippleNoiseScale: 11.55, rippleNoiseStrength: 0.5,
  volumeDensity: 0.71, volumeYFalloff: 1.06, volumeMaxDist: 11, volumeSteps: 30,
  volumeSharpness: 3.3, volumeFocusBias: 1.6,

  glassTilesX: 12, glassTilesY: 10, glassTileGap: 0.965, glassWidth: 1.2, glassAspect: 4 / 3,
  glassYBase: 0.2, glassYOffset: 0.9, glassHoverRadius: 0.24, glassHoverScale: -0.67,
  glassEnterStart: 7, glassEnterEnd: 1, glassExitStart: 2, glassExitEnd: -1,
  glassInitRotY: 1.54, glassExitRotY: -1.75,
};

// Raw sRGB triplet: shaders bypass colour management so the canvas matches the page background.
export function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
