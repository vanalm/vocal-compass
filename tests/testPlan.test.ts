import { describe, expect, it } from "vitest";
import { baselineTestPlan, testProgress } from "../src/core/protocol/testPlan";
import { exercises } from "../src/core/exercises/registry";

describe("baselineTestPlan", () => {
  const plan = baselineTestPlan();

  it("covers every registered exercise, in a deliberate order", () => {
    expect(plan.steps).toHaveLength(exercises.all().length);
    expect(plan.steps.map((s) => s.exerciseId)).toEqual([
      "echo",
      "route",
      "tonal",
      "silent",
      "missing",
    ]);
  });

  it("names every step against a real exercise", () => {
    for (const step of plan.steps) {
      expect(() => exercises.get(step.exerciseId)).not.toThrow();
    }
  });

  it("gives each step exactly one what sentence and one why sentence", () => {
    for (const step of plan.steps) {
      for (const line of [step.what, step.why]) {
        expect(line.length).toBeGreaterThan(10);
        // One sentence: a single terminating period, at the very end.
        expect(line.trim().endsWith(".")).toBe(true);
        expect(line.replace(/\.$/, "").includes(".")).toBe(false);
      }
    }
  });

  it("measures blind so the baseline never rides on the live display", () => {
    expect(plan.steps.every((s) => s.feedbackMode === "blind")).toBe(true);
  });

  it("totals the trials it will ask for", () => {
    expect(plan.totalTrials).toBe(plan.steps.reduce((n, s) => n + s.trialCount, 0));
    expect(plan.totalTrials).toBeGreaterThanOrEqual(10);
  });
});

describe("testProgress", () => {
  const plan = baselineTestPlan();

  it("starts on the first step with nothing done", () => {
    const p = testProgress(plan, 0)!;
    expect(p.stepIndex).toBe(0);
    expect(p.doneInStep).toBe(0);
    expect(p.stepNumber).toBe(1);
  });

  it("stays in a step until its trials are finished", () => {
    const first = plan.steps[0].trialCount;
    expect(testProgress(plan, first - 1)!.stepIndex).toBe(0);
    expect(testProgress(plan, first)!.stepIndex).toBe(1);
  });

  it("advances through steps as trials accumulate", () => {
    const first = plan.steps[0].trialCount;
    const p = testProgress(plan, first + 1)!;
    expect(p.stepIndex).toBe(1);
    expect(p.doneInStep).toBe(1);
  });

  it("returns null once the whole plan is complete", () => {
    expect(testProgress(plan, plan.totalTrials)).toBeNull();
    expect(testProgress(plan, plan.totalTrials + 5)).toBeNull();
  });
});
