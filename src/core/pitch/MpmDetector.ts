import { PitchDetector as PitchyMpm } from "pitchy";
import { clamp } from "../music/theory";
import { rootMeanSquare, type PitchDetector, type PitchEstimate } from "./PitchDetector";

export interface MpmOptions {
  minHz: number;
  maxHz: number;
  minRms: number;
  /** Estimates below this clarity are treated as unvoiced. */
  minClarity: number;
}

const DEFAULTS: MpmOptions = {
  minHz: 60,
  maxHz: 1200,
  minRms: 0.008,
  minClarity: 0.5,
};

/**
 * McLeod Pitch Method via pitchy. The NSDF peak-picking is what the shipped
 * autocorrelation detector lacks: it selects the true period even when a
 * harmonic outweighs the fundamental, which is the octave-flip case on real
 * voices.
 */
export class MpmDetector implements PitchDetector {
  readonly name = "mpm-pitchy-v1";
  private mpm: ReturnType<typeof PitchyMpm.forFloat32Array> | null = null;
  private mpmSize = 0;

  constructor(private readonly opts: MpmOptions = DEFAULTS) {}

  estimate(buffer: Float32Array, sampleRate: number): PitchEstimate | null {
    const rms = rootMeanSquare(buffer);
    if (rms < this.opts.minRms) return null;

    if (!this.mpm || this.mpmSize !== buffer.length) {
      this.mpm = PitchyMpm.forFloat32Array(buffer.length);
      this.mpmSize = buffer.length;
    }
    const [hz, clarity] = this.mpm.findPitch(buffer, sampleRate);
    if (
      !Number.isFinite(hz) ||
      hz < this.opts.minHz ||
      hz > this.opts.maxHz ||
      clarity < this.opts.minClarity
    ) {
      return null;
    }
    return { hz, clarity: clamp(clarity, 0, 1), rms };
  }
}
