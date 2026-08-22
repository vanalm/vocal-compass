import { describe, expect, it } from "vitest";
import { MpmDetector } from "../src/core/pitch/MpmDetector";

const SAMPLE_RATE = 48000;
const FRAME = 2048;

function sine(f0: number, amplitude = 0.3, length = FRAME): Float32Array {
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    out[i] = amplitude * Math.sin((2 * Math.PI * f0 * i) / SAMPLE_RATE);
  }
  return out;
}

/** Harmonic-rich tone with a *weak* fundamental — the classic octave-error trap. */
function voiceLike(f0: number, length = FRAME): Float32Array {
  const out = new Float32Array(length);
  const partials: Array<[number, number]> = [
    [1, 0.35],
    [2, 1.0],
    [3, 0.55],
    [4, 0.25],
  ];
  for (let i = 0; i < length; i += 1) {
    let v = 0;
    for (const [h, a] of partials) {
      v += a * Math.sin((2 * Math.PI * f0 * h * i) / SAMPLE_RATE);
    }
    out[i] = 0.2 * v;
  }
  return out;
}

function centsOff(estimated: number, expected: number): number {
  return Math.abs(1200 * Math.log2(estimated / expected));
}

describe("MpmDetector", () => {
  const detector = new MpmDetector();

  it("names itself for provenance in records", () => {
    expect(detector.name).toContain("mpm");
  });

  it.each([110, 220, 440])("estimates a %dHz sine within 20 cents", (f0) => {
    const estimate = detector.estimate(sine(f0), SAMPLE_RATE);
    expect(estimate).not.toBeNull();
    expect(centsOff(estimate!.hz, f0)).toBeLessThan(20);
  });

  // The old global-max autocorrelation flips octaves on exactly these inputs:
  // strong second harmonic, low fundamental (male vocal range).
  it.each([98, 130.81, 155.56])(
    "does not octave-flip on a harmonic-rich %fHz tone",
    (f0) => {
      const estimate = detector.estimate(voiceLike(f0), SAMPLE_RATE);
      expect(estimate).not.toBeNull();
      expect(centsOff(estimate!.hz, f0)).toBeLessThan(30);
    },
  );

  it("returns null on silence", () => {
    expect(detector.estimate(new Float32Array(FRAME), SAMPLE_RATE)).toBeNull();
  });

  it("returns null below the RMS gate", () => {
    expect(detector.estimate(sine(220, 0.001), SAMPLE_RATE)).toBeNull();
  });

  it("reports clarity in 0..1 and the measured rms", () => {
    const estimate = detector.estimate(sine(220), SAMPLE_RATE);
    expect(estimate!.clarity).toBeGreaterThan(0.9);
    expect(estimate!.clarity).toBeLessThanOrEqual(1);
    expect(estimate!.rms).toBeCloseTo(0.3 / Math.SQRT2, 2);
  });

  it("handles changing buffer sizes without breaking", () => {
    expect(detector.estimate(sine(220, 0.3, 2048), SAMPLE_RATE)).not.toBeNull();
    expect(detector.estimate(sine(220, 0.3, 4096), SAMPLE_RATE)).not.toBeNull();
  });
});
