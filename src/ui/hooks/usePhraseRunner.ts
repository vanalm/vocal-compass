import { useCallback, useEffect, useRef, useState } from "react";
import {
  realizePhrase,
  scorePhrase,
  type MicStatus,
  type PhraseExerciseSpec,
  type PhraseRecord,
  type PhraseScore,
  type PitchSample,
  type RealizedPhrase,
} from "../../core";
import { useServices } from "../services";

export type PhrasePhase = "idle" | "listen" | "ready" | "countin" | "sing" | "review";

const SLACK_MS = 1600;

/**
 * Orchestrates one phrase attempt: guide playback at the assigned strength,
 * a count-in so beat one is knowable (onset timing is scored), capture for
 * the phrase's real duration, then rhythm-aware scoring. These are practice
 * observations; no held-out, independently verified-transfer claim is made.
 */
export function usePhraseRunner(onSave: (record: PhraseRecord) => Promise<void>) {
  const { microphone, cues } = useServices();
  const [phase, setPhase] = useState<PhrasePhase>("idle");
  const [spec, setSpec] = useState<PhraseExerciseSpec | null>(null);
  const [realized, setRealized] = useState<RealizedPhrase | null>(null);
  const [score, setScore] = useState<PhraseScore | null>(null);
  const [micStatus, setMicStatus] = useState<MicStatus>("idle");
  const [micError, setMicError] = useState<string | null>(null);
  const [liveSample, setLiveSample] = useState<PitchSample | null>(null);
  const [inputLevel, setInputLevel] = useState(0);
  const [noiseThreshold, setNoiseThreshold] = useState(0.008);
  const [cuePlaying, setCuePlaying] = useState(false);
  const [attemptOfSpec, setAttemptOfSpec] = useState(1);

  const samples = useRef<PitchSample[]>([]);
  const generation = useRef(0), recordId = useRef(crypto.randomUUID()), saving = useRef(false);
  const singStartAt = useRef(0);
  const capturing = useRef(false);
  const finishTimer = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribe = microphone.subscribe({
      onSample: (frame) => {
        setLiveSample(frame.smoothed);
        setInputLevel(frame.level);
        setNoiseThreshold(frame.noise.threshold);
        if (capturing.current && frame.smoothed) samples.current.push(frame.smoothed);
      },
      onStatus: (status, error) => {
        setMicStatus(status);
        setMicError(error ?? null);
      },
    });
    return () => {
      generation.current += 1; capturing.current = false; cues.stop();
      if (finishTimer.current != null) window.clearTimeout(finishTimer.current);
      unsubscribe();
      microphone.stop();
    };
  }, [microphone, cues]);

  const playGuide = useCallback(
    async (r: RealizedPhrase, guide: PhraseExerciseSpec["guide"], tonicMidi: number) => {
      const token = generation.current;
      setCuePlaying(true);
      await cues.playCadence(tonicMidi);
      if (token !== generation.current) return;
      await cues.playRealizedPhrase(r, guide);
      if (token === generation.current) setCuePlaying(false);
    },
    [cues],
  );

  const start = useCallback(
    async (nextSpec: PhraseExerciseSpec, attempt = 1) => {
      const token=++generation.current; recordId.current=crypto.randomUUID();
      const r = realizePhrase(nextSpec);
      setSpec(nextSpec);
      setRealized(r);
      setScore(null);
      setAttemptOfSpec(attempt);
      setPhase("listen");
      try { await playGuide(r, nextSpec.guide, nextSpec.keyTonicMidi); }
      catch (error) { if(token===generation.current) {setMicError(error instanceof Error?error.message:"Audio unavailable");setPhase("idle");} return; }
      if(token===generation.current)setPhase("ready");
    },
    [playGuide],
  );

  const replay = useCallback(async () => {
    if (!realized || !spec || cuePlaying || phase !== "ready") return;
    setPhase("listen");
    const token=generation.current;
    try {await playGuide(realized, spec.guide, spec.keyTonicMidi);}
    catch (error) {setMicError(error instanceof Error?error.message:"Audio unavailable");}
    if(token===generation.current)setPhase("ready");
  }, [realized, spec, cuePlaying, phase, playGuide]);

  const finish = useCallback(() => {
    if (!capturing.current || !realized) return;
    capturing.current = false;
    if (finishTimer.current != null) window.clearTimeout(finishTimer.current);
    const relative = samples.current.map((s) => ({ ...s, at: s.at - singStartAt.current }));
    setScore(scorePhrase(realized.notes, relative));
    microphone.stop(); cues.stop();
    setPhase("review");
  }, [realized, microphone, cues]);
  const finishRef = useRef(finish);
  finishRef.current = finish;

  /** Commit: count-in, then capture for the phrase's duration plus slack. */
  const go = useCallback(async () => {
    if (!realized || !spec || cuePlaying || phase !== "ready") return;
    const token=generation.current;
    setPhase("countin");
    await microphone.start();
    if(token!==generation.current)return;
    if(microphone.status!=="live"){setPhase("ready");return;}
    try {await cues.playCountIn(spec.bpm);}
    catch (error) {microphone.stop();setMicError(error instanceof Error?error.message:"Count-in failed");setPhase("ready");return;}
    if(token!==generation.current)return;
    samples.current = [];
    singStartAt.current = Date.now();
    capturing.current = true;
    setPhase("sing");
    // Chord phrases keep their pads sounding while the singer works.
    // Playback during capture can be mistaken for the singer. The chord guide
    // belongs before the take until accompaniment rejection is validated.

    finishTimer.current = window.setTimeout(() => finishRef.current(), realized.totalMs + SLACK_MS);
  }, [realized, spec, cuePlaying, phase, microphone, cues]);

  const retry = useCallback(() => {
    if (!spec) return;
    void start(spec, attemptOfSpec + 1);
  }, [spec, attemptOfSpec, start]);

  const save = useCallback(async () => {
    if (!spec || !score || saving.current) return;
    saving.current=true;
    const record: PhraseRecord = {
      id: recordId.current,
      createdAt: new Date().toISOString(),
      phraseId: spec.phrase.id,
      phraseName: spec.phrase.name,
      level: spec.phrase.level,
      keyTonicMidi: spec.keyTonicMidi,
      bpm: spec.bpm,
      role: spec.role,
      guide: spec.guide,
      // A local first take is not a validated cold/transfer test.
      verified: false,
      hits: score.hits,
      misses: score.misses,
      extras: score.extras,
      sequenceAccuracy: score.sequenceAccuracy,
      meanAbsOnsetMs: score.meanAbsOnsetMs,
      landingHit: score.landingHit,
      trace: samples.current.map((s) => ({
        t: s.at - singStartAt.current,
        midi: s.midi,
        clarity: s.clarity,
        rms: s.rms,
      })),
    };
    try {await onSave(record);}
    catch {setMicError("Could not save this phrase. Retry saving before leaving.");return;}
    finally {saving.current=false;}
    setPhase("idle");
    setSpec(null);
    setRealized(null);
    setScore(null);
  }, [spec, score, attemptOfSpec, onSave]);

  const discard = useCallback(() => {
    generation.current += 1; cues.stop(); microphone.stop();
    capturing.current = false;
    if (finishTimer.current != null) window.clearTimeout(finishTimer.current);
    setPhase("idle");
    setSpec(null);
    setRealized(null);
    setScore(null);
  }, [cues,microphone]);

  return {
    phase,
    spec,
    realized,
    score,
    micStatus,
    micError,
    liveSample,
    inputLevel,
    noiseThreshold,
    cuePlaying,
    attemptOfSpec,
    start,
    replay,
    go,
    finish,
    retry,
    save,
    discard,
  };
}
