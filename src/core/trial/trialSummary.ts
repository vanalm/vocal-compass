import { median, noteName, stdDev } from "../music/theory";
import { noteRuns } from "../phrase/PhraseScorer";
import type { TrialRecord } from "../types";

/**
 * What one attempt sounded like, for the per-trial dashboard: the notes sung
 * and how far each sat from its center, how steady the held note was in pitch
 * and in volume, and how the sing window was used. Pure, so every number on
 * the dashboard is unit-tested.
 */

export type Steadiness = "steady" | "wavering" | "unsteady";

export interface TrialNote {
  midi: number;
  name: string;
  /** Mean distance from the note's center, in cents (+ sharp, − flat). */
  centsOff: number;
  /** From the go-signal when known, else from the first sound. */
  startMs: number;
  durationMs: number;
  isTarget: boolean;
}

export interface TrialSummary {
  notes: TrialNote[];
  /** Spread of the held note's pitch, in cents. */
  pitch: { spreadCents: number; steadiness: Steadiness } | null;
  /** Spread of the held note's loudness, in decibels. */
  volume: { spreadDb: number; steadiness: Steadiness } | null;
  timeToVoiceMs: number | null;
  /** Share of the sing window with a detectable pitch; needs the per-frame levels newer records keep. */
  voicedShare: number | null;
}

type SummaryInput = Pick<TrialRecord, "trace" | "definition" | "selectionLatencyMs"> &
  Partial<Pick<TrialRecord, "goAt" | "levels">>;

/** The engine polls every 70 ms: one sample stands for that much sound. */
const FRAME_MS = 70;
/** Two stretches of one note this close together are one note interrupted by a blip. */
const MERGE_GAP_MS = 300;
/** Enough of a held note to judge its steadiness. */
const MIN_HELD_SAMPLES = 5;
const PITCH_BANDS = { steady: 10, wavering: 25 };
const VOLUME_BANDS = { steady: 1.5, wavering: 3 };

function band(value: number, limits: { steady: number; wavering: number }): Steadiness {
  return value <= limits.steady ? "steady" : value <= limits.wavering ? "wavering" : "unsteady";
}

type Frame = { at: number; midi: number; rms?: number };

/** Held notes in order; a blip that splits one note leaves it one note, not two. */
function heldNotes(trace: SummaryInput["trace"]): Frame[][] {
  const runs = noteRuns(trace.map((p) => ({ at: p.t, midi: p.midi, rms: p.rms })));
  return runs.reduce<Frame[][]>((merged, run) => {
    const last = merged[merged.length - 1];
    const sameNote = last && Math.round(median(last.map((p) => p.midi)) as number) === Math.round(median(run.map((p) => p.midi)) as number);
    if (sameNote && run[0].at - last[last.length - 1].at <= MERGE_GAP_MS) merged[merged.length - 1] = [...last, ...run];
    else merged.push(run);
    return merged;
  }, []);
}

export function summarizeTrial(record: SummaryInput): TrialSummary {
  const { trace, definition, goAt, levels } = record;
  const origin = goAt ?? trace[0]?.t ?? 0;
  const runs = heldNotes(trace);

  const notes = runs.map((run) => {
    const center = median(run.map((p) => p.midi)) as number;
    const midi = Math.round(center);
    return {
      midi,
      name: noteName(midi),
      centsOff: Math.round((center - midi) * 100),
      startMs: Math.max(0, run[0].at - origin),
      durationMs: run[run.length - 1].at - run[0].at + FRAME_MS,
      isTarget: midi === definition.targetMidi,
    };
  });

  // Steadiness is judged on the longest note: the one the singer settled on.
  const held = runs.reduce<Frame[]>((longest, run) => (run.length > longest.length ? run : longest), []);
  const pitch =
    held.length >= MIN_HELD_SAMPLES
      ? (() => {
          const spreadCents = Math.round(stdDev(held.map((p) => p.midi)) * 100);
          return { spreadCents, steadiness: band(spreadCents, PITCH_BANDS) };
        })()
      : null;
  const loudness = held.filter((p) => p.rms !== undefined && p.rms > 0).map((p) => 20 * Math.log10(p.rms as number));
  const volume =
    loudness.length >= MIN_HELD_SAMPLES
      ? (() => {
          const spreadDb = Math.round(stdDev(loudness) * 10) / 10;
          return { spreadDb, steadiness: band(spreadDb, VOLUME_BANDS) };
        })()
      : null;

  return {
    notes,
    pitch,
    volume,
    timeToVoiceMs: record.selectionLatencyMs,
    voicedShare: levels && levels.length > 0 ? Math.min(1, trace.length / levels.length) : null,
  };
}
