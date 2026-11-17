// Light, airy space ambience synthesised with WebAudio (no samples, nothing below ~180 Hz).
const CHORD = [329.63, 493.88, 659.25, 739.99, 987.77]; // E4 B4 E5 F#5 B5
const SPARKLE = [1318.5, 1479.98, 1975.53, 2217.46, 2637.02];
const MASTER_LEVEL = 0.42;

function impulse(ctx, seconds) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  return buf;
}

function noiseBuffer(ctx) {
  const len = ctx.sampleRate * 4;
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    b0 = 0.997 * b0 + w * 0.029; b1 = 0.985 * b1 + w * 0.032; b2 = 0.95 * b2 + w * 0.048;
    d[i] = (b0 + b1 + b2) * 0.35;
  }
  return buf;
}

export function createAmbience() {
  let ctx = null, master = null, reverb = null, noise = null, sparkleTimer = 0, on = false;

  function lfo(target, rate, depth, offset) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = rate; g.gain.value = depth;
    o.connect(g); g.connect(target);
    target.value = offset;
    o.start();
  }

  function build() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain(); master.gain.value = 0;
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 180;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 5200;
    master.connect(hp); hp.connect(lp); lp.connect(ctx.destination);
    reverb = ctx.createConvolver(); reverb.buffer = impulse(ctx, 6.5);
    const wet = ctx.createGain(); wet.gain.value = 0.85;
    reverb.connect(wet); wet.connect(master);
    noise = noiseBuffer(ctx);

    // shimmering pad: soft sine / triangle voices, each breathing on its own slow cycle
    CHORD.forEach((f, i) => {
      const voice = ctx.createGain();
      const filt = ctx.createBiquadFilter(); filt.type = "lowpass"; filt.frequency.value = 1800 + i * 300;
      [-4, 4].forEach((cents, k) => {
        const o = ctx.createOscillator();
        o.type = k ? "triangle" : "sine";
        o.frequency.value = f; o.detune.value = cents + (Math.random() - 0.5) * 3;
        o.connect(filt); o.start();
      });
      filt.connect(voice);
      lfo(voice.gain, 0.018 + i * 0.011, 0.012, 0.016);
      const pan = ctx.createStereoPanner(); pan.pan.value = (i / (CHORD.length - 1)) * 1.2 - 0.6;
      voice.connect(pan); pan.connect(reverb);
      const dry = ctx.createGain(); dry.gain.value = 0.25; pan.connect(dry); dry.connect(master);
    });

    // airy hiss band, slowly sweeping like solar wind
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 0.7;
    lfo(bp.frequency, 0.03, 900, 2400);
    const air = ctx.createGain(); air.gain.value = 0.05;
    src.connect(bp); bp.connect(air); air.connect(reverb); src.start();
  }

  function sparkle() {
    if (!on) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain(), pan = ctx.createStereoPanner();
    o.type = "sine";
    o.frequency.value = SPARKLE[(Math.random() * SPARKLE.length) | 0];
    pan.pan.value = Math.random() * 1.6 - 0.8;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.018, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g); g.connect(pan); pan.connect(reverb);
    o.start(t); o.stop(t + 2.8);
    sparkleTimer = setTimeout(sparkle, 3500 + Math.random() * 6000);
  }

  return {
    get on() { return on; },
    toggle() {
      on = !on;
      if (on && !ctx) build();
      if (ctx.state === "suspended") ctx.resume();
      const t = ctx.currentTime;
      master.gain.cancelScheduledValues(t);
      master.gain.setValueAtTime(master.gain.value, t);
      master.gain.linearRampToValueAtTime(on ? MASTER_LEVEL : 0, t + (on ? 2.2 : 0.8));
      clearTimeout(sparkleTimer);
      if (on) sparkleTimer = setTimeout(sparkle, 1800);
      return on;
    },
    // soft filtered whoosh when a label swaps in
    whoosh() {
      if (!on || !ctx) return;
      const t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = noise;
      const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.Q.value = 1.4;
      bp.frequency.setValueAtTime(700, t);
      bp.frequency.exponentialRampToValueAtTime(3200, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.12);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
      src.connect(bp); bp.connect(g); g.connect(reverb);
      src.start(t, Math.random() * 2); src.stop(t + 1);
    },
  };
}
