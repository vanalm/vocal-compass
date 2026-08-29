import { useMemo, useState } from "react";
import {
  baselineTestPlan,
  exercises,
  testProgress,
  type TrialRecord,
} from "../../core";
import { useTrialRunner } from "../hooks/useTrialRunner";
import { PitchReadout } from "../components/PitchReadout";
import { CueIndicator, FlowModeToggle, MicMeter, useSpacebarAdvance } from "../components/TrialStage";
import { TraceChart } from "../components/TraceChart";

/**
 * The guided test: one step per module, each introduced with a single what
 * sentence and a single why sentence, advancing automatically as trials save.
 * Settings come from the plan, not from the user — that is what makes runs
 * comparable to each other.
 */
export function TestScreen({
  save,
  onFinished,
}: {
  save: (record: TrialRecord) => Promise<void>;
  onFinished: () => void;
}) {
  const plan = useMemo(() => baselineTestPlan(), []);
  const [completed, setCompleted] = useState(0);
  const [started, setStarted] = useState(false);

  const runner = useTrialRunner(async (record) => {
    await save(record);
    setCompleted((n) => n + 1);
  });

  const progress = testProgress(plan, completed);

  const justAdvanced =
    progress != null && progress.doneInStep === 0 && completed > 0 && runner.phase === "idle";

  const beginTrial = () => {
    if (!progress) return;
    setStarted(true);
    void runner.start(
      {
        exerciseId: progress.step.exerciseId,
        difficulty: "steps",
        delayMs: progress.step.delayMs,
        feedbackMode: progress.step.feedbackMode,
      },
      3,
    );
  };

  // One key advances the whole trial. Computed before the finished-state
  // return so the hook runs on every render.
  const primaryAction = !progress
    ? null
    : runner.phase === "idle"
      ? beginTrial
      : runner.phase === "imagine" && runner.remainingDelayMs <= 0 && !runner.cuePlaying
        ? runner.commit
        : runner.phase === "sing"
            ? runner.finish
            : runner.phase === "review"
              ? () => void runner.complete({ intent: null, effort: 2, register: "unknown" })
              : null;
  useSpacebarAdvance(primaryAction);

  if (!progress) {
    return (
      <div className="vc-grid">
        <section className="vc-card" style={{ gridColumn: "span 12" }}>
          <h3>Test complete</h3>
          <p className="vc-small">
            {plan.totalTrials} trials saved across {plan.steps.length} modules. Your numbers are on
            the Progress screen — the comparison against your first run is what matters, not any
            single result.
          </p>
          <div className="vc-actions">
            <button className="vc-button primary" onClick={onFinished}>
              See progress
            </button>
            <button
              className="vc-button"
              onClick={() => {
                setCompleted(0);
                setStarted(false);
              }}
            >
              Run it again
            </button>
          </div>
        </section>
      </div>
    );
  }

  const exercise = exercises.get(progress.step.exerciseId);
  const showIntro = runner.phase === "idle" && (!started || justAdvanced);
  const trial = runner.session?.definition;
  const showLive = progress.step.feedbackMode === "live";

  return (
    <div className="vc-grid">
      <section className="vc-card" style={{ gridColumn: "span 12" }}>
        <div className="vc-section-title">
          <h3>
            {plan.title} — step {progress.stepNumber} of {progress.stepCount}
          </h3>
          <span className="vc-small">
            {completed} / {plan.totalTrials} trials
          </span>
        </div>
        <div className="vc-testbar">
          <i style={{ width: `${(completed / plan.totalTrials) * 100}%` }} />
        </div>
      </section>

      <section className="vc-card vc-stage" style={{ gridColumn: "span 12" }}>
        <div className="vc-stage-head">
          <span className="vc-phase">{runner.phase === "idle" ? "ready" : runner.phase}</span>
          <FlowModeToggle mode={runner.flowMode} onChange={runner.setFlowMode} />
          <span className={`vc-mic ${runner.micStatus === "live" ? "live" : ""}`}>
            ● mic {runner.micStatus}
          </span>
        </div>
        {runner.micError && (
          <p className="vc-small" style={{ color: "#ffbdc5" }}>
            {runner.micError}
          </p>
        )}
        {runner.tooNoisy && (
          <p className="vc-small vc-noise-warning">
            Too noisy here — quiet singing may go unscored.
          </p>
        )}

        {showIntro && (
          <div className="vc-prompt" style={{ marginTop: 40 }}>
            <h3>{exercise.title}</h3>
            <p className="vc-test-what">{progress.step.what}</p>
            <p className="vc-test-why">{progress.step.why}</p>
            <p className="vc-small" style={{ marginTop: 10 }}>
              {progress.step.trialCount} trials · blind · use headphones · spacebar advances.
            </p>
            <div className="vc-actions vc-center-actions">
              <button className="vc-button primary" onClick={beginTrial}>
                {completed === 0 ? "Start the test" : "Start this step"}
              </button>
            </div>
          </div>
        )}

        {runner.phase === "idle" && started && !justAdvanced && (
          <div className="vc-prompt" style={{ marginTop: 60 }}>
            <p className="vc-small">
              Trial {progress.doneInStep + 1} of {progress.step.trialCount} in this step.
            </p>
            <div className="vc-actions vc-center-actions">
              <button className="vc-button primary" onClick={beginTrial}>
                Next trial
              </button>
            </div>
          </div>
        )}

        {runner.phase === "listen" && (
          <div className="vc-prompt" style={{ marginTop: 90 }}>
            <h3>Listen</h3>
            <CueIndicator playing={runner.cuePlaying} />
          </div>
        )}

        {runner.phase === "imagine" && (
          <div className="vc-prompt" style={{ marginTop: 60 }}>
            <h3>Imagine</h3>
            <p>{runner.prompt}</p>
            <CueIndicator playing={runner.cuePlaying} />
            {runner.remainingDelayMs > 0 ? (
              <p className="vc-small" style={{ marginTop: 12 }}>
                Hold it silently… {(runner.remainingDelayMs / 1000).toFixed(1)} s
              </p>
            ) : (
              <div className="vc-actions vc-center-actions">
                <button className="vc-button primary" disabled={runner.cuePlaying} onClick={runner.commit}>
                  I hear it — sing
                </button>
                <button className="vc-button" disabled={runner.cuePlaying} onClick={() => void runner.replayCue()}>
                  Play it again
                </button>
                <button className="vc-button warn" onClick={runner.markLost}>
                  I’m lost
                </button>
              </div>
            )}
          </div>
        )}

        {runner.phase === "sing" && trial && (
          <div className="vc-prompt" style={{ marginTop: 40 }}>
            <h3>Sing</h3>
            <p>Commit to one note. Capture stops automatically.</p>
            <MicMeter level={runner.inputLevel} threshold={runner.noiseThreshold} sample={runner.liveSample} />
            {showLive && <PitchReadout sample={runner.liveSample} targetMidi={trial.targetMidi} />}
            <div className="vc-actions vc-center-actions">
              <button className="vc-button" onClick={runner.finish}>
                Done
              </button>
            </div>
          </div>
        )}

        {runner.phase === "review" && runner.analysis && runner.session && (
          <div className="vc-review">
            <div className="vc-verdict">
              <div>
                <span>Selected</span>
                <strong>{runner.analysis.selectedNote ?? "unscored"}</strong>
              </div>
              <div>
                <span>Requested</span>
                <strong>{runner.analysis.targetNote}</strong>
              </div>
              <div>
                <span>Residual</span>
                <strong>
                  {runner.analysis.residualToSelectedCents == null
                    ? "—"
                    : `${runner.analysis.residualToSelectedCents.toFixed(0)}¢`}
                </strong>
              </div>
            </div>
            <p className="vc-explanation">{runner.analysis.explanation}</p>
            <TraceChart
              record={{ trace: runner.session.trace, definition: runner.session.definition }}
            />
            <div className="vc-actions vc-center-actions">
              <button
                className="vc-button primary"
                onClick={() =>
                  void runner.complete({ intent: null, effort: 2, register: "unknown" })
                }
              >
                Save and continue
              </button>
              <button
                className="vc-button"
                onClick={() => {
                  runner.discard();
                  beginTrial();
                }}
              >
                Retry — don’t count this one
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
