import { median } from "../music/theory";
import type { PitchSample } from "../types";

export interface SmootherOptions {
  /** Samples below this clarity are treated as unvoiced for the trace. */
  minClarity: number;
  /** How many accepted midis the running median looks back over. */
  windowSize: number;
  /** Deviation from the running median beyond this needs a confirming frame. */
  jumpSemitones: number;
  /** How close the confirming frame must land to the pending outlier. */
  confirmSemitones: number;
  /** A voiced gap longer than this clears history: re-entry is judged fresh. */
  resetGapMs: number;
}

const DEFAULTS: SmootherOptions = {
  minClarity: 0.85,
  windowSize: 5,
  jumpSemitones: 5,
  confirmSemitones: 1.5,
  resetGapMs: 300,
};

/**
 * Streaming spike suppressor for the pitch trace. Not a filter that bends
 * values: every emitted sample is a real detector estimate. A frame far from
 * the running median is held back one frame; if the next frame agrees with it,
 * the jump was real (an interval, not a glitch) and the stream continues from
 * there. Octave flips are just the 12-semitone case of the same rule — no
 * folding, so genuine octave leaps survive.
 */
export class PitchSmoother {
  private history: number[] = [];
  private pending: PitchSample | null = null;
  private lastAt: number | null = null;

  constructor(private readonly opts: SmootherOptions = DEFAULTS) {}

  push(sample: PitchSample | null): PitchSample | null {
    if (!sample) {
      this.pending = null;
      return null;
    }
    if (sample.clarity < this.opts.minClarity) return null;

    if (this.lastAt != null && sample.at - this.lastAt > this.opts.resetGapMs) {
      this.history = [];
      this.pending = null;
    }
    this.lastAt = sample.at;

    const center = median(this.history);
    if (center == null || Math.abs(sample.midi - center) <= this.opts.jumpSemitones) {
      this.pending = null;
      this.accept(sample.midi);
      return sample;
    }
    if (this.pending && Math.abs(sample.midi - this.pending.midi) <= this.opts.confirmSemitones) {
      // Confirmed leap: restart the median window at the new pitch region.
      this.history = [this.pending.midi];
      this.pending = null;
      this.accept(sample.midi);
      return sample;
    }
    this.pending = sample;
    return null;
  }

  reset(): void {
    this.history = [];
    this.pending = null;
    this.lastAt = null;
  }

  private accept(midi: number): void {
    this.history.push(midi);
    if (this.history.length > this.opts.windowSize) this.history.shift();
  }
}
