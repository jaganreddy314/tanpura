// Renders tanpura string plucks off the main thread.
// Additive synthesis: a warm, string-like base tone plus a soft jawari "glow" that drifts down
// through the harmonics while the note sustains. Every harmonic is played by two slightly
// detuned voices (the string vibrating in two planes), which gives the slow, organic shimmer
// of a real tanpura instead of a static electronic tone.

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Loudness of a partial (dB) by its frequency, interpolated on a log-frequency axis.
function eqDb(table, f) {
  if (f <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [f1, d1] = table[i];
    if (f <= f1) {
      const [f0, d0] = table[i - 1];
      return d0 + ((d1 - d0) * Math.log(f / f0)) / Math.log(f1 / f0);
    }
  }
  return table.at(-1)[1];
}

// Jawari glow: a broad, gentle resonance that starts high after the pluck and slowly sinks.
const GLOW_START = 1800;
const GLOW_END = 500;
const GLOW_TAU = 2.6;
const GLOW_DB = 8;
const GLOW_WIDTH = 0.55; // octaves (std dev)

function renderString(sr, { freq, seed, duration, eq }) {
  const rnd = mulberry32(seed);
  const len = Math.floor(sr * duration);
  const out = new Float32Array(len);
  const BLOCK = 64;
  const fMax = Math.min(sr * 0.45, 7000);

  const glowDb = (f, t) => {
    const fc = GLOW_END + (GLOW_START - GLOW_END) * Math.exp(-t / GLOW_TAU);
    const d = Math.log2(f / fc) / GLOW_WIDTH;
    // The glow fades in over the first ~0.4 s so the pluck itself stays soft.
    return GLOW_DB * (1 - Math.exp(-t / 0.4)) * Math.exp(-0.5 * d * d);
  };

  for (let n = 1; n * freq < fMax; n++) {
    const f0 = freq * n * (1 + (rnd() - 0.5) * 0.0003);
    const gain = Math.pow(10, eqDb(eq, f0) / 20);
    // Higher harmonics fade sooner, so the tone mellows as it rings.
    const decay = 0.22 + f0 / 3200;
    // Two voices per harmonic, a fraction of a hertz apart, decaying at slightly different rates.
    const beat = (0.04 + rnd() * 0.18) * Math.min(3, Math.sqrt(n));
    const voices = [
      { f: f0 - beat / 2, amp: 0.62, decay },
      { f: f0 + beat / 2, amp: 0.38, decay: decay * 0.8 },
    ];
    // Soft finger pluck: low harmonics speak in ~12 ms, upper ones a little later.
    const rise = 0.012 + 0.05 * Math.min(1, f0 / 2500);

    for (const v of voices) {
      const w = (2 * Math.PI * v.f) / sr;
      const cw = Math.cos(w);
      const sw = Math.sin(w);
      const ph = rnd() * 2 * Math.PI;
      let re = Math.cos(ph);
      let im = Math.sin(ph);

      const envAt = (t) =>
        gain * v.amp *
        Math.pow(10, glowDb(f0, t) / 20) *
        Math.exp(-v.decay * t) *
        (1 - Math.exp(-t / rise));

      let env = envAt(0);
      for (let b = 0; b < len; b += BLOCK) {
        const end = Math.min(len, b + BLOCK);
        const next = envAt(end / sr);
        const step = (next - env) / (end - b);
        for (let i = b; i < end; i++) {
          out[i] += env * im;
          const nr = re * cw - im * sw;
          im = re * sw + im * cw;
          re = nr;
          env += step;
        }
        env = next;
        if (env < 1e-5 && b / sr > 1) break;
      }
    }
  }

  // Finger contact: a very short, dark thump rather than a pick click.
  const nLen = Math.floor(sr * 0.012);
  let lp = 0;
  for (let i = 0; i < nLen; i++) {
    lp += ((rnd() * 2 - 1) - lp) * 0.06;
    out[i] += lp * 0.08 * Math.sin((Math.PI * i) / nLen);
  }

  const fadeLen = Math.floor(sr * 0.8);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const fromEnd = len - i;
    if (fromEnd < fadeLen) out[i] *= fromEnd / fadeLen;
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const g = peak > 0 ? 0.55 / peak : 1;
  for (let i = 0; i < len; i++) out[i] *= g;
  return out;
}

self.onmessage = (e) => {
  const { id, sampleRate, strings } = e.data;
  const buffers = strings.map((s) => renderString(sampleRate, s));
  self.postMessage({ id, buffers }, buffers.map((b) => b.buffer));
};
