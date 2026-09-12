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
  trace: Array<{ t: number; midi: number; clarity: number; rms?: number }>;
  createdAt: string;
}

/** How a range measurement was taken — different methods are not directly comparable. */
export type RangeMethod = "glissando" | "guided-steps" | "guided-turns";

/** One note attempted during a guided range walk. */
export interface RangeStepResult {
  targetMidi: number;
  direction: "anchor" | "down" | "up";
  attempt: number;
  hit: boolean;
  /** Held an octave above (+1) or below (-1) the target instead of the target. */
  octaveOff: 1 | -1 | null;
  /** Median pitch of the steadiest stretch sung, if any. */
  sungMidi: number | null;
  centsOff: number | null;
  timeToMatchMs: number | null;
  /** Client-clock ms when the turn opened and when it was judged; splits the trace per note. */
  startedAt: number;
  endedAt: number;
}

/** Microphone low-cut filter setting; options and trade-offs in core/pitch/micFilter.ts. */
export type LowCutSetting = "off" | "60" | "80" | "100";

/** One saved range measurement: the matched extremes, plus how they were found. */
export interface RangeMeasurement {
  id: string;
  createdAt: string;
  lowMidi: number;
  highMidi: number;
  /** Absent on measurements saved before methods were recorded. */
  method?: RangeMethod;
  /** The low-cut filter active while measuring; absent means the old fixed 80 Hz. */
  micLowCut?: LowCutSetting;
  /** Every note attempted, in order — guided-turns measurements only. */
  steps?: RangeStepResult[];
  /** Pitch frames heard during the singer's turns, for per-frequency analysis. */
  trace?: Array<{ t: number; midi: number; clarity: number; rms?: number }>;
}

/** One completed guided exercise session (e.g. a VFE run on the Range screen). */
export interface ExerciseSession {
  id: string;
  createdAt: string;
  /** Which plan was run, e.g. "vfe". */
  planId: string;
  stepsCompleted: number;
}

export type SyncRecordKind = "trial" | "range" | "session" | "phrase";

/** Which line the singer is assigned in a phrase exercise. */
export type SingerRole = "melody" | "root" | "third" | "fifth";
/** How much the guide audio helps: whole phrase, first+last note, or nothing. */
export type GuideStrength = "full" | "anchor" | "none";

/** One scored phrase attempt (Echo Quest and every future phrase game). */
export interface PhraseRecord {
  id: string;
  createdAt: string;
  phraseId: string;
  phraseName: string;
  level: number;
  keyTonicMidi: number;
  bpm: number;
  role: SingerRole;
  guide: GuideStrength;
  /** True only for guide-free first takes — the cold, honest score. */
  verified: boolean;
  hits: number;
  misses: number;
  extras: number;
  sequenceAccuracy: number;
  meanAbsOnsetMs: number | null;
  landingHit: boolean;
  trace: Array<{ t: number; midi: number; clarity: number; rms?: number }>;
}

/**
 * A deletion that must outlive the record: sync is a union merge of
 * immutable records, so removing one without a tombstone would just let
 * every other copy resurrect it on the next sync.
 */
export interface Tombstone {
  id: string;
  createdAt: string;
  kind: SyncRecordKind;
  recordId: string;
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
