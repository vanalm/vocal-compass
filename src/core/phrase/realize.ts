import { MAJOR_SCALE } from "../music/theory";
import type { GuideStrength, RangeMeasurement, SingerRole } from "../types";

/**
 * The one reusable exercise format (the Vocal Musicianship roadmap's MVP
 * shape): a phrase is scale-degree contour + rhythm + a Nashville chord
 * timeline. Realizing it against a key, tempo, and singer role produces the
 * concrete targets every game scores against — Echo Quest, Run Forge,
 * Nashville Navigator and Harmony Lock are skins over this, not codebases.
 */

export type ChordQuality = "maj" | "min" | "dim" | "sus4";
export type { GuideStrength, SingerRole } from "../types";

export interface PhraseNote {
  /** Scale degree, 1-based; >7 climbs the octave. */
  degree: number;
  /** Semitone alteration — minor-convention b3/b6/b7 stay numbered from the tonic. */
  alter?: number;
  beat: number;
  durationBeats: number;
}

export interface ChordEvent {
  numeral: number;
  quality: ChordQuality;
  beat: number;
  durationBeats: number;
}

export interface Phrase {
  id: string;
  name: string;
  /** Difficulty tier in the skill map (1 = Find Home cells). */
  level: number;
  beatsPerBar: number;
  totalBeats: number;
  notes: PhraseNote[];
  chords: ChordEvent[];
}

export interface PhraseExerciseSpec {
  phrase: Phrase;
  keyTonicMidi: number;
  bpm: number;
  role: SingerRole;
  guide: GuideStrength;
}

export interface RealizedNote {
  midi: number;
  startMs: number;
  durationMs: number;
  /** The sung note's degree in the key, e.g. "K3" / "Kb7". */
  degreeLabel: string;
  /** The Nashville chord sounding under it, e.g. "6m" — chord-tone roles only. */
  chordLabel?: string;
  /** The note's role in that chord, e.g. "CT3" — chord-tone roles only. */
  roleLabel?: string;
}

export interface RealizedChord {
  midis: number[];
  startMs: number;
  durationMs: number;
  label: string;
}

export interface RealizedPhrase {
  notes: RealizedNote[];
  chords: RealizedChord[];
  totalMs: number;
}

export function degreeToMidi(degree: number, tonicMidi: number, alter = 0): number {
  const index = (degree - 1) % 7;
  const octaves = Math.floor((degree - 1) / 7);
  return tonicMidi + MAJOR_SCALE[index] + 12 * octaves + alter;
}

function degreeLabel(degree: number, alter = 0): string {
  const collapsed = ((degree - 1) % 7) + 1;
  const accidental = alter < 0 ? "b" : alter > 0 ? "#" : "";
  return `K${accidental}${collapsed}`;
}

function chordLabel(chord: ChordEvent): string {
  const suffix = chord.quality === "min" ? "m" : chord.quality === "dim" ? "°" : chord.quality === "sus4" ? "sus" : "";
  return `${chord.numeral}${suffix}`;
}

/** Diatonic scale steps above the chord root for each singable role. */
const ROLE_STEPS: Record<Exclude<SingerRole, "melody">, { steps: number; label: string }> = {
  root: { steps: 0, label: "CT1" },
  third: { steps: 2, label: "CT3" },
  fifth: { steps: 4, label: "CT5" },
};

/** Pad voicing intervals per quality (semitones above the root). */
const PAD_INTERVALS: Record<ChordQuality, number[]> = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  dim: [0, 3, 6],
  sus4: [0, 5, 7],
};

export function realizePhrase(spec: PhraseExerciseSpec): RealizedPhrase {
  const beatMs = 60_000 / spec.bpm;
  const { phrase, keyTonicMidi, role } = spec;

  const chords: RealizedChord[] = phrase.chords.map((chord) => {
    const rootMidi = degreeToMidi(chord.numeral, keyTonicMidi) - 12; // pads sit below the voice
    return {
      midis: PAD_INTERVALS[chord.quality].map((i) => rootMidi + i),
      startMs: Math.round(chord.beat * beatMs),
      durationMs: Math.round(chord.durationBeats * beatMs),
      label: chordLabel(chord),
    };
  });

  let notes: RealizedNote[];
  if (role === "melody") {
    notes = [...phrase.notes]
      .sort((a, b) => a.beat - b.beat)
      .map((n) => ({
        midi: degreeToMidi(n.degree, keyTonicMidi, n.alter ?? 0),
        startMs: Math.round(n.beat * beatMs),
        durationMs: Math.round(n.durationBeats * beatMs),
        degreeLabel: degreeLabel(n.degree, n.alter ?? 0),
      }));
  } else {
    const { steps, label } = ROLE_STEPS[role];
    notes = [...phrase.chords]
      .sort((a, b) => a.beat - b.beat)
      .map((chord) => {
        const degree = chord.numeral + steps;
        return {
          midi: degreeToMidi(degree, keyTonicMidi),
          startMs: Math.round(chord.beat * beatMs),
          durationMs: Math.round(chord.durationBeats * beatMs),
          degreeLabel: degreeLabel(degree),
          chordLabel: chordLabel(chord),
          roleLabel: label,
        };
      });
  }

  return { notes, chords, totalMs: Math.round(phrase.totalBeats * beatMs) };
}

/** Comfortable default center when no range has been measured (A3-ish). */
const FALLBACK_CENTER_MIDI = 57;

/**
 * Choose the key so the phrase sits centered in the singer's measured range —
 * the brainstorm's "adapt the day's key and tessitura", driven by real probe
 * data. Clamps so the phrase never leaves the measured range.
 */
export function pickTessituraTonic(
  phrase: Phrase,
  role: SingerRole,
  ranges: RangeMeasurement[],
): number {
  const probe = realizePhrase({ phrase, keyTonicMidi: 60, bpm: 60, role, guide: "none" });
  const mids = probe.notes.map((n) => n.midi);
  if (mids.length === 0) return FALLBACK_CENTER_MIDI;
  const minOffset = Math.min(...mids) - 60;
  const maxOffset = Math.max(...mids) - 60;
  const phraseCenterOffset = (minOffset + maxOffset) / 2;

  const latest = ranges[ranges.length - 1];
  const rangeCenter = latest ? (latest.lowMidi + latest.highMidi) / 2 : FALLBACK_CENTER_MIDI;
  let tonic = Math.round(rangeCenter - phraseCenterOffset);
  if (latest) {
    const lowest = Math.ceil(latest.lowMidi - minOffset);
    const highest = Math.floor(latest.highMidi - maxOffset);
    if (lowest <= highest) tonic = Math.min(Math.max(tonic, lowest), highest);
  }
  return tonic;
}
