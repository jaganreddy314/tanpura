import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { TanpuraEngine } from './audio.js';
import { TanpuraScene } from './scene.js';
import { NOTES, OCTAVES, FIRST_STRINGS, saFrequency, stringFrequencies, stringLabels } from './music.js';

registerSW({ immediate: true });

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'tanpura-settings-v1';
const DEFAULTS = { key: 9, octave: 3, first: 'Pa', cycle: 5.5, volume: 0.8, cents: 0, reverb: 0.35 };

function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}
const settings = loadSettings();
const save = () => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); } catch { /* private mode */ }
};

const engine = new TanpuraEngine();
const scene = new TanpuraScene($('scene'));
if (import.meta.env.DEV) window.__tanpura = { scene, engine };

// ---------- colours: each key gets its own hue ----------
function keyHue(key) {
  return ((key - 9) * 30 + 40 + 360) % 360;
}
function applyColors() {
  const h = keyHue(settings.key);
  const hsl = (dh, l = 68) => `hsl(${(h + dh + 360) % 360}, 92%, ${l}%)`;
  const colors = [hsl(-40, 70), hsl(0), hsl(0), hsl(25, 74)];
  scene.setAccents(colors);
  document.documentElement.style.setProperty('--accent', hsl(0, 72));
  document.documentElement.style.setProperty('--accent-2', hsl(-50, 72));
  document.querySelectorAll('#strings .s').forEach((el, i) => el.style.setProperty('--c', colors[i]));
}

// ---------- keyboard ----------
const keyboard = $('keyboard');
const whiteOrder = NOTES.map((n, i) => ({ ...n, i })).filter((n) => !n.black);
whiteOrder.forEach((n) => {
  const b = document.createElement('button');
  b.className = 'key white';
  b.dataset.key = n.i;
  b.innerHTML = `${n.label}<small>${n.hm.replace('White ', 'W')}</small>`;
  keyboard.appendChild(b);
});
NOTES.forEach((n, i) => {
  if (!n.black) return;
  const whitesBefore = NOTES.slice(0, i).filter((x) => !x.black).length;
  const b = document.createElement('button');
  b.className = 'key black';
  b.dataset.key = i;
  b.style.left = `calc(${(whitesBefore / 7) * 100}% - 2px)`;
  b.innerHTML = `${n.label}<small>${n.hm.replace('Black ', 'B')}</small>`;
  keyboard.appendChild(b);
});
keyboard.addEventListener('click', (e) => {
  const k = e.target.closest('.key');
  if (!k) return;
  settings.key = Number(k.dataset.key);
  update();
});

// ---------- octave ----------
$('octDown').onclick = () => { settings.octave = Math.max(OCTAVES[0].value, settings.octave - 1); update(); };
$('octUp').onclick = () => { settings.octave = Math.min(OCTAVES.at(-1).value, settings.octave + 1); update(); };

// ---------- first string ----------
const firstEl = $('first');
for (const name of Object.keys(FIRST_STRINGS)) {
  const b = document.createElement('button');
  b.textContent = FIRST_STRINGS[name].label;
  b.dataset.v = name;
  b.onclick = () => { settings.first = name; update(); };
  firstEl.appendChild(b);
}

// ---------- string indicators ----------
const stringsEl = $('strings');
for (let i = 0; i < 4; i++) {
  const d = document.createElement('div');
  d.className = 's';
  d.innerHTML = '<i></i><span></span>';
  stringsEl.appendChild(d);
}

// ---------- sliders ----------
const sliders = {
  cycle: { fmt: (v) => `${v.toFixed(1)} s`, apply: (v) => engine.setCycle(v), invert: true },
  volume: { fmt: (v) => `${Math.round(v * 100)}%`, apply: (v) => engine.setVolume(v) },
  cents: { fmt: (v) => `${v > 0 ? '+' : ''}${v} ¢`, apply: (v) => engine.setCents(v) },
  reverb: { fmt: (v) => `${Math.round(v * 100)}%`, apply: (v) => engine.setReverb(v) },
};
for (const [name, cfg] of Object.entries(sliders)) {
  const input = $(name);
  input.value = settings[name];
  const sync = () => {
    const v = Number(input.value);
    settings[name] = v;
    $(`${name}Out`).textContent = cfg.fmt(v);
    let p = ((v - input.min) / (input.max - input.min)) * 100;
    if (cfg.invert) p = 100 - p;
    input.style.setProperty('--p', `${p}%`);
    cfg.apply(v);
    if (name === 'cents') updateKeyInfo();
    save();
  };
  input.addEventListener('input', sync);
  sync();
}
// Speed reads more naturally as "slow → fast", so the cycle slider is flipped visually.
$('cycle').style.direction = 'rtl';

