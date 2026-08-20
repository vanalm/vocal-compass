import { noteName, type PitchSample } from "../../core";

/** Live note + cents meter, shown only when the feedback mode allows it. */
export function PitchReadout({ sample, targetMidi }: { sample: PitchSample | null; targetMidi: number }) {
  if (!sample) {
    return (
      <div className="vc-live-readout">
        <strong>·</strong>
        <span>Listening…</span>
      </div>
    );
  }
  const cents = (sample.midi - targetMidi) * 100;
  const clamped = Math.max(-100, Math.min(100, cents));
  return (
    <div className="vc-live-readout">
      <strong>{noteName(sample.midi)}</strong>
      <span>
        {Math.abs(cents) < 1000
          ? `${cents > 0 ? "+" : ""}${cents.toFixed(0)} cents vs target`
          : "far from target"}
      </span>
      <div className="vc-meter">
        <i style={{ left: `${50 + clamped / 2}%` }} />
      </div>
    </div>
  );
}
