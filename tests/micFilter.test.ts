import { describe, expect, it } from "vitest";
import {
  DEFAULT_LOW_CUT,
  LEGACY_LOW_CUT,
  LOW_CUT_OPTIONS,
  lowCutLabel,
  lowCutNodeConfig,
  lowNoteFilterAdvice,
  noiseFilterAdvice,
} from "../src/core/pitch/micFilter";
import type { RangeStepResult } from "../src/core/types";

const step = (partial: Partial<RangeStepResult> & { targetMidi: number }): RangeStepResult => ({
  direction: "down",
  attempt: 1,
  hit: true,
  octaveOff: null,
  sungMidi: partial.targetMidi,
  centsOff: 0,
  timeToMatchMs: 800,
  startedAt: 0,
  endedAt: 800,
  ...partial,
});

/** A walk that matched every note from the start down to `floor`, then the given misses below it. */
function walkTo(floor: number, missesBelow: Array<Partial<RangeStepResult>>): RangeStepResult[] {
  const steps: RangeStepResult[] = [step({ targetMidi: 57, direction: "anchor" })];
  for (let m = 56; m >= floor; m -= 1) steps.push(step({ targetMidi: m }));
  missesBelow.forEach((miss, i) =>
    steps.push(step({ targetMidi: floor - 1, hit: false, timeToMatchMs: null, attempt: i + 1, ...miss })),
  );
  return steps;
}

describe("low-cut filter options", () => {
  it("offers off, standard, noisy and very noisy, defaulting to standard", () => {
    expect(LOW_CUT_OPTIONS.map((o) => o.id)).toEqual(["off", "60", "80", "100"]);
    expect(DEFAULT_LOW_CUT).toBe("60");
  });

  it("remembers that everything measured before the setting existed used 80 Hz", () => {
    expect(LEGACY_LOW_CUT).toBe("80");
  });

  it("explains every option in one plain sentence", () => {
    for (const option of LOW_CUT_OPTIONS) {
      expect(option.label.length).toBeGreaterThan(1);
      expect(option.when.trim().endsWith(".")).toBe(true);
    }
  });

  it("labels options with their cutoff", () => {
    expect(lowCutLabel("60")).toBe("Standard (60 Hz)");
    expect(lowCutLabel("off")).toBe("Off");
  });

  it("off cuts nothing; the others are high-pass filters at their cutoff", () => {
    expect(lowCutNodeConfig("off").type).toBe("allpass");
    expect(lowCutNodeConfig("60")).toEqual({ type: "highpass", frequency: 60, Q: expect.closeTo(0.707, 3) });
    expect(lowCutNodeConfig("100").frequency).toBe(100);
  });
});

describe("lowNoteFilterAdvice — when the filter, not the voice, set the floor", () => {
  it("reproduces the finding: under 80 Hz the right note kept dropping out at the bottom", () => {
    const advice = lowNoteFilterAdvice(walkTo(37, [{ sungMidi: 36.02, centsOff: 2 }]), "80");
    expect(advice).not.toBeNull();
    expect(advice!.kind).toBe("lower");
    expect(advice!.suggest).toBe("60");
    expect(advice!.message).toMatch(/80 Hz/);
  });

  it("no steady note heard just below the floor also points at the filter", () => {
    expect(lowNoteFilterAdvice(walkTo(40, [{ sungMidi: null, centsOff: null }]), "80")?.suggest).toBe("60");
  });

  it("stays quiet when the floor sits well above where the filter cuts", () => {
    expect(lowNoteFilterAdvice(walkTo(45, [{ sungMidi: null, centsOff: null }]), "60")).toBeNull();
  });

  it("stays quiet when the singer clearly sang a different note — that is the voice's limit", () => {
    expect(lowNoteFilterAdvice(walkTo(40, [{ sungMidi: 42, centsOff: 300 }]), "80")).toBeNull();
  });

  it("stays quiet for a wrong-octave answer", () => {
    expect(lowNoteFilterAdvice(walkTo(40, [{ sungMidi: 51, centsOff: 1200, octaveOff: 1 }]), "80")).toBeNull();
  });

  it("stays quiet without any misses below the floor", () => {
    expect(lowNoteFilterAdvice(walkTo(40, []), "80")).toBeNull();
  });

  it("stays quiet when the filter is already off", () => {
    expect(lowNoteFilterAdvice(walkTo(37, [{ sungMidi: null, centsOff: null }]), "off")).toBeNull();
  });

  it("suggests the next setting down", () => {
    expect(lowNoteFilterAdvice(walkTo(45, [{ sungMidi: null, centsOff: null }]), "100")?.suggest).toBe("80");
    expect(lowNoteFilterAdvice(walkTo(40, [{ sungMidi: null, centsOff: null }]), "80")?.suggest).toBe("60");
  });

  it("stays quiet at 60 Hz: that cutoff sits below the lowest note the walk measures, so turning it off reveals nothing", () => {
    expect(lowNoteFilterAdvice(walkTo(37, [{ sungMidi: null, centsOff: null }]), "60")).toBeNull();
  });

  it("every retry below the floor must look like a dropout", () => {
    const mixed = walkTo(40, [
      { sungMidi: null, centsOff: null },
      { sungMidi: 42, centsOff: 300 },
    ]);
    expect(lowNoteFilterAdvice(mixed, "80")).toBeNull();
  });
});

describe("noiseFilterAdvice — when rumble swamped the singer's turns", () => {
  it("suggests the noisy setting from off or standard", () => {
    expect(noiseFilterAdvice(0.5, "60")).toMatchObject({ kind: "raise", suggest: "80" });
    expect(noiseFilterAdvice(0.5, "off")).toMatchObject({ kind: "raise", suggest: "80" });
  });

  it("steps up from noisy to very noisy, and has nothing above that", () => {
    expect(noiseFilterAdvice(0.5, "80")?.suggest).toBe("100");
    expect(noiseFilterAdvice(0.9, "100")).toBeNull();
  });

  it("stays quiet when noise was only occasional", () => {
    expect(noiseFilterAdvice(0.1, "60")).toBeNull();
  });

  it("says a low-cut only helps with rumble", () => {
    expect(noiseFilterAdvice(0.5, "60")!.message).toMatch(/rumble/i);
  });
});
