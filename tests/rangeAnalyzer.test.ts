import { describe, expect, it } from "vitest";
import { heldExtremes } from "../src/core/pitch/RangeAnalyzer";

describe("heldExtremes", () => {
  it("returns the note itself for a steady sung note", () => {
    const result = heldExtremes([60, 60.1, 59.9, 60, 60.05]);
    expect(result).not.toBeNull();
    expect(result!.lowMidi).toBeCloseTo(59.9, 5);
    expect(result!.highMidi).toBeCloseTo(60.1, 5);
  });

  it("tracks a slow glide end to end", () => {
    // 0.3 st per frame, 48 -> 72: every step is continuous, so the whole
    // glide is held and the extremes are the endpoints.
    const glide: number[] = [];
    for (let m = 48; m <= 72; m += 0.3) glide.push(m);
    const result = heldExtremes(glide);
    expect(result!.lowMidi).toBeCloseTo(48, 5);
    expect(result!.highMidi).toBeGreaterThan(71.5);
    expect(result!.highMidi).toBeLessThanOrEqual(72);
  });

  it("excludes a single-frame spike (a crack is not range)", () => {
    const result = heldExtremes([60, 60, 60, 84, 60, 60]);
    expect(result!.highMidi).toBe(60);
  });

  it("excludes a two-frame blip: three held frames make a note", () => {
    const result = heldExtremes([60, 60, 60, 79, 79.2, 60, 60]);
    expect(result!.highMidi).toBe(60);
  });

  it("counts a three-frame held extreme", () => {
    const result = heldExtremes([60, 60, 60, 79, 79.2, 79.1, 60, 60]);
    expect(result!.highMidi).toBeCloseTo(79.2, 5);
  });

  it("treats null (silence) as a run break", () => {
    const result = heldExtremes([72, 72, null, 48, 48, null, null, 48]);
    // 72,72 is only a 2-run; 48,48 likewise; the lone 48 too — nothing held.
    expect(result).toBeNull();
  });

  it("returns null for empty or all-silent input", () => {
    expect(heldExtremes([])).toBeNull();
    expect(heldExtremes([null, null])).toBeNull();
  });
});
