import { mean } from "../music/theory";
import type { RangeMeasurement, TrialRecord } from "../types";

export interface Movement {
  first: number;
  latest: number;
  /** Signed change in the metric's own display unit (points, or cents). */
  deltaPts: number;
  /** Did the NUMBER go up? Direction of travel, independent of goodness. */
  rose: boolean;
  /** Is that change good for THIS metric? Falling residual is an improvement. */
  improved: boolean;
}

export interface RangeMovement {
  /** Semitones between held extremes. */
  first: number;
  latest: number;
  deltaSemitones: number;
  improved: boolean;
}

export interface ImprovementSummary {
  destinationAccuracy: Movement;
  independentAccuracy: Movement;
  residualCents: Movement;
  hintRate: Movement;
  range: RangeMovement | null;
  accuracySparkline: number[];
  anyImprovement: boolean;
  windowSize: number;
}

/** Below this there is not enough evidence to claim movement either way. */
const MIN_TRIALS = 10;
const WINDOW = 10;
const SPARK_BUCKETS = 8;

/**
 * Compares the earliest window of scored trials against the most recent one,
 * so the UI can say "you improved X" instead of only showing today's number.
 * Declines are reported as declines - never hidden - because a training loop
 * that only shows good news stops being a measurement.
 */
export function improvementSummary(
  trials: TrialRecord[],
  ranges: RangeMeasurement[],
): ImprovementSummary | null {
  const scored = trials
    .filter((t) => t.scored)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (scored.length < MIN_TRIALS * 2) return null;

  const first = scored.slice(0, WINDOW);
  const latest = scored.slice(-WINDOW);

  const rate = (set: TrialRecord[], pick: (t: TrialRecord) => boolean) =>
    set.filter(pick).length / set.length;
  /**
   * scale converts to the metric's display unit: rates are 0..1 and shown as
   * percentage points (x100); cents are already in their own unit (x1).
   * goodDirection says which way is progress for this particular metric.
   */
  const move = (
    a: number,
    b: number,
    opts: { scale: number; goodDirection: "up" | "down" },
  ): Movement => ({
    first: a,
    latest: b,
    deltaPts: Math.round((b - a) * opts.scale * 10) / 10,
    rose: b > a,
    improved: opts.goodDirection === "up" ? b > a : b < a,
  });
  const higherIsBetter = (a: number, b: number) => move(a, b, { scale: 100, goodDirection: "up" });
  const rateLowerIsBetter = (a: number, b: number) =>
    move(a, b, { scale: 100, goodDirection: "down" });
  const centsLowerIsBetter = (a: number, b: number) =>
    move(a, b, { scale: 1, goodDirection: "down" });

  const residualOf = (set: TrialRecord[]) => {
    const values = set
      .filter((t) => t.destinationMatch && t.targetErrorCents != null)
      .map((t) => Math.abs(t.targetErrorCents as number));
    return values.length ? mean(values) : 0;
  };

  const destinationAccuracy = higherIsBetter(
    rate(first, (t) => t.destinationMatch),
    rate(latest, (t) => t.destinationMatch),
  );
  const independentAccuracy = higherIsBetter(
    rate(first, (t) => t.destinationMatch && t.hintLevel === 0),
    rate(latest, (t) => t.destinationMatch && t.hintLevel === 0),
  );
  const residualCents = centsLowerIsBetter(residualOf(first), residualOf(latest));
  const hintRate = rateLowerIsBetter(
    rate(first, (t) => t.hintLevel > 0),
    rate(latest, (t) => t.hintLevel > 0),
  );

  const span = (m: RangeMeasurement) => m.highMidi - m.lowMidi;
  const sorted = [...ranges].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let range: RangeMovement | null = null;
  if (sorted.length >= 2) {
    const a = span(sorted[0]);
    const b = span(sorted[sorted.length - 1]);
    range = {
      first: a,
      latest: b,
      deltaSemitones: Math.round((b - a) * 10) / 10,
      improved: b > a,
    };
  }

  const bucket = Math.max(1, Math.floor(scored.length / SPARK_BUCKETS));
  const accuracySparkline: number[] = [];
  for (let i = 0; i + bucket <= scored.length; i += bucket) {
    accuracySparkline.push(rate(scored.slice(i, i + bucket), (t) => t.destinationMatch));
  }

  return {
    destinationAccuracy,
    independentAccuracy,
    residualCents,
    hintRate,
    range,
    accuracySparkline,
    anyImprovement: [destinationAccuracy, independentAccuracy, residualCents, hintRate].some(
      (m) => m.improved && m.deltaPts !== 0,
    ) || Boolean(range?.improved),
    windowSize: WINDOW,
  };
}
