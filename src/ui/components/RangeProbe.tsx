import { useEffect, useRef, useState } from "react";
import {
  RangeWalk,
  noteName,
  type PitchSample,
  type RangeMeasurement,
  type RangeWalkState,
} from "../../core";
import { MicMeter } from "./TrialStage";
import { useServices } from "../services";

const ANCHOR_FALLBACK_MIDI = 57; // A3 — reachable middle for most voices

const TIPS: Record<RangeWalkState["phase"], string> = {
  anchor: "Match this tone and hold it steady — any comfortable vowel or a hum.",
  down: "Copy each lower tone. Gentle and quiet is fine; growly or breathy still counts.",
  up: "Copy each higher tone. Stop before strain — the note you can hold is your range, the squeak is not.",
  done: "Done.",
};

/**
 * Tone-guided range measurement: the app plays each semitone target, the
 * user copies it, and a step counts only when matched and held. Discrete
 * guided steps beat free sirening as measurement (Barrett 2020) and as UX —
 * nobody is left shooting in the dark. The full sweep is stored.
 */
export function RangeProbe({
  ranges,
  onSave,
}: {
  ranges: RangeMeasurement[];
  onSave: (m: RangeMeasurement) => Promise<void>;
}) {
  const { microphone, cues } = useServices();
  const [walkState, setWalkState] = useState<RangeWalkState | null>(null);
  const [liveSample, setLiveSample] = useState<PitchSample | null>(null);
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(0.008);
  const [tonePlaying, setTonePlaying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const walk = useRef<RangeWalk | null>(null);
  const sweep = useRef<Array<{ t: number; midi: number; clarity: number; rms?: number }>>([]);
  const toneBusy = useRef(false);

  // Anchor near the middle of the last measurement, else a common middle.
  const latest = ranges[ranges.length - 1];
  const anchorMidi = latest ? Math.round((latest.lowMidi + latest.highMidi) / 2) : ANCHOR_FALLBACK_MIDI;

  const playTone = async (midi: number) => {
    if (toneBusy.current) return;
    toneBusy.current = true;
    setTonePlaying(true);
    await cues.playNote(midi, 900);
    setTonePlaying(false);
    toneBusy.current = false;
  };

  useEffect(() => {
    if (!walkState || walkState.phase === "done" || !walk.current) return;
    const unsubscribe = microphone.subscribe({
      onSample: (frame) => {
        setLiveSample(frame.smoothed);
        setLevel(frame.level);
        setThreshold(frame.noise.threshold);
        if (frame.smoothed) {
          sweep.current.push({
            t: frame.smoothed.at,
            midi: frame.smoothed.midi,
            clarity: frame.smoothed.clarity,
            rms: frame.smoothed.rms,
          });
        }
        // Don't judge the user against the reference tone's own audio.
        if (toneBusy.current) return;
        const result = walk.current!.feed(frame.smoothed?.midi ?? null, frame.smoothed?.at ?? Date.now());
        const state = walk.current!.state;
        setWalkState(state);
        if (result.toneToPlay != null) void playTone(result.toneToPlay);
        if (state.phase === "done") void finish(state);
      },
      onStatus: (status, error) => {
        if (status === "error") {
          setMessage(error ?? "Microphone failed.");
          setWalkState(null);
        }
      },
    });
    void microphone.start();
    return () => unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [walkState?.phase === "done" ? "done" : walkState ? "live" : "idle"]);

  const begin = () => {
    walk.current = new RangeWalk(anchorMidi);
    sweep.current = [];
    setMessage(null);
    setWalkState(walk.current.state);
    void playTone(anchorMidi);
  };

  const skip = () => {
    if (!walk.current) return;
    const result = walk.current.skipStep();
    const state = walk.current.state;
    setWalkState(state);
    if (result.toneToPlay != null) void playTone(result.toneToPlay);
    if (state.phase === "done") void finish(state);
  };

  const finish = async (state: RangeWalkState) => {
    microphone.stop();
    setLiveSample(null);
    if (state.lowMidi == null || state.highMidi == null) {
      setMessage("Nothing matched — try again; the anchor tone just needs a steady hold.");
      setWalkState(null);
      return;
    }
    await onSave({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lowMidi: state.lowMidi,
      highMidi: state.highMidi,
      trace: sweep.current,
    });
    setMessage(
      `Saved: ${noteName(state.lowMidi)} – ${noteName(state.highMidi)} (${state.highMidi - state.lowMidi} st)`,
    );
    setWalkState(null);
  };

  if (!walkState) {
    return (
      <div className="vc-range-probe">
        <button className="vc-button primary" onClick={begin}>
          Measure range
        </button>
        <p className="vc-small">
          Guided: the app plays a tone, you copy it, one semitone at a time — down to your floor,
          then up to your ceiling. ~2 minutes.
        </p>
        {message && <p className="vc-small">{message}</p>}
      </div>
    );
  }

  const held = walkState.matchProgress;
  const direction = walkState.phase === "down" ? "▼ heading down" : walkState.phase === "up" ? "▲ heading up" : "anchor";

  return (
    <div className="vc-range-probe">
      <div className="vc-walk">
        <div className="vc-walk-target">
          <span className="vc-small">{tonePlaying ? "Listen…" : "Copy this tone"}</span>
          <strong>{noteName(walkState.targetMidi)}</strong>
          <span className="vc-walk-direction">{direction}</span>
        </div>
        <div className="vc-walk-hold" aria-label="Hold progress">
          {[0, 1, 2, 3].map((i) => (
            <i key={i} className={held > i / 4 ? "on" : ""} />
          ))}
        </div>
        <MicMeter level={level} threshold={threshold} sample={liveSample} />
        <p className="vc-small">{TIPS[walkState.phase]}</p>
        <p className="vc-small">
          So far:{" "}
          {walkState.lowMidi != null && walkState.highMidi != null
            ? `${noteName(walkState.lowMidi)} – ${noteName(walkState.highMidi)}`
            : "match the anchor to begin"}
        </p>
        <div className="vc-actions">
          <button className="vc-button" onClick={() => void playTone(walkState.targetMidi)} disabled={tonePlaying}>
            Hear it again
          </button>
          <button className="vc-button" onClick={skip}>
            {walkState.phase === "up" ? "That’s my ceiling" : walkState.phase === "down" ? "That’s my floor" : "Skip"}
          </button>
        </div>
      </div>
      {message && <p className="vc-small">{message}</p>}
    </div>
  );
}
