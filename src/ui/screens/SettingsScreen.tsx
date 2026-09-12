import { DEFAULT_LOW_CUT, LOW_CUT_OPTIONS, lowCutLabel } from "../../core";
import { useFlowMode } from "../hooks/flowMode";
import { useMicLowCut } from "../hooks/micLowCut";
import { FlowModeToggle } from "../components/TrialStage";

/** Preferences for how the app listens and paces, saved in this browser. */
export function SettingsScreen() {
  const [lowCut, setLowCut] = useMicLowCut();
  const [flowMode, setFlowMode] = useFlowMode();

  return (
    <div className="vc-grid">
      <section className="vc-card" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Microphone low-cut filter</h3>
        </div>
        <p className="vc-small">
          Removes low rumble before your voice is analyzed. Higher settings handle noisy places better
          but can cut the lowest notes of deep voices.
        </p>
        <div className="vc-choice-list" role="radiogroup" aria-label="Microphone low-cut filter">
          {LOW_CUT_OPTIONS.map((option) => (
            <button
              key={option.id}
              role="radio"
              aria-checked={lowCut === option.id}
              className={`vc-choice ${lowCut === option.id ? "active" : ""}`}
              onClick={() => setLowCut(option.id)}
            >
              <strong>
                {lowCutLabel(option.id)}
                {option.id === DEFAULT_LOW_CUT && <em> · default</em>}
              </strong>
              <span>{option.when}</span>
            </button>
          ))}
        </div>
        <p className="vc-small">
          Applies right away. Each range measurement records the filter it used, so comparisons stay
          honest.
        </p>
      </section>

      <section className="vc-card" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Pacing</h3>
        </div>
        <p className="vc-small">
          Click: you confirm each step, and the spacebar works. Auto: moves on by itself after each
          success.
        </p>
        <FlowModeToggle mode={flowMode} onChange={setFlowMode} />
      </section>
    </div>
  );
}
