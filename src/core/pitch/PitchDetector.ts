/**
 * PitchDetector is the seam for swapping the estimator: the shipped
 * AutocorrelationDetector is portable and dependency-free; production
 * validation may replace it with a YIN/pYIN-class implementation without
 * touching the microphone engine or any UI.
 */
export interface PitchEstimate {
  hz: number;
  /** 0..1 confidence */
  clarity: number;
  rms: number;
}

export interface PitchDetector {
  readonly name: string;
  estimate(buffer: Float32Array, sampleRate: number): PitchEstimate | null;
}

/** Shared by every detector's voiced/unvoiced gate. */
export function rootMeanSquare(buffer: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < buffer.length; i += 1) sum += buffer[i] * buffer[i];
  return Math.sqrt(sum / buffer.length);
}
