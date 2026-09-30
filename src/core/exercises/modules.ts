import { EXERCISE_REASON, evidenceFor } from "../science/evidence";
import { KEYS, MAJOR_SCALE, SOLFEGE, diatonicMidi } from "../music/theory";
import type { FeedbackMode, TrialDefinition } from "../types";
import { Exercise, type CuePlan, type ExerciseGuide, type TrialRequest } from "./Exercise";

/** Hear one target, sing it back — isolates pure landing (PRD §9.1). */
export class DirectEcho extends Exercise {
  readonly id = "echo";
  readonly title = "Direct echo";
  readonly subtitle = "Hear one note, sing it back. Trains the hearing-to-voice mapping every other skill sits on.";
  readonly measures = "Correct-target intonation residual, range anomalies";
  readonly defaultFeedback: FeedbackMode = "live";

  readonly guide: ExerciseGuide = {
    task: "Hear one note, then sing that same note back.",
    steps: [
      "One tone plays. Nothing else sounds.",
      "The screen switches to Sing. Sing the note back on any vowel or a hum.",
      "Pick one note and hold it steady. Don't slide around hunting for it: the first moment of your note is what gets scored.",
      "Recording stops by itself after 4 seconds.",
    ],
    skill: "Hearing → voice mapping",
    trains:
      EXERCISE_REASON[this.id],
    why:
      "Use this as one practice question, alongside comfortable singing and musical phrases. Improvement on this task does not establish a diagnosis or guarantee transfer.",
    brain:
      EXERCISE_REASON[this.id],
    science: evidenceFor(this.id).map(s => ({ point: `${s.finding} Limits: ${s.limit}`, source: `${s.citation} ${s.url}` })),
    tips: [
      "Use headphones so the tone doesn't leak into the microphone.",
      "The first stable note and later movement are separate observations. Describe what you intended; neither one diagnoses the cause of a miss.",
    ],
  };

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    // Echo has no melodic route: start and target coincide.
    const echo = { ...route, startDegree: route.targetDegree, startMidi: route.targetMidi, delayMs: 0 };
    return this.finalize(echo, [route.targetMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    return {
      playCadence: false, // bare target: extra pitches would interfere
      contextMidis: [trial.targetMidi],
      cueLabels: ["The note"],
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
  readonly subtitle = "Hear a note travel to a destination, then rebuild that jump from the start note alone. Trains relative pitch.";
  readonly measures = "Destination selection, direction, latency, hint dependence";
  readonly defaultFeedback: FeedbackMode = "commit";

  readonly guide: ExerciseGuide = {
    task: "Hear a start note and a destination, then sing the destination when only the start note plays again.",
    steps: [
      "Two tones play: the start note, then the destination.",
      "A beat of silence. Then the start note plays once more, alone.",
      "Right after it, sing the destination. This time you only get the start, so you rebuild the jump from memory.",
      "In the test the jump is always one scale step, up or down.",
    ],
    skill: "Relative pitch (intervals)",
    trains:
      EXERCISE_REASON[this.id],
    why:
      "Use this as one practice question, alongside comfortable singing and musical phrases. Improvement on this task does not establish a diagnosis or guarantee transfer.",
    brain:
      EXERCISE_REASON[this.id],
    science: evidenceFor(this.id).map(s => ({ point: `${s.finding} Limits: ${s.limit}`, source: `${s.citation} ${s.url}` })),
    tips: [
      "Keep the jump playing in your head while you wait, then ride it from the start note.",
      "The review separates observed direction, pitch center and your explanation. These observations do not diagnose a map or voice problem.",
    ],
  };

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    return this.finalize(route, [route.startMidi, route.targetMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    return {
      playCadence: false, // the interval is the whole task; a chord adds nothing to sing from
      contextMidis: [trial.startMidi, trial.targetMidi],
      cueLabels: ["Start", "Destination"],
      playStartAtGo: true,
      goLabel: "Start again",
      revealTarget: false,
      prompt: "When the start note plays again, sing the destination.",
    };
  }
}

/** Hold a target through silence before singing (§9.4). */
export class SilentMap extends Exercise {
  readonly id = "silent";
  readonly title = "Silent map";
  readonly subtitle = "Keep a note in your head through silence, then sing it. Trains pitch memory and inner hearing.";
  readonly measures = "Auditory retention curve and target availability";
  readonly defaultFeedback: FeedbackMode = "blind";

  readonly guide: ExerciseGuide = {
    task: "Hear one note, keep it in your head through the silence, then sing it.",
    steps: [
      "One tone plays.",
      "Silence follows, with a countdown on screen. Keep hearing the note in your head. Don't hum it out loud.",
      "When the countdown ends and the screen says Sing, sing the note you kept.",
    ],
    skill: "Pitch memory (inner hearing)",
    trains:
      EXERCISE_REASON[this.id],
    why:
      "Use this as one practice question, alongside comfortable singing and musical phrases. Improvement on this task does not establish a diagnosis or guarantee transfer.",
    brain:
      EXERCISE_REASON[this.id],
    science: evidenceFor(this.id).map(s => ({ point: `${s.finding} Limits: ${s.limit}`, source: `${s.citation} ${s.url}` })),
    tips: [
      "No humming or whispering the note. If it's audible, you're measuring echo, not memory.",
      "If the note is gone when it's time to sing, sing your best guess. A miss here is exactly what this measures.",
    ],
  };

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    const echo = { ...route, startDegree: route.targetDegree, startMidi: route.targetMidi };
    return this.finalize(echo, [route.targetMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    const seconds = (trial.delayMs / 1000).toFixed(0);
    return {
      playCadence: false, // tones before the hold interfere with holding it (Deutsch 1970)
      contextMidis: [trial.targetMidi],
      cueLabels: ["The note to keep"],
      playStartAtGo: false,
      revealTarget: true,
      prompt:
        trial.delayMs > 0
          ? `Keep the note in your head through ${seconds} s of silence (no humming), then sing it.`
          : "Sing back the note you just heard.",
    };
  }
}

/** Navigate from a current note to a scale location using key context (§9.3). */
export class TonalNorth extends Exercise {
  readonly id = "tonal";
  readonly title = "Tonal north";
  readonly subtitle = "Find a note by its place in the key, not from the last note you heard. Trains navigating by key.";
  readonly measures = "Scale-location confusion and independent navigation";
  readonly defaultFeedback: FeedbackMode = "commit";

  readonly guide: ExerciseGuide = {
    task: "The app sets a key and puts you on one of its notes; sing the note the screen names, finding it by its place in the key.",
    steps: [
      "Look at the key map. It marks three notes: Home (do, where the key comes to rest), You're here (your starting note) and Sing this (the target).",
      "A chord plays. That chord is home: it sets the key.",
      "Two single tones follow: home (do), then the note you're on.",
      "The note you're on plays once more, then it's your turn. Hear home in your head and find the target by its place in the key: count its steps from do on the map, rather than sliding over from the last note you heard.",
    ],
    skill: "Navigating by key",
    trains:
      EXERCISE_REASON[this.id],
    why:
      "Use this as one practice question, alongside comfortable singing and musical phrases. Improvement on this task does not establish a diagnosis or guarantee transfer.",
    brain:
      EXERCISE_REASON[this.id],
    science: evidenceFor(this.id).map(s => ({ point: `${s.finding} Limits: ${s.limit}`, source: `${s.citation} ${s.url}` })),
    tips: [
      "Example: you're on sol and the target is mi. Hear do, climb do–re–mi in your head, and sing that mi, even though sol was the last note you heard.",
      "Degrees: 1 do · 2 re · 3 mi · 4 fa · 5 sol · 6 la · 7 ti. The map shows whether the target sits above or below you.",
      "Accuracy first. Speed comes once the map is solid.",
    ],
  };

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    return this.finalize(route, [route.tonicMidi, route.startMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    const here = `${SOLFEGE[trial.startDegree]} (${trial.startDegree + 1})`;
    const target = `${SOLFEGE[trial.targetDegree]} (${trial.targetDegree + 1})`;
    return {
      playCadence: true, // the key IS this exercise: the chord is the map being navigated
      contextMidis: [trial.tonicMidi, trial.startMidi],
      cueLabels: ["Home · do (1)", `You're here · ${here}`],
      playStartAtGo: true,
      goLabel: `You're here · ${here}. Now sing ${SOLFEGE[trial.targetDegree]}.`,
      revealTarget: false,
      showKeyMap: true,
      prompt: `You're on ${here}. Sing ${target}: find it from home.`,
    };
  }
}

/** Notes heard before the gap; the answer is the next one. */
const PATTERN_NOTES = 4;

const mod7 = (degree: number) => ((degree % 7) + 7) % 7;
const pitchClass = (midi: number) => ((midi % 12) + 12) % 12;

/**
 * Every answer within this constrained task: for each of the 12 major keys that
 * holds all the heard notes as an even run (a constant stride of scale steps),
 * the pitch class of the run's next note. A pattern is unambiguous WITHIN THAT RULE only when this
 * set has exactly one member, meaning that constraint and the heard notes settle the pitch class; arbitrary musical continuations remain possible.
 */
function patternContinuations(heard: number[]): Set<number> {
  const answers = new Set<number>();
  for (let root = 0; root < 12; root += 1) {
    const positions: number[] = [];
    for (const midi of heard) {
      const index = MAJOR_SCALE.indexOf(pitchClass(midi - root));
      if (index < 0) break;
      positions.push(7 * Math.floor((midi - root) / 12) + index);
    }
    if (positions.length !== heard.length) continue;
    const stride = positions[1] - positions[0];
    if (stride === 0 || positions.some((p, i) => i > 0 && p - positions[i - 1] !== stride)) continue;
    answers.add(pitchClass(diatonicMidi(root, positions[positions.length - 1] + stride)));
  }
  return answers;
}

/** Hear a scale pattern that stops one note early, sing the next note (§9.5). */
export class MissingNote extends Exercise {
  readonly id = "missing";
  readonly title = "Pattern completion";
  readonly subtitle = "Continue a major-scale run using the same direction and step spacing.";
  readonly measures = "Phrase retrieval, prediction, and musical transfer";
  readonly defaultFeedback: FeedbackMode = "blind";

  readonly guide: ExerciseGuide = {
    task: "Hear four notes walk through the key, then sing the fifth: the note the pattern is heading to.",
    steps: [
      "Four notes play, moving in one direction one scale step at a time, like do, re, mi, fa.",
      "The pattern stops one note early, and the screen says Sing.",
      "Sing the next note of the pattern (after do, re, mi, fa, that's sol). Stay in the key: some scale steps are whole steps and some are half steps, and choosing the right one is the skill.",
      "Keep the same direction and spacing in a major scale; the answer is unique only within that rule, not for every possible melody.",
    ],
    skill: "Melodic prediction",
    trains:
      EXERCISE_REASON[this.id],
    why:
      "Use this as one practice question, alongside comfortable singing and musical phrases. Improvement on this task does not establish a diagnosis or guarantee transfer.",
    brain:
      EXERCISE_REASON[this.id],
    science: evidenceFor(this.id).map(s => ({ point: `${s.finding} Limits: ${s.limit}`, source: `${s.citation} ${s.url}` })),
    tips: [
      "Hear the answer in your head first, then sing it. Don't sing up through the pattern to find it.",
      "If two notes both seem possible, commit cleanly to one. An unexpected pitch needs your explanation; the microphone cannot decide its cause.",
    ],
  };

  createTrial(request: TrialRequest): TrialDefinition {
    const random = request.random ?? Math.random;
    const key = KEYS[Math.floor(random() * KEYS.length)];
    const tonicMidi = 48 + key.root;
    const stride =
      request.difficulty === "steps" ? 1 : request.difficulty === "thirds" ? 2 : random() < 0.5 ? 1 : 2;
    // The whole pattern, answer included, stays in the band the other modules sing in.
    const low = tonicMidi - 7;
    const high = tonicMidi + (stride === 1 ? 9 : 14);

    const fair: number[][] = [];
    for (let first = -7; first <= 14; first += 1) {
      for (const direction of [1, -1]) {
        const degrees = Array.from({ length: PATTERN_NOTES + 1 }, (_, i) => first + i * stride * direction);
        const midis = degrees.map((d) => diatonicMidi(tonicMidi, d));
        if (Math.min(...midis) < low || Math.max(...midis) > high) continue;
        const answers = patternContinuations(midis.slice(0, PATTERN_NOTES));
        if (answers.size === 1 && answers.has(pitchClass(midis[PATTERN_NOTES]))) fair.push(degrees);
      }
    }
    if (fair.length === 0) throw new Error(`No fair missing-note pattern in ${key.name}.`);

    const degrees = fair[Math.floor(random() * fair.length)];
    const midis = degrees.map((d) => diatonicMidi(tonicMidi, d));
    return this.finalize(
      {
        keyName: key.name,
        tonicMidi,
        scale: MAJOR_SCALE,
        startDegree: mod7(degrees[PATTERN_NOTES - 1]),
        targetDegree: mod7(degrees[PATTERN_NOTES]),
        startMidi: midis[PATTERN_NOTES - 1],
        targetMidi: midis[PATTERN_NOTES],
        delayMs: request.delayMs,
        load: "neutral",
      },
      midis,
    );
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    const heard = trial.phraseMidis.slice(0, -1);
    return {
      playCadence: false, // the pattern itself carries the key; a chord first is just noise
      contextMidis: heard,
      cueLabels: heard.map((_, i) => `Note ${i + 1}`),
      playStartAtGo: false,
      revealTarget: false,
      prompt: `Sing note ${heard.length + 1}: where the pattern is heading.`,
    };
  }
}
