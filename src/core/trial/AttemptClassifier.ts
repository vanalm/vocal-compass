import type {
  AttemptAnalysis,
  ErrorKind,
  IntentLabel,
  PitchSample,
} from "../types";
import { mean, median, noteName, stdDev } from "../music/theory";

/**
 * AttemptClassifier is the diagnostic heart of the app: it separates
 * "which destination did you select?" from "how well did you land on it?"
 *
 * It is deliberately a class with injectable thresholds so a device
 * calibration step (or tests) can tune it without editing logic.
 */
export interface ClassifierThresholds {
  /** Minimum detector clarity to count a sample as voiced. */
  minClarity: number;
  /** Minimum RMS to count a sample as voiced. */
  minRms: number;
  /** Samples inside this window after first voicing define the commitment. */
  commitWindowMs: number;
  /** Window used to count search transitions (PRD: first 1.2 s). */
  searchWindowMs: number;
  /** |residual| ≤ this counts as a clean landing on the selected note. */
  cleanLandingCents: number;
  /** |error to target| ≤ this counts as a good landing on the target. */
  goodLandingCents: number;
  /** ≥ this many note-center changes marks a search path. */
  searchTransitionLimit: number;
  /** ≥ this many semitones travelled marks a search path. */
  searchPathSemitones: number;
}

export const DEFAULT_THRESHOLDS: ClassifierThresholds = {
  minClarity: 0.5,
  minRms: 0.008,
  commitWindowMs: 900,
  searchWindowMs: 1200,
  cleanLandingCents: 35,
  goodLandingCents: 50,
  searchTransitionLimit: 2,
  searchPathSemitones: 3,
};

export interface AttemptInput {
  targetMidi: number;
  startMidi: number;
  samples: PitchSample[];
}

export class AttemptClassifier {
  constructor(private readonly t: ClassifierThresholds = DEFAULT_THRESHOLDS) {}

  classify({ targetMidi, startMidi, samples }: AttemptInput): AttemptAnalysis {
    const voiced = samples.filter(
      (s) => Number.isFinite(s.midi) && s.clarity >= this.t.minClarity && s.rms >= this.t.minRms,
    );

    if (voiced.length < 3) return this.unscored(targetMidi, voiced);

    const firstAt = voiced[0].at;
    const early = voiced.filter((s) => s.at - firstAt <= this.t.commitWindowMs);
    const window = early.length >= 4 ? early : voiced.slice(0, Math.min(voiced.length, 12));

    const selectedMidiFloat = median(window.map((s) => s.midi)) as number;
    const selectedMidi = Math.round(selectedMidiFloat);
    const residualToSelectedCents = (selectedMidiFloat - selectedMidi) * 100;
    const targetErrorCents = (selectedMidiFloat - targetMidi) * 100;

    const centers = this.pitchCenters(voiced, this.t.searchWindowMs);
    const searchTransitions = Math.max(0, centers.length - 1);
    const pitchPathSemitones = centers.length < 2
      ? 0
      : centers.slice(1).reduce((sum, c, i) => sum + Math.abs(c - centers[i]), 0);

    const intendedDirection = Math.sign(targetMidi - startMidi);
    const selectedDirection = Math.sign(selectedMidi - startMidi);
    const wrongDirection =
      intendedDirection !== 0 && selectedDirection !== 0 && intendedDirection !== selectedDirection;

    const destinationMatch = selectedMidi === Math.round(targetMidi);
    const octaveDisplacement =
      !destinationMatch && (((selectedMidi - targetMidi) % 12) + 12) % 12 === 0;
    const cleanLandingOnSelected = Math.abs(residualToSelectedCents) <= this.t.cleanLandingCents;
    const stabilityCents = stdDev(window.map((s) => s.midi)) * 100;
    const detectorConfidence = mean(window.map((s) => s.clarity));

    const { kind, explanation } = this.verdict({
      selectedMidi,
      targetMidi,
      targetErrorCents,
      destinationMatch,
      cleanLandingOnSelected,
      searchTransitions,
      pitchPathSemitones,
      centersVisited: centers.length,
    });

    return {
      scored: true,
      selectedMidi,
      selectedNote: noteName(selectedMidi),
      targetNote: noteName(targetMidi),
      targetErrorCents,
      residualToSelectedCents,
      destinationMatch,
      cleanLandingOnSelected,
      wrongDirection,
      octaveDisplacement,
      searchTransitions,
      pitchPathSemitones,
      stabilityCents,
      detectorConfidence,
      acousticErrorKind: kind,
      explanation,
    };
  }

