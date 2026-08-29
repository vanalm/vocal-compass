import type { FeedbackMode } from "../types";

export interface TestStep {
  exerciseId: string;
  /** What you will do — one sentence, no jargon. */
  what: string;
  /** Why it is being measured — one sentence. */
  why: string;
  trialCount: number;
  feedbackMode: FeedbackMode;
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
  const steps: TestStep[] = [
    {
      exerciseId: "echo",
      what: "Hear one note and sing it straight back.",
      why: "It separates plain pitch-matching from everything that needs memory or context.",
      trialCount: 3,
      feedbackMode: "blind",
      delayMs: 0,
    },
    {
      exerciseId: "route",
      what: "Hear a start note travel to a destination, then sing that destination from the start alone.",
      why: "Melodic intervals are what songs are actually made of, and they improve faster than single notes.",
      trialCount: 3,
      feedbackMode: "blind",
      delayMs: 0,
    },
    {
      exerciseId: "tonal",
      what: "Use the key you just heard to find a named scale degree.",
      why: "It shows whether you navigate from the key itself rather than only from the last note you heard.",
      trialCount: 3,
      feedbackMode: "blind",
      delayMs: 0,
    },
    {
      exerciseId: "silent",
      what: "Hold the target in your head through two seconds of silence, then sing it.",
      why: "Silence is where a target is lost, so this measures whether it survives without a sounding reference.",
      trialCount: 3,
      feedbackMode: "blind",
      delayMs: 2000,
    },
    {
      exerciseId: "missing",
      what: "Hear a phrase with its last note removed and supply the note that belongs there.",
      why: "It tests whether the key and phrase together predict a destination you were never given.",
      trialCount: 3,
      feedbackMode: "blind",
      delayMs: 0,
    },
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
