import { useEffect } from "react";
import { noteName, type PitchSample } from "../../core";
import type { FlowMode } from "../hooks/useTrialRunner";

/**
 * Spacebar fires the current primary action — one key advances the whole
 * trial in click mode. Pass null when there is nothing to advance.
 */
export function useSpacebarAdvance(action: (() => void) | null) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      )
        return;
      if (!action) return;
      event.preventDefault();
      action();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [action]);
}

/** Click/auto pacing toggle, shared by every trial surface. */
export function FlowModeToggle({
  mode,
  onChange,
}: {
  mode: FlowMode;
  onChange: (mode: FlowMode) => void;
}) {
  return (
    <div className="vc-segmented vc-flowmode" role="group" aria-label="Trial pacing">
      {(["click", "auto"] as FlowMode[]).map((m) => (
        <button key={m} className={mode === m ? "active" : ""} onClick={() => onChange(m)} title={m === "click" ? "Confirm each step; spacebar advances" : "Flows through on its own once started"}>
          {m}
        </button>
      ))}
    </div>
  );
}

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