  /**
   * The final label may override acoustics with the user's confirmed intent:
   * a pitch tracker estimates F0, never intention (PRD §18).
   */
  resolveFinalErrorKind(analysis: AttemptAnalysis, intent: IntentLabel | null): ErrorKind {
    if (!analysis.scored) return "unscored";
    switch (intent) {
      case "no-target": return "no-target";
      case "searching": return "search";
      case "landing-miss": return "landing";
      case "selected-note": return analysis.destinationMatch ? "success" : "selection";
      default: return analysis.acousticErrorKind;
    }
  }

  /** Intent confirmation is requested when acoustics alone are ambiguous. */
  needsIntentConfirmation(analysis: AttemptAnalysis): boolean {
    if (!analysis.scored) return false;
    if (analysis.acousticErrorKind === "success") return false;
    return true;
  }

  private pitchCenters(samples: PitchSample[], windowMs: number): number[] {
    if (!samples.length) return [];
    const first = samples[0].at;
    const centers: number[] = [];
    for (const s of samples) {
      if (s.at - first > windowMs) break;
      const center = Math.round(s.midi);
      if (!centers.length || centers[centers.length - 1] !== center) centers.push(center);
    }
    return centers;
  }

  private unscored(targetMidi: number, voiced: PitchSample[]): AttemptAnalysis {
    return {
      scored: false,
      selectedMidi: null,
      selectedNote: null,
      targetNote: noteName(targetMidi),
      targetErrorCents: null,
      residualToSelectedCents: null,
      destinationMatch: false,
      cleanLandingOnSelected: false,
      wrongDirection: false,
      octaveDisplacement: false,
      searchTransitions: 0,
      pitchPathSemitones: 0,
      stabilityCents: null,
      detectorConfidence: voiced.length ? mean(voiced.map((s) => s.clarity)) : 0,
      acousticErrorKind: "unscored",
      explanation:
        "The microphone did not capture a stable voiced segment. Retry this trial — it is not interpreted.",
    };
  }

  private verdict(a: {
    selectedMidi: number;
    targetMidi: number;
    targetErrorCents: number;
    destinationMatch: boolean;
    cleanLandingOnSelected: boolean;
    searchTransitions: number;
    pitchPathSemitones: number;
    centersVisited: number;
  }): { kind: ErrorKind; explanation: string } {
    if (
      a.searchTransitions >= this.t.searchTransitionLimit ||
      a.pitchPathSemitones >= this.t.searchPathSemitones
    ) {
      return {
        kind: "search",
        explanation: `The pitch path visited ${a.centersVisited} note centers before settling. The goal is a direct first commitment, not the final tuner position.`,
      };
    }
    if (a.destinationMatch) {
      if (Math.abs(a.targetErrorCents) <= this.t.goodLandingCents) {
        return {
          kind: "success",
          explanation: `Destination correct. The settled center was ${Math.abs(a.targetErrorCents).toFixed(0)} cents ${a.targetErrorCents < 0 ? "low" : "high"}.`,
        };
      }
      return {
        kind: "landing",
        explanation: "The musical destination appears correct, but the acoustic center needs landing work.",
      };
    }
    if (a.cleanLandingOnSelected) {
      return {
        kind: "selection",
        explanation: `You landed cleanly on ${noteName(a.selectedMidi)}. The requested destination was ${noteName(a.targetMidi)}. This looks like a destination-selection miss, not poor vocal control.`,
      };
    }
    return {
      kind: "selection",
      explanation: `The selected pitch was closest to ${noteName(a.selectedMidi)}, not ${noteName(a.targetMidi)}. Confirm whether you chose that note, knew the target but missed it, or were searching.`,
    };
  }
}
