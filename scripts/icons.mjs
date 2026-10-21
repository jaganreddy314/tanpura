// Regenerates PNG icons from public/icons/icon.svg (requires `rsvg-convert`, e.g. `brew install librsvg`).
import { execFileSync } from 'node:child_process';

const dir = new URL('../public/icons/', import.meta.url).pathname;
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['icon-maskable-512', 512], ['apple-touch-icon', 180]]) {
  execFileSync('rsvg-convert', ['-w', String(size), '-h', String(size), `${dir}icon.svg`, '-o', `${dir}${name}.png`]);
}
console.log('icons generated');
