import { useMemo, useRef, useState } from "react";
import {
  baselineTestPlan,
  exercises,
  testProgress,
  type TestStep,
  type TrialRecord,
} from "../../core";
import { useTrialRunner } from "../hooks/useTrialRunner";
import { CueIndicator, MicMeter, useSpacebarAdvance } from "../components/TrialStage";
import { TraceChart } from "../components/TraceChart";
import { ExerciseInfoModal, GuideBrief, InfoButton } from "../components/ExerciseInfo";

const INTERRUPTED =
  "That trial was stopped and won't count. It starts over from the top when you close this.";

/**
 * The guided test. Inside a trial nothing needs a click: the cue plays, the
 * go-signal follows on its own, and capture stops by itself. Between trials
 * there is exactly one click, Next or Retry. The exercise's guide (steps,
 * mechanism, neuroscience, a playable example) is one ⓘ away at every
 * moment. Settings come from the plan, not the user, which is what makes
 * runs comparable to each other.
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
  const [info, setInfo] = useState<{ step: TestStep; interrupted: boolean } | null>(null);
  const saving = useRef(false);

  const runner = useTrialRunner(
    async (record) => {
      await save(record);
      setCompleted((n) => n + 1);
    },
    { flow: "auto" },
  );

  const progress = testProgress(plan, completed);
  const trialActive = runner.phase === "listen" || runner.phase === "imagine" || runner.phase === "sing";

  const beginTrial = (step: TestStep) => {
    setStarted(true);
    void runner.start(
      {
        exerciseId: step.exerciseId,
        difficulty: step.difficulty,
        delayMs: step.delayMs,
        feedbackMode: step.feedbackMode,
      },
      3,
    );
  };

  /** The one click between trials: save this one, start the next. */
  const next = async () => {
    if (runner.phase !== "review" || saving.current) return;
    saving.current = true;
    const upcoming = testProgress(plan, completed + 1);
    try {
      await runner.complete({ intent: null, effort: 2, register: "unknown" });
    } finally {
      saving.current = false;
    }
    if (upcoming) beginTrial(upcoming.step);
  };

  const retry = () => {
    if (!progress) return;
    runner.discard();
    beginTrial(progress.step);
  };

  const openInfo = (step: TestStep) => {
    // A trial can't run under the guide: stop it, and restart it on close.
    const interrupted = trialActive;
    if (interrupted) runner.discard();
    setInfo({ step, interrupted });
  };

  const closeInfo = () => {
    const resume = info?.interrupted;
    setInfo(null);
    if (resume && progress) beginTrial(progress.step);
  };

  // Computed before the finished-state return so the hook runs on every render.
  const primaryAction = info
    ? null
    : !started && runner.phase === "idle" && progress
      ? () => beginTrial(progress.step)
      : runner.phase === "sing"
        ? runner.finish
        : runner.phase === "review"
          ? () => void next()
          : null;
  useSpacebarAdvance(primaryAction);

  if (!progress) {
    return (
      <div className="vc-grid">
        <section className="vc-card vc-card-pad" style={{ gridColumn: "span 12" }}>
          <h3>Test complete</h3>
          <p className="vc-small">
            {plan.totalTrials} trials saved across {plan.steps.length} exercises. Your numbers are on
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

  const step = progress.step;
  const exercise = exercises.get(step.exerciseId);
  const trial = runner.session?.definition;
  const upcoming = testProgress(plan, completed + 1);
  const nextStep = upcoming && upcoming.stepIndex !== progress.stepIndex ? upcoming : null;
  const nextExercise = nextStep ? exercises.get(nextStep.step.exerciseId) : null;
  const nextLabel = !upcoming
    ? "Finish test"
    : nextExercise
      ? `Start ${nextExercise.title} →`
      : "Next trial →";
  const analysis = runner.analysis;

  return (
    <>
      <div className="vc-grid">
        <section className="vc-card vc-card-pad" style={{ gridColumn: "span 12" }}>
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
          <div className="vc-taskbar">
            <div>
              <span className="vc-phase">
                Trial {Math.min(progress.doneInStep + 1, step.trialCount)} of {step.trialCount} · trains{" "}
                {exercise.guide.skill.toLowerCase()}
              </span>
              <div className="vc-taskbar-title">
                <h3>{exercise.title}</h3>
                <InfoButton label={`How ${exercise.title} works`} onClick={() => openInfo(step)} />
              </div>
              <p className="vc-taskbar-task">{exercise.guide.task}</p>
            </div>
            <span className={`vc-mic ${runner.micStatus === "live" ? "live" : ""}`}>● mic {runner.micStatus}</span>
          </div>
          {runner.micError && (
            <p className="vc-small" style={{ color: "#ffbdc5" }}>
              {runner.micError}
            </p>
          )}
          {runner.tooNoisy && (
            <p className="vc-small vc-noise-warning">Too noisy here — quiet singing may go unscored.</p>
          )}

          {!started && runner.phase === "idle" && (
            <div className="vc-intro">
              <p className="vc-small vc-center">
                {plan.totalTrials} trials across {plan.steps.length} exercises · blind: no pitch display while
                you sing · use headphones. Each trial runs on its own. Between trials you pick Next or Retry.
              </p>
              <GuideBrief exercise={exercise} onInfo={() => openInfo(step)} />
              <div className="vc-actions vc-center-actions">
                <button className="vc-button primary" onClick={() => beginTrial(step)}>
                  Start the test
                </button>
              </div>
            </div>
          )}

          {runner.phase === "listen" && (
            <div className="vc-prompt vc-phase-block">
              <h3>Listen</h3>
              <p>{runner.prompt}</p>
              <CueIndicator playing={runner.cuePlaying} label={runner.cueLabel ?? "Listening…"} />
            </div>
          )}

          {runner.phase === "imagine" && trial && (
            <div className="vc-prompt vc-phase-block">
              <h3>{runner.cuePlaying ? "Listen" : trial.delayMs > 0 ? "Hold it" : "Get ready"}</h3>
              <p>{runner.prompt}</p>
              <CueIndicator playing={runner.cuePlaying} label={runner.cueLabel ?? "Listening…"} />
              {trial.delayMs > 0 && !runner.cuePlaying && (
                <>
                  <div className="vc-countdown" aria-hidden="true">
                    <i style={{ width: `${(runner.remainingDelayMs / trial.delayMs) * 100}%` }} />
                  </div>
                  <p className="vc-small">
                    Silence. Keep the note in your head… {(runner.remainingDelayMs / 1000).toFixed(1)} s
                  </p>
                </>
              )}
            </div>
          )}

          {runner.phase === "sing" && trial && (
            <div className="vc-prompt vc-phase-block">
              <h3 className="vc-sing-now">Sing</h3>
              <p>{runner.prompt}</p>
              <MicMeter level={runner.inputLevel} threshold={runner.noiseThreshold} sample={runner.liveSample} />
              <p className="vc-small">One note, held steady. Recording stops on its own (space ends it early).</p>
            </div>
          )}

          {runner.phase === "review" && analysis && runner.session && (
            <div className="vc-review">
              <div className="vc-verdict">
                <div>
                  <span>You sang</span>
                  <strong>{analysis.selectedNote ?? "not heard"}</strong>
                </div>
                <div>
                  <span>Answer</span>
                  <strong>{analysis.targetNote}</strong>
                </div>
                <div>
                  <span>Off-center</span>
                  <strong>
                    {analysis.residualToSelectedCents == null
                      ? "—"
                      : `${analysis.residualToSelectedCents.toFixed(0)}¢`}
                  </strong>
                </div>
              </div>
              <p className="vc-explanation">{analysis.explanation}</p>

              {nextStep && nextExercise && (
                <div className="vc-upnext">
                  <span className="vc-label">
                    Up next · step {nextStep.stepNumber} of {nextStep.stepCount}
                  </span>
                  <GuideBrief exercise={nextExercise} withTitle onInfo={() => openInfo(nextStep.step)} />
                </div>
              )}

              <div className="vc-actions vc-center-actions">
                <button className="vc-button primary" onClick={() => void next()}>
                  {nextLabel}
                </button>
                <button className="vc-button" onClick={retry}>
                  Retry (this one won’t count)
                </button>
              </div>
              <TraceChart record={{ trace: runner.session.trace, definition: runner.session.definition }} />
            </div>
          )}
        </section>
      </div>

      {info && (
        <ExerciseInfoModal
          exercise={exercises.get(info.step.exerciseId)}
          delayMs={info.step.delayMs}
          notice={info.interrupted ? INTERRUPTED : undefined}
          onClose={closeInfo}
        />
      )}
    </>
  );
}
