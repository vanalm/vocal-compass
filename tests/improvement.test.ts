import { describe, expect, it } from "vitest";
import { improvementSummary } from "../src/core/kpi/improvement";
import type { RangeMeasurement, TrialRecord } from "../src/core/types";

function trial(i: number, ok: boolean, residual = 40): TrialRecord {
  return {
    id: `t${i}`,
    scored: true,
    destinationMatch: ok,
    cleanLandingOnSelected: ok,
    targetErrorCents: residual,
    hintLevel: 0,
    selectionLatencyMs: 1000,
    createdAt: new Date(2026, 7, 1 + i).toISOString(),
    definition: { targetMidi: 60 },
  } as unknown as TrialRecord;
}

const range = (id: string, low: number, high: number, day: number): RangeMeasurement => ({
  id,
  createdAt: new Date(2026, 7, day).toISOString(),
  lowMidi: low,
  highMidi: high,
});

describe("improvementSummary", () => {
  it("returns null with too little data to compare honestly", () => {
    expect(improvementSummary([], [])).toBeNull();
    const few = Array.from({ length: 9 }, (_, i) => trial(i, true));
    expect(improvementSummary(few, [])).toBeNull();
  });

  it("reports accuracy gain between the earliest and latest windows", () => {
    // First 10 all miss, last 10 all hit.
    const trials = [
      ...Array.from({ length: 10 }, (_, i) => trial(i, false)),
      ...Array.from({ length: 10 }, (_, i) => trial(10 + i, true)),
    ];
    const summary = improvementSummary(trials, [])!;
    expect(summary.destinationAccuracy.first).toBe(0);
    expect(summary.destinationAccuracy.latest).toBe(1);
    expect(summary.destinationAccuracy.deltaPts).toBe(100);
    expect(summary.destinationAccuracy.improved).toBe(true);
  });

  it("scales rate metrics to percentage points, not fractions", () => {
    // Hints on every early trial, none late: that is a 100-point drop.
    const withHint = (i: number) => ({ ...trial(i, true), hintLevel: 1 }) as TrialRecord;
    const trials = [
      ...Array.from({ length: 10 }, (_, i) => withHint(i)),
      ...Array.from({ length: 10 }, (_, i) => trial(10 + i, true)),
    ];
    const summary = improvementSummary(trials, [])!;
    expect(summary.hintRate.deltaPts).toBe(-100);
    expect(summary.hintRate.improved).toBe(true);
    expect(summary.hintRate.rose).toBe(false);
  });

  it("separates which way the number moved from whether that is good", () => {
    // Residual falling 90 -> 30 is a DROP in the number and an improvement.
    const trials = [
      ...Array.from({ length: 10 }, (_, i) => trial(i, true, 90)),
      ...Array.from({ length: 10 }, (_, i) => trial(10 + i, true, 30)),
    ];
    const summary = improvementSummary(trials, [])!;
    expect(summary.residualCents.rose).toBe(false);
    expect(summary.residualCents.improved).toBe(true);
    expect(summary.residualCents.deltaPts).toBeCloseTo(-60, 5);
  });

  it("treats falling residual cents as an improvement (lower is better)", () => {
    const trials = [
      ...Array.from({ length: 10 }, (_, i) => trial(i, true, 90)),
      ...Array.from({ length: 10 }, (_, i) => trial(10 + i, true, 30)),
    ];
    const summary = improvementSummary(trials, [])!;
    expect(summary.residualCents.first).toBeCloseTo(90, 5);
    expect(summary.residualCents.latest).toBeCloseTo(30, 5);
    expect(summary.residualCents.improved).toBe(true);
  });

  it("marks a decline as not improved rather than hiding it", () => {
    const trials = [
      ...Array.from({ length: 10 }, (_, i) => trial(i, true)),
      ...Array.from({ length: 10 }, (_, i) => trial(10 + i, false)),
    ];
    const summary = improvementSummary(trials, [])!;
    expect(summary.destinationAccuracy.deltaPts).toBe(-100);
    expect(summary.destinationAccuracy.improved).toBe(false);
  });

  it("reports range gain in semitones from first to latest measurement", () => {
    const trials = Array.from({ length: 20 }, (_, i) => trial(i, true));
    const ranges = [range("r1", 48, 68, 1), range("r2", 46, 70, 20)];
    const summary = improvementSummary(trials, ranges)!;
    expect(summary.range!.first).toBeCloseTo(20, 5);
    expect(summary.range!.latest).toBeCloseTo(24, 5);
    expect(summary.range!.deltaSemitones).toBeCloseTo(4, 5);
    expect(summary.range!.improved).toBe(true);
  });

  it("omits range when there is only one measurement to compare", () => {
    const trials = Array.from({ length: 20 }, (_, i) => trial(i, true));
    expect(improvementSummary(trials, [range("r1", 48, 68, 1)])!.range).toBeNull();
  });

  it("exposes a sparkline series for the accuracy trend", () => {
    const trials = Array.from({ length: 30 }, (_, i) => trial(i, i > 15));
    const summary = improvementSummary(trials, [])!;
    expect(summary.accuracySparkline.length).toBeGreaterThan(1);
    expect(summary.accuracySparkline.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("says whether anything improved at all", () => {
    const trials = [
      ...Array.from({ length: 10 }, (_, i) => trial(i, false)),
      ...Array.from({ length: 10 }, (_, i) => trial(10 + i, true)),
    ];
    expect(improvementSummary(trials, [])!.anyImprovement).toBe(true);
  });
});
