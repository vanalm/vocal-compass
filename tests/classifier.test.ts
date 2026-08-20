import { describe, expect, it } from "vitest";
import { AttemptClassifier } from "../src/core/trial/AttemptClassifier";
import type { PitchSample } from "../src/core/types";

const classifier = new AttemptClassifier();

/** Build a run of samples holding one midi value (with optional cents offset). */
function hold(midi: number, cents = 0, from = 0, count = 10, stepMs = 80): PitchSample[] {
  const value = midi + cents / 100;
  return Array.from({ length: count }, (_, i) => ({
    at: from + i * stepMs,
    hz: 440 * 2 ** ((value - 69) / 12),
    midi: value,
    clarity: 0.9,
    rms: 0.05,
  }));
}

describe("AttemptClassifier (PRD §21.1 logic tests)", () => {
  it("1. correct destination, centered landing", () => {
    const result = classifier.classify({ targetMidi: 62, startMidi: 60, samples: hold(62, 12) });
    expect(result.scored).toBe(true);
    expect(result.destinationMatch).toBe(true);
    expect(result.acousticErrorKind).toBe("success");
  });

  it("2. wrong destination, clean landing → selection miss, asks intent", () => {
    const result = classifier.classify({ targetMidi: 65, startMidi: 60, samples: hold(64, -8) });
    expect(result.destinationMatch).toBe(false);
    expect(result.cleanLandingOnSelected).toBe(true);
    expect(result.acousticErrorKind).toBe("selection");
    expect(classifier.needsIntentConfirmation(result)).toBe(true);
  });

  it("3. intended target confirmed → landing miss, not selection", () => {
    const result = classifier.classify({ targetMidi: 65, startMidi: 60, samples: hold(64, 45) });
    expect(classifier.resolveFinalErrorKind(result, "landing-miss")).toBe("landing");
  });

  it("4. search then center → search label with transitions", () => {
    const samples = [
      ...hold(60, 0, 0, 3),
      ...hold(62, 0, 240, 3),
      ...hold(64, 0, 480, 6),
    ];
    const result = classifier.classify({ targetMidi: 64, startMidi: 60, samples });
    expect(result.searchTransitions).toBeGreaterThanOrEqual(2);
    expect(result.acousticErrorKind).toBe("search");
  });

  it("5. wrong direction flagged", () => {
    const result = classifier.classify({ targetMidi: 64, startMidi: 60, samples: hold(57) });
    expect(result.wrongDirection).toBe(true);
    expect(result.destinationMatch).toBe(false);
  });

  it("6. octave displacement: pitch class matches, octave does not", () => {
    const result = classifier.classify({ targetMidi: 60, startMidi: 62, samples: hold(48) });
    expect(result.octaveDisplacement).toBe(true);
    expect(result.destinationMatch).toBe(false);
  });

  it("7. vibrato around the target is not a search path", () => {
    const samples = Array.from({ length: 12 }, (_, i) => ({
      at: i * 80,
      hz: 0,
      midi: 62 + 0.3 * Math.sin(i * 1.3), // ±30 cents oscillation
      clarity: 0.9,
      rms: 0.05,
    }));
    const result = classifier.classify({ targetMidi: 62, startMidi: 60, samples });
    expect(result.acousticErrorKind).toBe("success");
    expect(result.searchTransitions).toBeLessThan(2);
  });

  it("8. noisy/unvoiced input stays unscored", () => {
    const samples = hold(62).map((s) => ({ ...s, clarity: 0.2, rms: 0.001 }));
    const result = classifier.classify({ targetMidi: 62, startMidi: 60, samples });
    expect(result.scored).toBe(false);
    expect(result.acousticErrorKind).toBe("unscored");
    expect(classifier.resolveFinalErrorKind(result, "selected-note")).toBe("unscored");
  });

  it("intent overrides: no-target and searching", () => {
    const result = classifier.classify({ targetMidi: 65, startMidi: 60, samples: hold(64) });
    expect(classifier.resolveFinalErrorKind(result, "no-target")).toBe("no-target");
    expect(classifier.resolveFinalErrorKind(result, "searching")).toBe("search");
    expect(classifier.resolveFinalErrorKind(result, "selected-note")).toBe("selection");
  });
});
