import { median } from "../music/theory";
import type { RangeStepResult } from "../types";

/**
 * Guided range measurement as explicit turn-taking, one semitone per step:
 *
 *   listen → (pause) → sing → result → next note
 *
 * The app plays a note, waits a beat, then gives the singer a turn to find
 * and hold it. Nothing is judged while the note sounds or during the pause,
 * so the two never overlap. Discrete reference-tone steps are the stronger
 * protocol (Barrett 2020); repeated, coached attempts are what saturate a
 * maximum-performance measure (Ma & Li 2017). See
 * docs/range-training-evidence.md.
 *
 * Direction: starting note → down to the floor → up from just above the
 * start to the ceiling → done. A direction ends when the singer says so or
 * at the microphone's reliable limit — never on its own after a miss.
 *
 * Pure and clock-free: every method takes the time, so the whole flow is
 * testable without audio or timers. The UI plays tones and calls back.
 */

export type WalkDirection = "anchor" | "down" | "up" | "done";
export type WalkPhase = "listen" | "ready" | "sing" | "result" | "turn" | "done";
export type StepResult = RangeStepResult;

export interface RangeWalkOptions {
  /** Silent beat between the note ending and the singer's turn. */
  gapMs: number;
  /** How long the singer has to find and hold the note. */
  singWindowMs: number;
  /** A note counts once held within tolerance for this long. */
  holdMs: number;
  /** In auto mode, how long a success stays on screen before moving on. */
  resultMs: number;
  toleranceSemitones: number;
  /** Beyond these the pitch detector cannot hear reliably (≈60 Hz / ≈1200 Hz). */
  minTargetMidi: number;
  maxTargetMidi: number;
  autoAdvance: boolean;
}

export const RANGE_WALK_DEFAULTS: RangeWalkOptions = {
  gapMs: 1200,
  singWindowMs: 5000,
  holdMs: 500,
  resultMs: 1500,
  toleranceSemitones: 0.75,
  minTargetMidi: 36,
  maxTargetMidi: 84,
  autoAdvance: false,
};

export interface WalkEffect {
  /** Sound this note now, then call toneEnded() with the same toneId. */
  playTone?: number;
  toneId?: number;
}

export interface RangeWalkSnapshot {
  direction: WalkDirection;
  phase: WalkPhase;
  targetMidi: number;
  anchorMidi: number;
  lowMidi: number | null;
  highMidi: number | null;
  attempt: number;
  /** 0..1 of the required hold, during the singer's turn. */
  holdProgress: number;
  /** 0..1 of the pause, while waiting for the turn. */
  readyProgress: number;
  /** 0..1 of the time allowed, during the turn. */
  singProgress: number;
  lastResult: StepResult | null;
  /** True when the latest direction ended at the detector's limit, not by choice. */
  endedAtLimit: boolean;
  steps: StepResult[];
}

/** A gap longer than this between matching frames restarts the hold. */
const MAX_HOLD_GAP_MS = 250;
/** Off-target frames in a row that break a hold — one stray frame is forgiven. */
const OFF_FRAMES_TO_BREAK = 2;
/** Frames this close together form a stretch worth reporting as "what you sang". */
const STEADY_SEMITONES = 0.6;
const STEADY_MIN_FRAMES = 3;

interface Frame {
  midi: number;
  at: number;
}

export class RangeWalk {
  private opts: RangeWalkOptions;
  private direction: WalkDirection = "anchor";
  private phase: WalkPhase = "listen";
  private anchor: number;
  private target: number;
  private attempt = 1;
  private low: number | null = null;
  private high: number | null = null;
  private endedAtLimit = false;
  private toneId = 0;
  private readySince = 0;
  private singSince = 0;
  private resultSince = 0;
  private holdStart: number | null = null;
  private holdOctave = 0;
  private lastGoodAt = 0;
  private offStreak = 0;
  private frames: Frame[] = [];
  private results: StepResult[] = [];

  constructor(anchorMidi: number, opts: Partial<RangeWalkOptions> = {}) {
    this.opts = { ...RANGE_WALK_DEFAULTS, ...opts };
    this.anchor = anchorMidi;
    this.target = anchorMidi;
  }

  get currentPhase(): WalkPhase {
    return this.phase;
  }

  setAutoAdvance(on: boolean): void {
    this.opts = { ...this.opts, autoAdvance: on };
  }

  start(): WalkEffect {
    this.attempt = 1;
    return this.listen();
  }

  /** The note finished sounding: the pause begins. Stale playbacks are ignored. */
  toneEnded(at: number, toneId: number): void {
    if (this.phase !== "listen" || toneId !== this.toneId) return;
    this.phase = "ready";
    this.readySince = at;
  }

  tick(at: number): WalkEffect {
    if (this.phase === "ready" && at - this.readySince >= this.opts.gapMs) {
      this.resetTurn();
      this.phase = "sing";
      this.singSince = at;
      return {};
    }
    if (this.phase === "sing" && at - this.singSince >= this.opts.singWindowMs) {
      this.conclude(at, false, null);
      return {};
    }
    const waiting = this.phase === "turn" || (this.phase === "result" && this.lastResult?.hit === true);
    if (waiting && this.opts.autoAdvance && at - this.resultSince >= this.opts.resultMs) {
      return this.next(at);
    }
    return {};
  }

