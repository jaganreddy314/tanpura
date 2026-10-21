# Tanpura

A 3D tanpura drone PWA for singing practice (riyaz).

**Stack:** Vite · Three.js (bloom post-processing) · Web Audio API · vite-plugin-pwa (offline + installable)

## Run

```bash
npm install
npm run dev       # http://localhost:5173 (also exposed on your LAN for phone testing)
npm run build     # production build in dist/
npm run preview   # serve the production build
```

The service worker and install prompt need HTTPS (or localhost). To use it on a phone, deploy `dist/` to any static host
such as Netlify, Vercel, Cloudflare Pages or GitHub Pages, open it, and choose **Add to Home Screen**.

## Features

- All 12 keys (C … B, with harmonium White/Black numbering) in Deep / Medium / High octaves
- First string: Pa, Ma or Ni
- Speed, volume, fine tune (±50 cents), hall reverb, practice timer
- Tap a string in the 3D view to pluck it; drag to orbit
- Keeps the screen awake while playing; settings are remembered

## How the sound works

There are no audio samples. `src/synth.worker.js` synthesizes each string with additive synthesis. A formant sweeps
from the high harmonics down to the low ones, which imitates the buzzing *jawari* bridge. The engine (`src/audio.js`)
plays the classic pattern Pa · Sa · Sa · low Sa, adds a short pause, and runs the result through body-resonance EQ
and a convolution reverb.

Icons: edit `public/icons/icon.svg`, then run `npm run icons` (needs `rsvg-convert`).
