import { describe, expect, it } from "vitest";
import { PitchSmoother } from "../src/core/pitch/PitchSmoother";
import { midiToHz } from "../src/core/music/theory";
import type { PitchSample } from "../src/core/types";

function sample(midi: number, at: number, clarity = 0.95): PitchSample {
  return { at, midi, hz: midiToHz(midi), clarity, rms: 0.1 };
}

/** Push a steady stream and return everything the smoother emitted. */
function pushAll(smoother: PitchSmoother, samples: Array<PitchSample | null>) {
  return samples.map((s) => smoother.push(s));
}

describe("PitchSmoother", () => {
  it("passes a steady stream through unchanged", () => {
    const smoother = new PitchSmoother();
    const stream = [60, 60.1, 59.9, 60.05, 60].map((m, i) => sample(m, i * 70));
    const out = pushAll(smoother, stream);
    expect(out.map((s) => s?.midi)).toEqual(stream.map((s) => s.midi));
  });

  it("drops low-clarity samples", () => {
    const smoother = new PitchSmoother();
    smoother.push(sample(60, 0));
    expect(smoother.push(sample(60, 70, 0.4))).toBeNull();
  });

  it("passes null through as null", () => {
    const smoother = new PitchSmoother();
    expect(smoother.push(null)).toBeNull();
  });

  it("suppresses a single-frame spike (the jumpy-trace artifact)", () => {
    const smoother = new PitchSmoother();
    const out = pushAll(smoother, [
      sample(60, 0),
      sample(60.1, 70),
      sample(59.9, 140),
      sample(75, 210), // one-frame detector glitch
      sample(60, 280),
      sample(60.1, 350),
    ]);
    expect(out[3]).toBeNull();
    expect(out[4]?.midi).toBe(60);
    expect(out[5]?.midi).toBe(60.1);
  });

  it("suppresses a single-frame octave flip rather than folding it", () => {
    const smoother = new PitchSmoother();
    const out = pushAll(smoother, [
      sample(60, 0),
      sample(60, 70),
      sample(72, 140), // octave error for one frame
      sample(60, 210),
    ]);
    expect(out[2]).toBeNull();
    expect(out[3]?.midi).toBe(60);
  });

  it("accepts a sustained leap after one confirming frame (real octave jumps survive)", () => {
    const smoother = new PitchSmoother();
    const out = pushAll(smoother, [
      sample(60, 0),
      sample(60, 70),
      sample(72, 140), // real leap begins
      sample(72.1, 210), // confirmed
      sample(72, 280),
    ]);
    expect(out[2]).toBeNull(); // one-frame confirmation cost
    expect(out[3]?.midi).toBe(72.1);
    expect(out[4]?.midi).toBe(72);
  });

  it("does not confirm a pending leap with a frame far from the pending value", () => {
    const smoother = new PitchSmoother();
    const out = pushAll(smoother, [
      sample(60, 0),
      sample(60, 70),
      sample(72, 140), // glitch up
      sample(48, 210), // glitch down — disagrees with pending
      sample(60, 280),
    ]);
    expect(out[2]).toBeNull();
    expect(out[3]).toBeNull();
    expect(out[4]?.midi).toBe(60);
  });

  it("starts fresh after a silence gap instead of judging against stale history", () => {
    const smoother = new PitchSmoother();
    smoother.push(sample(60, 0));
    smoother.push(sample(60, 70));
    // 500ms of silence, then re-entry a sixth away: accepted immediately.
    const reentry = smoother.push(sample(69, 640));
    expect(reentry?.midi).toBe(69);
  });

  it("reset clears history", () => {
    const smoother = new PitchSmoother();
    smoother.push(sample(60, 0));
    smoother.push(sample(60, 70));
    smoother.reset();
    expect(smoother.push(sample(72, 140))?.midi).toBe(72);
  });
});
