import { describe, expect, it } from "vitest";
import { nextActions } from "../src/core/protocol/nextActions";
import type { ExerciseSession, RangeMeasurement, TrialRecord } from "../src/core/types";

const NOW = new Date(2026, 8, 10, 12, 0); // Sep 10, noon
const daysAgo = (n: number, h = 10) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() - n);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

const trial = (i: number, ago: number): TrialRecord =>
  ({ id: `t${i}`, scored: true, createdAt: daysAgo(ago), definition: { targetMidi: 60 } }) as unknown as TrialRecord;
const range = (id: string, ago: number): RangeMeasurement =>
  ({ id, createdAt: daysAgo(ago), lowMidi: 48, highMidi: 70 });
const session = (id: string, ago: number): ExerciseSession =>
  ({ id, createdAt: daysAgo(ago), planId: "vfe", stepsCompleted: 4 });

const manyTrials = (perDayAgo: number[]) =>
  perDayAgo.flatMap((ago, d) => Array.from({ length: 5 }, (_, i) => trial(d * 10 + i, ago)));

describe("nextActions", () => {
  it("puts the baseline test first when it has never been completed", () => {
    const lanes = nextActions(NOW, [], [], []);
    expect(lanes[0].lane).toBe("test");
    expect(lanes[0].due).toBe(true);
  });

  it("drops the test lane once enough trials exist", () => {
    const lanes = nextActions(NOW, manyTrials([0, 1, 2]), [range("r", 1)], [session("s", 0, )]);
    expect(lanes.find((l) => l.lane === "test")).toBeUndefined();
  });

  it("marks range exercises due today with zero overdue when done yesterday", () => {
    const lanes = nextActions(NOW, manyTrials([0, 1, 2, 3]), [range("r", 1)], [session("s", 1)]);
    const ex = lanes.find((l) => l.lane === "range-exercise")!;
    expect(ex.due).toBe(true);
    expect(ex.daysOverdue).toBe(0);
  });

  it("counts days overdue on the daily exercise cadence", () => {
    const lanes = nextActions(NOW, manyTrials([0, 1]), [range("r", 1)], [session("s", 4)]);
    const ex = lanes.find((l) => l.lane === "range-exercise")!;
    expect(ex.daysOverdue).toBe(3);
  });

  it("is satisfied for today once a session is logged today", () => {
    const lanes = nextActions(NOW, manyTrials([0, 1]), [range("r", 1)], [session("s", 0)]);
    expect(lanes.find((l) => l.lane === "range-exercise")!.due).toBe(false);
  });

  it("flags pitch practice after two quiet days", () => {
    const lanes = nextActions(NOW, manyTrials([3, 4, 5]), [range("r", 1)], [session("s", 0)]);
    const pitch = lanes.find((l) => l.lane === "pitch")!;
    expect(pitch.due).toBe(true);
    expect(pitch.daysOverdue).toBe(1);
  });

  it("asks for a range probe weekly", () => {
    const lanes = nextActions(NOW, manyTrials([0]), [range("r", 9)], [session("s", 0)]);
    const probe = lanes.find((l) => l.lane === "range-probe")!;
    expect(probe.due).toBe(true);
    expect(probe.daysOverdue).toBe(2);
  });

  it("sorts the most overdue due lane to the front", () => {
    // Enough trials that the baseline lane (which always outranks) is gone.
    const lanes = nextActions(NOW, manyTrials([0, 1, 2, 3]), [range("r", 20)], [session("s", 5)]);
    expect(lanes[0].due).toBe(true);
    expect(lanes[0].lane).toBe("range-probe"); // 13 days overdue beats 4
    expect(lanes[0].daysOverdue).toBeGreaterThanOrEqual(lanes[1]?.daysOverdue ?? 0);
  });

  it("every lane carries a label and a call to action", () => {
    for (const lane of nextActions(NOW, [], [], [])) {
      expect(lane.title.length).toBeGreaterThan(3);
      expect(lane.cta.length).toBeGreaterThan(2);
    }
  });
});
