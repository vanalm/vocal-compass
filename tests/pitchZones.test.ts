import { describe, expect, it } from "vitest";
import { pitchZones } from "../src/core/kpi/pitchZones";
import type { TrialRecord } from "../src/core/types";

function trial(targetMidi: number, ok: boolean, scored = true): TrialRecord {
  return {
    scored,
    destinationMatch: ok,
    definition: { targetMidi },
  } as unknown as TrialRecord;
}

describe("pitchZones", () => {
  it("returns empty for no scored trials", () => {
    expect(pitchZones([])).toEqual([]);
    expect(pitchZones([trial(60, true, false)])).toEqual([]);
  });

  it("buckets targets into 3-semitone zones anchored on multiples of 3", () => {
    const zones = pitchZones([trial(60, true), trial(61, false), trial(64, true)]);
    expect(zones.map((z) => z.lowMidi)).toEqual([60, 63]);
    expect(zones[0].scored).toBe(2);
    expect(zones[1].scored).toBe(1);
  });

  it("computes destination accuracy per zone", () => {
    const zones = pitchZones([trial(60, true), trial(60, true), trial(61, false), trial(61, false)]);
    expect(zones[0].accuracy).toBeCloseTo(0.5, 5);
  });

  it("includes empty zones between occupied ones so the map reads as a contiguous axis", () => {
    const zones = pitchZones([trial(48, true), trial(57, false)]);
    expect(zones.map((z) => z.lowMidi)).toEqual([48, 51, 54, 57]);
    expect(zones[1].scored).toBe(0);
    expect(zones[1].accuracy).toBeNull();
  });

  it("labels zones with note names", () => {
    const [zone] = pitchZones([trial(60, true)]);
    expect(zone.label).toContain("C4");
  });

  it("ignores unscored trials in occupied zones", () => {
    const zones = pitchZones([trial(60, true), trial(60, false, false)]);
    expect(zones[0].scored).toBe(1);
    expect(zones[0].accuracy).toBe(1);
  });
});
