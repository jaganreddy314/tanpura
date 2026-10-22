# Tanpura

A 3D tanpura drone PWA for singing practice (riyaz).

**Live:** https://jaganreddy314.github.io/tanpura/

**Stack:** Vite · Three.js (bloom post-processing) · Web Audio API · vite-plugin-pwa (offline + installable)

## Run

```bash
npm install
npm run dev       # http://localhost:5173 (also exposed on your LAN for phone testing)
npm run build     # production build in dist/
npm run preview   # serve the production build
```

Every push to `main` is built and deployed to GitHub Pages by `.github/workflows/deploy.yml`.
The service worker and install prompt need HTTPS (or localhost). To use it on a phone, deploy `dist/` to any static host
such as Netlify, Vercel, Cloudflare Pages or GitHub Pages, open it, and choose **Add to Home Screen**.

## Features

- All 12 keys (C … B, with harmonium White/Black numbering) in Deep / Medium / High octaves
- First string: Pa, Ma or Ni
- Speed, volume, fine tune (±50 cents), hall reverb, practice timer
- Tap a string in the 3D view to pluck it; drag to orbit
- Keeps the screen awake while playing; settings are remembered

## How the sound works

There are no audio samples. `src/synth.worker.js` synthesizes each string with additive synthesis:

- **Tone:** a warm, string-like base (`TIMBRE_EQ` in `src/audio.js`): full low harmonics and a smooth roll-off
  above ~800 Hz. An earlier version copied the spectrum of phone recordings, which made it sound harsh and
  electronic, like an electric guitar.
- **Jawari glow:** after a soft finger pluck, a gentle resonance blooms around 1.8 kHz and slowly sinks to about
  500 Hz while the note rings, which gives the tanpura its moving shimmer.
- **Two voices per harmonic:** each harmonic is two sines a fraction of a hertz apart, like a string vibrating
  in two planes. This gives the slow, natural beating of a real instrument instead of a static tone.
- **Rhythm:** Pa · Sa · Sa · low Sa, with the last gap about 1.36× the others. The default cycle is 3.5 s, matching
  the reference recordings (3.4–3.6 s).

Icons: edit `public/icons/icon.svg`, then run `npm run icons` (needs `rsvg-convert`).
