import { median } from "../music/theory";
import type { KpiSummary, TrialRecord } from "../types";

/**
 * KPI engine (PRD §12). Deliberately never emits one "singing score":
 * destination selection, availability, latency, hints, loss, and recovery
 * are reported separately.
 */
export class KpiCalculator {
  summarize(trials: TrialRecord[]): KpiSummary {
    const scored = trials.filter((t) => t.scored);
    const correct = scored.filter((t) => t.destinationMatch && t.finalErrorKind === "success");
    const independent = correct.filter((t) => t.hintLevel === 0);
    const latencies = scored
      .map((t) => t.selectionLatencyMs)
      .filter((v): v is number => v != null);
    const recoveries = scored
      .map((t) => t.recoveryTimeMs)
      .filter((v): v is number => v != null);
    const correctResiduals = correct
      .map((t) => t.targetErrorCents)
      .filter((v): v is number => v != null)
      .map(Math.abs);
    const available = scored.filter(
      (t) => !t.lostEvent && t.finalErrorKind !== "no-target",
    );

    return {
      total: trials.length,
      scored: scored.length,
      destinationAccuracy: ratio(correct.length, scored.length),
      independentAccuracy: ratio(independent.length, scored.length),
      availabilityRate: ratio(available.length, scored.length),
      medianLatencyMs: median(latencies),
      hintRate: ratio(scored.filter((t) => t.hintLevel > 0).length, scored.length),
      mapLossRate: ratio(
        scored.filter((t) => t.lostEvent || t.finalErrorKind === "no-target").length,
        scored.length,
      ),
      medianRecoveryMs: median(recoveries),
      correctTargetMedianResidual: median(correctResiduals),
    };
  }

  /** Accuracy by exercise id, for the Today recommender and Progress charts. */
  byExercise(trials: TrialRecord[]): Map<string, KpiSummary> {
    const groups = new Map<string, TrialRecord[]>();
    for (const t of trials) {
      const list = groups.get(t.definition.exerciseId) ?? [];
      list.push(t);
      groups.set(t.definition.exerciseId, list);
    }
    return new Map([...groups].map(([id, list]) => [id, this.summarize(list)]));
  }

  /** Retention curve: destination accuracy bucketed by silent delay. */
  byDelay(trials: TrialRecord[]): Array<{ delayMs: number; accuracy: number; n: number }> {
    const groups = new Map<number, TrialRecord[]>();
    for (const t of trials.filter((t) => t.scored)) {
      const list = groups.get(t.definition.delayMs) ?? [];
      list.push(t);
      groups.set(t.definition.delayMs, list);
    }
    return [...groups]
      .map(([delayMs, list]) => ({
        delayMs,
        accuracy: ratio(list.filter((t) => t.finalErrorKind === "success").length, list.length),
        n: list.length,
      }))
      .sort((a, b) => a.delayMs - b.delayMs);
  }

  /** Rolling destination accuracy over recent sessions for the trend chart. */
  trend(trials: TrialRecord[], bucketSize = 10): Array<{ index: number; accuracy: number }> {
    const scored = trials.filter((t) => t.scored);
    const points: Array<{ index: number; accuracy: number }> = [];
    for (let i = 0; i < scored.length; i += bucketSize) {
      const bucket = scored.slice(i, i + bucketSize);
      points.push({
        index: points.length,
        accuracy: ratio(bucket.filter((t) => t.finalErrorKind === "success").length, bucket.length),
      });
    }
    return points;
  }
}

function ratio(numerator: number, denominator: number): number {
  return denominator ? numerator / denominator : 0;
}
