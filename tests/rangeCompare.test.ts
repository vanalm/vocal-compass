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
  it("warns when the microphone filter differed between measurements", () => {
    const result = compareRange(
      { lowMidi: 40, highMidi: 60, method: "guided-turns", micLowCut: "80" },
      { lowMidi: 37, highMidi: 60, method: "guided-turns", micLowCut: "60" },
    )!;
    expect(result.caveat).toMatch(/filter/i);
  });

  it("treats measurements from before the setting existed as the old fixed 80 Hz filter", () => {
    const result = compareRange(
      { lowMidi: 40, highMidi: 60, method: "guided-turns" },
      { lowMidi: 40, highMidi: 61, method: "guided-turns", micLowCut: "80" },
    )!;
    expect(result.caveat).toBeNull();
  });

  it("names both differences when the method and the filter changed", () => {
    const result = compareRange(
      { lowMidi: 45, highMidi: 65 },
      { lowMidi: 44, highMidi: 69, method: "guided-turns", micLowCut: "60" },
    )!;
    expect(result.caveat).toMatch(/method/i);
    expect(result.caveat).toMatch(/filter/i);
  });
});
