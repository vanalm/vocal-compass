import { describe, expect, it } from "vitest";
import { extractSungNotes, scorePhrase } from "../src/core/phrase/PhraseScorer";
import type { PitchSample } from "../src/core/types";

const FRAME = 70;

/** n frames of a held midi starting at ms. */
function held(midi: number, startMs: number, frames: number): PitchSample[] {
  return Array.from({ length: frames }, (_, i) => ({
    at: startMs + i * FRAME,
    hz: 440,
    midi,
    clarity: 0.95,
    rms: 0.05,
  }));
}

const target = (midi: number, startMs: number, durationMs = 500) => ({
  midi,
  startMs,
  durationMs,
  degreeLabel: "K1",
});

describe("extractSungNotes", () => {
  it("groups held frames into note events with onset and duration", () => {
    const notes = extractSungNotes([...held(60, 0, 5), ...held(64, 500, 5)]);
    expect(notes).toHaveLength(2);
    expect(notes[0].midi).toBeCloseTo(60, 5);
    expect(notes[0].onsetMs).toBe(0);
    expect(notes[1].midi).toBeCloseTo(64, 5);
    expect(notes[1].onsetMs).toBe(500);
  });

  it("ignores blips shorter than three frames", () => {
    const notes = extractSungNotes([...held(60, 0, 5), ...held(78, 350, 2), ...held(64, 600, 5)]);
    expect(notes.map((n) => Math.round(n.midi))).toEqual([60, 64]);
  });

  it("a silence gap splits notes even at the same pitch", () => {
    const notes = extractSungNotes([...held(60, 0, 4), ...held(60, 1000, 4)]);
    expect(notes).toHaveLength(2);
  });
});

describe("scorePhrase", () => {
  it("all targets hit on time scores clean", () => {
    const targets = [target(60, 0), target(64, 500), target(67, 1000)];
    const sung = [...held(60, 20, 6), ...held(64, 520, 6), ...held(67, 1010, 6)];
    const score = scorePhrase(targets, sung);
    expect(score.hits).toBe(3);
    expect(score.misses).toBe(0);
    expect(score.extras).toBe(0);
    expect(score.sequenceAccuracy).toBe(1);
    expect(score.landingHit).toBe(true);
    expect(score.meanAbsOnsetMs).toBeLessThan(30);
  });

  it("a wrong pitch is a miss even when the timing is right", () => {
    const targets = [target(60, 0), target(64, 500)];
    const sung = [...held(60, 0, 6), ...held(62, 500, 6)];
    const score = scorePhrase(targets, sung);
    expect(score.hits).toBe(1);
    expect(score.misses).toBe(1);
    expect(score.noteResults[1].hit).toBe(false);
  });

  it("an extra note between targets is counted, not silently forgiven", () => {
    const targets = [target(60, 0), target(67, 1000)];
    const sung = [...held(60, 0, 6), ...held(64, 500, 5), ...held(67, 1000, 6)];
    const score = scorePhrase(targets, sung);
    expect(score.hits).toBe(2);
    expect(score.extras).toBe(1);
  });

  it("measures late onsets", () => {
    const targets = [target(60, 0), target(64, 500)];
    const sung = [...held(60, 200, 6), ...held(64, 700, 6)];
    const score = scorePhrase(targets, sung);
    expect(score.hits).toBe(2);
    expect(score.meanAbsOnsetMs).toBeCloseTo(200, 0);
  });

  it("landing is judged on the final target", () => {
    const targets = [target(60, 0), target(64, 500)];
    const sung = [...held(60, 0, 6)];
    const score = scorePhrase(targets, sung);
    expect(score.landingHit).toBe(false);
  });

  it("says one thing to keep and one thing to fix", () => {
    const targets = [target(60, 0), target(64, 500)];
    const clean = scorePhrase(targets, [...held(60, 10, 6), ...held(64, 510, 6)]);
    expect(clean.keep.length).toBeGreaterThan(5);
    const late = scorePhrase(targets, [...held(60, 280, 6), ...held(64, 790, 6)]);
    expect(late.fix.toLowerCase()).toMatch(/tim|late|rush|drag|rhythm/);
    const missedLanding = scorePhrase(targets, [...held(60, 0, 6)]);
    expect(missedLanding.fix.toLowerCase()).toMatch(/land|last|final/);
  });

  it("empty singing scores zero without crashing", () => {
    const score = scorePhrase([target(60, 0)], []);
    expect(score.sequenceAccuracy).toBe(0);
    expect(score.landingHit).toBe(false);
  });
});
