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
  type TrialRecord,
} from "../../core";
import { useServices } from "../services";

export interface RunnerSettings {
  exerciseId: string;
  difficulty: Difficulty;
  delayMs: number;
  feedbackMode: FeedbackMode;
}

export type RunnerPhase = "idle" | "listen" | "heard" | "imagine" | "sing" | "review";

const SING_WINDOW_MS = 4000;

/**
 * Orchestrates one trial at a time: cue playback, the silent delay,
 * microphone capture into the TrialSession, rescue audio, and review.
 * All scoring lives in core; this hook only sequences it.
 */
export function useTrialRunner(onSave: (record: TrialRecord) => Promise<void>) {
  const { microphone, cues } = useServices();
  const sessionRef = useRef<TrialSession | null>(null);
  const planRef = useRef<CuePlan | null>(null);
  const singTimer = useRef<number | null>(null);

  const [phase, setPhase] = useState<RunnerPhase>("idle");
  const [cuePlaying, setCuePlaying] = useState(false);
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
      unsubscribe();
      microphone.stop();
    };
  }, [microphone]);

  const start = useCallback(
    async (settings: RunnerSettings, confidence: number) => {
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
      setPrompt(plan.prompt);

      setPhase("listen");
      session.beginListening();
      setCuePlaying(true);
      await cues.playCadence(trial.tonicMidi);
      await cues.playSequence(plan.contextMidis);
      setCuePlaying(false);
      // Stop here: the user confirms they heard the cue before the trial
      // moves on — a missed cue becomes a replay, not a doomed attempt.
      setPhase("heard");
    },
    [cues],
  );

  /** Replay the whole cue from the heard-check, as often as needed. */
  const replayCue = useCallback(async () => {
    const session = sessionRef.current;
    const plan = planRef.current;
    if (!session || !plan || cuePlaying) return;
    setCuePlaying(true);
    await cues.playCadence(session.definition.tonicMidi);
    await cues.playSequence(plan.contextMidis);
    setCuePlaying(false);
  }, [cues, cuePlaying]);

  /** The user heard the cue: begin imagining (and the retention delay). */
  const confirmHeard = useCallback(() => {
    const session = sessionRef.current;
    if (!session || cuePlaying) return;
    session.beginImagining();
    setPhase("imagine");
    const delayMs = session.definition.delayMs;
    if (delayMs > 0) {
      setRemainingDelayMs(delayMs);
      const startedAt = Date.now();
      const tick = () => {
        const left = delayMs - (Date.now() - startedAt);
        setRemainingDelayMs(Math.max(0, left));
        if (left > 0) window.setTimeout(tick, 100);
      };
      tick();
    } else {
      setRemainingDelayMs(0);
    }
  }, [cuePlaying]);

  const sing = useCallback(async () => {
    const session = sessionRef.current;
    const plan = planRef.current;
    if (!session || !plan) return;
    await microphone.start();
    if (plan.playStartAtGo) await cues.playNote(session.definition.startMidi, 500);
    session.beginSinging();
    setPhase("sing");
    singTimer.current = window.setTimeout(() => finish(), SING_WINDOW_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [microphone, cues]);

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

  const discard = useCallback(() => {
    if (singTimer.current != null) window.clearTimeout(singTimer.current);
    sessionRef.current = null;
    setPhase("idle");
    setAnalysis(null);
    setLost(false);
    setHintLevel(0);
  }, []);

  return {
    phase,
    cuePlaying,
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
    confirmHeard,
    sing,
    finish,
    markLost,
    rescue,
    complete,
    discard,
  };
}
