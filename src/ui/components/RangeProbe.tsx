import { useEffect, useRef, useState } from "react";
import { heldExtremes, noteName, type PitchSample, type RangeMeasurement } from "../../core";
import { MicMeter } from "./TrialStage";
import { useServices } from "../services";

const MAX_PROBE_MS = 45_000;

/**
 * Siren-based range measurement: start, glide from comfortable middle down
 * to the floor and up to the ceiling, stop. Only held pitch counts (the
 * analyzer drops cracks and blips), so the saved extremes are usable range,
 * not accidents.
 */
export function RangeProbe({ onSave }: { onSave: (m: RangeMeasurement) => Promise<void> }) {
  const { microphone } = useServices();
  const [probing, setProbing] = useState(false);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const [liveSample, setLiveSample] = useState<PitchSample | null>(null);
  const [level, setLevel] = useState(0);
  const [threshold, setThreshold] = useState(0.008);
  const [captured, setCaptured] = useState<{ lowMidi: number; highMidi: number } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const buffer = useRef<Array<number | null>>([]);
  const sweep = useRef<Array<{ t: number; midi: number; clarity: number }>>([]);
  const stopTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!probing) return;
    const unsubscribe = microphone.subscribe({
      onSample: (frame) => {
        buffer.current.push(frame.smoothed?.midi ?? null);
        if (frame.smoothed) {
          sweep.current.push({
            t: frame.smoothed.at,
            midi: frame.smoothed.midi,
            clarity: frame.smoothed.clarity,
          });
        }
        setLiveNote(frame.smoothed ? noteName(frame.smoothed.midi) : null);
        setLiveSample(frame.smoothed);
        setLevel(frame.level);
        setThreshold(frame.noise.threshold);
        setCaptured(heldExtremes(buffer.current));
      },
      onStatus: (status, error) => {
        if (status === "error") {
          setMessage(error ?? "Microphone failed.");
          setProbing(false);
        }
      },
    });
    void microphone.start();
    stopTimer.current = window.setTimeout(() => void finish(), MAX_PROBE_MS);
    return () => {
      unsubscribe();
      if (stopTimer.current != null) window.clearTimeout(stopTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [probing]);

  const begin = () => {
    buffer.current = [];
    sweep.current = [];
    setCaptured(null);
    setMessage(null);
    setProbing(true);
  };

  const finish = async () => {
    setProbing(false);
    microphone.stop();
    setLiveNote(null);
    const extremes = heldExtremes(buffer.current);
    if (!extremes) {
      setMessage("Nothing held long enough to count — try again, holding the ends a beat.");
      return;
    }
    await onSave({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      lowMidi: extremes.lowMidi,
      highMidi: extremes.highMidi,
      trace: sweep.current,
    });
    setMessage(
      `Saved: ${noteName(extremes.lowMidi)} – ${noteName(extremes.highMidi)} (${(
        extremes.highMidi - extremes.lowMidi
      ).toFixed(1)} st)`,
    );
  };

  return (
    <div className="vc-range-probe">
      {!probing ? (
        <button className="vc-button primary" onClick={begin}>
          Measure range
        </button>
      ) : (
        <>
          <p className="vc-small">
            Siren gently: middle → lowest comfortable → highest comfortable. Hold each end a beat.
          </p>
          <MicMeter level={level} threshold={threshold} sample={liveSample} />
          <p className="vc-range-live">
            {liveNote ?? "·"}
            {captured && (
              <span>
                {" "}
                {noteName(captured.lowMidi)} – {noteName(captured.highMidi)}
              </span>
            )}
          </p>
          <button className="vc-button" onClick={() => void finish()}>
            Done
          </button>
        </>
      )}
      {message && <p className="vc-small">{message}</p>}
    </div>
  );
}
