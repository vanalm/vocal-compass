/** Shared domain types. No React, no DOM assumptions beyond timestamps. */

export type FeedbackMode = "blind" | "commit" | "live";
export type VoiceState = "normal" | "tired" | "hoarse" | "sore" | "recovering";
export type RegisterLabel = "unknown" | "chest" | "transition" | "head";
export type LoadCondition = "neutral" | "syllable" | "lyrics" | "accompaniment" | "timed";

/** What the user says they intended, collected when acoustics are ambiguous. */
export type IntentLabel = "selected-note" | "landing-miss" | "searching" | "no-target";

/** The error taxonomy from the PRD §4.3, collapsed to scoreable kinds. */
export type ErrorKind =
  | "success"
  | "selection"
  | "landing"
  | "search"
  | "no-target"
  | "unscored";

export interface PitchSample {
  /** ms timestamp (performance.now() or Date.now(); only deltas matter) */
  at: number;
  hz: number;
  midi: number;
  /** 0..1 detector confidence */
  clarity: number;
  rms: number;
}

/** A single planned attempt: what to cue, what to expect. */
export interface TrialDefinition {
  id: string;
  exerciseId: string;
  keyName: string;
  tonicMidi: number;
  scale: number[];
  startDegree: number;
  targetDegree: number;
  startMidi: number;
  targetMidi: number;
  /** Notes the cue player sounds before the attempt (context/phrase). */
  phraseMidis: number[];
  /** Silent retention delay between cue and go-signal. */
  delayMs: number;
  load: LoadCondition;
  createdAt: string;
}

/** Pure acoustic verdict on one attempt — before user intent is known. */
export interface AttemptAnalysis {
  scored: boolean;
  selectedMidi: number | null;
  selectedNote: string | null;
  targetNote: string;
  targetErrorCents: number | null;
  residualToSelectedCents: number | null;
  destinationMatch: boolean;
  cleanLandingOnSelected: boolean;
  wrongDirection: boolean;
  octaveDisplacement: boolean;
  searchTransitions: number;
  pitchPathSemitones: number;
  stabilityCents: number | null;
  detectorConfidence: number;
  acousticErrorKind: ErrorKind;
  explanation: string;
}

/** The persisted record: acoustics + context + user confirmation. */
export interface TrialRecord extends AttemptAnalysis {
  id: string;
  definition: TrialDefinition;
  feedbackMode: FeedbackMode;
  hintLevel: number;
  lostEvent: boolean;
  intent: IntentLabel | null;
  finalErrorKind: ErrorKind;
  selectionLatencyMs: number | null;
  recoveryTimeMs: number | null;
  confidenceBefore: number;
  effort: number;
  register: RegisterLabel;
  trace: Array<{ t: number; midi: number; clarity: number }>;
  createdAt: string;
}

export interface KpiSummary {
  total: number;
  scored: number;
  destinationAccuracy: number;
  independentAccuracy: number;
  availabilityRate: number;
  medianLatencyMs: number | null;
  hintRate: number;
  mapLossRate: number;
  medianRecoveryMs: number | null;
  correctTargetMedianResidual: number | null;
}
