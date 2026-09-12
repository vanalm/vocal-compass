import { useCallback, useEffect, useRef, useState } from "react";
import {
  TrialSession,
  exercises,
  type AttemptAnalysis,
  type CuePlan,
  type Difficulty,
  type FeedbackMode,
  type IntentLabel,
  type MicStatus,
  type PitchSample,
  type RegisterLabel,
  type TrialDefinition,
  type TrialRecord,
} from "../../core";
import { useServices } from "../services";
import { loadFlowMode, saveFlowMode, type FlowMode } from "./flowMode";

export interface RunnerSettings {
  exerciseId: string;
  difficulty: Difficulty;
  delayMs: number;
  feedbackMode: FeedbackMode;
}

export type RunnerPhase = "idle" | "listen" | "imagine" | "sing" | "review";

export interface RunnerOptions {
  /** Pin the pacing instead of using the saved preference. The guided test
   * runs hands-free so the only click between trials is Next or Retry. */
  flow?: FlowMode;
}

const SING_WINDOW_MS = 4000;
/** Auto mode: breath-length beat between "cue done" and capture start. */
const AUTO_BEAT_MS = 900;
const HOME_CHORD_LABEL = "Home chord · sets the key";

/**
 * Orchestrates one trial at a time: cue playback, the silent delay,
 * microphone capture into the TrialSession, rescue audio, and review.
 * All scoring lives in core; this hook only sequences it.
 */
