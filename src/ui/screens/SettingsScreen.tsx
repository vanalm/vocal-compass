import { DEFAULT_LOW_CUT, LOW_CUT_OPTIONS, lowCutLabel } from "../../core";
import { useFlowMode } from "../hooks/flowMode";
import { useMicLowCut } from "../hooks/micLowCut";
import type { Account } from "../hooks/useAccount";
import { AccountSettings } from "../components/AccountSettings";
import { FlowModeToggle } from "../components/TrialStage";

/** The account, and preferences for how the app listens and paces, saved in this browser. */
export function SettingsScreen({ account }: { account: Account }) {
  const [lowCut, setLowCut] = useMicLowCut();
  const [flowMode, setFlowMode] = useFlowMode();

  return (
    <div className="vc-grid">
      <AccountSettings account={account} />

      <section className="vc-card vc-card-pad" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>Microphone low-cut filter</h3>
        </div>
        <p className="vc-small">
          Removes low rumble before your voice is analyzed. Higher settings handle noisy places better
          but can cut the lowest notes of deep voices.
        </p>
        <div
          className="vc-choice-list"
          role="radiogroup"
          aria-label="Microphone low-cut filter"
          onKeyDown={(event) => {
            // One Tab stop for the group; arrow keys move the choice, as they do between native radios.
            const step = ({ ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 } as Record<string, number>)[event.key];
            if (!step) return;
            event.preventDefault();
            const count = LOW_CUT_OPTIONS.length;
            const index = (LOW_CUT_OPTIONS.findIndex((o) => o.id === lowCut) + step + count) % count;
            setLowCut(LOW_CUT_OPTIONS[index].id);
            (event.currentTarget.children[index] as HTMLElement).focus();
          }}
        >
          {LOW_CUT_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={lowCut === option.id}
              tabIndex={lowCut === option.id ? 0 : -1}
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

      <section className="vc-card vc-card-pad" style={{ gridColumn: "span 12" }}>
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
