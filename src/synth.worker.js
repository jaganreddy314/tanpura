// Renders tanpura string plucks off the main thread.
// Additive synthesis with a sweeping formant that imitates the "jawari" (buzzing bridge):
// the energy blooms through the upper harmonics and slowly glides down while the note sustains.

function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function renderString(sr, { freq, seed, duration }) {
  const rnd = mulberry32(seed);
  const len = Math.floor(sr * duration);
  const out = new Float32Array(len);
  const BLOCK = 64;
  const maxH = Math.max(1, Math.min(64, Math.floor((sr * 0.45) / freq)));

  const cStart = Math.min(maxH, 20 + rnd() * 8);
  const cEnd = 2 + rnd();
  const tau = 1.2 + rnd() * 0.5;
  const formW = 3.2;

  for (let n = 1; n <= maxH; n++) {
    const fn = freq * n * Math.sqrt(1 + 0.00001 * n * n) * (1 + (rnd() - 0.5) * 0.0005);
    const w = (2 * Math.PI * fn) / sr;
    const cw = Math.cos(w);
    const sw = Math.sin(w);
    const ph = rnd() * 2 * Math.PI;
    let re = Math.cos(ph);
    let im = Math.sin(ph);

    const base = 1 / Math.pow(n, 0.8);
    const decay = 0.35 + 0.035 * n;
    const shF = 0.25 + rnd() * 1.1;
    const shP = rnd() * Math.PI * 2;
    const shD = 0.1 + 0.25 * Math.min(1, n / 10);

    const envAt = (t) => {
      const c = cEnd + (cStart - cEnd) * Math.exp(-t / tau);
      const d = n - c;
      const boost = 1 + 3.2 * Math.exp(-(d * d) / (2 * formW * formW));
      return base * Math.exp(-decay * t) * boost * (1 + shD * Math.sin(2 * Math.PI * shF * t + shP));
    };

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
  const nLen = Math.floor(sr * 0.02);
  let lp = 0;
  for (let i = 0; i < nLen; i++) {
    lp += ((rnd() * 2 - 1) - lp) * 0.35;
    out[i] += lp * 0.6 * (1 - i / nLen);
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
