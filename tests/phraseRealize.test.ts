import { describe, expect, it } from "vitest";
import {
  degreeToMidi,
  pickTessituraTonic,
  realizePhrase,
  type Phrase,
} from "../src/core/phrase/realize";
import type { RangeMeasurement } from "../src/core/types";

const C4 = 60;

function phrase(partial: Partial<Phrase>): Phrase {
  return {
    id: "p",
    name: "test",
    level: 1,
    beatsPerBar: 4,
    totalBeats: 4,
    notes: [],
    chords: [],
    ...partial,
  };
}

describe("degreeToMidi", () => {
  it("maps major-scale degrees from the tonic", () => {
    expect(degreeToMidi(1, C4)).toBe(60);
    expect(degreeToMidi(3, C4)).toBe(64);
    expect(degreeToMidi(5, C4)).toBe(67);
    expect(degreeToMidi(7, C4)).toBe(71);
  });

  it("handles flats the minor-convention way: b3, b6, b7 stay numbered from the tonic", () => {
    expect(degreeToMidi(3, C4, -1)).toBe(63);
    expect(degreeToMidi(6, C4, -1)).toBe(68);
    expect(degreeToMidi(7, C4, -1)).toBe(70);
  });

  it("degrees past 7 climb into the next octave", () => {
    expect(degreeToMidi(8, C4)).toBe(72);
    expect(degreeToMidi(10, C4)).toBe(76);
  });
});

describe("realizePhrase — melody role", () => {
  it("turns degrees and beats into midi and milliseconds at the given bpm", () => {
    const p = phrase({
      notes: [
        { degree: 1, beat: 0, durationBeats: 1 },
        { degree: 3, beat: 1, durationBeats: 1 },
        { degree: 5, beat: 2, durationBeats: 2 },
      ],
      totalBeats: 4,
    });
    const realized = realizePhrase({ phrase: p, keyTonicMidi: C4, bpm: 120, role: "melody", guide: "full" });
    expect(realized.notes).toEqual([
      { midi: 60, startMs: 0, durationMs: 500, degreeLabel: "K1" },
      { midi: 64, startMs: 500, durationMs: 500, degreeLabel: "K3" },
      { midi: 67, startMs: 1000, durationMs: 1000, degreeLabel: "K5" },
    ]);
    expect(realized.totalMs).toBe(2000);
  });
});

describe("realizePhrase — chord-tone roles (the Nashville layer)", () => {
  // The brainstorm's own worked example: thirds over 1–6m–4–5 sing K3–K1–K6–K7.
  const progression = phrase({
    chords: [
      { numeral: 1, quality: "maj", beat: 0, durationBeats: 1 },
      { numeral: 6, quality: "min", beat: 1, durationBeats: 1 },
      { numeral: 4, quality: "maj", beat: 2, durationBeats: 1 },
      { numeral: 5, quality: "maj", beat: 3, durationBeats: 1 },
    ],
    totalBeats: 4,
  });

  it("thirds over 1-6m-4-5 produce K3, K1, K6, K7", () => {
    const realized = realizePhrase({ phrase: progression, keyTonicMidi: C4, bpm: 60, role: "third", guide: "full" });
    expect(realized.notes.map((n) => n.degreeLabel)).toEqual(["K3", "K1", "K6", "K7"]);
    expect(realized.notes.map((n) => n.midi)).toEqual([64, 72, 69, 71]);
  });

  it("roots sing each chord's own numeral", () => {
    const realized = realizePhrase({ phrase: progression, keyTonicMidi: C4, bpm: 60, role: "root", guide: "full" });
    expect(realized.notes.map((n) => n.degreeLabel)).toEqual(["K1", "K6", "K4", "K5"]);
  });

  it("fifths step four diatonic steps above the root", () => {
    const realized = realizePhrase({ phrase: progression, keyTonicMidi: C4, bpm: 60, role: "fifth", guide: "full" });
    expect(realized.notes.map((n) => n.degreeLabel)).toEqual(["K5", "K3", "K1", "K2"]);
  });

  it("each chord-tone note carries its chord and role labels for the UI", () => {
    const realized = realizePhrase({ phrase: progression, keyTonicMidi: C4, bpm: 60, role: "third", guide: "full" });
    expect(realized.notes[1].chordLabel).toBe("6m");
    expect(realized.notes[1].roleLabel).toBe("CT3");
  });
});

describe("pickTessituraTonic", () => {
  const range = (low: number, high: number): RangeMeasurement => ({
    id: "r",
    createdAt: "2026-09-01T00:00:00.000Z",
    lowMidi: low,
    highMidi: high,
  });

  it("centers the phrase inside the measured range", () => {
    const p = phrase({
      notes: [
        { degree: 1, beat: 0, durationBeats: 1 },
        { degree: 5, beat: 1, durationBeats: 1 },
      ],
    });
    const tonic = pickTessituraTonic(p, "melody", [range(48, 72)]);
    // phrase spans tonic..tonic+7; center 60 → tonic ≈ 56 or 57
    const realized = realizePhrase({ phrase: p, keyTonicMidi: tonic, bpm: 60, role: "melody", guide: "full" });
    const mids = realized.notes.map((n) => n.midi);
    const center = (Math.min(...mids) + Math.max(...mids)) / 2;
    expect(Math.abs(center - 60)).toBeLessThanOrEqual(1);
  });

  it("falls back to a common comfortable tonic with no measurements", () => {
    const tonic = pickTessituraTonic(phrase({ notes: [{ degree: 1, beat: 0, durationBeats: 1 }] }), "melody", []);
    expect(tonic).toBeGreaterThanOrEqual(48);
    expect(tonic).toBeLessThanOrEqual(60);
  });

  it("never sends the phrase outside the measured range when the range is narrow", () => {
    const p = phrase({
      notes: [
        { degree: 1, beat: 0, durationBeats: 1 },
        { degree: 8, beat: 1, durationBeats: 1 },
      ],
    });
    const tonic = pickTessituraTonic(p, "melody", [range(55, 67)]);
    const realized = realizePhrase({ phrase: p, keyTonicMidi: tonic, bpm: 60, role: "melody", guide: "full" });
    for (const n of realized.notes) {
      expect(n.midi).toBeGreaterThanOrEqual(55);
      expect(n.midi).toBeLessThanOrEqual(67);
    }
  });
});
