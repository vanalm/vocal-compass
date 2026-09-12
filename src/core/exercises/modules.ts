import { KEYS, MAJOR_SCALE, diatonicMidi } from "../music/theory";
import type { FeedbackMode, TrialDefinition } from "../types";
import { Exercise, type CuePlan, type ExerciseGuide, type TrialRequest } from "./Exercise";

const SOLFEGE = ["do", "re", "mi", "fa", "sol", "la", "ti"];

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
      "The auditory-to-vocal mapping: turning a pitch you hear into the muscle settings that make your vocal folds produce that pitch.",
    why:
      "Every other skill here sits on top of this one. If the mapping is off, even a note you hear perfectly in your head comes out wrong.",
    brain:
      "A pathway in the brain's dorsal auditory stream links auditory cortex to the motor areas that control the larynx. Practice makes the command your brain sends at the start of a note more accurate.",
    science: [
      {
        point:
          "Most people who sing out of tune hear pitch normally. The weak link is turning what they hear into a vocal command: many can easily tell two notes apart but can't imitate either one.",
        source: "Pfordresher & Brown 2007, Music Perception 25:95; Hutchins & Peretz 2012, J Exp Psychol Gen 141:76",
      },
      {
        point:
          "Hearing and vocal movement meet in the dorsal auditory stream. Auditory cortex in the superior temporal lobe connects through a sensorimotor area at the back of the Sylvian fissure (area Spt) to premotor and laryngeal motor cortex. Spt is active both when you hear a melody and when you silently rehearse it.",
        source: "Hickok et al. 2003, J Cogn Neurosci 15:673; Hickok & Poeppel 2007, Nat Rev Neurosci 8:393",
      },
      {
        point:
          "The brain controls voice pitch in two ways. A learned feedforward command sets the note before you can hear yourself, and a feedback loop corrects it about 100–200 ms later. The first ~0.9 s of your note mostly reflects the feedforward command, so that's where the note you chose is read.",
        source: "Burnett et al. 1998, J Acoust Soc Am 103:3153; Tourville & Guenther 2011, Lang Cogn Process 26:952 (DIVA model)",
      },
      {
        point:
          "Feedback that is always on helps in the moment but builds dependence, so the gains shrink once it's removed (the guidance hypothesis). The test is blind so it measures you, not the display.",
        source: "Salmoni, Schmidt & Walter 1984, Psychol Bull 95:355",
      },
    ],
    tips: [
      "Use headphones so the tone doesn't leak into the microphone.",
      "A clean wrong note is more useful than a slide that eventually finds the right one: it shows exactly what your mapping produced.",
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
      "Relative pitch: remembering a melody as the size and direction of the jumps between notes, then rebuilding a jump from a new starting note.",
    why:
      "Songs are remembered as intervals, not fixed frequencies. That's why you can start Happy Birthday on any note. Singing a melody means landing one jump after another.",
    brain:
      "Right-hemisphere auditory cortex encodes which way pitch moves and by how much. The intraparietal sulcus shifts that pattern onto a new starting note, and this exercise works that shift.",
    science: [
      {
        point:
          "People recognize a tune moved to a new key even though every frequency has changed. Memory for melody rests on contour and interval, not absolute pitch.",
        source: "Dowling 1978, Psychol Rev 85:341",
      },
      {
        point:
          "Fine pitch changes are processed mainly in right auditory cortex. Surgery that removes right-hemisphere tissue including Heschl's gyrus (primary auditory cortex) makes it harder to tell whether pitch went up or down.",
        source: "Johnsrude, Penhune & Zatorre 2000, Brain 123:155; Zatorre, Belin & Penhune 2002, Trends Cogn Sci 6:37",
      },
      {
        point:
          "Checking a melody against a transposed copy recruits the intraparietal sulcus, the region that also handles mental transformations like rotation. Moving an interval onto a new note is an active computation, not a lookup.",
        source: "Foster & Zatorre 2010, Cereb Cortex 20:1350",
      },
      {
        point: "In adults, pitch training built on melodies improves accuracy more readily than single-note matching.",
        source: "Berglin, Pfordresher & Demorest 2022, Psychol Music 50",
      },
    ],
    tips: [
      "Keep the jump playing in your head while you wait, then ride it from the start note.",
      "The review separates going the wrong way (a map problem) from choosing the right note and landing off-center (a voice problem).",
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
      "Auditory working memory and imagery: holding a pitch as an inner sound, with nothing sounding, for long enough to use it.",
    why:
      "In real singing, the note you need is rarely sounding. You come back in after a rest, start a song cold, or hold the key through a guitar break. If the note fades within two seconds, every entrance is a guess.",
    brain:
      "Imagining a note reuses auditory cortex, and a loop with frontal and parietal areas keeps it alive. Other tones knock it out, so this trial plays only the note itself.",
    science: [
      {
        point:
          "Imagining music activates secondary auditory cortex, the same areas that respond when you actually hear it. Inner hearing runs on the hearing machinery.",
        source: "Zatorre et al. 1996, J Cogn Neurosci 8:29; Halpern & Zatorre 1999, Cereb Cortex 9:697",
      },
      {
        point:
          "Holding a pitch in mind depends on auditory cortex working with frontal and parietal regions. Stimulating that network at theta rhythm improved people's auditory working memory, so the network causes the ability rather than just tracking it.",
        source: "Zatorre, Evans & Meyer 1994, J Neurosci 14:1908; Albouy et al. 2017, Neuron 94:193",
      },
      {
        point:
          "Pitch memory is fragile in a specific way: tones heard during the wait disrupt it far more than the same amount of speech. That's why no chord or extra tone plays in this trial.",
        source: "Deutsch 1970, Science 168:1604",
      },
      {
        point:
          "Imagery combined with real singing beats either one alone, but imagery by itself doesn't improve performance. That's why every silent trial ends with you singing.",
        source: "Ross 1985, J Res Music Educ 33:221; Steenstrup et al. 2021, Front Psychol 12:757052",
      },
    ],
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
  readonly subtitle = "Find a named scale degree from the key alone. Trains navigating by key instead of by the last note.";
  readonly measures = "Scale-location confusion and independent navigation";
  readonly defaultFeedback: FeedbackMode = "commit";

  readonly guide: ExerciseGuide = {
    task: "Hear the key and your current note, then sing the scale degree the screen names.",
    steps: [
      "The screen names a target degree, for example degree 3 (mi). It stays on screen for the whole trial.",
      "A chord plays. That chord is home: it sets the key.",
      "Two single tones follow: the home note (degree 1, do), then your current note.",
      "Your current note plays once more. Then sing the named degree, counting from home rather than from the last note you heard.",
    ],
    skill: "Navigating by key",
    trains:
      "Tonal navigation: using the key's internal map (which notes are stable, where the half steps fall) to find a note by its role instead of copying the last note you heard.",
    why:
      "Going note to note lets every small error carry forward, so a melody drifts. Finding notes from home re-anchors each one. It's also how you find harmony lines and melodies nobody plays for you.",
    brain:
      "Your brain builds a map of the key just from hearing music, and frontal areas flag out-of-key notes within a fraction of a second. This trial turns that listening map into one your voice can use.",
    science: [
      {
        point:
          "Listeners pick up a key's hierarchy from ordinary exposure. Once a key is set, people rate do, sol and mi as the best fits and out-of-key notes as the worst, with strikingly consistent profiles.",
        source: "Krumhansl & Kessler 1982, Psychol Rev 89:334",
      },
      {
        point:
          "A chord that breaks the key triggers an early brain response (the ERAN, ~150–250 ms), even in non-musicians. It comes partly from Broca's area and its right-hemisphere counterpart, the inferior frontal region that also handles grammar in language.",
        source: "Koelsch et al. 2000, J Cogn Neurosci 12:520; Maess et al. 2001, Nat Neurosci 4:540",
      },
      {
        point:
          "Rostromedial prefrontal cortex tracks where music sits in tonal space and follows it as the key changes: a neural map of the key.",
        source: "Janata et al. 2002, Science 298:2167",
      },
    ],
    tips: [
      "Degrees: 1 do · 2 re · 3 mi · 4 fa · 5 sol · 6 la · 7 ti. If you need to, count silently up or down from home.",
      "Accuracy first. Speed comes once the map is solid.",
    ],
  };

  createTrial(request: TrialRequest): TrialDefinition {
    const route = this.buildRoute(request);
    return this.finalize(route, [route.tonicMidi, route.startMidi]);
  }

  cuePlan(trial: TrialDefinition): CuePlan {
    return {
      playCadence: true, // the key IS this exercise: the chord is the map being navigated
      contextMidis: [trial.tonicMidi, trial.startMidi],
      cueLabels: ["Home · do", "Current note"],
      playStartAtGo: true,
      goLabel: "Current note again",
      revealTarget: false,
      prompt: `Sing degree ${trial.targetDegree + 1} (${SOLFEGE[trial.targetDegree]}), counting from home.`,
    };
  }
}

/** Notes heard before the gap; the answer is the next one. */
const PATTERN_NOTES = 4;

const mod7 = (degree: number) => ((degree % 7) + 7) % 7;
const pitchClass = (midi: number) => ((midi % 12) + 12) % 12;

/**
 * Every answer a listener could defend: for each of the 12 major keys that
 * holds all the heard notes as an even run (a constant stride of scale steps),
 * the pitch class of the run's next note. A pattern is fair only when this
 * set has exactly one member, meaning the heard notes alone settle the answer.
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
  readonly title = "Missing note";
  readonly subtitle = "Hear a scale pattern stop one note early, then sing the note it's heading to. Trains melodic prediction.";
  readonly measures = "Phrase retrieval, prediction, and musical transfer";
  readonly defaultFeedback: FeedbackMode = "blind";

  readonly guide: ExerciseGuide = {
    task: "Hear four notes walk through the key, then sing the fifth: the note the pattern is heading to.",
    steps: [
      "Four notes play, moving in one direction one scale step at a time, like do, re, mi, fa.",
      "The pattern stops one note early, and the screen says Sing.",
      "Sing the next note of the pattern (after do, re, mi, fa, that's sol). Stay in the key: some scale steps are whole steps and some are half steps, and choosing the right one is the skill.",
      "Every pattern is chosen so the notes you hear point to exactly one answer.",
    ],
    skill: "Melodic prediction",
    trains:
      "Melodic prediction: your brain's running forecast of the next note, built from the key and the direction the melody is moving. Here you sing that forecast out loud.",
    why:
      "Singing a song from memory, coming in on the right note, and inventing a harmony all run on prediction: you produce notes nobody played for you first. Of the five exercises, this one is closest to singing on your own.",
    brain:
      "Auditory cortex gets ready for the note it expects and still responds when that note never arrives. This trial asks your voice to produce the note your brain is already expecting.",
    science: [
      {
        point:
          "The brain predicts upcoming sounds automatically. When an expected sound is left out, auditory cortex still responds at the moment it should have arrived, in a pattern specific to the missing sound. That response is the prediction itself.",
        source: "SanMiguel et al. 2013, J Neurosci 33:8633",
      },
      {
        point:
          "Musical predictions are learned statistics. A model trained only on how often note patterns occur in music predicts listeners' expectations, and the brain's surprise responses, note by note.",
        source: "Pearce et al. 2010, NeuroImage 50:302",
      },
      {
        point:
          "Across styles, small steps are the most expected continuation, and a run of steps sets up the expectation that it keeps going. That's why this trial uses scale runs: expectation is strongest there, so a miss points to your key map rather than a pattern you couldn't follow.",
        source: "Huron 2006, Sweet Anticipation (MIT Press)",
      },
      {
        point:
          "Anticipating the next part of a familiar sequence engages frontal and premotor areas along with auditory cortex, the same planning circuits used to produce sequences. Predicting and singing share machinery.",
        source: "Leaver et al. 2009, J Neurosci 29:2477",
      },
    ],
    tips: [
      "Hear the answer in your head first, then sing it. Don't sing up through the pattern to find it.",
      "If two notes both seem possible, commit cleanly to one. A clean wrong note shows a prediction problem, not a voice problem.",
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
