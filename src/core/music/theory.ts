/** Pitch math and key/scale vocabulary. Pure functions, fully testable. */

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];

export const NOTE_NAMES = [
  "C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B",
];

export interface KeyInfo {
  name: string;
  root: number; // pitch class 0..11
}

export const KEYS: KeyInfo[] = [
  { name: "C major", root: 0 },
  { name: "D major", root: 2 },
  { name: "E♭ major", root: 3 },
  { name: "F major", root: 5 },
  { name: "G major", root: 7 },
  { name: "A major", root: 9 },
];

export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function hzToMidi(hz: number): number {
  return 69 + 12 * Math.log2(hz / 440);
}

export function noteName(midi: number): string {
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${NOTE_NAMES[((rounded % 12) + 12) % 12]}${octave}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - avg) ** 2)));
}

/**
 * MIDI note of a zero-based diatonic degree in a major key. Degrees past 6
 * or below 0 continue into the neighbouring octaves (7 = the octave above).
 */
export function diatonicMidi(tonicMidi: number, degree: number): number {
  const index = ((degree % 7) + 7) % 7;
  return tonicMidi + 12 * Math.floor(degree / 7) + MAJOR_SCALE[index];
}
