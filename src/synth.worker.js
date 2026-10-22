// Renders tanpura string plucks off the main thread.
// Additive synthesis: each partial is shaped by a frequency-dependent timbre curve and a
// slow "bloom" that imitates the buzzing jawari bridge.

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

function renderString(sr, { freq, seed, duration, eq }) {
  const rnd = mulberry32(seed);
  const len = Math.floor(sr * duration);
  const out = new Float32Array(len);
  const BLOCK = 64;
  const fMax = Math.min(sr * 0.45, 9000);

  for (let n = 1; n * freq < fMax; n++) {
    // Jawari keeps the partials harmonic; only a tiny random detune for life.
    const fn = freq * n * (1 + (rnd() - 0.5) * 0.0005);
    const w = (2 * Math.PI * fn) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const ph = rnd() * 2 * Math.PI;
    let re = Math.cos(ph);
    let im = Math.sin(ph);

    // Spectral shape measured from real tanpura recordings: weak fundamentals,
    // a strong buzzing band around 0.6–1.7 kHz, and a steep fall above 2 kHz.
    const gain = Math.pow(10, eqDb(eq, fn) / 20);
    const decay = 0.3 + fn / 6000;
    // Jawari "bloom": upper partials swell in after the pluck instead of starting at full strength.
    const bloomDepth = Math.min(0.95, fn / 1200);
    const bloomTau = 0.12 + 1.3 * Math.min(1, fn / 2000);
    // Audible pluck: the lower partials start with a short burst before the bloom takes over.
    const attack = 1.6 * Math.max(0, 1 - fn / 1400);
    const shF = 0.3 + rnd() * 1.4;
    const shP = rnd() * Math.PI * 2;
    const shD = 0.08 + 0.3 * Math.min(1, fn / 1500);

    const envAt = (t) =>
      gain *
      Math.exp(-decay * t) *
      (1 - bloomDepth * Math.exp(-t / bloomTau) + attack * Math.exp(-t / 0.09)) *
      (1 + shD * Math.sin(2 * Math.PI * shF * t + shP));

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

  // Pluck transient: a short burst of softened noise.
  const nLen = Math.floor(sr * 0.015);
  let lp = 0;
  for (let i = 0; i < nLen; i++) {
    lp += ((rnd() * 2 - 1) - lp) * 0.25;
    out[i] += lp * 0.15 * (1 - i / nLen);
  }

  const atk = sr * 0.004;
  const fadeLen = Math.floor(sr * 0.8);
  let peak = 0;
  for (let i = 0; i < len; i++) {
    let v = out[i] * (1 - Math.exp(-i / atk));
    const fromEnd = len - i;
    if (fromEnd < fadeLen) v *= fromEnd / fadeLen;
    out[i] = v;
    const a = Math.abs(v);
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
