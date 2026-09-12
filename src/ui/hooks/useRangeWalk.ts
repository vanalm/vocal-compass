import { useCallback, useEffect, useRef, useState } from "react";
import {
  RangeWalk,
  type LowCutSetting,
  type PitchSample,
  type RangeWalkSnapshot,
  type WalkEffect,
} from "../../core";
import { useServices } from "../services";
import { useFlowMode } from "./flowMode";

/** How long each reference note sounds. */
const TONE_MS = 1000;
const TICK_MS = 50;

type TraceFrame = { t: number; midi: number; clarity: number; rms?: number };

/**
 * Drives a RangeWalk against real audio: plays the notes it asks for, feeds
 * it microphone frames, and ticks its clock. Judgement lives in the engine;
 * this hook only connects it to the speakers, the mic, and the screen.
 *
 * Frames are fed unsmoothed on purpose: the smoother's clarity gate rejects
 * breathy tone, and at the edges of a range breathy-but-steady is exactly
 * what the singer is told still counts. The 500 ms hold is the spike filter.
 */
export function useRangeWalk(startMidi: number) {
  const { microphone, cues } = useServices();
  const [flowMode, setFlowMode] = useFlowMode();
  const walkRef = useRef<RangeWalk | null>(null);
  const trace = useRef<TraceFrame[]>([]);
  const tonesSounding = useRef(0);
  const turnFrames = useRef({ total: 0, noisy: 0 });
  const [walkLowCut, setWalkLowCut] = useState<LowCutSetting>(microphone.lowCutSetting);
  const [snap, setSnap] = useState<RangeWalkSnapshot | null>(null);
  const [tonePlaying, setTonePlaying] = useState(false);
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(0.008);
  const [sample, setSample] = useState<PitchSample | null>(null);
  const [micError, setMicError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setSnap(walkRef.current ? walkRef.current.snapshot(Date.now()) : null);
  }, []);

  const apply = useCallback(
    (effect: WalkEffect) => {
      const { playTone, toneId } = effect;
      if (playTone !== undefined && toneId !== undefined) {
        tonesSounding.current += 1;
        setTonePlaying(true);
        void cues.playNote(playTone, TONE_MS).then(() => {
          tonesSounding.current -= 1;
          setTonePlaying(tonesSounding.current > 0);
          walkRef.current?.toneEnded(Date.now(), toneId);
          refresh();
        });
      }
      refresh();
    },
    [cues, refresh],
  );

  useEffect(() => {
    const unsubscribe = microphone.subscribe({
      onSample: (frame) => {
        const walk = walkRef.current;
        if (!walk) return;
        setLevel(frame.level);
        setThreshold(frame.noise.threshold);
        setSample(frame.raw);
        const raw = frame.raw;
        if (walk.currentPhase === "sing") {
          turnFrames.current.total += 1;
          if (frame.noise.tooNoisy) turnFrames.current.noisy += 1;
          if (raw) trace.current.push({ t: raw.at, midi: raw.midi, clarity: raw.clarity, rms: raw.rms });
        }
        walk.feed(raw ? raw.midi : null, raw ? raw.at : Date.now());
      },
      onStatus: (status, error) => {
        if (status === "error") setMicError(error ?? "Microphone failed.");
      },
    });
    return () => {
      unsubscribe();
    };
  }, [microphone]);

  const active = snap !== null && snap.phase !== "done";
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => {
      const walk = walkRef.current;
      if (walk) apply(walk.tick(Date.now()));
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [active, apply]);

  useEffect(() => {
    walkRef.current?.setAutoAdvance(flowMode === "auto");
  }, [flowMode]);

  useEffect(() => {
    if (snap?.phase === "done") microphone.stop();
  }, [snap?.phase, microphone]);

  useEffect(
    () => () => {
      if (walkRef.current) microphone.stop();
    },
    [microphone],
  );

  const start = useCallback(async () => {
    setMicError(null);
    trace.current = [];
    turnFrames.current = { total: 0, noisy: 0 };
    setWalkLowCut(microphone.lowCutSetting);
    await microphone.start();
    if (microphone.status !== "live") return;
    const walk = new RangeWalk(startMidi, { autoAdvance: flowMode === "auto" });
    walkRef.current = walk;
    apply(walk.start());
  }, [microphone, startMidi, flowMode, apply]);

  const next = useCallback(() => {
    if (walkRef.current) apply(walkRef.current.next(Date.now()));
  }, [apply]);

  const retry = useCallback(() => {
    if (walkRef.current) apply(walkRef.current.retry());
  }, [apply]);

  const hearAgain = useCallback(() => {
    if (walkRef.current) apply(walkRef.current.hearAgain());
  }, [apply]);

  const endDirection = useCallback(() => {
    walkRef.current?.endDirection(Date.now());
    refresh();
  }, [refresh]);

  const reset = useCallback(() => {
    walkRef.current = null;
    trace.current = [];
    turnFrames.current = { total: 0, noisy: 0 };
    microphone.stop();
    setSnap(null);
    setTonePlaying(false);
  }, [microphone]);

  return {
    snap,
    flowMode,
    setFlowMode,
    tonePlaying,
    level,
    threshold,
    sample,
    micError,
    trace,
    /** The low-cut filter this walk ran with (a later settings change doesn't rewrite it). */
    walkLowCut,
    /** Share of the singer's-turn frames the noise tracker flagged as too noisy. */
    noisyShare: () =>
      turnFrames.current.total > 0 ? turnFrames.current.noisy / turnFrames.current.total : 0,
    start,
    next,
    retry,
    hearAgain,
    endDirection,
    reset,
  };
}
