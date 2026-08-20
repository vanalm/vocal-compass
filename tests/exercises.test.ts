import { describe, expect, it } from "vitest";
import { exercises } from "../src/core/exercises/registry";
import { MAJOR_SCALE } from "../src/core/music/theory";

describe("Exercise registry", () => {
  it("registers the five v1 modules with unique ids", () => {
    const ids = exercises.all().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(["echo", "route", "silent", "tonal", "missing"]));
  });

  it("throws on unknown ids", () => {
    expect(() => exercises.get("nope")).toThrow(/Unknown exercise/);
  });
});

describe("Trial generation", () => {
  const request = { difficulty: "mixed" as const, delayMs: 2000, random: mulberry(42) };

  it("route replay produces a diatonic route within a compact span", () => {
    for (let i = 0; i < 50; i += 1) {
      const t = exercises.get("route").createTrial(request);
      expect(t.startDegree).not.toBe(t.targetDegree);
      expect(Math.abs(t.targetMidi - t.startMidi)).toBeLessThanOrEqual(7);
      expect(MAJOR_SCALE).toContain(((t.targetMidi - t.tonicMidi) % 12 + 12) % 12);
    }
  });

  it("echo and silent trials target the same note they cue", () => {
    for (const id of ["echo", "silent"]) {
      const t = exercises.get(id).createTrial(request);
      expect(t.startMidi).toBe(t.targetMidi);
    }
  });

  it("missing note never sounds the target in its cue", () => {
    const exercise = exercises.get("missing");
    const t = exercise.createTrial(request);
    const plan = exercise.cuePlan(t);
    expect(t.phraseMidis[t.phraseMidis.length - 1]).toBe(t.targetMidi);
    expect(plan.contextMidis).not.toContain(t.targetMidi);
    expect(plan.revealTarget).toBe(false);
  });

  it("steps difficulty keeps routes to adjacent degrees", () => {
    const t = exercises.get("route").createTrial({ ...request, difficulty: "steps" });
    const delta = Math.abs(((t.targetDegree - t.startDegree) % 7 + 7) % 7);
    expect([1, 6]).toContain(delta);
  });
});

/** Deterministic PRNG so generation tests are reproducible. */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
