import type {
  AttemptAnalysis,
  ErrorKind,
  FeedbackMode,
  IntentLabel,
  PitchSample,
  RegisterLabel,
  TrialDefinition,
  TrialRecord,
} from "../types";
import { AttemptClassifier } from "./AttemptClassifier";
import { RescueLadder } from "./RescueLadder";

export type TrialPhase = "ready" | "listen" | "imagine" | "sing" | "review";

/**
 * TrialSession is the state machine behind one attempt
 * (PRD §7: listen → imagine → commit → sing → review).
 *
 * It owns timing (latency, recovery), the pitch trace, and the rescue
 * ladder, and produces the final TrialRecord. It has no audio or DOM
 * knowledge: the UI feeds it events and samples.
 */
export class TrialSession {
  private phase: TrialPhase = "ready";
  private samples: PitchSample[] = [];
  private goAt: number | null = null;
  private firstVoicedAt: number | null = null;
  private analysis: AttemptAnalysis | null = null;
  private intent: IntentLabel | null = null;
  readonly rescue = new RescueLadder();
  confidenceBefore = 3;
  effort = 2;
  register: RegisterLabel = "unknown";

  constructor(
    readonly definition: TrialDefinition,
    readonly feedbackMode: FeedbackMode,
    private readonly classifier: AttemptClassifier = new AttemptClassifier(),
    private readonly now: () => number = () => Date.now(),
  ) {}

  get currentPhase(): TrialPhase {
    return this.phase;
  }

  get currentAnalysis(): AttemptAnalysis | null {
    return this.analysis;
  }

  /** Captured pitch trace, for review visualisations. */
  get trace(): Array<{ t: number; midi: number; clarity: number; rms?: number }> {
    return this.samples.map((s) => ({ t: s.at, midi: s.midi, clarity: s.clarity, rms: s.rms }));
  }

  /** Live pitch is only shown to the user when the mode allows it. */
  get liveFeedbackVisible(): boolean {
    return this.feedbackMode === "live";
  }

  beginListening(): void {
    this.assertPhase("ready");
    this.phase = "listen";
  }

  beginImagining(): void {
    this.assertPhase("listen");
    this.phase = "imagine";
  }

  /** The go-signal: microphone scoring starts here. */
  beginSinging(): void {
    this.assertPhase("imagine");
    this.phase = "sing";
    this.goAt = this.now();
  }

  /**
   * Ingest one polling tick. Raw drives voicing-onset timing (the selection
   * latency KPI must not pay the smoother's confirmation delay); smoothed is
   * what the trace and classifier see.
   */
  addFrame(frame: { raw: PitchSample | null; smoothed: PitchSample | null }): void {
    if (this.phase !== "sing") return;
    const { raw, smoothed } = frame;
    if (raw && this.firstVoicedAt == null && raw.clarity >= 0.5 && raw.rms >= 0.008) {
      this.firstVoicedAt = raw.at;
    }
    if (smoothed) this.samples.push(smoothed);
  }

  /** Single-stream convenience for tests and non-engine callers. */
  addSample(sample: PitchSample): void {
    this.addFrame({ raw: sample, smoothed: sample });
  }

  markLost(): void {
    this.rescue.markLost(this.now());
  }

  useRescue(level: number): void {
    this.rescue.use(level);
  }

  finishSinging(): AttemptAnalysis {
    this.assertPhase("sing");
    this.phase = "review";
    this.analysis = this.classifier.classify({
      targetMidi: this.definition.targetMidi,
      startMidi: this.definition.startMidi,
      samples: this.samples,
    });
    return this.analysis;
  }

  needsIntentConfirmation(): boolean {
    return this.analysis != null && this.classifier.needsIntentConfirmation(this.analysis);
  }

  confirmIntent(intent: IntentLabel): void {
    this.assertPhase("review");
    this.intent = intent;
  }

  finalErrorKind(): ErrorKind {
    if (!this.analysis) return "unscored";
    return this.classifier.resolveFinalErrorKind(this.analysis, this.intent);
  }

  toRecord(): TrialRecord {
    if (this.phase !== "review" || !this.analysis) {
      throw new Error("Trial is not reviewable yet.");
    }
    const commitAt = this.firstVoicedAt ?? this.now();
    return {
      ...this.analysis,
      id: crypto.randomUUID(),
      definition: this.definition,
      feedbackMode: this.feedbackMode,
      hintLevel: this.rescue.hintLevel,
      lostEvent: this.rescue.isLost,
      intent: this.intent,
      finalErrorKind: this.finalErrorKind(),
      selectionLatencyMs:
        this.goAt != null && this.firstVoicedAt != null
          ? Math.max(0, this.firstVoicedAt - this.goAt)
          : null,
      recoveryTimeMs: this.rescue.recoveryTime(commitAt),
      confidenceBefore: this.confidenceBefore,
      effort: this.effort,
      register: this.register,
      trace: this.trace,
      createdAt: new Date().toISOString(),
    };
  }

  private assertPhase(expected: TrialPhase): void {
    if (this.phase !== expected) {
      throw new Error(`Expected phase "${expected}" but was "${this.phase}".`);
    }
  }
}
