import type { FeedbackMode, TrialDefinition } from "../types";
import { KEYS, MAJOR_SCALE } from "../music/theory";

export type Difficulty = "steps" | "thirds" | "leaps" | "mixed";

/** What the cue player should sound before an attempt. */
export interface CuePlan {
  /** Whether the tonic chord sounds first. Only a module whose task IS the
   * key plays it: any other tone before an attempt is interference, not
   * context — intervening tones disrupt pitch memory (Deutsch 1970). */
  playCadence: boolean;
  /** Ordered context notes (tonic, phrase…). */
  contextMidis: number[];
  /** What each context note is, shown while it sounds — one per note. */
  cueLabels: string[];
  /** Whether the start note is sounded at the go-signal. */
  playStartAtGo: boolean;
  /** What the go-signal note is; present exactly when one plays. */
  goLabel?: string;
  /** Whether the target itself is sounded during acquisition. */
  revealTarget: boolean;
  /** The instruction on screen for the whole trial. */
  prompt: string;
}

/** One claim about the brain, with the study it rests on. */
export interface ScienceNote {
  point: string;
  source: string;
}

/**
 * Everything a singer needs to understand a module: the task, the mechanism
 * it trains, why that matters, and the neuroscience behind it. The single
 * source for every instruction surface — test intro, info modal, Lab — so
 * they can never disagree.
 */
export interface ExerciseGuide {
  /** The whole task in one sentence. */
  task: string;
  /** What happens, in order: every sound you will hear and your part. */
  steps: string[];
  /** Short name of the mechanism, for compact places. */
  skill: string;
  /** The mechanism trained. */
  trains: string;
  /** Why it matters when singing real music. */
  why: string;
  /** The neuroscience in one or two sentences. */
  brain: string;
  science: ScienceNote[];
  tips: string[];
}

export interface TrialRequest {
  difficulty: Difficulty;
  delayMs: number;
  /** Injectable RNG so tests are deterministic. */
  random?: () => number;
}

/**
 * An Exercise owns everything specific to one training module:
 * how trials are generated, what is cued, the default feedback policy, and
 * the guide that explains it.
 *
 * To add a module: subclass, implement the abstract members, and register
 * it in `registry.ts`. Nothing else in the app changes.
 */
export abstract class Exercise {
  abstract readonly id: string;
  abstract readonly title: string;
  abstract readonly subtitle: string;
  abstract readonly measures: string;
  /** PRD §10.2 default feedback policy for this skill. */
  abstract readonly defaultFeedback: FeedbackMode;
  abstract readonly guide: ExerciseGuide;

  abstract createTrial(request: TrialRequest): TrialDefinition;
  abstract cuePlan(trial: TrialDefinition): CuePlan;

  /** Shared random diatonic route generator used by most modules. */
  protected buildRoute(request: TrialRequest): Omit<TrialDefinition, "id" | "exerciseId" | "phraseMidis" | "createdAt"> {
    const random = request.random ?? Math.random;
    const key = KEYS[Math.floor(random() * KEYS.length)];
    const tonicMidi = 48 + key.root;
    const startDegree = Math.floor(random() * 4);

    let candidates: number[];
    switch (request.difficulty) {
      case "steps": candidates = [startDegree - 1, startDegree + 1]; break;
      case "thirds": candidates = [startDegree - 2, startDegree + 2]; break;
      case "leaps": candidates = [startDegree - 4, startDegree + 3, startDegree + 4]; break;
      default:
        candidates = [startDegree - 2, startDegree - 1, startDegree + 1, startDegree + 2, startDegree + 3, startDegree + 4];
    }

    const normalized = candidates
      .map((d) => ((d % 7) + 7) % 7)
      .filter((d) => d !== startDegree);
    const targetDegree = normalized[Math.floor(random() * normalized.length)];

    const startMidi = tonicMidi + MAJOR_SCALE[startDegree];
    let targetMidi = tonicMidi + MAJOR_SCALE[targetDegree];
    const rawDelta = targetMidi - startMidi;
    if (rawDelta > 7) targetMidi -= 12;
    if (rawDelta < -7) targetMidi += 12;

    return {
      keyName: key.name,
      tonicMidi,
      scale: MAJOR_SCALE,
      startDegree,
      targetDegree,
      startMidi,
      targetMidi,
      delayMs: request.delayMs,
      load: "neutral",
    };
  }

  protected finalize(
    route: Omit<TrialDefinition, "id" | "exerciseId" | "phraseMidis" | "createdAt">,
    phraseMidis: number[],
  ): TrialDefinition {
    return {
      ...route,
      id: crypto.randomUUID(),
      exerciseId: this.id,
      phraseMidis,
      createdAt: new Date().toISOString(),
    };
  }
}
