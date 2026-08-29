import { noteName, type PitchSample } from "../../core";

/** Pulsing indicator while the cue is sounding — playback is visible, not implied. */
export function CueIndicator({ playing, label = "Playing the cue…" }: { playing: boolean; label?: string }) {
  if (!playing) return null;
  return (
    <p className="vc-cue-indicator" role="status">
      <span className="vc-cue-dot" aria-hidden="true">♪</span> {label}
    </p>
  );
}

/**
 * The stop-and-confirm gate after cue playback: a missed cue becomes a
 * replay, not a doomed attempt. Shared by every trial surface.
 */
export function HeardCheck({
  cuePlaying,
  onYes,
  onReplay,
}: {
  cuePlaying: boolean;
  onYes: () => void;
  onReplay: () => void;
}) {
  return (
    <div className="vc-prompt" style={{ marginTop: 60 }}>
      <h3>Did you hear it?</h3>
      <CueIndicator playing={cuePlaying} />
      <div className="vc-actions vc-center-actions">
        <button className="vc-button primary" disabled={cuePlaying} onClick={onYes}>
          Yes — continue
        </button>
        <button className="vc-button" disabled={cuePlaying} onClick={onReplay}>
          Play it again
        </button>
      </div>
    </div>
  );
}

/**
 * Live proof the microphone is hearing something: a level bar that moves
 * with input loudness (voiced or not), turning green with the detected note
 * once the sound clears the noise gate. Kills the "is it even recording?"
 * doubt on every capture surface.
 */
export function MicMeter({
  level,
  threshold,
  sample,
}: {
  level: number;
  threshold: number;
  sample: PitchSample | null;
}) {
  const heard = level > Math.max(threshold, 0.004);
  const width = Math.min(100, (level / 0.15) * 100);
  return (
    <div className="vc-micmeter" role="status" aria-label="Microphone input level">
      <div className="vc-micmeter-bar">
        <i className={heard ? "heard" : ""} style={{ width: `${width}%` }} />
      </div>
      <span className={`vc-micmeter-label ${heard ? "heard" : ""}`}>
        {sample ? `hearing ${noteName(sample.midi)}` : heard ? "hearing you" : "listening…"}
      </span>
    </div>
  );
}