  /** One pitch frame from the microphone; only the singer's turn is judged. */
  feed(midi: number | null, at: number): void {
    if (this.phase !== "sing" || midi === null) return;
    this.frames.push({ midi, at });

    const tol = this.opts.toleranceSemitones;
    const offset = midi - this.target;
    const octave =
      Math.abs(offset) <= tol ? 0 : Math.abs(offset - 12) <= tol ? 1 : Math.abs(offset + 12) <= tol ? -1 : null;

    if (octave === null) {
      this.offStreak += 1;
      if (this.offStreak >= OFF_FRAMES_TO_BREAK) this.holdStart = null;
      return;
    }
    this.offStreak = 0;
    if (this.holdStart === null || octave !== this.holdOctave || at - this.lastGoodAt > MAX_HOLD_GAP_MS) {
      this.holdStart = at;
      this.holdOctave = octave;
    }
    this.lastGoodAt = at;
    if (at - this.holdStart < this.opts.holdMs) return;

    if (octave === 0) {
      this.conclude(at, true, null);
    } else if (this.direction === "anchor") {
      // Answering the starting note an octave away is a choice of register,
      // not an error: centre the walk where this voice actually sits.
      this.anchor += 12 * octave;
      this.target += 12 * octave;
      this.conclude(at, true, null);
    } else {
      this.conclude(at, false, octave as 1 | -1);
    }
  }

  /** After a success (or from the turn between directions): the next note. */
  next(at: number): WalkEffect {
    if (this.phase === "turn") {
      this.attempt = 1;
      return this.listen();
    }
    if (this.phase !== "result" || this.lastResult?.hit !== true) return {};
    if (this.direction === "anchor") this.direction = "down";
    const candidate = this.target + (this.direction === "down" ? -1 : 1);
    if (candidate < this.opts.minTargetMidi || candidate > this.opts.maxTargetMidi) {
      this.finishDirection(at, true);
      return {};
    }
    this.target = candidate;
    this.attempt = 1;
    return this.listen();
  }

  /** After a miss: the same note again, counted as another attempt. */
  retry(): WalkEffect {
    if (this.phase !== "result" || this.lastResult?.hit !== false) return {};
    this.attempt += 1;
    return this.listen();
  }

  /** Replay the note before or during the turn; not an attempt. */
  hearAgain(): WalkEffect {
    if (this.phase !== "ready" && this.phase !== "sing") return {};
    return this.listen();
  }

  /** "That's my lowest / highest." */
  endDirection(at: number): void {
    if (this.direction === "down" || this.direction === "up") this.finishDirection(at, false);
  }

  snapshot(at: number): RangeWalkSnapshot {
    const fraction = (elapsed: number, total: number) => Math.max(0, Math.min(1, elapsed / total));
    const holdCounts =
      this.phase === "sing" &&
      this.holdStart !== null &&
      (this.holdOctave === 0 || this.direction === "anchor");
    return {
      direction: this.direction,
      phase: this.phase,
      targetMidi: this.target,
      anchorMidi: this.anchor,
      lowMidi: this.low,
      highMidi: this.high,
      attempt: this.attempt,
      holdProgress: holdCounts ? fraction(at - this.holdStart!, this.opts.holdMs) : 0,
      readyProgress: this.phase === "ready" ? fraction(at - this.readySince, this.opts.gapMs) : 0,
      singProgress: this.phase === "sing" ? fraction(at - this.singSince, this.opts.singWindowMs) : 0,
      lastResult: this.lastResult,
      endedAtLimit: this.endedAtLimit,
      steps: [...this.results],
    };
  }

  private get lastResult(): StepResult | null {
    return this.results[this.results.length - 1] ?? null;
  }

  private listen(): WalkEffect {
    this.resetTurn();
    this.phase = "listen";
    this.toneId += 1;
    return { playTone: this.target, toneId: this.toneId };
  }

  private resetTurn(): void {
    this.holdStart = null;
    this.holdOctave = 0;
    this.offStreak = 0;
    this.frames = [];
  }

  private conclude(at: number, hit: boolean, octaveOff: 1 | -1 | null): void {
    const stretch =
      (hit || octaveOff !== null) && this.holdStart !== null
        ? this.frames.filter((f) => f.at >= this.holdStart!).map((f) => f.midi)
        : steadiestStretch(this.frames);
    const sungMidi = stretch.length > 0 ? median(stretch) : null;
    this.results.push({
      targetMidi: this.target,
      direction: this.direction === "done" ? "up" : this.direction,
      attempt: this.attempt,
      hit,
      octaveOff,
      sungMidi,
      centsOff: sungMidi === null ? null : Math.round((sungMidi - this.target) * 100),
      timeToMatchMs: hit ? at - this.singSince : null,
      startedAt: this.singSince,
      endedAt: at,
    });
    if (hit) {
      this.low = this.low === null ? this.target : Math.min(this.low, this.target);
      this.high = this.high === null ? this.target : Math.max(this.high, this.target);
    }
    this.phase = "result";
    this.resultSince = at;
  }

  private finishDirection(at: number, atLimit: boolean): void {
    this.endedAtLimit = atLimit;
    this.resetTurn();
    if (this.direction === "down" && this.anchor + 1 <= this.opts.maxTargetMidi) {
      this.direction = "up";
      this.target = this.anchor + 1;
      this.phase = "turn";
      this.resultSince = at;
      return;
    }
    this.direction = "done";
    this.phase = "done";
  }
}

/** The longest run of close-together frames — what the singer settled on. */
function steadiestStretch(frames: Frame[]): number[] {
  let best: number[] = [];
  let run: Frame[] = [];
  const flush = () => {
    if (run.length >= STEADY_MIN_FRAMES && run.length > best.length) best = run.map((f) => f.midi);
    run = [];
  };
  for (const frame of frames) {
    if (run.length > 0) {
      const center = median(run.map((f) => f.midi)) ?? frame.midi;
      const gap = frame.at - run[run.length - 1].at;
      if (gap > MAX_HOLD_GAP_MS || Math.abs(frame.midi - center) > STEADY_SEMITONES) flush();
    }
    run.push(frame);
  }
  flush();
  return best;
}
