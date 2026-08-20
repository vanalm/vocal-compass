import type { Exercise } from "../exercises/Exercise";
import { KpiCalculator } from "../kpi/KpiCalculator";
import type { TrialRecord } from "../types";

export interface Recommendation {
  exercise: Exercise;
  reason: string;
}

/**
 * Chooses today's session (PRD §11.3): the module with the largest deficit,
 * always with a plain-language reason. Unpracticed modules are sampled first
 * so a baseline emerges naturally.
 */
export class Recommender {
  constructor(private readonly kpi: KpiCalculator = new KpiCalculator()) {}

  recommend(trials: TrialRecord[], available: Exercise[]): Recommendation {
    const byExercise = this.kpi.byExercise(trials);

    const unpracticed = available.find(
      (e) => (byExercise.get(e.id)?.scored ?? 0) < 8,
    );
    if (unpracticed) {
      return {
        exercise: unpracticed,
        reason: `“${unpracticed.title}” has fewer than 8 scored trials — run it to complete your baseline map.`,
      };
    }

    let weakest = available[0];
    let weakestAccuracy = Infinity;
    for (const e of available) {
      const accuracy = byExercise.get(e.id)?.independentAccuracy ?? 0;
      if (accuracy < weakestAccuracy) {
        weakestAccuracy = accuracy;
        weakest = e;
      }
    }
    return {
      exercise: weakest,
      reason: `Independent destination accuracy is lowest on “${weakest.title}” (${Math.round(weakestAccuracy * 100)}%). Training the largest deficit first.`,
    };
  }
}
