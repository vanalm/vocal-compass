import { describe, expect, it } from "vitest";
import { segmentTrace } from "../src/core/trial/segmentTrace";

const point = (t: number, midi = 60) => ({ t, midi, clarity: 0.9 });

describe("segmentTrace", () => {
  it("returns one segment for a continuous trace", () => {
    const trace = [point(0), point(70), point(140), point(210)];
    expect(segmentTrace(trace)).toEqual([trace]);
  });

  it("splits where consecutive samples are further apart than maxGapMs", () => {
    const trace = [point(0), point(70), point(400), point(470)];
    expect(segmentTrace(trace, 150)).toEqual([
      [point(0), point(70)],
      [point(400), point(470)],
    ]);
  });

  it("keeps single-point segments (a lone voiced blip is still data)", () => {
    const trace = [point(0), point(400), point(470)];
    expect(segmentTrace(trace, 150)).toEqual([[point(0)], [point(400), point(470)]]);
  });

  it("returns empty for an empty trace", () => {
    expect(segmentTrace([])).toEqual([]);
  });
});
