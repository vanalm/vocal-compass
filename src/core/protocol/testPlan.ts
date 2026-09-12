import type { FeedbackMode } from "../types";
import type { Difficulty } from "../exercises/Exercise";

/**
 * One step of the test. Instructions are not stored here: they come from the
 * exercise's own guide, so the test, the info modal, and the Lab always say
 * the same thing.
 */
export interface TestStep {
  exerciseId: string;
  trialCount: number;
  feedbackMode: FeedbackMode;
  difficulty: Difficulty;
  delayMs: number;
}

export interface TestPlan {
  id: string;
  title: string;
  steps: TestStep[];
  totalTrials: number;
}

export interface TestProgress {
  stepIndex: number;
  /** 1-based, for display. */
  stepNumber: number;
  stepCount: number;
  doneInStep: number;
  step: TestStep;
}

/**
 * The baseline test: every module once, blind, in an order that goes from the
 * least to the most memory load. Blind throughout because a baseline measured
 * with the live display on measures the display, not the singer.
 */
export function baselineTestPlan(): TestPlan {
  const step = (exerciseId: string, delayMs = 0): TestStep => ({
    exerciseId,
    trialCount: 3,
    feedbackMode: "blind",
    difficulty: "steps",
    delayMs,
  });
  const steps: TestStep[] = [
    step("echo"),
    step("route"),
    step("tonal"),
    step("silent", 2000),
    step("missing"),
  ];
  return {
    id: "baseline",
    title: "Baseline test",
    steps,
    totalTrials: steps.reduce((n, s) => n + s.trialCount, 0),
  };
}

/**
 * Where the run stands after `completed` saved trials. Returns null when the
 * plan is finished, which is the signal to show the summary.
 */
export function testProgress(plan: TestPlan, completed: number): TestProgress | null {
  if (completed >= plan.totalTrials) return null;
  let remaining = completed;
  for (let i = 0; i < plan.steps.length; i += 1) {
    const step = plan.steps[i];
    if (remaining < step.trialCount) {
      return {
        stepIndex: i,
        stepNumber: i + 1,
        stepCount: plan.steps.length,
        doneInStep: remaining,
        step,
      };
    }
    remaining -= step.trialCount;
  }
  return null;
}