// ---------- practice timer ----------
const TIMER_OPTIONS = [0, 5, 10, 15, 30];
let timerEnd = 0;
let timerMinutes = 0;
const timerEl = $('timer');
for (const m of TIMER_OPTIONS) {
  const b = document.createElement('button');
  b.textContent = m ? `${m}m` : 'Off';
  b.onclick = () => {
    timerMinutes = m;
    timerEnd = m && engine.playing ? Date.now() + m * 60000 : 0;
    renderTimer();
  };
  timerEl.appendChild(b);
}
function renderTimer() {
  timerEl.querySelectorAll('button').forEach((b, i) => b.classList.toggle('sel', TIMER_OPTIONS[i] === timerMinutes));
  if (!timerMinutes) { $('timerLeft').textContent = ''; return; }
  if (!timerEnd) { $('timerLeft').textContent = `Stops ${timerMinutes} min after you press play`; return; }
  const left = Math.max(0, timerEnd - Date.now());
  const mm = Math.floor(left / 60000);
  const ss = String(Math.floor((left % 60000) / 1000)).padStart(2, '0');
  $('timerLeft').textContent = `${mm}:${ss} left`;
}
setInterval(() => {
  if (timerEnd && Date.now() >= timerEnd) {
    timerEnd = 0;
    stop(4);
    toast('Practice done! Well sung 🌟');
  }
  renderTimer();
}, 1000);
renderTimer();

// ---------- play / stop ----------
const playBtn = $('play');
let wakeLock = null;

async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* not allowed */ }
}

async function start() {
  playBtn.classList.add('on');
  playBtn.setAttribute('aria-label', 'Pause');
  await engine.start();
  if (timerMinutes) timerEnd = Date.now() + timerMinutes * 60000;
  requestWakeLock();
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
}

function stop(fade = 1.2) {
  engine.stop(fade);
  playBtn.classList.remove('on');
  playBtn.setAttribute('aria-label', 'Play');
  timerEnd = 0;
  wakeLock?.release().catch(() => {});
  wakeLock = null;
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused';
}

const toggle = () => (engine.playing ? stop() : start());
playBtn.onclick = toggle;
document.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); toggle(); }
});
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && engine.playing) requestWakeLock();
});

if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('play', start);
  navigator.mediaSession.setActionHandler('pause', () => stop());
  navigator.mediaSession.setActionHandler('stop', () => stop());
}

// ---------- visuals hooked to audio ----------
engine.onPluck = (i) => {
  scene.pluck(i);
  const el = stringsEl.children[i];
  el.classList.remove('hit');
  void el.offsetWidth;
  el.classList.add('hit');
  setTimeout(() => el.classList.remove('hit'), 120);
};
scene.onStringTap = (i) => engine.pluckNow(i);
(function levelLoop() {
  scene.setLevel(engine.getLevel());
  requestAnimationFrame(levelLoop);
})();

// ---------- panel & layout ----------
const panel = $('panel');
$('collapse').onclick = () => {
  panel.classList.toggle('collapsed');
  $('collapse').setAttribute('aria-label', panel.classList.contains('collapsed') ? 'Show controls' : 'Hide controls');
};
function updateInsets() {
  const r = panel.getBoundingClientRect();
  const wide = window.innerWidth >= 900;
  scene.setInsets(
    wide
      ? { top: 0, right: window.innerWidth - r.left, bottom: 0, left: 0 }
      : { top: 70, right: 0, bottom: window.innerHeight - r.top, left: 0 },
  );
}
new ResizeObserver(updateInsets).observe(panel);
window.addEventListener('resize', updateInsets);

// ---------- install ----------
let deferredPrompt = null;
const installBtn = $('install');
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  installBtn.hidden = false;
});
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
if (isIOS && !standalone) installBtn.hidden = false;
installBtn.onclick = async () => {
  if (deferredPrompt) {
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
  } else if (isIOS) {
    toast('Tap the Share button, then “Add to Home Screen”');
  }
};

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 4000);
}

// ---------- state → UI ----------
function updateKeyInfo() {
  const note = NOTES[settings.key];
  const hz = saFrequency(settings.key, settings.octave) * Math.pow(2, settings.cents / 1200);
  $('keyName').textContent = note.label;
  $('keySub').textContent = `${note.hm} · ${hz.toFixed(1)} Hz`;
  if ('mediaSession' in navigator && window.MediaMetadata) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: `Tanpura · ${note.label}`,
      artist: `${note.hm} · ${FIRST_STRINGS[settings.first].label} Sa Sa Sa`,
      artwork: [{ src: `${import.meta.env.BASE_URL}icons/icon-512.png`, sizes: '512x512', type: 'image/png' }],
    });
  }
}

function update() {
  keyboard.querySelectorAll('.key').forEach((k) => k.classList.toggle('sel', Number(k.dataset.key) === settings.key));
  firstEl.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === settings.first));
  const oct = OCTAVES.find((o) => o.value === settings.octave) ?? OCTAVES[1];
  $('octLabel').textContent = oct.label;
  $('octDown').disabled = settings.octave <= OCTAVES[0].value;
  $('octUp').disabled = settings.octave >= OCTAVES.at(-1).value;
  stringLabels(settings.first).forEach((l, i) => (stringsEl.children[i].querySelector('span').textContent = l));
  updateKeyInfo();
  applyColors();
  save();
  engine.setFrequencies(stringFrequencies(saFrequency(settings.key, settings.octave), settings.first));
}

update();
updateInsets();
