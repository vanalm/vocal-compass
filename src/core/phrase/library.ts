import type { Phrase } from "./realize";

/**
 * The seed phrase library, straight from the roadmap's progression:
 * level 1 = Find Home echo cells, level 2 = Run Lab starter cells,
 * level 3 = Nashville progressions sung by chord role. Every entry powers
 * every game — this is content, not code.
 */
export function phraseLibrary(): Phrase[] {
  const melody = (
    id: string,
    name: string,
    level: number,
    degrees: number[],
    beatsPerNote = 1,
  ): Phrase => ({
    id,
    name,
    level,
    beatsPerBar: 4,
    totalBeats: Math.ceil(degrees.length * beatsPerNote),
    notes: degrees.map((degree, i) => ({
      degree,
      beat: i * beatsPerNote,
      durationBeats: beatsPerNote,
    })),
    chords: [],
  });

  const progression = (
    id: string,
    name: string,
    level: number,
    chords: Array<[number, "maj" | "min"]>,
  ): Phrase => ({
    id,
    name,
    level,
    beatsPerBar: 4,
    totalBeats: chords.length * 2,
    notes: [],
    chords: chords.map(([numeral, quality], i) => ({
      numeral,
      quality,
      beat: i * 2,
      durationBeats: 2,
    })),
  });

  return [
    // Level 1 — Find Home (Degree Echo cells)
    melody("l1-steps-123", "Steps up", 1, [1, 2, 3]),
    melody("l1-turn-1321", "Turn", 1, [1, 3, 2, 1]),
    melody("l1-arc-13531", "Arc", 1, [1, 3, 5, 3, 1]),
    melody("l1-fall-321", "Fall home", 1, [3, 2, 1]),
    // Level 2 — Run Lab starter cells (half-beat notes)
    melody("l2-run-54321", "Five-note fall", 2, [5, 4, 3, 2, 1], 0.5),
    melody("l2-run-1235321", "Up and over", 2, [1, 2, 3, 5, 3, 2, 1], 0.5),
    melody("l2-run-565321", "Crest and fall", 2, [5, 6, 5, 3, 2, 1], 0.5),
    // Level 3 — Number Navigator progressions (sung by chord role)
    progression("l3-prog-1451", "The cadence", 3, [[1, "maj"], [4, "maj"], [5, "maj"], [1, "maj"]]),
    progression("l3-prog-16m45", "The pop turn", 3, [[1, "maj"], [6, "min"], [4, "maj"], [5, "maj"]]),
  ];
}
