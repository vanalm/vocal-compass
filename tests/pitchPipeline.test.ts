import { describe, expect, it } from "vitest";
import { PitchPipeline } from "../src/core/pitch/PitchPipeline";
import type { PitchDetector, PitchEstimate } from "../src/core/pitch/PitchDetector";

/** Detector that replays a script, independent of buffer content. */
function stubDetector(script: () => PitchEstimate | null): PitchDetector {
  return { name: "stub", estimate: script };
}

const SR = 48000;
const silentBuffer = new Float32Array(2048);
const buffer = (amplitude: number) => new Float32Array(2048).fill(amplitude);

const voice = (rms = 0.1): PitchEstimate => ({ hz: 220, clarity: 0.95, rms });

describe("PitchPipeline", () => {
  it("emits a raw and smoothed sample for a clean voiced estimate", () => {
    const pipeline = new PitchPipeline(stubDetector(() => voice()));
    const frame = pipeline.process(buffer(0.1), SR, 1000);
    expect(frame.raw?.hz).toBe(220);
    expect(frame.raw?.midi).toBeCloseTo(57, 1); // A3
    expect(frame.raw?.at).toBe(1000);
    expect(frame.smoothed?.hz).toBe(220);
  });

  it("reports the frame's loudness even when nothing is voiced (mic-activity feedback)", () => {
    const pipeline = new PitchPipeline(stubDetector(() => null));
    expect(pipeline.process(buffer(0.05), SR, 0).level).toBeCloseTo(0.05, 3);
    expect(pipeline.process(silentBuffer, SR, 70).level).toBe(0);
  });

  it("uses the estimate's rms as the level on voiced frames", () => {
    const pipeline = new PitchPipeline(stubDetector(() => voice(0.12)));
    expect(pipeline.process(buffer(0.12), SR, 0).level).toBeCloseTo(0.12, 5);
  });

  it("emits null raw on silence and reports the noise state", () => {
    const pipeline = new PitchPipeline(stubDetector(() => null));
    const frame = pipeline.process(silentBuffer, SR, 0);
    expect(frame.raw).toBeNull();
    expect(frame.smoothed).toBeNull();
    expect(frame.noise.threshold).toBe(0.008);
    expect(frame.noise.tooNoisy).toBe(false);
  });

  it("learns the floor from unvoiced frames", () => {
    const pipeline = new PitchPipeline(stubDetector(() => null));
    let frame = pipeline.process(buffer(0.02), SR, 0);
    for (let i = 1; i <= 50; i += 1) frame = pipeline.process(buffer(0.02), SR, i * 70);
    expect(frame.noise.threshold).toBeCloseTo(0.06, 3);
  });

  it("gates an estimate whose rms is below the learned threshold", () => {
    let est: PitchEstimate | null = null;
    const pipeline = new PitchPipeline(stubDetector(() => est));
    for (let i = 0; i < 50; i += 1) pipeline.process(buffer(0.02), SR, i * 70);
    est = voice(0.03); // audible pitch, but below 3x the 0.02 floor
    expect(pipeline.process(buffer(0.03), SR, 5000).raw).toBeNull();
    est = voice(0.1); // clearly above the noise
    expect(pipeline.process(buffer(0.1), SR, 5070).raw?.hz).toBe(220);
  });

  it("does not let voiced frames raise the noise floor while singing", () => {
    const pipeline = new PitchPipeline(stubDetector(() => voice(0.1)));
    for (let i = 0; i < 50; i += 1) pipeline.process(buffer(0.1), SR, i * 70);
    expect(pipeline.process(buffer(0.1), SR, 5000).noise.threshold).toBe(0.008);
  });

  it("drops estimates outside the singable range", () => {
    const pipeline = new PitchPipeline(
      stubDetector(() => ({ hz: 30, clarity: 0.9, rms: 0.1 })),
    );
    expect(pipeline.process(buffer(0.1), SR, 0).raw).toBeNull();
  });

  it("flags tooNoisy on the frame when the environment is too loud", () => {
    const pipeline = new PitchPipeline(stubDetector(() => null));
    let frame = pipeline.process(silentBuffer, SR, 0);
    for (let i = 0; i < 50; i += 1) frame = pipeline.process(buffer(0.08), SR, i * 70);
    expect(frame.noise.tooNoisy).toBe(true);
  });

  it("reset restores the initial gate and clears the smoother", () => {
    const pipeline = new PitchPipeline(stubDetector(() => null));
    for (let i = 0; i < 50; i += 1) pipeline.process(buffer(0.08), SR, i * 70);
    pipeline.reset();
    const frame = pipeline.process(silentBuffer, SR, 9999);
    expect(frame.noise.threshold).toBe(0.008);
    expect(frame.noise.tooNoisy).toBe(false);
  });
});
