export * from "./types";
export * from "./music/theory";
export { AttemptClassifier, DEFAULT_THRESHOLDS } from "./trial/AttemptClassifier";
export type { ClassifierThresholds, AttemptInput } from "./trial/AttemptClassifier";
export { RescueLadder, RESCUE_LEVELS, RECOVERY_SCRIPT } from "./trial/RescueLadder";
export { TrialSession } from "./trial/TrialSession";
export type { TrialPhase } from "./trial/TrialSession";
export { Exercise } from "./exercises/Exercise";
export type { CuePlan, TrialRequest, Difficulty } from "./exercises/Exercise";
export { exercises } from "./exercises/registry";
export { baselineTestPlan, testProgress } from "./protocol/testPlan";
export {
  vocalFunctionExercises,
  rangeChangeVerdict,
  MEANINGFUL_RANGE_CHANGE_ST,
  MEASUREMENT_DRIFT_ST,
  compareRange,
} from "./protocol/rangePlan";
export type { RangeComparison, RangePlan, RangeStep, RangeVerdict } from "./protocol/rangePlan";
export { degreeToMidi, pickTessituraTonic, realizePhrase } from "./phrase/realize";
export type {
  ChordEvent,
  ChordQuality,
  Phrase,
  PhraseExerciseSpec,
  PhraseNote,
  RealizedChord,
  RealizedNote,
  RealizedPhrase,
} from "./phrase/realize";
export { extractSungNotes, scorePhrase } from "./phrase/PhraseScorer";
export type { NoteResult, PhraseScore, SungNote } from "./phrase/PhraseScorer";
export { phraseLibrary } from "./phrase/library";
export { phraseProgress } from "./phrase/progression";
export type { PhraseProgress } from "./phrase/progression";
export { nextActions } from "./protocol/nextActions";
export type { Lane, LaneStatus } from "./protocol/nextActions";
export type { TestPlan, TestStep, TestProgress } from "./protocol/testPlan";
export type { PitchDetector, PitchEstimate } from "./pitch/PitchDetector";
export { AutocorrelationDetector } from "./pitch/AutocorrelationDetector";
export { MpmDetector } from "./pitch/MpmDetector";
export type { MpmOptions } from "./pitch/MpmDetector";
export { PitchSmoother } from "./pitch/PitchSmoother";
export type { SmootherOptions } from "./pitch/PitchSmoother";
export { MicrophoneEngine } from "./pitch/MicrophoneEngine";
export type { MicStatus, MicListener } from "./pitch/MicrophoneEngine";
export { PitchPipeline } from "./pitch/PitchPipeline";
export type { PitchFrame, NoiseState, PipelineOptions } from "./pitch/PitchPipeline";
export { NoiseFloorTracker } from "./pitch/NoiseFloorTracker";
export type { NoiseFloorOptions } from "./pitch/NoiseFloorTracker";
export { segmentTrace } from "./trial/segmentTrace";
export { heldExtremes } from "./pitch/RangeAnalyzer";
export { RangeWalk, RANGE_WALK_DEFAULTS } from "./pitch/RangeWalk";
export type {
  RangeWalkOptions,
  RangeWalkSnapshot,
  StepResult,
  WalkDirection,
  WalkEffect,
  WalkPhase,
} from "./pitch/RangeWalk";
export { coachTip, resultLine, summarizeRangeWalk } from "./pitch/rangeCoach";
export type { RangeWalkSummary } from "./pitch/rangeCoach";
export {
  DEFAULT_LOW_CUT,
  LEGACY_LOW_CUT,
  LOW_CUT_OPTIONS,
  NOISY_SHARE_FOR_ADVICE,
  applyLowCut,
  lowCutLabel,
  lowCutNodeConfig,
  lowCutOption,
  lowNoteFilterAdvice,
  noiseFilterAdvice,
} from "./pitch/micFilter";
export type { FilterAdvice, LowCutNodeConfig, LowCutOption } from "./pitch/micFilter";
export type { HeldExtremes, RangeAnalyzerOptions } from "./pitch/RangeAnalyzer";
export { practiceDays } from "./kpi/practiceTime";
export { improvementSummary } from "./kpi/improvement";
export type { ImprovementSummary, Movement, RangeMovement } from "./kpi/improvement";
export { pitchZones } from "./kpi/pitchZones";
export type { PitchZone } from "./kpi/pitchZones";
export { SyncClient } from "./sync/SyncClient";
export type { KeyValueStore } from "./sync/SyncClient";
// Tombstone & SyncRecordKind export via types barrel (export * from "./types")
export type { PracticeDay, PracticeTimeOptions } from "./kpi/practiceTime";
export { CuePlayer } from "./audio/CuePlayer";
export { MemoryTrialRepository } from "./storage/TrialRepository";
export type { TrialRepository } from "./storage/TrialRepository";
export { IndexedDbTrialRepository } from "./storage/IndexedDbTrialRepository";
export { KpiCalculator } from "./kpi/KpiCalculator";
export { Recommender } from "./recommend/Recommender";
export type { Recommendation } from "./recommend/Recommender";
