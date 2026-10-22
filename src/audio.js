// Tanpura audio engine: renders string buffers in a worker, then loops the
// classic pluck pattern (1st · Sa · Sa · low Sa · pause) with a lookahead scheduler.

// Relative gaps after Pa, Sa, Sa and low Sa, measured from reference tanpura recordings.
const PATTERN_GAPS = [1, 1, 1, 1.36];
const PATTERN_TOTAL = PATTERN_GAPS.reduce((a, b) => a + b, 0);

// Partial loudness (dB) by frequency (Hz), fitted to reference tanpura recordings.
export const TIMBRE_EQ = [
  [100, -23.3], [160, -30.2], [200, -22.4], [300, -25.4], [400, -7.6], [500, -10.5], [650, -7], [800, -2], [1000, -5.1],
  [1300, -5.1], [1600, -1.3], [2000, -10.6], [2500, -25], [3200, -20.6], [4000, -28.2], [5000, -23.9], [6400, -23.9], [9000, -32.9],
];
const PANS = [-0.35, -0.1, 0.1, 0.35];
const STRING_GAIN = [0.9, 0.8, 0.8, 1.05];
const NOTE_SECONDS = 9;

function makeImpulse(ctx, seconds = 3.6, decay = 2.6) {
  const sr = ctx.sampleRate;
  const len = Math.floor(sr * seconds);
  const pre = Math.floor(sr * 0.018);
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      lp += (Math.random() * 2 - 1 - lp) * (0.15 + 0.7 * (1 - t));
      d[i] = lp * Math.pow(1 - t, decay);
    }
  }
  return buf;
}

export class TanpuraEngine {
  constructor() {
    this.ctx = null;
    this.buffers = null;
    this.freqKey = '';
    this.playing = false;
    this.cents = 0;
    this.cycle = 3.5;
    this.eq = TIMBRE_EQ;
    this.onPluck = null;
    this.active = new Set();
    this.worker = new Worker(new URL('./synth.worker.js', import.meta.url), { type: 'module' });
    this.renderId = 0;
    this.pending = new Map();
    this.worker.onmessage = (e) => {
      const resolve = this.pending.get(e.data.id);
      this.pending.delete(e.data.id);
      resolve?.(e.data.buffers);
    };
    this._levelData = null;
  }

  _ensureContext() {
    if (this.ctx) return;
    if (navigator.audioSession) {
      try { navigator.audioSession.type = 'playback'; } catch { /* unsupported */ }
    }
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    this.ctx = ctx;

    this.input = ctx.createGain();

    this.dry = ctx.createGain();
    this.wet = ctx.createGain();
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeImpulse(ctx);
    this.input.connect(this.dry);
    this.input.connect(this.convolver).connect(this.wet);

    this.playGain = ctx.createGain();
    this.playGain.gain.value = 0;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.4;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this._levelData = new Float32Array(this.analyser.fftSize);

    this.dry.connect(this.playGain);
    this.wet.connect(this.playGain);
    this.playGain.connect(this.master).connect(comp).connect(this.analyser).connect(ctx.destination);

    this.setVolume(this._volume ?? 0.8);
    this.setReverb(this._reverb ?? 0.35);
  }

  /** Prepare buffers for the given 4 string frequencies (cached). */
  async setFrequencies(freqs) {
    this._ensureContext();
    const key = freqs.map((f) => f.toFixed(3)).join('|');
    if (key === this.freqKey) return this._rendering;
    this.freqKey = key;
    this._rendering = this._render(freqs);
    return this._rendering;
  }

  async _render(freqs) {
    const id = ++this.renderId;
    const data = await new Promise((resolve) => {
      this.pending.set(id, resolve);
      this.worker.postMessage({
        id,
        sampleRate: this.ctx.sampleRate,
        strings: freqs.map((freq, i) => ({ freq, seed: 1234 + i * 97, duration: NOTE_SECONDS, eq: this.eq })),
      });
    });
    if (id !== this.renderId) return; // a newer key was chosen meanwhile
    this.buffers = data.map((arr) => {
      const b = this.ctx.createBuffer(1, arr.length, this.ctx.sampleRate);
      b.copyToChannel(arr, 0);
      return b;
    });
  }

