import { describe, expect, it } from "vitest";
import { phraseLibrary } from "../src/core/phrase/library";
import { realizePhrase } from "../src/core/phrase/realize";

describe("phrase library", () => {
  const all = phraseLibrary();

  it("has unique ids and at least the brainstorm's level-1 cells and a progression", () => {
    const ids = all.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(all.filter((p) => p.level === 1).length).toBeGreaterThanOrEqual(3);
    expect(all.some((p) => p.chords.length > 0)).toBe(true);
  });

  it("every phrase realizes cleanly in every role it supports", () => {
    for (const p of all) {
      const roles = p.chords.length > 0 ? (["root", "third", "fifth"] as const) : (["melody"] as const);
      for (const role of roles) {
        const realized = realizePhrase({ phrase: p, keyTonicMidi: 60, bpm: 90, role, guide: "full" });
        expect(realized.notes.length).toBeGreaterThan(0);
        for (const n of realized.notes) {
          expect(n.startMs).toBeGreaterThanOrEqual(0);
          expect(n.durationMs).toBeGreaterThan(0);
        }
        // notes never overlap: sorted and non-overlapping
        for (let i = 1; i < realized.notes.length; i += 1) {
          expect(realized.notes[i].startMs).toBeGreaterThanOrEqual(
            realized.notes[i - 1].startMs + realized.notes[i - 1].durationMs - 1,
          );
        }
      }
    }
  });

  it("melody phrases stay within a singable span (an octave and a half)", () => {
    for (const p of all.filter((x) => x.notes.length > 0)) {
      const realized = realizePhrase({ phrase: p, keyTonicMidi: 60, bpm: 90, role: "melody", guide: "full" });
      const mids = realized.notes.map((n) => n.midi);
      expect(Math.max(...mids) - Math.min(...mids)).toBeLessThanOrEqual(19);
    }
  });
});
