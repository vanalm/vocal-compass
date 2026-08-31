/**
 * Tone-guided discrete-step range measurement. The evidence behind the
 * shape (docs/range-training-evidence.md): discrete half-steps with a
 * reference tone elicit better extremes than free glissando (Barrett 2020),
 * and coached, repeated attempts are what saturate a maximum-performance
 * measurement (Ma & Li 2017). The app plays each target; the user copies it;
 * a step counts only when actually matched and held.
 *
 * anchor → down (semitone at a time to the floor) → up (to the ceiling) → done.
 * A direction ends by explicit skip ("can't reach it") or by step timeout —
 * never by a crack: off-pitch frames just reset the held count.
 */

export interface RangeWalkOptions {
  /** Consecutive close frames required before a step counts (~200ms at 70ms). */
  matchFrames: number;
  /** How close (in semitones) a frame must be to the target. */
  toleranceSemitones: number;
  /** No match for this long ends the direction — the edge was found. */
  stepTimeoutMs: number;
}

const DEFAULTS: RangeWalkOptions = {
  matchFrames: 4,
  toleranceSemitones: 0.75,
  stepTimeoutMs: 8000,
};

export type RangeWalkPhase = "anchor" | "down" | "up" | "done";

export interface RangeWalkState {
  phase: RangeWalkPhase;
  targetMidi: number;
  lowMidi: number | null;
  highMidi: number | null;
  /** 0..1 — how much of the required hold is done, for the UI. */
  matchProgress: number;
}

export interface FeedResult {
  advanced: boolean;
  /** When set, the UI should sound this reference tone next. */
  toneToPlay?: number;
}

export class RangeWalk {
  private phase: RangeWalkPhase = "anchor";
  private target: number;
  private low: number | null = null;
  private high: number | null = null;
  private held = 0;
  private stepStartedAt: number | null = null;

  constructor(
    private readonly anchorMidi: number,
    private readonly opts: RangeWalkOptions = DEFAULTS,
  ) {
    this.target = anchorMidi;
  }

  get state(): RangeWalkState {
    return {
      phase: this.phase,
      targetMidi: this.target,
      lowMidi: this.low,
      highMidi: this.high,
      matchProgress: Math.min(1, this.held / this.opts.matchFrames),
    };
  }

  feed(midi: number | null, at: number): FeedResult {
    if (this.phase === "done") return { advanced: false };
    if (this.stepStartedAt == null) this.stepStartedAt = at;

    if (at - this.stepStartedAt > this.opts.stepTimeoutMs && this.held < this.opts.matchFrames) {
      return this.endDirection();
    }

    if (midi == null || Math.abs(midi - this.target) > this.opts.toleranceSemitones) {
      this.held = 0;
      return { advanced: false };
    }
    this.held += 1;
    if (this.held < this.opts.matchFrames) return { advanced: false };
    return this.stepMatched(at);
  }

  /** "Can't reach it": ends the current direction at the last matched note. */
  skipStep(): FeedResult {
    if (this.phase === "done") return { advanced: false };
    return this.endDirection();
  }

  private stepMatched(at: number): FeedResult {
    if (this.low == null || this.target < this.low) this.low = this.target;
    if (this.high == null || this.target > this.high) this.high = this.target;
    if (this.phase === "anchor") this.phase = "down";
    this.target += this.phase === "down" ? -1 : 1;
    this.beginStep(at);
    return { advanced: true, toneToPlay: this.target };
  }

  private endDirection(): FeedResult {
    if (this.phase === "up") {
      this.phase = "done";
      return { advanced: true };
    }
    // anchor (matched or not) and down both turn upward from above the anchor
    this.phase = "up";
    this.target = this.anchorMidi + 1;
    this.beginStep(null);
    return { advanced: true, toneToPlay: this.target };
  }

  private beginStep(at: number | null): void {
    this.held = 0;
    // The step's clock starts when the step begins (the frame that completed
    // the previous one), not at the next mic frame — else a silent user
    // never times out.
    this.stepStartedAt = at;
  }
}
