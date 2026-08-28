export interface HeldExtremes {
  lowMidi: number;
  highMidi: number;
}

export interface RangeAnalyzerOptions {
  /** Consecutive frames needed before a pitch counts as held (~200ms at 70ms polling). */
  minRun: number;
  /** Frame-to-frame step beyond this breaks a run (a crack, not a glide). */
  maxStep: number;
}

const DEFAULTS: RangeAnalyzerOptions = { minRun: 3, maxStep: 0.75 };

/**
 * Range extremes from a probe sweep. Only *held* pitch counts: a frame
 * belongs to a run while each step stays continuous, and a run shorter than
 * minRun (a crack, a squeak, a detector blip) contributes nothing. Nulls are
 * silence and break the run. Returns null when nothing was held at all.
 */
export function heldExtremes(
  midis: Array<number | null>,
  opts: RangeAnalyzerOptions = DEFAULTS,
): HeldExtremes | null {
  let low = Infinity;
  let high = -Infinity;
  let found = false;
  let run: number[] = [];

  const flush = () => {
    if (run.length >= opts.minRun) {
      found = true;
      for (const m of run) {
        if (m < low) low = m;
        if (m > high) high = m;
      }
    }
    run = [];
  };

  for (const midi of midis) {
    if (midi == null) {
      flush();
      continue;
    }
    if (run.length > 0 && Math.abs(midi - run[run.length - 1]) > opts.maxStep) flush();
    run.push(midi);
  }
  flush();

  return found ? { lowMidi: low, highMidi: high } : null;
}
