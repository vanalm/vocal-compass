import type { FeedbackMode, TrialDefinition } from "../types";
import { KEYS, MAJOR_SCALE } from "../music/theory";

export type Difficulty = "steps" | "thirds" | "leaps" | "mixed";

/** What the cue player should sound before an attempt. */
export interface CuePlan {
  /** Ordered context notes (tonic, cadence, phrase…). */
  contextMidis: number[];
  /** Whether the start note is sounded at the go-signal. */
  playStartAtGo: boolean;
  /** Whether the target itself is sounded during acquisition. */
  revealTarget: boolean;
  /** Spoken/visible instruction for the Imagine phase. */
  prompt: string;
}

export interface TrialRequest {
  difficulty: Difficulty;
  delayMs: number;
  /** Injectable RNG so tests are deterministic. */
  random?: () => number;
}

/**
 * An Exercise owns everything specific to one training module:
 * how trials are generated, what is cued, and the default feedback policy.
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
