export interface NoiseFloorOptions {
  /** How many unvoiced frames the floor looks back over (~3s at 70ms polling). */
  windowFrames: number;
  /** Which point of the sorted window is "the floor" — low, so transients don't count. */
  percentile: number;
  /** Voiced threshold = floor x ratio. */
  ratio: number;
  /** The threshold never drops below this (the old fixed gate). */
  absoluteMinRms: number;
  /** A floor above this means quiet singing cannot be separated from the room. */
  tooNoisyFloor: number;
}

const DEFAULTS: NoiseFloorOptions = {
  windowFrames: 43,
  percentile: 0.2,
  ratio: 3,
  absoluteMinRms: 0.008,
  tooNoisyFloor: 0.05,
};

/**
 * Rolling estimate of ambient loudness, fed only with unvoiced frames.
 * The floor is a low percentile of the recent window: sustained noise raises
 * it within a few seconds, a door slam does not, and when the noise stops the
 * window refills and the floor falls back. With no data the threshold equals
 * the old fixed gate, so quiet-room behavior is unchanged.
 */
export class NoiseFloorTracker {
  private window: number[] = [];

  constructor(private readonly opts: NoiseFloorOptions = DEFAULTS) {}

  /** Feed the RMS of one unvoiced frame. */
  update(rms: number): void {
    this.window.push(rms);
    if (this.window.length > this.opts.windowFrames) this.window.shift();
  }

  get floor(): number {
    if (this.window.length === 0) return 0;
    const sorted = [...this.window].sort((a, b) => a - b);
    return sorted[Math.floor(this.opts.percentile * (sorted.length - 1))];
  }

  get threshold(): number {
    return Math.max(this.opts.absoluteMinRms, this.floor * this.opts.ratio);
  }

  get tooNoisy(): boolean {
    return this.floor > this.opts.tooNoisyFloor;
  }

  reset(): void {
    this.window = [];
  }
}
