import { describe, expect, it } from "vitest";
import {
  vocalFunctionExercises,
  rangeChangeVerdict,
  MEANINGFUL_RANGE_CHANGE_ST,
  MEASUREMENT_DRIFT_ST,
} from "../src/core/protocol/rangePlan";

describe("vocalFunctionExercises", () => {
  const plan = vocalFunctionExercises();

  it("is the Stemple VFE sequence, in order", () => {
    expect(plan.steps.map((s) => s.id)).toEqual(["warmup", "stretch", "contract", "power"]);
  });

  it("gives each step exactly one what sentence and one why sentence", () => {
    for (const step of plan.steps) {
      for (const line of [step.what, step.why]) {
        expect(line.trim().endsWith(".")).toBe(true);
        expect(line.replace(/\.$/, "").includes(".")).toBe(false);
        expect(line.length).toBeGreaterThan(15);
      }
    }
  });

  it("cites the evidence behind each step rather than asserting it", () => {
    for (const step of plan.steps) {
      expect(step.evidence.length).toBeGreaterThan(10);
    }
  });

  it("prescribes a semi-occluded posture, which is the load-bearing part", () => {
    expect(plan.steps.every((s) => s.sovt)).toBe(true);
  });

  it("carries the trial-backed dose, twice daily", () => {
    expect(plan.repsPerExercise).toBe(2);
    expect(plan.timesPerDay).toBe(2);
    expect(plan.weeksToEffect).toBeGreaterThanOrEqual(4);
  });

  it("caps each step so a tool that cannot hear strain still bounds the load", () => {
    for (const step of plan.steps) {
      expect(step.maxSeconds).toBeGreaterThan(0);
      expect(step.maxSeconds).toBeLessThanOrEqual(60);
    }
  });
});

describe("rangeChangeVerdict", () => {
  it("calls a sub-threshold gain indistinguishable from noise", () => {
    const v = rangeChangeVerdict(20, 21.4);
    expect(v.deltaSemitones).toBeCloseTo(1.4, 5);
    expect(v.meaningful).toBe(false);
    expect(v.label).toMatch(/noise|practice/i);
  });

  it("calls a gain at or beyond the threshold meaningful", () => {
    const v = rangeChangeVerdict(20, 23);
    expect(v.meaningful).toBe(true);
    expect(v.direction).toBe("up");
  });

  it("flags a real LOSS of range, which is a health signal not a plateau", () => {
    const v = rangeChangeVerdict(24, 20);
    expect(v.meaningful).toBe(true);
    expect(v.direction).toBe("down");
    expect(v.label).toMatch(/clinician|doctor|check/i);
  });

  it("treats no change as no change", () => {
    expect(rangeChangeVerdict(20, 20).direction).toBe("flat");
  });

  it("exposes the constants it judges against", () => {
    expect(MEASUREMENT_DRIFT_ST).toBeCloseTo(1.4, 5);
    expect(MEANINGFUL_RANGE_CHANGE_ST).toBeGreaterThanOrEqual(3);
  });
});
