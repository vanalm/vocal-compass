import { useEffect, useState } from "react";
import { lowCutLabel, strongerLowCut, type LowCutSetting } from "../../core";
import { useMicLowCut } from "../hooks/micLowCut";

/** How long the warning outlives the last noisy frame, so its button holds still long enough to press. */
const HOLD_MS = 4000;

/**
 * The live "too noisy" warning on trial surfaces. It offers the same
 * one-step filter change the range summary suggests, because rumble is the
 * one kind of noise a low-cut filter can actually remove.
 */
export function NoiseWarning({ noisy }: { noisy: boolean }) {
  const [lowCut, setLowCut] = useMicLowCut();
  const [visible, setVisible] = useState(noisy);
  const [switchedTo, setSwitchedTo] = useState<LowCutSetting | null>(null);

  useEffect(() => {
    if (noisy) {
      setVisible(true);
      return;
    }
    const timer = window.setTimeout(() => setVisible(false), HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [noisy]);

  if (!visible) return null;
  const stronger = strongerLowCut(lowCut);
  return (
    <div className="vc-noise-warning" role="status">
      <p>Too noisy here — quiet singing may go unscored.</p>
      {switchedTo === lowCut ? (
        <p className="vc-small">Filter set to {lowCutLabel(lowCut)}. It applies right away.</p>
      ) : stronger ? (
        <div className="vc-actions">
          <button
            className="vc-button"
            onClick={() => {
              setLowCut(stronger);
              setSwitchedTo(stronger);
            }}
          >
            Cut rumble: {lowCutLabel(stronger)}
          </button>
          <span className="vc-small">Helps with cars, fans and traffic — not voices or hiss.</span>
        </div>
      ) : (
        <p className="vc-small">The filter is already at its strongest. Move somewhere quieter or use a closer mic.</p>
      )}
    </div>
  );
}
