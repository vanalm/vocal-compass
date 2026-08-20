import { describe, expect, it } from "vitest";
import { KpiCalculator } from "../src/core/kpi/KpiCalculator";
import { Recommender } from "../src/core/recommend/Recommender";
import { exercises } from "../src/core/exercises/registry";
import type { ErrorKind, TrialRecord } from "../src/core/types";

function record(overrides: Partial<TrialRecord> & { finalErrorKind: ErrorKind }): TrialRecord {
  const definition = exercises.get("route").createTrial({
    difficulty: "steps",
    delayMs: overrides.definition?.delayMs ?? 0,
    random: () => 0.4,
  });
  return {
    scored: true,
    selectedMidi: 62,
    selectedNote: "D3",
    targetNote: "D3",
    targetErrorCents: 10,
    residualToSelectedCents: 10,
    destinationMatch: overrides.finalErrorKind === "success",
    cleanLandingOnSelected: true,
    wrongDirection: false,
    octaveDisplacement: false,
    searchTransitions: 0,
    pitchPathSemitones: 0,
    stabilityCents: 5,
    detectorConfidence: 0.9,
    acousticErrorKind: overrides.finalErrorKind,
    explanation: "",
    id: crypto.randomUUID(),
    definition,
    feedbackMode: "commit",
    hintLevel: 0,
    lostEvent: false,
    intent: null,
    selectionLatencyMs: 800,
    recoveryTimeMs: null,
    confidenceBefore: 3,
    effort: 2,
    register: "unknown",
    trace: [],
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("KpiCalculator", () => {
  const kpi = new KpiCalculator();

  it("separates destination accuracy from independent accuracy", () => {
    const trials = [
      record({ finalErrorKind: "success" }),
      record({ finalErrorKind: "success", hintLevel: 2 }),
      record({ finalErrorKind: "selection" }),
      record({ finalErrorKind: "no-target", lostEvent: true }),
    ];
    const summary = kpi.summarize(trials);
    expect(summary.destinationAccuracy).toBeCloseTo(0.5);
    expect(summary.independentAccuracy).toBeCloseTo(0.25);
    expect(summary.hintRate).toBeCloseTo(0.25);
    expect(summary.mapLossRate).toBeCloseTo(0.25);
    expect(summary.availabilityRate).toBeCloseTo(0.75);
  });

  it("excludes unscored trials from rates", () => {
    const trials = [
      record({ finalErrorKind: "success" }),
      record({ finalErrorKind: "unscored", scored: false }),
    ];
    const summary = kpi.summarize(trials);
    expect(summary.total).toBe(2);
    expect(summary.scored).toBe(1);
    expect(summary.destinationAccuracy).toBe(1);
  });

  it("computes correct-target residual only over successes", () => {
    const trials = [
      record({ finalErrorKind: "success", targetErrorCents: -20 }),
      record({ finalErrorKind: "success", targetErrorCents: 40 }),
      record({ finalErrorKind: "selection", targetErrorCents: 300 }),
    ];
    expect(kpi.summarize(trials).correctTargetMedianResidual).toBe(30);
  });

  it("buckets retention by delay", () => {
    const at = (delayMs: number, kind: ErrorKind) => {
      const r = record({ finalErrorKind: kind });
      r.definition = { ...r.definition, delayMs };
      return r;
    };
    const curve = kpi.byDelay([
      at(0, "success"), at(0, "success"),
      at(5000, "success"), at(5000, "selection"),
    ]);
    expect(curve).toEqual([
      { delayMs: 0, accuracy: 1, n: 2 },
      { delayMs: 5000, accuracy: 0.5, n: 2 },
    ]);
  });
});

describe("Recommender", () => {
  it("asks for baseline data before comparing deficits", () => {
    const rec = new Recommender().recommend([], exercises.all());
    expect(rec.exercise.id).toBe(exercises.all()[0].id);
    expect(rec.reason).toMatch(/baseline/i);
  });

  it("targets the weakest module once all have data", () => {
    const trials: TrialRecord[] = [];
    for (const e of exercises.all()) {
      for (let i = 0; i < 8; i += 1) {
        const r = record({ finalErrorKind: e.id === "silent" ? "selection" : "success" });
        r.definition = { ...r.definition, exerciseId: e.id };
        trials.push(r);
      }
    }
    const rec = new Recommender().recommend(trials, exercises.all());
    expect(rec.exercise.id).toBe("silent");
    expect(rec.reason).toMatch(/lowest/i);
  });
});
