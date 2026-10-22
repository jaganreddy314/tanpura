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

- **Tone:** each harmonic's loudness comes from a frequency curve (`TIMBRE_EQ` in `src/audio.js`). The curve was
  fitted to reference "Your Tanpura" recordings in A and G#, and matches their spectrum to within about 1.5 dB per
  1/3-octave band. The result is weak fundamentals, a strong buzzing band at 0.6–1.7 kHz, and a steep fall above 2 kHz.
- **Jawari bloom:** each pluck starts with a short attack on the low harmonics, then the upper harmonics swell in
  over about a second, like a real buzzing bridge.
- **Rhythm:** Pa · Sa · Sa · low Sa, with the last gap about 1.36× the others. The default cycle is 3.5 s, matching
  the reference recordings (3.4–3.6 s).

Icons: edit `public/icons/icon.svg`, then run `npm run icons` (needs `rsvg-convert`).
