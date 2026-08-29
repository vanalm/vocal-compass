import { MAJOR_SCALE } from "../music/theory";
import type { FeedbackMode, TrialDefinition } from "../types";
import { Exercise, type CuePlan, type TrialRequest } from "./Exercise";

/** Hear one target, sing it back — isolates pure landing (PRD §9.1). */
export class DirectEcho extends Exercise {
  readonly id = "echo";
  readonly title = "Direct echo";
  readonly subtitle = "Hear a single note, then land it immediately.";
  readonly measures = "Correct-target intonation residual, range anomalies";
  readonly defaultFeedback: FeedbackMode = "live";

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    // Echo has no melodic route: start and target coincide.
    const echo = { ...route, startDegree: route.targetDegree, startMidi: route.targetMidi, delayMs: 0 };
    return this.finalize(echo, [route.targetMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    return {
      playCadence: false, // bare target: cadence pitches would interfere
      contextMidis: [trial.targetMidi],
      playStartAtGo: false,
      revealTarget: true,
      prompt: "Sing back the note you just heard.",
    };
  }
}

/** Hear start→target, then reproduce the target from the start alone (§9.2). */
export class RouteReplay extends Exercise {
  readonly id = "route";
  readonly title = "Route replay";
  readonly subtitle = "Hear start → destination, then reproduce the destination from the start alone.";
  readonly measures = "Destination selection, direction, latency, hint dependence";
  readonly defaultFeedback: FeedbackMode = "commit";

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    return this.finalize(route, [route.startMidi, route.targetMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    return {
      playCadence: true,
      contextMidis: [trial.startMidi, trial.targetMidi],
      playStartAtGo: true,
      revealTarget: false,
      prompt: "You heard the route once. Hear the destination internally, then sing it.",
    };
  }
}

/** Hold a target through silence before singing (§9.4). */
export class SilentMap extends Exercise {
  readonly id = "silent";
  readonly title = "Silent map";
  readonly subtitle = "Hold a target internally through a silent delay before singing it.";
  readonly measures = "Auditory retention curve and target availability";
  readonly defaultFeedback: FeedbackMode = "blind";

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    const echo = { ...route, startDegree: route.targetDegree, startMidi: route.targetMidi };
    return this.finalize(echo, [route.targetMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    const seconds = (trial.delayMs / 1000).toFixed(0);
    return {
      playCadence: true,
      contextMidis: [trial.targetMidi],
      playStartAtGo: false,
      revealTarget: true,
      prompt: `Hold the note silently for ${seconds}s, then sing it.`,
    };
  }
}

/** Navigate from a current note to a scale location using key context (§9.3). */
export class TonalNorth extends Exercise {
  readonly id = "tonal";
  readonly title = "Tonal north";
  readonly subtitle = "Use key context to navigate from the current note to a scale location.";
  readonly measures = "Scale-location confusion and independent navigation";
  readonly defaultFeedback: FeedbackMode = "commit";

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    return this.finalize(route, [route.tonicMidi, route.startMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    return {
      playCadence: true,
      contextMidis: [trial.tonicMidi, trial.startMidi],
      playStartAtGo: true,
      revealTarget: false,
      prompt: `You heard home and your current note. Sing scale degree ${trial.targetDegree + 1}.`,
    };
  }
}

/** Hear a short phrase, supply its omitted final note (§9.5). */
export class MissingNote extends Exercise {
  readonly id = "missing";
  readonly title = "Missing note";
  readonly subtitle = "Hear a short phrase, then supply its omitted destination in context.";
  readonly measures = "Phrase retrieval, prediction, and musical transfer";
  readonly defaultFeedback: FeedbackMode = "blind";

  createTrial(request: TrialRequest): TrialDefinition {
    // The cue plays the phrase minus its last note, so no earlier phrase
    // note may equal the target — that would leak the answer.
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const route = this.buildRoute(request);
      const bridgeDegree =
        (((route.startDegree + Math.sign(route.targetMidi - route.startMidi)) % 7) + 7) % 7;
      const phrase = [
        route.tonicMidi,
        route.tonicMidi + MAJOR_SCALE[bridgeDegree],
        route.startMidi,
        route.targetMidi,
      ];
      const leak = phrase.slice(0, -1).includes(route.targetMidi);
      if (!leak || attempt === 7) {
        const cleaned = leak
          ? [...phrase.slice(0, -1).filter((m) => m !== route.targetMidi), route.targetMidi]
          : phrase;
        return this.finalize(route, cleaned);
      }
    }
    throw new Error("unreachable");
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    return {
      playCadence: true,
      contextMidis: trial.phraseMidis.slice(0, -1),
      playStartAtGo: false,
      revealTarget: false,
      prompt: "The phrase stopped one note early. Sing the missing final note.",
    };
  }
}
