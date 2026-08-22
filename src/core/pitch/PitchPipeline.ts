import { hzToMidi } from "../music/theory";
import type { PitchSample } from "../types";
import { MpmDetector } from "./MpmDetector";
import { NoiseFloorTracker } from "./NoiseFloorTracker";
import { rootMeanSquare, type PitchDetector } from "./PitchDetector";
import { PitchSmoother } from "./PitchSmoother";

export interface NoiseState {
  floor: number;
  threshold: number;
  /** Ambient level too high to separate quiet singing from the room. */
  tooNoisy: boolean;
}

/**
 * One polling tick of pitch data. `raw` is the ungated detector estimate —
 * use it for voicing-onset timing (selection latency). `smoothed` has passed
 * the clarity gate and spike suppression — use it for traces and display.
 */
export interface PitchFrame {
  raw: PitchSample | null;
  smoothed: PitchSample | null;
  noise: NoiseState;
}

export interface PipelineOptions {
  minHz: number;
  maxHz: number;
  /** At or above this clarity a frame counts as voiced and never feeds the noise floor. */
  voicedClarity: number;
}

const DEFAULTS: PipelineOptions = {
  minHz: 60,
  maxHz: 1200,
  voicedClarity: 0.5,
};

/**
 * The per-tick pitch path: detector -> adaptive noise gate -> smoother.
 * Pure with respect to audio plumbing (a buffer goes in, a frame comes out),
 * so the whole gating truth table is unit-testable with a stubbed detector.
 */
export class PitchPipeline {
  constructor(
    private readonly detector: PitchDetector = new MpmDetector(),
    private readonly smoother: PitchSmoother = new PitchSmoother(),
    private readonly noise: NoiseFloorTracker = new NoiseFloorTracker(),
    private readonly opts: PipelineOptions = DEFAULTS,
  ) {}

  process(buffer: Float32Array, sampleRate: number, at: number): PitchFrame {
    const estimate = this.detector.estimate(buffer, sampleRate);
    const voiced = estimate != null && estimate.clarity >= this.opts.voicedClarity;
    if (!voiced) this.noise.update(estimate?.rms ?? rootMeanSquare(buffer));

    let raw: PitchSample | null = null;
    if (
      estimate &&
      estimate.hz >= this.opts.minHz &&
      estimate.hz <= this.opts.maxHz &&
      estimate.rms >= this.noise.threshold
    ) {
      raw = {
        at,
        hz: estimate.hz,
        midi: hzToMidi(estimate.hz),
        clarity: estimate.clarity,
        rms: estimate.rms,
      };
    }
    return {
      raw,
      smoothed: this.smoother.push(raw),
      noise: {
        floor: this.noise.floor,
        threshold: this.noise.threshold,
        tooNoisy: this.noise.tooNoisy,
      },
    };
  }

  reset(): void {
    this.smoother.reset();
    this.noise.reset();
  }
}