  setVolume(v) {
    this._volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v * v * 1.2, this.ctx.currentTime, 0.05);
  }

  setReverb(r) {
    this._reverb = r;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wet.gain.setTargetAtTime(r * 0.9, t, 0.05);
    this.dry.gain.setTargetAtTime(1 - r * 0.35, t, 0.05);
  }

  setCycle(seconds) { this.cycle = seconds; }

  setCents(c) {
    this.cents = c;
    if (!this.ctx) return;
    const rate = Math.pow(2, c / 1200);
    for (const s of this.active) s.playbackRate.setTargetAtTime(rate, this.ctx.currentTime, 0.05);
  }

  async start() {
    this._ensureContext();
    await this.ctx.resume();
    if (!this.buffers) await this._rendering;
    clearTimeout(this._stopTimer);
    const t = this.ctx.currentTime;
    this.playGain.gain.cancelScheduledValues(t);
    this.playGain.gain.setValueAtTime(this.playGain.gain.value, t);
    this.playGain.gain.linearRampToValueAtTime(1, t + 0.25);
    if (this.playing) return;
    this.playing = true;
    this.step = 0;
    this.nextTime = t + 0.08;
    this._tick();
    this._timer = setInterval(() => this._tick(), 50);
  }

  stop(fade = 1.2) {
    if (!this.ctx || !this.playing) return;
    this.playing = false;
    clearInterval(this._timer);
    const t = this.ctx.currentTime;
    this.playGain.gain.cancelScheduledValues(t);
    this.playGain.gain.setValueAtTime(this.playGain.gain.value, t);
    this.playGain.gain.linearRampToValueAtTime(0, t + fade);
    this._stopTimer = setTimeout(() => {
      for (const s of this.active) { try { s.stop(); } catch { /* already stopped */ } }
      this.active.clear();
    }, fade * 1000 + 50);
  }

  /** Pluck a single string right now (used when tapping strings in the 3D view). */
  async pluckNow(i) {
    this._ensureContext();
    await this.ctx.resume();
    if (!this.playing) {
      const t = this.ctx.currentTime;
      clearTimeout(this._stopTimer);
      this.playGain.gain.cancelScheduledValues(t);
      this.playGain.gain.setValueAtTime(1, t);
    }
    this._pluck(i, this.ctx.currentTime + 0.01);
  }

  _tick() {
    const ctx = this.ctx;
    while (this.nextTime < ctx.currentTime + 0.25) {
      this._pluck(this.step, this.nextTime + (Math.random() - 0.5) * 0.02);
      this.nextTime += (PATTERN_GAPS[this.step] * this.cycle) / PATTERN_TOTAL;
      this.step = (this.step + 1) % 4;
    }
  }

  _pluck(i, when) {
    if (!this.buffers) return;
    const ctx = this.ctx;
    when = Math.max(when, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = this.buffers[i];
    src.playbackRate.value = Math.pow(2, this.cents / 1200);
    const g = ctx.createGain();
    g.gain.value = STRING_GAIN[i] * (0.88 + Math.random() * 0.12);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = PANS[i];
      src.connect(g).connect(pan).connect(this.input);
    } else {
      src.connect(g).connect(this.input);
    }
    src.start(when);
    this.active.add(src);
    src.onended = () => this.active.delete(src);
    const delay = Math.max(0, (when - ctx.currentTime) * 1000);
    setTimeout(() => this.onPluck?.(i), delay);
  }

  /** RMS level of the output, 0..~0.5 */
  getLevel() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this._levelData);
    let s = 0;
    for (let i = 0; i < this._levelData.length; i++) s += this._levelData[i] * this._levelData[i];
    return Math.sqrt(s / this._levelData.length);
  }
}
