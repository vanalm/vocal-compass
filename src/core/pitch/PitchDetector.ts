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
