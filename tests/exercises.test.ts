import { describe, expect, it } from "vitest";
import { exercises } from "../src/core/exercises/registry";
import { MAJOR_SCALE, diatonicMidi } from "../src/core/music/theory";

const IDS = ["echo", "route", "silent", "tonal", "missing"];

describe("cue policy: only the tones the task needs", () => {
  it("only Tonal north plays the home chord, because the key is its task", () => {
    for (const exercise of exercises.all()) {
      const trial = exercise.createTrial({ difficulty: "steps", delayMs: 2000 });
      expect(exercise.cuePlan(trial).playCadence).toBe(exercise.id === "tonal");
    }
  });

  it.each(IDS)("%s labels every tone it plays", (id) => {
    const exercise = exercises.get(id);
    const plan = exercise.cuePlan(exercise.createTrial({ difficulty: "steps", delayMs: 0 }));
    expect(plan.cueLabels).toHaveLength(plan.contextMidis.length);
    expect(plan.cueLabels.every((label) => label.length > 0)).toBe(true);
    expect(Boolean(plan.goLabel)).toBe(plan.playStartAtGo);
  });
});

describe("Exercise guides", () => {
  it.each(IDS)("%s explains the task, the mechanism, and the neuroscience with sources", (id) => {
    const { guide } = exercises.get(id);
    // The task is one sentence: a single terminating period, at the very end.
    expect(guide.task.trim().endsWith(".")).toBe(true);
    expect(guide.task.replace(/\.$/, "").includes(".")).toBe(false);
    expect(guide.steps.length).toBeGreaterThanOrEqual(3);
    for (const text of [guide.skill, guide.trains, guide.why, guide.brain]) {
      expect(text.length).toBeGreaterThan(8);
    }
    expect(guide.science.length).toBeGreaterThanOrEqual(3);
    for (const note of guide.science) {
      expect(note.point.length).toBeGreaterThan(40);
      expect(note.source).toMatch(/\b(19|20)\d{2}\b/);
    }
    expect(guide.tips.length).toBeGreaterThan(0);
  });
});

describe("Exercise registry", () => {
  it("registers the five v1 modules with unique ids", () => {
    const ids = exercises.all().map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(expect.arrayContaining(IDS));
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
    for (let i = 0; i < 50; i += 1) {
      const t = exercise.createTrial(request);
      const plan = exercise.cuePlan(t);
      expect(t.phraseMidis[t.phraseMidis.length - 1]).toBe(t.targetMidi);
      expect(plan.contextMidis).not.toContain(t.targetMidi);
      expect(plan.revealTarget).toBe(false);
    }
  });

  it("steps difficulty keeps routes to adjacent degrees", () => {
    const t = exercises.get("route").createTrial({ ...request, difficulty: "steps" });
    const delta = Math.abs(((t.targetDegree - t.startDegree) % 7 + 7) % 7);
    expect([1, 6]).toContain(delta);
  });
});

describe("Missing note patterns", () => {
  const exercise = exercises.get("missing");

  it.each([
    ["steps", 1],
    ["thirds", 2],
  ] as const)("%s: four heard notes in an even run, and the answer is the next one", (difficulty, stride) => {
    const random = mulberry(7);
    for (let i = 0; i < 100; i += 1) {
      const t = exercise.createTrial({ difficulty, delayMs: 0, random });
      const heard = exercise.cuePlan(t).contextMidis;
      expect(heard).toHaveLength(4);
      expect(t.startMidi).toBe(heard[3]);
      const degrees = t.phraseMidis.map((m) => degreeIn(t.tonicMidi, m));
      const moves = degrees.slice(1).map((d, j) => d - degrees[j]);
      expect(new Set(moves).size).toBe(1);
      expect(Math.abs(moves[0])).toBe(stride);
    }
  });

  it("the heard notes settle the answer in every major key that contains them", () => {
    const random = mulberry(11);
    for (let i = 0; i < 300; i += 1) {
      const difficulty = (["steps", "thirds", "mixed", "leaps"] as const)[i % 4];
      const t = exercise.createTrial({ difficulty, delayMs: 0, random });
      const heard = t.phraseMidis.slice(0, 4);
      const answers = new Set<number>();
      for (let root = 0; root < 12; root += 1) {
        const scale: number[] = [];
        for (let m = 24; m <= 108; m += 1) {
          if (MAJOR_SCALE.includes((((m - root) % 12) + 12) % 12)) scale.push(m);
        }
        const at = heard.map((m) => scale.indexOf(m));
        if (at.includes(-1)) continue;
        const move = at[1] - at[0];
        if (move === 0 || at.some((x, j) => j > 0 && x - at[j - 1] !== move)) continue;
        answers.add(scale[at[3] + move] % 12);
      }
      expect([...answers]).toEqual([t.targetMidi % 12]);
    }
  });

  it("the old failure shape is gone: never fewer than four cue notes", () => {
    const random = mulberry(3);
    for (let i = 0; i < 100; i += 1) {
      const t = exercise.createTrial({ difficulty: "steps", delayMs: 0, random });
      expect(exercise.cuePlan(t).contextMidis).toHaveLength(4);
    }
  });
});

/** Zero-based diatonic degree of a MIDI note in the key, octave-aware. */
function degreeIn(tonicMidi: number, midi: number): number {
  for (let d = -21; d <= 28; d += 1) if (diatonicMidi(tonicMidi, d) === midi) return d;
  throw new Error(`MIDI ${midi} is not in the key`);
}

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
