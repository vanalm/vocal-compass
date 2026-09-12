import { describe, expect, it } from "vitest";
import { compareRange } from "../src/core/protocol/rangePlan";

describe("compareRange", () => {
  it("returns null with nothing to compare against", () => {
    expect(compareRange(undefined, { lowMidi: 45, highMidi: 69, method: "guided-turns" })).toBeNull();
  });

  it("judges the change in span against measurement noise", () => {
    const result = compareRange(
      { lowMidi: 45, highMidi: 65, method: "guided-turns" },
      { lowMidi: 45, highMidi: 69, method: "guided-turns" },
    )!;
    expect(result.verdict.deltaSemitones).toBe(4);
    expect(result.verdict.meaningful).toBe(true);
    expect(result.caveat).toBeNull();
  });

  it("warns when the two measurements used different methods", () => {
    const result = compareRange({ lowMidi: 45, highMidi: 65 }, { lowMidi: 45, highMidi: 69, method: "guided-turns" })!;
    expect(result.caveat).toMatch(/different method/i);
  });
});
