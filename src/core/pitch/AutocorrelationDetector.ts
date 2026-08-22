import { clamp } from "../music/theory";
import { rootMeanSquare, type PitchDetector, type PitchEstimate } from "./PitchDetector";

export interface AutocorrelationOptions {
  minHz: number;
  maxHz: number;
  minRms: number;
  minCorrelation: number;
}

const DEFAULTS: AutocorrelationOptions = {
  minHz: 70,
  maxHz: 950,
  minRms: 0.008,
  minCorrelation: 0.5,
};

/**
 * Normalized autocorrelation with parabolic peak interpolation.
 * Lightweight and adequate for a first version; see PitchDetector for the
 * production-replacement seam.
 */
export class AutocorrelationDetector implements PitchDetector {
  readonly name = "autocorrelation-v1";

  constructor(private readonly opts: AutocorrelationOptions = DEFAULTS) {}

  estimate(buffer: Float32Array, sampleRate: number): PitchEstimate | null {
    const rms = rootMeanSquare(buffer);
    if (rms < this.opts.minRms) return null;

    const minLag = Math.max(2, Math.floor(sampleRate / this.opts.maxHz));
    const maxLag = Math.min(buffer.length - 2, Math.ceil(sampleRate / this.opts.minHz));
    let bestLag = -1;
    let bestCorrelation = -Infinity;
    const correlations: number[] = [];

    for (let lag = minLag; lag <= maxLag; lag += 1) {
      let numerator = 0;
      let energyA = 0;
      let energyB = 0;
      const length = buffer.length - lag;
      for (let i = 0; i < length; i += 1) {
        const a = buffer[i];
        const b = buffer[i + lag];
        numerator += a * b;
        energyA += a * a;
        energyB += b * b;
      }
      const correlation = numerator / (Math.sqrt(energyA * energyB) || 1);
      correlations[lag] = correlation;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestLag = lag;
      }
    }

    if (bestLag < 0 || bestCorrelation < this.opts.minCorrelation) return null;

    const left = correlations[bestLag - 1] ?? bestCorrelation;
    const center = correlations[bestLag] ?? bestCorrelation;
    const right = correlations[bestLag + 1] ?? bestCorrelation;
    const denom = left - 2 * center + right;
    const shift = denom === 0 ? 0 : (0.5 * (left - right)) / denom;
    const refinedLag = bestLag + clamp(shift, -1, 1);

    return {
      hz: sampleRate / refinedLag,
      clarity: clamp(bestCorrelation, 0, 1),
      rms,
    };
  }
}