export function useTrialRunner(onSave: (record: TrialRecord) => Promise<void>, options: RunnerOptions = {}) {
  const { microphone, cues } = useServices();
  const sessionRef = useRef<TrialSession | null>(null);
  const planRef = useRef<CuePlan | null>(null);
  const singTimer = useRef<number | null>(null);
  /**
   * Which trial is current. Every async step (cue playback, the auto beat,
   * the silent countdown, mic start) captures it and stops when it changed,
   * so discarding mid-trial can't be undone by a step still in flight.
   */
  const runRef = useRef(0);

  const [phase, setPhase] = useState<RunnerPhase>("idle");
  const [flowMode, setFlowModeState] = useState<FlowMode>(() => options.flow ?? loadFlowMode());
  const flowModeRef = useRef<FlowMode>(flowMode);
  const singRef = useRef<(() => Promise<void>) | null>(null);
  const autoSingFired = useRef(false);
  const committed = useRef(false);
  const [cuePlaying, setCuePlaying] = useState(false);
  /** What the tone sounding right now is — every tone is named on screen. */
  const [cueLabel, setCueLabel] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [remainingDelayMs, setRemainingDelayMs] = useState(0);
  const [liveSample, setLiveSample] = useState<PitchSample | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [tooNoisy, setTooNoisy] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [noiseThreshold, setNoiseThreshold] = useState(0.008);
  const [analysis, setAnalysis] = useState<AttemptAnalysis | null>(null);
  const [lost, setLost] = useState(false);
  const [hintLevel, setHintLevel] = useState(0);

  useEffect(() => {
    const unsubscribe = microphone.subscribe({
      onSample: (frame) => {
        setLiveSample(frame.smoothed);
        setTooNoisy(frame.noise.tooNoisy);
        setInputLevel(frame.level);
        setNoiseThreshold(frame.noise.threshold);
        sessionRef.current?.addFrame(frame);
      },
      onStatus: (status, error) => {
        setMicStatus(status);
        setMicError(error ?? null);
      },
    });
    return () => {
      runRef.current += 1;
      cues.stop();
      unsubscribe();
      microphone.stop();
    };
  }, [microphone, cues]);

  /** Sound the cue, naming each tone as it plays. False if the trial was abandoned meanwhile. */
  const playCue = async (plan: CuePlan, definition: TrialDefinition, run: number): Promise<boolean> => {
    setCuePlaying(true);
    if (plan.playCadence) {
      setCueLabel(HOME_CHORD_LABEL);
      await cues.playCadence(definition.tonicMidi);
    }
    for (let i = 0; i < plan.contextMidis.length; i += 1) {
      if (runRef.current !== run) return false;
      setCueLabel(plan.cueLabels[i] ?? null);
      await cues.playSequence([plan.contextMidis[i]]);
    }
    if (runRef.current !== run) return false;
    setCuePlaying(false);
    setCueLabel(null);
    return true;
  };

  const start = useCallback(
    async (settings: RunnerSettings, confidence: number) => {
      runRef.current += 1;
      const run = runRef.current;
      const exercise = exercises.get(settings.exerciseId);
      const trial = exercise.createTrial({
        difficulty: settings.difficulty,
        delayMs: settings.delayMs,
      });
      const session = new TrialSession(trial, settings.feedbackMode);
      session.confidenceBefore = confidence;
      sessionRef.current = session;
      const plan = exercise.cuePlan(trial);
      planRef.current = plan;
      setAnalysis(null);
      setLost(false);
      setHintLevel(0);
      setRemainingDelayMs(0);
      setPrompt(plan.prompt);

      setPhase("listen");
      session.beginListening();
      if (!(await playCue(plan, trial, run))) return;
      // One decision point after the cue: replay it, or commit and sing.
      enterImagine(session, run);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cues],
  );

  const setFlowMode = useCallback((mode: FlowMode) => {
    flowModeRef.current = mode;
    setFlowModeState(mode);
    saveFlowMode(mode);
  }, []);

  /** Replay the whole cue from the decision point, as often as needed. */
  const replayCue = useCallback(async () => {
    const session = sessionRef.current;
    const plan = planRef.current;
    if (!session || !plan || cuePlaying || committed.current) return;
    await playCue(plan, session.definition, runRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cues, cuePlaying]);

  /** After the cue: the single decision point (replay, or commit-and-sing). */
  const enterImagine = (session: TrialSession, run: number) => {
    autoSingFired.current = false;
    committed.current = false;
    session.beginImagining();
    setPhase("imagine");
    setRemainingDelayMs(0);
    if (flowModeRef.current === "auto") {
      window.setTimeout(() => {
        if (runRef.current === run) commitRef.current?.();
      }, AUTO_BEAT_MS);
    }
  };

  /**
   * The one gate: the user commits to having the target. With a retention
   * delay the silence starts NOW and capture follows on its own — committing
   * was the decision; no further click is owed.
   */
  const commit = useCallback(() => {
    const session = sessionRef.current;
    if (!session || cuePlaying || session.currentPhase !== "imagine") return;
    if (committed.current) return;
    committed.current = true;
    const run = runRef.current;
    const go = () => {
      if (runRef.current !== run || autoSingFired.current) return;
      autoSingFired.current = true;
      void singRef.current?.();
    };
    const delayMs = session.definition.delayMs;
    if (delayMs > 0) {
      setRemainingDelayMs(delayMs);
      const startedAt = Date.now();
      const tick = () => {
        if (runRef.current !== run) return;
        const left = delayMs - (Date.now() - startedAt);
        setRemainingDelayMs(Math.max(0, left));
        if (left > 0) window.setTimeout(tick, 100);
        else go();
      };
      tick();
    } else {
      go();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cuePlaying]);
  const commitRef = useRef<(() => void) | null>(null);
  commitRef.current = commit;

  const sing = useCallback(async () => {
    const session = sessionRef.current;
    const plan = planRef.current;
    if (!session || !plan) return;
    const run = runRef.current;
    await microphone.start();
    if (runRef.current !== run) return;
    if (plan.playStartAtGo) {
      setCuePlaying(true);
      setCueLabel(plan.goLabel ?? null);
      await cues.playNote(session.definition.startMidi, 500);
      if (runRef.current !== run) return;
      setCuePlaying(false);
      setCueLabel(null);
    }
    session.beginSinging();
    setPhase("sing");
    singTimer.current = window.setTimeout(() => {
      if (runRef.current === run) finish();
    }, SING_WINDOW_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [microphone, cues]);
  singRef.current = sing;

  const finish = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.currentPhase !== "sing") return;
    if (singTimer.current != null) window.clearTimeout(singTimer.current);
    setAnalysis(session.finishSinging());
    setPhase("review");
  }, []);

  const markLost = useCallback(() => {
    sessionRef.current?.markLost();
    setLost(true);
  }, []);

  /** Rescue audio per PRD §8; the ladder itself records the hint cost. */
  const rescue = useCallback(
    async (level: number) => {
      const session = sessionRef.current;
      if (!session) return;
      session.useRescue(level);
      setHintLevel(session.rescue.hintLevel);
      const { tonicMidi, startMidi, targetMidi } = session.definition;
      if (level === 2) await cues.playSequence([tonicMidi, startMidi], 450, 90);
      if (level === 3) await cues.playSequence([startMidi, targetMidi], 500, 100);
      if (level === 4) await cues.playNote(targetMidi, 800);
    },
    [cues],
  );

  const complete = useCallback(
    async (outcome: { intent: IntentLabel | null; effort: number; register: RegisterLabel }) => {
      const session = sessionRef.current;
      if (!session) return;
      if (outcome.intent) session.confirmIntent(outcome.intent);
      session.effort = outcome.effort;
      session.register = outcome.register;
      await onSave(session.toRecord());
      sessionRef.current = null;
      setPhase("idle");
      setAnalysis(null);
    },
    [onSave],
  );

  /** Abandon the current trial at any phase: silence it, cancel what's pending, count nothing. */
  const discard = useCallback(() => {
    runRef.current += 1;
    cues.stop();
    if (singTimer.current != null) window.clearTimeout(singTimer.current);
    sessionRef.current = null;
    planRef.current = null;
    autoSingFired.current = false;
    committed.current = false;
    setPhase("idle");
    setAnalysis(null);
    setLost(false);
    setHintLevel(0);
    setCuePlaying(false);
    setCueLabel(null);
    setRemainingDelayMs(0);
  }, [cues]);

  return {
    phase,
    flowMode,
    setFlowMode,
    cuePlaying,
    cueLabel,
    inputLevel,
    noiseThreshold,
    prompt,
    remainingDelayMs,
    liveSample,
    micStatus,
    micError,
    tooNoisy,
    analysis,
    lost,
    hintLevel,
    session: sessionRef.current,
    start,
    replayCue,
    commit,
    sing,
    finish,
    markLost,
    rescue,
    complete,
    discard,
  };
}
