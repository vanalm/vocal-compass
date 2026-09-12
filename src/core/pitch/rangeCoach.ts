import { noteName } from "../music/theory";
import type { RangeStepResult } from "../types";
import { RANGE_WALK_DEFAULTS, type RangeWalkSnapshot } from "./RangeWalk";

/**
 * The learning layer of the range walk: what just happened in plain words,
 * one thing to try next, and what the whole walk showed. Tips about
 * technique are deliberately conservative — the microphone hears pitch and
 * timing, not strain (docs/range-training-evidence.md), so comfort is always
 * the stated limit.
 */

const ON_PITCH_CENTS = 10;
/** A miss inside the walk's pitch tolerance was the right note that never held. */
const RIGHT_PITCH_CENTS = RANGE_WALK_DEFAULTS.toleranceSemitones * 100;
const FAR_MISS_SEMITONES = 1.5;
const TENDENCY_CENTS = 15;
const EASY_WINDOW = 5;

function centsWords(cents: number): string {
  return `${Math.abs(Math.round(cents))}¢ ${cents > 0 ? "sharp" : "flat"}`;
}

/** One sentence about the attempt that was just judged. */
export function resultLine(r: RangeStepResult): string {
  const target = noteName(r.targetMidi);
  if (r.hit) {
    const cents = r.centsOff ?? 0;
    return Math.abs(cents) <= ON_PITCH_CENTS
      ? `Got it — ${target}, on pitch.`
      : `Got it — ${target}, ${centsWords(cents)}.`;
  }
  if (r.octaveOff !== null) {
    return `You sang ${target} one octave ${r.octaveOff === 1 ? "higher" : "lower"} — right note name, wrong octave.`;
  }
  if (r.sungMidi === null || r.centsOff === null) return "No steady note heard.";
  if (Math.abs(r.centsOff) <= RIGHT_PITCH_CENTS) {
    return "Right note — it just didn't hold steady for half a second.";
  }
  const semitones = Math.abs(r.centsOff) / 100;
  if (semitones >= FAR_MISS_SEMITONES) {
    const n = Math.round(semitones);
    return `You sang ${noteName(r.sungMidi)}, ${n} semitone${n === 1 ? "" : "s"} ${r.centsOff > 0 ? "higher" : "lower"} than ${target}.`;
  }
  return `Close — ${centsWords(r.centsOff)}.`;
}

/** One thing to try next, reacting to a miss first, then to where the walk is. */
export function coachTip(s: RangeWalkSnapshot): string {
  const miss = s.phase === "result" && s.lastResult && !s.lastResult.hit ? s.lastResult : null;
  if (miss) {
    if (miss.octaveOff !== null) {
      return `Listen for where the note sits and aim ${miss.octaveOff === 1 ? "lower" : "higher"} — the right name in the wrong octave still misses.`;
    }
    if (s.attempt >= 2 && s.direction !== "anchor") {
      return "Two tries here — this may be your edge. Try once more, or call it.";
    }
    if (miss.sungMidi === null || miss.centsOff === null) {
      return "Hold one easy vowel, like “ah”, and stay close to the mic.";
    }
    if (Math.abs(miss.centsOff) <= RIGHT_PITCH_CENTS) {
      return "The pitch was right — now keep it steady for the whole half second, without sliding off.";
    }
    return miss.centsOff > 0
      ? "You were above the note — relax and aim a little lower."
      : "You were below the note — lift a little higher.";
  }

  const fromStart = s.targetMidi - s.anchorMidi;
  switch (s.direction) {
    case "anchor":
      return "Match the pitch, not the volume. Hum or sing “ah” — whatever is easy.";
    case "down":
      return fromStart <= -7
        ? "Near the bottom, voices go breathy or gravelly. If the pitch is steady, it counts."
        : "Going lower: relax your jaw and sing softer — low notes don't need push.";
    case "up":
      if (fromStart >= 10) return "Stop the moment it feels tight or scratchy. Your range is what you can hold with ease.";
      if (fromStart >= 5) return "If your voice flips to a lighter, airier sound, that's a register change — normal, and it counts.";
      return "Going higher: think lighter, not louder.";
    default:
      return "";
  }
}

export interface RangeWalkSummary {
  lowMidi: number;
  highMidi: number;
  spanSemitones: number;
  /** The five consecutive notes you matched fastest — a practice home base. */
  easiest: { lowMidi: number; highMidi: number } | null;
  /** Plain-language findings beyond the range itself. */
  insights: string[];
}

export function summarizeRangeWalk(steps: RangeStepResult[]): RangeWalkSummary | null {
  const hits = steps.filter((s) => s.hit);
  if (hits.length === 0) return null;

  const mids = hits.map((h) => h.targetMidi);
  const lowMidi = Math.min(...mids);
  const highMidi = Math.max(...mids);

  const fastest = new Map<number, number>();
  for (const h of hits) {
    if (h.timeToMatchMs === null) continue;
    fastest.set(h.targetMidi, Math.min(fastest.get(h.targetMidi) ?? Infinity, h.timeToMatchMs));
  }

  let easiest: RangeWalkSummary["easiest"] = null;
  let bestMean = Infinity;
  for (let m = lowMidi; m + EASY_WINDOW - 1 <= highMidi; m += 1) {
    const times: number[] = [];
    for (let i = 0; i < EASY_WINDOW; i += 1) {
      const t = fastest.get(m + i);
      if (t === undefined) break;
      times.push(t);
    }
    if (times.length < EASY_WINDOW) continue;
    const mean = times.reduce((a, b) => a + b, 0) / EASY_WINDOW;
    if (mean < bestMean) {
      bestMean = mean;
      easiest = { lowMidi: m, highMidi: m + EASY_WINDOW - 1 };
    }
  }

  const insights: string[] = [];
  if (easiest) {
    insights.push(
      `Easiest stretch: ${noteName(easiest.lowMidi)}–${noteName(easiest.highMidi)}. You matched these fastest, so it's a good home base for practice.`,
    );
  }

  const byPitch = [...hits].sort((a, b) => a.targetMidi - b.targetMidi);
  if (byPitch.length >= 6) {
    const tendency = (group: RangeStepResult[], label: string) => {
      const cents = group.map((g) => g.centsOff).filter((c): c is number => c !== null);
      if (cents.length < 3) return;
      const mean = cents.reduce((a, b) => a + b, 0) / cents.length;
      if (Math.abs(mean) < TENDENCY_CENTS) return;
      insights.push(
        `On your ${label} notes you landed about ${Math.round(Math.abs(mean))}¢ ${mean > 0 ? "sharp" : "flat"} — aim a touch ${mean > 0 ? "lower" : "higher"} there.`,
      );
    };
    tendency(byPitch.slice(0, 3), "lowest");
    tendency(byPitch.slice(-3), "highest");
  }

  const octaveMisses = steps.filter((s) => !s.hit && s.octaveOff !== null).length;
  if (octaveMisses > 0) {
    insights.push(
      `${octaveMisses} answer${octaveMisses === 1 ? " was" : "s were"} the right note in the wrong octave — common, and worth listening for.`,
    );
  }

  return { lowMidi, highMidi, spanSemitones: highMidi - lowMidi, easiest, insights };
}
