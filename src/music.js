// Western note names with the harmonium "White / Black" convention used in Indian music.
export const NOTES = [
  { name: 'C', label: 'C', hm: 'White 1', black: false },
  { name: 'C#', label: 'C♯', alt: 'D♭', hm: 'Black 1', black: true },
  { name: 'D', label: 'D', hm: 'White 2', black: false },
  { name: 'D#', label: 'D♯', alt: 'E♭', hm: 'Black 2', black: true },
  { name: 'E', label: 'E', hm: 'White 3', black: false },
  { name: 'F', label: 'F', hm: 'White 4', black: false },
  { name: 'F#', label: 'F♯', alt: 'G♭', hm: 'Black 3', black: true },
  { name: 'G', label: 'G', hm: 'White 5', black: false },
  { name: 'G#', label: 'G♯', alt: 'A♭', hm: 'Black 4', black: true },
  { name: 'A', label: 'A', hm: 'White 6', black: false },
  { name: 'A#', label: 'A♯', alt: 'B♭', hm: 'Black 5', black: true },
  { name: 'B', label: 'B', hm: 'White 7', black: false },
];

export const OCTAVES = [
  { value: 2, label: 'Deep' },
  { value: 3, label: 'Medium' },
  { value: 4, label: 'High' },
];

// First string, tuned in the lower octave relative to Sa (just intonation).
export const FIRST_STRINGS = {
  Pa: { ratio: 3 / 4, label: 'Pa' },
  Ma: { ratio: 2 / 3, label: 'Ma' },
  Ni: { ratio: 15 / 16, label: 'Ni' },
};

export function saFrequency(key, octave) {
  return 440 * Math.pow(2, (key - 9) / 12 + (octave - 4));
}

// Classic 4-string tanpura: Pa(low) · Sa · Sa · Sa(low octave)
export function stringFrequencies(sa, first) {
  return [sa * FIRST_STRINGS[first].ratio, sa, sa, sa / 2];
}

export function stringLabels(first) {
  return [FIRST_STRINGS[first].label, 'Sa', 'Sa', 'Sa'];
}
