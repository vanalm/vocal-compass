/**
 * The microphone check: does the chosen input deliver a voice the pitch
 * pipeline can follow? Pure, so its thresholds are unit-tested; the UI feeds
 * it the frames it hears and shows the verdict.
 */

/** One polled frame as the check sees it. */
export interface MicCheckSample {
  at: number;
  level: number;
  midi: number | null;
}

export type MicCheckVerdict =
  | { kind: "listening" }
  /** Digital silence: the wrong input, a muted mic, or the system blocking capture. */
  | { kind: "silent" }
  /** Sound arrives but no steady note: too far away, too noisy, or not sung yet. */
  | { kind: "no-note" }
  | { kind: "ok"; midi: number };

/** Below this RMS the input is digital silence: no room is that quiet through a working mic. */
export const SILENT_LEVEL = 0.0002;
const SILENT_AFTER_MS = 2500;
const NO_NOTE_AFTER_MS = 8000;
/** A steady note: this many pitched frames in a row (~0.4 s at 70 ms) within half a semitone of their median. */
const STEADY_FRAMES = 6;
const STEADY_SEMITONES = 0.5;

export function evaluateMicCheck(samples: readonly MicCheckSample[]): MicCheckVerdict {
  const run: number[] = [];
  for (const sample of samples) {
    if (sample.midi === null) {
      run.length = 0;
      continue;
    }
    run.push(sample.midi);
    if (run.length > STEADY_FRAMES) run.shift();
    if (run.length === STEADY_FRAMES) {
      const median = [...run].sort((a, b) => a - b)[Math.floor(STEADY_FRAMES / 2)];
      if (run.every((midi) => Math.abs(midi - median) <= STEADY_SEMITONES)) {
        return { kind: "ok", midi: Math.round(median) };
      }
    }
  }
  if (samples.length === 0) return { kind: "listening" };
  const elapsed = samples[samples.length - 1].at - samples[0].at;
  const loudest = samples.reduce((max, s) => Math.max(max, s.level), 0);
  if (elapsed >= SILENT_AFTER_MS && loudest < SILENT_LEVEL) return { kind: "silent" };
  if (elapsed >= NO_NOTE_AFTER_MS) return { kind: "no-note" };
  return { kind: "listening" };
}

/** What a failed getUserMedia means, and what to do about it. */
export function describeMicError(error: unknown): string {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Microphone access is blocked. Allow it for this site from the icon in the address bar; on a Mac, also allow your browser in System Settings → Privacy & Security → Microphone.";
    case "NotFoundError":
    case "OverconstrainedError":
      return "No microphone was found. Plug one in, or choose another input.";
    case "NotReadableError":
    case "AbortError":
      return "The microphone couldn't start. Another app may be using it, or the system is blocking it.";
    default:
      return error instanceof Error && error.message ? error.message : "Microphone access failed.";
  }
}
