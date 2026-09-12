import { median } from "../music/theory";
import type { PitchSample } from "../types";
import type { RealizedNote } from "./realize";

/**
 * Rhythm-aware phrase scoring. A sung performance is segmented into note
 * events, each target consumes its nearest-in-time attempt, and the verdict
 * separates the dimensions a singer can actually act on: right notes, extra
 * notes, timing, and the landing. Review copy follows the brainstorm's
 * Keep / Fix / Retry shape — one thing that worked, the single
 * highest-impact fix.
 */

export interface SungNote {
  midi: number;
  onsetMs: number;
  durationMs: number;
}

export interface NoteResult {
  target: RealizedNote;
  hit: boolean;
  /** Signed cents off target when an attempt was made. */
  centsOff: number | null;
  /** Signed ms (positive = late) when an attempt was made. */
  onsetErrorMs: number | null;
}

export interface PhraseScore {
  noteResults: NoteResult[];
  hits: number;
  misses: number;
  extras: number;
  sequenceAccuracy: number;
  meanAbsOnsetMs: number | null;
  landingHit: boolean;
  keep: string;
  fix: string;
}

const FRAME_MS = 70;
const RUN_MIN_FRAMES = 3;
const RUN_PITCH_TOL = 0.75;
const RUN_GAP_MS = 150;
const HIT_PITCH_TOL_ST = 0.75;
const LATE_THRESHOLD_MS = 150;

/** Group held frames into sung note events; blips and gaps break runs. */
export function extractSungNotes(samples: PitchSample[]): SungNote[] {
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  const notes: SungNote[] = [];
  let run: PitchSample[] = [];

  const flush = () => {
    if (run.length >= RUN_MIN_FRAMES) {
      const mid = median(run.map((s) => s.midi));
      if (mid != null) {
        notes.push({
          midi: mid,
          onsetMs: run[0].at,
          durationMs: run[run.length - 1].at - run[0].at + FRAME_MS,
        });
      }
    }
    run = [];
  };

  for (const sample of sorted) {
    if (run.length > 0) {
      const prev = run[run.length - 1];
      const runMid = median(run.map((s) => s.midi)) ?? sample.midi;
      if (sample.at - prev.at > RUN_GAP_MS || Math.abs(sample.midi - runMid) > RUN_PITCH_TOL) {
        flush();
      }
    }
    run.push(sample);
  }
  flush();
  return notes;
}

export function scorePhrase(targets: RealizedNote[], samples: PitchSample[]): PhraseScore {
  const sung = extractSungNotes(samples);
  const consumed = new Set<number>();
  const noteResults: NoteResult[] = [];

  for (const target of targets) {
    const window = Math.max(300, Math.min(600, target.durationMs * 0.75));
    let best = -1;
    let bestDiff = Infinity;
    for (let i = 0; i < sung.length; i += 1) {
      if (consumed.has(i)) continue;
      const diff = Math.abs(sung[i].onsetMs - target.startMs);
      if (diff <= window && diff < bestDiff) {
        best = i;
        bestDiff = diff;
      }
    }
    if (best < 0) {
      noteResults.push({ target, hit: false, centsOff: null, onsetErrorMs: null });
      continue;
    }
    consumed.add(best);
    const attempt = sung[best];
    const hit = Math.abs(attempt.midi - target.midi) <= HIT_PITCH_TOL_ST;
    noteResults.push({
      target,
      hit,
      centsOff: Math.round((attempt.midi - target.midi) * 100),
      onsetErrorMs: Math.round(attempt.onsetMs - target.startMs),
    });
  }

  const hits = noteResults.filter((r) => r.hit).length;
  const misses = targets.length - hits;
  const extras = sung.length - consumed.size;
  const onsetErrors = noteResults
    .filter((r) => r.hit && r.onsetErrorMs != null)
    .map((r) => Math.abs(r.onsetErrorMs as number));
  const meanAbsOnsetMs = onsetErrors.length
    ? Math.round(onsetErrors.reduce((a, b) => a + b, 0) / onsetErrors.length)
    : null;
  const sequenceAccuracy = targets.length ? hits / targets.length : 0;
  const landingHit = noteResults.length > 0 && noteResults[noteResults.length - 1].hit;

  return {
    noteResults,
    hits,
    misses,
    extras,
    sequenceAccuracy,
    meanAbsOnsetMs,
    landingHit,
    ...verdict({ sequenceAccuracy, meanAbsOnsetMs, extras, landingHit, hits }),
  };
}

function verdict(s: {
  sequenceAccuracy: number;
  meanAbsOnsetMs: number | null;
  extras: number;
  landingHit: boolean;
  hits: number;
}): { keep: string; fix: string } {
  const keep =
    s.sequenceAccuracy === 1
      ? "Every note was the right note."
      : s.landingHit
        ? "You landed the ending — that is the note listeners remember."
        : s.meanAbsOnsetMs != null && s.meanAbsOnsetMs < 80
          ? "Your timing was tight on the notes you hit."
          : s.hits > 0
            ? "The shape is forming — some notes are already locking in."
            : "You committed to the attempt — that is the raw material.";

  let fix: string;
  if (!s.landingHit) {
    fix = "The landing note didn't arrive — sing just the final two notes, then rejoin the whole phrase.";
  } else if (s.sequenceAccuracy < 0.7) {
    fix = "Several notes missed their pitch — slow down and sing the phrase in two-note chunks first.";
  } else if (s.extras > 0) {
    fix = "Extra notes crept in between targets — sing only the written notes, leaving space between them.";
  } else if (s.meanAbsOnsetMs != null && s.meanAbsOnsetMs > LATE_THRESHOLD_MS) {
    fix = "Right notes, loose timing — tap the rhythm once out loud, then sing it again.";
  } else {
    fix = "Nothing pressing — fade the guide a step and make it harder.";
  }
  return { keep, fix };
}
